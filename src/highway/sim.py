"""One simulated lane driven by one strategy.

Used for backtests and for the live "shadow" tournament, so both run the exact same money
and risk rules as the real lane: $50 buys, fees, the -10% / +15% day rules, cooldowns,
the $150 skim and the $70 floor.
"""

from __future__ import annotations

from collections import Counter
from typing import Callable

from .book import Fund
from .config import Settings
from .market import asset_class
from .params import Params
from .risk import Quote, RiskManager, falling_knife, signal_exit_ok
from .venues import half_spread_bps, venue_for
from .strategies import Decision, Strategy

NEUTRAL_NEWS = {"score": 0.0, "count": 0}
MIN_DAYS_TO_ANNUALISE = 10
_DD_PENALTY = [0.25]  # tunable "score_dd_penalty"; set_dd_penalty() keeps every caller in step


def set_dd_penalty(value: float) -> None:
    _DD_PENALTY[0] = float(value)


class LaneSim:
    def __init__(self, strategy: Strategy, settings: Settings, params: Params, asset: str, start_ts: float | None = None):
        self.strategy = strategy
        self.s = settings
        self.params = params
        self.risk = RiskManager(settings, params)
        self.fund = Fund.new(settings.capital, settings.fees, settings.settlement, n_lanes=1, reserve=0.0)
        self.lane = self.fund.lanes[0]
        self.asset = asset
        self.lane.asset = asset
        self.lane.asset_class = asset_class(asset)
        self.lane.venue = venue_for(asset)
        self.half_spread = half_spread_bps(asset, None, settings.fees) / 1e4 if self.lane.asset_class == "equity" else 0.0
        self.state: dict = {}
        self.pending: Decision | None = None
        self.limit_price = 0.0
        self.last_decision = Decision(0)
        self.curve: list[tuple[float, float]] = []
        self.start_ts = start_ts
        self.counts: Counter = Counter()
        self.round_trips: list[float] = []
        self._trip_cost = 0.0
        self._trip_proceeds = 0.0
        self.bars_in_market = 0
        self.bars = 0
        self.entries = 0
        self.last_expected = 0.0  # expected move of the latest entry signal
        self.unfilled_streak = 0  # consecutive bars a wanted buy has rested without filling

    # ---- helpers -------------------------------------------------------------------------

    @property
    def clips(self) -> int:
        return len(self.lane.tranches)

    def value(self, price: float) -> float:
        return self.lane.equity(price) + self.fund.vault + self.fund.vault_pending

    def _quote(self, ts: float, price: float) -> Quote:
        return Quote(self.lane.asset, price * (1 - self.half_spread), price * (1 + self.half_spread), price, ts, "sim")

    def _record_fills(self) -> None:
        for f in self.fund.fills:
            if f.side == "buy":
                self._trip_cost += f.cash
            else:
                self._trip_proceeds += f.cash
                self.counts[f.reason] += 1
        self.fund.fills.clear()
        for e in self.fund.events:
            self.counts[e["kind"]] += 1
        self.fund.events.clear()
        if not self.lane.has_position and self._trip_cost > 0:
            self.round_trips.append(self._trip_proceeds - self._trip_cost)
            self._trip_cost = self._trip_proceeds = 0.0

    # ---- one bar -------------------------------------------------------------------------

    def on_bar(self, ts_open: float, row: dict, price_at: Callable[[float], float | None], news: dict, bar_seconds: float) -> Decision:
        ts_close = ts_open + bar_seconds
        if self.lane.asset_class == "equity":  # a $2 stock costs far more to cross than a $200 one
            self.half_spread = half_spread_bps(self.asset, row["close"], self.s.fees) / 1e4
        self._price_at = price_at        # _execute needs it for the falling-knife check
        if self.start_ts is None:
            self.start_ts = ts_open
        if self.lane.status == "active":
            if self.pending is not None:
                self._execute(self.pending, ts_open, row, news)
                self.pending = None
            if self.lane.has_position:
                self._hard_rules(ts_open, row, price_at)
            self.fund.settle(ts_close)
            self.fund.skim(self.lane, row["close"] * (1 - self.half_spread), ts_close)
            self.fund.check_floor(self.lane, row["close"] * (1 - self.half_spread), ts_close)
            if self.lane.status == "active" and not self.lane.asset:
                self.lane.asset = self.asset  # a refill clears the asset; a sim keeps its own
            self._record_fills()
            decision = self.strategy.decide(row, self.clips, self.state, news)
        else:
            decision = Decision(0, reason="lane closed")
        self.last_decision = decision
        if decision.expected_move_pct > 0:
            self.last_expected = decision.expected_move_pct
        if decision.target_clips != self.clips:
            self.pending = decision
            self.limit_price = row["close"]  # rest a limit order at this bar's close
        self.bars += 1
        self.bars_in_market += self.lane.has_position
        self.curve.append((ts_close, self.value(row["close"])))
        return decision

    def _execute(self, d: Decision, ts: float, row: dict, news: dict) -> None:
        """Work the order from the last decision during this bar.

        Signal trades rest a limit order at the previous close (maker fee). A buy that the
        price never comes back to is cancelled; a sell that never fills goes out at market
        at this bar's close so exits cannot be missed.
        """
        lane, clips, limit = self.lane, self.clips, self.limit_price
        if d.target_clips < clips and not signal_exit_ok(lane, ts, self.params["min_hold_hours"]):
            self.counts["held_min_time"] += 1
            return
        if d.target_clips < clips:
            qty = lane.qty if d.target_clips == 0 else sum(t.qty for t in lane.tranches[: clips - d.target_clips])
            if row["high"] >= limit:
                self.fund.sell(lane, qty, limit, ts, reason="signal", strategy=self.strategy.name, liquidity="maker")
            else:
                self.fund.sell(lane, qty, row["close"] * (1 - self.half_spread), ts, reason="signal", strategy=self.strategy.name)
            if not lane.has_position:
                self.state.clear()
                self.risk.start_cooldown(lane, "signal", ts)
            return
        if d.target_clips <= clips:
            self.unfilled_streak = 0  # the signal stopped asking; the next entry starts fresh
            return
        w = self.params["news_weight"]
        if w > 0 and news.get("count", 0) >= 3 and news.get("score", 0.0) < -0.3:
            self.counts["news_veto"] += 1
            return
        drop_h = self.params["no_buy_drop_hours"]
        if falling_knife(row["close"], getattr(self, "_price_at", lambda _t: None)(ts - drop_h * 3600),
                         self.params["no_buy_drop_pct"]):
            self.counts["falling_knife"] += 1
            return
        liquidity = "maker"
        if row["low"] > limit:  # the price ran away; it never came back to our bid
            self.counts["unfilled"] += 1
            self.unfilled_streak += 1
            after = self.params["taker_after_bars"]
            if not after or self.unfilled_streak < after:
                if not lane.has_position:
                    self.state.clear()
                return
            limit = row["close"] * (1 + self.half_spread)  # stop waiting and pay the spread
            liquidity = "taker"
            self.counts["crossed"] += 1
        self.unfilled_streak = 0
        expected = (d.expected_move_pct or self.last_expected) * (1 + w * news.get("score", 0.0))
        was_flat = not lane.has_position
        for _ in range(1):  # scale in: at most one $50 clip per bar
            notional = min(self.s.capital.max_buy, lane.cash)
            verdict = self.risk.approve_buy(lane, notional, self._quote(ts, limit), ts, expected, True, False)
            if not verdict.ok:
                self.counts["blocked"] += 1
                if not lane.has_position:
                    self.state.clear()
                return
            self.fund.buy(lane, notional, limit, ts, reason="signal", strategy=self.strategy.name, liquidity=liquidity)
            if was_flat:
                self.entries += 1
                was_flat = False

    def _hard_rules(self, ts: float, row: dict, price_at: Callable[[float], float | None]) -> None:
        """Approximate the every-few-seconds day rules using the bar's low and high."""
        lane, r = self.lane, self.s.rules
        window = r.day_window_hours * 3600
        ref_value = 0.0
        day_ago = None
        for t in lane.tranches:
            if ts - t.ts >= window:
                if day_ago is None:
                    day_ago = price_at(ts - window) or t.price
                ref_value += t.qty * day_ago
            else:
                ref_value += t.qty * t.price
        qty = lane.qty
        if qty <= 0 or ref_value <= 0:
            return
        hs = 1 - self.half_spread
        stop_px = ref_value * (1 + r.stop_loss_day_pct / 100) / qty / hs
        tp_px = ref_value * (1 + r.take_profit_day_pct / 100) / qty / hs * 1.0001
        # The give-back stop needs the high-water mark kept up to date, exactly as the live
        # lane does on every price check. Within one bar we cannot see whether the high came
        # before the low, so the bar's own high counts - the live engine, sampling every ten
        # seconds, would have seen it.
        lane.peak_price = max(lane.peak_price, row["high"] * hs)
        gb_px = lane.peak_price * (1 - r.giveback_pct / 100) if r.giveback_pct else 0.0
        if row["low"] <= stop_px:
            fill = min(row["open"], stop_px)
            self.fund.sell_all(lane, fill * hs, ts, reason="stop_day", strategy=self.strategy.name)
            self.risk.start_cooldown(lane, "stop_day", ts)
        elif row["high"] >= tp_px:
            fill = max(row["open"], tp_px)
            self.fund.sell_all(lane, fill * hs, ts, reason="take_profit_day", strategy=self.strategy.name)
            self.risk.start_cooldown(lane, "take_profit_day", ts)
        elif gb_px and row["low"] * hs <= gb_px:
            self.fund.sell_all(lane, min(row["open"] * hs, gb_px), ts, reason="giveback", strategy=self.strategy.name)
            self.risk.start_cooldown(lane, "giveback", ts)
        else:
            return
        self.state.clear()
        self.pending = None

    # ---- results -------------------------------------------------------------------------

    def metrics(self) -> dict:
        if not self.curve:
            return {"return_pct": 0.0, "monthly_pct": 0.0, "max_dd_pct": 0.0, "trades": 0, "entries": 0, "win_rate": None,
                    "fees": 0.0, "vault": 0.0, "stops": 0, "take_profits": 0, "skims": 0, "in_market_pct": 0.0,
                    "days": 0.0, "end_value": self.s.capital.lane_principal}
        start = self.s.capital.lane_principal
        end_ts, end_val = self.curve[-1]
        days = max((end_ts - (self.start_ts or end_ts)) / 86400, 1e-6)
        total = end_val / start - 1
        # Never scale a short record up as if it lasted less than 10 days: a few lucky hours
        # would otherwise look like thousands of percent a month.
        monthly = (1 + total) ** (30 / max(days, MIN_DAYS_TO_ANNUALISE)) - 1 if total > -1 else -1.0
        peak, max_dd = start, 0.0
        for _, v in self.curve:
            peak = max(peak, v)
            max_dd = max(max_dd, 1 - v / peak)
        wins = sum(1 for p in self.round_trips if p > 0)
        return {
            "return_pct": round(total * 100, 2),
            "monthly_pct": round(monthly * 100, 2),
            "max_dd_pct": round(max_dd * 100, 2),
            "trades": len(self.round_trips),
            "entries": self.entries,
            "win_rate": round(wins / len(self.round_trips), 2) if self.round_trips else None,
            "fees": round(self.fund.fees_paid, 2),
            "vault": round(self.fund.vault + self.fund.vault_pending, 2),
            "stops": self.counts["stop_day"],
            "take_profits": self.counts["take_profit_day"],
            "skims": self.counts["skim"],
            "in_market_pct": round(self.bars_in_market / self.bars * 100, 1) if self.bars else 0.0,
            "days": round(days, 1),
            "end_value": round(end_val, 2),
        }


def score(m: dict) -> float:
    """Tournament and walk-forward ranking: monthly return, penalised by drawdown."""
    return m["monthly_pct"] - _DD_PENALTY[0] * m["max_dd_pct"]


def recent_score(test: dict) -> float:
    """Tested return over the same recent 60 days for every asset, minus a drawdown penalty.

    Used to rank assets and to seed tournaments, so a 60-day crypto test and an 8-month stock
    test are compared on the same stretch of time. Passing still uses the full test window.
    """
    if "recent_monthly_pct" in test:
        return score({"monthly_pct": test["recent_monthly_pct"], "max_dd_pct": test["recent_max_dd_pct"]})
    return score(test)
