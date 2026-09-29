import pandas as pd
import pytest

from highway.config import Settings
from highway.params import Params
from highway.sim import NEUTRAL_NEWS, LaneSim
from highway.strategies import Decision, Hold, Strategy
from highway.tournament import LaneTournament

S = Settings()
BAR = 900
T0 = 1_790_000_000.0


def row(price, low=None, high=None):
    return {"open": price, "high": high or price, "low": low or price, "close": price, "volume": 1.0, "day_range_pct": 10.0}


def feed(sim, prices, lows=None):
    for i, p in enumerate(prices):
        low = lows[i] if lows else None
        sim.on_bar(T0 + i * BAR, row(p, low=low), lambda ts: None, NEUTRAL_NEWS, BAR)


def test_hold_scales_in_one_clip_per_bar():
    sim = LaneSim(Hold(), S, Params(), "BTC-USD")
    feed(sim, [100, 100])
    assert sim.clips == 1  # decision on bar 0, first $50 fills on bar 1
    feed(sim, [100])
    assert sim.clips == 2
    assert all(t.cost <= 50 for t in sim.lane.tranches)
    assert sim.fund.fees_paid == pytest.approx(2 * 50 * S.fees.maker)  # limit orders pay maker fees


def test_sim_day_stop_exits_and_cools_down():
    sim = LaneSim(Hold(), S, Params(), "BTC-USD")
    feed(sim, [100, 100, 100])
    assert sim.clips == 2
    feed(sim, [95], lows=[89])  # intrabar drop of 11% from entry
    assert sim.clips == 0
    assert sim.counts["stop_day"] == 1
    feed(sim, [95, 95])
    assert sim.clips == 0  # 24h cooldown blocks re-entry
    assert sim.counts["blocked"] >= 1


def test_sim_take_profit_above_15pct():
    sim = LaneSim(Hold(), S, Params(), "BTC-USD")
    feed(sim, [100, 100, 100])
    sim.on_bar(T0 + 3 * BAR, {**row(110), "high": 116.5}, lambda ts: None, NEUTRAL_NEWS, BAR)
    assert sim.counts["take_profit_day"] == 1
    assert sim.clips == 0
    assert sim.lane.cash > 100  # the gain stays in the lane


def test_tournament_sits_in_cash_when_nothing_works():
    bts = [{"strategy": "trend", "params": {"fast": 20, "slow": 96}, "survived": 1,
            "test": {"monthly_pct": -3.0, "max_dd_pct": 10.0}}]
    t = LaneTournament.create(1, "BTC-USD", S, Params(), bts, now=T0)
    assert t.leader is None
    assert t.target().target_clips == 0


def test_tournament_follows_best_passing_strategy():
    bts = [
        {"strategy": "trend", "params": {"fast": 20, "slow": 96}, "survived": 1, "test": {"monthly_pct": 12.0, "max_dd_pct": 8.0}},
        {"strategy": "regime", "params": {"days": 10, "buffer": 0.02}, "survived": 1, "test": {"monthly_pct": 20.0, "max_dd_pct": 8.0}},
        {"strategy": "hold", "params": {}, "survived": 0, "test": {"monthly_pct": 40.0, "max_dd_pct": 5.0}},
    ]
    t = LaneTournament.create(1, "BTC-USD", S, Params(), bts, now=T0)
    assert t.leader.startswith("regime")  # hold is a benchmark and never leads


def test_assign_lanes_moves_as_few_lanes_as_possible():
    from highway.scout import assign_lanes

    current = {1: "BTC-USD", 2: "NEAR-USD", 3: "MSTR", 4: "VVV-USD"}
    pinned = {4: "VVV-USD"}  # holding a position
    lanes = assign_lanes(["NEAR-USD", "TQQQ", "ZEC-USD"], current, pinned, 4)
    assert lanes[4] == "VVV-USD"  # pinned lane untouched
    assert lanes[2] == "NEAR-USD"  # already in the right lane, stays
    assert {lanes[1], lanes[3]} == {"TQQQ", "ZEC-USD"}


def test_short_live_record_is_not_blown_up():
    sim = LaneSim(Hold(), S, Params(), "BTC-USD")
    feed(sim, [100, 100, 100, 104])  # +4% within an hour
    m = sim.metrics()
    assert m["monthly_pct"] < 20  # annualised as if over 10 days, not over 45 minutes


def test_the_simulator_models_the_give_back_stop():
    """The sim must run the same rules as the live lane, or the tournament ranks strategies
    on a game the real money is not playing."""
    import inspect

    from highway import sim

    src = inspect.getsource(sim.LaneSim._hard_rules)
    assert "peak_price" in src, "the high-water mark is not kept up to date"
    assert "giveback" in src, "the give-back stop is not modelled"


