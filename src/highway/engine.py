"""The engine: runs the league 24/7.

Four managers each run their own $500 paper portfolio under identical hard rules:
Quant (Scout picks + per-lane strategy tournaments), Laser (AI judgment every few hours),
Momentum (rotation into the strongest movers) and Hold (buy-and-hold benchmark).

Every few seconds: shared prices, then for each portfolio: fill or expire resting orders,
the -10% / +15% day rules, the critical-news guard, the vault skim and the lane floor.
Every closed bar: Quant's tournaments and watchlist update; every manager moves toward its
targets one $50 clip at a time. On a schedule: Scout (daily), Coach (nightly), Laser.
"""

from __future__ import annotations

import logging
import pickle
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd

from . import (agents, backtest, brains, health, mandate, metrics, radar, review, scout,
               seasonality, sim, skill, summaries, universe, venues)
from .backtest import PriceLookup, bars_per_day
from .book import EPS, Lane
from .calendar import equity_market_open, minutes_since_open, minutes_to_close
from .config import DATA_DIR, Settings, bar_minutes_for
from .db import DB
from .market import MarketData, asset_class
from .news import NewsDesk, same_story
from .params import Params
from .portfolio import Portfolio, Target, swap_guard
from .risk import Quote, RiskManager, stale_decision_reason
from .stockdata import StockData
from .tournament import LaneTournament

log = logging.getLogger("highway")

PAUSE_FILE = DATA_DIR / "PAUSE"
KILL_FILE = DATA_DIR / "KILL"
TOURNAMENT_DIR = DATA_DIR / "tournaments"
MANAGERS = [(m.id, m.name) for m in (mandate.MANDATES[k] for k in mandate.ORDER)]
EQUITY_QUOTE_SECONDS = 60  # Yahoo stock quotes at most once a minute per symbol


def history_days(asset: str) -> int:
    """Enough bars for the slowest strategy: 35 days of 15-minute crypto, 120 days of hourly stock bars."""
    return 35 if asset_class(asset) == "crypto" else 120


