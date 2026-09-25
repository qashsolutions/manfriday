"""Per-lane strategy tournament: the self-tuning part.

Every lane runs all its candidate strategies side by side on paper ("shadows"), with the
same money and risk rules as the real lane. The real lane follows the current leader.

Leaders are chosen by a blend of backtest results (at first) and live shadow results
(as evidence builds up). Switching needs a clear margin and a minimum time as leader, so
the lane does not chase noise. If nothing is working, the lane sits in cash.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import pandas as pd

from .config import Settings, bar_minutes_for
from .params import Params
from .sim import LaneSim, recent_score, score
from .strategies import Decision, Hold, NewsMomentum, Strategy, base_features, build


@dataclass
class Contender:
    sim: LaneSim
    prior: float  # score from the walk-forward test window
    survived: bool  # passed the walk-forward test

    @property
    def strategy(self) -> Strategy:
        return self.sim.strategy


@dataclass
class LaneTournament:
    lane_id: int
    asset: str
    started: float
    contenders: dict[str, Contender] = field(default_factory=dict)
    leader: str | None = None
    leader_since: float = 0.0
    changes: list[dict] = field(default_factory=list)
    last_bar_ts: float = 0.0
    bar_minutes: int = 15

    @classmethod
    def create(cls, lane_id: int, asset: str, s: Settings, params: Params, backtests: list[dict], now: float | None = None):
        now = now or time.time()
        t = cls(lane_id, asset, now, bar_minutes=bar_minutes_for(s, asset))
        for bt in backtests:
            strat = build(bt["strategy"], bt["params"])
            t.contenders[strat.key] = Contender(LaneSim(strat, s, params, asset, start_ts=now), recent_score(bt["test"]), bool(bt["survived"]))
        for strat in NewsMomentum.variants():
            t.contenders[strat.key] = Contender(LaneSim(strat, s, params, asset, start_ts=now), 0.0, False)
        if not any(isinstance(c.strategy, Hold) for c in t.contenders.values()):
            t.contenders[Hold().key] = Contender(LaneSim(Hold(), s, params, asset, start_ts=now), 0.0, False)
        t.pick_leader(params, now, force=True)
        return t

    def warmup_bars(self, bars_per_day: int) -> int:
        return max(c.strategy.warmup_bars(bars_per_day) for c in self.contenders.values())

    # ---- feeding bars --------------------------------------------------------------------

    def on_bar(self, closed: pd.DataFrame, news: dict, params: Params, bars_per_day: int, bar_seconds: float, price_at) -> None:
        """Feed the newest closed bar to every shadow, then re-pick the leader."""
        ts_open = float(closed.index[-1])
        if ts_open <= self.last_bar_ts:
            return
        self.last_bar_ts = ts_open
        base = base_features(closed, bars_per_day)
        for c in self.contenders.values():
            row = c.strategy.prepare(base, bars_per_day).iloc[-1].to_dict()
            c.sim.on_bar(ts_open, row, price_at, news, bar_seconds)
        self.pick_leader(params, ts_open + bar_seconds)

    # ---- scoring -------------------------------------------------------------------------

    def live_days(self, now: float) -> float:
        return max(0.0, (now - self.started) / 86400)

    def blended(self, c: Contender, params: Params, now: float) -> float:
        days = self.live_days(now)
        w = 1.0 if params["prior_weight_days"] <= 0 else min(1.0, days / params["prior_weight_days"])
        live = score(c.sim.metrics()) if c.sim.bars >= 4 else 0.0
        return w * live + (1 - w) * c.prior

    def eligible(self, c: Contender) -> bool:
        if not c.strategy.eligible:
            return False
        if c.survived:
            return True
        m = c.sim.metrics()  # unproven strategies can earn a place with a live record
        return m["entries"] >= 3 and m["return_pct"] > 0

    def pick_leader(self, params: Params, now: float, force: bool = False) -> None:
        ranked = sorted(
            ((self.blended(c, params, now), key) for key, c in self.contenders.items() if self.eligible(c)),
            reverse=True,
        )
        best_score, best = ranked[0] if ranked else (0.0, None)
        if best is not None and best_score <= 0:
            best = None  # nothing is working: sit in cash
        if best == self.leader:
            return
        held_h = (now - self.leader_since) / 3600
        if not force and self.leader is not None:
            if held_h < params["min_leader_hold_h"]:
                return
            if best is not None:
                current = self.blended(self.contenders[self.leader], params, now)
                if best_score < current + params["switch_margin_pct"]:
                    return
        self.changes.append({"ts": now, "from": self.leader, "to": best, "score": round(best_score, 2)})
        self.changes = self.changes[-50:]
        self.leader, self.leader_since = best, now

    # ---- what the real lane should do ----------------------------------------------------

    def target(self) -> Decision:
        if self.leader is None:
            return Decision(0, reason="no strategy is working; stay in cash")
        c = self.contenders[self.leader]
        d = c.sim.last_decision
        if c.sim.lane.status != "active":
            return Decision(0, reason="leader's shadow lane closed")
        expected = d.expected_move_pct or c.sim.last_expected
        return Decision(d.target_clips, expected, f"{c.strategy.name}: {d.reason}")

    def summary(self, params: Params, now: float) -> dict:
        """Leader and its live numbers, for the Scout and the dashboard."""
        c = self.contenders.get(self.leader) if self.leader else None
        m = c.sim.metrics() if c else {}
        return {
            "leader": self.leader,
            "score": round(self.blended(c, params, now), 2) if c else None,
            "days": round(self.live_days(now), 2),
            "return_pct": m.get("return_pct"),
            "wants_in": bool(c and self.target().target_clips > 0),
            "in_position": bool(c and c.sim.clips > 0),
        }

    def standings(self, params: Params, now: float) -> list[dict]:
        rows = []
        for key, c in self.contenders.items():
            m = c.sim.metrics()
            rows.append({
                "key": key,
                "name": c.strategy.name,
                "leader": key == self.leader,
                "eligible": self.eligible(c),
                "survived": c.survived,
                "prior": round(c.prior, 2),
                "blended": round(self.blended(c, params, now), 2),
                "live_return_pct": m["return_pct"],
                "entries": m["entries"],
                "clips": c.sim.clips,
                "last": c.sim.last_decision.reason,
            })
        return sorted(rows, key=lambda r: (not r["leader"], -r["blended"]))
