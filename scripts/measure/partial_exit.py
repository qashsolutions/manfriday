"""Should a lane take half off the table on the way up, and let the rest run?

The owner's idea (Sept 29): recover some principal early rather than riding every position all
the way to the full target or all the way to the stop. A lane holds up to two $50 clips, so
"half" is naturally one clip.

This is not an exit. The position stays open, keeps its stop and its give-back, and can still
reach the full target with what is left. What it changes is the shape of the outcome: more
small realised gains, smaller losses when the stop eventually fires, and a lower ceiling on the
big winners - because only half the position is still there to enjoy them.

That last part is the real question. Selling half a winner costs you half of every large move,
and large moves are where the month's return comes from. Whether the trade is worth making is
what this measures.

Scored on two windows - the whole history and the most recent third - and at today's rule as
well as at the wider 1:3 pairs the ratio sweep prefers, since the two interact.
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
LIVE = Params(DB().load_params())
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "SUI-USD", "LINK-USD",
          "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]
RULES = [
    ("today  -7/+12", -7.0, 12.0),
    ("1:2    -7/+14", -7.0, 14.0),
    ("1:3    -6/+18", -6.0, 18.0),
    ("1:3    -7/+21", -7.0, 21.0),
]
TAKE_HALF_AT = [0.0, 3.0, 4.0, 5.0, 6.0, 8.0]

history = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 400:
            history[a] = df
    except Exception as e:
        print(f"  {a}: no history ({e})", file=sys.stderr)


def run(stop: float, take: float, half_at: float):
    s = replace(BASE, rules=replace(BASE.rules, stop_loss_day_pct=stop, take_profit_day_pct=take))
    p = Params({**LIVE.as_dict(), "partial_take_pct": half_at})
    full, recent, partials, trades = [], [], 0, 0
    for a, df in history.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, s, p, a)
                full.append(sim.metrics()["return_pct"])
                partials += sim.counts.get("partial_take", 0)
                trades += len(sim.round_trips)
                recent.append(backtest.run(cls(), df, s, p, a, start=split).metrics()["return_pct"])
            except Exception:
                continue
    if not full:
        return None
    return (statistics.median(full), statistics.mean(full),
            statistics.median(recent), statistics.mean(recent), partials, trades)


print(f"\n{len(history)} assets, all strategies, give-back held at {BASE.rules.giveback_pct:.0f}%")
print("each cell: median return over the FULL history / over the RECENT third\n")
print(f"{'sell half at':>14}" + "".join(f"{name:>22}" for name, _, _ in RULES))

grid = {}
for half_at in TAKE_HALF_AT:
    cells = []
    for name, stop, take in RULES:
        r = run(stop, take, half_at)
        grid[(half_at, name)] = r
        cells.append(f"{'-':>22}" if r is None else f"{r[0]:>12.1f}{r[2]:>10.1f}")
    label = "off" if not half_at else f"+{half_at:.0f}%"
    print(f"{label:>14}" + "".join(cells))

print("\nagainst not doing it at all, within each rule - must win on BOTH windows:")
for name, _, _ in RULES:
    base = grid[(0.0, name)]
    if not base:
        continue
    print(f"\n  {name}   (off: full {base[0]:+.1f}, recent {base[2]:+.1f})")
    for half_at in TAKE_HALF_AT[1:]:
        r = grid[(half_at, name)]
        if not r:
            continue
        d_all, d_rec = r[0] - base[0], r[2] - base[2]
        verdict = ("WINS BOTH" if d_all > 0 and d_rec > 0 else
                   "wins one" if d_all > 0 or d_rec > 0 else "loses both")
        print(f"    half at +{half_at:<4.0f} all {d_all:+7.1f}   recent {d_rec:+7.1f}   "
              f"{r[4]:>5} partial sales   {verdict}")

print("\n  Selling half a winner costs half of every large move. If the partial column never")
print("  wins both windows, the small early gains are not paying for that lost upside.")
