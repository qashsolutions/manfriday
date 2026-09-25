"""Radar: track every bucket on seven indicators and flag what deserves a closer look.

Seven indicators per asset, each either passes or not:
  trend      price above its 20- and 50-day averages
  momentum   up over 20 days and 5 days, and not already overbought
  strength   beating the S&P (stocks) or bitcoin (crypto) over 20 days
  volume     trading well above its own normal
  breakout   at or near a 20-day high
  movement   volatile enough that the monthly target is even possible
  news       recent headlines, and positive ones

An asset that passes enough of them is not bought. It is queued for a full walk-forward
backtest, and only if that passes does it reach the Scout, the watchlist and the managers.
The market regime (S&P and Nasdaq trend plus the VIX) is reported alongside, so a flood of
alerts in a falling market is visible for what it is.
"""

from __future__ import annotations

import logging
import math
import re
import time

import numpy as np
import pandas as pd

from . import scout
from .config import Settings
from .db import DB
from .market import MarketData, asset_class
from .params import Params
from .stockdata import StockData
from .universe import load as load_universe

log = logging.getLogger(__name__)

INDICATORS = ("trend", "momentum", "strength", "volume", "breakout", "movement", "news")
WEIGHT_KEYS = {name: f"radar_w_{name}" for name in INDICATORS}


# ---- market regime ---------------------------------------------------------------------------

def regime(sd: StockData, md: MarketData, db: DB) -> dict:
    """Is the market a friendly place for new buys right now?"""
    out = {"ts": time.time()}
    levels = {}
    for sym in ("SPY", "QQQ"):
        df = sd.daily(sym, 120)
        if len(df) > 55:
            close = df["close"]
            levels[sym] = {"price": float(close.iloc[-1]), "sma50": float(close.iloc[-50:].mean()),
                           "above": bool(close.iloc[-1] > close.iloc[-50:].mean()),
                           "change_20d_pct": round(float(close.iloc[-1] / close.iloc[-21] - 1) * 100, 2)}
    vix = sd.vix()
    vix_level = float(vix.iloc[-1]) if len(vix) else None
    above = [v["above"] for v in levels.values()]
    if above and all(above) and (vix_level or 99) < 20:
        label, detail = "risk-on", "S&P and Nasdaq above their 50-day averages, volatility low"
    elif above and not any(above) and (vix_level or 0) > 28:
        label, detail = "risk-off", "S&P and Nasdaq below their 50-day averages, volatility high"
    else:
        label, detail = "caution", "mixed: not all indexes are trending up"
    out.update({"stocks": label, "detail": detail, "vix": vix_level, "indexes": levels})
    try:
        btc = md.bars("BTC-USD", 1440, time.time() - 120 * 86400)["close"]
        out["crypto"] = {"btc_above_50d": bool(btc.iloc[-1] > btc.iloc[-50:].mean()),
                         "btc_change_20d_pct": round(float(btc.iloc[-1] / btc.iloc[-21] - 1) * 100, 2)}
    except Exception:
        out["crypto"] = {}
    out["fear_greed"] = db.get_state("fear_greed")
    db.set_state("regime", out)
    return out


# ---- indicators ------------------------------------------------------------------------------

def _rsi(close: pd.Series, n: int = 14) -> float:
    delta = close.diff().dropna()
    if len(delta) < n:
        return 50.0
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean().iloc[-1]
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean().iloc[-1]
    return 100.0 if loss == 0 else float(100 - 100 / (1 + gain / loss))


def measure(df: pd.DataFrame, bench_20d: float, news: dict, intraday_fraction: float = 1.0) -> dict | None:
    """The seven readings for one asset from its daily bars (today's bar may be partial)."""
    if len(df) < 55:
        return None
    close, volume = df["close"], df["volume"]
    price = float(close.iloc[-1])
    sma20, sma50 = float(close.iloc[-20:].mean()), float(close.iloc[-50:].mean())
    r20 = float(close.iloc[-1] / close.iloc[-21] - 1)
    r5 = float(close.iloc[-1] / close.iloc[-6] - 1)
    rsi = _rsi(close)
    avg_volume = float(volume.iloc[-21:-1].mean()) or 1.0
    rvol = float(volume.iloc[-1]) / max(avg_volume * max(intraday_fraction, 0.15), 1.0)
    high20 = float(df["high"].iloc[-21:-1].max() or close.iloc[-21:-1].max())
    logret = np.log(close).diff().dropna()
    monthly_vol = float(logret.iloc[-30:].std() * math.sqrt(21))
    score, passes = {}, {}
    passes["trend"] = price > sma20 > sma50
    score["trend"] = 1.0 if passes["trend"] else (0.5 if price > sma20 else 0.0)
    passes["momentum"] = r20 > 0 and r5 > 0 and rsi < 80
    score["momentum"] = max(0.0, min(1.0, r20 / 0.3)) * (0.5 if rsi >= 80 else 1.0)
    edge = r20 - bench_20d
    passes["strength"] = edge > 0.05
    score["strength"] = max(0.0, min(1.0, edge / 0.2))
    passes["volume"] = rvol >= 1.5
    score["volume"] = max(0.0, min(1.0, (rvol - 0.5) / 2.5))
    passes["breakout"] = price >= 0.98 * high20
    score["breakout"] = max(0.0, min(1.0, (price / high20 - 0.9) / 0.1)) if high20 else 0.0
    passes["movement"] = 0.10 <= monthly_vol <= 1.5
    score["movement"] = max(0.0, min(1.0, monthly_vol / 0.3))
    sentiment, count = news.get("score", 0.0), news.get("count", 0)
    passes["news"] = count >= 2 and sentiment >= 0.1
    score["news"] = max(0.0, min(1.0, sentiment)) * (1.0 if count >= 2 else 0.4)
    return {
        "price": float(f"{price:.6g}"),  # keep small coin prices readable
        "r20_pct": round(r20 * 100, 1), "r5_pct": round(r5 * 100, 1),
        "rsi": round(rsi), "rvol": round(rvol, 2), "monthly_vol_pct": round(monthly_vol * 100, 1),
        "vs_market_pct": round(edge * 100, 1), "news_count": count, "news_score": round(sentiment, 2),
        "scores": score, "passes": passes, "signals": sum(passes.values()),
    }


