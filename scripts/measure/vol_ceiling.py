"""Should the Scout refuse assets whose ordinary daily move is wider than the stop?

The chain this is meant to cut: the monthly target demands movement, the ranking's largest
weight is volatility, volatility means crypto, and crypto's volatility is exactly why a 6% stop
fires on noise. NEAR-USD has a 6.93% daily standard deviation, so a 6% stop is 0.87 sd away -
ordinary wobble crosses it most days, and we were stopped out of it eleven times while the
asset rose 150%.

The ceiling is expressed in standard deviations rather than as a raw volatility number, so it
keeps meaning the same thing if the stop ever moves again: *the stop must sit at least N daily
standard deviations from the entry, or we do not buy the asset at all*.

Measured the way `weights.py` measures a ranking change: every week, rank the universe on data
available that day, apply the ceiling, buy the top four under the lane rules, hold a week. The
cost is real and has to show up - a ceiling removes the most volatile names, and volatility is
where the monthly target was supposed to come from.
"""
import math
import statistics
import sys

import pandas as pd

from highway.config import load_settings
from highway.db import DB
from highway.market import MarketData, asset_class
from highway.params import Params
from highway.weights import Week, features_at, load_history, pick, rank_order

BASE = load_settings()
md = MarketData(BASE)
P = Params(DB().load_params())
STOP = abs(BASE.rules.stop_loss_day_pct)
CEILINGS = [0.0, 1.0, 1.25, 1.5, 2.0, 2.5]   # 0 = today, no ceiling


def stop_in_sd(row) -> float:
    """How many of this asset's ordinary daily moves the stop is away from the entry."""
    periods = 30 if row["class"] == "crypto" else 21
    daily_sd = row["monthly_vol"] * 100 / math.sqrt(periods)
    return STOP / daily_sd if daily_sd > 0 else 99.0


print("loading a year of daily bars for the whole universe (a few minutes)...", flush=True)
hist = load_history(md, BASE)
print(f"  {len(hist)} assets\n", flush=True)

dates = pd.date_range(end=pd.Timestamp.now("UTC").tz_localize(None).normalize() - pd.Timedelta(days=8),
                      periods=48, freq="7D")
weeks = []
for d in dates:
    feats = features_at(hist, d, BASE)
    if len(feats) >= 20:
        weeks.append(Week(hist, d, feats, BASE))
if not weeks:
    print("not enough history", file=sys.stderr)
    raise SystemExit(1)
split = len(weeks) * 2 // 3
order_fn = rank_order({k: P[k] for k in ("rank_w_vol", "rank_w_mom30", "rank_w_mom7", "rank_w_dd")})
print(f"{len(weeks)} rebalance weeks · stop {STOP:.0f}% · {len(weeks) - split} weeks held out\n")

print(f"{'ceiling':>10}{'ALL mean':>11}{'median':>9} | {'RECENT mean':>13}{'median':>9}"
      f"{'crypto share':>14}{'universe left':>15}")
rows = []
for ceiling in CEILINGS:
    per_week, kept_share, crypto_share = [], [], []
    for wk in weeks:
        feats = wk.feats
        if ceiling:
            keep = feats[feats.apply(stop_in_sd, axis=1) >= ceiling]
        else:
            keep = feats
        if keep.empty:
            per_week.append(0.0)           # nothing passed: the week sits in cash
            kept_share.append(0.0)
            continue
        kept_share.append(len(keep) / len(feats))
        chosen = pick(order_fn(keep), wk, BASE)
        got = [wk.fwd[a] for a in chosen if wk.fwd.get(a) is not None]
        per_week.append(statistics.mean(got) * 100 if got else 0.0)
        if chosen:
            crypto_share.append(sum(1 for a in chosen if asset_class(a) == "crypto") / len(chosen))
    full = per_week
    recent = per_week[split:]
    row = (ceiling, statistics.mean(full), statistics.median(full),
           statistics.mean(recent), statistics.median(recent),
           statistics.mean(crypto_share) * 100 if crypto_share else 0.0,
           statistics.mean(kept_share) * 100 if kept_share else 0.0)
    rows.append(row)
    label = "off" if not ceiling else f"{ceiling:.2f} sd"
    print(f"{label:>10}{row[1]:>10.2f}%{row[2]:>8.2f}% | {row[3]:>12.2f}%{row[4]:>8.2f}%"
          f"{row[5]:>13.0f}%{row[6]:>14.0f}%")

base = rows[0]
print(f"\nagainst no ceiling - a change must win on BOTH windows:")
for r in rows[1:]:
    d_all, d_rec = r[1] - base[1], r[3] - base[3]
    verdict = ("WINS BOTH" if d_all > 0 and d_rec > 0 else
               "wins one" if d_all > 0 or d_rec > 0 else "loses both")
    print(f"  {r[0]:.2f} sd   all {d_all:+6.2f}   recent {d_rec:+6.2f}   "
          f"crypto {r[5] - base[5]:+4.0f}pp   universe {r[6] - base[6]:+4.0f}pp   {verdict}")

print("\n  The trade-off to watch: a ceiling should cut the crypto share and shrink the")
print("  universe. If returns hold up while both fall, it is removing noise, not opportunity.")
