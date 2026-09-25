"""Is the Momentum manager buying after the move - and would more indicators help?

Walks real daily history. At each day it ranks the coins exactly as the live rule does, takes
what it would have bought, and measures what happened NEXT. A rule that chases tops shows
negative forward returns; a rule with edge shows positive ones against the same-day average.
"""
import statistics
import sys
import time

import numpy as np
import pandas as pd

from highway.config import load_settings
from highway.market import MarketData

s = load_settings(); md = MarketData(s)
COINS = ["BTC-USD", "ETH-USD", "SOL-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "BCH-USD", "LTC-USD",
         "AVAX-USD", "DOGE-USD", "LINK-USD", "XRP-USD", "ADA-USD", "DOT-USD", "ATOM-USD", "SUI-USD"]
DAYS = 540

bars = {}
for a in COINS:
    try:
        df = md.bars(a, 1440, time.time() - DAYS * 86400)
        if len(df) > 120:
            df.index = pd.to_datetime(df.index, unit="s").normalize()
            bars[a] = df[~df.index.duplicated(keep="last")]
    except Exception:
        pass
print(f"{len(bars)} coins with usable daily history\n", file=sys.stderr)

close = pd.DataFrame({a: b["close"] for a, b in bars.items()}).sort_index().dropna(how="all")
vol = pd.DataFrame({a: b["volume"] for a, b in bars.items()}).reindex(close.index)
mom30 = close.pct_change(30)
mom7 = close.pct_change(7)
sma20 = close.rolling(20).mean()
volma = vol.rolling(20).mean()
delta = close.diff()
gain = delta.clip(lower=0).rolling(14).mean()
loss = (-delta.clip(upper=0)).rolling(14).mean()
rsi = 100 - 100 / (1 + gain / loss.replace(0, np.nan))

def forward(h):
    return close.shift(-h) / close - 1

RULES = {
    "live rule (0.6*30d + 0.4*7d)": lambda d: (0.6 * mom30.loc[d] + 0.4 * mom7.loc[d]).where(
        (close.loc[d] > sma20.loc[d]) & (mom7.loc[d] > 0)),
    "30d only":                     lambda d: mom30.loc[d].where((close.loc[d] > sma20.loc[d]) & (mom7.loc[d] > 0)),
    "7d only":                      lambda d: mom7.loc[d].where((close.loc[d] > sma20.loc[d]) & (mom7.loc[d] > 0)),
    "+ not overbought (RSI<70)":    lambda d: (0.6 * mom30.loc[d] + 0.4 * mom7.loc[d]).where(
        (close.loc[d] > sma20.loc[d]) & (mom7.loc[d] > 0) & (rsi.loc[d] < 70)),
    "+ volume confirms (>1.2x)":    lambda d: (0.6 * mom30.loc[d] + 0.4 * mom7.loc[d]).where(
        (close.loc[d] > sma20.loc[d]) & (mom7.loc[d] > 0) & (vol.loc[d] > 1.2 * volma.loc[d])),
    "strong 30d, cooling 7d":       lambda d: mom30.loc[d].where(
        (close.loc[d] > sma20.loc[d]) & (mom7.loc[d] > 0) & (mom7.loc[d] < mom30.loc[d] / 4)),
}
HOR = [1, 3, 7, 14]
fwd = {h: forward(h) for h in HOR}
days = close.index[40:-15]

print(f"{'rule':30}" + "".join(f"{'+' + str(h) + 'd':>9}" for h in HOR) + f"{'picks':>8}")
print(f"{'':30}" + "".join(f"{'':>9}" for h in HOR) + f"{'':>8}")
base = {h: [] for h in HOR}
for d in days:
    for h in HOR:
        row = fwd[h].loc[d].dropna()
        if len(row):
            base[h].append(row.mean())

rows = []
for name, fn in RULES.items():
    got = {h: [] for h in HOR}
    n = 0
    for d in days:
        sc = fn(d).dropna()
        if len(sc) < 4:
            continue
        top = sc.nlargest(4).index
        n += len(top)
        for h in HOR:
            r = fwd[h].loc[d, top].dropna()
            if len(r):
                got[h].append(r.mean())
    line = f"{name:30}" + "".join(f"{statistics.mean(got[h]) * 100:>8.2f}%" if got[h] else f"{'-':>9}" for h in HOR)
    print(line + f"{n:>8}")
    rows.append((name, {h: statistics.mean(got[h]) if got[h] else 0 for h in HOR}))

print(f"\n{'the average coin, same days':30}" + "".join(f"{statistics.mean(base[h]) * 100:>8.2f}%" for h in HOR))
print("\nedge over simply holding the average coin:")
for name, g in rows:
    print(f"  {name:30}" + "".join(f"{(g[h] - statistics.mean(base[h])) * 100:>+8.2f}%" for h in HOR))
