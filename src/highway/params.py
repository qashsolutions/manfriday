"""Tunable knobs. The Coach may move these, but only inside fixed bounds.

The hard rules in settings.toml (money caps, -10% / +15% day rules, $50 buys) are not here
and cannot be changed by any agent.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Spec:
    default: float
    lo: float
    hi: float
    help: str


SPECS: dict[str, Spec] = {
    "cooldown_after_stop_h": Spec(24.0, 6.0, 72.0, "hours a lane stays out of an asset after a -10% day exit"),
    "cooldown_after_tp_h": Spec(4.0, 1.0, 24.0, "hours before re-buying after a +15% day sale"),
    "cooldown_after_signal_h": Spec(0.0, 0.0, 12.0, "hours a lane waits before re-buying after a plain strategy exit"),
    "min_hold_hours": Spec(0.0, 0.0, 24.0, "a strategy may not sell a position younger than this; hard rules always can"),
    "no_buy_drop_pct": Spec(0.0, 0.0, 20.0, "refuse a buy if the asset already fell this much recently (0 = off)"),
    "no_buy_drop_hours": Spec(4.0, 1.0, 24.0, "how far back the falling-knife check looks"),
    "taker_after_bars": Spec(0.0, 0.0, 5.0, "cross the spread to enter after this many bars of an unfilled limit buy (0 = never)"),
    "fee_edge_multiple": Spec(1.5, 1.0, 3.0, "expected move must be this many times the round-trip fee"),
    "tournament_window_days": Spec(5.0, 2.0, 14.0, "how far back the strategy tournament looks"),
    "switch_margin_pct": Spec(1.0, 0.25, 5.0, "a challenger must beat the leader by this much to take over"),
    # Measured and rejected (scripts/measure/tournament_hurdle.py): every level lost on both
    # windows. Kept as a knob because the harness behind it is worth re-running, not because
    # it should be raised. Do not turn this on without new evidence.
    "tournament_hurdle": Spec(0.0, 0.0, 1.5, "how much of the best-of-N luck threshold a lane's leader must clear (0 = off)"),
    "min_leader_hold_h": Spec(12.0, 4.0, 48.0, "minimum hours before the lead strategy can change"),
    "prior_weight_days": Spec(3.0, 0.0, 10.0, "days of live evidence before backtest results stop dominating"),
    "news_weight": Spec(0.5, 0.0, 1.0, "how much news scores tilt strategy entries"),
    "news_exit_drop_pct": Spec(3.0, 1.5, 8.0, "1h price drop that confirms a critical-news exit"),
    # League managers (tuned by the weekly review)
    "laser_manager_hours": Spec(4.0, 2.0, 12.0, "hours between the Laser manager's decisions"),
    "momentum_keep_top": Spec(8.0, 5.0, 15.0, "Momentum keeps an asset while it stays in this many top movers"),
    "promote_after_flat_h": Spec(24.0, 12.0, 72.0, "hours a Quant lane sits idle before the watchlist can take it"),
    # Scout rank weights (which assets get considered), tested by the weight backtest
    "rank_w_vol": Spec(1.0, 0.0, 2.0, "Scout rank weight on monthly volatility"),
    "rank_w_mom30": Spec(0.8, 0.0, 2.0, "Scout rank weight on 30-day price change"),
    "rank_w_mom7": Spec(0.4, 0.0, 2.0, "Scout rank weight on 7-day price change"),
    "rank_w_dd": Spec(0.3, 0.0, 1.5, "Scout rank penalty on 30-day worst drop"),
    "momentum_w30": Spec(0.6, 0.0, 1.0, "Momentum manager: weight on 30-day change (the rest goes to 7-day)"),
    # Radar: how much each of the seven indicators counts, and how many must fire
    "radar_w_trend": Spec(1.0, 0.0, 2.0, "radar weight: price above its 20- and 50-day averages"),
    "radar_w_momentum": Spec(1.0, 0.0, 2.0, "radar weight: 20-day and 5-day price change"),
    "radar_w_strength": Spec(1.0, 0.0, 2.0, "radar weight: beating the S&P or bitcoin"),
    "radar_w_volume": Spec(1.0, 0.0, 2.0, "radar weight: trading above its normal volume"),
    "radar_w_breakout": Spec(1.0, 0.0, 2.0, "radar weight: at or near a 20-day high"),
    "radar_w_movement": Spec(0.5, 0.0, 2.0, "radar weight: volatile enough for the monthly target"),
    "radar_w_news": Spec(0.5, 0.0, 2.0, "radar weight: recent positive headlines"),
    "radar_min_signals": Spec(5.0, 3.0, 7.0, "indicators that must fire before an asset is backtested"),
    # Timing: how much the measured weekday/hour pattern tilts new buys
    "session_weight": Spec(0.3, 0.0, 1.0, "how much the measured time-of-day pattern tilts new buys"),
    "stale_decision_hours": Spec(4.0, 1.0, 24.0, "a buy decision older than this is re-checked before it executes"),
    "max_gap_pct": Spec(5.0, 1.0, 15.0, "skip a stale buy if the price gapped this far since the decision"),
    "no_entry_last_minutes": Spec(30.0, 0.0, 120.0, "no new stock buys in the last minutes before the close"),
    "no_entry_first_minutes": Spec(5.0, 0.0, 60.0, "no new stock buys in the first minutes after the open"),
    "earnings_blackout_days": Spec(2.0, 0.0, 5.0, "no new stock buys this many days before the company reports"),
    "exit_before_earnings": Spec(0.0, 0.0, 1.0, "1 = sell a stock lane the day before its earnings"),
    # How strategies and assets are scored
    "score_dd_penalty": Spec(0.25, 0.0, 1.0, "score = monthly return % minus this x worst drop %"),
    "scout_live_weight": Spec(0.5, 0.0, 1.0, "share of live paper results in an asset's score once 2+ days exist"),
}

RANK_KEYS = ("rank_w_vol", "rank_w_mom30", "rank_w_mom7", "rank_w_dd")


def clamp(key: str, value: float) -> float:
    spec = SPECS[key]
    return max(spec.lo, min(spec.hi, float(value)))


class Params:
    """In-memory view of the tunables; the engine persists changes to the database."""

    def __init__(self, values: dict[str, float] | None = None):
        self._values = {k: s.default for k, s in SPECS.items()}
        for k, v in (values or {}).items():
            if k in SPECS:
                self._values[k] = clamp(k, v)

    def __getitem__(self, key: str) -> float:
        return self._values[key]

    def set(self, key: str, value: float) -> tuple[float, float]:
        if key not in SPECS:
            raise KeyError(f"unknown param {key}")
        old = self._values[key]
        self._values[key] = clamp(key, value)
        return old, self._values[key]

    def as_dict(self) -> dict[str, float]:
        return dict(self._values)
