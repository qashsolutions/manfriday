# Highway

A paper-trading **league**: four managers, each running its own four-lane portfolio of crypto and stocks. Each lane starts with $100 and a $100 reserve covers refills, so every manager has $500 at risk. It runs on fake money with live prices, and the winner is the candidate to run real money later.

| Manager | Brain |
|---|---|
| **Quant** | The Scout's backtested picks, with per-lane strategy tournaments. A live watchlist can take over a lane that sits idle. |
| **Laser** | Every 4 hours, an AI (Claude, headless on the Max plan) reads the portfolio, the Scout's candidates, prices, news and web search, then sets each lane. Python validates every answer. |
| **Momentum** | Holds the 4 strongest movers that are still above their 20-day average. It rotates daily after the Scout runs. |
| **Hold** | The benchmark. It bought the Scout's 4 picks when the league started and holds them. |

All four obey the same hard rules below, run through the same order and risk code (`portfolio.py`), and are ranked on the leaderboard by return since the league started.

Dashboard: **http://127.0.0.1:8787**

## Rules the code enforces (`config/settings.toml`, not tunable by any agent)

| Rule | Value |
|---|---|
| Money per lane | $100. A lane never holds more than $150. |
| Vault | Every $50 above $100 moves to the vault, and nothing ever spends it. |
| Buy size | At most $50 per buy, and one $50 buy per 15-minute bar. |
| Day stop | Exit everything if a position is down 10% or more in 24 hours. |
| Day take-profit | Sell everything if a position is up more than 15% in 24 hours. |
| Lane floor | A lane at $70 or less is closed and refilled to $100 from the $100 reserve. When the reserve runs out, the lane stays closed. |
| Fees | Your Coinbase Intro tier: 0.5% for limit orders, 0.9% for market orders. A buy happens only when the expected move beats the fees. |
| Stock settlement | Sale proceeds from stocks can't be spent until the next business day. |

## How it decides

```
Every 10 seconds (Python):  prices -> fill limit orders -> day stop / take-profit -> news guard -> skim -> floor
Every 15 minutes (Python):  each lane's strategy tournament -> follow the leader (or stay in cash)
Every 5 minutes (Python):   news from 7+ sources, deduplicated, spam removed, scored
Daily 13:00 UTC:            Scout scans ~265 assets, backtests the best, picks 4 lanes + an 8-asset watchlist
                            (Python does the work; Claude may swap one pick)
Every bar:                  the watchlist runs the same strategy tournaments live on paper; a lane idle in
                            cash for 24h hands its slot to a watchlist asset that is making money
Nightly 03:00 UTC:          Coach reviews the day, tunes settings within fixed bounds, writes the journal
Rare:                       Claude checks a "critical" headline when the price doesn't confirm it
```

- **What the Scout looks at:** the top 25 coins by Coinbase volume and 285 stocks, ETFs and funds (`config/equities.txt`), including 3× funds like TQQQ and SOXL.
- **How the Scout picks:**
  - Assets that trade too little (under $50M a day for stocks) or move too little (under 10% monthly volatility) are dropped.
  - The rest are ranked on movement and momentum, and the top 10 coins plus the top 10 stocks/ETFs get full backtests.
  - Lanes 1-3 go to the best tested returns, with no fixed slots: any mix of crypto and stocks, at most 3 of one type, and no two assets that move together.

### Lane 5 is the ETF sleeve

The four numbered lanes hold single names, which is where the return has to come from. Lane 5
is a $100 sleeve split into four $25 slots, each holding a different fund, so the league is
never four bets on the same story at once.

- **One fund per theme:** four semiconductor funds would be one bet wearing four hats. The
  sleeve takes the best-scoring fund of each theme, best theme first, and runs short rather than
  doubling up. Themes are drawn from eight groups - broad market (VOO, SPY),
  gold and silver (GLD, GDX), semiconductors (SMH, SOXX), the metals behind the data-centre
  build-out (COPX, CPER, XME), power and grid (XLU, URA, PAVE), AI and software (XLK, IGV, ARKK),
  energy and commodities (XLE, USO), and the remaining sectors. The list is in
  `universe.ETF_LANE_THEMES`.
- **What it may not hold:** leveraged funds (2×/3×) and crypto trusts (IBIT, ETHA). Ranking
  rewards movement, so left alone this lane fills with 2× crypto funds - the most volatile things
  that happen to be ETFs, and the exact opposite of what the lane is for. They stay eligible for
  the other three lanes.
