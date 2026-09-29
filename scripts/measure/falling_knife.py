"""Should we refuse to buy an asset that has just fallen sharply?

The pattern that prompted this: five trades were bought and stopped out within hours for an
average of -10%, against -1.1% for every other trade. The stale-decision check already refuses a
buy whose *decision* has aged; this asks whether a fresh decision on a falling asset should also
be refused.

Scored on two windows - the whole history and the most recent third. A setting has to win on
both, or it is noise.
"""
import statistics
from dataclasses import replace

from highway import backtest
from highway.config import load_settings
from highway.market import MarketData
from highway.params import Params
from highway.strategies import STRATEGIES

BASE = load_settings(); md = MarketData(BASE)
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "SUI-USD", "LINK-USD",
          "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]
CONFIGS = [
    ("off (today's behaviour)", 0.0, 4.0),
    ("block if -3% in 4h", 3.0, 4.0),
    ("block if -5% in 4h", 5.0, 4.0),
    ("block if -8% in 4h", 8.0, 4.0),
    ("block if -5% in 8h", 5.0, 8.0),
    ("block if -10% in 24h", 10.0, 24.0),
]

hist = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 400:
            hist[a] = df
    except Exception:
        pass

print(f"\n{len(hist)} assets\n")
print(f"{'setting':26}{'ALL median':>12}{'mean':>9} | {'RECENT median':>15}{'mean':>9}{'trades':>8}{'blocked':>9}")
rows = []
for label, drop, hours in CONFIGS:
    p = Params({"no_buy_drop_pct": drop, "no_buy_drop_hours": hours})
    full, recent, trades, blocked = [], [], 0, 0
    for a, df in hist.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, BASE, p, a)
                full.append(sim.metrics()["return_pct"])
                trades += len(sim.round_trips)
                blocked += sim.counts.get("falling_knife", 0)
                recent.append(backtest.run(cls(), df, BASE, p, a, start=split).metrics()["return_pct"])
            except Exception:
                continue
    if not full:
        continue
    r = (label, statistics.median(full), statistics.mean(full),
         statistics.median(recent), statistics.mean(recent), trades, blocked)
    rows.append(r)
    print(f"{r[0]:26}{r[1]:>11.1f}%{r[2]:>8.1f}% | {r[3]:>14.1f}%{r[4]:>8.1f}%{r[5]:>8}{r[6]:>9}")

base = rows[0]
print(f"\nagainst today's behaviour - a change must win on BOTH windows:")
for r in rows[1:]:
    d_all, d_rec = r[1] - base[1], r[3] - base[3]
    verdict = "WINS BOTH" if d_all > 0 and d_rec > 0 else "wins one" if d_all > 0 or d_rec > 0 else "loses both"
    print(f"  {r[0]:26} all {d_all:+6.1f}   recent {d_rec:+6.1f}   {verdict}")
