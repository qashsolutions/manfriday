# Highway

A paper-trading **league**: six managers, each running its own four-lane portfolio. Each lane
starts with $100 and a $100 reserve covers refills, so every manager has $500 at risk. It runs on
fake money with live prices, and the winner is the candidate to run real money later.

They all obey the same hard rules and run through the same order and risk code
(`portfolio.py`). **What differs is the slice of the market each may touch** — because when they
all picked from one universe they converged on the same handful of names: two of them measured
0.97 correlated and one added nothing the others did not already provide.

| Manager | May hold | How it decides |
|---|---|---|
| **Bluechip** | the S&P 500 giants (top 120 by market cap, refreshed daily) | six strategies compete per lane; the money follows whichever is winning |
| **ETF** | funds only: broad market, gold, semiconductors, life sciences, data-centre metals | the same contest, over funds |
| **Coinbase** | crypto listed on Coinbase | the same contest, over coins |
| **Momentum** | crypto on Crypto.com, at roughly half Coinbase's fees | one fixed rule: the strongest short-term movers still above their 20-day average |
| **Laser** | anything — the only manager with no mandate | an AI reads the portfolio, prices, news and web search every 4 hours; code validates every answer |
| **Hold** | one asset from each mandate | buys once and never changes: the yardstick |

Coinbase and Momentum hold much the same coins on purpose — between them they are a controlled
test of what execution cost alone does over six weeks.

Target: **12–15% a month**. The dashboard runs locally; see `scripts/service.sh` and the port in
`config/settings.toml`.

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

### Each manager has its own slice of the market

This is the only thing that separates them, and it exists because without it they converge.

- **Bluechip** takes the 120 largest US companies by market cap, rebuilt daily from a live
  screener rather than a fixed list.
- **ETF** takes funds only, one per theme — broad market (VOO), gold (GLD), semiconductors
  (SMH, SOXX), life sciences (XBI, XLV, IBB), the metals and power behind the data-centre
  build-out (COPX, CPER, URA). One fund per theme, or it is one bet wearing several hats.
  Leveraged funds and crypto trusts are barred: ranking rewards movement, so left alone this
  mandate fills with 2x crypto funds, the opposite of the point.
- **Coinbase** and **Momentum** take crypto, pinned to different venues.
- **Laser** may hold anything, which makes it the test of whether judgment beats a fixed universe.
- **Hold** takes one asset from each mandate so it can measure them all on the same footing.

Each slice gets its own volatility and liquidity floors. A single 10% monthly-volatility bar
would exclude **11 of the 15 largest US companies** and almost every fund, so blue chips and
funds are measured against their own.

**Average asset overlap between managers is 0.14.** Bluechip and ETF share nothing with anyone.

## Radar: what we track beyond the lanes

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

Every 20 minutes each one is measured on **seven indicators**: trend (above its 20- and 50-day averages), momentum (20- and 5-day change, not overbought), strength against the S&P or bitcoin, unusual volume, breakout to a 20-day high, enough movement for the monthly target, and recent positive news.

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
- **Seven days roll into a week.** The week table shows each manager's weekly return and running total, so at week 6 you can read weeks 1-6 across every manager in one place. It is also saved as `data/reports/weeks.md`.
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

**Decision (Sep 22):** the dashboard stays on the owner's own machine for the 6-week run. Hosting gets decided at week 6, alongside the go/no-go on real money.

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