class Engine:
    def __init__(self, s: Settings, db: DB | None = None):
        self.s = s
        self.db = db or DB()
        self.params = Params(self.db.load_params())
        self._skill: tuple[float, dict] = (0.0, {})
        sim.set_dd_penalty(self.params["score_dd_penalty"])
        self.md = MarketData(s)
        self.risk = RiskManager(s, self.params)
        self.portfolios = {pid: Portfolio(pid, name, s, self.db) for pid, name in MANAGERS}
        # Every manager whose brain is the strategy tournament runs its own set of contests,
        # over its own mandate. They cannot share one, so the key is (manager, lane).
        self.tourn_pids = [m.id for m in mandate.MANDATES.values() if m.brain == "tournament"]
        # Momentum and Laser do not run tournaments, but they still need a ranked candidate
        # list of their own. Without one Momentum has nothing to rotate into at all, and Laser
        # silently inherits whichever mandate wrote the shared key last.
        self.scout_pids = [m.id for m in mandate.MANDATES.values()
                           if m.brain in ("tournament", "momentum", "laser")]
        self.primary = self.portfolios[self.tourn_pids[0]]
        self.bars: dict[str, pd.DataFrame] = {}
        self.tournaments: dict[tuple[str, int], LaneTournament] = {}
        self.bench: dict[str, LaneTournament] = {}  # shared watchlist: tracked live on paper
        self.quotes: dict[str, Quote] = {}
        self._quote_fetched: dict[str, float] = {}
        self.news_scores: dict[str, dict] = {}
        self.clock: dict = self.db.get_state("seasonality", {})  # measured weekday/hour patterns
        self.earnings: dict = self.db.get_state("earnings", {})  # upcoming report dates
        self.bar_seconds = s.bar_minutes * 60
        self.last_bar_start = 0.0
        self.last_news_guard = 0.0
        self.last_snapshot = 0.0
        self.last_equity = 0.0
        self.last_prune = 0.0
        self.last_picks_check = 0.0
        self.last_health = 0.0
        self.last_day_check = 0.0
        self.last_tick = 0.0
        self.last_scores = 0.0
        self.scorecards: list[dict] = []
        self.actions: queue.Queue = queue.Queue()  # work handed back from background threads
        self.busy = threading.Event()  # one background agent job at a time
        self.stop = threading.Event()
        self.pool = ThreadPoolExecutor(max_workers=8)
        self.handled_critical: set[str] = set(self.db.get_state("handled_critical", []))

    # ---- shared helpers used by portfolios -----------------------------------------------

    def market_open(self, lane: Lane, now: float) -> bool:
        return lane.asset_class == "crypto" or equity_market_open(now)

    def fresh(self, lane: Lane, now: float) -> Quote | None:
        """A current, sane price on the venue this lane trades on (new buys also need the cross-check)."""
        q = self.quotes.get(lane.asset) if lane.asset else None
        if q and self.risk.quote_ok(q, lane.asset_class, now, check_divergence=False).ok:
            return q.at(lane.venue)
        return None

    def price_at(self, asset: str, ts: float) -> float | None:
        return self.db.tick_near(asset, ts, 300) or self.md.price_at(asset, ts)

    def ensure_asset(self, asset: str) -> None:
        """Fetch a price right away for an asset a lane just switched to."""
        if asset not in self.quotes:
            q = self.md.quote(asset)
            if q:
                self.quotes[asset] = q
                self._quote_fetched[asset] = time.time()

    def session_tilt(self, asset: str, now: float) -> tuple[float, str]:
        """How favourable this moment is, from the measured weekday/hour pattern."""
        if not self.clock:
            return 0.0, ""
        return seasonality.tilt(self.clock, asset, now)

    def minutes_to_close(self, now: float) -> float | None:
        return minutes_to_close(now)

    def minutes_since_open(self, now: float) -> float | None:
        return minutes_since_open(now)

    def fresh_look(self, lane: Lane, target: Target, now: float) -> str | None:
        """Re-check an ageing buy decision against today's price and news before it executes."""
        decided = target.decided_at or now
        age_h = (now - decided) / 3600
        crossed_a_close = lane.asset_class == "equity" and (self.minutes_since_open(now) or 0) < 90 and age_h > 1
        q = self.quotes.get(lane.asset)
        return stale_decision_reason(
            lane.asset, age_h, crossed_a_close, self.news_scores.get(lane.asset) or {},
            q.ask if q else None, target.decided_price or self.price_at(lane.asset, decided),
            self.price_at(lane.asset, now - 86400), self.params["stale_decision_hours"], self.params["max_gap_pct"],
        )

    def earnings_in_days(self, asset: str) -> dict | None:
        """The company's next report, if it is close enough to matter."""
        return self.earnings.get(asset) if asset_class(asset) == "equity" else None

    def all_assets(self) -> set[str]:
        out = set(self.bench)
        for pf in self.portfolios.values():
            out |= pf.assets()
        return out

    def news_assets(self) -> list[str]:
        """Assets worth pulling dedicated news feeds for: everything held, watched or flagged."""
        flagged = [r["symbol"] for r in (self.db.get_state("radar", {}) or {}).get("alerts", [])[:8]]
        return sorted(self.all_assets() | set(flagged))

    # ---- setup ---------------------------------------------------------------------------

    def setup(self) -> None:
        # Venue listings first: a venue-pinned mandate cannot be resolved without them.
        self._venues()
        for pid in self.scout_pids:
            picks = self.db.get_state(f"scout_picks:{pid}")
            if not picks or time.time() - picks["ts"] > 36 * 3600:
                log.info("running the Scout for %s", pid)
                picks = self.scout_for(pid)
            if pid in self.tourn_pids:   # the others drive their own lanes from these picks
                self.apply_picks(pid, picks)
        for pid in self.tourn_pids:
            for lane in self.main_lanes(self.portfolios[pid]):
                if lane.status == "active" and lane.asset and (pid, lane.lane_id) not in self.tournaments:
                    self._init_lane(pid, lane)
        self._start_league()
        for pid, targets in self._plans().items():  # so the dashboard shows intentions right away
            self.portfolios[pid].targets.update(targets)
        self.last_bar_start = self._bar_start(time.time())
        for pf in self.portfolios.values():
            pf.save()

    def _venues(self) -> None:
        """Refresh coin listings and put every lane on the cheapest venue that lists its asset."""
        listings = self.db.get_state("listings", {})
        venues.set_listings(listings)
        if time.time() - (listings.get("ts") or 0) > 20 * 3600:
            venues.refresh_listings(self.db, self.md.http)
        for pf in self.portfolios.values():
            for lane in pf.fund.lanes:
                if lane.asset:
                    want = venues.venue_for(lane.asset)
                    if lane.venue != want:
                        lane.venue = want
                        pf.dirty = True
                        pf.event("venue", f"lane {lane.lane_id} {lane.asset} now trades on {venues.NAMES[want]}", lane.lane_id)

    def _start_league(self) -> None:
        """Record where every manager stands when the league begins, and fix Hold's assets."""
        if self.db.get_state("league_started"):
            return
        now = time.time()
        for pf in self.portfolios.values():
            for lane in pf.fund.lanes:
                if lane.asset:
                    self.ensure_asset(lane.asset)
        start = {pid: round(pf.total(self), 2) for pid, pf in self.portfolios.items()}
        self.db.set_state("league_started", now)
        self.db.set_state("league_start_values", start)
        self.db.set_state("hold_assets", self.hold_basket())
        self.db.event("info", "league", "league started: " + ", ".join(f"{self.portfolios[p].name} ${v:.2f}" for p, v in start.items()))

    def main_lanes(self, pf: Portfolio | None = None) -> list[Lane]:
        """The four contested lanes. The ETF sleeve is money too, but it is not in the contest,
        so the Scout, the tournaments and the brains all work on these."""
        return [l for l in (pf or self.primary).fund.lanes if l.kind == "main"]

    def _current(self, pf: Portfolio | None = None) -> dict[int, str | None]:
        return {l.lane_id: l.asset for l in self.main_lanes(pf) if l.status == "active"}

    def _pinned(self, pf: Portfolio | None = None) -> dict[int, str]:
        """Lanes that hold something keep their asset - a switch waits for them to go flat."""
        pf = pf or self.primary
        return {
            l.lane_id: l.asset
            for l in self.main_lanes(pf)
            if l.asset and (l.has_position or l.lane_pending > EPS or pf.lane_orders(l.lane_id))
        }

    def mandate_universe(self, pid: str, ranked: list[dict]) -> set[str]:
        """Which of the ranked assets this manager is allowed to hold."""
        m = mandate.MANDATES[pid]
        chips = set(self.db.get_state("bluechips", {}).get("symbols", []))
        listed = venues.listings()
        return {r["asset"] for r in ranked if mandate.allows(m, r["asset"], chips, listed)}

    def scout_for(self, pid: str, ranked: list[dict] | None = None,
                  returns: dict | None = None) -> dict:
        """Pick this manager's lanes from its own slice of the market."""
        m = mandate.MANDATES[pid]
        pf = self.portfolios[pid]
        if ranked is None:
            chips = set(self.db.get_state("bluechips", {}).get("symbols", []))
            ranked, returns = scout.rank(self.md, self.s, self.params, bluechips=chips)
        picks = scout.pick(self.md, self.s, self.db, self.params,
                           current=self._current(pf), pinned=self._pinned(pf),
                           allowed=self.mandate_universe(pid, ranked),
                           ranked=ranked, returns=returns, max_per_class=m.class_cap,
                           state_key=f"scout_picks:{pid}")
        picks["manager"] = pid
        self.db.set_state(f"scout_picks:{pid}", picks)
        return picks

    def _ensure_hold_basket(self) -> None:
        """Pick the benchmark's basket once, then leave it alone.

        This used to run `hold_basket()` on every Scout pass, which quietly turned the yardstick
        into an active manager: Hold rotated through 12 assets and made 30 buys in the first
        week, more churn than the Coinbase or ETF mandates. Everything in `skill.py` measures
        alpha, beta and contribution *against Hold*, so a drifting benchmark silently corrupts
        every skill number in the league - and "the benchmark is last" stops meaning anything.

        A lane the hard rules stop out is not re-scouted: the basket still names the same asset,
        so the lane buys it back once `cooldown_after_stop_h` passes. That is the owner's choice
        of Sept 29 - the rules still protect the benchmark, but they cannot rotate it.
        """
        if not self.db.get_state("hold_assets"):
            self.db.set_state("hold_assets", self.hold_basket())

    def hold_basket(self) -> list[str]:
        """The benchmark's four assets: one from each mandate it can reach.

        A yardstick that holds only crypto cannot measure a blue-chip manager's alpha, so Hold
        takes the best-ranked name from each slice rather than the best four overall.
        """
        out = []
        for pid in ("coinbase", "bluechip", "etf"):
            picks = self.db.get_state(f"scout_picks:{pid}", {}) or {}
            for a in (picks.get("lanes") or {}).values():
                if a and a not in out:
                    out.append(a)
                    break
        for pid in ("coinbase", "bluechip", "etf"):        # top up to four
            picks = self.db.get_state(f"scout_picks:{pid}", {}) or {}
            for a in (picks.get("lanes") or {}).values():
                if a and a not in out and len(out) < self.s.capital.lanes:
                    out.append(a)
        return out[: self.s.capital.lanes]

    def _pending_swap(self, pid: str, lane: Lane) -> str | None:
        """The asset a lane is due to move into once it is flat, or None when it is already there.

        Read from the stored picks rather than held in memory, so a restart cannot lose it.
        """
        want = ((self.db.get_state(f"scout_picks:{pid}", {}) or {}).get("lanes") or {}).get(str(lane.lane_id))
        return want if want and lane.asset and want != lane.asset else None

    def apply_picks(self, pid: str, picks: dict) -> None:
        pf = self.portfolios[pid]
        for lane in self.main_lanes(pf):
            want = picks["lanes"].get(str(lane.lane_id))
            if lane.status != "active" or not want or want == lane.asset:
                continue
            if lane.asset and (lane.has_position or lane.lane_pending > EPS or pf.lane_orders(lane.lane_id)):
                pf.event("swap_waiting", f"lane {lane.lane_id}: will switch {lane.asset} -> {want} once flat", lane.lane_id)
                continue
            self._assign(pid, lane, want, "scout")
        self.db.set_state(f"picks_applied:{pid}", picks["ts"])
        if pid == self.primary.id:
            self._sync_bench(picks.get("bench", []))

    def _assign(self, pid: str, lane: Lane, asset: str, why: str) -> None:
        """Put `asset` in a flat lane. A watchlist tournament (with its live history) moves with it."""
        pf = self.portfolios[pid]
        old = lane.asset
        if not pf.switch(lane, asset, why):
            return
        old_t = self.tournaments.pop((pid, lane.lane_id), None)
        if old_t is not None and old and old not in self.bench:
            old_t.lane_id = 0
            self.bench[old] = old_t  # keep watching the asset we just left
        promoted = self.bench.pop(asset, None)
        if promoted is not None:
            promoted.lane_id = lane.lane_id
            self.tournaments[(pid, lane.lane_id)] = promoted
            if asset not in self.bars:
                self.bars[asset] = self._load_bars(asset)
        else:
            self._init_lane(pid, lane)
        assigned = self.db.get_state("lane_assigned", {})
        assigned[f"{pid}:{lane.lane_id}"] = time.time()
        self.db.set_state("lane_assigned", assigned)
        self.ensure_asset(asset)

    def _sync_bench(self, wanted: list[str]) -> None:
        in_lanes = {l.asset for pf in self.portfolios.values() for l in pf.fund.lanes if l.asset}
        wanted = [a for a in wanted if a not in in_lanes]
        for a in list(self.bench):
            if a not in wanted:
                self.bench.pop(a)
                self._tournament_path(a).unlink(missing_ok=True)
        for a in wanted:
            if a in self.bench:
                continue
            t = self._load_tournament_file(self._tournament_path(a), a)
            if t is None:
                bts = backtest.latest(self.db, a, max_age_days=3)
                if not bts:
                    continue
                t = LaneTournament.create(0, a, self.s, self.params, bts)
            self.bench[a] = t
            self.bars[a] = self._load_bars(a)
        self.primary.event("bench", f"watchlist: {', '.join(self.bench) or 'empty'}")

    def _load_bars(self, asset: str) -> pd.DataFrame:
        try:
            return self._closed(self.md.bars(asset, bar_minutes_for(self.s, asset), time.time() - history_days(asset) * 86400), asset)
        except Exception as e:
            self.db.event("warn", "bars_error", f"{asset}: could not load history: {e}")
            return pd.DataFrame()

    def _init_lane(self, pid: str, lane: Lane) -> None:
        asset = lane.asset
        self.bars[asset] = self._load_bars(asset)
        t = self._load_tournament_file(self._tournament_path((pid, lane.lane_id)), asset)
        if t is None:
            bts = backtest.latest(self.db, asset, max_age_days=3) or scout.survivors(self.md, self.s, self.db, self.params, asset)
            t = LaneTournament.create(lane.lane_id, asset, self.s, self.params, bts)
            self.portfolios[pid].event(
                "tournament", f"lane {lane.lane_id} {asset}: {len(t.contenders)} strategies, leader {t.leader or 'cash'}", lane.lane_id)
        self.tournaments[(pid, lane.lane_id)] = t

    def _tournament_path(self, key):
        """Each manager keeps its own contests on disk; the watchlist is shared."""
        if isinstance(key, tuple):
            return TOURNAMENT_DIR / f"lane_{key[0]}_{key[1]}.pkl"
        return TOURNAMENT_DIR / f"bench_{key}.pkl"

    def _load_tournament_file(self, path, asset: str) -> LaneTournament | None:
        if not path.exists():
            return None
        try:
            t: LaneTournament = pickle.loads(path.read_bytes())
        except Exception:
            return None
        if t.asset != asset or getattr(t, "bar_minutes", 15) != bar_minutes_for(self.s, asset):
            return None
        if asset_class(asset) == "crypto" and time.time() - t.last_bar_ts > 6 * 3600:
            return None  # too big a gap to keep the shadows honest
        for c in t.contenders.values():  # re-link shared, tunable params
            c.sim.params = self.params
            c.sim.risk = RiskManager(self.s, self.params)
        return t

    def _save_tournament(self, pid: str | None, t: LaneTournament) -> None:
        TOURNAMENT_DIR.mkdir(parents=True, exist_ok=True)
        path = self._tournament_path((pid, t.lane_id) if pid and t.lane_id else t.asset)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(pickle.dumps(t))
        tmp.replace(path)

    # ---- main loop -----------------------------------------------------------------------

    def run(self) -> None:
        self.setup()
        threading.Thread(target=self._news_loop, name="news", daemon=True).start()
        threading.Thread(target=radar.Radar(self).loop, name="radar", daemon=True).start()
        from .dashboard import serve

        threading.Thread(target=serve, args=(self.s, self.db), name="dashboard", daemon=True).start()
        log.info("engine running: dashboard at http://%s:%s", self.s.dashboard.host, self.s.dashboard.port)
        self.db.event("info", "engine_start", "engine started (paper mode, league of 4 managers)")
        while not self.stop.is_set():
            started = time.time()
            try:
                self.tick()
            except Exception as e:
                log.exception("tick failed")
                self.db.event("error", "tick_error", f"{type(e).__name__}: {e}")
            self.stop.wait(max(1.0, self.s.poll_seconds - (time.time() - started)))

    def _refresh_quotes(self, now: float) -> None:
        due = [
            a for a in self.all_assets()
            if asset_class(a) == "crypto" or now - self._quote_fetched.get(a, 0) >= EQUITY_QUOTE_SECONDS
        ]
        for a, q in zip(due, self.pool.map(self.md.quote, due)):
            if q:
                self.quotes[a] = q
                self._quote_fetched[a] = now
                self.db.add_tick(q.asset, q.ts, q.bid, q.ask, q.last, q.cross_check_pct)

    def tick(self) -> None:
        now = time.time()
        gap = now - self.last_tick if self.last_tick else 0
        if gap > 300:  # the Mac slept, or the engine was restarted: positions were unattended
            minutes = gap / 60
            self.db.event("warn", "gap", f"engine was not running for {minutes:.0f} minutes - no prices, no exits in that window")
            if minutes > 20:
                health.notify("Highway", f"Back after {minutes:.0f} minutes offline. Checking positions now.")
        self.last_tick = now
        while not self.actions.empty():
            self.actions.get_nowait()()
        if KILL_FILE.exists():
            for pf in self.portfolios.values():
                pf.kill(self, now)
            PAUSE_FILE.write_text(f"paused by kill switch at {datetime.now(timezone.utc).isoformat()}\n")
            KILL_FILE.unlink(missing_ok=True)
            self.db.event("warn", "kill", "kill switch: sold what could be sold in every portfolio, trading paused")
            health.notify("Highway", "Kill switch: positions sold and trading paused.")
        paused = PAUSE_FILE.exists()
        self._refresh_quotes(now)
        for pf in self.portfolios.values():
            pf.fund.settle(now)
            pf.work_orders(self, now)
            for lane in pf.fund.lanes:
                if lane.status == "active" and lane.asset:
                    pf.hard_rules(self, lane, now)
                    self._earnings_guard(pf, lane, now)
        if now - self.last_news_guard >= 60:
            self.last_news_guard = now
            self._news_guard(now)
        for pf in self.portfolios.values():
            for lane in pf.fund.lanes:
                if lane.status == "active" and lane.asset:
                    result = pf.skim_and_floor(self, lane, now)
                    if result == "closed":
                        health.notify("Highway", f"{pf.name}: lane {lane.lane_id} hit the $70 floor and the reserve is empty; lane closed.")
                    if result and pf.id in self.tourn_pids:
                        self.tournaments.pop((pf.id, lane.lane_id), None)
                        if result == "refilled":
                            self._background("refill scout", self._refill_pick, pf.id, lane.lane_id)
        bar_start = self._bar_start(now)
        if bar_start > self.last_bar_start and now - bar_start >= 20:  # let the exchange finalise the bar
            self.last_bar_start = bar_start
            self._on_bar(now, paused)
        self._maybe_agents(now)
        if now - self.last_picks_check >= 300:
            self.last_picks_check = now
            self._sync_params()
            for pid in self.tourn_pids:   # picked up from a manual `highway scout`
                picks = self.db.get_state(f"scout_picks:{pid}")
                if picks and picks["ts"] > (self.db.get_state(f"picks_applied:{pid}") or 0):
                    self.apply_picks(pid, picks)
        for pf in self.portfolios.values():
            if pf.needs_save():
                pf.save()
        if now - self.last_day_check >= 300:
            self.last_day_check = now
            self._close_days(now)
        if now - self.last_health >= 60:
            self.last_health = now
            try:
                health.update(self, now)
            except Exception as e:
                log.exception("health")
                self.db.event("warn", "health_error", str(e))
        if now - self.last_scores >= 300 or not self.scorecards:
            self.last_scores = now
            self.scorecards = self._scorecards()
        if now - self.last_snapshot >= 30:
            self.last_snapshot = now
            self.db.set_state("snapshot", self.snapshot(now, paused))
        if now - self.last_equity >= 300:
            self.last_equity = now
            self._record_equity(now)
        if now - self.last_prune >= 6 * 3600:
            self.last_prune = now
            self.db.execute("DELETE FROM ticks WHERE ts < ?", (now - 10 * 86400,))

    def _bar_start(self, ts: float) -> float:
        return (ts // self.bar_seconds) * self.bar_seconds

    def _closed(self, df: pd.DataFrame, asset: str) -> pd.DataFrame:
        if df.empty:
            return df
        return df[df.index + bar_minutes_for(self.s, asset) * 60 <= time.time()]

    def _refill_pick(self, pid: str, lane_id: int) -> None:
        """A refilled lane needs a fresh asset - from its own manager's mandate, not the market."""
        pf = self.portfolios[pid]
        keep = {l.lane_id: l.asset for l in self.main_lanes(pf) if l.asset and l.lane_id != lane_id}
        picks = self.scout_for(pid)
        picks["lanes"] = {**picks.get("lanes", {}), **{str(k): v for k, v in keep.items()}}
        self.actions.put(lambda p=pid, pk=picks: self.apply_picks(p, pk))

    # ---- news guard (applies to every portfolio) -----------------------------------------

    def _earnings_guard(self, pf: Portfolio, lane: Lane, now: float) -> None:
        """Earnings gap overnight, when the day rules cannot act. Optionally step aside first."""
        if not self.params["exit_before_earnings"] or not lane.has_position:
            return
        report = self.earnings_in_days(lane.asset)
        if not report or report["days_away"] > 1 or not equity_market_open(now):
            return
        if (self.minutes_to_close(now) or 999) > 45:
            return  # only in the last part of the session before the report
        q = self.fresh(lane, now)
        if q:
            pf.exit(self, lane, q, now, "earnings", f"{lane.asset} reports {report['when']} on {report['date']}")

    def _news_guard(self, now: float) -> None:
        desk = NewsDesk(self.s, self.db, http=self.md.http)
        for asset in self.all_assets():
            self.news_scores[asset] = desk.asset_score(asset, now)
        for asset in {l.asset for pf in self.portfolios.values() for l in pf.fund.lanes if l.asset and l.has_position}:
            sc = self.news_scores.get(asset) or {}
            fresh = [c for c in sc.get("critical", []) if f"{asset}|{c['title']}" not in self.handled_critical]
            if not fresh:
                continue
            for c in fresh:
                self.handled_critical.add(f"{asset}|{c['title']}")
            self.db.set_state("handled_critical", sorted(self.handled_critical)[-500:])
            q = self.quotes.get(asset)
            before = self.price_at(asset, now - 3600)
            if not q or not before:
                continue
            move = (q.bid / before - 1) * 100
            titles = [c["title"] for c in fresh]
            if move <= -self.params["news_exit_drop_pct"]:
                self._news_exit(asset, f"critical news and {move:+.1f}% in 1h: {titles[0][:90]}")
                continue
            judged = [t for t in self.db.get_state("triaged", []) if t["asset"] == asset and now - t["ts"] < 24 * 3600]
            if all(any(same_story(title, j["title"]) and j["action"] == "hold" for j in judged) for title in titles):
                self.db.event("info", "news_flag", f"{asset}: same story the AI already judged harmless; holding")
                continue
            self.db.event("info", "news_flag", f"{asset}: critical headline, price {move:+.1f}% in 1h, asking the AI")
            self._background("triage", self._triage, asset, titles, move)

    def _news_exit(self, asset: str, detail: str) -> None:
        now = time.time()
        for pf in self.portfolios.values():
            for lane in pf.fund.lanes:
                q = self.fresh(lane, now) if lane.asset == asset else None
                if q and lane.has_position:
                    pf.exit(self, lane, q, now, "news_exit", detail)

    def _triage(self, asset: str, titles: list[str], move: float) -> None:
        action = agents.triage(self.s, self.db, asset, titles, move)
        if action:
            judged = [t for t in self.db.get_state("triaged", []) if time.time() - t["ts"] < 48 * 3600]
            judged += [{"asset": asset, "title": t, "ts": time.time(), "action": action} for t in titles]
            self.db.set_state("triaged", judged[-200:])
        if action == "exit":
            self.actions.put(lambda: self._news_exit(asset, f"the AI judged the news a direct threat: {titles[0][:90]}"))

    def _news_loop(self) -> None:
        desk = NewsDesk(self.s, self.db)
        while not self.stop.is_set():
            try:
                n = desk.collect(self.news_assets())
                log.info("news: %d new headlines", n)
            except Exception as e:
                log.exception("news loop")
                self.db.event("warn", "news_error", str(e))
            self.stop.wait(self.s.news.poll_minutes * 60)

    # ---- bars: Quant tournaments, watchlist, and every manager's targets -----------------

    def _refresh_bars(self, asset: str, now: float) -> pd.DataFrame:
        old = self.bars.get(asset, pd.DataFrame())
        crypto = asset_class(asset) == "crypto"
        start = now - (4 * 3600 if crypto else 4 * 86400) if not old.empty else now - history_days(asset) * 86400
        try:
            new = self.md.bars(asset, bar_minutes_for(self.s, asset), start)
        except Exception as e:
            log.warning("bars %s: %s", asset, e)
            return self._closed(old, asset)
        df = pd.concat([old, new]) if not old.empty and not new.empty else (new if old.empty else old)
        df = df[~df.index.duplicated(keep="last")].sort_index()
        df = self._closed(df[df.index > now - (history_days(asset) + 1) * 86400], asset)
        self.bars[asset] = df
        return df

    def _feed(self, t: LaneTournament, asset: str, now: float) -> bool:
        """Give a tournament its newest closed bar. Returns True if there was a new one."""
        df = self._refresh_bars(asset, now)
        minutes = bar_minutes_for(self.s, asset)
        bpd = bars_per_day(asset, minutes)
        if df.empty or len(df) < t.warmup_bars(bpd) // 2:
            return False
        news = self.news_scores.get(asset, {"score": 0.0, "count": 0})
        before = t.last_bar_ts
        t.on_bar(df, news, self.params, bpd, minutes * 60, PriceLookup(df, minutes * 60))
        return t.last_bar_ts != before

    def _on_bar(self, now: float, paused: bool) -> None:
        # Every tournament-driven manager runs its own contests over its own mandate.
        for pid in self.tourn_pids:
            pf = self.portfolios[pid]
            for lane in self.main_lanes(pf):
                t = self.tournaments.get((pid, lane.lane_id))
                if lane.status != "active" or not lane.asset or t is None:
                    continue
                if not self._feed(t, lane.asset, now):
                    if t.last_bar_ts == 0:
                        pf.blocks[lane.lane_id] = "not enough price history yet"
                    continue  # no new bar (e.g. stock market closed)
                if t.changes and t.changes[-1]["ts"] >= t.last_bar_ts:
                    ch = t.changes[-1]
                    pf.event("leader", f"lane {lane.lane_id} {lane.asset}: leader {ch['from'] or 'cash'} -> {ch['to'] or 'cash'} (score {ch['score']})", lane.lane_id)
                self._save_tournament(pid, t)
                d = t.target()
                q = self.quotes.get(lane.asset)
                target = Target(lane.asset, d.target_clips, d.expected_move_pct, d.reason,
                                t.leader or "", now, q.ask if q else 0.0)
                # A tournament always targets the asset the lane already holds, so `follow`'s
                # own switch path never fires for it. Without this the lane keeps buying an
                # asset the Scout has already moved it off.
                pf.follow(self, lane, swap_guard(target, len(lane.tranches), self._pending_swap(pid, lane)),
                          now, paused)
        for asset, t in list(self.bench.items()):
            try:
                if self._feed(t, asset, now):
                    self._save_tournament(None, t)
            except Exception as e:
                log.warning("bench %s: %s", asset, e)
        self._publish_live_scores(now)
        self._maybe_promote(now)
        # The other managers move toward their brain's targets.
        for pid, targets in self._plans().items():
            pf = self.portfolios[pid]
            for lane in pf.fund.lanes:
                target = targets.get(lane.lane_id)
                if target:
                    try:
                        pf.follow(self, lane, target, now, paused)
                    except Exception as e:
                        log.exception("%s follow", pid)
                        pf.event("follow_error", f"lane {lane.lane_id}: {e}", lane.lane_id, "warn")

    def _plans(self) -> dict[str, dict[int, Target]]:
        mom = self.db.get_state(f"scout_picks:momentum", {}) or {}
        return {
            "laser": brains.laser_targets(self.portfolios["laser"], self.db.get_state("brain:laser")),
            "momentum": brains.momentum_targets(self.portfolios["momentum"], mom,
                                                mandate.MANDATES["momentum"].class_cap),
            "hold": brains.hold_targets(self.portfolios["hold"], self.db.get_state("hold_assets", [])),
        }

    def _publish_live_scores(self, now: float) -> None:
        scores = {t.asset: t.summary(self.params, now) for t in [*self.tournaments.values(), *self.bench.values()]}
        self.db.set_state("live_scores", scores)

    def _idle_hours(self, pid: str, lane: Lane, now: float) -> float:
        rows = self.db.query("SELECT MAX(ts) AS ts FROM fills WHERE lane_id=? AND portfolio=?", (lane.lane_id, pid))
        last_fill = rows[0]["ts"] or 0.0
        assigned = self.db.get_state("lane_assigned", {}).get(f"{pid}:{lane.lane_id}", 0.0)
        return (now - max(last_fill, assigned)) / 3600

    def _maybe_promote(self, now: float) -> None:
        """A lane idle in cash for a day hands its slot to a watchlist asset that is working.

        The replacement must still be inside that manager's mandate - a blue-chip lane cannot
        be handed a coin just because the coin is doing well.
        """
        chips = set(self.db.get_state("bluechips", {}).get("symbols", []))
        listed = venues.listings()
        for pid in self.tourn_pids:
            pf, m = self.portfolios[pid], mandate.MANDATES[pid]
            for lane in self.main_lanes(pf):
                if lane.status != "active" or not lane.asset or lane.has_position or lane.lane_pending > EPS:
                    continue
                if pf.lane_orders(lane.lane_id) or self._idle_hours(pid, lane, now) < self.params["promote_after_flat_h"]:
                    continue
                own = self.tournaments.get((pid, lane.lane_id))
                own_score = (own.summary(self.params, now)["score"] if own else None) or 0.0
                others = [l.asset for l in self.main_lanes(pf) if l.asset and l.lane_id != lane.lane_id]
                best, best_score = None, own_score + self.params["switch_margin_pct"]
                for asset, t in self.bench.items():
                    if not mandate.allows(m, asset, chips, listed):
                        continue
                    sm = t.summary(self.params, now)
                    same_class = sum(1 for o in others if asset_class(o) == asset_class(asset))
                    if same_class >= m.class_cap or not sm["wants_in"] or not sm["in_position"]:
                        continue
                    if (sm["return_pct"] or 0) <= 0 or sm["score"] is None or sm["score"] <= best_score:
                        continue
                    best, best_score = asset, sm["score"]
                if best:
                    self._assign(pid, lane, best,
                                 f"promoted from the watchlist after {self._idle_hours(pid, lane, now):.0f}h idle; live score {best_score:.1f}")

    # ---- agents on a schedule ------------------------------------------------------------

    def _background(self, name: str, fn, *args) -> None:
        def wrapped():
            try:
                fn(*args)
            except Exception as e:
                log.exception(name)
                self.db.event("warn", "agent_error", f"{name}: {type(e).__name__}: {e}")
            finally:
                self.busy.clear()

        if self.busy.is_set():
            self.actions.put(lambda: self._background(name, fn, *args))  # try again next tick
            return
        self.busy.set()
        threading.Thread(target=wrapped, name=name, daemon=True).start()

    def _maybe_agents(self, now: float) -> None:
        if self.busy.is_set():
            return
        utc = datetime.fromtimestamp(now, timezone.utc)
        today = utc.strftime("%Y-%m-%d")
        if utc.hour >= self.s.agents.scout_hour_utc and self.db.get_state("last_scout_day") != today:
            self.db.set_state("last_scout_day", today)
            self._background("daily scout", self._daily_scout)
            return
        if utc.hour >= self.s.agents.coach_hour_utc and self.db.get_state("last_coach_day") != today:
            if now - self.db.get_state("fund_started", now) > 12 * 3600:
                self.db.set_state("last_coach_day", today)
                self._background("nightly coach", self._coach, self.coach_report(now))
                return
        week = review.week_number(self, now)
        if 1 <= week <= review.LEAGUE_WEEKS and week > (self.db.get_state("last_review_week") or 0):
            self.db.set_state("last_review_week", week)
            self._background("weekly review", self._weekly, now)
            return
        last = (self.db.get_state("brain:laser") or {}).get("ts", 0)
        tried = self.db.get_state("brain:laser_tried", 0)
        opened = self.minutes_since_open(now)
        holds_stock = any(l.asset_class == "equity" for pf in self.portfolios.values() for l in pf.fund.lanes if l.asset)
        if opened is not None and 5 <= opened <= 25 and holds_stock and last < now - opened * 60 and tried < now - 3600:
            self.db.set_state("brain:laser_tried", now)  # the market just opened: look again with today's news
            self._background("laser manager", brains.laser_decide, self, self.portfolios["laser"], now)
            return
        if now - max(last, tried) >= self.params["laser_manager_hours"] * 3600:
            self.db.set_state("brain:laser_tried", now)
            self._background("laser manager", brains.laser_decide, self, self.portfolios["laser"], now)

    def _daily_scout(self) -> None:
        """Score the whole market once, then pick lanes for each mandate from that one ranking."""
        md = MarketData(self.s)
        chips = set(universe.bluechips(StockData(self.db), self.db))
        ranked, returns = scout.rank(md, self.s, self.params, bluechips=chips)
        desk = NewsDesk(self.s, self.db, http=md.http)
        for pid in self.scout_pids:
            picks = self.scout_for(pid, ranked=ranked, returns=returns)
            if pid == self.primary.id:  # the AI reviews the lead manager's picks only
                try:
                    heads = {c["asset"]: [h["title"] for h in desk.asset_score(c["asset"])["top"]]
                             for c in picks["candidates"][:12]}
                    picks = agents.scout_review(self.s, self.db, picks, heads, pinned=self._pinned())
                    self.db.set_state(f"scout_picks:{pid}", picks)
                except Exception as e:  # the AI review is optional; the Python picks still stand
                    log.exception("scout review")
                    self.db.event("warn", "agent_error",
                                  f"scout review failed ({type(e).__name__}); keeping the Python picks")
            self.db.event("info", "scout", f"{self.portfolios[pid].name}: {picks['lanes']} ({picks['by']})")
            if pid in self.tourn_pids:
                self.actions.put(lambda p=pid, pk=picks: self.apply_picks(p, pk))
        self.db.set_state("scout_picks", self.db.get_state(f"scout_picks:{self.primary.id}", {}))
        self.actions.put(self._ensure_hold_basket)

    def _coach(self, report: dict) -> None:
        result = agents.coach(self.s, self.db, report, self.params.as_dict())

        def apply():
            for ch in result["changes"]:
                old, new = self.params.set(ch["key"], ch["value"])
                self.db.save_param(ch["key"], old, new, "coach", ch["reason"])
                self.db.event("info", "tune", f"coach: {ch['key']} {old:g} -> {new:g} ({ch['reason']})")
            if result["journal"]:
                self.db.journal("coach", result["journal"])

        self.actions.put(apply)

    def _sync_params(self) -> None:
        """Pick up setting changes made outside the engine (e.g. `highway weights --apply`)."""
        for key, value in self.db.load_params().items():
            if key in self.params.as_dict() and abs(self.params[key] - value) > 1e-12:
                self.params.set(key, value)
        sim.set_dd_penalty(self.params["score_dd_penalty"])

    def _close_days(self, now: float) -> None:
        """When a league day finishes, write its summary and the running week table."""
        names = {pid: pf.name for pid, pf in self.portfolios.items()}
        done = int(self.db.get_state("last_day_summarised") or 0)
        today = summaries.current_day(self.db, now)
        for day in range(done + 1, today):  # only days that have fully ended
            rows = summaries.build_day(self.db, day, names)
            if not rows:
                continue
            self.db.set_state("last_day_summarised", day)
            summaries.write_week_table(self.db, names)
            board = " · ".join(f"{r['name']} {r['return_pct']:+.2f}%" for r in rows)
            self.db.event("info", "day_summary", f"day {day} closed: {board}")
            health.notify(f"Highway day {day}", board)

    def _weekly(self, now: float) -> None:
        result = review.run_review(self, now)

        def apply():
            for ch in result["changes"]:
                old, new = self.params.set(ch["key"], ch["value"])
                self.db.save_param(ch["key"], old, new, "weekly review", ch["reason"])
                self.db.event("info", "tune", f"weekly review: {ch['key']} {old:g} -> {new:g} ({ch['reason']})")
            self.db.journal(f"weekly review (week {result['week']})", result["summary"])

        self.actions.put(apply)

    def _scorecards(self) -> list[dict]:
        start = self.db.get_state("league_started")
        if not start:
            return []
        starts = self.db.get_state("league_start_values", {})
        hold = metrics.scorecard(self.db, "hold", start, starts.get("hold", 500.0))
        return [metrics.scorecard(self.db, pid, start, starts.get(pid, 500.0), hold.get("return_pct")) | {"name": pf.name}
                for pid, pf in self.portfolios.items()]

    def coach_report(self, now: float) -> dict:
        since = now - 86400
        fills = self.db.query("SELECT portfolio, lane_id, asset, side, cash, fee, reason, strategy FROM fills WHERE ts > ?", (since,))
        events = self.db.query("SELECT kind, message FROM events WHERE ts > ? AND kind NOT IN ('agent_call')", (since,))
        lanes = []
        for lane in self.primary.fund.lanes:
            t = self.tournaments.get((self.primary.id, lane.lane_id))
            q = self.quotes.get(lane.asset) if lane.asset else None
            lanes.append({
                "lane": lane.lane_id,
                "asset": lane.asset,
                "equity": round(lane.equity(q.bid if q else None), 2),
                "leader": t.leader if t else None,
                "standings": t.standings(self.params, now)[:6] if t else [],
                "news": {k: v for k, v in self.news_scores.get(lane.asset, {}).items() if k in ("score", "count")},
                "blocked_by": self.primary.blocks.get(lane.lane_id),
            })
        league = self.db.get_state("snapshot", {}).get("league", [])
        return {"quant_lanes": lanes, "league": league, "fills": fills[-40:], "events": [e["message"] for e in events][-40:]}

    # ---- reporting -----------------------------------------------------------------------

    def snapshot(self, now: float, paused: bool) -> dict:
        start_values = self.db.get_state("league_start_values", {})
        league = sorted((pf.summary(self, now, start_values) for pf in self.portfolios.values()), key=lambda m: -m["since_league_pct"])
        q = next(m for m in league if m["id"] == self.primary.id)
        primary_id = self.primary.id
        lanes = self.primary.lane_rows(self, now)
        for row in lanes:
            t = self.tournaments.get((self.primary.id, row["id"]))
            row["role"] = scout.CLASS_LABEL.get(row["class"], "") if row["asset"] else ""
            row["standings"] = t.standings(self.params, now) if t else []
            if t and not row["target_reason"]:  # before the first bar after a restart
                d = t.target()
                row.update(target_clips=d.target_clips, target_reason=d.reason, leader=t.leader)
        managers = {}
        for pid, pf in self.portfolios.items():
            if pid == self.primary.id:
                continue
            rows = pf.lane_rows(self, now)
            for row in rows:
                row["role"] = scout.CLASS_LABEL.get(row["class"], "") if row["asset"] else ""
            managers[pid] = rows
        started = self.db.get_state("fund_started", now)
        days = max((now - started) / 86400, 1e-6)
        return {
            "ts": now,
            "mode": self.s.mode,
            "paused": paused,
            "total": q["total"],
            "start_value": self.s.capital.lane_principal * self.s.capital.lanes + self.s.capital.reserve,
            "return_pct": q["return_pct"],
            "days": round(days, 2),
            "pace_pct": q["pace_pct"],
            "monthly_equiv_pct": round(((1 + q["return_pct"] / 100) ** (30 / max(days, 1)) - 1) * 100, 2) if days >= 1 else None,
            "vault": q["vault"],
            "reserve": q["reserve"],
            "fees_paid": q["fees_paid"],
            "lanes": lanes,
            "league": league,
            "league_started": self.db.get_state("league_started"),
            "league_week": review.week_number(self, now) + 1,
            "league_day": summaries.current_day(self.db, now),
            "days": summaries.days(self.db)[-40:],
            "weeks": summaries.weeks(self.db, {pid: pf.name for pid, pf in self.portfolios.items()}),
            "months": summaries.months(self.db, {pid: pf.name for pid, pf in self.portfolios.items()}),
            "league_weeks": review.LEAGUE_WEEKS,
            "scorecards": self.scorecards,
            "health": self.db.get_state("health"),
            "reviews": (self.db.get_state("weekly_reviews") or [])[-3:],
            "managers": managers,
            "primary": primary_id,   # whose lanes the per-lane tournament view shows
            "laser_brain": {k: v for k, v in (self.db.get_state("brain:laser") or {}).items() if k in ("ts", "notes")},
            "clock": {
                "ts": self.clock.get("ts"),
                "equity": {k: v for k, v in (self.clock.get("equity") or {}).items() if k in ("weekday", "window", "weekday_window", "gaps", "source", "bars")},
                "crypto": {k: v for k, v in (self.clock.get("crypto") or {}).items() if k in ("weekday", "window", "weekday_window", "source", "bars")},
                "now": {a: dict(zip(("tilt", "why"), self.session_tilt(a, now))) for a in sorted(self.all_assets())[:8]},
                "session": {
                    "stocks_open": equity_market_open(now),
                    "minutes_to_close": self.minutes_to_close(now),
                    "minutes_since_open": self.minutes_since_open(now),
                },
                "guards": {
                    "first_minutes": self.params["no_entry_first_minutes"],
                    "last_minutes": self.params["no_entry_last_minutes"],
                    "earnings_days": self.params["earnings_blackout_days"],
                    "exit_before_earnings": bool(self.params["exit_before_earnings"]),
                },
                "earnings": {a: self.earnings[a] for a in sorted(self.all_assets()) if a in self.earnings},
            },
            "radar": {k: v for k, v in (self.db.get_state("radar", {}) or {}).items()
                      if k in ("ts", "regime", "tracked", "alerts", "rows", "buckets", "min_signals", "candidates")},
            "universe": {k: v for k, v in (self.db.get_state("universe", {}) or {}).items() if k in ("ts", "counts", "scanned_stocks")},
            "bench": [
                {"asset": a, "class": scout.CLASS_LABEL[asset_class(a)], **t.summary(self.params, now)}
                for a, t in sorted(self.bench.items(), key=lambda kv: -(kv[1].summary(self.params, now)["score"] or -99))
            ],
            "params": self.params.as_dict(),
            "capital": {  # so the strategy note stays true if the owner changes the shape
                "lanes": self.s.capital.lanes, "lane_principal": self.s.capital.lane_principal,
                "lane_cap": self.s.capital.lane_cap, "sleeve_lanes": self.s.capital.sleeve_lanes,
                "sleeve_principal": self.s.capital.sleeve_principal, "reserve": self.s.capital.reserve,
                "total": self.s.capital.total_risk_cap, "max_buy": self.s.capital.max_buy,
                "target_pct": self.s.target.monthly * 100,
                "target_low": self.s.target.monthly_low * 100,
                "target_high": self.s.target.monthly_high * 100,
                "stop": self.s.rules.stop_loss_day_pct, "take": self.s.rules.take_profit_day_pct,
                "giveback": self.s.rules.giveback_pct, "lane_floor": self.s.capital.lane_floor,
                "max_buys_per_day": self.s.rules.max_buys_per_lane_per_day,
                "divergence_pct": self.s.rules.max_price_divergence_pct,
                "day_hours": self.s.rules.day_window_hours,
            },
            "skill": self.skill_board(now),
            "radar_funnel": self.radar_funnel(),
            "fear_greed": self.db.get_state("fear_greed"),
            "ai_calls_today": agents.calls_today(self.db),
        }

    def radar_funnel(self) -> dict:
        """How far the radar's flagged names actually get: scanned, alerting, tested, held.

        A green indicator grid is easy to mistake for a buy list, so this counts what survives
        each stage - and, crucially, how many names the radar surfaced that the ordinary ranking
        would never have looked at.
        """
        rd = self.db.get_state("radar", {}) or {}
        cands = self.db.get_state("radar_candidates", {}) or {}
        passed = {k for k, v in cands.items() if v.get("passed")}
        shortlisted, held, extra = set(), set(), set()
        for pid in self.scout_pids:
            p = self.db.get_state(f"scout_picks:{pid}", {}) or {}
            ranked = p.get("ranked", [])
            n = self.s.scout.shortlist
            ordinary = (set([r["asset"] for r in ranked if r["class"] == "crypto"][:n])
                        | set([r["asset"] for r in ranked if r["class"] == "equity"][:n]))
            names = {c["asset"] for c in p.get("candidates", [])}
            lanes = {v for v in (p.get("lanes") or {}).values() if v}
            shortlisted |= names & passed
            held |= lanes & passed
            extra |= (names & passed) - ordinary
        return {"tracked": rd.get("tracked", 0), "alerts": len(rd.get("alerts", [])),
                "tested": len(cands), "passed": len(passed),
                "shortlisted": len(shortlisted), "held": len(held),
                "only_via_radar": sorted(extra)[:12], "min_signals": int(self.params["radar_min_signals"])}

    def skill_board(self, now: float) -> dict:
        """Who is actually adding something, rather than who took the most risk.

        Recomputed every few minutes rather than every tick: it reads the whole league history
        and the answer cannot meaningfully change in ten seconds.
        """
        if now - self._skill[0] < 300 and self._skill[1]:
            return self._skill[1]
        try:
            board = skill.scoreboard(self.db, dict(MANAGERS),
                                     since=self.db.get_state("league_started") or 0.0)
        except Exception as e:  # a scoring panel must never take the engine down
            log.warning("skill board: %s", e)
            board = self._skill[1] or {"rows": [], "samples": 0}
        self._skill = (now, board)
        return board

    def _record_equity(self, now: float) -> None:
        rows = []
        for pid, pf in self.portfolios.items():
            bids = pf.bids(self)
            for lane in pf.fund.lanes:
                rows.append((now, pid, lane.lane_id, lane.asset, lane.equity(bids.get(lane.asset)), bids.get(lane.asset)))
            rows.append((now, pid, 0, "total", pf.fund.total_value(bids), None))
            rows.append((now, pid, -1, "vault", pf.fund.vault + pf.fund.vault_pending, None))
        self.db.executemany("INSERT OR REPLACE INTO league_equity VALUES(?,?,?,?,?,?)", rows)
