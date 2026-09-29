"""Does a -1%/+2% band really compound to ~42% a month?

The reasoning behind it: +2% a day compounds to a large monthly number. That is true only if
you actually WIN +2% most days, and the win rate is the part the arithmetic leaves out.

Two barriers sit either side of the entry. On a random walk the chance of touching the near one
first is roughly its distance divided by the total - so with a stop at -1% and a target at +2%,
about two trades in three end at the stop. Then the fee is charged on both.

This reports `monthly_pct`, the annualised-to-a-month figure the league is actually scored on,
so the 42% claim can be checked rather than argued about. Crypto only: it is where the tight
bands were proposed and where the fee bites hardest.
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
BANDS = [
    (-1.0, 2.0), (-1.0, 3.0), (-2.0, 4.0), (-2.0, 6.0),
    (-3.0, 6.0), (-3.0, 9.0), (-6.0, 18.0), (-7.0, 12.0),
]

history = {}
for a in ASSETS:
    try:
        df = backtest.load_history(md, BASE, a)
        if len(df) > 400:
            history[a] = df
    except Exception as e:
        print(f"  {a}: no history ({e})", file=sys.stderr)

cc = (BASE.fees.cryptocom_maker + BASE.fees.cryptocom_taker) * 100
cb = (BASE.fees.maker + BASE.fees.taker) * 100
print(f"\n{len(history)} crypto assets · round trip {cc:.2f}% (Crypto.com) to {cb:.2f}% (Coinbase)")
print("net of fees, and the share of trades that must win just to break even:\n")
print(f"{'band':>12}{'win nets':>11}{'loss costs':>12}{'breakeven win rate':>21}"
      f"{'odds of winning':>19}{'edge needed':>14}")
for stop, take in BANDS:
    win, loss = take - cc, abs(stop) + cc
    be = loss / (win + loss) * 100 if win + loss else 0
    # On a driftless random walk the chance of reaching +take before -stop is |stop|/(|stop|+take).
    win_odds = abs(stop) / (abs(stop) + take) * 100
    gap = be - win_odds          # how much edge the strategy has to supply to break even
    print(f"{f'{stop:.0f}/+{take:.0f}':>12}{win:>10.2f}%{loss:>11.2f}%{be:>20.0f}%"
          f"{win_odds:>18.0f}%{gap:>11.0f} pts")

print("\n\nwhat each band actually returned, per month, on real bars\n")
print(f"{'band':>12}{'ALL monthly':>14}{'mean':>9} | {'RECENT monthly':>16}{'mean':>9}"
      f"{'trades':>8}{'stops':>7}{'takes':>7}")
rows = []
for stop, take in BANDS:
    s = replace(BASE, rules=replace(BASE.rules, stop_loss_day_pct=stop, take_profit_day_pct=take))
    full, recent, trades, stops, takes = [], [], 0, 0, 0
    for a, df in history.items():
        split = int(len(df) * 2 / 3)
        for cls in STRATEGIES:
            if not cls.backtestable:
                continue
            try:
                sim = backtest.run(cls(), df, s, P, a)
                m = sim.metrics()
                full.append(m["monthly_pct"])
                trades += len(sim.round_trips)
                stops += sim.counts.get("stop_day", 0)
                takes += sim.counts.get("take_profit_day", 0)
                recent.append(backtest.run(cls(), df, s, P, a, start=split).metrics()["monthly_pct"])
            except Exception:
                continue
    if not full:
        continue
    row = (f"{stop:.0f}/+{take:.0f}", statistics.median(full), statistics.mean(full),
           statistics.median(recent), statistics.mean(recent), trades, stops, takes)
    rows.append(row)
    print(f"{row[0]:>12}{row[1]:>13.1f}%{row[2]:>8.1f}% | {row[3]:>15.1f}%{row[4]:>8.1f}%"
          f"{row[5]:>8}{row[6]:>7}{row[7]:>7}")

target = BASE.target.monthly * 100
hit = [r for r in rows if r[1] >= target]
print(f"\n  the league's target is {target:.1f}% a month.")
print("  bands whose median actually reaches it: " + (", ".join(r[0] for r in hit) if hit else "none"))
print("\n  A tighter target does not buy more wins - it moves the target closer to the stop,")
print("  so a larger share of trades ends at the stop instead. The compounding only works")
print("  if you win, and the win rate is what the band is quietly changing.")
