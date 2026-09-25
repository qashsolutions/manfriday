from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from highway.book import Fund
from highway.config import Settings
from highway.params import Params
from highway.risk import (Quote, RiskManager, day_change, giveback_pct, hold_hours,
                          signal_exit_ok)

NY = ZoneInfo("America/New_York")
S = Settings()
T0 = datetime(2026, 9, 22, 10, 0, tzinfo=NY).timestamp()
H = 3600


def setup():
    f = Fund.new(S.capital, S.fees, S.settlement)
    lane = f.lanes[0]
    lane.asset, lane.asset_class = "BTC-USD", "crypto"
    return f, lane, RiskManager(S, Params())


def q(bid, ts=T0, gap=None):
    return Quote("BTC-USD", bid, bid * 1.0002, bid, ts, "test", gap)


def no_history(_ts):
    return None


def test_down_10pct_same_day_exits():
    f, lane, risk = setup()
    fill = f.buy(lane, 50, 100.0, T0, "test")
    bid = fill.price * 0.90
    assert risk.exit_signal(lane, bid, no_history, T0 + 2 * H) == ("stop_day", pytest.approx(-10.0))


def test_just_inside_the_day_stop_holds():
    """Derived from the configured stop so the test cannot drift when the rule is retuned."""
    f, lane, risk = setup()
    fill = f.buy(lane, 50, 100.0, T0, "test")
    just_inside = 1 + (S.rules.stop_loss_day_pct + 0.1) / 100
    assert risk.exit_signal(lane, fill.price * just_inside, no_history, T0 + 2 * H) is None


def test_just_under_the_take_profit_holds_but_above_sells():
    """Tested a hair either side rather than exactly on it: price times 1.12 lands at
    12.000000000001% in floating point, which is not a meaningful distinction."""
    f, lane, risk = setup()
    fill = f.buy(lane, 50, 100.0, T0, "test")
    at = 1 + S.rules.take_profit_day_pct / 100
    assert risk.exit_signal(lane, fill.price * (at - 0.001), no_history, T0 + H) is None
    sig = risk.exit_signal(lane, fill.price * (at + 0.001), no_history, T0 + H)
    assert sig[0] == "take_profit_day"


def test_old_position_uses_price_a_day_ago():
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    now = T0 + 30 * H
    # Up 20% from entry overall, but down 10% versus this time yesterday: exit.
    price_yesterday = 120.0 / 0.9 * 0.9 / 0.9  # 133.33
    bid = price_yesterday * 0.9
    assert risk.exit_signal(lane, bid, lambda ts: price_yesterday, now)[0] == "stop_day"


def test_mixed_tranches():
    f, lane, _ = setup()
    f.buy(lane, 50, 100.0, T0, "old")
    f.buy(lane, 50, 110.0, T0 + 26 * H, "new")
    now = T0 + 27 * H
    old_qty, new = lane.tranches[0].qty, lane.tranches[1]
    ref = old_qty * 105.0 + new.qty * new.price
    bid = 100.0
    expected = (lane.qty * bid) / ref - 1
    assert day_change(lane, bid, lambda ts: 105.0, now, 24) == pytest.approx(expected)


def test_cooldowns():
    _, lane, risk = setup()
    risk.start_cooldown(lane, "stop_day", T0)
    assert lane.cooldown_until == T0 + 24 * H
    lane.cooldown_until = 0
    risk.start_cooldown(lane, "take_profit_day", T0)
    assert lane.cooldown_until == T0 + 4 * H


def approve(risk, lane, notional=50, quote=None, now=T0, move=10.0, open_=True, paused=False):
    return risk.approve_buy(lane, notional, quote or q(100.0), now, move, open_, paused)


def test_buy_approvals():
    f, lane, risk = setup()
    assert approve(risk, lane).ok
    assert not approve(risk, lane, notional=51).ok
    assert not approve(risk, lane, paused=True).ok
    assert not approve(risk, lane, open_=False).ok
    assert not approve(risk, lane, quote=q(100.0, ts=T0 - 600)).ok
    assert "disagree" in approve(risk, lane, quote=q(100.0, gap=2.5)).reason
    assert "beat fees" in approve(risk, lane, move=2.0).reason
    risk.start_cooldown(lane, "stop_day", T0)
    assert "cooling down" in approve(risk, lane, now=T0 + H).reason
    assert approve(risk, lane, now=T0 + 25 * H, quote=q(100.0, ts=T0 + 25 * H)).ok


