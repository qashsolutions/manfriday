"""What risk-to-reward ratio should the exits use? The owner raised the classic 1:3 (Sept 29).

Today's -7%/+12% is a 1:1.7. The convention says risk one unit to make three, so the question is
not "is 3% the right number" but "how far should the target sit relative to the stop, and how
wide should the pair be overall".

Two things are swept together, because they interact:
  * how wide the stop is (how much ordinary noise it tolerates)
  * the ratio of target to stop (how much a winner has to pay for the losers)

The fee is why the width matters at all. A round trip costs 0.75% on Crypto.com and 1.40% on
Coinbase, so a stop narrower than a couple of percent is mostly paying the venue: at a 0.5% stop
the fee is 1.5x to 2.8x the stop itself.

Scored on two windows - the whole history and the most recent third. A change must win on both.
"""
import statistics
import sys
from dataclasses import replace

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
STOPS = [-3.0, -4.0, -5.0, -6.0, -7.0, -9.0]
RATIOS = [1.0, 1.7, 2.0, 3.0]
GB = BASE.rules.giveback_pct

history = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 400:
            history[a] = df
    except Exception as e:
        print(f"  {a}: no history ({e})", file=sys.stderr)


def run(stop: float, take: float):
    s = replace(BASE, rules=replace(BASE.rules, stop_loss_day_pct=stop,
                                    take_profit_day_pct=take, giveback_pct=GB))
    full, recent, trades = [], [], 0
    for a, df in history.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, s, P, a)
                full.append(sim.metrics()["return_pct"])
                trades += len(sim.round_trips)
                recent.append(backtest.run(cls(), df, s, P, a, start=split).metrics()["return_pct"])
            except Exception:
                continue
    if not full:
        return None
    return statistics.median(full), statistics.median(recent), trades


print(f"\n{len(history)} assets, all strategies, give-back held at {GB:.0f}%")
print("each cell: median return over the FULL history / over the RECENT third\n")
print(f"{'stop':>7}" + "".join(f"{'1:' + format(r, '.1f'):>22}" for r in RATIOS))

best = []
for stop in STOPS:
    cells = []
    for ratio in RATIOS:
        take = abs(stop) * ratio
        r = run(stop, take)
        if r is None:
            cells.append(f"{'-':>22}")
            continue
        # float compare: 7.0 * 1.7 is 11.899999..., never exactly 12.0
        is_today = (abs(stop - BASE.rules.stop_loss_day_pct) < 0.01
                    and abs(take - BASE.rules.take_profit_day_pct) < 0.2)
        mark = "*" if is_today else " "
        cells.append(f"{f'+{take:.0f}%':>6}{r[0]:>7.1f}{r[1]:>8.1f}{mark}")
        best.append((r[0], r[1], stop, take, r[2]))
    print(f"{stop:>6.0f}%" + "".join(cells))

cur = next((b for b in best if abs(b[2] - BASE.rules.stop_loss_day_pct) < 0.01
            and abs(b[3] - BASE.rules.take_profit_day_pct) < 0.2), None)
if cur is None:   # today's pair is not on the grid; compare against the closest stop at 1:1.7
    cur = min(best, key=lambda b: abs(b[2] - BASE.rules.stop_loss_day_pct)
              + abs(b[3] - BASE.rules.take_profit_day_pct))
    print(f"\n  today's exact pair is not on the grid; nearest is {cur[2]:.0f}% / +{cur[3]:.0f}%")
print(f"\n  * = today's rule ({cur[2]:.0f}% / +{cur[3]:.0f}%), full {cur[0]:.1f} / recent {cur[1]:.1f}")

winners = [b for b in best if cur and b[0] > cur[0] and b[1] > cur[1]]
print("\nconfigurations that beat today on BOTH windows:")
if winners:
    for b in sorted(winners, key=lambda x: -(x[0] + x[1])):
        print(f"  {b[2]:>3.0f}% / +{b[3]:<5.0f} (1:{b[3] / abs(b[2]):.1f})   "
              f"full {b[0]:+6.1f} ({b[0] - cur[0]:+.1f})   recent {b[1]:+6.1f} ({b[1] - cur[1]:+.1f})   "
              f"trades {b[4]}")
else:
    print("  none - today's rule is not beaten on both windows by any ratio tested")
