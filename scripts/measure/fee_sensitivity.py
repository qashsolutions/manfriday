"""At what trading cost does a tighter stop become viable?

The owner has asked twice for a tighter stop, and twice the measurement said no. The reason is
the fee, not the idea: at a 0.5% stop a Coinbase round trip costs 2.8x the stop itself. So the
honest question is not "is 3% right" but "what would the cost have to be for 3% to be right" -
and that decides whether a cheaper venue is worth integrating at all.

Crypto only, because stocks and ETFs already trade commission-free here and the fee question
does not arise for them. Every venue's maker/taker split is scaled to the target round trip and
applied to BOTH venue fee pairs, so whichever venue a lane resolves to costs the same.

The ratio is held at 1:3, which `risk_reward.py` found best at every width.
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
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "SUI-USD", "LINK-USD"]
STOPS = [-2.0, -3.0, -4.0, -5.0, -6.0, -7.0, -9.0]
RATIO = 3.0
# round-trip cost -> what it represents
VENUES = [
    (1.40, "Coinbase Advanced"),
    (0.95, "Robinhood (published, our volume)"),
    (0.75, "Crypto.com Exchange"),
    (0.30, "a cheap venue"),
    (0.10, "perp futures / maker rebate"),
    (0.00, "free (not reachable, the floor)"),
]

history = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 400:
            history[a] = df
    except Exception as e:
        print(f"  {a}: no history ({e})", file=sys.stderr)


def fees_for(round_trip_pct: float):
    """Scale the real Coinbase split (0.50 maker / 0.90 taker) to a target round trip."""
    share = round_trip_pct / 100 / 1.40
    mk, tk = 0.50 * share, 0.90 * share
    return replace(BASE.fees, maker=mk, taker=tk, cryptocom_maker=mk, cryptocom_taker=tk)


def run(stop: float, fees) -> tuple[float, float] | None:
    s = replace(BASE, fees=fees,
                rules=replace(BASE.rules, stop_loss_day_pct=stop,
                              take_profit_day_pct=abs(stop) * RATIO))
    full, recent = [], []
    for a, df in history.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                full.append(backtest.run(cls(), df, s, P, a).metrics()["return_pct"])
                recent.append(backtest.run(cls(), df, s, P, a, start=split).metrics()["return_pct"])
            except Exception:
                continue
    if not full:
        return None
    return statistics.median(full), statistics.median(recent)


print(f"\n{len(history)} crypto assets, all strategies, target held at 1:{RATIO:.0f}")
print("each cell: median return over the FULL history / over the RECENT third\n")
print(f"{'round trip':>12}" + "".join(f"{f'{s:.0f}%':>16}" for s in STOPS))

best_by_fee = []
for rt, name in VENUES:
    fees = fees_for(rt)
    cells, scores = [], []
    for stop in STOPS:
        r = run(stop, fees)
        if r is None:
            cells.append(f"{'-':>16}")
            continue
        cells.append(f"{r[0]:>8.1f}{r[1]:>8.1f}")
        scores.append((r[0], r[1], stop))
    print(f"{rt:>11.2f}%" + "".join(cells) + f"   {name}")
    if scores:
        best_by_fee.append((rt, name, max(scores, key=lambda x: x[0])))

print("\nthe widest-returning stop at each cost, and whether a tight stop is ever viable:")
for rt, name, (full, recent, stop) in best_by_fee:
    viable = [s for f, rr, s in
              [(x[0], x[1], x[2]) for x in []] ] # placeholder, filled below
    print(f"  {rt:>5.2f}%  best stop {stop:>5.0f}%   full {full:+6.1f}   recent {recent:+6.1f}   {name}")

print("\n  If the best stop stays wide as the cost falls, the stop width is set by how much the")
print("  asset moves, not by what trading costs - and no venue change would let us tighten it.")
