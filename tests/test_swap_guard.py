"""A lane waiting to change asset must not keep buying the one it is leaving."""

from highway.portfolio import Target, swap_guard


def t(clips: int, asset: str = "ETHA") -> Target:
    return Target(asset, clips, 12.0, "trend: uptrend", "trend", decided_at=100.0, decided_price=25.0)


def test_no_pending_swap_changes_nothing():
    assert swap_guard(t(2), held_clips=1, wanted=None) == t(2)


def test_already_holding_the_wanted_asset_changes_nothing():
    assert swap_guard(t(2, "ARKK"), held_clips=1, wanted="ARKK") == t(2, "ARKK")


def test_a_pending_swap_blocks_a_new_clip():
    out = swap_guard(t(2), held_clips=1, wanted="ARKK")
    assert out.clips == 1                      # holds what it has, buys no more
    assert "ARKK" in out.reason


def test_selling_is_never_blocked():
    """The lane still has to be able to get out - that is how it reaches the switch."""
    out = swap_guard(t(0), held_clips=2, wanted="ARKK")
    assert out.clips == 0
    assert out.reason == "trend: uptrend"      # untouched


def test_holding_steady_is_untouched():
    assert swap_guard(t(1), held_clips=1, wanted="ARKK").reason == "trend: uptrend"


def test_an_empty_lane_cannot_be_topped_up_either():
    out = swap_guard(t(2), held_clips=0, wanted="ARKK")
    assert out.clips == 0


def test_the_decision_stamp_survives_the_guard():
    """follow() re-checks stale decisions against these, so they must not be reset."""
    out = swap_guard(t(2), held_clips=1, wanted="ARKK")
    assert (out.decided_at, out.decided_price) == (100.0, 25.0)
    assert (out.asset, out.strategy, out.expected_move_pct) == ("ETHA", "trend", 12.0)
