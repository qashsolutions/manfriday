"""US stock data: the whole market's snapshot, daily history, and quotes.

Today this uses Nasdaq's free public endpoints, with Yahoo as the fallback, and keeps every
daily bar in the local database so a symbol is fetched once and updated a day at a time.

When the official Nasdaq API key arrives, put it in .env as NASDAQ_API_KEY and set
NASDAQ_API_PRODUCT; `official_provider()` is where it plugs in. Everything else keeps working.
"""

from __future__ import annotations

import csv
import io
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import pandas as pd

from .db import DB
from .market import Http

log = logging.getLogger(__name__)

NASDAQ = "https://api.nasdaq.com/api"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart"
CBOE_VIX = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
_throttle = threading.Lock()
_last_call = [0.0]
MIN_INTERVAL = 0.12  # seconds between Nasdaq requests

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_bars (
  symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL,
  PRIMARY KEY (symbol, date));
"""


def official_provider() -> str | None:
    """Named when an official Nasdaq API key is configured (the endpoints are wired in later)."""
    if os.environ.get("NASDAQ_API_KEY"):
        return os.environ.get("NASDAQ_API_PRODUCT", "unset")
    return None


def _money(x) -> float:
    try:
        return float(str(x).replace("$", "").replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def _pace() -> None:
    with _throttle:
        wait = MIN_INTERVAL - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()


def _get(http: Http, url: str, params: dict) -> dict | None:
    _pace()
    try:
        r = http.client.get(url, params=params, headers={"User-Agent": BROWSER_UA, "Accept": "application/json"})
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.info("nasdaq %s failed: %s", url.rsplit("/", 2)[-2:], e)
        return None


def nasdaq_quote(http: Http, symbol: str) -> tuple[float | None, float, str]:
    """Last traded price for a stock or ETF."""
    for asset_class in ("stocks", "etf"):
        d = _get(http, f"{NASDAQ}/quote/{symbol}/info", {"assetclass": asset_class})
        primary = ((d or {}).get("data") or {}).get("primaryData") or {}
        price = _money(primary.get("lastSalePrice"))
        if price > 0:
            stamp = primary.get("lastTradeTimestamp") or ""
            return price, _parse_stamp(stamp), "nasdaq"
    return None, 0.0, "none"


def _parse_stamp(text: str) -> float:
    """'Sep 22, 2026 1:06 PM ET' -> epoch seconds (close enough; falls back to now)."""
    cleaned = text.replace(" ET", "").replace("DATA AS OF ", "").strip()
    for fmt in ("%b %d, %Y %I:%M %p", "%b %d, %Y"):
        try:
            from zoneinfo import ZoneInfo

            return datetime.strptime(cleaned, fmt).replace(tzinfo=ZoneInfo("America/New_York")).timestamp()
        except ValueError:
            continue
    return time.time()


class StockData:
    def __init__(self, db: DB, http: Http | None = None):
        self.db = db
        self.http = http or Http(BROWSER_UA)
        self.db.conn.executescript(SCHEMA)
        self._snapshot: tuple[float, pd.DataFrame] | None = None

    # ---- the whole market in one request --------------------------------------------------

    def snapshot(self, max_age: float = 600) -> pd.DataFrame:
        """Every US-listed stock: price, day change, volume, market cap, sector."""
        if self._snapshot and time.time() - self._snapshot[0] < max_age:
            return self._snapshot[1]
        rows = []
        d = _get(self.http, f"{NASDAQ}/screener/stocks", {"tableonly": "true", "limit": "10000", "download": "true"})
        for r in ((d or {}).get("data") or {}).get("rows") or []:
            price = _money(r.get("lastsale"))
            if price <= 0:
                continue
            rows.append({
                "symbol": r["symbol"].strip().upper(), "name": r.get("name", ""), "price": price,
                "pct_change": _money(str(r.get("pctchange", "0")).replace("%", "")),
                "volume": _money(r.get("volume")), "market_cap": _money(r.get("marketCap")),
                "sector": r.get("sector") or "", "industry": r.get("industry") or "", "kind": "stock",
            })
        e = _get(self.http, f"{NASDAQ}/screener/etf", {"tableonly": "true", "limit": "5000", "download": "true"})
        for r in ((e or {}).get("data") or {}).get("data", {}).get("rows") or ((e or {}).get("data") or {}).get("rows") or []:
            price = _money(r.get("lastSalePrice"))
            if price <= 0:
                continue
            rows.append({
                "symbol": r["symbol"].strip().upper(), "name": r.get("companyName", ""), "price": price,
                "pct_change": _money(str(r.get("percentageChange", "0")).replace("%", "")),
                "volume": 0.0, "market_cap": 0.0, "sector": "ETF", "industry": "ETF", "kind": "etf",
            })
        df = pd.DataFrame(rows).drop_duplicates("symbol").set_index("symbol") if rows else pd.DataFrame()
        if not df.empty:
            df["dollar_volume"] = df["price"] * df["volume"]
            self._snapshot = (time.time(), df)
        return df

    # ---- daily history, cached ------------------------------------------------------------

    def cached(self, symbol: str, days: int) -> pd.DataFrame:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = self.db.query(
            "SELECT date, open, high, low, close, volume FROM daily_bars WHERE symbol=? AND date>=? ORDER BY date",
            (symbol, since),
        )
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        df.index = pd.to_datetime(df.pop("date"))
        return df

    def daily(self, symbol: str, days: int = 400, refresh: bool = True) -> pd.DataFrame:
        """Daily bars, from the cache; only the missing days are fetched."""
        df = self.cached(symbol, days)
        last = df.index.max() if not df.empty else None
        fresh_enough = last is not None and (datetime.now(timezone.utc).replace(tzinfo=None) - last).days < 1
        if not refresh or fresh_enough:
            return df
        fetched = self._fetch(symbol, days if df.empty else 7)
        if not fetched.empty:
            self.db.executemany(
                "INSERT OR REPLACE INTO daily_bars VALUES(?,?,?,?,?,?,?)",
                [(symbol, d.strftime("%Y-%m-%d"), r.open, r.high, r.low, r.close, r.volume) for d, r in fetched.iterrows()],
            )
            df = self.cached(symbol, days)
        return df

    def _fetch(self, symbol: str, days: int) -> pd.DataFrame:
        start = (datetime.now(timezone.utc) - timedelta(days=days + 5)).strftime("%Y-%m-%d")
        for asset_class in ("stocks", "etf"):
            d = _get(self.http, f"{NASDAQ}/quote/{symbol}/historical",
                     {"assetclass": asset_class, "fromdate": start, "limit": str(days + 10)})
            rows = (((d or {}).get("data") or {}).get("tradesTable") or {}).get("rows") or []
            if rows:
                out = []
                for r in rows:
                    close = _money(r.get("close"))
                    if close <= 0:
                        continue
                    out.append((pd.to_datetime(r["date"], format="%m/%d/%Y"), _money(r.get("open")) or close,
                                _money(r.get("high")) or close, _money(r.get("low")) or close, close, _money(r.get("volume"))))
                if out:
                    df = pd.DataFrame(out, columns=["date", "open", "high", "low", "close", "volume"]).set_index("date")
                    return df.sort_index()
        return self._yahoo_daily(symbol, days)

    def _yahoo_daily(self, symbol: str, days: int) -> pd.DataFrame:
        try:
            d = self.http.get_json(f"{YAHOO}/{symbol}", {"interval": "1d", "range": f"{max(days, 30)}d"}, retries=0)
            res = d["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            rows = [(pd.to_datetime(ts, unit="s").normalize(), o, h, l, c, v)
                    for ts, o, h, l, c, v in zip(res["timestamp"], q["open"], q["high"], q["low"], q["close"], q["volume"]) if c]
            return pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]).set_index("date")
        except Exception:
            return pd.DataFrame()

    # ---- earnings dates -------------------------------------------------------------------

    def earnings(self, days: int = 12) -> dict[str, dict]:
        """Upcoming earnings dates. A stock can gap 20% overnight on these, and the day rules
        cannot protect a position while the market is shut."""
        from datetime import date, timedelta

        out: dict[str, dict] = {}
        today = date.today()
        for offset in range(days):
            day = today + timedelta(days=offset)
            if day.weekday() >= 5:
                continue
            d = _get(self.http, f"{NASDAQ}/calendar/earnings", {"date": day.isoformat()})
            for row in ((d or {}).get("data") or {}).get("rows") or []:
                sym = (row.get("symbol") or "").strip().upper()
                if sym and sym not in out:
                    out[sym] = {"date": day.isoformat(), "days_away": offset,
                                "when": (row.get("time") or "").replace("time-", "").replace("-", " ")}
        return out

    # ---- market yardsticks ----------------------------------------------------------------

    def vix(self) -> pd.Series:
        """CBOE's volatility index: the market's fear gauge."""
        try:
            _pace()
            r = self.http.client.get(CBOE_VIX, headers={"User-Agent": BROWSER_UA})
            r.raise_for_status()
            rows = list(csv.DictReader(io.StringIO(r.text)))
            s = pd.Series({pd.to_datetime(x["DATE"]): float(x["CLOSE"]) for x in rows[-400:]})
            return s.sort_index()
        except Exception as e:
            log.info("vix failed: %s", e)
            return pd.Series(dtype=float)