def test_max_buys_per_day():
    f, lane, risk = setup()
    for i in range(S.rules.max_buys_per_lane_per_day):
        f.buy(lane, 10, 100.0, T0 + i, "test")
    assert "buys in the last 24h" in approve(risk, lane, notional=10, now=T0 + 10).reason


def test_round_trip_cost_by_venue():
    _, _, risk = setup()
    assert risk.round_trip_pct("coinbase") == pytest.approx(1.45)  # 0.5% + 0.9% + slippage
    assert risk.round_trip_pct("cryptocom") == pytest.approx(0.8)  # 0.25% + 0.5% + slippage
    assert risk.round_trip_pct("webull", half_spread_bps=3.0) == pytest.approx(0.11)  # commission-free: spread only
    assert risk.round_trip_pct("webull", half_spread_bps=40.0) == pytest.approx(0.85)  # a $1-5 penny stock


def test_venue_gap_blocks_buys_but_not_exit_pricing():
    _, lane, risk = setup()
    gapped = q(100.0, gap=8.0)  # Coinbase and Crypto.com disagree by 8% (e.g. during a crash)
    assert not risk.quote_ok(gapped, "crypto", T0).ok  # new buys: blocked
    assert risk.quote_ok(gapped, "crypto", T0, check_divergence=False).ok  # exits, fills, skims: allowed


def test_session_guardrails_know_the_clock():
    from datetime import datetime

    from highway.calendar import minutes_since_open, minutes_to_close, session_close

    ny = ZoneInfo("America/New_York")
    normal = datetime(2026, 9, 22, 15, 45, tzinfo=ny).timestamp()
    half_day = datetime(2026, 11, 27, 12, 45, tzinfo=ny).timestamp()  # 1pm close, day after Thanksgiving
    just_open = datetime(2026, 9, 22, 9, 32, tzinfo=ny).timestamp()
    weekend = datetime(2026, 9, 20, 12, 0, tzinfo=ny).timestamp()
    holiday = datetime(2026, 12, 25, 12, 0, tzinfo=ny).timestamp()

    assert minutes_to_close(normal) == 15  # the last-30-minutes rule would block a buy here
    assert minutes_to_close(half_day) == 15  # half-day is handled, not treated as a 4pm close
    assert session_close(half_day).hour == 13
    assert minutes_since_open(just_open) == 2  # the first-minutes rule would block a buy here
    assert minutes_to_close(weekend) is None and minutes_to_close(holiday) is None


def test_stale_buy_decisions_get_a_fresh_look():
    from highway.risk import stale_decision_reason

    fresh, gone_stale = dict(age_hours=0.5, crossed_a_close=False), dict(age_hours=14, crossed_a_close=False)
    base = dict(asset="MSTR", news={}, ask=100.0, reference=100.0, day_ago=100.0, stale_hours=4.0, max_gap_pct=5.0)

    assert stale_decision_reason(**base, **fresh) is None  # a fresh call just executes
    assert stale_decision_reason(**base, **gone_stale) is None  # stale but nothing changed: fine

    # overnight the price gapped, the news turned, or it slid: each one waits for a new call
    assert "gapped up" in stale_decision_reason(**{**base, "ask": 108.0}, **gone_stale)
    assert "gapped down" in stale_decision_reason(**{**base, "ask": 92.0}, **gone_stale)
    assert "news turned negative" in stale_decision_reason(**{**base, "news": {"count": 3, "score": -0.4}}, **gone_stale)
    assert "down 4.0% over 24h" in stale_decision_reason(**{**base, "ask": 96.0, "reference": 96.0}, **gone_stale)

    # a call made before today's open is re-checked even if only two hours old
    assert "gapped up" in stale_decision_reason(**{**base, "ask": 108.0}, age_hours=2, crossed_a_close=True)


# ---- the give-back stop: protect a gain without ever capping it -------------------------

def test_giveback_pct_measures_the_fall_from_the_high():
    assert giveback_pct(100.0, 88.0) == pytest.approx(-12.0)
    assert giveback_pct(100.0, 100.0) == pytest.approx(0.0)
    assert giveback_pct(100.0, 130.0) == pytest.approx(30.0)


