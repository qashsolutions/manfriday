"""Does the Scout's ranking actually predict which assets make money?

`weights.py` compares weightings against each other. It never asks the prior question: does
*any* of them beat picking at random? That gap surfaced when the per-asset view showed NEAR-USD
had been picked 15 times by 5 of the 6 managers for a net loss - no single trade looked bad, so
nothing flagged it, and the only way to see it was to add the trades up.

Three questions, each with a baseline the Scout has to beat:

1. **Does rank predict return?** Split the ranked universe into five buckets and hold each under
   the live lane rules. If the top bucket does not beat the bottom, the ranking is noise.
2. **Does the top-4 beat a random 4?** The honest baseline, which nothing has tested before.
3. **Do past losers keep losing?** If an asset's last result predicts its next one, a repeat
   offender like NEAR should be benched rather than re-picked.

Judged on the first two thirds of weeks and the last third separately, as everything here is.
"""
import random
import statistics
import sys

import numpy as np
import pandas as pd

from highway.config import load_settings
from highway.db import DB
from highway.market import MarketData
from highway.params import Params
from highway.weights import Week, features_at, load_history, pick, rank_order

random.seed(7)
BUCKETS = 5
TRIALS = 200   # random draws per week, for the coin-flip baseline

s = load_settings()
md = MarketData(s)
params = Params(DB().get_state("params", {}) or {})

print("loading a year of daily bars for the whole universe (a few minutes)...", flush=True)
hist = load_history(md, s)
print(f"  {len(hist)} assets\n", flush=True)

dates = pd.date_range(end=pd.Timestamp.now('UTC').tz_localize(None).normalize() - pd.Timedelta(days=8),
                      periods=48, freq="7D")
weeks = []
for d in dates:
    feats = features_at(hist, d, s)
    if len(feats) >= 20:
        weeks.append(Week(hist, d, feats, s))
if not weeks:
    print("not enough history to judge anything", file=sys.stderr)
    raise SystemExit(1)
print(f"{len(weeks)} rebalance weeks with a ranked universe\n", flush=True)

order_fn = rank_order({k: params[k] for k in ("rank_w_vol", "rank_w_mom30", "rank_w_mom7", "rank_w_dd")})
split = len(weeks) * 2 // 3


def window(rows, lo, hi):
    return [v for i, v in rows if lo <= i < hi]


# ---- 1. does rank predict return? -------------------------------------------------------
bucket_rows: list[tuple[int, list[float]]] = []
top_rows, rand_rows, uni_rows = [], [], []
for i, wk in enumerate(weeks):
    order = order_fn(wk.feats)
    scored = [a for a in order if wk.fwd.get(a) is not None]
    if len(scored) < BUCKETS * 2:
        continue
    edges = np.array_split(np.arange(len(scored)), BUCKETS)
    bucket_rows.append((i, [statistics.mean([wk.fwd[scored[j]] for j in idx]) * 100 for idx in edges]))

    chosen = pick(order, wk, s)
    got = [wk.fwd[a] for a in chosen if wk.fwd.get(a) is not None]
    if got:
        top_rows.append((i, statistics.mean(got) * 100))
    draws = [statistics.mean(random.sample([wk.fwd[a] for a in scored], min(4, len(scored)))) * 100
             for _ in range(TRIALS)]
    rand_rows.append((i, statistics.mean(draws)))
    if wk.universe is not None:
        uni_rows.append((i, wk.universe * 100))

print("1. Does the ranking predict the result? Universe split into five by rank,")
print("   each bucket held for a week under the live lane rules.\n")
print(f"   {'bucket':22}{'ALL mean':>10}{'median':>9} | {'RECENT mean':>13}{'median':>9}")
labels = ["top fifth (what we buy)", "second", "third", "fourth", "bottom fifth"]
means = []
for b in range(BUCKETS):
    allw = [row[b] for _, row in bucket_rows]
    rec = [row[b] for i, row in bucket_rows if i >= split]
    means.append(statistics.mean(allw))
    print(f"   {labels[b]:22}{statistics.mean(allw):>9.2f}%{statistics.median(allw):>8.2f}% | "
          f"{statistics.mean(rec):>12.2f}%{statistics.median(rec):>8.2f}%")
spread = means[0] - means[-1]
print(f"\n   top minus bottom: {spread:+.2f} points a week "
      f"({'the ranking sorts' if spread > 0 else 'THE RANKING DOES NOT SORT'})")

# ---- 2. the coin-flip baseline ----------------------------------------------------------
print("\n2. Does what we actually buy beat four names drawn at random?\n")
print(f"   {'':22}{'ALL mean':>10} | {'RECENT mean':>13}")
for name, rows in (("Scout's top 4", top_rows), (f"random 4 (x{TRIALS})", rand_rows),
                   ("whole universe", uni_rows)):
    if not rows:
        continue
    print(f"   {name:22}{statistics.mean([v for _, v in rows]):>9.2f}% | "
          f"{statistics.mean(window(rows, split, len(weeks))):>12.2f}%")
edge_all = statistics.mean([v for _, v in top_rows]) - statistics.mean([v for _, v in rand_rows])
edge_rec = statistics.mean(window(top_rows, split, len(weeks))) - statistics.mean(window(rand_rows, split, len(weeks)))
verdict = "WINS BOTH" if edge_all > 0 and edge_rec > 0 else "wins one" if edge_all > 0 or edge_rec > 0 else "LOSES BOTH"
print(f"\n   Scout's edge over a coin flip: all {edge_all:+.2f}, recent {edge_rec:+.2f}   {verdict}")

# ---- 3. do past losers keep losing? -----------------------------------------------------
print("\n3. Does an asset's last week predict its next one?")
print("   (if it does, a repeat loser like NEAR should be benched, not re-picked)\n")
pairs = []
for prev, nxt in zip(weeks, weeks[1:]):
    for a, v in prev.fwd.items():
        n = nxt.fwd.get(a)
        if v is not None and n is not None:
            pairs.append((v, n))
if len(pairs) > 50:
    x = np.array([p[0] for p in pairs]), np.array([p[1] for p in pairs])
    r = float(np.corrcoef(x[0], x[1])[0, 1])
    losers = [n for v, n in pairs if v < 0]
    winners = [n for v, n in pairs if v >= 0]
    print(f"   {len(pairs)} asset-weeks")
    print(f"   correlation between this week and next: {r:+.3f}")
    print(f"   after a losing week, next week averages  {statistics.mean(losers) * 100:+.2f}%  ({len(losers)} cases)")
    print(f"   after a winning week, next week averages {statistics.mean(winners) * 100:+.2f}%  ({len(winners)} cases)")
    gap = (statistics.mean(losers) - statistics.mean(winners)) * 100
    print(f"\n   benching last week's losers would have changed the next week by {gap:+.2f} points")
    print("   " + ("a loser does tend to keep losing - worth acting on" if gap < -0.5 else
                   "past result does NOT predict the next one - benching an asset is not supported"))
else:
    print("   not enough overlapping asset-weeks to say")
