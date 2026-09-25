"""US stock market hours and settlement dates. Crypto trades 24/7 and needs none of this."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
OPEN, CLOSE, EARLY_CLOSE = time(9, 30), time(16, 0), time(13, 0)

# NYSE full-day closures.
HOLIDAYS = {
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3), date(2026, 5, 25),
    date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7), date(2026, 11, 26), date(2026, 12, 25),
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26), date(2027, 5, 31),
    date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6), date(2027, 11, 25), date(2027, 12, 24),
}
EARLY_CLOSES = {date(2026, 11, 27), date(2026, 12, 24), date(2027, 11, 26)}


def is_business_day(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS


def equity_market_open(ts: float) -> bool:
    now = datetime.fromtimestamp(ts, NY)
    if not is_business_day(now.date()):
        return False
    close = EARLY_CLOSE if now.date() in EARLY_CLOSES else CLOSE
    return OPEN <= now.time() < close


def session_close(ts: float) -> time:
    """16:00, or 13:00 on the half-days before Thanksgiving and Christmas."""
    return EARLY_CLOSE if datetime.fromtimestamp(ts, NY).date() in EARLY_CLOSES else CLOSE


def minutes_to_close(ts: float) -> float | None:
    """Minutes left in the US session, or None when it is shut."""
    if not equity_market_open(ts):
        return None
    now = datetime.fromtimestamp(ts, NY)
    close = session_close(ts)
    return (close.hour * 60 + close.minute) - (now.hour * 60 + now.minute)


def minutes_since_open(ts: float) -> float | None:
    if not equity_market_open(ts):
        return None
    now = datetime.fromtimestamp(ts, NY)
    return (now.hour * 60 + now.minute) - (OPEN.hour * 60 + OPEN.minute)


def next_business_day(d: date) -> date:
    d += timedelta(days=1)
    while not is_business_day(d):
        d += timedelta(days=1)
    return d


def settles_at(asset_class: str, ts: float, crypto_hours: float, equity_business_days: int) -> float:
    """When sale proceeds become usable again."""
    if asset_class == "crypto":
        return ts + crypto_hours * 3600
    local = datetime.fromtimestamp(ts, NY)
    d = local.date()
    for _ in range(equity_business_days):
        d = next_business_day(d)
    # Funds are usable from the next session's open.
    return datetime.combine(d, OPEN, NY).astimezone(timezone.utc).timestamp()
