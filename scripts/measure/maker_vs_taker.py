"""Is resting every buy at the bid costing us more than the maker discount saves?

Every buy rests a limit order at the bid and is cancelled if the price never comes back to it.
That means we fill when the price falls *toward* us and miss the entries that run away - textbook
adverse selection, and the same disease the falling-knife guard treated from the other end.

The maker discount is real (Coinbase 0.50% vs 0.90%, Crypto.com 0.25% vs 0.50%, stocks free
either way), so this is a genuine trade-off, not a free fix. This measures both sides: how often
a wanted buy never fills, and what the returns would have been crossing the spread after N bars
of waiting.

Scored on two windows - the whole history and the most recent third. A setting has to win on
both, or it is noise.
"""
import statistics

from highway import backtest
from highway.config import load_settings
from highway.market import MarketData
from highway.params import Params
from highway.strategies import STRATEGIES

BASE = load_settings(); md = MarketData(BASE)
ASSETS = ["BTC-USD", "NEAR-USD", "ZEC-USD", "UNI-USD", "SUI-USD", "LINK-USD",
          "MSTR", "MRNA", "ARKK", "GDX", "COPX", "USO"]
CONFIGS = [
    ("maker only (today)", 0.0),
    ("cross after 1 bar", 1.0),
    ("cross after 2 bars", 2.0),
    ("cross after 3 bars", 3.0),
]

hist = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 400:
            hist[a] = df
    except Exception:
        pass

print(f"\n{len(hist)} assets, {sum(1 for c in STRATEGIES if c.backtestable)} strategies\n")
print(f"{'setting':22}{'ALL median':>12}{'mean':>9} | {'RECENT median':>15}{'mean':>9}"
      f"{'entries':>9}{'unfilled':>10}{'crossed':>9}{'fees':>9}")
rows = []
for label, after in CONFIGS:
    p = Params({"taker_after_bars": after, "no_buy_drop_pct": 3.0, "no_buy_drop_hours": 4.0})
    full, recent = [], []
    entries = unfilled = crossed = 0
    fees = 0.0
    for a, df in hist.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, BASE, p, a)
                m = sim.metrics()
                full.append(m["return_pct"])
                entries += sim.entries
                unfilled += sim.counts.get("unfilled", 0)
                crossed += sim.counts.get("crossed", 0)
                fees += m["fees"]
                recent.append(backtest.run(cls(), df, BASE, p, a, start=split).metrics()["return_pct"])
            except Exception:
                continue
    if not full:
        continue
    r = (label, statistics.median(full), statistics.mean(full),
         statistics.median(recent), statistics.mean(recent), entries, unfilled, crossed, fees)
    rows.append(r)
    print(f"{r[0]:22}{r[1]:>11.1f}%{r[2]:>8.1f}% | {r[3]:>14.1f}%{r[4]:>8.1f}%"
          f"{r[5]:>9}{r[6]:>10}{r[7]:>9}{r[8]:>9.0f}")

base = rows[0]
print(f"\nhow often a wanted buy never fills: {base[6]} unfilled against {base[5]} entries "
      f"({100 * base[6] / max(1, base[6] + base[5]):.0f}% of attempts)")
print("\nagainst today's behaviour - a change must win on BOTH windows:")
for r in rows[1:]:
    d_all, d_rec = r[1] - base[1], r[3] - base[3]
    verdict = "WINS BOTH" if d_all > 0 and d_rec > 0 else "wins one" if d_all > 0 or d_rec > 0 else "loses both"
    print(f"  {r[0]:22} all {d_all:+6.1f}   recent {d_rec:+6.1f}   "
          f"fees {r[8] - base[8]:+7.0f}   {verdict}")
