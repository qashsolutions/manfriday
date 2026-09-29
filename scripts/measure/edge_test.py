"""Does the machinery beat simply holding the assets it picked?

This is a premise check, not a tuning knob. It proposes no change. It asks whether the Scout ->
tournament -> strategy -> exit-rules pipeline adds anything over buying the same asset and
sitting on it, under the same hard rules and the same fees.

It should have been the first thing measured. Sixteen harnesses have tuned pieces of this
pipeline; none asked whether the pipeline has an edge to tune.

DECISION RULE, fixed before the numbers were seen (Sept 29):

  * If the tournament-following lane beats buy-and-hold on both windows, the design is sound,
    the tuning was legitimate, and work resumes after the Week 1 review from a ranked list.
  * If it does not, stop tuning exits. No stop level rescues an entry signal with no edge;
    the conversation moves to the entry side, or to retiring the tournament.
  * Either way the 12-15%/month target gets revisited, because nothing measured so far has
    reached it (`bands_vs_drawdown`, `tight_bands_monthly`, `risk_reward` all agree).

"Buy and hold" here is the Hold strategy running under the SAME lane rules - same stops, same
give-back, same fees. That isolates the strategy's timing rather than flattering it by removing
the risk rules from one side of the comparison. The raw price change is shown too, as context
for how much the hard rules themselves cost or save.
"""
import statistics
import sys

from highway import backtest
from highway.config import Settings, bar_minutes_for, load_settings
from highway.db import DB
from highway.market import MarketData
from highway.params import Params
from highway.sim import NEUTRAL_NEWS, LaneSim
from highway.strategies import Decision, Hold, Strategy
from highway.tournament import LaneTournament

BASE = load_settings()
md = MarketData(BASE)
P = Params(DB().load_params())
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "SUI-USD", "LINK-USD",
          "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]
WINDOW = 400


class Follower(Strategy):
    """A lane that does whatever the tournament currently leads. What the real money does."""

    name = "Follower"

    def __init__(self, t: LaneTournament):
        super().__init__()
        self.t = t

    def warmup_bars(self, bars_per_day: int) -> int:
        return 0

    def decide(self, row, clips, state, news) -> Decision:
        return self.t.target()


def tournament_return(df, s: Settings, params: Params, asset: str) -> float | None:
    """Train priors on the first two thirds, then follow the leader bar by bar through the rest."""
    minutes = bar_minutes_for(s, asset)
    bpd = backtest.bars_per_day(asset, minutes)
    bar_seconds = minutes * 60
    split = int(len(df) * 2 / 3)
    wfs = backtest.walk_forward(df.iloc[:split], s, params, asset)
    bts = [{"strategy": w.strategy, "params": w.params, "test": w.test, "survived": w.survived}
           for w in wfs]
    if not bts:
        return None
    t = LaneTournament.create(1, asset, s, params, bts, now=float(df.index[split]))
    sim = LaneSim(Follower(t), s, params, asset)
    lookup = backtest.PriceLookup(df, bar_seconds)
    raw = df.to_dict("records")
    index = df.index.to_numpy(dtype=float)
    for i in range(split, len(df)):
        t.on_bar(df.iloc[max(0, i - WINDOW):i + 1], NEUTRAL_NEWS, params, bpd, bar_seconds, lookup)
        sim.on_bar(index[i], raw[i], lookup, NEUTRAL_NEWS, bar_seconds)
    return sim.metrics()["return_pct"]


history = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 600:
            history[a] = df
    except Exception as e:
        print(f"  {a}: no history ({e})", file=sys.stderr)

print(f"\n{len(history)} assets · the test window is the last third of each one's history\n")
print(f"{'asset':12}{'tournament':>12}{'buy & hold':>12}{'difference':>12}{'price alone':>13}")

rows = []
for a, df in history.items():
    split = int(len(df) * 2 / 3)
    try:
        tour = tournament_return(df, BASE, P, a)
        hold = backtest.run(Hold(), df, BASE, P, a, start=split).metrics()["return_pct"]
    except Exception as e:
        print(f"{a:12}  failed: {type(e).__name__}: {e}", file=sys.stderr)
        continue
    if tour is None:
        continue
    px = (float(df["close"].iloc[-1]) / float(df["close"].iloc[split]) - 1) * 100
    rows.append((a, tour, hold, tour - hold, px))
    print(f"{a:12}{tour:>11.1f}%{hold:>11.1f}%{tour - hold:>11.1f}%{px:>12.1f}%")

if not rows:
    print("\nnothing ran", file=sys.stderr)
    raise SystemExit(1)

diffs = [r[3] for r in rows]
wins = sum(1 for d in diffs if d > 0)
print(f"\n  tournament median {statistics.median([r[1] for r in rows]):+.1f}%   "
      f"buy & hold median {statistics.median([r[2] for r in rows]):+.1f}%")
print(f"  median difference {statistics.median(diffs):+.1f} points   "
      f"mean {statistics.mean(diffs):+.1f}")
print(f"  the tournament beat buy-and-hold on {wins} of {len(rows)} assets")

# A paired t-test on the differences: with a dozen assets the median alone is easy to over-read.
if len(diffs) >= 3:
    m = statistics.mean(diffs)
    sd = statistics.stdev(diffs)
    t_stat = m / (sd / len(diffs) ** 0.5) if sd else 0.0
    print(f"  paired t-statistic {t_stat:+.2f} on {len(diffs) - 1} degrees of freedom "
          f"({'not ' if abs(t_stat) < 2.2 else ''}significant at the 5% level)")

print("\n  Decision rule, fixed in advance:")
print("    beats on both windows -> design sound, resume tuning from a ranked list after Week 1")
print("    does not             -> stop tuning exits; the entry side is the problem")
