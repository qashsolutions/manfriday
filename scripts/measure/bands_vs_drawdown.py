"""With a 12-15% target instead of 22%, is a tighter +/-5% band now worth it?

The earlier test judged configs on return alone. A lower target means we can rationally trade
upside for safety - so this also measures the drawdown each config actually suffered, and
whether it clears the new target at all.
"""
import statistics
from dataclasses import replace

from highway import backtest
from highway.config import load_settings
from highway.market import MarketData
from highway.params import Params
from highway.strategies import STRATEGIES

BASE = load_settings(); md = MarketData(BASE)
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]
CONFIGS = [
    ("current  -10/+15, gb 12", -10.0, 15.0, 12.0),
    ("owner    -5/+5,   gb 12",  -5.0,  5.0, 12.0),
    ("owner    -5/+5,   gb off", -5.0,  5.0,  0.0),
    ("mid      -5/+10,  gb 20",  -5.0, 10.0, 20.0),
    ("mid      -7/+12,  gb 20",  -7.0, 12.0, 20.0),
    ("best-so-far -10/+15, gb 20", -10.0, 15.0, 20.0),
]
hist = {a: backtest.load_history(md, BASE, a) for a in ASSETS}
p = Params()
print(f"\n{'config':28} {'median ret':>11} {'median drawdown':>16} {'return per unit dd':>19} {'monthly':>9}")
rows = []
for label, stop, take, gb in CONFIGS:
    s = replace(BASE, rules=replace(BASE.rules, stop_loss_day_pct=stop, take_profit_day_pct=take, giveback_pct=gb))
    rets, dds, mons = [], [], []
    for a, df in hist.items():
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                m = backtest.run(cls(), df, s, p, a).metrics()
            except Exception:
                continue
            rets.append(m["return_pct"]); dds.append(m["max_dd_pct"]); mons.append(m["monthly_pct"])
    r, d, mo = statistics.median(rets), statistics.median(dds), statistics.median(mons)
    rows.append((label, r, d, mo))
    ratio = r / d if d else 0
    print(f"{label:28} {r:+10.1f}% {d:15.1f}% {ratio:>18.2f} {mo:+8.1f}%")

base = rows[0]
lo, hi = BASE.target.monthly_low * 100, BASE.target.monthly_high * 100
print(f"\nagainst the new {lo:.0f}-{hi:.0f}% monthly target:")
for label, r, d, mo in rows:
    verdict = "clears it" if mo >= lo else f"short by {lo - mo:.1f} points"
    print(f"  {label:28} {mo:+6.1f}%/month  drawdown {d:5.1f}%   {verdict}")
print(f"\nvs current: does a tighter band actually buy less drawdown?")
for label, r, d, mo in rows[1:]:
    print(f"  {label:28} return {r - base[1]:+6.1f} pts, drawdown {d - base[2]:+6.1f} pts "
          f"-> {'worth it' if d < base[2] - 1 and r > base[1] - 5 else 'not worth it'}")
