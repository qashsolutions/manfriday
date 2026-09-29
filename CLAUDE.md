# Highway

A paper-trading league. Six managers each run their own $500 across four $100 lanes plus a $100
reserve, under identical hard rules but each confined to its own slice of the market, competing
to reach 12-15% a month. It runs 24/7 on this Mac as a launchd service and reports to a local
dashboard. **No real money is involved and live trading is not wired up.** Full description:
`README.md`.

## The mandate rebuild (shipped Sept 24, 2026) - READ THIS FIRST

The league launched with four managers that all picked from one universe, so they converged:
Quant and Hold measured **0.97 correlated** and Quant's contribution to the league was **0.003**.
Four names for one bet. The owner's fix is **mandates**: each manager gets its own slice of the
market, so they can actually differ.

### The six managers

| id | Name | May hold | Brain | Venue |
|---|---|---|---|---|
| `bluechip` | Bluechip | S&P 500 giants (top 120 by market cap, live screener) | tournament | commission-free |
| `etf` | ETF | funds only: VOO, GLD, semiconductors, life sciences | tournament | commission-free |
| `coinbase` | Coinbase | crypto | tournament | **forced Coinbase** |
| `momentum` | Momentum | crypto | momentum rule | **forced Crypto.com** |
| `laser` | Laser | anything | AI judgement | cheapest |
| `hold` | Hold | anything | buys once, never changes | cheapest |

`mandate.py` owns this table. Hold does not compete (`competes=False`); it is the yardstick the
skill scoring measures alpha against.

### Decisions taken, so they are not silently re-made

These were judgement calls, not owner instructions. Change them freely if they prove wrong, but
know they were chosen deliberately:

1. **SPX is not tradable and duplicates VOO** (both track the S&P 500), so the ETF mandate uses
   VOO for that exposure. The owner asked for "VOO, GLD, SPX, semicon and life sciences".
2. **Life sciences became its own ETF theme** (XBI, XLV, IBB, ARKG) because the owner named it;
   it was previously buried in "other sectors".
3. **The shared ETF sleeve is removed.** A dedicated ETF manager makes it duplication, and every
   manager holding identical funds is the very sameness this rebuild exists to fix. The $100
   goes back to the reserve, which restores lane refills (lost in the Sept 23 sleeve migration).
4. **Hold is rebased** to a representative blend across the mandates. A benchmark that holds only
   what the old league happened to pick cannot measure alpha for a blue-chip or ETF manager.
5. **`max_per_class` is disabled for single-kind mandates.** A crypto-only manager cannot fill
   four lanes under a "max 3 of one class" rule - the cap only means anything for Laser and Hold.
6. **Per-mandate volatility floors.** The 10% monthly floor excludes most blue chips (AAPL ~6%,
   MSFT ~5%) and every fund. Bluechip and ETF get their own floors or their universes are empty.

### What shipped

- Universe widened 285 -> 338 symbols. The stock list was Coinbase's tokenised-stock list, which
  is missing GOOGL, META, AVGO, UNH and XOM - that was the root cause of every manager landing
  on the same few names. `universe.bluechips()` now reads the live screener daily.
- Per-kind volatility floors, measured not guessed: the single 10% floor excluded **11 of the 15
  largest US companies** and 6 of 8 funds.
- Tournaments are keyed `(manager, lane)`; `bluechip`, `etf` and `coinbase` each run their own.
- `quant` renamed to `bluechip` (funds, orders, fills, events, equity history all migrated).
  `etf` and `coinbase` opened at $500. All six reconcile to 0.0000.
- Shared ETF sleeve retired; the $100 went back to the reserve, so lane refills work again.
- **Result: average asset overlap between managers fell to 0.14.** Bluechip and ETF share nothing
  with anyone.

### Known risks in this rebuild

- **Hourly history for stocks comes from Yahoo, which rate-limits (429).** 120 blue chips cannot
  all be backtested daily; only the shortlist gets hourly bars.
- **Correlation cap:** coins inside a crypto-only mandate are often >0.85 correlated, which can
  block a lane from filling. Relax per mandate rather than leaving lanes empty.
- **This reset the comparison.** `etf` and `coinbase` started fresh on Sept 24; `bluechip`
  inherited Quant's money but under a different mandate, so its history before then is not
  comparable. Week-by-week tables spanning Sept 24 have a seam in them.
