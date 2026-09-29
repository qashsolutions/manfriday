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

Two rules for using these:

1. **A change must win on both the full history and the most recent third.** Winning one is noise.
2. **They compare default strategy settings, not the tuned variants each lane actually runs.**
   That is deliberate - it isolates the rule being tested - but it means the absolute numbers are
   not forecasts of live performance.
