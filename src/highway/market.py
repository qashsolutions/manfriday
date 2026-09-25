"""Market data from free public endpoints.

Crypto: Coinbase public API (prices, order-book top, candles), cross-checked with Crypto.com.
Stocks: Coinbase's public API does not serve its stock products, so paper mode uses Yahoo's
chart endpoint (unofficial, no key) with a modeled bid/ask spread.
"""

from __future__ import annotations

import logging
import time

import httpx
import pandas as pd

from .config import Settings
from .risk import Quote

log = logging.getLogger(__name__)

CB = "https://api.coinbase.com/api/v3/brokerage/market"
CDC = "https://api.crypto.com/exchange/v1/public"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart"

GRANULARITY = {1: "ONE_MINUTE", 5: "FIVE_MINUTE", 15: "FIFTEEN_MINUTE", 30: "THIRTY_MINUTE", 60: "ONE_HOUR", 1440: "ONE_DAY"}
YAHOO_INTERVAL = {1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "60m", 1440: "1d"}
BAR_COLUMNS = ["open", "high", "low", "close", "volume"]

STABLE_OR_WRAPPED = {
    "USDT", "USDC", "DAI", "PYUSD", "EURC", "USDS", "FDUSD", "TUSD", "GUSD", "USD1", "RLUSD", "USDG",
    "WBTC", "CBBTC", "CBETH", "WETH", "STETH", "WSTETH", "LSETH", "PAX", "PAXG", "XAUT",
}


def asset_class(asset: str) -> str:
    return "crypto" if "-" in asset else "equity"


class Http:
    def __init__(self, user_agent: str, timeout: float = 12.0):
        self.client = httpx.Client(timeout=timeout, headers={"User-Agent": user_agent}, follow_redirects=True)

    def get_json(self, url: str, params: dict | None = None, retries: int = 2) -> dict:
        last: Exception | None = None
        for attempt in range(retries + 1):
            try:
                r = self.client.get(url, params=params)
                if r.status_code == 429:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPError, ValueError) as e:
                last = e
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"GET {url} failed: {last}")


def _frame(rows: list[tuple]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["ts", *BAR_COLUMNS]).drop_duplicates("ts").sort_values("ts")
    return df.set_index("ts").astype(float)