- **Bluechip still holds MSTR and ETHA**, inherited from Quant and outside its mandate. Nothing
  is force-sold, so they rotate out as those lanes go flat. Expect it, do not "fix" it.
- **The three crypto managers still overlap** (Coinbase, Momentum, Laser share NEAR/ZEC/UNI).
  That is by design: Coinbase vs Momentum is a controlled test of execution cost (Coinbase
  ~1.40% a round trip against Crypto.com's ~0.75%), not a diversification play.
- **Hold's basket is frozen at league start and must stay frozen** (`_ensure_hold_basket`).
  It used to be recomputed on every Scout pass, which turned the yardstick into an active
  manager: **12 distinct assets and 30 buys in the first week**, more churn than the Coinbase or
  ETF mandates. Everything in `skill.py` measures alpha, beta and contribution *against Hold*, so
  a drifting benchmark silently corrupts every skill number - and "the benchmark is last" stops
  meaning anything. The hard rules still stop Hold out; the owner's decision of Sept 29 is that a
  stopped lane **buys the same asset back** after `cooldown_after_stop_h` rather than being
  re-scouted. Frozen in place on Sept 29 at ZEC-USD / AMD / ARKK / PUMP-USD rather than reset to
  the Sept 24 basket, because resetting would have meant force-selling live positions. Hold's
  record before Sept 29 is a rotating manager's, not a benchmark's - do not read alpha across
  that seam.
- **A venue-pinned mandate needs `venues.listings()` loaded before the Scout runs.** `setup()`
  calls `_venues()` first for exactly this reason; an empty listing set is treated as "unknown,
  allow" rather than "lists nothing", which once left Coinbase with a mandate of zero assets.

## Commands

```bash
uv run pytest -q                      # tests: run before every deploy
scripts/service.sh restart            # deploy: the engine reloads the code
scripts/service.sh status | logs      # is it alive / tail the log
.venv/bin/highway status              # leaderboard in the terminal
.venv/bin/highway days [--day N]      # day-by-day and week-by-week tables
.venv/bin/highway radar [--scan]      # what the buckets are flagging
.venv/bin/highway daily               # the daily review: is anything broken, what happened
.venv/bin/highway audit               # did every hard rule fire, and on time?
.venv/bin/highway rules               # what each exit rule has made or lost, per manager
.venv/bin/highway assets [--all]      # what each asset has made or lost since day one of it
.venv/bin/highway assets --by week    # ...broken down by day / week / month / quarter / year
.venv/bin/python scripts/measure/scout_skill.py  # does the ranking beat a coin flip?
.venv/bin/python scripts/measure/rule_sweep.py   # re-derive a rule change; see scripts/measure/README.md
.venv/bin/highway scout [--claude]    # re-pick lanes now
.venv/bin/highway weights [--apply]   # backtest the ranking weights
.venv/bin/highway backtest SOL-USD    # walk-forward one asset
.venv/bin/highway pause | resume | kill
```

Dashboard: served locally on the host in `[dashboard]` of `config/settings.toml`. Not exposed
beyond this machine, by the owner's decision, for the whole run.

## Hard rules: never weaken these without asking the owner

They are the owner's own rules, enforced in code, and every manager obeys them:

- $100 per lane, never more than $150; every $50 above $100 goes to a vault nothing can spend.
  A lane smaller than $100 scales those numbers rather than inheriting them
  (`Capital.cap_for` / `floor_for` / `skim_for`). Never hardcode the $100-lane figures - the
  retired ETF sleeve used $25 lanes and that machinery is still live for any future part-lane.
- **Max $50 per buy, one clip per bar.** A lane scales in, it never goes all-in at once.
- **Exit everything on −6% in a day; sell everything on +18% in a day** (confirmed on two
  consecutive price checks). Day = rolling 24 hours, not a calendar day.
  **Retuned from −7/+12 on Sept 29 on the owner's call, backed by `risk_reward.py`.** The
  finding there was that the *ratio* matters more than the width: across 24 cells, a higher
  reward-to-risk ratio won at every stop width, 1:1 was worst everywhere, and 1:3 was best or
  near-best. −6/+18 scored +5.4 on the full history against −7/+12's +1.6, level on the recent
  third. The gain comes from **raising the target, never from cutting the stop** - the −3% and
  −4% rows were deeply negative at every ratio.
- **Do not tighten the stop. It has been asked for twice and measured twice.**
  `stop_levels.py`: every level below −5% loses on both windows and gets monotonically worse;
  −1%/+3% was the worst of nine configurations at **−22.6 full / −16.9 recent** with twelve
  times the stops. The reason is arithmetic, not opinion: a round trip costs 0.75% on
  Crypto.com and 1.40% on Coinbase, so at a 0.5% stop **the fee is 1.5 to 2.8 times the stop
  itself**, and a 1% stop is 0.29 daily standard deviations on the median asset - ordinary
  noise crosses it constantly. Algorithms that do run 0.5% stops are on perp futures at
  ~0.02-0.05% fees or earning maker rebates; our costs are 15-56x that.
- **Bank half at +8% and let the rest run** (`partial_take_pct`, `risk.partial_signal`,
  `portfolio.take_half`). Not an exit: no cooldown, the lane keeps its asset, its stop, its
  give-back and its high-water mark, and `Lane.took_partial` stops it happening twice.
  Measured in `partial_exit.py`: taking half **early** (+3% to +6%) helped the full history but
  hurt the recent third almost everywhere, because it caps you out of the large moves that pay
  for the losers. Only +8% against the +18% target won both windows (+2.2 full, +0.2 recent).
  The earlier retune from −10/+15 on Sept 24 was also measurement, not taste: over two years of hourly bars,
  all strategies, 10 assets, −7/+12/give-back-20 returned **+5.6 points more with 3.6 points
  less drawdown** than −10/+15/12 — better on both axes. A symmetric −5/+5 band was tested at
  the same time and was the only setting with clearly negative returns: tightening the stop
  helps, capping the winners does not. Do not re-propose ±5% without new evidence.
- **The exit rules must run on every position, on every price check, without exception.**
  The owner restated this on Sept 29 as the rule that can never be broken. Three layers enforce
  it, and none may be removed: `portfolio.hard_rules` checks every held lane each tick;
  `self.protection` records the only two cases where it cannot (market closed, no fresh price)
  and the **"Exit rules watching"** health check fails on anything but a closed market after a
  5-minute grace; `highway daily` fails on the same. A position that cannot be priced is a
  position these rules are not protecting, and that must never be silent.
  **Never put a time limit on the confirming tick.** There was a 60-second one, and it could
  cancel the rule outright: a stale feed makes `hard_rules` return early *without* clearing the
  trigger, so a price arriving later than 60s re-armed the stop instead of firing it - a
  position could sit in breach indefinitely while the stop re-armed forever. The trigger is
  cleared the moment a real price shows no breach, so a surviving trigger already means the
  previous evaluated check breached. See `tests/test_protection.py`.
- **Give-back stop: exit everything 20% below the best price since the position opened**
  (`rules.giveback_pct`, `risk.giveback_pct`, same two-tick confirmation). It never caps a
  winner - only its retreat - and it closes the gap the day rules leave, which is a slow bleed
  where no single 24 hours breaks −10%. `Lane.peak_price` is the high-water mark; it is raised
  in `hard_rules` whenever a fresh bid beats it and reset to 0 the moment a position closes, so
  the next position never inherits the last one's high. **It was 12% and that was too tight** -
  it fired 173 times in a two-year test and cost more than it saved. At 20% it fires 23 times
  and beats both 12% and no stop at all, on the full history and on the most recent third.
  A fixed daily take-profit band was tested alongside and destroyed the portfolio (losing on
  10 of 10 assets), so do not re-introduce one.
- A lane at $70 closes and **is refilled from the $100 reserve**, which came back when the
  shared ETF sleeve was retired on Sept 24. The refill code
  is intact and still tested; it simply has nothing to draw on.
- Total at risk is capped at $500 per manager, structurally.
- Stock sale proceeds cannot be respent until the next business day.
- **Time guardrails:** stocks trade 9:30-16:00 ET only (half-days handled); no new stock buys in
  the first 5 or last 30 minutes, nor within 2 days of the company's earnings.
- **A lane waiting to change asset takes no new clips** (`portfolio.swap_guard`). A switch waits
  for the position to close rather than forcing a sale, so the lane can hold an asset it has
  already decided to leave; it may sell, never buy more. The tournament managers need this
  explicitly because a tournament always targets the asset the lane already holds, so `follow`'s
  own switch path never fires for them.
- **A buy decision older than 4 hours, or made before today's open, is re-checked** against the
  current price and news (`risk.stale_decision_reason`). Gapped, slid or soured means no buy.
- **No buying an asset that is already falling** (`risk.falling_knife`, `no_buy_drop_pct` /
  `no_buy_drop_hours`, currently 3% in 4h). The stale check refuses a buy whose *decision* has
  aged; this refuses a fresh decision on an asset in free fall. It came from a real pattern:
  five trades were bought and stopped within hours for an average of **-10%**, against -1.1%
  for every other trade. Measured over 12 assets and all strategies it won on both the full
  history (+6.7 points) and the recent third (+1.6), and a second setting (-5% in 8h) pointed
  the same way, which is what makes it look like signal rather than one lucky configuration.
- **A manager may only hold what its mandate allows** (`mandate.allows`). The ETF mandate takes
  one fund per theme from `universe.ETF_LANE_THEMES`; leveraged funds and crypto trusts are
  barred, because ranking rewards movement and without that rule the mandate fills with 2x crypto
  funds - the opposite of its purpose. Funds and blue chips get their own vol and liquidity
  floors (`etf_min_*`, `bluechip_min_*`): the standard 10% monthly-vol floor excludes GLD, VOO
  and **11 of the 15 largest US companies**. The fund shortlist is taken **per theme** so a hot
  theme cannot crowd the rest out.
- **`Lane.kind` is "main" or "etf".** Every lane is "main" today; the "etf" kind is what the
  retired sleeve used. Anything meaning "the contested lanes" filters on it via
  `Engine.main_lanes()`.
- `mode = "paper"` is the only accepted mode. Going live needs the owner's explicit go-ahead.

Everything in `params.py` (SPECS) is tunable within fixed bounds by the nightly Coach and the
weekly review. Anything structural (retiring a manager, changing a hard rule, hosting, real
money) waits for the owner.

## How the code fits together

| Module | Role |
|---|---|
| `engine.py` | The loop. Prices every 10s, hard rules, bars, agents, snapshots. Owns everything. |
| `portfolio.py` | One manager's fund, resting orders and trading mechanics. Shared by all six. |
| `book.py` | The money: lanes, tranches, fees, settlement, skims, floor, the $500 cap. Pure. |
| `risk.py` | Hard rules and buy approval. Plain code; no agent can override it. |
| `brains.py` | Laser (AI), Momentum, Hold. The tournament managers' brain lives in the engine. |
| `mandate.py` | Who may hold what, and where they trade. The table that keeps managers apart. |
| `skill.py` | Alpha vs the benchmark, contribution beyond the others, probabilistic/deflated Sharpe. |
| `audit.py` | Replays history and asks whether every hard rule actually fired, and on time. |
| `attribution.py` | Which rule closed each trade, and what it made or lost. `audit` asks if it fired; this asks if it was worth firing. |
| `metrics.by_asset` / `assets` | What each asset has made or lost since the first buy, across every re-entry and every manager. The trade list cannot answer this: NEAR-USD is 15 separate trades. |
| `metrics.asset_periods` | The same money by asset **inside** each day/week/month. Values a position at each period edge, so an asset simply held through a quiet week still shows what it did. Reconciles with `by_asset` to within a few cents. |
| `strategies.py` / `sim.py` / `tournament.py` | Strategies, the shared lane simulator, and the per-lane contest. |
| `scout.py` / `backtest.py` / `weights.py` | Asset selection, walk-forward tests, weight backtests. |
| `radar.py` / `universe.py` / `seasonality.py` | Buckets, the seven indicators, the ETF lane's fund list, the market clock. |
| `calendar.py` | Market hours, half-days, holidays, settlement dates. The clock everything trusts. |
| `news.py` / `agents.py` | Headlines and scoring; headless `claude -p` calls on the Max plan. |
| `metrics.py` / `summaries.py` / `review.py` / `health.py` | Scorecards, day/week rollups, weekly review, health checks. |
| `market.py` / `stockdata.py` / `venues.py` | Prices, US stock data, and which venue each lane trades on. |
| `db.py` / `dashboard.py` / `publish.py` / `cli.py` | SQLite, the local page, the static export, the CLI. |

## Conventions

- **The engine owns the database.** CLI commands write state; the engine picks it up within 5
  minutes. Do not run two engines.
- **Every money or rule change needs a test.** See `tests/test_book.py` and `tests/test_risk.py`;
  `metrics.reconcile()` proves each portfolio still adds up to $500 minus buys plus sales.
- **AI answers are always validated in Python** before they change anything, and agents never
  place orders. Strip `ANTHROPIC_API_KEY` from the subprocess environment or `claude -p` fails.
- **Write for a non-technical reader.** Dashboard text, events and reports get read by the owner.
- Deploy = `uv run pytest -q` then `scripts/service.sh restart`. For a dashboard change, also
  syntax-check the served JavaScript (see the gotchas) - Python tests cannot see broken JS.
- **Change a hard rule only on evidence.** `scripts/measure/` holds the harnesses that produced
  every rule in this file, with what each one found. A change must win on the full history *and*
  the most recent third; winning one is noise.

## Gotchas learned the hard way

- **Yahoo rate-limits** (HTTP 429) after a few hundred requests. Nasdaq's public endpoints are
  the primary source for stocks now, with a local `daily_bars` cache; Yahoo is the fallback and
  the only source of hourly stock history.
- **Don't restart repeatedly.** The radar's daily bar refresh takes minutes and restarts interrupt it.
- **To edit the database directly, `scripts/service.sh stop` first, then `start`.** The job is
  `KeepAlive`, so it relaunches the instant it dies and an unrecognised argument to the script is
  a silent no-op. A live engine holds each fund in memory and saves straight over direct edits -
  this silently reverted a whole fund migration once. Verify with `pgrep -f "highway run"`.
- **The venue cross-check gates new buys only.** During a crash venues drift apart, and that must
  never block a protective sell. This cost a lane 17% once.
- **`sim.py` re-implements the hard rules instead of calling `risk.exit_signal`.** Add a new
  exit rule and you must add it in BOTH places, or the tournament ranks strategies on a game
  the real money is not playing. The give-back stop shipped live and was invisible to every
  backtest and shadow sim for half a day before this was caught: the giveback column read 0
  across every config in a measurement, which is what exposed it. `tests/test_sim.py` now
  asserts the simulator mentions each rule.
- **Never scale a short live record up to a monthly rate** (`MIN_DAYS_TO_ANNUALISE`). A few lucky
  hours once produced a score of 65 trillion, which then picked leaders.
- **Don't let one dashboard panel's error blank the page** (`panel()` wraps each one), and watch
  for duplicate element ids when moving markup between sections.
- **A green Health page can hide a dead engine.** Changing `apply_picks(picks)` to
  `apply_picks(pid, picks)` left two call sites stale and the engine raised on *every tick* for
  hours while Health reported all checks passing - the tick exception is caught and logged, not
  surfaced. After any signature change, check the log since the last start:
  `awk '/engine running/{n=NR} END{...}'`, or simply `grep -c "tick failed" data/logs/engine.log`.
- **Every manager that needs a candidate list must be in `scout_pids`, not just `tourn_pids`.**
  Momentum and Laser do not run tournaments but still need picks. When they were left out,
  Momentum placed **no trades at all** and nobody noticed, because "made no trades" looks exactly
  like "chose not to trade". Laser meanwhile inherited whatever mandate wrote the shared key last
  and silently shrank from 161 assets to 18.
- **`scout.pick()` writes a state key.** Per-mandate calls must pass `state_key=`, or each run
  stamps on the shared `scout_picks` and the last one wins.
- **Run `node --check` on the served JavaScript before trusting a dashboard deploy.** A Python
  import check passes happily on broken JS, and one duplicate `const` blanks *every page*:
  `curl -s "http://$HOST:$PORT/" | sed -n '/^<script>/,/^<\/script>/p' | sed '1d;$d' > /tmp/hw.js && node --check /tmp/hw.js`
  (host and port from `[dashboard]` in `config/settings.toml`).
  Two variable collisions (`lo`/`hi`, then `pr`) were caught this way.
- **SVG does not wrap text and does not resolve unknown CSS variables.** A long string is silently
  clipped at the viewBox edge - split it by hand. `var(--card)` does not exist; the surfaces are
  `--surface-0` / `--surface-1`, and an unknown token falls back to black fill.
- **A dashboard left open runs the JavaScript it loaded that day.** `/api/data` carries a `build`
  hash and the client reloads itself when it changes; without it a deploy looks like a page that
  quietly stopped updating.
- **A rule change makes the guardrail audit cry wolf unless history knows about it.**
  `audit.py` replays every position against a threshold; scoring old history against *today's*
  threshold turned eleven correctly-held positions into "fired late" the moment the stop went
  from −7% to −6%, every one between −6.1% and −6.8%. The engine now appends to `rule_history`
  at startup whenever the thresholds change (`audit.record_rules`) and `audit.rules_at` picks
  the entry in force at each sampled moment. Seeded by hand for the three known eras. Any
  future hard-rule change needs no action - just do not remove the `record_rules` call.
- **`if value` treats a genuine 0.0 as missing.** The radar stored `edge: 0.0` as null and rendered
  "passed +null". Use `if value is not None`.
- **Never write a rule threshold into dashboard text.** The exit labels said "hit the −10% day
  stop" and "gave back 12%" for five days after the Sept 24 retune to −7/+12/20, quietly telling
  the owner the wrong numbers on every trade row. They now read `snapshot.capital`
  (`stop`, `take`, `giveback`, `lane_floor`), which the engine already publishes. Same rule as
  the monthly target: the number lives in settings, the page quotes it.
- **Resting every buy at the bid is deliberate, and it has been measured.** It looks like textbook
  adverse selection - we fill when the price falls *toward* us and miss the entries that run away,
  and about **20% of wanted buys never fill**. It is still the right trade: crossing the spread
  after one unfilled bar lost on both windows (−3.2 full history, −0.2 recent) and paid more in
  fees (`scripts/measure/maker_vs_taker.py`, `taker_after_bars`, shipped at 0). The entries we
  miss are the ones that ran away, and chasing them loses. Waiting 2-3 bars before crossing
  almost never fires, because the signal stops asking first. `highway daily` now reports the live
  unfilled rate; far from ~20% means the quotes or the bar clock have changed, not that the
  design is wrong.

## Status (Sept 2026)

- **The pilot is open-ended.** It was re-based to day 1 on Sept 24, 08:17 CDT. The original
  six-week framing is now a review milestone, not an end date: it runs until the owner judges the
  model good enough, reviewed daily and tweaked when evidence supports it. The
  first two days were thrown out of the scored window (not deleted - every row is still on disk)
  because they compared three managers over two days, one under a different mandate, and two
  that had existed for two hours. `league_started` and `league_start_values` define the window.
- The four continuing managers carried their **actual balances** into day 1 rather than resetting
  to $500. The leaderboard ranks on percentage from each manager's own baseline, so that is fair;
  equalising would have meant force-selling $678 of positions the new mandates had just chosen.
- **Target is 12-15% a month** (`[target] monthly = 0.135`, with `monthly_low`/`monthly_high`).
  Tempered from 22% on Sept 24. Every prompt and dashboard figure reads it from settings - do not
  hardcode a target anywhere.
- **Roughly half the league sits in cash at any time**, and that is the system working: the fee
  test, cooldowns and settlement account for most of it. A flat lane is not a broken lane.
- **Pending:** an official Nasdaq API key. It goes in `.env` as `NASDAQ_API_KEY` with
  `NASDAQ_API_PRODUCT`; `stockdata.official_provider()` is the hook.
- **Open question for week 6:** whether Momentum earns its place. Note the earlier "it lost money
  under every weighting" claim is a statement about N weightings and needs a deflated Sharpe
  before it counts as evidence - and Momentum is the most differentiated manager, so it carries
  the most information.
- For live numbers read the dashboard, `highway status`, `highway audit`, or `data/reports/`.
  Don't trust any figures written here.

## The daily review: what is safe to change daily, and what is not

The pilot runs open-ended and is reviewed daily. That cadence is right for operations and wrong
for strategy, and the two must not be confused.

**Daily, act freely — `highway daily`.** It answers five operational questions: is health green,
did any tick raise, did every hard rule fire on time, does every manager have a candidate list,
and did each one actually trade. It exists because a manager once sat completely inert for hours
and nothing noticed: *"made no trades"* and *"chose to make no trades"* look identical from the
outside, so it asks directly. Fixing a bug, an empty candidate list or a dead feed needs no
evidence beyond the symptom.

**Strategy changes need evidence, not a day.** A day is nowhere near enough to tell a good
manager from a lucky one - the simulation in `scripts/measure/league_power.py` puts a genuinely
better manager (5%/month edge) in first place only **39%** of the time over a *whole six weeks*.
Over one day it is a coin flip. Changing weights because yesterday looked bad is fitting to noise.

So: a rule or parameter changes only when a harness in `scripts/measure/` supports it, and only
when it wins on the full history **and** the most recent third. Everything there records what it
found, so a change can be argued against evidence rather than against memory.

There is a second reason to be strict. Re-tuning against the same live record every day is
adaptive querying of a single holdout - the Ladder result (Blum & Hardt, ICML 2015) shows this
overfits the leaderboard itself, however honest each individual decision feels.

## Read this before tuning anything: the premise check failed

`scripts/measure/edge_test.py`, run Sept 29 with its decision rule fixed in advance, asked the
question sixteen earlier harnesses had skipped: **does the Scout -> tournament -> strategy ->
exits pipeline beat simply buying the assets it picked and holding them, under the same rules
and fees?**

It beat buy-and-hold on **1 of 12 assets**. Median difference **−34.1 points**, paired
**t = −3.27**, significant at the 5% level. Decomposed over the test window:

| | median return |
|---|---|
| just owning the asset, no rules | **+73.8%** |
| after the hard rules (stops, give-back, fees) | **+41.0%** (protection costs ~33 pts) |
| after the strategy layer on top | **−3.6%** (a further ~45 pts) |

**The caveat must always travel with the number: 10 of the 12 assets rose over their test
window.** A strongly bullish sample flatters buy-and-hold and penalises anything that goes to
cash, so this does not prove the strategies lack skill in every regime - the league's own recent
experience has been a falling market. But it is strong evidence that the pipeline as configured
destroys value, and it directly contradicts the premise that tuning exit rules reaches
12-15%/month.

**What follows from it, per the pre-registered rule:**

1. **Stop tuning exit thresholds.** No stop level rescues an entry signal with no edge. Sixteen
   harnesses tuned pieces of this pipeline; none had asked whether it had an edge to tune.
2. **The target needs revisiting.** Nothing measured has reached 12-15%/month -
   `bands_vs_drawdown`, `tight_bands_monthly` and `risk_reward` all agree. A target the design
   cannot support is a wish, not a goal.
3. **The open question is the entry side**, not the exits: the Scout's ranking already fails to
   beat a coin flip on recent data (`scout_skill.py`), and this says the strategy layer on top
   of it subtracts more.
4. **Re-run this before trusting any future tuning.** It is a premise check, not a knob - it
   proposes nothing and should be the first thing run, not the seventeenth.

## Scoring: raw return is not the score

Raw return ranks whoever took the most risk. `skill.py` is the honest version and feeds the
Leaderboard's "who is actually adding something":

- **Alpha against Hold**, with a t-statistic. Measured Sept 24: all three active managers had
  beta below 1 and no significant alpha - the leader was ahead mostly on *lower exposure* in a
  falling market, not on picking.
- **Contribution beyond the consensus**, in the spirit of Numerai's MMC: a manager that tracks
  the others scores ~0 however well it is doing. This is what exposed Quant contributing 0.003.
- **Probabilistic and deflated Sharpe**: a short record with fat tails is worth far less than its
  raw Sharpe, and the per-lane tournament picks the best of 42 variants, which needs deflating
  **when reporting skill**. Deflating the *selection* was tried and rejected - see below.
- **Score on paired differences, not standalone Sharpe.** Ranking two managers on standalone
  Sharpe needs years; scoring the daily difference against a common benchmark collapses that to
  weeks. Measured: removing the shared market move cuts the noise 21-74%.

**Making the tournament's leader clear the best-of-N luck bar was measured and rejected.**
`tournament_hurdle` gates a lane's leader on what the luckiest of 42 coin flips would score
(`skill.expected_max_sharpe` over the spread of contender scores). It is shipped at **0, off**:
every level lost on both windows and got monotonically worse - 10% of the bar −1.7/−0.0 points,
25% −6.8/−3.6, 50% −10.0/−7.5 - and the full bar left 2 of 8 lanes permanently in cash at 8%
time in market. The exposure it targets is real; the gate is the wrong fix, for two reasons
worth remembering before anyone re-proposes it:

1. **The 42 variants are not 42 independent trials.** They are grid variants of six strategy
   families and move together, so the effective N is far smaller and the Gumbel threshold
   over-corrects by a wide margin.
2. **The tournament already deflates, structurally.** Walk-forward survival, `switch_margin_pct`,
   `min_leader_hold_h` and an eligibility rule that demands a positive live record are four
   filters on the same selection. Adding a fifth removed good entries, not noise.

`scripts/measure/tournament_hurdle.py` is the harness, and it is the **first one that replays a
real tournament** over history - priors trained on the first two thirds, then bar by bar with a
lane following whatever the tournament leads. Use it for any future tournament change; nothing
else in `scripts/measure/` tests the tournament rather than a single strategy.

**The hard rules are firing, and they are firing at their set levels.** Measured Sept 29 with
`highway rules`: the day stop has closed **28** trades at an average of **−6.5%** against a −7%
rule, and the take-profit **7** trades at **+12.1%** against a +12% rule. Landing that close to
the configured levels is the two-tick confirmation and the rolling-24h window working as
intended, not a coincidence worth re-tuning. The stops cost −$175 and the take-profits made
+$73, which is what a 4-to-1 ratio of stops to targets looks like in a falling market - it is
the market, not a broken rule. **The give-back stop has never fired**, so its 20% level remains
untested by live prices; `highway rules` lists any hard rule in that state rather than hiding it.

**Why the league leans crypto, quantified.** Asked Sept 29. Three causes, and they chain:
(1) **By design**, 8 of 24 lanes are crypto-only mandates - Coinbase vs Momentum is the fee
experiment. 8 are equity-only and 8 are free to choose. (2) **The free lanes go crypto too**,
because `rank_w_vol` is the ranking's largest weight and crypto carries about twice the monthly
volatility of stocks. Laser's live candidate list ran **crypto in the top 12 of 20**, first
stock at #13. Measured over a year on a universe that is only **5% crypto (18 of 356), crypto
still takes 28% of the picks - 5.6x over-representation**. The z-scores are computed across the
combined universe, so a stock is scored for volatility against crypto's distribution and can
essentially never win that term. (3) **Equity lanes sit in cash more**, because low-volatility
assets throw fewer signals that clear the fee test - so crypto's share of open *positions* (57%)
runs above its share of lanes (33%).

This is the same chain as the stop problem: the monthly target demands movement, the ranking
selects movement, movement means crypto, and crypto's movement is why a 6% stop fires on noise.
The floor comment still reads *"needs enough movement to make 22% a month possible"* - a target
dropped to 12-15% on Sept 24 that nobody revisited. A volatility **ceiling** was measured as the
way to cut the chain (`vol_ceiling.py`) and **did not clear the two-window bar**; the recent
third liked it a lot, the full year did not.

**The Scout's ranking is not currently beating a coin flip, and this is the open question.**
`scripts/measure/scout_skill.py` asks what `weights.py` never did - whether the ranking predicts
anything at all, rather than which weighting predicts best. Over 47 weeks the top fifth of the
ranked universe beat the bottom fifth by **+0.66 points a week** and the chosen four beat four
random names by **+1.03**. Over the most recent third the ranking **inverts**: the top fifth is
the *worst* of the five buckets (−3.04% against −0.82%) and the Scout loses to a random draw by
**−0.34**. By this project's own rule that is not an edge - it wins one window, not both.

This is what the per-asset view was pointing at: NEAR-USD was bought 15 times by 5 of the 6
managers for a net loss, and no single trade looked wrong. Do **not** rush a weight change off
this - `highway weights` has a train/test protocol for exactly that, and 16 recent weeks is a
small sample. But do not read a good leaderboard as evidence the Scout is picking well either.

**Statistical reality check, so nobody over-reads a six-week result:** simulated 20,000 times at
the managers' measured volatility and correlation, a manager with a genuine 5%/month edge wins a
42-day league only **39%** of the time and comes last **14%** of the time. Do not relegate, retire
or reallocate on six weeks of raw return alone.