def composite(reading: dict, params: Params) -> float:
    weights = {name: params[key] for name, key in WEIGHT_KEYS.items()}
    total = sum(weights.values()) or 1.0
    return round(sum(reading["scores"][n] * weights[n] for n in INDICATORS) / total * 100, 1)


# ---- news matching (cheap: reuse headlines already collected) ---------------------------------

def news_by_symbol(db: DB, meta: dict, hours: float = 48) -> dict[str, dict]:
    rows = db.query("SELECT title, sentiment FROM news WHERE published > ?", (time.time() - hours * 3600,))
    out: dict[str, dict] = {}
    if not rows:
        return out
    titles = [(r["title"], r["title"].upper(), r["sentiment"]) for r in rows]
    for symbol, info in meta.items():
        ticker = symbol.split("-")[0]
        name = (info.get("name") or "").split(" Inc")[0].split(" Corp")[0].split(",")[0].strip()
        pattern = re.compile(rf"(?<![A-Za-z0-9])\$?{re.escape(ticker)}(?![A-Za-z0-9])")
        hits = [s for title, upper, s in titles
                if pattern.search(upper) or (len(name) > 4 and name.upper() in upper)]
        if hits:
            out[symbol] = {"count": len(hits), "score": sum(hits) / len(hits)}
    return out


# ---- the scan --------------------------------------------------------------------------------