def test_giveback_pct_needs_real_prices():
    assert giveback_pct(0.0, 88.0) is None     # no high-water mark yet
    assert giveback_pct(100.0, 0.0) is None


def test_a_position_that_gives_back_12pct_from_its_high_exits():
    """The whole point: it ran up over days, so the gain is protected on the way back down.

    A flat day is supplied deliberately - otherwise the +15% day rule fires first and this
    would not be testing the give-back stop at all.
    """
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    lane.peak_price = 200.0                     # doubled since entry
    at_limit = 200.0 * (1 - S.rules.giveback_pct / 100)
    kind, pct = risk.exit_signal(lane, at_limit, lambda ts: at_limit * 1.01, T0 + 40 * H)
    assert kind == "giveback"
    assert pct == pytest.approx(-S.rules.giveback_pct)


def test_giving_back_11_9pct_holds():
    """A winner is never capped - only its retreat is."""
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    lane.peak_price = 200.0
    inside = 200.0 * (1 - (S.rules.giveback_pct - 0.2) / 100)
    assert risk.exit_signal(lane, inside, lambda ts: inside * 1.01, T0 + 40 * H) is None


def test_a_still_climbing_winner_is_left_alone():
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    lane.peak_price = 200.0
    assert risk.exit_signal(lane, 199.0, lambda ts: 198.5, T0 + 40 * H) is None


def test_the_day_rules_still_come_first():
    """A 10% fall inside a day is a stop, not a give-back, so the event says the right thing."""
    f, lane, risk = setup()
    fill = f.buy(lane, 50, 100.0, T0, "test")
    lane.peak_price = fill.price
    assert risk.exit_signal(lane, fill.price * 0.90, no_history, T0 + 2 * H)[0] == "stop_day"


def test_a_slow_bleed_is_caught_even_though_no_single_day_broke_the_stop():
    """Day rules only see 24 hours; this is the gap the give-back stop closes. The price is
    below its peak by more than the give-back, but flat against yesterday."""
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    lane.peak_price = 100.0
    px = 100.0 * (1 - (S.rules.giveback_pct + 1) / 100)
    assert risk.exit_signal(lane, px, lambda ts: px * 1.005, T0 + 200 * H)[0] == "giveback"


def test_closing_the_position_clears_the_high_water_mark():
    """Otherwise the next position would inherit the last one's high and sell instantly."""
    f, lane, risk = setup()
    fill = f.buy(lane, 50, 100.0, T0, "test")
    lane.peak_price = 500.0
    f.sell_all(lane, fill.price, T0 + H, reason="test")
    assert not lane.has_position
    assert lane.peak_price == 0.0


def test_a_partial_sale_keeps_the_high_water_mark():
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0, "test")
    lane.peak_price = 500.0
    f.sell(lane, lane.qty / 2, 100.0, T0 + H, reason="test")
    assert lane.has_position
    assert lane.peak_price == 500.0


# ---- the two re-entry brakes (both default to off) ---------------------------------------

def test_min_hold_off_by_default_lets_a_strategy_sell_at_once():
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    assert signal_exit_ok(lane, T0 + 60, 0.0)          # 0 = the rule is off


def test_min_hold_blocks_a_strategy_exit_inside_the_window():
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    assert not signal_exit_ok(lane, T0 + 3 * H, 4.0)   # 3h old, 4h minimum
    assert signal_exit_ok(lane, T0 + 5 * H, 4.0)


def test_min_hold_counts_from_the_first_clip_not_the_last():
    """Scaling in must not restart the clock, or a second clip would extend the lock-in."""
    f, lane, risk = setup()
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0 + 3 * H, "test")
    assert hold_hours(lane, T0 + 5 * H) == pytest.approx(5.0)
    assert signal_exit_ok(lane, T0 + 5 * H, 4.0)


def test_min_hold_never_blocks_a_hard_rule():
    """A position minutes old that falls 10% is still sold: the stop is not a strategy exit."""
    f, lane, risk = setup()
    fill = f.buy(lane, 50, 100.0, T0, "test")
    assert risk.exit_signal(lane, fill.price * 0.90, no_history, T0 + 60)[0] == "stop_day"


def test_an_empty_lane_has_no_hold_time():
    f, lane, risk = setup()
    assert hold_hours(lane, T0) == 0.0
    assert signal_exit_ok(lane, T0, 4.0)
