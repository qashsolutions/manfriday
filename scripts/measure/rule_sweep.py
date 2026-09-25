"""Measure two things on real history, with the real strategies and real fees:

  1. the stop / take-profit levels  - is -5%/+5% better than -10%/+15%?
  2. the two re-entry brakes        - a minimum hold time, and a cooldown after a plain exit

Every config runs the SAME assets and the SAME strategies over the SAME bars. Only the rule
changes, so the difference is the rule.
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
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]

CONFIGS = [
    ("current  -10/+15, gb 12",   dict(stop=-10.0, take=15.0, gb=12.0)),
    ("bands    -5/+5",            dict(stop=-5.0,  take=5.0,  gb=12.0)),
    ("bands    -5/+10",           dict(stop=-5.0,  take=10.0, gb=12.0)),
    ("stop     -5/+15",           dict(stop=-5.0,  take=15.0, gb=12.0)),
    ("stop     -8/+15",           dict(stop=-8.0,  take=15.0, gb=12.0)),
    ("take     -10/+10",          dict(stop=-10.0, take=10.0, gb=12.0)),
    ("no give-back",              dict(stop=-10.0, take=15.0, gb=0.0)),
    ("min hold 4h",               dict(stop=-10.0, take=15.0, gb=12.0, hold=4.0)),
    ("min hold 12h",              dict(stop=-10.0, take=15.0, gb=12.0, hold=12.0)),
    ("min hold 24h",              dict(stop=-10.0, take=15.0, gb=12.0, hold=24.0)),
    ("exit cooldown 2h",          dict(stop=-10.0, take=15.0, gb=12.0, cool=2.0)),
    ("exit cooldown 6h",          dict(stop=-10.0, take=15.0, gb=12.0, cool=6.0)),
    ("exit cooldown 12h",         dict(stop=-10.0, take=15.0, gb=12.0, cool=12.0)),
]

history = {}
for a in ASSETS:
    try:
        history[a] = backtest.load_history(md, BASE, a)
        print(f"  {a}: {len(history[a])} bars", file=sys.stderr)
    except Exception as e:
        print(f"  {a}: no history ({e})", file=sys.stderr)

print(f"\n{'config':24} {'median':>8} {'mean':>8} {'worst':>8} {'best':>8} {'trades':>7} {'stops':>6} {'takes':>6} {'gb':>5}")
rows = []
for label, cfg in CONFIGS:
    s = replace(BASE, rules=replace(BASE.rules, stop_loss_day_pct=cfg["stop"],
                                    take_profit_day_pct=cfg["take"], giveback_pct=cfg["gb"]))
    p = Params({"min_hold_hours": cfg.get("hold", 0.0), "cooldown_after_signal_h": cfg.get("cool", 0.0)})
    results, trades, stops, takes, gbs = [], 0, 0, 0, 0
    for a, df in history.items():
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, s, p, a)
                m = sim.metrics()
            except Exception:
                continue
            results.append(m["return_pct"])
            trades += len(sim.round_trips)
            stops += sim.counts.get("stop_day", 0)
            takes += sim.counts.get("take_profit_day", 0)
            gbs += sim.counts.get("giveback", 0)
    if not results:
        continue
    row = (label, statistics.median(results), statistics.mean(results), min(results), max(results), trades, stops, takes, gbs)
    rows.append(row)
    print(f"{row[0]:24} {row[1]:+7.1f}% {row[2]:+7.1f}% {row[3]:+7.1f}% {row[4]:+7.1f}% {row[5]:>7} {row[6]:>6} {row[7]:>6} {row[8]:>5}")

base = next(r for r in rows if r[0].startswith("current"))
print(f"\nvs the current rules (median {base[1]:+.1f}%):")
for r in rows:
    if r[0] != base[0]:
        print(f"  {r[0]:24} {r[1] - base[1]:+7.1f} points   {'BETTER' if r[1] > base[1] else 'worse'}")
