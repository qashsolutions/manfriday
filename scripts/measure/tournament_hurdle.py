"""Should a lane's tournament leader have to beat what luck alone would produce?

Every lane crowns the best of ~42 strategy variants and follows it. Bailey & Lopez de Prado's
Minimum Backtest Length says a search that wide needs about 4.9 years of history before the
winner's edge is distinguishable from the search itself; we have months. So "beat zero" is the
wrong bar - the bar is what the luckiest of 42 coin flips would score.

`tournament_hurdle` scales that threshold (0 = today's behaviour). This is the first harness that
replays a real tournament over history rather than a single strategy: it trains priors on the
first two thirds, then steps bar by bar through the last third with a lane that follows whatever
the tournament currently leads, exactly as the engine does.

Scored on two windows - the whole test period and its most recent half. A setting has to win on
both, or it is noise.
"""
import statistics
import sys
import time

from highway import backtest
from highway.config import Settings, bar_minutes_for, load_settings
from highway.market import MarketData
from highway.params import Params
from highway.sim import NEUTRAL_NEWS, LaneSim
from highway.strategies import Decision, Strategy
from highway.tournament import LaneTournament

BASE = load_settings(); md = MarketData(BASE)
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "SUI-USD", "LINK-USD", "MSTR", "GDX"]
CONFIGS = [
    ("off (today)", 0.0),
    ("10% of the luck bar", 0.1),
    ("25% of the luck bar", 0.25),
    ("50% of the luck bar", 0.5),
    ("the full luck bar", 1.0),
]
WINDOW = 400  # trailing bars handed to the tournament each step


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


def priors(df, s: Settings, params: Params, asset: str) -> list[dict]:
    """Walk-forward results from the training window only. Independent of the hurdle, so
    they are computed once per asset and reused across every setting."""
    wfs = backtest.walk_forward(df.iloc[:int(len(df) * 2 / 3)], s, params, asset)
    return [{"strategy": w.strategy, "params": w.params, "test": w.test, "survived": w.survived} for w in wfs]


def replay(df, s: Settings, params: Params, asset: str, bts: list[dict]):
    """Follow the tournament bar by bar through the test window. Returns the lane's metrics."""
    minutes = bar_minutes_for(s, asset)
    bpd = backtest.bars_per_day(asset, minutes)
    bar_seconds = minutes * 60
    if not bts:
        return None, None
    start = int(len(df) * 2 / 3)
    t = LaneTournament.create(1, asset, s, params, bts, now=float(df.index[start]))
    sim = LaneSim(Follower(t), s, params, asset)
    lookup = backtest.PriceLookup(df, bar_seconds)
    raw = df.to_dict("records")
    index = df.index.to_numpy(dtype=float)
    half = (len(df) - start) // 2
    mid_value = None

    for i in range(start, len(df)):
        t.on_bar(df.iloc[max(0, i - WINDOW):i + 1], NEUTRAL_NEWS, params, bpd, bar_seconds, lookup)
        sim.on_bar(index[i], raw[i], lookup, NEUTRAL_NEWS, bar_seconds)
        if i - start == half:
            mid_value = sim.value(raw[i]["close"])
    m = sim.metrics()
    recent = None
    if mid_value:
        recent = 100 * (sim.value(raw[-1]["close"]) / mid_value - 1)
    return m, recent


hist = {}
for a in ASSETS:
    try:
        d = backtest.load_history(md, BASE, a)
        if len(d) > 600:
            hist[a] = d
    except Exception:
        pass

PRIORS = {}
for a, d in hist.items():
    PRIORS[a] = priors(d, BASE, Params(), a)

print(f"\nreplaying a real tournament over {len(hist)} assets, "
      f"~{int(len(next(iter(hist.values()))) / 3)} test bars each, {len(CONFIGS)} settings\n")
print(f"{'setting':22}{'ALL median':>12}{'mean':>9} | {'RECENT median':>15}{'mean':>9}"
      f"{'entries':>9}{'in mkt':>8}{'cash lanes':>12}")
rows = []
for label, k in CONFIGS:
    p = Params({"tournament_hurdle": k, "no_buy_drop_pct": 3.0, "no_buy_drop_hours": 4.0})
    full, rec, entries, in_mkt, idle = [], [], 0, [], 0
    t0 = time.time()
    for a, df in hist.items():
        try:
            m, r = replay(df, BASE, p, a, PRIORS[a])
        except Exception as e:
            print(f"    {a}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if not m:
            continue
        full.append(m["return_pct"])
        in_mkt.append(m["in_market_pct"])
        entries += m["entries"]
        if m["entries"] == 0:
            idle += 1
        if r is not None:
            rec.append(r)
    if not full:
        continue
    r = (label, statistics.median(full), statistics.mean(full),
         statistics.median(rec) if rec else 0.0, statistics.mean(rec) if rec else 0.0,
         entries, statistics.mean(in_mkt), idle)
    rows.append(r)
    print(f"{r[0]:22}{r[1]:>11.1f}%{r[2]:>8.1f}% | {r[3]:>14.1f}%{r[4]:>8.1f}%"
          f"{r[5]:>9}{r[6]:>7.0f}%{r[7]:>9}/{len(hist)}   ({time.time() - t0:.0f}s)")

if rows:
    base = rows[0]
    print("\nagainst today's behaviour - a change must win on BOTH windows:")
    for r in rows[1:]:
        d_all, d_rec = r[1] - base[1], r[3] - base[3]
        verdict = "WINS BOTH" if d_all > 0 and d_rec > 0 else "wins one" if d_all > 0 or d_rec > 0 else "loses both"
        print(f"  {r[0]:22} all {d_all:+6.1f}   recent {d_rec:+6.1f}   "
              f"time in market {r[6] - base[6]:+5.0f}pp   {verdict}")
    print("\n  A hurdle that helps should show up as less time in market and a better median:")
    print("  it is buying fewer of the entries that were only ever selection noise.")