- **Its own floors:** funds are calmer and thinner than single names, so they are measured against
  2.5% monthly volatility and $5M a day rather than 10% and $50M. The normal floors exclude GLD
  (7.1% vol) and VOO (2.8%) by construction, which is why the lane needs its own.
- **It still has to earn it:** the fund is chosen by the same walk-forward backtest as everything
  else. If no fund passes, the lane waits in cash rather than quietly handing its slot to a stock.
- **It is ballast, not the engine.** A fund moves less than a single name, so the sleeve is not a
  route to 22% a month - the four lanes carry that. It is there so one bad story cannot take the
  whole portfolio down with it.
- **Where the money came from:** the $100 reserve, by the owner's decision on Sept 23. Total risk
  is unchanged at $500 and all of it is now working, but there are no lane refills any more - a
  lane that falls to $70 closes for the rest of the run instead of reopening.
- **It is the same for all four managers.** The sleeve is diversification, not a contest, so the
  league table keeps measuring the four lanes where the brains actually differ.
- **Bar sizes:** crypto uses 15-minute bars with 180 days of history. Stocks and ETFs use 1-hour bars with 2 years of history, and trade in US market hours.
- **Strategies:** slow trend (regime), trend, breakout, dip-buying, news momentum, and buy-and-hold as the benchmark.
- **The give-back stop:** a lane sells everything once the price falls 12% below the best it has
  seen since that position opened. It never caps a winner - a position can run as far as it likes -
  it only limits the retreat, and it catches the slow bleed that the 24-hour day rules miss.
  Measured over 90 days of hourly bars it kept 91% of buy-and-hold's return while adding downside
  protection. A fixed daily take-profit band (sell at +2.5%, flat overnight) was measured at the
  same time and lost on 10 of 10 assets - daily round-trip fees and capped winners - so the system
  deliberately does not have one.
- **Passing a backtest:** a strategy is tuned on the older 2/3 of the price history. It passes only if it also made money, after fees, on the newer 1/3 it never saw.
- **The tournament:** every strategy trades its own paper copy of the lane. The real lane follows the leader, which is chosen from backtest results at first and live results as they build up.
- **Switching leaders:** it needs a clear margin and a minimum time as leader. If nothing is working, the lane sits in cash.
- **AI calls:** these run through headless `claude -p` on your Max plan, with no API key. There are at most 6 a day. Python checks every answer before anything changes.

## Radar: what we track beyond the four lanes

Rebuilt daily from the whole US market (about 12,000 listed stocks and ETFs) plus Coinbase's coins:

| Bucket | Size |
|---|---|
| Large caps | 250 |
| AI & tech | 60 |
| Fast small & mid caps | 150 |
| Penny stocks (exchange-listed, $0.50-$5, trading over $2M a day; no OTC) | 120 |
| Leveraged & sector ETFs | 34 |
| Crypto-linked stocks | 19 |
| Crypto | 20 |

Every 20 minutes each one is measured on **seven indicators**: trend (above its 20- and 50-day averages), momentum (20- and 5-day change, not overbought), strength against the S&P or bitcoin, unusual volume, breakout to a 20-day high, enough movement for 22% a month, and recent positive news.

An asset that fires **5 of 7** is not bought. It is backtested first, and only if a strategy passes does it reach the Scout, the watchlist and the managers. Each indicator's weight is tunable like the rest.

The **market regime** (S&P and Nasdaq versus their 50-day averages, plus the VIX) is shown alongside, and stock alerts are suppressed when the market is clearly risk-off.

## Venues: each lane trades where it is cheapest

| Assets | Venue | Cost |
|---|---|---|
| Coins listed on Crypto.com | Crypto.com | 0.25% / 0.5% |
| Other coins | Coinbase | 0.5% / 0.9% |
| Stocks and ETFs | Commission-free (Webull-style) | $0 commission; the cost is the spread: 3 bps on a large cap, 40 bps on a $1-5 penny stock |

Robinhood is **not** used for stocks: it has no official stock API and its terms forbid automated stock trading. Its crypto API is official, and can be added later.

## Data sources

- **Stocks:** Nasdaq's public screener (the whole market in one request), history and quotes, cached locally as daily bars; Yahoo as fallback and for hourly bars.
- **Crypto:** Coinbase and Crypto.com public APIs.
- **Market yardsticks:** SPY, QQQ and the CBOE VIX history.
- **Official Nasdaq API:** put the key in `.env` as `NASDAQ_API_KEY` with `NASDAQ_API_PRODUCT`; `stockdata.official_provider()` is where it plugs in.

