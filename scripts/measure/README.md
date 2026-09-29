# Measurement harnesses

Every hard-rule change in this project was made on evidence from one of these, not on taste.
They are kept so the evidence can be re-derived rather than re-argued.

Run any of them with the project venv from the repo root:

```bash
.venv/bin/python scripts/measure/rule_sweep.py
```

| Script | Question it answers | What it found (Sept 2026) |
|---|---|---|
| `rule_sweep.py` | Which stop / take-profit / give-back / re-entry settings actually pay? | −7/+12/gb20 beat −10/+15/gb12. Exit cooldowns and minimum-hold: no real effect. |
| `bands_vs_drawdown.py` | Does a tighter band buy less drawdown, and does anything reach the target? | ±5% cut drawdown 2.8 points but was the only setting with negative returns. **Nothing reached 12%/month on median.** |
| `giveback_levels.py` | Is the give-back stop the wrong level or the wrong idea? | Wrong level. 12% fired 173 times and cost more than it saved; 20% fires 23 times and wins on both the full history and the recent third. |
| `daily_band.py` | Should we take profit at +2-3% and go flat overnight? | No, catastrophically. Beat buy-and-hold on **0 of 10** assets; ~91 round trips a year at 1.4% each destroys the capital. |
| `falling_knife.py` | Should we refuse to buy an asset that has just fallen sharply? | Yes. Blocking a buy after a 3% fall in 4h won both windows (+6.7 full, +1.6 recent); -5% in 8h agreed. |
| `momentum_entry.py` | Is Momentum buying after the move, and would more indicators help? | It buys after the move and that is fine - momentum continues. But the edge only beats the 0.80% round trip at ~14 days, and an RSI filter made it *worse*. |
| `league_power.py` | Can a six-week league even identify the better manager? | A genuine 5%/month edge wins only **39%** of the time and comes last **14%**. Do not relegate on six weeks of raw return. |
| `overfitting_budget.py` | How many strategy variants can our history support? | Picking the best of N=42 needs ~4.9 years of history, or the winner's expected out-of-sample Sharpe is zero. |
| `maker_vs_taker.py` | Every buy rests at the bid, so we fill when the price falls toward us. Is that adverse selection costing more than the maker discount saves? | **No - resting is right.** About **20%** of wanted buys never fill, but crossing the spread after one bar lost on both windows (−3.2 full, −0.2 recent) and paid more in fees. The entries we miss are ones that ran away, and chasing them loses. Waiting 2-3 bars almost never triggers (33 and 2 times) because the signal stops asking first. |
| `scout_skill.py` | Does the Scout's ranking predict anything, or does it just pick? | **Mixed, and getting worse.** Over a year the top fifth beat the bottom fifth by +0.66 pts/week and the top-4 beat a random 4 by +1.03. Over the recent third the ranking **inverts**: the top fifth is the *worst* bucket (−3.04% vs −0.82%) and the Scout loses to a coin flip by −0.34. Wins one window, not both - which by this folder's own rule is not a working edge. Also: after a losing week an asset averages −1.42% next week against −0.80% after a winning one, so losers mildly persist (correlation only +0.041, and asset-weeks are not independent, so treat as weak). |
| `tournament_hurdle.py` | Should a lane's leader have to beat what the best of 42 coin flips would score? | **No - rejected, and left off.** Every level lost on both windows and got monotonically worse: 10% of the bar −1.7/−0.0, 25% −6.8/−3.6, 50% −10.0/−7.5. The full bar idled 2 of 8 lanes entirely (8% time in market). The overfitting exposure is real, but this gate is the wrong fix: the 42 variants are not independent draws, so the Gumbel threshold over-corrects badly, and the existing walk-forward survival filter, switch margin and min-leader-hold are already doing the work. This is also the first harness that **replays a real tournament** over history rather than a single strategy. |

Two rules for using these:

1. **A change must win on both the full history and the most recent third.** Winning one is noise.
2. **They compare default strategy settings, not the tuned variants each lane actually runs.**
   That is deliberate - it isolates the rule being tested - but it means the absolute numbers are
   not forecasts of live performance.