class Radar:
    def __init__(self, engine):
        self.e = engine
        self.sd = StockData(engine.db)
        self.last_universe = 0.0
        self.last_bar_refresh = 0.0

    def refresh_daily_bars(self, symbols: list[str]) -> int:
        done = 0
        for sym in symbols:
            if self.e.stop.is_set():
                break
            if asset_class(sym) == "crypto":
                continue
            if not self.sd.daily(sym, 400).empty:
                done += 1
        return done

    def scan(self, params: Params) -> dict:
        e = self.e
        uni = load_universe(e.db)
        meta = uni.get("meta", {})
        if not meta:
            return {}
        started = time.time()
        reg = regime(self.sd, e.md, e.db)
        snap = self.sd.snapshot()
        news = news_by_symbol(e.db, meta)
        bench = {"equity": 0.0, "crypto": 0.0}
        spy = self.sd.cached("SPY", 60)
        if len(spy) > 21:
            bench["equity"] = float(spy["close"].iloc[-1] / spy["close"].iloc[-21] - 1)
        try:
            btc = e.md.bars("BTC-USD", 1440, time.time() - 60 * 86400)["close"]
            bench["crypto"] = float(btc.iloc[-1] / btc.iloc[-21] - 1)
        except Exception:
            pass
        fraction = _session_fraction()
        rows = []
        for symbol, info in meta.items():
            cls = asset_class(symbol)
            df = self.sd.cached(symbol, 120) if cls == "equity" else self._crypto_daily(symbol)
            if df.empty:
                continue
            if cls == "equity" and symbol in snap.index:  # today's partial bar from the live snapshot
                live = snap.loc[symbol]
                today = pd.DataFrame([{"open": float(live["price"]), "high": float(live["price"]),
                                       "low": float(live["price"]), "close": float(live["price"]),
                                       "volume": float(live["volume"])}], index=[pd.Timestamp.utcnow().tz_localize(None).normalize()])
                df = pd.concat([df[df.index < today.index[0]], today])
            reading = measure(df, bench["crypto" if cls == "crypto" else "equity"], news.get(symbol, {}), fraction if cls == "equity" else 1.0)
            if not reading:
                continue
            reading.update({"symbol": symbol, "class": cls, "name": info.get("name", symbol),
                            "buckets": info.get("buckets", []), "venue": info.get("venue", ""),
                            "score": composite(reading, params)})
            rows.append(reading)
        rows.sort(key=lambda r: -r["score"])
        min_signals = int(params["radar_min_signals"])
        alerts = [r for r in rows if r["signals"] >= min_signals and not (r["class"] == "equity" and reg["stocks"] == "risk-off")]
        state = {
            "ts": time.time(), "seconds": round(time.time() - started), "regime": reg,
            "tracked": len(rows), "min_signals": min_signals,
            "rows": [_compact(r) for r in rows[:60]],
            "alerts": [_compact(r) for r in alerts[:25]],
            "buckets": uni.get("counts", {}),
            "candidates": e.db.get_state("radar_candidates", {}),
        }
        e.db.set_state("radar", state)
        return state

    def _crypto_daily(self, asset: str) -> pd.DataFrame:
        try:
            df = self.e.md.bars(asset, 1440, time.time() - 120 * 86400)
        except Exception:
            return pd.DataFrame()
        if df.empty:
            return df
        df.index = pd.to_datetime(df.index, unit="s").normalize()
        return df

    def evaluate(self, state: dict, params: Params, limit: int = 4) -> list[str]:
        """Backtest the freshest alerts. Only those that pass reach the Scout and the managers."""
        e = self.e
        candidates = e.db.get_state("radar_candidates", {})
        done = []
        for row in state.get("alerts", []):
            if len(done) >= limit:
                break
            sym = row["symbol"]
            seen = candidates.get(sym)
            if seen and time.time() - seen["ts"] < 3 * 86400:
                continue
            try:
                bts = scout.survivors(e.md, e.s, e.db, params, sym)
            except Exception as ex:
                log.info("radar: backtest %s failed: %s", sym, ex)
                continue
            edge, best = scout.edge(bts)
            # `if edge` would treat a genuine 0.0 edge as missing, which then renders as
            # "passed +null" on the radar table.
            candidates[sym] = {"ts": time.time(), "passed": edge is not None,
                               "edge": round(edge, 2) if edge is not None else None,
                               "strategy": best, "signals": row["signals"], "score": row["score"], "class": row["class"]}
            done.append(sym)
            if edge is not None:
                e.db.event("info", "radar", f"{sym}: {row['signals']}/7 signals, backtest passed ({best} {edge:+.1f}) - now a candidate")
        cutoff = time.time() - 7 * 86400
        candidates = {k: v for k, v in candidates.items() if v["ts"] > cutoff}
        e.db.set_state("radar_candidates", candidates)
        return done

    def loop(self) -> None:
        from . import universe

        while not self.e.stop.is_set():
            try:
                uni = load_universe(self.e.db)
                if time.time() - uni.get("ts", 0) > 20 * 3600:
                    universe.build(self.sd, self.e.md, self.e.s, self.e.db)
                    uni = load_universe(self.e.db)
                # Scan first with whatever history is cached, so a restart never delays the radar.
                params = Params(self.e.db.load_params())
                state = self.scan(params)
                if state:
                    log.info("radar: %d tracked, %d alerts (%s)", state["tracked"], len(state["alerts"]), state["regime"]["stocks"])
                    self.evaluate(state, params)
                if time.time() - (self.e.db.get_state("earnings_ts") or 0) > 20 * 3600:
                    cal = self.sd.earnings()
                    if cal:
                        self.e.db.set_state("earnings", cal)
                        self.e.db.set_state("earnings_ts", time.time())
                        self.e.earnings = cal
                        log.info("radar: earnings calendar covers %d companies", len(cal))
                if time.time() - (self.e.db.get_state("seasonality", {}) or {}).get("ts", 0) > 20 * 3600:
                    assets = sorted(self.e.all_assets())[:6]
                    self.e.clock = __import__("highway.seasonality", fromlist=["x"]).build(self.e.md, self.e.s, self.e.db, assets)
                    log.info("radar: refreshed the market clock (%ds)", self.e.clock.get("seconds", 0))
                # Then top up daily bars for the whole universe, at most once a day.
                refreshed = self.e.db.get_state("radar_bars_refreshed") or 0
                if time.time() - refreshed > 20 * 3600:
                    n = self.refresh_daily_bars(sorted(uni.get("meta", {})))
                    if not self.e.stop.is_set():
                        self.e.db.set_state("radar_bars_refreshed", time.time())
                        log.info("radar: refreshed daily bars for %d symbols", n)
            except Exception as e:
                log.exception("radar loop")
                self.e.db.event("warn", "radar_error", f"{type(e).__name__}: {e}")
            self.e.stop.wait(self.e.s.radar.scan_minutes * 60)


def _compact(r: dict) -> dict:
    return {k: r[k] for k in ("symbol", "name", "class", "buckets", "venue", "price", "score", "signals", "passes",
                              "r20_pct", "r5_pct", "rvol", "vs_market_pct", "monthly_vol_pct", "rsi", "news_count", "news_score")}


def _session_fraction() -> float:
    """How much of the US trading day has passed (so half a day's volume is not read as low)."""
    from datetime import datetime

    from .calendar import NY

    now = datetime.now(NY)
    minutes = (now.hour - 9) * 60 + now.minute - 30
    return max(0.15, min(1.0, minutes / 390)) if 0 < minutes < 390 else 1.0
