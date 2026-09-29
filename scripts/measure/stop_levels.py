"""How tight should the stop-loss be? The owner asked for 3% instead of 7% (Sept 29).

Everything else is held fixed - the +12% profit ceiling and the 20% give-back do not move - so
the only thing changing is how far the stop sits from the entry. That matters because for a
tranche bought inside the last 24 hours `risk.day_change` measures against the *purchase price*,
so the stop is literally "this far below what we paid".

The number to watch is not just the return. A stop only carries information if it is wider than
the asset's ordinary daily noise: NEAR-USD has a 6.93% daily standard deviation, so a 7% stop is
already 1.0 sd away and a 3% stop would be 0.43 sd - a level ordinary wobble crosses most days.
The `stops` column shows how often each level fires; a level that fires constantly is selling on
noise, whatever its headline return looks like.

Scored on two windows - the whole history and the most recent third. A change has to win on
both, or it is noise.
"""
import statistics
import sys
from dataclasses import replace

import numpy as np

from highway import backtest
from highway.config import load_settings
from highway.db import DB
from highway.market import MarketData
from highway.params import Params
from highway.strategies import STRATEGIES

BASE = load_settings()
md = MarketData(BASE)
P = Params(DB().load_params())
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "SUI-USD", "LINK-USD",
          "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]
TAKE = BASE.rules.take_profit_day_pct
GB = BASE.rules.giveback_pct
# (stop, take) pairs. The owner asked for -1/+3 on Sept 29; it is measured here against today's
# rule and against the neighbours, so the choice is made on numbers rather than on feel.
PAIRS = [(-1.0, 3.0), (-1.0, 5.0), (-2.0, 3.0), (-3.0, 3.0), (-3.0, 6.0),
         (-3.0, 12.0), (-5.0, 12.0), (-7.0, 12.0), (-7.0, 6.0)]

history = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 400:
            history[a] = df
    except Exception as e:
        print(f"  {a}: no history ({e})", file=sys.stderr)

# How far each level sits from each asset's ordinary daily move, which is what decides whether
# the stop is a signal or just noise.
sd = {}
for a, df in history.items():
    r = np.diff(np.log(df["close"].to_numpy()))
    step = max(1, len(r) // max(1, int((df.index[-1] - df.index[0]) / 86400)))
    daily = np.add.reduceat(r, np.arange(0, len(r), step))[:-1]
    if len(daily) > 10:
        sd[a] = float(daily.std()) * 100

print(f"\n{len(history)} assets · profit ceiling held at +{TAKE:.0f}% · give-back held at {GB:.0f}%")
print(f"median daily move across them: {statistics.median(sd.values()):.1f}%\n")
print(f"{'rule':>12}{'stop in sd':>12}{'ALL median':>12}{'mean':>9} | "
      f"{'RECENT median':>15}{'mean':>9}{'trades':>8}{'stops':>7}{'takes':>7}")

rows = []
for lvl, take in PAIRS:
    s = replace(BASE, rules=replace(BASE.rules, stop_loss_day_pct=lvl,
                                    take_profit_day_pct=take, giveback_pct=GB))
    full, recent, trades, stops, takes = [], [], 0, 0, 0
    for a, df in history.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, s, P, a)
                full.append(sim.metrics()["return_pct"])
                trades += len(sim.round_trips)
                stops += sim.counts.get("stop_day", 0)
                takes += sim.counts.get("take_profit_day", 0)
                recent.append(backtest.run(cls(), df, s, P, a, start=split).metrics()["return_pct"])
            except Exception:
                continue
    if not full:
        continue
    in_sd = abs(lvl) / statistics.median(sd.values())
    row = ((lvl, take), in_sd, statistics.median(full), statistics.mean(full),
           statistics.median(recent), statistics.mean(recent), trades, stops, takes)
    rows.append(row)
    label = f"{lvl:.0f}/+{take:.0f}"
    mark = "  <- today" if (lvl, take) == (BASE.rules.stop_loss_day_pct, TAKE) else ""
    print(f"{label:>12}{in_sd:>12.2f}{row[2]:>11.1f}%{row[3]:>8.1f}% | "
          f"{row[4]:>14.1f}%{row[5]:>8.1f}%{row[6]:>8}{row[7]:>7}{row[8]:>7}{mark}")

base = next(r for r in rows if r[0] == (BASE.rules.stop_loss_day_pct, TAKE))
print(f"\nagainst today's {base[0][0]:.0f}/+{base[0][1]:.0f} - a change must win on BOTH windows:")
for r in rows:
    if r[0] == base[0]:
        continue
    d_all, d_rec = r[2] - base[2], r[4] - base[4]
    verdict = ("WINS BOTH" if d_all > 0 and d_rec > 0 else
               "wins one" if d_all > 0 or d_rec > 0 else "loses both")
    print(f"  {r[0][0]:>3.0f}/+{r[0][1]:<3.0f}  all {d_all:+7.1f}   recent {d_rec:+7.1f}   "
          f"stops {r[7] - base[7]:+6}   trades {r[6] - base[6]:+6}   {verdict}")

print("\n  A stop tighter than about 1 daily standard deviation is crossed by ordinary")
print("  movement, so it sells on noise rather than on information. Watch the stops column:")
print("  if it climbs steeply as the stop tightens, that is what is happening.")
