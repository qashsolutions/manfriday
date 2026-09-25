"""When in the week and the day do these assets actually move?

Market lore says stocks open strong, sell off into the close, Monday gaps on weekend news and
Friday fades early. Some of that is real and some is stale, so this measures it from our own
history instead of assuming: average return and hit rate for every weekday-and-hour bucket,
with a t-statistic so a pattern only counts when it is bigger than the noise.

The result feeds three things: a tilt on new buys, an optional blackout near the close, and a
SessionTiming strategy that has to earn its place in the tournament like every other one.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime

import numpy as np
import pandas as pd

from .calendar import NY
from .config import Settings
from .db import DB
from .market import MarketData, asset_class

log = logging.getLogger(__name__)

MIN_SAMPLES = 30
STRONG_T = 2.0  # a bucket counts only if its average is 2+ standard errors from zero

# Named windows, in New York time.
EQUITY_WINDOWS = {
    "first hour": lambda d: d.hour == 9 or (d.hour == 10 and d.minute == 0),
    "late morning": lambda d: 10 <= d.hour < 12,
    "midday": lambda d: 12 <= d.hour < 14,
    "last two hours": lambda d: d.hour >= 14,
}
CRYPTO_WINDOWS = {
    "US morning": lambda d: 9 <= d.hour < 12,
    "US afternoon": lambda d: 12 <= d.hour < 17,
    "US evening": lambda d: 17 <= d.hour < 22,
    "overnight": lambda d: d.hour >= 22 or d.hour < 4,
    "Europe morning": lambda d: 4 <= d.hour < 9,
}
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _stats(returns: list[float]) -> dict:
    n = len(returns)
    if n < 5:
        return {"samples": n}
    mean = sum(returns) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in returns) / (n - 1)) if n > 1 else 0.0
    t = mean / (sd / math.sqrt(n)) if sd > 0 else 0.0
    return {
        "samples": n,
        "mean_bp": round(mean * 10000, 1),  # basis points per bar
        "hit_rate": round(sum(1 for r in returns if r > 0) / n, 3),
        "t": round(t, 2),
        "strong": bool(n >= MIN_SAMPLES and abs(t) >= STRONG_T),
    }


def measure(bars: pd.DataFrame, windows: dict) -> dict:
    """Bucket bar returns by weekday, by hour and by named window, all in New York time."""
    if bars.empty or len(bars) < 200:
        return {}
    close = bars["close"]
    rets = (close / close.shift(1) - 1).dropna()
    stamps = [datetime.fromtimestamp(ts, NY) for ts in rets.index]
    by_weekday: dict[str, list] = {}
    by_hour: dict[int, list] = {}
    by_window: dict[str, list] = {}
    by_weekday_window: dict[str, list] = {}
    for when, r in zip(stamps, rets.values):
        r = float(r)
        by_weekday.setdefault(WEEKDAYS[when.weekday()], []).append(r)
        by_hour.setdefault(when.hour, []).append(r)
        for name, test in windows.items():
            if test(when):
                by_window.setdefault(name, []).append(r)
                by_weekday_window.setdefault(f"{WEEKDAYS[when.weekday()]} {name}", []).append(r)
    return {
        "bars": len(rets),
        "weekday": {k: _stats(v) for k, v in by_weekday.items()},
        "hour": {str(k): _stats(v) for k, v in sorted(by_hour.items())},
        "window": {k: _stats(v) for k, v in by_window.items()},
        "weekday_window": {k: v for k, v in ((k, _stats(v)) for k, v in by_weekday_window.items()) if v.get("strong")},
    }


def gaps(bars: pd.DataFrame) -> dict:
    """Overnight and weekend gaps: previous close to next open, split by weekday."""
    if bars.empty:
        return {}
    opens, closes = bars["open"], bars["close"]
    by_day: dict[str, list] = {}
    prev_close, prev_day = None, None
    for ts, row in bars.iterrows():
        when = datetime.fromtimestamp(ts, NY)
        day = when.date()
        if prev_day is not None and day != prev_day and prev_close:
            by_day.setdefault(WEEKDAYS[when.weekday()], []).append(float(row["open"]) / prev_close - 1)
        prev_close, prev_day = float(row["close"]), day
    return {k: _stats(v) for k, v in by_day.items()}


def build(md: MarketData, s: Settings, db: DB, assets: list[str] | None = None) -> dict:
    """Measure the market's clock for stocks and for crypto, plus each lane's own asset."""
    started = time.time()
    out: dict = {"ts": time.time(), "assets": {}}
    try:
        spy = md.bars("SPY", 60, time.time() - 720 * 86400)
        out["equity"] = measure(spy, EQUITY_WINDOWS)
        out["equity"]["gaps"] = gaps(spy)
        out["equity"]["source"] = "SPY hourly, 2 years"
    except Exception as e:
        log.info("seasonality: SPY failed: %s", e)
    try:
        btc = md.bars("BTC-USD", 60, time.time() - 365 * 86400)
        out["crypto"] = measure(btc, CRYPTO_WINDOWS)
        out["crypto"]["source"] = "BTC hourly, 1 year"
    except Exception as e:
        log.info("seasonality: BTC failed: %s", e)
    for asset in assets or []:
        try:
            days = 720 if asset_class(asset) == "equity" else 365
            bars = md.bars(asset, 60, time.time() - days * 86400)
            windows = EQUITY_WINDOWS if asset_class(asset) == "equity" else CRYPTO_WINDOWS
            measured = measure(bars, windows)
            if measured:
                out["assets"][asset] = measured
        except Exception as e:
            log.info("seasonality: %s failed: %s", asset, e)
    out["seconds"] = round(time.time() - started)
    db.set_state("seasonality", out)
    return out


def tilt(profile: dict, asset: str, now: float) -> tuple[float, str]:
    """How favourable is this moment, from -1 (historically weak) to +1 (historically strong)?

    Only windows that cleared the significance bar move the number at all.
    """
    cls = asset_class(asset)
    book = (profile.get("assets", {}).get(asset) or profile.get("crypto" if cls == "crypto" else "equity") or {})
    if not book:
        return 0.0, "no measured pattern"
    when = datetime.fromtimestamp(now, NY)
    windows = CRYPTO_WINDOWS if cls == "crypto" else EQUITY_WINDOWS
    name = next((n for n, test in windows.items() if test(when)), None)
    if not name:
        return 0.0, "outside measured windows"
    parts, score = [], 0.0
    combo = book.get("weekday_window", {}).get(f"{WEEKDAYS[when.weekday()]} {name}")
    window = book.get("window", {}).get(name, {})
    weekday = book.get("weekday", {}).get(WEEKDAYS[when.weekday()], {})
    for stat, label in ((combo, f"{WEEKDAYS[when.weekday()]} {name}"), (window, name), (weekday, WEEKDAYS[when.weekday()])):
        if stat and stat.get("strong"):
            score += max(-1.0, min(1.0, stat["mean_bp"] / 10.0)) * 0.5
            parts.append(f"{label} averages {stat['mean_bp']:+.1f}bp (t {stat['t']:+.1f})")
    return max(-1.0, min(1.0, score)), "; ".join(parts) or f"{name}: no strong pattern"