class MarketData:
    def __init__(self, settings: Settings, http: Http | None = None):
        self.s = settings
        self.http = http or Http(settings.news.user_agent)
        self._price_cache: dict[tuple[str, int], float] = {}

    # ---- quotes --------------------------------------------------------------------------

    def quote(self, asset: str) -> Quote | None:
        try:
            if asset_class(asset) == "crypto":
                return self._crypto_quote(asset)
            return self._equity_quote(asset)
        except Exception as e:  # network errors must never crash the engine
            log.warning("quote %s failed: %s", asset, e)
            return None

    def _crypto_quote(self, product: str) -> Quote:
        d = self.http.get_json(f"{CB}/products/{product}/ticker", {"limit": 1})
        bid, ask = float(d["best_bid"]), float(d["best_ask"])
        last = float(d["trades"][0]["price"]) if d.get("trades") else (bid + ask) / 2
        venues = {"coinbase": (bid, ask)}
        gap = None
        try:
            other = self.http.get_json(f"{CDC}/get-tickers", {"instrument_name": product.replace("-", "_")}, retries=0)
            data = other.get("result", {}).get("data") or []
            if data and data[0].get("b") and data[0].get("k"):
                cdc_bid, cdc_ask = float(data[0]["b"]), float(data[0]["k"])
                venues["cryptocom"] = (cdc_bid, cdc_ask)
                gap = ((bid + ask) / (cdc_bid + cdc_ask) - 1) * 100
        except Exception:
            pass  # not every coin trades on Crypto.com; the cross-check is best effort
        return Quote(product, bid, ask, last, time.time(), "coinbase", gap, venues)

    def _equity_quote(self, symbol: str) -> Quote:
        """Nasdaq first (it holds up under load), Yahoo as the fallback."""
        from .stockdata import nasdaq_quote
        from .venues import half_spread_bps

        last, ts, source = nasdaq_quote(self.http, symbol)
        if last is None:
            d = self.http.get_json(f"{YAHOO}/{symbol}", {"interval": "1m", "range": "1d"})
            meta = d["chart"]["result"][0]["meta"]
            last, ts, source = float(meta["regularMarketPrice"]), float(meta["regularMarketTime"]), "yahoo"
        half = last * half_spread_bps(symbol, last, self.s.fees) / 1e4
        return Quote(symbol, last - half, last + half, last, ts, source)

    # ---- bars ----------------------------------------------------------------------------

    def bars(self, asset: str, minutes: int, start: float, end: float | None = None) -> pd.DataFrame:
        end = end or time.time()
        if asset_class(asset) == "crypto":
            return self._coinbase_candles(asset, minutes, start, end)
        return self._yahoo_candles(asset, minutes, start, end)

    def _coinbase_candles(self, product: str, minutes: int, start: float, end: float) -> pd.DataFrame:
        step = minutes * 60 * 350
        rows: list[tuple] = []
        t, end = int(start), int(end)
        while t < end:
            chunk_end = min(t + step, end)
            d = self.http.get_json(
                f"{CB}/products/{product}/candles",
                {"start": t, "end": chunk_end, "granularity": GRANULARITY[minutes]},
            )
            for c in d.get("candles", []):
                rows.append((int(c["start"]), c["open"], c["high"], c["low"], c["close"], c["volume"]))
            t = chunk_end
            time.sleep(0.12)  # stay well under the public rate limit
        return _frame(rows)

    def _yahoo_candles(self, symbol: str, minutes: int, start: float, end: float) -> pd.DataFrame:
        d = self.http.get_json(
            f"{YAHOO}/{symbol}",
            {"interval": YAHOO_INTERVAL[minutes], "period1": int(start), "period2": int(end)},
        )
        res = d["chart"]["result"][0]
        q = (res.get("indicators", {}).get("quote") or [{}])[0]
        cols = [q.get(k) or [] for k in ("open", "high", "low", "close", "volume")]
        rows = [(ts, o, h, l, c, v) for ts, o, h, l, c, v in zip(res.get("timestamp") or [], *cols) if c is not None]
        return _frame(rows)

    def price_at(self, asset: str, ts: float) -> float | None:
        """Close of the last 5-minute bar at or before `ts`. Successful lookups are cached."""
        bucket = int(ts // 300) * 300
        key = (asset, bucket)
        if key in self._price_cache:
            return self._price_cache[key]
        try:
            df = self.bars(asset, 5, bucket - 3 * 86400 if asset_class(asset) == "equity" else bucket - 3600, bucket + 300)
        except Exception as e:
            log.warning("price_at %s failed: %s", asset, e)
            return None
        before = df[df.index <= bucket]
        if before.empty:
            return None
        price = float(before.iloc[-1]["close"])
        if len(self._price_cache) > 2000:
            self._price_cache.clear()
        self._price_cache[key] = price
        return price

    # ---- universe ------------------------------------------------------------------------

    def crypto_universe(self, min_volume_usd: float) -> list[dict]:
        d = self.http.get_json(f"{CB}/products", {"product_type": "SPOT"})
        out = []
        for p in d.get("products", []):
            if p.get("quote_currency_id") != "USD" or p.get("status") != "online":
                continue
            if p.get("trading_disabled") or p.get("is_disabled") or p.get("cancel_only") or p.get("view_only"):
                continue
            if p.get("base_currency_id", "").upper() in STABLE_OR_WRAPPED:
                continue
            vol = float(p.get("approximate_quote_24h_volume") or 0)
            if vol < min_volume_usd:
                continue
            bid, ask = float(p.get("best_bid_price") or 0), float(p.get("best_ask_price") or 0)
            spread_bps = (ask / bid - 1) * 1e4 if bid > 0 and ask > 0 else None
            out.append({"asset": p["product_id"], "name": p.get("base_name"), "volume_usd": vol, "spread_bps": spread_bps})
        return out
