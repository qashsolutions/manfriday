"""Focused follow-up: is the give-back stop the wrong LEVEL or the wrong IDEA, and does the
tighter stop survive out-of-sample? Each config is scored twice - over the whole history, and
over the most recent third alone, which no choice here was made on."""
import statistics
from dataclasses import replace

from highway import backtest
from highway.config import load_settings
from highway.market import MarketData
from highway.params import Params
from highway.strategies import STRATEGIES

BASE = load_settings()
md = MarketData(BASE)
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]

CONFIGS = [
    ("current   -10/+15, gb 12", -10.0, 15.0, 12.0),
    ("gb off    -10/+15",        -10.0, 15.0,  0.0),
    ("gb 16     -10/+15",        -10.0, 15.0, 16.0),
    ("gb 20     -10/+15",        -10.0, 15.0, 20.0),
    ("gb 25     -10/+15",        -10.0, 15.0, 25.0),
    ("stop -5   -5/+15, gb off",  -5.0, 15.0,  0.0),
    ("stop -5   -5/+15, gb 12",   -5.0, 15.0, 12.0),
    ("stop -5   -5/+15, gb 20",   -5.0, 15.0, 20.0),
    ("stop -7   -7/+15, gb off",  -7.0, 15.0,  0.0),
]

history = {a: backtest.load_history(md, BASE, a) for a in ASSETS}
p = Params()
print(f"\n{'config':28} {'ALL median':>11} {'mean':>8} | {'RECENT 3rd med':>15} {'mean':>8} {'trades':>7} {'gb':>5}")
rows = []
for label, stop, take, gb in CONFIGS:
    s = replace(BASE, rules=replace(BASE.rules, stop_loss_day_pct=stop, take_profit_day_pct=take, giveback_pct=gb))
    full, recent, trades, gbs = [], [], 0, 0
    for a, df in history.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, s, p, a)
                full.append(sim.metrics()["return_pct"])
                trades += len(sim.round_trips)
                gbs += sim.counts.get("giveback", 0)
                recent.append(backtest.run(cls(), df, s, p, a, start=split).metrics()["return_pct"])
            except Exception:
                continue
    rows.append((label, statistics.median(full), statistics.mean(full),
                 statistics.median(recent), statistics.mean(recent), trades, gbs))
    r = rows[-1]
    print(f"{r[0]:28} {r[1]:+10.1f}% {r[2]:+7.1f}% | {r[3]:+14.1f}% {r[4]:+7.1f}% {r[5]:>7} {r[6]:>5}")

base = rows[0]
print(f"\nvs current, on BOTH windows (a change must win twice to count):")
for r in rows[1:]:
    d_all, d_rec = r[1] - base[1], r[3] - base[3]
    verdict = "WINS BOTH" if d_all > 0 and d_rec > 0 else "wins one" if d_all > 0 or d_rec > 0 else "loses both"
    print(f"  {r[0]:28} all {d_all:+6.1f}   recent {d_rec:+6.1f}   {verdict}")