## Day by day, week by week

- **Each league day** runs 24 hours from the moment the league started. When one finishes, Python writes a summary per manager (return, value, trades, fees, stops, best and worst lane, rank) and saves `data/reports/day-N.md`. A Mac notification carries the scoreboard.
- **The dashboard** shows today live at the top of the table, with every finished day beneath it.
- **Seven days roll into a week.** The week table shows each manager's weekly return and running total, so at week 6 you can read weeks 1-6 across all four managers in one place. It is also saved as `data/reports/weeks.md`.
- **The weekly review** (day 7, 14, ...) adds the AI write-up, tuning and, at weeks 4 and 6, the keep-or-retire calls.
- `.venv/bin/highway days` prints the same tables; `--day N` shows one day.

## The 6-week run and how it is kept honest

The league runs for **6 weeks**, from Sep 22 to around Nov 3, 2026.

| How often | What happens | Who decides |
|---|---|---|
| Every minute | Health checks: fresh prices, bars on schedule, news feeds up, Claude calls working, **money reconciles to the cent**, **rules obeyed** (no buy over $50, no −10% day left unsold, no lane over $150), no stuck orders, uptime | Automatic; a failure raises a Mac notification |
| Every 4 hours | The Claude manager re-decides its lanes | Automatic |
| Nightly | The Coach makes small, bounded setting tweaks | Automatic |
| **Weekly** | Review with scorecards, per-lane results, whether live results match the backtests, whether news predicted moves, and whether Claude's expected moves were realistic. At most 3 bounded tweaks. The report is saved to `data/reports/week-N.md` and shown on the dashboard. | Automatic tweaks, all logged |
| **Weeks 4 and 6** | Keep, watch or retire each manager, and whether the gaps between managers are bigger than noise. Week 6 adds a go/no-go recommendation for real money, and where (if anywhere) to host the dashboard. | **You** |

**What the scorecard shows for each manager:**
- Return and its monthly equivalent (never scaled up from less than 10 days).
- Worst and current drawdown, and a risk-adjusted return (from day 3).
- Win rate and average win versus average loss.
- Fees, and what share of the gains they eat.
- Turnover, stop-outs, take-profits, and return versus Hold.

## Sharing it

**Decision (Sep 22):** stays on localhost for the 6-week run. Hosting gets decided at week 6, alongside the go/no-go on real money.

`.venv/bin/highway publish` writes `data/public/index.html`: one self-contained file with the data embedded, so it opens anywhere, with a "snapshot · not live" marker and a paper-trading banner. Nothing leaves your Mac unless you push it.

To put it on GitHub Pages:
```
cd data/public && git init -b main && git remote add origin <repo URL>
.venv/bin/highway publish --push
```
Then enable Pages on that repo (Settings -> Pages -> Deploy from branch: main). A GitHub Pages site is public to anyone with the link, and the snapshot shows the full strategy, picks and settings. It contains no keys and no real money.

## Commands

```
.venv/bin/highway status          one-screen summary
.venv/bin/highway pause | resume  stop or allow new buys (exits and skims keep running)
.venv/bin/highway kill            sell everything and pause
.venv/bin/highway scout --claude  re-pick lanes now
.venv/bin/highway backtest SOL-USD
scripts/service.sh status | restart | logs | uninstall
```

## Data sources

- **Prices:** Coinbase public API, cross-checked against Crypto.com. Stock prices come from Yahoo's chart feed during US market hours; Coinbase's public API doesn't serve its stock products.
- **News:** CoinDesk, Cointelegraph, Decrypt, CNBC, MarketWatch, Google News and Yahoo per asset, and SEC 8-K filings, plus the Crypto Fear & Greed index.
- **Optional:** set `ALPHAVANTAGE_API_KEY` (free key) for per-ticker sentiment scores.

## Known paper-mode limits

- **Limit fills are optimistic.** A paper limit order fills when the price trades through it, and real queue position is ignored.
- **Stock prices are modeled.** Stock prices lag by up to a minute and use a modeled 3 bps spread.
- **Stocks trade regular hours only.** Paper mode assumes 9:30–16:00 ET.
- **Live trading is off.** Settings accept only `mode = "paper"`. Going live needs a separate Coinbase portfolio holding $500 and a trade-only API key that cannot withdraw.
