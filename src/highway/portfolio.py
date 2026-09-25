"""One manager's paper portfolio: its fund, resting orders and trading mechanics.

Every manager in the league runs through this same code, so they all obey the same hard
rules: $50 buys (one per bar), limit orders at maker fees, the -10% / +15% day exits, the
$150 skim to the vault, the $70 floor with reserve refills, and stock settlement delays.
Only the brain differs: it decides which asset each lane holds and how many $50 clips.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

from .book import EPS, BookError, Fund, Lane
from .config import Settings
from .db import DB
from .market import asset_class
from .venues import NAMES as VENUE_NAMES, venue_for
from .risk import Quote, day_change, signal_exit_ok

if TYPE_CHECKING:
    from .engine import Engine


@dataclass
class RestingOrder:
    id: str
    lane_id: int
    asset: str
    side: str
    limit: float
    notional: float  # buys: cash to spend
    qty: float  # sells: amount to sell
    placed: float
    expires: float
    reason: str
    strategy: str


@dataclass(frozen=True)
class Target:
    """What a brain wants a lane to hold."""

    asset: str | None
    clips: int  # 0, 1 or 2 clips of $50
    expected_move_pct: float = 0.0
    reason: str = ""
    strategy: str = ""
    decided_at: float = 0.0  # when the brain made this call; stale ones get re-checked
    decided_price: float = 0.0


def swap_guard(target: Target, held_clips: int, wanted: str | None) -> Target:
    """No new clips into a lane that is only waiting to go flat before it changes asset.

    A lane can be committed to a different asset and still be holding the old one, because a
    switch waits for the position to close rather than forcing a sale. Buying more of something
    the lane has already decided to leave pays the spread twice and adds risk to a position with
    a known exit. Selling is untouched: the lane still needs to be able to get out.
    """
    if not wanted or wanted == target.asset or target.clips <= held_clips:
        return target
    return Target(target.asset, held_clips, target.expected_move_pct,
                  f"waiting to switch to {wanted}: no new clips", target.strategy,
                  target.decided_at, target.decided_price)


class Portfolio:
    def __init__(self, pid: str, name: str, s: Settings, db: DB):
        self.id, self.name, self.s, self.db = pid, name, s, db
        # Every manager is keyed the same way. The original "quant" used bare "fund"/"orders";
        # the Sept 23 rebuild migrated those to "fund:bluechip" and friends.
        self.fund_key = f"fund:{pid}"
        self.orders_key = f"orders:{pid}"
        fund = db.load_fund(s, self.fund_key)
        self.new = fund is None
        if fund is None:
            fund = Fund.new(s.capital, s.fees, s.settlement)
            db.set_state(self.started_key, time.time())
            db.event("info", "start", f"{name}: new paper fund, 4 lanes x $100 plus $100 reserve", portfolio=pid)
        self.fund = fund
        self.orders = [RestingOrder(**o) for o in db.get_state(self.orders_key, [])]
        self.blocks: dict[int, str] = {}
        self.targets: dict[int, Target] = {}
        self._triggers: dict[int, tuple[str, float]] = {}  # day-rule hits waiting for a confirming tick
        self.dirty = self.new

    @property
    def started_key(self) -> str:
        return f"started:{self.id}"

    @property
    def started(self) -> float:
        return self.db.get_state(self.started_key, time.time())

    # ---- basics --------------------------------------------------------------------------

    def event(self, kind: str, message: str, lane_id: int | None = None, level: str = "info") -> None:
        self.db.event(level, kind, f"{self.name}: {message}", lane_id, portfolio=self.id)

    def save(self) -> None:
        self.db.save_fund(self.fund, self.s.mode, portfolio=self.id, key=self.fund_key)
        self.db.set_state(self.orders_key, [asdict(o) for o in self.orders])
        self.dirty = False

    def needs_save(self) -> bool:
        return self.dirty or bool(self.fund.fills) or bool(self.fund.events)

    def assets(self) -> set[str]:
        return {l.asset for l in self.fund.lanes if l.asset and l.status == "active"}

    def lane_orders(self, lane_id: int, side: str | None = None) -> list[RestingOrder]:
        return [o for o in self.orders if o.lane_id == lane_id and (side is None or o.side == side)]

    def cancel(self, lane_id: int, side: str | None = None) -> None:
        self.orders = [o for o in self.orders if not (o.lane_id == lane_id and (side is None or o.side == side))]
        self.dirty = True

    def is_flat(self, lane: Lane) -> bool:
        return not lane.has_position and not self.lane_orders(lane.lane_id)

    # ---- mechanics (ctx supplies prices, clocks and risk) --------------------------------

    def exit(self, ctx: Engine, lane: Lane, q: Quote, now: float, reason: str, detail: str) -> None:
        self.cancel(lane.lane_id)
        fill = self.fund.sell_all(lane, q.bid, now, reason=reason, strategy="risk")
        ctx.risk.start_cooldown(lane, reason, now)
        if fill:
            self.event(reason, f"lane {lane.lane_id} {lane.asset}: {detail}; sold for ${fill.cash:.2f}", lane.lane_id, "warn")
        self.dirty = True

    def work_orders(self, ctx: Engine, now: float) -> None:
        keep = []
        for o in self.orders:
            lane = self.fund.lane(o.lane_id)
            if lane.asset != o.asset or lane.status != "active":
                continue
            q = ctx.fresh(lane, now)
            filled = False
            if q and ctx.market_open(lane, now):
                try:
                    if o.side == "buy" and (q.ask <= o.limit or q.last < o.limit):  # traded through our bid
                        if lane.cash + EPS >= o.notional and now >= lane.cooldown_until:
                            self.fund.buy(lane, o.notional, o.limit, now, o.reason, o.strategy, liquidity="maker")
                        filled = True
                    elif o.side == "sell" and (q.bid >= o.limit or q.last > o.limit):
                        if lane.has_position:
                            self.fund.sell(lane, min(o.qty, lane.qty), o.limit, now, o.reason, o.strategy, liquidity="maker")
                        filled = True
                except BookError as e:
                    self.event("order_rejected", f"lane {lane.lane_id}: {e}", lane.lane_id, "warn")
                    filled = True
            if filled:
                self.dirty = True
                continue
            if now >= o.expires:
                self.dirty = True
                if o.side == "sell" and lane.has_position:
                    if q and ctx.market_open(lane, now):
                        self.fund.sell(lane, min(o.qty, lane.qty), q.bid, now, o.reason + "_market", o.strategy)
                    else:
                        keep.append(o)  # cannot sell yet (stale price / market closed); keep trying
                continue
            keep.append(o)
        self.orders = keep

    def hard_rules(self, ctx: Engine, lane: Lane, now: float) -> None:
        if not lane.has_position or not ctx.market_open(lane, now):
            return
        q = ctx.fresh(lane, now)
        if not q:
            return
        if q.bid > lane.peak_price:  # high-water mark for the give-back stop
            lane.peak_price = q.bid
            self.dirty = True
        sig = ctx.risk.exit_signal(lane, q.bid, lambda ts: ctx.price_at(lane.asset, ts), now)
        if not sig:
            self._triggers.pop(lane.lane_id, None)
            return
        kind, pct = sig
        seen = self._triggers.get(lane.lane_id)
        if seen and seen[0] == kind and now - seen[1] <= 60:
            # Confirmed on a second price check, so one bad print cannot trigger an exit.
            self._triggers.pop(lane.lane_id, None)
            detail = (f"gave back {abs(pct):.1f}% from its high of ${lane.peak_price:,.4f}".rstrip("0").rstrip(".")
                      if kind == "giveback" else
                      f"{'down' if kind == 'stop_day' else 'up'} {pct:+.1f}% in a day")
            self.exit(ctx, lane, q, now, kind, detail)
        else:
            self._triggers[lane.lane_id] = (kind, now)

    def skim_and_floor(self, ctx: Engine, lane: Lane, now: float) -> str | None:
        q = ctx.fresh(lane, now) if lane.asset else None
        bid = q.bid if q else None
        if bid is None and lane.has_position:
            return None
        if not (ctx.market_open(lane, now) or not lane.has_position):
            return None
        if self.fund.skim(lane, bid, now):
            self.dirty = True
        result = self.fund.check_floor(lane, bid, now)
        if result:
            self.cancel(lane.lane_id)
            self.dirty = True
        return result

    def switch(self, lane: Lane, asset: str, why: str) -> bool:
        """Change a flat lane's asset. Returns False if the lane still holds something."""
        if lane.asset == asset:
            return True
        if not self.is_flat(lane):
            return False
        old = lane.asset
        lane.asset, lane.asset_class = asset, asset_class(asset)
        lane.venue = venue_for(asset)
        lane.cooldown_until = 0.0  # a cooldown belongs to the old asset
        self.event("assign", f"lane {lane.lane_id}: {old or 'empty'} -> {asset} ({why})", lane.lane_id)
        self.dirty = True
        return True

    def follow(self, ctx: Engine, lane: Lane, target: Target, now: float, paused: bool) -> None:
        """Move one lane toward its target: rest a limit order for one $50 clip per bar."""
        self.targets[lane.lane_id] = target
        if lane.status != "active":
            return
        if target.asset and target.asset != lane.asset:
            if lane.has_position:
                target = Target(lane.asset, 0, 0.0, f"selling to switch to {target.asset}", target.strategy)
            elif self.switch(lane, target.asset, target.reason[:80]):
                ctx.ensure_asset(target.asset)
            else:
                return
        if not lane.asset:
            return
        clips = len(lane.tranches)
        q = ctx.fresh(lane, now)
        self.cancel(lane.lane_id, "buy")  # re-price buys every bar
        if q is None:
            self.blocks[lane.lane_id] = "no fresh price"
            return
        if target.clips > clips:
            news = ctx.news_scores.get(lane.asset, {"score": 0.0, "count": 0})
            w = ctx.params["news_weight"]
            if w > 0 and news.get("count", 0) >= 3 and news.get("score", 0.0) < -0.3:
                self.blocks[lane.lane_id] = f"news veto (score {news['score']:+.2f})"
                return
            stale = ctx.fresh_look(lane, target, now)
            if stale:
                self.blocks[lane.lane_id] = stale
                return
            tilt, why = ctx.session_tilt(lane.asset, now)
            expected = target.expected_move_pct * (1 + w * news.get("score", 0.0)) * (1 + ctx.params["session_weight"] * tilt)
            if lane.asset_class == "equity":
                left = ctx.minutes_to_close(now)
                if left is not None and left <= ctx.params["no_entry_last_minutes"]:
                    self.blocks[lane.lane_id] = f"{left:.0f} min to the close: no new stock buys"
                    return
                since = ctx.minutes_since_open(now)
                if since is not None and since < ctx.params["no_entry_first_minutes"]:
                    self.blocks[lane.lane_id] = f"{since:.0f} min after the open: waiting for spreads to settle"
                    return
                report = ctx.earnings_in_days(lane.asset)
                if report and report["days_away"] <= ctx.params["earnings_blackout_days"]:
                    self.blocks[lane.lane_id] = f"reports earnings {report['when']} on {report['date']}: no new buys"
                    return
            if tilt < -0.5:
                self.blocks[lane.lane_id] = f"weak window: {why}"
                return
            recent = len([b for b in lane.buy_times if now - b < 86400])
            notional = min(self.s.capital.max_buy, lane.cash)
            if recent >= self.s.rules.max_buys_per_lane_per_day:
                self.blocks[lane.lane_id] = "daily buy limit reached"
                return
            v = ctx.risk.approve_buy(lane, notional, q, now, expected, ctx.market_open(lane, now), paused)
            if not v.ok:
                self.blocks[lane.lane_id] = v.reason
                return
            # scale in: one $50 clip per bar, the next only if the signal still holds
            self.orders.append(RestingOrder(uuid.uuid4().hex[:8], lane.lane_id, lane.asset, "buy", q.bid, notional, 0.0,
                                            now, now + ctx.bar_seconds, "signal", target.strategy))
            self.blocks.pop(lane.lane_id, None)
            self.dirty = True
        elif target.clips < clips and not self.lane_orders(lane.lane_id, "sell"):
            if not signal_exit_ok(lane, now, ctx.params["min_hold_hours"]):
                self.blocks[lane.lane_id] = f"held under the {ctx.params['min_hold_hours']:.0f}h minimum"
                return
            qty = lane.qty if target.clips == 0 else sum(x.qty for x in lane.tranches[: clips - target.clips])
            self.orders.append(RestingOrder(uuid.uuid4().hex[:8], lane.lane_id, lane.asset, "sell", q.ask, 0.0, qty,
                                            now, now + ctx.bar_seconds, "signal", target.strategy))
            self.dirty = True

    def kill(self, ctx: Engine, now: float) -> None:
        for lane in self.fund.lanes:
            q = ctx.fresh(lane, now) if lane.asset else None
            if lane.has_position and q and ctx.market_open(lane, now):
                self.exit(ctx, lane, q, now, "kill", "kill switch")
        self.orders = []
        self.dirty = True

    # ---- reporting -----------------------------------------------------------------------

    def bids(self, ctx: Engine) -> dict[str, float | None]:
        return {l.asset: (ctx.quotes[l.asset].bid if l.asset in ctx.quotes else None) for l in self.fund.lanes if l.asset}

    def total(self, ctx: Engine) -> float:
        return self.fund.total_value(self.bids(ctx))

    def lane_rows(self, ctx: Engine, now: float) -> list[dict]:
        rows = []
        for lane in self.fund.lanes:
            q = ctx.quotes.get(lane.asset) if lane.asset else None
            bid = q.bid if q else None
            day = None
            if lane.has_position and bid:
                ch = day_change(lane, bid, lambda ts: self.db.tick_near(lane.asset, ts, 900), now, self.s.rules.day_window_hours)
                day = round(ch * 100, 2) if ch is not None else None
            t = self.targets.get(lane.lane_id)
            rows.append({
                "id": lane.lane_id,
                "asset": lane.asset,
                "class": lane.asset_class,
                "status": lane.status,
                "cash": round(lane.cash, 2),
                "pending": round(lane.lane_pending, 2),
                "qty": lane.qty,
                "cost": round(lane.cost_basis, 2),
                "value": round(lane.position_value(bid), 2),
                "equity": round(lane.equity(bid), 2),
                "bid": bid,
                "day_change_pct": day,
                "cooldown_h": round(max(0, lane.cooldown_until - now) / 3600, 1),
                "last_exit": lane.last_exit_reason,
                "refills": lane.refills,
                "clips": len(lane.tranches),
                "target_clips": t.clips if t else 0,
                "target_reason": t.reason if t else "",
                "leader": t.strategy if t else None,
                "blocked_by": self.blocks.get(lane.lane_id),
                "orders": [asdict(o) for o in self.lane_orders(lane.lane_id)],
                "news": {k: v for k, v in ctx.news_scores.get(lane.asset, {}).items() if k in ("score", "count")},
                "market_open": ctx.market_open(lane, now) if lane.asset else None,
                "venue": VENUE_NAMES.get(lane.venue, lane.venue) if lane.asset else None,
            })
        return rows

    def summary(self, ctx: Engine, now: float, league_start: dict) -> dict:
        total = self.total(ctx)
        c = self.s.capital
        # Every dollar the fund opened with, the ETF sleeve included. Leave the sleeve out and
        # the fund looks 25% up the moment it is created.
        start_value = c.lane_principal * c.lanes + c.sleeve_principal * c.sleeve_lanes + c.reserve
        days = max((now - self.started) / 86400, 1e-6)
        ret = total / start_value - 1
        at_league_start = league_start.get(self.id, start_value)
        trades = self.db.query("SELECT COUNT(*) AS n FROM fills WHERE portfolio=?", (self.id,))[0]["n"]
        bids = self.bids(ctx)
        return {
            "id": self.id,
            "name": self.name,
            "total": round(total, 2),
            "return_pct": round(ret * 100, 2),
            "since_league_pct": round((total / at_league_start - 1) * 100, 2),
            "days": round(days, 2),
            "pace_pct": round(((1 + self.s.target.monthly) ** (days / 30) - 1) * 100, 2),
            "vault": round(self.fund.vault + self.fund.vault_pending, 2),
            "reserve": round(self.fund.reserve, 2),
            "fees_paid": round(self.fund.fees_paid, 2),
            "trades": trades,
            "invested": round(sum(l.position_value(bids.get(l.asset)) for l in self.fund.lanes), 2),
            "assets": [l.asset for l in self.fund.lanes],
            # What each lane is actually holding, live, for the leaderboard to show
            "lanes": [{
                "lane": l.lane_id, "kind": l.kind, "asset": l.asset, "status": l.status,
                "value": round(l.equity(bids.get(l.asset)), 2),
                "pnl_pct": round((l.equity(bids.get(l.asset)) / l.principal - 1) * 100, 2) if l.principal else 0.0,
                "holding": l.has_position,
            } for l in self.fund.lanes],
        }