def test_tournament_hurdle_off_by_default_keeps_a_positive_leader():
    bts = [{"strategy": "trend", "params": {"fast": 20, "slow": 96}, "survived": 1,
            "test": {"monthly_pct": 6.0, "max_dd_pct": 8.0}}]
    t = LaneTournament.create(1, "BTC-USD", S, Params(), bts, now=T0)
    assert t.leader is not None


def test_tournament_hurdle_sends_a_lucky_looking_leader_to_cash():
    """Best-of-N selection: a leader that only looks good against a wide spread of rivals is
    what the luckiest coin flip would produce, so the lane should sit in cash instead."""
    bts = [{"strategy": "trend", "params": {"fast": f, "slow": 96}, "survived": 1,
            "test": {"monthly_pct": m, "max_dd_pct": 8.0}}
           for f, m in zip(range(8, 40, 2), range(-30, 34, 4))]
    assert len(bts) >= 16
    lax = LaneTournament.create(1, "BTC-USD", S, Params({"tournament_hurdle": 0.0}), bts, now=T0)
    strict = LaneTournament.create(1, "BTC-USD", S, Params({"tournament_hurdle": 1.0}), bts, now=T0)
    assert lax.leader is not None       # today: the best score wins however wide the search
    assert strict.leader is None        # deflated: it never clears what luck alone would give
    assert strict.target().target_clips == 0


def test_hurdle_needs_enough_contenders_to_mean_anything():
    t = LaneTournament(1, "BTC-USD", T0)
    assert t.hurdle([5.0, 1.0], 1.0) == 0.0   # too few trials to deflate
    assert t.hurdle([0.0] * 20, 1.0) == 0.0   # no spread: nothing to deflate
    assert t.hurdle([float(i) for i in range(20)], 1.0) > 0.0


class AlwaysIn(Strategy):
    name = "AlwaysIn"

    def warmup_bars(self, bars_per_day):
        return 0

    def decide(self, row, clips, state, news):
        return Decision(1, 10.0, "in")


def _rising(sim, bars=6):
    """Prices that gap up every bar, so a limit resting at the last close never fills."""
    px = 100.0
    for i in range(bars):
        px *= 1.05
        sim.on_bar(T0 + i * BAR, row(px, low=px * 0.999), lambda _t: None, NEUTRAL_NEWS, BAR)


def test_a_buy_that_the_price_runs_away_from_is_left_unfilled():
    sim = LaneSim(AlwaysIn(), S, Params({"taker_after_bars": 0}), "BTC-USD")
    _rising(sim)
    assert sim.counts["unfilled"] > 0
    assert sim.counts["crossed"] == 0
    assert sim.clips == 0  # never chased it


def test_crossing_the_spread_enters_after_the_configured_wait():
    sim = LaneSim(AlwaysIn(), S, Params({"taker_after_bars": 2}), "BTC-USD")
    _rising(sim)
    assert sim.counts["crossed"] > 0
    assert sim.entries > 0  # it stopped waiting and took the position
    assert sim.fund.fees_paid > 0  # paying the taker fee, not the maker one


def test_partial_take_sells_half_once_and_leaves_the_position_open():
    """Taking half off the table is not an exit: no cooldown, and the rest keeps running."""
    sim = LaneSim(AlwaysIn(), S, Params({"partial_take_pct": 5.0}), "BTC-USD")
    px = 100.0
    for i in range(6):
        sim.on_bar(T0 + i * BAR, {"open": px, "high": px * 1.02, "low": px * 0.999,
                                  "close": px * 1.01, "volume": 1.0, "day_range_pct": 10.0},
                   lambda _t: None, NEUTRAL_NEWS, BAR)
        px *= 1.01
    assert sim.counts["partial_take"] == 1     # once per position, and counted once
    assert sim.lane.has_position               # the rest is still running
    assert sim.took_partial


def test_partial_take_is_off_by_default():
    sim = LaneSim(AlwaysIn(), S, Params(), "BTC-USD")
    px = 100.0
    for i in range(6):
        sim.on_bar(T0 + i * BAR, {"open": px, "high": px * 1.02, "low": px * 0.999,
                                  "close": px * 1.01, "volume": 1.0, "day_range_pct": 10.0},
                   lambda _t: None, NEUTRAL_NEWS, BAR)
        px *= 1.01
    assert sim.counts["partial_take"] == 0
