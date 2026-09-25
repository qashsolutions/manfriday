"""Does a daily take-profit / stop band beat holding, once fees are paid?

Walks real hourly bars in order. Each day: enter at the first bar, exit the moment the band is
touched, otherwise exit at the day's close. When both bands fall inside one bar we assume the
stop hit first - the pessimistic read, because we cannot see the path inside a bar.
"""
import sys
from collections import defaultdict

import pandas as pd

from highway.config import load_settings
from highway.market import MarketData, asset_class
from highway.venues import rates, venue_for

s = load_settings()
md = MarketData(s)
DAYS = 90


def day_groups(df):
    days = defaultdict(list)
    for ts, r in df.iterrows():
        days[pd.to_datetime(ts, unit="s").strftime("%Y-%m-%d")].append(r)
    return [v for k, v in sorted(days.items()) if len(v) >= 2]


def run(bars, take, stop, fee_pct, flat_daily=True):
    """Compound the daily result. take/stop in %, None = no band."""
    equity = 1.0
    for day in day_groups(bars):
        entry = float(day[0]["open"])
        if entry <= 0:
            continue
        exit_px, hit = None, None
        for bar in day:
            lo, hi = float(bar["low"]), float(bar["high"])
            if stop and lo <= entry * (1 - stop / 100):   # pessimistic: stop checked first
                exit_px, hit = entry * (1 - stop / 100), "stop"
                break
            if take and hi >= entry * (1 + take / 100):
                exit_px, hit = entry * (1 + take / 100), "take"
                break
        if exit_px is None:
            exit_px = float(day[-1]["close"])
        equity *= (exit_px / entry) * (1 - fee_pct / 100)
    return equity


def hold(bars, fee_pct):
    """Buy once, hold, pay fees once."""
    return float(bars["close"].iloc[-1]) / float(bars["open"].iloc[0]) * (1 - fee_pct / 100)


assets = sys.argv[1:] or ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]
rows = []
for a in assets:
    try:
        bars = md.bars(a, 60, __import__("time").time() - DAYS * 86400)
        if bars.empty or len(bars) < 100:
            print(f"{a}: not enough hourly history ({len(bars)})"); continue
    except Exception as e:
        print(f"{a}: {e}"); continue
    maker, taker = rates(s.fees, venue_for(a))
    half_spread = s.fees.equity_half_spread_bps if asset_class(a) == "equity" else 0.0
    fee = (maker + taker + s.fees.slippage_bps / 1e4 + 2 * half_spread / 1e4) * 100
    days = len(day_groups(bars))
    row = {"asset": a, "days": days, "fee%": round(fee, 3), "hold": hold(bars, fee)}
    for take, stop in ((2, 3), (2.5, 3), (3, 3), (3, 5), (2, 2)):
        row[f"+{take}/-{stop}"] = run(bars, take, stop, fee)
    rows.append(row)

df = pd.DataFrame(rows).set_index("asset")
band_cols = [c for c in df.columns if c.startswith("+")]
print(f"\nTotal return over the last {DAYS} days, fees included (1.00 = flat)\n")
out = df[["days", "fee%", "hold"] + band_cols].copy()
for c in ["hold"] + band_cols:
    out[c] = out[c].map(lambda v: f"{(v - 1) * 100:+.1f}%")
print(out.to_string())
print("\nMedian across assets:")
for c in ["hold"] + band_cols:
    print(f"  {c:10} {(df[c].median() - 1) * 100:+7.1f}%")
print(f"\nRound trips a band strategy makes: ~{int(df['days'].median())} per asset in {DAYS} days")
