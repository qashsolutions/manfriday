"""Local dashboard at http://127.0.0.1:8787. Reads only from the database."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import metrics
from .config import Settings
from .db import DB

log = logging.getLogger(__name__)


def data(db: DB) -> dict:
    now = time.time()
    snap = db.get_state("snapshot", {})
    league_start = db.get_state("league_started") or now - 8 * 86400
    rows = db.query(
        "SELECT ts, portfolio, lane_id, equity, price FROM league_equity WHERE ts > ? ORDER BY ts",
        (min(league_start, now - 2 * 86400) - 600,),
    )
    totals: dict[str, list] = {}
    lanes: dict[str, dict[str, list]] = {}
    for r in rows:
        if r["lane_id"] == 0:
            if r["ts"] >= league_start - 600:
                totals.setdefault(r["portfolio"], []).append([r["ts"], round(r["equity"], 2)])
        elif r["lane_id"] > 0:
            lanes.setdefault(r["portfolio"], {}).setdefault(str(r["lane_id"]), []).append(
                [r["ts"], round(r["equity"], 2), r["price"]])
    return {
        "now": now,
        "snapshot": snap,
        "league_series": totals,
        "lane_series": lanes,
        "news": db.query("SELECT published, source, title, url, assets, sentiment, severity FROM news ORDER BY published DESC LIMIT 40"),
        "journal": db.query("SELECT ts, agent, content FROM journal ORDER BY ts DESC LIMIT 5"),
        "picks": {k: v for k, v in (db.get_state("scout_picks", {}) or {}).items() if k in ("ts", "lanes", "bench", "by", "scanned", "qualified", "candidates", "claude_notes", "claude_change", "momentum", "sleeve", "sleeve_considered")},
        "build": BUILD,
        "started": db.get_state("fund_started"),
        "league_started": db.get_state("league_started"),
    }


from .mandate import names as _mandate_names

MANAGER_NAMES = _mandate_names()



class Handler(BaseHTTPRequestHandler):
    db: DB

    def log_message(self, *args):  # keep the engine log clean
        pass

    def _send(self, body: bytes, ctype: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0]  # ignore query strings and fragments
        if path == "/api/data":
            self._send(json.dumps(data(self.db), default=str).encode(), "application/json")
        elif path == "/api/activity":
            self._send(json.dumps(metrics.activity(self.db, MANAGER_NAMES), default=str).encode(),
                       "application/json")
        elif path == "/api/manager":
            query = parse_qs(urlparse(self.path).query)
            pid = (query.get("id") or [""])[0]
            if pid not in MANAGER_NAMES:
                self.send_error(404)
                return
            self._send(json.dumps(metrics.ledger(self.db, pid, MANAGER_NAMES[pid]), default=str).encode(),
                       "application/json")
        elif path in ("/", "/index.html"):
            self._send(PAGE.encode(), "text/html; charset=utf-8")
        else:
            self.send_error(404)


def serve(s: Settings, db: DB | None = None) -> None:
    Handler.db = db or DB()
    try:
        server = ThreadingHTTPServer((s.dashboard.host, s.dashboard.port), Handler)
    except OSError as e:
        log.warning("dashboard not started: %s", e)
        return
    server.serve_forever()


PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Highway Paper League</title>
<style>
:root {
  color-scheme: light;
  --surface-0: #f3f2ef; --surface-1: #fcfcfb; --border: #e3e1dc;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #7a7974;
  --grid: #ebe9e4;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #8b5cf6; --s6: #0ea5b7;
  --good: #0ca30c; --good-text: #006300; --critical: #d03b3b; --warning: #fab219;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface-0: #111110; --surface-1: #1a1a19; --border: #2e2e2b;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86; --grid: #2a2a27;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #9d76f7; --s6: #21b3c4; --good-text: #3fcf3f;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-0: #111110; --surface-1: #1a1a19; --border: #2e2e2b;
  --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86; --grid: #2a2a27;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #9d76f7; --s6: #21b3c4; --good-text: #3fcf3f;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-0); color: var(--text-primary);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
.shell { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: 24px; max-width: 1360px; margin: 0 auto; padding: 20px 16px 48px; }
main { min-width: 0; }
nav.side { position: sticky; top: 20px; align-self: start; display: flex; flex-direction: column; gap: 2px; }
nav.side .brand { font-size: 17px; font-weight: 650; letter-spacing: -0.01em; margin-bottom: 10px; }
nav.side button { font: inherit; font-size: 14px; text-align: left; padding: 7px 10px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: var(--text-secondary); cursor: pointer; display: flex; justify-content: space-between; gap: 8px; }
nav.side button:hover { background: var(--surface-1); }
nav.side button.on { background: var(--surface-1); border-color: var(--border); color: var(--text-primary); font-weight: 600; }
nav.side button .tag { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
nav.side .status { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
section.page { display: none; }
section.page.on { display: block; }
section.page > h2:first-child { margin-top: 0; }
@media (max-width: 820px) {
  .shell { grid-template-columns: 1fr; gap: 10px; }
  nav.side { position: static; flex-direction: row; overflow-x: auto; padding-bottom: 6px; }
  nav.side .brand, nav.side .status { display: none; }
  nav.side button { white-space: nowrap; }
}
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; margin-bottom: 14px; }
h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-secondary); margin: 28px 0 10px; font-weight: 600; }
h2 .sub { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--text-muted); }
.muted { color: var(--text-muted); }
.pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); }
.pill.live::before { content: "●"; color: var(--good); margin-right: 5px; }
.pill.paused::before { content: "❚❚"; color: var(--warning); margin-right: 5px; font-size: 10px; }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.up { color: var(--good-text); } .down { color: var(--critical); }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 7px; vertical-align: baseline; }
.lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; }
.lane h3 { margin: 0; font-size: 15px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.lane .role { font-size: 12px; color: var(--text-muted); font-weight: 400; }
.lane .big { font-size: 24px; font-weight: 650; font-variant-numeric: tabular-nums; margin: 6px 0 2px; }
.lane dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 10px 0 0; font-size: 13px; }
.lane dt { color: var(--text-muted); } .lane dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.clips { display: inline-flex; gap: 3px; vertical-align: middle; }
.clips i { width: 14px; height: 8px; border-radius: 2px; border: 1px solid var(--c); }
.clips i.on { background: var(--c); }
.note { font-size: 12px; color: var(--text-secondary); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.chart { position: relative; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.tip { position: absolute; pointer-events: none; background: var(--surface-1); border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 9px; font-size: 12px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.12); display: none; font-variant-numeric: tabular-nums; z-index: 2; }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; flex-wrap: wrap; }
.legend span::before { content: ""; display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--c); margin-right: 6px; vertical-align: middle; }
.legend span.pace::before { border-top: 2px dashed var(--text-muted); }
.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border); padding: 6px 8px; white-space: nowrap; }
td { padding: 7px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; font-variant-numeric: tabular-nums; }
td.num, th.num { text-align: right; }
.board td { font-size: 14px; }
.board .rank { color: var(--text-muted); width: 24px; }
.board tr.pick { cursor: pointer; }
.board tr.pick:hover td { background: var(--grid); }
.board tr.pick.open td { background: var(--grid); }
.chev { color: var(--text-muted); font-size: 11px; margin-left: 4px; }
details.sect { margin: 14px 0 0; }
details.sect > summary { cursor: pointer; list-style: none; display: flex; align-items: baseline;
  gap: 8px; padding: 2px 0; font-size: 13px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: var(--text-secondary); }
details.sect > summary::-webkit-details-marker { display: none; }
details.sect > summary::before { content: "\25B8"; font-size: 11px; transition: transform .12s;
  color: var(--text-muted); text-transform: none; }
details.sect[open] > summary::before { transform: rotate(90deg); }
details.sect > summary .sub { font-weight: 400; letter-spacing: 0; text-transform: none; }
details.sect > summary:hover { color: var(--text-primary); }
details.sect > .body { margin-top: 8px; }
.lanes { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
.board tr.lanerow td { padding-top: 0; padding-bottom: 9px; }
.board tr:not(.lanerow) td { border-bottom: none; }
.lanechip { font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border);
            white-space: nowrap; font-variant-numeric: tabular-nums; }
.lanechip b { font-weight: 600; }
.lanechip.cash { color: var(--text-muted); font-style: italic; }
.lanechip.sleevechip { border-style: dashed; }
.side { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 4px; letter-spacing: .02em; }
.side-buy { color: var(--good-text); background: color-mix(in srgb, var(--good-text) 13%, transparent); }
.side-sell { color: var(--critical); background: color-mix(in srgb, var(--critical) 13%, transparent); }
details.mcard { margin-top: 8px; }
details.mcard > summary { cursor: pointer; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
details.mcard > summary .grow { flex: 1; }
#manager-detail h4 { margin: 0 0 6px; font-size: 13px; color: var(--text-secondary); font-weight: 600; }
a { color: inherit; text-decoration-color: var(--text-muted); }
.chip { font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); white-space: nowrap; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 10px; }
@media (max-width: 520px) { .grid2 { grid-template-columns: 1fr; } }
details.manager { margin-top: 10px; }
details summary { cursor: pointer; color: var(--text-secondary); font-size: 13px; padding: 4px 0; }
details.manager > summary { font-size: 14px; color: var(--text-primary); font-weight: 600; }
.journal p { margin: 4px 0 12px; white-space: pre-wrap; }
.dots { display: inline-flex; gap: 3px; }
.dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--border); display: inline-block; }
.dots i.on { background: var(--good); }
.filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.filters button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface-1); color: var(--text-secondary); cursor: pointer; }
.filters button.on { background: var(--text-primary); color: var(--surface-1); border-color: var(--text-primary); }
.health { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px 16px; }
.check { font-size: 13px; display: flex; gap: 8px; align-items: baseline; }
.check .icon { width: 18px; text-align: center; font-weight: 700; }
.check.ok .icon { color: var(--good-text); } .check.warn .icon { color: #b07800; } .check.fail .icon { color: var(--critical); }
.check .detail { color: var(--text-muted); font-size: 12px; }
.pill.ok::before { content: "✓"; color: var(--good-text); margin-right: 5px; }
.pill.warn::before { content: "⚠"; color: #b07800; margin-right: 5px; }
.pill.fail::before { content: "✗"; color: var(--critical); margin-right: 5px; }
</style>
</head>
<body>
<div class="shell">
  <nav class="side">
    <div class="brand">Highway</div>
    <button data-page="leaderboard" class="on">Leaderboard</button>
    <button data-page="days">Day &amp; week <span class="tag" id="nav-day"></span></button>
    <button data-page="managers">Managers</button>
    <button data-page="radar">Radar <span class="tag" id="nav-radar"></span></button>
    <button data-page="timing">Market clock</button>
    <button data-page="watchlist">Watchlist</button>
    <button data-page="activity">Trades &amp; events</button>
    <button data-page="news">News</button>
    <button data-page="notes">Notes &amp; reviews</button>
    <button data-page="tournaments">Strategies</button>
    <button data-page="health">Health <span class="tag" id="nav-health"></span></button>
    <div class="status">
      <span id="status" class="pill">loading…</span>
      <span id="health-pill" class="pill"></span>
      <span id="regime" class="pill"></span>
      <span id="week" class="pill"></span>
      <span id="updated" class="muted" style="font-size:12px"></span>
    </div>
  </nav>
  <main>
    <section class="page on" data-page="leaderboard">
  <h2>Leaderboard <span class="sub" id="board-sub"></span></h2>
  <div class="card tablewrap"><table class="board" id="board"></table></div>
  <div id="manager-detail"></div>
  <div class="card" style="margin-top:10px">
    <div class="filters" id="range-filters"></div>
    <div class="legend" id="league-legend"></div>
    <div class="chart" id="league-chart"></div>
  </div>

  <h2 style="margin-top:14px">Who is actually adding something <span class="sub" id="skill-sub"></span></h2>
  <div class="card"><div class="tablewrap" id="skill"></div>
    <div class="note"><b>Raw return ranks whoever took the most risk.</b> These columns take that out.
    <b>Beta</b> is how much of the benchmark's move a manager simply rode — below 1 means it carried less risk,
    so some of a lead is just lower exposure. <b>Alpha</b> is what is left after that, per day. <b>Adds</b> is
    what it contributes beyond what the other three already do between them: a manager that tracks the others
    scores ~0 here however well it is doing, because the league learns nothing from a duplicate. <b>Worth
    keeping</b> is how much the four of them together would get worse without it.
    <b>t</b> above 2 means a figure is bigger than the noise — until then it is not evidence, and early in a
    run nothing will be.</div>
  </div>

  <details class="card" style="margin-top:10px"><summary>Scorecard · risk, trading quality and fees since the league started</summary>
    <div class="tablewrap" id="scorecard" style="margin-top:8px"></div></details>

    </section>
    <section class="page" data-page="days">
  <details class="sect" data-sect="day-by-day" open>
    <summary>Day by day <span class="sub" id="days-sub"></span></summary>
    <div class="body">  <div class="card tablewrap" id="days"></div>
    </div>
  </details>
  <details class="sect" data-sect="week-by-week" open>
    <summary>Week by week <span class="sub">· each week rolls up its seven days · the full picture at week 6</span></summary>
    <div class="body">  <div class="card tablewrap" id="weeks"></div>

    </div>
  </details>
    </section>
    <section class="page" data-page="managers">
  <details class="sect" data-sect="managers" open>
    <summary>Managers <span class="sub">· each runs its own $500 under the same rules</span></summary>
    <div class="body">  <div id="managers"></div>
    </div>
  </details>
    </section>
    <section class="page" data-page="radar">
  <details class="sect" data-sect="radar" open>
    <summary>Radar <span class="sub" id="radar-sub"></span></summary>
    <div class="body">  <div class="card" id="radar-funnel"></div>
  <div class="card" style="margin-top:10px">
    <div class="filters" id="radar-filters"></div>
    <div class="tablewrap" id="radar"></div>
  </div>

    </div>
  </details>
    </section>
    <section class="page" data-page="timing">
      <details class="sect" data-sect="market-clock" open>
        <summary>Market clock <span class="sub" id="clock-sub"></span></summary>
        <div class="body">      <div class="card" id="clock-session" style="margin-bottom:10px"></div>
      <div class="card" id="clock-now" style="margin-bottom:10px"></div>
      <div class="grid2">
        <div><h2>Stocks: by weekday and window</h2><div class="card tablewrap" id="clock-equity"></div></div>
        <div><h2>Crypto: by weekday and window</h2><div class="card tablewrap" id="clock-crypto"></div></div>
      </div>
        </div>
      </details>
    </section>
    <section class="page" data-page="watchlist">
  <details class="sect" data-sect="watchlist">
    <summary>Watchlist <span class="sub">· tracked live on paper, no money · can take over any lane idle for a day</span></summary>
    <div class="body">  <div class="card tablewrap" id="bench"></div>

    </div>
  </details>
    </section>
    <section class="page" data-page="activity">
  <details class="sect" data-sect="money-made-and-lost" open>
    <summary>Money made and lost <span class="sub">· all four managers together</span></summary>
    <div class="body">  <div class="card">
    <div class="filters" id="activity-periods"></div>
    <div class="tablewrap" id="activity-league"></div>
    <div class="note"><b>Fund moved</b> is the real change in all four funds, including everything still
    held. <b>Booked</b> is only the profit from trades actually closed in that period — a winner still
    being held shows up in the first and not the second.</div>
  </div>
  <h2 style="margin-top:14px">Each manager <span class="sub">· click one to open its trades and events</span></h2>
  <div id="activity-cards"></div>
  <details class="card" style="margin-top:10px"><summary>Everything else · engine, radar, scout and health</summary>
    <div class="tablewrap" id="activity-system" style="margin-top:8px"></div></details>
    </div>
  </details>
    </section>
    <section class="page" data-page="news">
  <div class="grid2">
    <div><h2>News</h2><div class="card tablewrap" id="news"></div></div>
  </div>
    </section>
    <section class="page" data-page="notes">
      <details class="sect" data-sect="the-strategy" open>
        <summary>The strategy <span class="sub">· what this is trying to do, and what it would take</span></summary>
        <div class="body">      <div class="card" id="strategy"></div>
        </div>
      </details>
      <details class="sect" data-sect="how-each-manager-works">
        <summary>How each manager works <span class="sub">· same money, same rules, a different slice of the market</span></summary>
        <div class="body">      <div class="card" id="how-it-works"></div>
        </div>
      </details>
      <details class="sect" data-sect="ai-notes" open>
        <summary>Notes from the AI agents <span class="sub">· the Coach's nightly journal and the Scout's picks</span></summary>
        <div class="body"><div class="card journal" id="journal"></div></div>
      </details>
  <details class="sect" data-sect="weekly-reviews" open>
    <summary>Weekly reviews <span class="sub">· every 7 days for 6 weeks · small tweaks are automatic, big changes need you</span></summary>
    <div class="body">  <div class="card journal" id="reviews"></div>

    </div>
  </details>
    </section>
    <section class="page" data-page="tournaments">
  <details class="sect" data-sect="what-makes-a-manager-buy-or-sell">
    <summary>What makes a manager buy or sell <span class="sub">· the signal, then the gates</span></summary>
    <div class="body">  <div class="card" id="rulebook"></div>

  <h2 style="margin-top:14px">Live tournaments <span class="sub" id="standings-sub"></span></h2>
  <div class="card" id="standings"></div>
    </div>
  </details>
    </section>
    <section class="page" data-page="health">
  <details class="sect" data-sect="health" open>
    <summary>Health <span class="sub">· checked every minute</span></summary>
    <div class="body">  <div class="card health" id="health"></div>

    </div>
  </details>
    </section>
  </main>
</div>
<script>
const MANAGERS = {
  bluechip: {name: "Bluechip", c: "var(--s1)", about: "the S&P 500 giants that move the market"},
  etf:      {name: "ETF",      c: "var(--s5)", about: "funds only: S&P, gold, semiconductors, life sciences"},
  coinbase: {name: "Coinbase", c: "var(--s6)", about: "crypto, traded on Coinbase"},
  momentum: {name: "Momentum", c: "var(--s3)", about: "strongest movers, traded on Crypto.com"},
  laser:    {name: "Laser",    c: "var(--s2)", about: "AI judgment, free to pick anything"},
  hold:     {name: "Hold",     c: "var(--s4)", about: "the benchmark: buys once and never changes"},
};
const INDICATORS = ["trend", "momentum", "strength", "volume", "breakout", "movement", "news"];
const BUCKETS = {large_cap: "Large caps", ai_tech: "AI & tech", crypto_stocks: "Crypto stocks",
  leveraged_etfs: "Leveraged & sector ETFs", small_mid: "Small & mid caps", penny: "Penny stocks", crypto: "Crypto"};
let radarFilter = "alerts";
let chartRange = "all";
const RANGES = {
  day: {label: "Today", days: 1, bucket: 300},
  week: {label: "7 days", days: 7, bucket: 1800},
  month: {label: "1 month", days: 30, bucket: 7200},
  quarter: {label: "Quarter", days: 91, bucket: 21600},
  year: {label: "Year", days: 365, bucket: 86400},
  all: {label: "Lifetime", days: 99999, bucket: 86400},
};
let lastData = null;
let openManager = null;      // which leaderboard row is expanded
let ledgerPeriod = "day";    // day | week | month | quarter | year

// What one manager owns, what it has traded, and how each period went.
async function loadManager(pid) {
  try {
    const r = await fetch(`/api/manager?id=${encodeURIComponent(pid)}`, {cache: "no-store"});
    if (!r.ok) throw new Error(r.status);
    renderManager(await r.json());
  } catch (e) {
    $("manager-detail").innerHTML = `<div class="card" style="margin-top:10px"><p class="muted">Could not load that manager's ledger (${esc(String(e))}).</p></div>`;
  }
}

function renderManager(l) {
  if (openManager !== l.manager) return;   // the row was closed while this was in flight
  const held = l.holdings || [], trades = l.trades || [];
  const rows = (l.periods || {})[ledgerPeriod] || [];
  const heldTotal = held.reduce((a, h) => a + h.unrealised, 0);
  const booked = trades.reduce((a, t) => a + t.pnl, 0);
  const holdingsTable = held.length ? `
    <div class="tablewrap"><table>
      <tr><th>Lane</th><th>Holding</th><th>Bought</th><th class="num">Paid</th><th class="num">Worth now</th><th class="num">Unrealised</th></tr>
      ${held.map(h => `<tr><td>${h.lane}${h.lane > 4 ? ' <span class="muted">sleeve</span>' : ""}</td><td><b>${esc(h.asset)}</b></td>
        <td class="muted">${when(h.since)}</td><td class="num">${money(h.net_cost)}</td><td class="num">${money(h.value)}</td>
        <td class="num ${h.unrealised >= 0 ? "up" : "down"}">${money(h.unrealised)} (${signed(h.unrealised_pct)})</td></tr>`).join("")}
    </table></div>` : `<p class="muted">Holding nothing right now.</p>`;
  const periodTable = rows.length ? `
    <div class="tablewrap"><table>
      <tr><th>${ledgerPeriod[0].toUpperCase() + ledgerPeriod.slice(1)}</th><th class="num">Fund moved</th><th class="num">Value at end</th>
          <th class="num">Booked</th><th class="num">Fees</th><th class="num">Trades closed</th><th class="num">Winners</th></tr>
      ${rows.map(r => `<tr><td>${esc(r.period)}</td><td class="num ${r.return_pct >= 0 ? "up" : "down"}">${signed(r.return_pct)}</td>
        <td class="num">${money(r.end_value)}</td><td class="num ${r.realised >= 0 ? "up" : "down"}">${money(r.realised)}</td>
        <td class="num">${money(r.fees)}</td><td class="num">${r.trades}</td><td class="num">${r.trades ? r.wins + "/" + r.trades : "-"}</td></tr>`).join("")}
    </table></div>` : `<p class="muted">No history in this period yet.</p>`;
  const tradesTable = trades.length ? `
    <div class="tablewrap"><table>
      <tr><th>Sold</th><th>Holding</th><th>Bought</th><th class="num">Held</th><th class="num">Paid</th><th class="num">Sold for</th>
          <th class="num">Fees</th><th class="num">Result</th><th>Why it sold</th></tr>
      ${trades.map(t => `<tr><td class="muted">${when(t.closed)}</td><td><b>${esc(t.asset)}</b></td><td class="muted">${when(t.opened)}</td>
        <td class="num">${t.held_hours < 48 ? t.held_hours + "h" : (t.held_hours / 24).toFixed(1) + "d"}</td>
        <td class="num">${money(t.cost)}</td><td class="num">${money(t.proceeds)}</td><td class="num">${money(t.fees)}</td>
        <td class="num ${t.pnl >= 0 ? "up" : "down"}"><b>${money(t.pnl)}</b> (${signed(t.pnl_pct)})</td>
        <td class="muted">${esc(EXIT_WHY[t.exit] || t.exit)}</td></tr>`).join("")}
    </table></div>` : `<p class="muted">Nothing has been bought and sold again yet.</p>`;
  $("manager-detail").innerHTML = `<div class="card" style="margin-top:10px">
    <h3 style="margin:0 0 2px">${swatch(l.manager)}${esc(l.name)} · what it owns and what it has traded</h3>
    <p class="muted" style="margin:0 0 10px">What it holds now is worth ${money(Math.abs(heldTotal))}
      ${heldTotal >= 0 ? "more" : "less"} than it paid. ${trades.length} trade${trades.length === 1 ? " has" : "s have"} been closed
      ${trades.length ? (booked >= 0 ? `for a ${money(booked)} profit` : `at a ${money(-booked)} loss`) : ""}.</p>
    <h4>Holding now</h4>${holdingsTable}
    <h4 style="margin-top:14px">By period</h4>
    <div class="filters">${["day", "week", "month", "quarter", "year"].map(p =>
      `<button data-p="${p}" class="${ledgerPeriod === p ? "on" : ""}">${p[0].toUpperCase() + p.slice(1)}</button>`).join("")}</div>
    ${periodTable}
    <div class="note"><b>Fund moved</b> is the real change in this manager's $500, including positions it is still
    holding. <b>Booked</b> is only the profit from trades actually closed in that period. They differ whenever a
    winner is still being held — that is normal, not an error.</div>
    <h4 style="margin-top:14px">Closed trades</h4>${tradesTable}
  </div>`;
  $("manager-detail").querySelectorAll("[data-p]").forEach(b => b.onclick = () => {
    ledgerPeriod = b.dataset.p;
    renderManager(l);
  });
}

const EXIT_WHY = {
  stop_day: "hit the −10% day stop",
  take_profit_day: "hit the +15% day take-profit",
  giveback: "gave back 12% from its high",
  lane_floor: "lane fell to the $70 floor",
  signal: "the strategy said to get out",
  signal_market: "the strategy said to get out (sold at market)",
  news_exit: "the news turned against it",
  kill: "the owner stopped everything",
};

let activityPeriod = "day";   // day | week | month | quarter | year
let activityData = null;
let openCards = new Set();    // which manager cards the reader has opened

async function loadActivity() {
  if (window.HIGHWAY_SNAPSHOT) {   // static export: there is no server to ask
    $("activity-cards").innerHTML = `<div class="card"><p class="muted">Trades and events are only available on the live dashboard.</p></div>`;
    return;
  }
  try {
    const r = await fetch("/api/activity", {cache: "no-store"});
    if (!r.ok) throw new Error(r.status);
    activityData = await r.json();
    renderActivity();
  } catch (e) {
    $("activity-cards").innerHTML = `<div class="card"><p class="muted">Could not load the activity (${esc(String(e))}).</p></div>`;
  }
}

// The same reason code means opposite things on a buy and a sell: "signal" is the strategy
// saying get in, or saying get out.
function whyText(side, reason) {
  if (side === "buy") {
    return {
      signal: "the strategy said to buy",
      signal_market: "the strategy said to buy (at market)",
      scout: "the Scout picked it",
      sleeve: "filling the ETF sleeve",
      refill: "lane refilled and re-entered",
    }[reason] || reason;
  }
  return EXIT_WHY[reason] || reason;
}

// What each lane is holding, right now, on the leaderboard itself.
function laneChips(m) {
  const lanes = m.lanes || [];
  if (!lanes.length) return "";
  const chip = (l) => {
    if (l.status !== "active") return `<span class="lanechip cash">${l.lane} closed</span>`;
    if (!l.asset || !l.holding) return `<span class="lanechip cash">${l.lane} in cash</span>`;
    const cls = l.pnl_pct >= 0 ? "up" : "down";
    return `<span class="lanechip${l.kind === "etf" ? " sleevechip" : ""}" title="Lane ${l.lane}${l.kind === "etf" ? " · ETF sleeve" : ""} · ${money(l.value)}">
      <b>${esc(l.asset)}</b> <span class="${cls}">${signed(l.pnl_pct)}</span></span>`;
  };
  const main = lanes.filter(l => l.kind !== "etf");
  const sleeve = lanes.filter(l => l.kind === "etf");
  return `<div class="lanes">${main.map(chip).join("")}
    ${sleeve.length ? `<span class="lanechip cash" title="Lane 5: the ETF sleeve">sleeve</span>` + sleeve.map(chip).join("") : ""}</div>`;
}

// Alpha, contribution and how much of it is bigger than the noise.
// ---- Flagship diagrams -------------------------------------------------------------------
// Inline SVG so it inherits the theme's colour tokens and follows dark mode, and scales from a
// phone to a wide monitor from one viewBox. Every number is read from the live settings.

const SVG_FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

function radarFunnel(f) {
  if (!f || !f.tracked) return `<p class="muted">The radar has not completed a scan yet.</p>`;
  const STAGES = [
    [f.tracked, "scanned", "every asset in the buckets"],
    [f.alerts, "alerting", `${f.min_signals}+ of 7 indicators lit`],
    [f.passed, "survived a backtest", `of ${f.tested} tested out-of-sample`],
    [f.shortlisted, "on a shortlist", "inside a manager's mandate"],
    [f.held, "actually held", "won a lane on merit"],
  ];
  let b = `<text x="0" y="16" font-size="13" font-weight="700" fill="var(--text-primary)" letter-spacing="0.06em">A GREEN LIGHT IS NOT A BUY</text>
    <text x="860" y="16" text-anchor="end" font-size="12" fill="var(--text-muted)">· it is an invitation to be tested</text>
    <line x1="0" y1="26" x2="860" y2="26" stroke="var(--border)"/>`;
  const W = 152, GAP = 24;
  STAGES.forEach(([n, label, sub], i) => {
    const x = i * (W + GAP);
    const lit = i < 2 ? "var(--s1)" : i === 4 ? "var(--good-text)" : "var(--text-secondary)";
    b += `<rect x="${x}" y="46" width="${W}" height="78" rx="9" fill="var(--surface-1)" stroke="${lit}" stroke-width="1.5"/>
      <text x="${x + W / 2}" y="80" text-anchor="middle" font-size="24" font-weight="800" fill="${lit}">${n}</text>
      <text x="${x + W / 2}" y="99" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--text-primary)">${label}</text>
      <text x="${x + W / 2}" y="114" text-anchor="middle" font-size="10" fill="var(--text-muted)">${sub}</text>`;
    if (i < STAGES.length - 1) b += arrow(x + W + 4, 85, GAP - 8);
  });
  b += `<text x="0" y="152" font-size="12" fill="var(--text-secondary)">The seven indicators decide
      <tspan font-weight="700">what gets examined</tspan>, never what gets bought.</text>
    <text x="0" y="170" font-size="12" fill="var(--text-secondary)">A flagged name still has to survive a
      walk-forward backtest, out-score everything else in its manager's shortlist, and clear every buy gate.</text>`;
  const extra = (f.only_via_radar || []);
  b += `<rect x="0" y="188" width="860" height="66" rx="9"
      fill="color-mix(in srgb, var(--s1) 6%, transparent)" stroke="var(--s1)" stroke-width="1.5"/>
    <text x="18" y="210" font-size="12" font-weight="700" fill="var(--s1)">Is it earning its keep?</text>
    <text x="18" y="228" font-size="11.5" fill="var(--text-secondary)">${extra.length
      ? `Yes — ${extra.length} name${extra.length === 1 ? "" : "s"} reached a shortlist only because the radar flagged ${extra.length === 1 ? "it" : "them"}:`
      : "Not this scan — every flagged name was already in the top ranks, so the radar added nothing."}</text>
    ${extra.length ? `<text x="18" y="244" font-size="11.5" font-weight="600" fill="var(--text-primary)">${extra.join(", ")}
      <tspan font-weight="400" fill="var(--text-muted)">— the ordinary ranking would not have looked at them.</tspan></text>` : ""}`;
  return `<div style="padding:2px 0">${svgWrap(860, 264, "What the radar's green lights actually do",
    "A funnel from every scanned asset down to the few actually held, showing that the indicators decide what is tested rather than what is bought.",
    `<g transform="translate(0,4)">${b}</g>`)}</div>`;
}

function svgWrap(w, h, title, desc, body) {
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="height:auto;display:block;font-family:${SVG_FONT}"
    role="img" aria-labelledby="t-${title.replace(/\W/g, "")}" preserveAspectRatio="xMidYMin meet">
    <title id="t-${title.replace(/\W/g, "")}">${title}</title><desc>${desc}</desc>${body}</svg>`;
}

// A numbered band: the step number, its heading, and a hairline under it.
function band(y, n, heading, note) {
  // The note is right-aligned rather than placed after the heading: guessing a heading's pixel
  // width from its character count collides the moment the wording changes.
  return `<text x="0" y="${y}" font-size="13" font-weight="700" fill="var(--s1)">${n}</text>
    <text x="22" y="${y}" font-size="13" font-weight="700" fill="var(--text-primary)"
      letter-spacing="0.06em">${heading}</text>
    ${note ? `<text x="860" y="${y}" text-anchor="end" font-size="12" fill="var(--text-muted)">${note}</text>` : ""}
    <line x1="0" y1="${y + 10}" x2="860" y2="${y + 10}" stroke="var(--border)" stroke-width="1"/>`;
}

function moneyBlock(x, y, w, h, label, value, fill, stroke, dashed) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}"
      stroke="${stroke}" stroke-width="1.5"${dashed ? ' stroke-dasharray="5 4"' : ""}/>
    <text x="${x + w / 2}" y="${y + h / 2 - 3}" text-anchor="middle" font-size="15" font-weight="700"
      fill="var(--text-primary)">${value}</text>
    <text x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle" font-size="10.5"
      fill="var(--text-muted)">${label}</text>`;
}

function strategyDiagram(c, prm) {
  const lanes = c.lanes || 4, pr = (c.lane_principal || 100).toFixed(0);
  const total = (c.total || 500).toFixed(0), reserve = (c.reserve || 100).toFixed(0);
  const lo = c.target_low ?? 12, hi = c.target_high ?? 15;
  const slices = [
    ["bluechip", "Bluechip", "the S&P 500 giants"],
    ["etf", "ETF", "funds only: S&P, gold, chips, life sciences"],
    ["coinbase", "Coinbase", "crypto, traded on Coinbase"],
    ["momentum", "Momentum", "strongest movers, on Crypto.com"],
    ["laser", "Laser", "anything — the AI decides"],
    ["hold", "Hold", "buys once, never sells — the yardstick"],
  ];
  let body = "";

  // 1 · the money one manager gets
  body += band(24, "1", "EVERY MANAGER GETS THE SAME $" + total, "· paper money · nothing is real");
  const bw = 118, gap = 14;
  for (let i = 0; i < lanes; i++) {
    body += moneyBlock(i * (bw + gap), 46, bw, 62, "lane " + (i + 1), "$" + pr,
      "color-mix(in srgb, var(--s1) 9%, transparent)", "var(--s1)");
  }
  body += moneyBlock(lanes * (bw + gap) + 18, 46, bw, 62, "reserve", "$" + reserve,
    "transparent", "var(--text-muted)", true);
  body += `<text x="0" y="128" font-size="12" fill="var(--text-secondary)">
    Each lane holds <tspan font-weight="600">one asset</tspan> and buys in $50 clips. The reserve is held back to
    reopen a lane that fails.</text>`;

  // 2 · what makes them different
  body += band(170, "2", "EACH HUNTS IN A DIFFERENT MARKET", "· this is the only thing that differs");
  slices.forEach(([id, name, what], i) => {
    const y = 194 + i * 30;
    body += `<rect x="0" y="${y}" width="10" height="10" rx="3" fill="var(--${id === "bluechip" ? "s1" :
      id === "etf" ? "s5" : id === "coinbase" ? "s6" : id === "momentum" ? "s3" : id === "laser" ? "s2" : "s4"})"/>
      <text x="20" y="${y + 9.5}" font-size="13" font-weight="600" fill="var(--text-primary)">${name}</text>
      <text x="108" y="${y + 9.5}" font-size="12.5" fill="var(--text-secondary)">${what}</text>`;
  });
  body += `<text x="0" y="386" font-size="12" fill="var(--text-secondary)">
    They used to all pick from one list and kept buying the same things — two ended up
    <tspan font-weight="600">0.97 alike</tspan>. Now they barely overlap.</text>`;

  // 3 · the guardrails
  body += band(428, "3", "THE SAME GUARDRAILS BIND ALL SIX", "· written in code, no manager can reach them");
  const rules = [
    [`${Math.abs(c.stop || 7)}% down in a day`, "sell everything", "var(--critical)"],
    [`+${c.take || 12}% up in a day`, "sell everything", "var(--good-text)"],
    [`${c.giveback || 20}% off its best price`, "sell everything", "var(--critical)"],
    [`$${(c.max_buy || 50).toFixed(0)} per buy, max`, "never more", "var(--text-secondary)"],
  ];
  rules.forEach(([head, sub, col], i) => {
    const x = i * 218;
    body += `<rect x="${x}" y="450" width="200" height="54" rx="9" fill="var(--surface-1)"
        stroke="${col}" stroke-width="1.5" opacity="0.95"/>
      <text x="${x + 100}" y="472" text-anchor="middle" font-size="12.5" font-weight="700" fill="${col}">${head}</text>
      <text x="${x + 100}" y="490" text-anchor="middle" font-size="11" fill="var(--text-muted)">${sub}</text>`;
  });

  // 4 · cash is a position
  body += band(546, "4", "SITTING IN CASH IS A POSITION", "· not a failure to trade");
  const CASH = [
    ["Nothing is working", "no strategy wants in, so the lane waits"],
    ["The move is too small", `it must beat ${(prm && prm.fee_edge_multiple) || 1.5}× the trading cost`],
    ["Just been stopped out", "a cooling-off period after a sale"],
    ["Cannot trade safely", "market shut, stale price, venues disagree"],
    ["Something looks wrong", "bad news, earnings due, a weak hour"],
    ["Money not free yet", "a stock sale settles the next day"],
  ];
  CASH.forEach(([head, sub], i) => {
    const x = (i % 3) * 290, y = 568 + Math.floor(i / 3) * 52;
    body += `<rect x="${x}" y="${y}" width="272" height="42" rx="8" fill="var(--surface-1)" stroke="var(--border)"/>
      <text x="${x + 14}" y="${y + 18}" font-size="12" font-weight="700" fill="var(--text-primary)">${head}</text>
      <text x="${x + 14}" y="${y + 33}" font-size="11" fill="var(--text-muted)">${sub}</text>`;
  });
  body += `<text x="0" y="686" font-size="12" fill="var(--text-secondary)">
    Every one of those is <tspan font-weight="600">deliberate</tspan>. A $50 clip that pays the spread for a move
    too small to cover it loses money with perfect discipline.</text>`;

  // 5 · the goal
  body += band(724, "5", "THE TARGET", "· and what it honestly takes");
  body += `<rect x="0" y="746" width="860" height="66" rx="10"
      fill="color-mix(in srgb, var(--s1) 7%, transparent)" stroke="var(--s1)" stroke-width="1.5"/>
    <text x="24" y="778" font-size="26" font-weight="800" fill="var(--s1)">${lo}–${hi}%</text>
    <text x="150" y="771" font-size="13" fill="var(--text-primary)">a month, which is about
      <tspan font-weight="700">${(Math.pow(1 + ((c.target_pct ?? 13.5) / 100), 12)).toFixed(1)}× a year</tspan>.</text>
    <text x="150" y="790" font-size="12" fill="var(--text-muted)">That is roughly
      ${((Math.pow(1 + ((c.target_pct ?? 13.5) / 100), 1 / 30) - 1) * 100).toFixed(2)}% a day, every day, after fees —
      a high bar, not a promise.</text>`;

  return `<div style="padding:4px 0 2px">${svgWrap(860, 822, "How the strategy works",
    "Five steps: the money each manager gets, the market each may touch, the guardrails that bind them all, when it deliberately holds cash, and the target.",
    `<g transform="translate(0,4)">${body}</g>`)}</div>`;
}

function arrow(x, y, len) {
  return `<line x1="${x}" y1="${y}" x2="${x + len - 9}" y2="${y}" stroke="var(--text-muted)" stroke-width="1.5"/>
    <path d="M${x + len} ${y} l-9 -5 v10 z" fill="var(--text-muted)"/>`;
}

function managerDiagram(c, pr) {
  const M = [["bluechip", "s1", "Bluechip"], ["etf", "s5", "ETF"], ["coinbase", "s6", "Coinbase"],
             ["momentum", "s3", "Momentum"], ["laser", "s2", "Laser"], ["hold", "s4", "Hold"]];
  const SIG = ["a contest of 6 strategies", "a contest of 6 strategies", "a contest of 6 strategies",
               "one fixed rule: top movers", "the AI, every 4 hours", "never — it just holds"];
  const GATES = [
    `Is $${(c.max_buy || 50).toFixed(0)} or less, one per bar`,
    `Beats ${pr.fee_edge_multiple || 1.5}× the trading cost`,
    "Not cooling off after a sale",
    "Price fresh, venues agree",
    "News not clearly negative",
    "Inside stock market hours",
    "Decision less than 4h old",
  ];
  let b = "";
  b += `<text x="0" y="16" font-size="13" font-weight="700" fill="var(--text-primary)" letter-spacing="0.06em">EVERY TRADE PASSES THROUGH TWO LAYERS</text>
    <text x="860" y="16" text-anchor="end" font-size="12" fill="var(--text-muted)">· only the first one differs between managers</text>
    <line x1="0" y1="26" x2="860" y2="26" stroke="var(--border)"/>`;

  // column 1: the signal
  b += `<text x="0" y="58" font-size="11.5" font-weight="700" fill="var(--s1)" letter-spacing="0.08em">1 · THE SIGNAL</text>
    <text x="0" y="74" font-size="11" fill="var(--text-muted)">what each manager decides</text>`;
  M.forEach(([id, col, name], i) => {
    const y = 92 + i * 34;
    b += `<rect x="0" y="${y}" width="250" height="28" rx="7" fill="var(--surface-1)" stroke="var(--border)"/>
      <rect x="0" y="${y}" width="4" height="28" rx="2" fill="var(--${col})"/>
      <text x="14" y="${y + 18}" font-size="12" font-weight="700" fill="var(--text-primary)">${name}</text>
      <text x="92" y="${y + 18}" font-size="11.5" fill="var(--text-secondary)">${SIG[i]}</text>`;
  });
  b += arrow(262, 195, 34);

  // column 2: the gates
  b += `<text x="310" y="58" font-size="11.5" font-weight="700" fill="var(--s1)" letter-spacing="0.08em">2 · THE GATES</text>
    <text x="310" y="74" font-size="11" fill="var(--text-muted)">identical for all six — every one must pass</text>
    <rect x="310" y="84" width="300" height="${GATES.length * 26 + 16}" rx="9" fill="var(--surface-1)" stroke="var(--border)"/>`;
  GATES.forEach((g, i) => {
    const y = 104 + i * 26;
    b += `<circle cx="326" cy="${y + 3}" r="6" fill="none" stroke="var(--good-text)" stroke-width="1.6"/>
      <path d="M323 ${y + 3} l2.4 2.6 l4.6 -5.4" fill="none" stroke="var(--good-text)" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
      <text x="340" y="${y + 7}" font-size="11.5" fill="var(--text-secondary)">${g}</text>`;
  });
  b += arrow(622, 195, 34);

  // column 3: what happens
  b += `<text x="670" y="58" font-size="11.5" font-weight="700" fill="var(--s1)" letter-spacing="0.08em">3 · THE ORDER</text>
    <text x="670" y="74" font-size="11" fill="var(--text-muted)">how it actually buys</text>
    <rect x="670" y="84" width="190" height="112" rx="9"
      fill="color-mix(in srgb, var(--good-text) 8%, transparent)" stroke="var(--good-text)" stroke-width="1.5"/>
    <text x="765" y="112" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text-primary)">$${(c.max_buy || 50).toFixed(0)} clip</text>
    <text x="765" y="132" text-anchor="middle" font-size="11" fill="var(--text-secondary)">rests at the bid price</text>
    <text x="765" y="150" text-anchor="middle" font-size="11" fill="var(--text-secondary)">(the cheap side)</text>
    <text x="765" y="176" text-anchor="middle" font-size="10.5" fill="var(--text-muted)">unfilled? cancelled,</text>
    <text x="765" y="189" text-anchor="middle" font-size="10.5" fill="var(--text-muted)">re-priced next bar</text>
    <text x="670" y="224" font-size="11" fill="var(--text-muted)">If any gate fails,</text>
    <text x="670" y="239" font-size="11" fill="var(--text-muted)">nothing happens at all.</text>`;

  // the override band
  const y0 = 316;
  b += `<rect x="0" y="${y0}" width="860" height="96" rx="10"
      fill="color-mix(in srgb, var(--critical) 5%, transparent)" stroke="var(--critical)" stroke-width="1.5"/>
    <text x="20" y="${y0 + 26}" font-size="12" font-weight="700" fill="var(--critical)" letter-spacing="0.06em">THESE SELL EVERYTHING — WHATEVER THE MANAGER THINKS</text>
    <text x="860 - 20" y="${y0 + 26}" text-anchor="end" font-size="11" fill="var(--text-muted)">confirmed on two price checks in a row</text>`;
  [[`${Math.abs(c.stop || 7)}% down`, "in one day"], [`+${c.take || 12}% up`, "in one day"],
   [`${c.giveback || 20}% off`, "its best price"], [`lane hits $${(c.lane_floor || 70).toFixed(0)}`, "closed and refilled"]]
    .forEach(([head, sub], i) => {
      const x = 22 + i * 210;
      b += `<text x="${x}" y="${y0 + 58}" font-size="15" font-weight="800" fill="var(--text-primary)">${head}</text>
        <text x="${x}" y="${y0 + 76}" font-size="11" fill="var(--text-muted)">${sub}</text>`;
    });
  return `<div style="padding:4px 0 10px">${svgWrap(860, 424, "How a manager decides to trade",
    "Three stages: the signal each manager produces, the shared gates every trade must pass, and the order that results. Plus the hard sells that override everything.",
    `<g transform="translate(0,4)">${b}</g>`)}</div>`;
}

function agentsDiagram(pr) {
  const AG = [
    ["Scout", "s1", "once a day", "scans the market, picks everyone's four assets"],
    ["Laser", "s2", `every ${pr.laser_manager_hours || 4} hours`, "reads news and prices, sets its own lanes"],
    ["Coach", "s3", "every night", "reviews the day, nudges the tunable settings"],
    ["Reviewer", "s5", "every 7 days", "writes the weekly report you read"],
  ];
  let b = "";
  b += `<text x="0" y="16" font-size="13" font-weight="700" fill="var(--text-primary)" letter-spacing="0.06em">HOW AI IS USED — AND WHERE IT IS NOT</text>
    <text x="860" y="16" text-anchor="end" font-size="12" fill="var(--text-muted)">· four agents, on a schedule</text>
    <line x1="0" y1="26" x2="860" y2="26" stroke="var(--border)"/>`;
  // Name and cadence on the first line, the description on its own line beneath. SVG does not
  // wrap text, so a description sharing a line with the name overflowed into the arrows.
  AG.forEach(([name, col, when, what], i) => {
    const y = 48 + i * 58;
    b += `<rect x="0" y="${y}" width="330" height="48" rx="8" fill="var(--surface-1)" stroke="var(--border)"/>
      <rect x="0" y="${y}" width="4" height="48" rx="2" fill="var(--${col})"/>
      <text x="16" y="${y + 20}" font-size="13" font-weight="700" fill="var(--text-primary)">${name}</text>
      <text x="316" y="${y + 20}" text-anchor="end" font-size="11" font-weight="600" fill="var(--${col})">${when}</text>
      <text x="16" y="${y + 38}" font-size="11.5" fill="var(--text-secondary)">${what}</text>`;
    b += arrow(342, y + 24, 30);
  });

  // the validation gate everything must pass
  b += `<rect x="386" y="48" width="200" height="222" rx="10"
      fill="color-mix(in srgb, var(--s1) 7%, transparent)" stroke="var(--s1)" stroke-width="2"/>
    <text x="486" y="120" text-anchor="middle" font-size="14" font-weight="800" fill="var(--s1)">OUR ALGORITHM</text>
    <text x="486" y="140" text-anchor="middle" font-size="12.5" font-weight="800" fill="var(--s1)">CHECKS EVERY ANSWER</text>
    <text x="486" y="172" text-anchor="middle" font-size="11" fill="var(--text-secondary)">Is the asset allowed?</text>
    <text x="486" y="191" text-anchor="middle" font-size="11" fill="var(--text-secondary)">Is the size legal?</text>
    <text x="486" y="210" text-anchor="middle" font-size="11" fill="var(--text-secondary)">Does it break a rule?</text>
    <text x="486" y="240" text-anchor="middle" font-size="11" font-weight="700" fill="var(--critical)">A bad answer is binned.</text>`;
  b += arrow(598, 159, 30);
  b += `<rect x="640" y="114" width="220" height="90" rx="10" fill="var(--surface-1)" stroke="var(--border)"/>
    <text x="750" y="144" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text-primary)">The same order code</text>
    <text x="750" y="164" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text-primary)">every manager uses</text>
    <text x="750" y="186" text-anchor="middle" font-size="11" fill="var(--text-muted)">no shortcuts, no exceptions</text>`;
  b += `<rect x="0" y="298" width="860" height="52" rx="10"
      fill="color-mix(in srgb, var(--critical) 5%, transparent)" stroke="var(--critical)" stroke-width="1.5"/>
    <text x="20" y="320" font-size="12.5" font-weight="700" fill="var(--critical)">No AI ever places an order.</text>
    <text x="20" y="338" font-size="11.5" fill="var(--text-secondary)">An agent can only suggest which asset a lane should hold and how big. Everything else — the buying, the selling, the guardrails — is plain code.</text>`;
  return `<div style="padding:4px 0 10px">${svgWrap(860, 362, "How AI is used",
    "Four AI agents run on a schedule. Every answer is checked by the algorithm before it can affect money, and no agent ever places an order.",
    `<g transform="translate(0,4)">${b}</g>`)}</div>`;
}

// The whole rulebook, with every number read from the live settings so the page cannot drift
// from the code that actually trades.
function renderRulebook(s) {
  const p = s.params || {}, c = s.capital || {};
  const n = (v, d) => (v === undefined || v === null ? d : v);
  const SIGNALS = [
    ["bluechip", "Strategy tournament", "Six strategies trade a paper copy of each lane; the real money follows whichever is winning. A leader change needs a clear margin (" + n(p.switch_margin_pct, 1) + "%) and a minimum time in front. If nothing is working, the lane sits in cash."],
    ["etf", "Strategy tournament", "Same contest, run over funds only."],
    ["coinbase", "Strategy tournament", "Same contest, run over coins Coinbase lists."],
    ["momentum", "One fixed rule, no judgement", "Ranks everything by " + Math.round(n(p.momentum_w30, 0.6) * 100) + "% of the 30-day move plus " + Math.round((1 - n(p.momentum_w30, 0.6)) * 100) + "% of the 7-day move. An asset only qualifies while it is above its 20-day average and up over the week. Holds the top four and keeps each while it stays inside the top " + Math.round(n(p.momentum_keep_top, 8)) + "."],
    ["laser", "The AI decides", "Every " + n(p.laser_manager_hours, 4) + " hours, and again just after the US open when it holds stocks, the AI is given the portfolio, the ranked candidates, prices, news and the market mood, and returns an asset and 0, 1 or 2 clips per lane with a reason. The algorithm checks every answer before anything moves."],
    ["hold", "Buys once, never sells", "Takes its four assets at the start and never changes them. Only the hard rules below can make it trade."],
  ];
  const STRATS = [
    ["regime", "slow trend", "price is above its multi-day average <b>and</b> that average is rising", "price falls below the trend by its buffer"],
    ["trend", "moving averages", "fast average above slow, price above slow, slow still rising", "fast crosses back below slow, or price drops an ATR below it"],
    ["breakout", "new highs", "a new high for the window <b>and</b> volume above 1.5&times; average", "a trailing stop 3 ATR under the peak, or the lower channel breaks"],
    ["dip", "mean reversion", "RSI below its threshold <b>and</b> price under the lower band", "price returns to the middle band, or a time stop after 96 bars"],
    ["session", "time of day", "the part of the day this asset has historically been strong", "before the part it has historically been weak"],
    ["news", "headlines", "3+ articles, score above threshold, <b>and</b> the 4-hour price agrees", "the score turns negative, or 48 bars pass"],
  ];
  $("rulebook").innerHTML = managerDiagram(c, p) + `
    <p>Every manager runs the same money and the same risk engine. Two things decide a trade: the
    <b>signal</b>, which is the only part that differs between them, and the <b>gates</b>, which are
    identical for all six and which a signal must clear before anything actually happens.</p>

    <h4>1 &middot; The signal &mdash; what each manager decides</h4>
    <div class="tablewrap"><table>
      <tr><th>Manager</th><th>Decided by</th><th>How</th></tr>
      ${SIGNALS.map(([id, how, text]) => `<tr><td>${swatch(id)}<b>${esc(MANAGERS[id]?.name || id)}</b></td>
        <td class="muted" style="white-space:nowrap">${esc(how)}</td><td>${text}</td></tr>`).join("")}
    </table></div>

    <h4 style="margin-top:14px">The six strategies in the tournament</h4>
    <div class="tablewrap"><table>
      <tr><th>Strategy</th><th>Idea</th><th>Buys when</th><th>Sells when</th></tr>
      ${STRATS.map(([k, idea, buy, sell]) => `<tr><td><b>${k}</b></td><td class="muted">${idea}</td>
        <td>${buy}</td><td>${sell}</td></tr>`).join("")}
    </table></div>

    <h4 style="margin-top:14px">2 &middot; The gates &mdash; a buy must clear all of these</h4>
    <ul class="muted" style="margin:6px 0 0 18px;font-size:13px;line-height:1.7">
      <li><b>Size:</b> at most $${n(c.max_buy, 50)} a buy, one clip per bar, ${n(c.max_buys_per_day, 4)} buys per lane per 24h, and the lane below its $${n(c.lane_cap, 150)} cap.</li>
      <li><b>The fee test:</b> the expected move must beat <b>${n(p.fee_edge_multiple, 1.5)}&times; the full round-trip cost</b>. At $50 clips this is what blocks a trade most often.</li>
      <li><b>Settled cash only</b> &mdash; a stock sale cannot be respent until the next business day.</li>
      <li><b>Cooldown:</b> ${n(p.cooldown_after_stop_h, 24)}h after a stop, ${n(p.cooldown_after_tp_h, 4)}h after a take-profit or give-back${n(p.cooldown_after_signal_h, 0) > 0 ? ", " + p.cooldown_after_signal_h + "h after a plain strategy exit" : ". A plain strategy exit has no cooldown &mdash; measured, it made no difference"}.</li>
      <li><b>Price sanity:</b> the quote must be fresh, and the two venues must not disagree by more than ${n(c.divergence_pct, 2)}%.</li>
      <li><b>News veto:</b> three or more articles averaging clearly negative.</li>
      <li><b>Weak window:</b> a time of day this asset has historically been poor in.</li>
      <li><b>Stock hours:</b> 9:30&ndash;16:00 ET only, nothing in the first ${n(p.no_entry_first_minutes, 5)} or last ${n(p.no_entry_last_minutes, 30)} minutes, nothing within ${n(p.earnings_blackout_days, 2)} days of earnings.</li>
      <li><b>Stale decisions:</b> older than ${n(p.stale_decision_hours, 4)} hours, or made before today's open, get re-checked against the current price and news first.</li>
      <li><b>Pending swap:</b> a lane already committed to a different asset may sell, never buy.</li>
      ${n(p.min_hold_hours, 0) > 0 ? `<li><b>Minimum hold:</b> a strategy may not sell a position younger than ${p.min_hold_hours}h. Hard rules still can.</li>` : ""}
    </ul>

    <h4 style="margin-top:14px">3 &middot; The sells that fire whatever the manager thinks</h4>
    <div class="tablewrap"><table>
      <tr><th>Trigger</th><th class="num">Level</th><th>Measured against</th></tr>
      <tr><td>Day stop</td><td class="num down"><b>${n(c.stop, -10)}%</b></td><td>the price ${n(c.day_hours, 24)} hours ago, or the entry price if bought since</td></tr>
      <tr><td>Day take-profit</td><td class="num up"><b>+${n(c.take, 15)}%</b></td><td>the same basis</td></tr>
      <tr><td>Give-back stop</td><td class="num down"><b>&minus;${n(c.giveback, 12)}%</b></td><td>the best price seen since the position opened</td></tr>
      <tr><td>Lane floor</td><td class="num">$${n(c.lane_floor, 70)}</td><td>the lane closes and is refilled from the reserve</td></tr>
    </table></div>
    <div class="note">All three price rules confirm on <b>two consecutive price checks</b>, so one bad print
    cannot trigger a sale. A "day" is a <b>rolling ${n(c.day_hours, 24)} hours</b> &mdash; nothing resets at midnight.</div>

    <h4 style="margin-top:14px">How the order is actually placed</h4>
    <p class="muted" style="font-size:13px">A buy rests as a <b>limit order at the bid</b> &mdash; the maker side, roughly half the cost of
    crossing the spread. If the price never comes back to it the order is cancelled and re-priced on the next bar. A sell rests at
    the ask, but if it has not filled by expiry it <b>goes out at market</b>, so an exit is never missed. The hard-rule sells above
    skip the queue entirely and go straight to market.</p>

    <div class="note"><b>The mandate sits on top of all of it.</b> Bluechip can only ever buy S&amp;P giants, ETF only funds,
    Coinbase only coins Coinbase lists, Momentum only coins Crypto.com lists. A signal for anything outside a manager's mandate
    is never generated in the first place.</div>`;
}

function renderSkill(sk) {
  const rows = (sk && sk.rows) || [];
  if (!rows.length) {
    $("skill").innerHTML = `<p class="muted">Not enough of the league recorded yet.</p>`;
    $("skill-sub").textContent = "";
    return;
  }
  $("skill-sub").textContent = `· ${sk.samples} hourly readings over ${sk.hours}h · measured against ${sk.benchmark}`;
  const sig = (t) => Math.abs(t) >= 2 ? `<b>${signed(t)}</b>` : `<span class="muted">${signed(t)}</span>`;
  $("skill").innerHTML = `<table>
    <tr><th>Manager</th><th class="num">Return</th><th class="num">Beta</th><th class="num">Alpha / day</th>
        <th class="num">t</th><th class="num">Info ratio</th><th class="num">Chance it is real</th>
        <th class="num">Adds / day</th><th class="num">t</th><th class="num">Worth keeping</th></tr>
    ${rows.map(r => `<tr>
      <td>${swatch(r.id)}<b>${esc(r.name)}</b>${r.is_benchmark ? ' <span class="muted">· the benchmark</span>' : ""}</td>
      <td class="num ${r.return_pct >= 0 ? "up" : "down"}">${signed(r.return_pct)}</td>
      <td class="num">${r.beta.toFixed(2)}</td>
      <td class="num ${r.is_benchmark ? "muted" : r.alpha_day_pct >= 0 ? "up" : "down"}">${r.is_benchmark ? "–" : signed(r.alpha_day_pct)}</td>
      <td class="num">${r.is_benchmark ? "–" : sig(r.alpha_t)}</td>
      <td class="num">${r.is_benchmark ? "–" : r.info_ratio.toFixed(2)}</td>
      <td class="num">${(r.psr * 100).toFixed(0)}%</td>
      <td class="num ${r.added_day_pct >= 0 ? "up" : "down"}">${signed(r.added_day_pct)}</td>
      <td class="num">${sig(r.added_t)}</td>
      <td class="num ${r.contribution >= 0 ? "up" : "down"}">${r.contribution.toFixed(3)}</td></tr>`).join("")}
  </table>`;
}

function sideChip(side) {
  return `<span class="side side-${side === "buy" ? "buy" : "sell"}">${side === "buy" ? "BOUGHT" : "SOLD"}</span>`;
}

function periodTable(rows, showGain) {
  if (!rows || !rows.length) return `<p class="muted">Nothing in this period yet.</p>`;
  const head = activityPeriod[0].toUpperCase() + activityPeriod.slice(1);
  return `<table>
    <tr><th>${head}</th><th class="num">Fund moved</th>${showGain ? '<th class="num">In dollars</th>' : ""}
        <th class="num">Booked</th><th class="num">Fees</th><th class="num">Trades closed</th><th class="num">Winners</th></tr>
    ${rows.map(r => `<tr><td>${esc(r.period)}</td>
      <td class="num ${r.return_pct >= 0 ? "up" : "down"}">${signed(r.return_pct)}</td>
      ${showGain ? `<td class="num ${r.gain >= 0 ? "up" : "down"}"><b>${money(r.gain)}</b></td>` : ""}
      <td class="num ${r.realised >= 0 ? "up" : "down"}">${money(r.realised)}</td>
      <td class="num">${money(r.fees)}</td><td class="num">${r.trades}</td>
      <td class="num">${r.trades ? r.wins + "/" + r.trades : "–"}</td></tr>`).join("")}
  </table>`;
}

function renderActivity() {
  const a = activityData;
  if (!a) return;
  $("activity-periods").innerHTML = ["day", "week", "month", "quarter", "year"].map(k =>
    `<button data-ap="${k}" class="${activityPeriod === k ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("");
  $("activity-periods").querySelectorAll("[data-ap]").forEach(b => b.onclick = () => {
    activityPeriod = b.dataset.ap;
    renderActivity();
  });
  $("activity-league").innerHTML = periodTable((a.league || {})[activityPeriod], true);

  const order = ["bluechip", "etf", "coinbase", "momentum", "laser", "hold"];
  $("activity-cards").innerHTML = order.filter(id => a.managers[id]).map(id => {
    const m = a.managers[id];
    const mine = (m.periods || {})[activityPeriod] || [];
    const trades = m.fills.length ? `<div class="tablewrap"><table>
        <tr><th>When</th><th>Lane</th><th>Holding</th><th>Side</th><th class="num">Amount</th><th class="num">Fee</th><th class="num">Result</th><th>Why</th></tr>
        ${m.fills.map(f => `<tr><td style="white-space:nowrap" class="muted">${when(f.ts)}</td>
          <td>${f.lane_id}${f.lane_id > 4 ? ' <span class="muted">sleeve</span>' : ""}</td>
          <td><b>${esc(f.asset)}</b></td><td>${sideChip(f.side)}</td>
          <td class="num">${money(f.cash)}</td><td class="num muted">${money(f.fee)}</td>
          <td class="num ${f.closed_pnl == null ? "muted" : f.closed_pnl >= 0 ? "up" : "down"}">
            ${f.closed_pnl == null ? "–" : `<b>${money(f.closed_pnl)}</b> (${signed(f.closed_pnl_pct)})`}</td>
          <td class="muted">${esc(whyText(f.side, f.reason))}</td></tr>`).join("")}
      </table></div>` : `<p class="muted">No trades yet.</p>`;
    const events = m.events.length ? `<div class="tablewrap"><table>
        ${m.events.slice(0, 40).map(e => `<tr><td style="white-space:nowrap" class="muted">${when(e.ts)}</td>
          <td>${e.level === "warn" || e.level === "error" ? "⚠ " : ""}${esc(e.message)}</td></tr>`).join("")}
      </table></div>` : `<p class="muted">Nothing logged yet.</p>`;
    return `<details class="card mcard" data-card="${id}" ${openCards.has(id) ? "open" : ""}>
      <summary>${swatch(id)}<b>${esc(m.name)}</b>
        <span class="grow muted">${m.buys} bought · ${m.sells} sold · ${money(m.fees)} in fees</span>
        <span class="${m.booked >= 0 ? "up" : "down"}"><b>${money(m.booked)}</b> booked</span></summary>
      <h4 style="margin:12px 0 6px">By ${activityPeriod}</h4>
      <div class="tablewrap">${periodTable(mine, false)}</div>
      <h4 style="margin:14px 0 6px">Trades</h4>${trades}
      <h4 style="margin:14px 0 6px">What happened</h4>${events}
    </details>`;
  }).join("");
  $("activity-cards").querySelectorAll("details.mcard").forEach(el => el.ontoggle = () => {
    if (el.open) openCards.add(el.dataset.card); else openCards.delete(el.dataset.card);
  });
  $("activity-system").innerHTML = (a.system || []).length ? `<table>
    ${a.system.slice(0, 40).map(e => `<tr><td style="white-space:nowrap" class="muted">${when(e.ts)}</td>
      <td>${e.level === "warn" || e.level === "error" ? "⚠ " : ""}${esc(e.message)}</td></tr>`).join("")}
  </table>` : `<p class="muted">Nothing yet.</p>`;
}

// Collapsed sections stay collapsed across refreshes and restarts.
function wireSections() {
  document.querySelectorAll("details.sect").forEach(el => {
    const key = "highway.sect." + el.dataset.sect;
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) el.open = saved === "1";
    } catch (e) { /* private window: fall back to the markup default */ }
    el.addEventListener("toggle", () => {
      try { localStorage.setItem(key, el.open ? "1" : "0"); } catch (e) { /* fine */ }
    });
  });
}

function showPage(id) {
  document.querySelectorAll("section.page").forEach(sec => sec.classList.toggle("on", sec.dataset.page === id));
  document.querySelectorAll("nav.side button").forEach(b => b.classList.toggle("on", b.dataset.page === id));
  try { localStorage.setItem("highway.page", id); } catch (e) { /* private window: fine */ }
  history.replaceState(null, "", "#" + id);
  if (lastData) render(lastData);  // charts need a visible box to size themselves
  if (id === "activity") loadActivity();
}
const $ = (id) => document.getElementById(id);
const money = (v) => v == null ? "–" : "$" + Number(v).toFixed(2);
const pct = (v) => v == null ? "–" : (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const when = (ts) => new Date(ts * 1000).toLocaleString([], {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
const ago = (ts, now) => { const s = Math.max(0, now - ts); return s < 90 ? Math.round(s) + "s ago" : s < 5400 ? Math.round(s / 60) + "m ago" : Math.round(s / 3600) + "h ago"; };
const signed = (v, digits = 2) => {
  if (v == null) return "–";
  const cls = v > 0.004 ? "up" : v < -0.004 ? "down" : "muted", icon = v > 0.004 ? "▲" : v < -0.004 ? "▼" : "•";
  return `<span class="${cls}">${icon} ${pct(v)}</span>`;
};
const delta = (v, base) => {
  if (v == null) return "–";
  const d = v - base, cls = d > 0.005 ? "up" : d < -0.005 ? "down" : "muted", icon = d > 0.005 ? "▲" : d < -0.005 ? "▼" : "•";
  return `<span class="${cls}">${icon} ${d >= 0 ? "+" : "−"}$${Math.abs(d).toFixed(2)}</span>`;
};
const swatch = (pid) => `<span class="swatch" style="background:${MANAGERS[pid]?.c || "var(--text-muted)"}"></span>`;

// Multi-series line chart: one line per manager, direct labels at the right end, shared crosshair.
function leagueChart(el, series, paceStart, startValue) {
  const W = el.clientWidth || 800, H = 240, pad = {l: 48, r: 118, t: 10, b: 24};
  const ids = Object.keys(MANAGERS).filter(id => (series[id] || []).length > 1);
  if (!ids.length) { el.innerHTML = `<div class="muted" style="font-size:12px;padding:8px 0">The chart fills in as snapshots arrive (every 5 min).</div>`; return; }
  const all = ids.flatMap(id => series[id]);
  const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
  const paceRate = 1 + ((lastData?.snapshot?.capital?.target_pct ?? 13.5) / 100);
  const pace = [[x0, startValue], [x1, startValue * Math.pow(paceRate, (x1 - paceStart) / (30 * 86400))]];
  const ys = all.map(p => p[1]).concat(pace.map(p => p[1]));
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = Math.max(0.5, (y1 - y0) * 0.08); y0 -= padY; y1 += padY;
  const X = (x) => pad.l + (x - x0) / (x1 - x0 || 1) * (W - pad.l - pad.r), Y = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const path = (pts) => pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1)).join("");
  let grid = "";
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v);
    grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">$${v.toFixed(0)}</text>`; }
  grid += `<text x="${pad.l}" y="${H - 6}" font-size="11" fill="var(--text-muted)">${when(x0)}</text><text x="${W - pad.r}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--text-muted)">${when(x1)}</text>`;
  // direct labels, nudged apart so they never collide
  const ends = ids.map(id => ({id, y: Y(series[id][series[id].length - 1][1]), v: series[id][series[id].length - 1][1]})).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  const labels = ends.map(e => `<text x="${W - pad.r + 8}" y="${e.y + 4}" font-size="12" fill="var(--text-primary)"><tspan fill="${MANAGERS[e.id].c}">●</tspan> ${MANAGERS[e.id].name} $${e.v.toFixed(2)}</text>`).join("");
  const lines = ids.map(id => `<path d="${path(series[id])}" fill="none" stroke="${MANAGERS[id].c}" stroke-width="2" stroke-linejoin="round"/>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Each manager's fund value since the league started, with the target pace">${grid}
    <path d="${path(pace)}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>${lines}${labels}
    <line class="xh" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--text-muted)" visibility="hidden"/>
    <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/></svg><div class="tip"></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = svg.querySelector(".xh");
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * W / r.width;
    const tx = x0 + (mx - pad.l) / (W - pad.l - pad.r) * (x1 - x0);
    const rowsHtml = ids.map(id => { const s = series[id]; let b = s[0]; for (const p of s) if (Math.abs(p[0] - tx) < Math.abs(b[0] - tx)) b = p;
      return {id, v: b[1], t: b[0]}; }).sort((a, b) => b.v - a.v);
    const px = X(rowsHtml[0].t);
    xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("visibility", "visible");
    tip.style.display = "block";
    tip.innerHTML = `<div class="muted">${when(rowsHtml[0].t)}</div>` + rowsHtml.map(o => `<div>${swatch(o.id)}${MANAGERS[o.id].name} <b>${money(o.v)}</b></div>`).join("");
    const left = px * r.width / W; tip.style.left = Math.min(left + 12, r.width - tip.offsetWidth - 4) + "px"; tip.style.top = "8px";
  });
  svg.addEventListener("mouseleave", () => { tip.style.display = "none"; xh.setAttribute("visibility", "hidden"); });
}

function spark(el, points, color, base, asset) {
  const W = el.clientWidth || 240, H = 52;
  if (!points || points.length < 2) { el.innerHTML = `<div class="muted" style="font-size:12px;padding:6px 0">Chart appears after a few snapshots.</div>`; return; }
  const ys = points.map(p => p[1]).concat([base]); let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1) { y0 -= 0.5; y1 += 0.5; }
  const x0 = points[0][0], x1 = points[points.length - 1][0];
  const X = (x) => 2 + (x - x0) / (x1 - x0 || 1) * (W - 4), Y = (y) => 3 + (1 - (y - y0) / (y1 - y0)) * (H - 6);
  const d = points.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1)).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="lane value over time"><line x1="0" x2="${W}" y1="${Y(base)}" y2="${Y(base)}" stroke="var(--border)" stroke-dasharray="2 3"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle class="dot" r="4" fill="${color}" stroke="var(--surface-1)" stroke-width="2" visibility="hidden"/><rect width="${W}" height="${H}" fill="transparent"/></svg><div class="tip"></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), dot = svg.querySelector(".dot");
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect(), mx = (e.clientX - r.left) * W / r.width;
    let b = points[0]; for (const p of points) if (Math.abs(X(p[0]) - mx) < Math.abs(X(b[0]) - mx)) b = p;
    dot.setAttribute("cx", X(b[0])); dot.setAttribute("cy", Y(b[1])); dot.setAttribute("visibility", "visible");
    tip.style.display = "block";
    const px = b[2] != null ? ` · ${esc(asset || "price")} ${b[2] >= 1 ? "$" + Number(b[2]).toFixed(2) : "$" + Number(b[2]).toPrecision(3)}` : "";
    tip.innerHTML = `${when(b[0])} · lane <b>${money(b[1])}</b>${px}`;
    tip.style.left = Math.min(X(b[0]) * r.width / W + 10, r.width - tip.offsetWidth) + "px"; tip.style.top = "-6px";
  });
  svg.addEventListener("mouseleave", () => { tip.style.display = "none"; dot.setAttribute("visibility", "hidden"); });
}

function laneCard(pid, l) {
  const c = MANAGERS[pid].c;
  const clips = [0, 1].map(i => `<i class="${i < l.clips ? "on" : ""}"></i>`).join("");
  const want = l.target_clips !== l.clips ? `· wants ${l.target_clips}` : "";
  const orders = (l.orders || []).map(o => `${o.side} ${o.side === "buy" ? money(o.notional) : ""} @ ${Number(o.limit).toPrecision(6)}`).join(", ");
  const news = l.news && l.news.count ? `${l.news.score >= 0 ? "▲" : "▼"} ${l.news.score.toFixed(2)} · ${l.news.count} stories` : "–";
  const leader = l.leader !== undefined ? (l.leader ? l.leader.split("(")[0] : "cash (nothing working)") : null;
  return `<article class="card lane" style="--c:${c}">
    <h3>${esc(l.asset || "empty")} <span class="role">lane ${l.id}${l.role ? " · " + esc(l.role) : ""}</span></h3>
    <div class="big">${money(l.equity)}</div><div>${delta(l.equity, 100)} vs $100${l.status !== "active" ? ' · <span class="down">closed</span>' : ""}</div>
    <div class="chart" id="spark-${pid}-${l.id}" style="margin-top:8px"></div>
    <dl>
      <dt>Position</dt><dd><span class="clips">${clips}</span> ${l.clips}×$50 ${want}</dd>
      <dt>Cash</dt><dd>${money(l.cash)}${l.pending > 0 ? " + " + money(l.pending) + " settling" : ""}</dd>
      ${l.venue ? `<dt>Trades on</dt><dd>${esc(l.venue)}</dd>` : ""}
      <dt>Last 24h</dt><dd>${signed(l.day_change_pct)} <span class="muted">(exit −10 / +15)</span></dd>
      ${leader ? `<dt>Leader</dt><dd>${esc(leader)}</dd>` : ""}
      <dt>News</dt><dd>${news}</dd>
      ${l.cooldown_h > 0 ? `<dt>Cooldown</dt><dd>${l.cooldown_h}h after ${esc(l.last_exit)}</dd>` : ""}
      ${orders ? `<dt>Orders</dt><dd>${esc(orders)}</dd>` : ""}
    </dl>
    <div class="note">${esc(l.target_reason || "–")}${l.blocked_by && l.target_clips > l.clips ? " · waiting: " + esc(l.blocked_by) : ""}</div>
  </article>`;
}

function panel(name, fn) {  // a broken panel should never blank the rest of the page
  try { fn(); } catch (e) { console.error("panel " + name + " failed", e); }
}

function render(d) {
  lastData = d;
  const s = d.snapshot || {}, now = d.now;
  if (!s.league) { $("status").textContent = "waiting for the engine…"; return; }
  const stale = now - s.ts > 120;
  const frozen = !!window.HIGHWAY_SNAPSHOT;
  $("status").className = "pill " + (frozen || stale || s.paused ? "paused" : "live");
  $("status").textContent = frozen ? "snapshot · not live" : stale ? "engine not reporting" : s.paused ? "paused" : "paper trading · live prices";
  const fg = s.fear_greed ? ` · crypto mood ${s.fear_greed.value} (${s.fear_greed.label})` : "";
  $("updated").textContent = `updated ${ago(s.ts, now)}${fg} · AI calls today ${s.ai_calls_today}`;
  $("nav-day").textContent = `day ${s.league_day || 1}`;

  const h = s.health || {checks: []};
  const bad = h.checks.filter(c => c.status !== "ok").length;
  const hp = $("health-pill"); hp.className = "pill " + (h.overall || "ok");
  hp.textContent = h.overall === "ok" ? "all checks passing" : `${bad} check${bad === 1 ? "" : "s"} need attention`;
  $("nav-health").textContent = h.overall === "ok" ? "✓" : `${bad} ⚠`;
  $("health").innerHTML = h.checks.map(c => `<div class="check ${c.status}"><span class="icon">${c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗"}</span>
    <div><b>${esc(c.name)}</b> <span class="muted">${c.status === "ok" ? "ok" : c.status === "warn" ? "warning" : "failing"}</span><div class="detail">${esc(c.detail)}</div></div></div>`).join("") || `<div class="muted">First check runs within a minute.</div>`;
  const ends = d.league_started ? new Date((d.league_started + (s.league_weeks || 6) * 7 * 86400) * 1000).toLocaleDateString([], {month: "short", day: "numeric"}) : "";
  $("week").textContent = `week ${Math.min(s.league_week || 1, s.league_weeks || 6)} of ${s.league_weeks || 6}${ends ? " · ends " + ends : ""}`;
  const sc = (s.scorecards || []).slice().sort((a, b) => (b.return_pct ?? -1e9) - (a.return_pct ?? -1e9));
  const n = (v, suf = "") => v == null ? "–" : v + suf;
  $("scorecard").innerHTML = sc.length ? `<table><tr><th>Manager</th><th class="num">Return</th><th class="num">Monthly equiv.</th><th class="num">Max drawdown</th><th class="num">Now below peak</th>
    <th class="num">Risk-adjusted</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Avg win / loss</th><th class="num">Fees</th><th class="num">Fees vs gains</th><th class="num">Turnover</th><th class="num">Stops / take-profits</th><th class="num">vs Hold</th></tr>` +
    sc.map(m => `<tr><td>${swatch(m.id)}${esc(m.name)}</td><td class="num">${signed(m.return_pct)}</td><td class="num">${n(m.monthly_equiv_pct, "%")}</td><td class="num">${n(m.max_dd_pct, "%")}</td>
      <td class="num">${n(m.current_dd_pct, "%")}</td><td class="num">${m.sharpe == null ? '<span class="muted">after 3 days</span>' : m.sharpe}</td><td class="num">${n(m.trades)}</td>
      <td class="num">${m.win_rate == null ? "–" : Math.round(m.win_rate * 100) + "%"}</td><td class="num">${m.avg_win == null && m.avg_loss == null ? "–" : `${money(m.avg_win)} / ${money(m.avg_loss)}`}</td>
      <td class="num">${money(m.fees)}</td><td class="num">${n(m.fee_drag_pct, "%")}</td><td class="num">${n(m.turnover_x, "×")}</td><td class="num">${n(m.stops)} / ${n(m.take_profits)}</td>
      <td class="num">${m.vs_hold_pct == null ? "–" : signed(m.vs_hold_pct)}</td></tr>`).join("") + "</table>"
    : `<div class="muted">Scorecards appear once the league has a few snapshots.</div>`;
  const rv = (s.reviews || []).slice().reverse();
  $("reviews").innerHTML = rv.length ? rv.map(r => `<div class="muted">Week ${r.week} · ${when(r.ts)}</div><p>${esc(r.summary)}</p>
      ${r.changes && r.changes.length ? `<p><b>Tweaks applied:</b> ${r.changes.map(c => `${esc(c.key)} → ${c.value} (${esc(c.reason)})`).join("; ")}</p>` : ""}
      ${r.suggestions && r.suggestions.length ? `<p><b>For you to decide:</b>\n${r.suggestions.map(x => "• " + esc(x)).join("\n")}</p>` : ""}
      ${r.verdicts && Object.keys(r.verdicts).length ? `<p><b>Verdicts:</b> ${Object.entries(r.verdicts).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" · ")}</p>` : ""}
      ${r.go_live ? `<p><b>Real money:</b> ${esc(r.go_live)}</p>` : ""}`).join("")
    : `<p class="muted">First weekly review: ${d.league_started ? when(d.league_started + 7 * 86400) : "7 days after the league starts"}. Reports are also saved in data/reports/.</p>`;

  const ls = d.league_started || now, leagueDays = Math.max(0, (now - ls) / 86400);
  const tgt = (s.capital || {}).target_pct ?? 13.5;
  const lo = (s.capital || {}).target_low ?? 12, hi = (s.capital || {}).target_high ?? 15;
  const leaguePace = (Math.pow(1 + tgt / 100, leagueDays / 30) - 1) * 100;
  $("board-sub").textContent = `· day ${leagueDays.toFixed(1)} of the league · target ${lo}-${hi}% a month · pace so far ${pct(leaguePace)}`;
  $("board").innerHTML = `<tr><th></th><th>Manager</th><th class="num">Value</th><th class="num">Since league start</th><th class="num">vs pace</th><th class="num">Invested</th><th class="num">Vault</th><th class="num">Fees</th><th class="num">Trades</th></tr>` +
    s.league.map((m, i) => `<tr class="pick${openManager === m.id ? " open" : ""}" data-mid="${m.id}" title="Click for holdings and trade history"><td class="rank">${i + 1}</td><td>${swatch(m.id)}<b>${esc(m.name)}</b> <span class="muted">· ${esc(MANAGERS[m.id]?.about || "")}</span> <span class="chev">${openManager === m.id ? "▾" : "▸"}</span></td>
      <td class="num"><b>${money(m.total)}</b></td><td class="num">${signed(m.since_league_pct)}</td>
      <td class="num">${m.since_league_pct - leaguePace >= 0 ? '<span class="up">▲ ahead</span>' : '<span class="down">▼ behind</span>'}</td>
      <td class="num">${money(m.invested)}</td><td class="num">${money(m.vault)}</td><td class="num">${money(m.fees_paid)}</td><td class="num">${m.trades}</td></tr>
      <tr class="pick lanerow${openManager === m.id ? " open" : ""}" data-mid="${m.id}"><td></td><td colspan="8">${laneChips(m)}</td></tr>`).join("");
  $("board").querySelectorAll("tr.pick").forEach(tr => tr.onclick = () => {
    openManager = openManager === tr.dataset.mid ? null : tr.dataset.mid;
    render(lastData);
    if (openManager) loadManager(openManager);
  });
  if (openManager) loadManager(openManager); else $("manager-detail").innerHTML = "";
  renderSkill(s.skill);
  renderRulebook(s);
  $("range-filters").innerHTML = Object.entries(RANGES).map(([k, r]) =>
    `<button data-r="${k}" class="${chartRange === k ? "on" : ""}">${r.label}</button>`).join("");
  $("range-filters").querySelectorAll("button").forEach(b => b.onclick = () => { chartRange = b.dataset.r; render(lastData); });
  $("league-legend").innerHTML = Object.entries(MANAGERS).map(([id, m]) => `<span style="--c:${m.c}">${m.name}</span>`).join("") + `<span class="pace">${((lastData?.snapshot?.capital?.target_pct ?? 13.5)).toFixed(1)}%/month pace</span>`;
  // Thin the line to about 350 points, sized to the data actually in range, so any
  // window from one day to six weeks stays readable without going empty.
  const range = RANGES[chartRange], cutoff = now - range.days * 86400;
  const inRange = Object.values(d.league_series || {}).flat().filter(p => p[0] >= cutoff);
  const span = inRange.length ? Math.max(...inRange.map(p => p[0])) - Math.min(...inRange.map(p => p[0])) : 0;
  const bucket = Math.max(300, Math.min(range.bucket, span / 350));
  const thinned = {};
  for (const [id, pts] of Object.entries(d.league_series || {})) {
    const kept = [], seen = new Set();
    for (const p of pts) {
      if (p[0] < cutoff) continue;
      const slot = Math.floor(p[0] / bucket);
      if (seen.has(slot)) kept[kept.length - 1] = p; else { seen.add(slot); kept.push(p); }
    }
    if (kept.length > 1) thinned[id] = kept;
  }
  leagueChart($("league-chart"), thinned, ls, s.start_value || 500);

  const lanesBy = {[s.primary || "bluechip"]: s.lanes || [], ...(s.managers || {})};
  const openState = {}; document.querySelectorAll("details.manager").forEach(x => openState[x.dataset.id] = x.open);
  $("managers").innerHTML = s.league.map(m => {
    const extra = m.id === "laser" && s.laser_brain && s.laser_brain.notes ? `<p class="muted" style="margin:0 0 8px">Laser's plan (${when(s.laser_brain.ts)}): ${esc(s.laser_brain.notes)}</p>` : "";
    const open = openState[m.id] ?? (m.id === s.league[0].id);
    return `<details class="manager" data-id="${m.id}" ${open ? "open" : ""}><summary>${swatch(m.id)}${esc(m.name)} · ${money(m.total)} · ${pct(m.since_league_pct)} <span class="muted" style="font-weight:400">· ${(m.assets || []).filter(Boolean).map(esc).join(", ")}</span></summary>
      ${extra}<section class="lanes">${(lanesBy[m.id] || []).map(l => laneCard(m.id, l)).join("")}</section></details>`;
  }).join("");
  for (const [pid, lanes] of Object.entries(lanesBy)) for (const l of lanes) {
    const el = $(`spark-${pid}-${l.id}`);
    if (el) spark(el, ((d.lane_series[pid] || {})[String(l.id)] || []).filter(p => p[0] >= cutoff), MANAGERS[pid].c, 100, l.asset);
  }

  // Day by day: yesterday's closed summary, today still running.
  const dayRows = s.days || [], weekRows = s.weeks || [];
  const byDay = {};
  for (const r of dayRows) (byDay[r.day] = byDay[r.day] || []).push(r);
  const order = Object.keys(MANAGERS);  // fixed column order: ranks move, columns should not
  const nameOf = (id) => MANAGERS[id] ? MANAGERS[id].name : id;
  const today = s.league_day || 1;
  $("days-sub").textContent = `· league day ${today} · day ${today} is still running; earlier days are final`;
  const dayNums = Object.keys(byDay).map(Number).filter(d => d < today).sort((a, b) => b - a).slice(0, 14);  // only finished days
  $("days").innerHTML = `<table><tr><th>Day</th>` + order.map(id => `<th class="num">${swatch(id)}${esc(nameOf(id))}</th>`).join("") +
    `<th>Notes</th></tr>` +
    `<tr><td><b>Day ${today}</b> <span class="muted">· live</span></td>` +
    order.map(id => { const m = s.league.find(x => x.id === id) || {}; return `<td class="num">${signed(m.since_league_pct)}<div class="muted" style="font-size:11px">${money(m.total)}</div></td>`; }).join("") +
    `<td class="muted">running now · totals are since the league started</td></tr>` +
    dayNums.map(d => {
      const row = byDay[d], best = row.slice().sort((a, b) => b.return_pct - a.return_pct)[0];
      return `<tr><td>Day ${d}</td>` + order.map(id => {
        const r = row.find(x => x.portfolio === id);
        return r ? `<td class="num">${signed(r.return_pct)}<div class="muted" style="font-size:11px">${money(r.end_value)} · ${r.trades} trades</div></td>` : `<td class="num">–</td>`;
      }).join("") + `<td class="muted">won by ${esc(nameOf(best.portfolio))}${best.best ? " · best lane " + esc(best.best) : ""}</td></tr>`;
    }).join("") + `</table>` +
    (dayNums.length ? "" : `<div class="muted">Day 1 closes 24 hours after the league started; its summary appears here then.</div>`);

  const rollup = (rows, label) => rows.length ? `<table><tr><th>${label}</th><th>Days</th>` +
    order.map(id => `<th class="num">${swatch(id)}${esc(nameOf(id))}</th>`).join("") + `<th>Leader</th></tr>` +
    rows.map(w => {
      const byId = {}; w.managers.forEach(m => byId[m.portfolio] = m);
      const lead = w.managers[0];
      return `<tr><td><b>${label} ${w.week}</b></td><td class="muted">${Math.min(...w.days)}–${Math.max(...w.days)}</td>` +
        order.map(id => byId[id] ? `<td class="num">${signed(byId[id].return_pct)}<div class="muted" style="font-size:11px">${money(byId[id].end_value)}</div></td>` : `<td class="num">–</td>`).join("") +
        `<td>${swatch(lead.portfolio)}${esc(lead.name)} ${pct(lead.return_pct)}</td></tr>`;
    }).join("") + `</table>` : "";
  const monthRows = s.months || [];
  $("weeks").innerHTML = weekRows.length ? `<table><tr><th>Week</th><th>Days</th>` +
    order.map(id => `<th class="num">${swatch(id)}${esc(nameOf(id))}</th>`).join("") + `<th>Leader</th></tr>` +
    weekRows.map(w => {
      const byId = {}; w.managers.forEach(m => byId[m.portfolio] = m);
      const lead = w.managers[0];
      return `<tr><td><b>Week ${w.week}</b></td><td class="muted">${Math.min(...w.days)}–${Math.max(...w.days)}</td>` +
        order.map(id => byId[id] ? `<td class="num">${signed(byId[id].return_pct)}<div class="muted" style="font-size:11px">${money(byId[id].end_value)}</div></td>` : `<td class="num">–</td>`).join("") +
        `<td>${swatch(lead.portfolio)}${esc(lead.name)} ${pct(lead.return_pct)}</td></tr>`;
    }).join("") + `</table>`
    : `<div class="muted">Week 1 fills in as its days close, and the week 1 review lands 7 days after the start.</div>`;
  if (monthRows.length) $("weeks").innerHTML += `<h2 style="margin-top:22px">By month <span class="sub">· 30-day blocks</span></h2>` + rollup(monthRows, "Month");

  const rad = s.radar || {};
  const reg = rad.regime || {};
  const rp = $("regime");
  rp.className = "pill " + (reg.stocks === "risk-on" ? "ok" : reg.stocks === "risk-off" ? "fail" : "warn");
  rp.textContent = reg.stocks ? `stocks ${reg.stocks}${reg.vix ? " · VIX " + reg.vix.toFixed(1) : ""}` : "market: scanning…";
  const alerts = rad.alerts || [];
  $("nav-radar").textContent = alerts.length ? `${alerts.length} flagged` : "";
  $("radar-sub").textContent = rad.tracked
    ? `· ${rad.tracked} assets tracked · ${alerts.length} flagged (${rad.min_signals} of 7 indicators) · ${reg.detail || ""}`
    : "· first scan runs within 20 minutes";
  const counts = rad.buckets || {};
  $("radar-funnel").innerHTML = radarFunnel(s.radar_funnel);
  $("radar-filters").innerHTML = [["alerts", `Flagged (${alerts.length})`]].concat(
    Object.entries(BUCKETS).filter(([k]) => counts[k]).map(([k, label]) => [k, `${label} (${counts[k]})`]))
    .map(([k, label]) => `<button data-b="${k}" class="${radarFilter === k ? "on" : ""}">${esc(label)}</button>`).join("");
  $("radar-filters").querySelectorAll("button").forEach(b => b.onclick = () => { radarFilter = b.dataset.b; refresh(); });
  const rows = rad.rows || [];
  const pool = radarFilter === "alerts" ? alerts : rows.filter(r => (r.buckets || []).includes(radarFilter));
  const cands = rad.candidates || {};
  $("radar").innerHTML = pool.length ? `<table><tr><th>Asset</th><th>Where</th><th class="num">Price</th><th>Indicators</th><th class="num">Signals</th>
      <th class="num">Score</th><th class="num">20 days</th><th class="num">Volume</th><th class="num">vs market</th><th>Backtest</th></tr>` +
    pool.slice(0, 30).map(r => {
      const c = cands[r.symbol];
      // c.edge can legitimately be absent on older records; "passed +null" is worse than no number.
      const edgeTxt = (c && c.edge !== null && c.edge !== undefined) ? `${c.edge >= 0 ? "+" : ""}${c.edge} ` : "";
      const status = !c ? '<span class="muted">queued</span>'
        : c.passed ? `<span class="up">passed ${edgeTxt}(${esc(c.strategy || "?")})</span>`
        : '<span class="muted">no strategy passed</span>';
      return `<tr><td><b>${esc(r.symbol)}</b> <span class="muted">${esc((r.name || "").slice(0, 26))}</span></td>
        <td class="muted">${esc(r.venue || "")}</td><td class="num">${r.price != null ? "$" + (r.price >= 1 ? Number(r.price).toFixed(2) : Number(r.price).toPrecision(3)) : "–"}</td>
        <td><span class="dots" title="${INDICATORS.filter(n => r.passes[n]).join(", ") || "none"}">${INDICATORS.map(n => `<i class="${r.passes[n] ? "on" : ""}"></i>`).join("")}</span></td>
        <td class="num">${r.signals}/7</td><td class="num">${r.score}</td><td class="num ${r.r20_pct >= 0 ? "up" : "down"}">${r.r20_pct >= 0 ? "+" : ""}${r.r20_pct}%</td>
        <td class="num">${r.rvol}×</td><td class="num">${r.vs_market_pct >= 0 ? "+" : ""}${r.vs_market_pct}%</td><td>${status}</td></tr>`;
    }).join("") + "</table>" + `<div class="muted" style="font-size:12px;margin-top:8px">Indicator dots, in order: ${INDICATORS.join(" · ")}. A flagged asset is backtested first; only if it passes can a manager buy it.</div>`
    : `<div class="muted">${rad.tracked ? (radarFilter === "alerts" ? "Nothing is flagged right now." : "None of this bucket's assets are in the top 60 by score. The radar ranks everything but only keeps the strongest for display.") : "The first radar scan runs within 20 minutes of startup."}</div>`;

  // Market clock: measured weekday and time-of-day patterns.
  const clock = s.clock || {};
  $("clock-sub").textContent = clock.ts
    ? `· measured from ${esc((clock.equity || {}).source || "")} and ${esc((clock.crypto || {}).source || "")} · updated ${when(clock.ts)}`
    : "· measured on the next daily pass";
  const nowRows = Object.entries(clock.now || {});
  const sess = clock.session || {}, guards = clock.guards || {}, earn = clock.earnings || {};
  const stocksLine = sess.stocks_open
    ? `US market <b>open</b> · ${Math.round(sess.minutes_to_close)} min to the close · ${Math.round(sess.minutes_since_open)} min since the open`
    : `US market <b>closed</b> · stocks resume at 9:30 ET on the next business day · crypto never stops`;
  const guardList = [
    `no stock buys in the first ${guards.first_minutes || 0} minutes (opening spreads)`,
    `no stock buys in the last ${guards.last_minutes || 0} minutes (no time to scale in, and sales settle next day)`,
    `no stock buys within ${guards.earnings_days || 0} days of the company reporting`,
    guards.exit_before_earnings ? "stock lanes step aside before earnings" : "stock lanes hold through earnings (gap risk accepted)",
    "crypto trades around the clock; timing tilts come from the measured pattern below",
  ];
  const earnRows = Object.entries(earn);
  $("clock-session").innerHTML = `<div style="margin-bottom:8px">${stocksLine}</div>` +
    `<div class="muted" style="font-size:13px">Guardrails in force:<ul style="margin:6px 0 0 18px">` +
    guardList.map(g => `<li>${esc(g)}</li>`).join("") + `</ul></div>` +
    (earnRows.length ? `<div style="margin-top:10px">Earnings ahead: ` +
      earnRows.map(([a, r]) => `<span class="chip">${esc(a)} ${esc(r.date)} ${esc(r.when || "")}</span>`).join(" ") + `</div>` : "");
  $("clock-now").innerHTML = nowRows.length ? `<table><tr><th>Asset</th><th class="num">Timing tilt</th><th>Why</th></tr>` +
    nowRows.map(([a, v]) => `<tr><td>${esc(a)}</td><td class="num ${v.tilt > 0.05 ? "up" : v.tilt < -0.05 ? "down" : "muted"}">${v.tilt >= 0 ? "+" : ""}${(v.tilt || 0).toFixed(2)}</td>
      <td class="muted">${esc(v.why || "no strong pattern in this window")}</td></tr>`).join("") + "</table>" +
    (clock.minutes_to_close != null ? `<div class="muted" style="font-size:12px;margin-top:8px">${Math.round(clock.minutes_to_close)} minutes to the US close. No new stock buys inside the last ${s.params ? s.params.no_entry_last_minutes : 30} minutes.</div>` : "")
    : `<div class="muted">The clock is measured once a day from SPY and BTC hourly history.</div>`;
  const clockTable = (book) => {
    if (!book || !book.weekday) return `<div class="muted">Not measured yet.</div>`;
    const rows = (obj, kind) => Object.entries(obj || {}).filter(([, v]) => v && v.samples > 20).map(([k, v]) =>
      `<tr><td>${esc(k)} <span class="muted">${kind}</span></td><td class="num ${v.mean_bp > 0 ? "up" : v.mean_bp < 0 ? "down" : ""}">${v.mean_bp >= 0 ? "+" : ""}${v.mean_bp} bp</td>
       <td class="num">${Math.round(v.hit_rate * 100)}%</td><td class="num">${v.t}</td><td>${v.strong ? "<b>stands out</b>" : '<span class="muted">noise</span>'}</td></tr>`).join("");
    return `<table><tr><th>Bucket</th><th class="num">Average move</th><th class="num">Up</th><th class="num">t</th><th>Verdict</th></tr>` +
      rows(book.weekday, "weekday") + rows(book.window, "window") + rows(book.weekday_window, "combined") + rows(book.gaps, "overnight gap") +
      `</table><div class="muted" style="font-size:12px;margin-top:8px">"bp" is hundredths of a percent per bar. A pattern only tilts trading when t is 2 or more, and even then the tilt is small: with dozens of buckets, one or two look strong by luck.</div>`;
  };
  $("clock-equity").innerHTML = clockTable(clock.equity);
  $("clock-crypto").innerHTML = clockTable(clock.crypto);

  const bench = s.bench || [];
  $("bench").innerHTML = bench.length ? `<table><tr><th>Asset</th><th>Type</th><th>Leading strategy</th><th class="num">Live paper</th><th class="num">Score</th><th>Right now</th></tr>` +
    bench.map(b => `<tr><td>${esc(b.asset)}</td><td>${esc(b.class)}</td><td>${esc(b.leader ? b.leader.split("(")[0] : "cash")}</td><td class="num">${signed(b.return_pct)}</td>
      <td class="num">${b.score == null ? "–" : b.score.toFixed(1)}</td><td>${b.in_position ? "in a position" : b.wants_in ? "wants in" : "waiting"}</td></tr>`).join("") + "</table>"
    : `<div class="muted">The Scout fills the watchlist on its next run.</div>`;

  if (document.querySelector('section.page[data-page="activity"]').classList.contains("on")) loadActivity();
  $("news").innerHTML = `<table>` + d.news.slice(0, 25).map(n => {
    const a = JSON.parse(n.assets || "[]"), sc = n.sentiment;
    return `<tr><td style="white-space:nowrap">${when(n.published)}</td><td><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">· ${esc(n.source)}</span>
      ${a.map(x => `<span class="chip">${esc(x)}</span>`).join(" ")} ${n.severity >= 3 ? '<span class="chip down">⚠ critical</span>' : ""}</td>
      <td class="num ${sc > 0.1 ? "up" : sc < -0.1 ? "down" : "muted"}">${sc > 0.1 ? "▲" : sc < -0.1 ? "▼" : "•"} ${sc.toFixed(2)}</td></tr>`; }).join("") + "</table>";
  // Plain-English explainer: what each manager does, and what none of them may do.
  const leaders = (s.lanes || []).map(l => `lane ${l.id} ${l.asset}: ${(l.leader || "cash").split("(")[0]}`).join(" · ");
  const pr = s.params || {};
  const cc = s.capital || {};
  const laserNote = s.laser_brain && s.laser_brain.notes ? `<div class="muted" style="margin-top:6px">Latest plan (${when(s.laser_brain.ts)}): ${esc(s.laser_brain.notes)}</div>` : "";
  // The overall plan, in plain English, with every number taken from the live settings.
  const c = s.capital || {};
  const laneMoney = (c.lanes || 4) * (c.lane_principal || 100);
  const target = c.target_pct ?? 13.5;
  const tLo = c.target_low ?? 12, tHi = c.target_high ?? 15;
  const perDay = (Math.pow(1 + target / 100, 1 / 30) - 1) * 100;
  const yearly = Math.pow(1 + target / 100, 12);
  const managerCount = Object.keys(MANAGERS).length;
  $("strategy").innerHTML = strategyDiagram(c, pr) + `
    <p style="margin-top:18px"><b>The goal.</b> Give ${managerCount} managers $${(c.total || 500).toFixed(0)} of paper money each and find out
    which way of investing actually works. The target is <b>${tLo}–${tHi}% a month</b>. Nothing here is real money and
    live trading is not connected.</p>

    <p><b>How each manager's money sits.</b> ${c.lanes || 4} lanes of $${(c.lane_principal || 100).toFixed(0)}
    (= $${laneMoney.toFixed(0)}), one asset each, plus a $${(c.reserve || 100).toFixed(0)} reserve held back to reopen a
    lane that fails. Every manager runs the identical structure and the identical risk engine.</p>

    <p><b>What makes them different is the market they may touch.</b> They used to all pick from one universe and
    converged on the same few names — two of them ended up 0.97 correlated and one added nothing the others did not
    already provide. Four names for one bet teaches you nothing. Now each has its own slice: the S&amp;P giants, funds
    only, crypto on Coinbase, the strongest movers on Crypto.com, and the AI free to pick anything. Average overlap
    between them fell to <b>0.14</b>.</p>

    <p><b>Where the return has to come from.</b> ${target.toFixed(1)}% a month is about
    <b>${perDay.toFixed(2)}% a day</b>, every day, after fees — on $50 clips where the round trip costs 0.1% on a
    stock and up to 1.4% on a coin. That is the real bar.</p>

    <p><b>What protects it.</b> Hard rules written in code that no manager can reach: at most
    $${(c.max_buy || 50).toFixed(0)} per buy and one buy per bar; sell everything if a position drops
    ${Math.abs(c.stop || 10)}% in a day; sell everything if it gains ${c.take || 15}% in a day; sell everything if it
    falls ${c.giveback || 12}% below its best price since it was bought; skim every $50 above
    $${(c.lane_principal || 100).toFixed(0)} into a vault nothing can spend; close a lane at $${(c.lane_floor || 70).toFixed(0)};
    never more than $${(c.total || 500).toFixed(0)} at risk. Every one of those is replayed against the recorded
    history on the Health page — a rule that fires late is treated as a rule that failed.</p>

    <div class="note"><b>Being honest about the target.</b> ${tLo}–${tHi}% a month compounds to about
    ${yearly.toFixed(1)}× a year. It was 22% until Sept 24, which compounds to nearly 11× and needs the violent end of
    the market and a great deal of luck. Even at this level, a two-year test of the rule settings found the median
    strategy-and-asset pairing returning close to nothing per month — the live system follows the best strategy per
    lane rather than the median, but ${tLo}–${tHi}% remains well above what an average setup delivers. These six weeks
    exist to find out how close it gets and at what risk, not to assume it.</div>`;

  const how = [
    ["bluechip", "S&P giants, picked by tournament", [
      "Its universe is the 120 largest US companies by market cap, rebuilt daily from the live screener — not a static list.",
      "Each lane runs six strategies side by side on paper: slow trend, trend, breakout, dip-buying, session timing and news momentum. The lane's real money follows whichever is winning.",
      "It re-decides hourly while the US market is open. If no strategy is working, the lane sits in cash.",
      "Once the Scout moves a lane to a different name, that lane may only sell — it never adds to a position it has decided to leave.",
      leaders ? "Leading now — " + leaders : "",
    ]],
    ["etf", "Funds only, picked by tournament", [
      "Its universe is funds and nothing else: the S&P (VOO), gold (GLD), semiconductors (SMH, SOXX), life sciences (XBI, XLV, IBB), the metals and power behind the data-centre build-out, and a few broad sectors.",
      "Leveraged funds and crypto trusts are barred. Ranking rewards movement, so left alone this mandate would fill with 2× crypto funds — the opposite of the point.",
      "Funds move less than single names, so it gets its own volatility floor (2.5% a month). The standard 10% floor would exclude almost every fund, including VOO.",
      "Same six strategies, same rules as every other tournament manager.",
    ]],
    ["coinbase", "Crypto on Coinbase, picked by tournament", [
      "Holds only coins Coinbase lists, and trades them there: about 1.40% a round trip.",
      "Paired deliberately against Momentum, which holds much the same coins on Crypto.com at roughly 0.75%. Between them they are a controlled test of what execution cost actually does over six weeks.",
      "Same six strategies as Bluechip and ETF, re-deciding every 15 minutes.",
    ]],
    ["momentum", "A fixed rule, no judgment", [
      `Ranks every liquid coin by ${Math.round((pr.momentum_w30 ?? 0.6) * 100)}% of its 30-day move plus ${Math.round((1 - (pr.momentum_w30 ?? 0.6)) * 100)}% of its 7-day move.`,
      "A coin only qualifies while it is above its 20-day average and up over the past week.",
      `It holds the top four and keeps each while it stays inside the top ${Math.round(pr.momentum_keep_top || 8)}, rotating after the Scout runs each day.`,
      "It trades on Crypto.com, at about half Coinbase's fees. It is the deliberate 'chase what's hot' manager and takes the most risk.",
    ]],
    ["laser", "The AI reads the situation and decides", [
      `Every ${pr.laser_manager_hours || 4} hours, and again just after the US open when it holds stocks, the AI is given its portfolio, the ranked candidates, prices, news, the market mood and the radar's flagged names.`,
      "It is the only manager with no mandate — it may hold crypto, blue chips or funds, so it is the test of whether judgment beats a fixed universe.",
      "It can run its own web searches to check a story before acting, then returns an asset, a size and a reason for each lane.",
      "The algorithm checks every answer before anything happens: the asset must be on the candidate list, no more than three lanes of one type, sizes limited to 0, 1 or 2 clips of $50. An invalid answer is discarded.",
      "It never places an order itself. It sets targets; the same order and risk code executes them.",
    ]],
    ["hold", "Buy and hold, the yardstick", [
      "Takes one asset from each mandate and never changes them, so it can measure a blue-chip manager and a crypto manager on the same footing.",
      "Its assets are frozen on purpose. Only the hard rules — the day stop, the take-profit, the give-back — can make it trade.",
      "It exists to answer one question: does any of the active trading actually beat sitting still? If Hold wins over six weeks, that is the finding, and a useful one.",
    ]],
  ];
  $("how-it-works").innerHTML = how.map(([id, title, points]) => `
    <div style="margin-bottom:14px">
      <div><b>${swatch(id)}${esc(MANAGERS[id].name)}</b> · ${esc(title)}</div>
      <ul class="muted" style="margin:6px 0 0 18px;font-size:13px">${points.filter(Boolean).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      ${id === "laser" ? laserNote : ""}
    </div>`).join("") + `
    <div class="note"><b>The same rules bind every one of them</b>, in code none of them can reach: $${(cc.max_buy || 50).toFixed(0)}
    per buy and one buy per bar, sell everything on ${Math.abs(cc.stop || 10)}% down in a day, sell everything on
    +${cc.take || 15}% up in a day, sell everything ${cc.giveback || 12}% below the best price a position has seen,
    $50 skimmed to a vault above $${(cc.lane_principal || 100).toFixed(0)} a lane, a lane closed at
    $${(cc.lane_floor || 70).toFixed(0)} and refilled from the reserve, and never more than $${(cc.total || 500).toFixed(0)}
    at risk. Stocks trade only 9:30–16:00 ET, with no buys in the first ${pr.no_entry_first_minutes || 5} or last
    ${pr.no_entry_last_minutes || 30} minutes or within ${pr.earnings_blackout_days || 2} days of earnings, and any
    decision older than ${pr.stale_decision_hours || 4} hours is re-checked against the current price and news before
    it buys. The <a href="#tournaments">Strategies page</a> sets out exactly what makes each of them buy or sell.</div>`;

  const p = d.picks || {};
  $("journal").innerHTML = agentsDiagram(pr) + (d.journal.length ? d.journal.map(j => `<div class="muted">${when(j.ts)} · ${esc(j.agent)}</div><p>${esc(j.content)}</p>`).join("")
    : `<p class="muted">The Coach writes its first review after the first night.</p>`) +
    (p.lanes ? `<div class="muted">Scout · ${when(p.ts)} · ${esc(p.by)}${p.scanned ? ` · scanned ${p.scanned}, ${p.qualified} liquid and moving, ${(p.candidates || []).length} passed backtests` : ""}</div>
      <p>Lead manager lanes: ${Object.entries(p.lanes).map(([k, v]) => `${k} ${esc(v)}`).join(" · ")}${p.momentum ? "\nMomentum's picks: " + p.momentum.picks.map(esc).join(", ") : ""}${p.claude_notes ? "\n" + esc(p.claude_notes) : ""}${p.claude_change ? "\nChange: " + esc(p.claude_change) : ""}</p>` : "");
  $("standings-sub").textContent = `· ${esc(MANAGERS[s.primary || "bluechip"]?.name || "")}'s lanes, strategy by strategy`;
  $("standings").innerHTML = (s.lanes || []).map(l => `<details ${l.id === 1 ? "open" : ""}><summary>Lane ${l.id} · ${esc(l.asset)} · leader: ${esc(l.leader ? l.leader.split("(")[0] : "cash")}</summary>
    <div class="tablewrap"><table><tr><th>Strategy</th><th class="num">Backtest</th><th class="num">Live</th><th class="num">Blended</th><th class="num">Entries</th><th>Status</th><th>Latest thinking</th></tr>
    ${(l.standings || []).map(r => `<tr><td>${r.leader ? "★ " : ""}${esc(r.key)}</td><td class="num">${r.prior.toFixed(1)}</td><td class="num">${pct(r.live_return_pct)}</td><td class="num">${r.blended.toFixed(1)}</td><td class="num">${r.entries}</td>
      <td>${r.survived ? "passed backtest" : r.eligible ? "earned live" : r.name === "hold" ? "benchmark" : "on probation"}</td><td>${esc(r.last)}</td></tr>`).join("")}</table></div></details>`).join("");
}

let myBuild = null;
function checkBuild(d) {
  if (!d || !d.build) return;
  if (myBuild === null) { myBuild = d.build; return; }
  if (d.build !== myBuild) location.reload();   // the engine was redeployed under us
}

async function refresh(attempt = 0) {
  if (window.HIGHWAY_SNAPSHOT) { render(window.HIGHWAY_SNAPSHOT); return; }  // static export
  try {
    const r = await fetch("/api/data", {cache: "no-store"});
    const d = await r.json();
    checkBuild(d);
    render(d);
  }
  catch (e) {
    if (attempt < 3) { setTimeout(() => refresh(attempt + 1), 1500); return; }  // engine restarting: try again
    $("status").textContent = "dashboard can't reach the engine"; $("status").className = "pill paused";
  }
}
document.querySelectorAll("nav.side button").forEach(b => b.onclick = () => showPage(b.dataset.page));
window.addEventListener("hashchange", () => {  // links like /#radar switch sections
  const id = location.hash.replace("#", "");
  if (document.querySelector(`section.page[data-page="${id}"]`)) showPage(id);
});
let startPage = (location.hash || "").replace("#", "");
try { startPage = startPage || localStorage.getItem("highway.page") || "leaderboard"; } catch (e) { startPage = "leaderboard"; }
wireSections();
showPage(document.querySelector(`section.page[data-page="${startPage}"]`) ? startPage : "leaderboard");
refresh(); setInterval(refresh, 30000);
let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(refresh, 250); });
</script>
</body>
</html>
"""

# A dashboard left open for six weeks will happily keep running the JavaScript it loaded on day
# one, so a deploy looks like a page that silently stopped updating. The client remembers the
# first build id it sees and reloads itself when the server reports a different one.
BUILD = hashlib.sha1(PAGE.encode()).hexdigest()[:8]
