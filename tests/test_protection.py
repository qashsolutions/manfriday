"""The owner's rule: a stop or take-profit fires on every position, every time, always.

That can only hold if every position is actually being checked. These tests cover the two ways
the check could be skipped, both of which have to be loud rather than silent.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from highway.book import Fund
from highway.config import Settings
from highway.db import DB
from highway.params import Params
from highway.portfolio import Portfolio
from highway.risk import Quote, RiskManager

NY = ZoneInfo("America/New_York")
S = Settings()
T0 = datetime(2026, 9, 22, 10, 0, tzinfo=NY).timestamp()


class Ctx:
    """The slice of the engine that hard_rules touches."""

    def __init__(self, quote, open_market=True, params=None):
        self.s = S
        self.params = params or Params()
        self.risk = RiskManager(S, self.params)
        self.quote = quote
        self.open_market = open_market
        self.bar_seconds = 900

    def market_open(self, lane, now):
        return self.open_market

    def fresh(self, lane, now):
        return self.quote

    def price_at(self, asset, ts):
        return None


def _pf(tmp_path):
    db = DB(tmp_path / "t.db")
    pf = Portfolio("laser", "Laser", S, db)
    lane = pf.fund.lanes[0]
    lane.asset, lane.asset_class = "BTC-USD", "crypto"
    pf.fund.buy(lane, 50.0, 100.0, T0, "signal", "t")
    return pf, lane


def test_a_position_we_cannot_price_is_reported_not_skipped_silently(tmp_path):
    pf, lane = _pf(tmp_path)
    ctx = Ctx(quote=None)
    pf.hard_rules(ctx, lane, T0 + 10)
    assert pf.protection[lane.lane_id]["why"] == "no fresh price"
    # a brief blip is tolerated; a sustained one is an alarm
    assert pf.unprotected(T0 + 20) == []
    blind = pf.unprotected(T0 + 700)
    assert len(blind) == 1 and blind[0]["asset"] == "BTC-USD"


def test_a_closed_market_is_recorded_but_never_raised_as_a_fault(tmp_path):
    pf, lane = _pf(tmp_path)
    pf.hard_rules(Ctx(quote=None, open_market=False), lane, T0 + 10)
    assert pf.protection[lane.lane_id]["why"] == "market closed"
    assert pf.unprotected(T0 + 10_000) == []   # we could not sell anyway


def test_protection_clears_once_a_price_returns(tmp_path):
    pf, lane = _pf(tmp_path)
    pf.hard_rules(Ctx(quote=None), lane, T0 + 10)
    assert pf.protection
    pf.hard_rules(Ctx(Quote("BTC-USD", 100.0, 100.1, 100.0, T0 + 20, "t")), lane, T0 + 20)
    assert pf.protection == {}


def test_a_breach_still_fires_when_price_checks_are_minutes_apart(tmp_path):
    """The regression that matters most.

    A 60-second limit on the confirming tick used to cancel the rule outright: a stale feed
    makes hard_rules return early without clearing the trigger, so a price arriving later than
    60s re-armed the stop instead of firing it, forever, while the position bled.
    """
    pf, lane = _pf(tmp_path)
    crashed = Quote("BTC-USD", 80.0, 80.1, 80.0, T0, "t")   # -20%, far past the -7% stop

    pf.hard_rules(Ctx(crashed), lane, T0 + 60)
    assert lane.has_position                                 # first breach only arms it
    assert pf._triggers[lane.lane_id][0] == "stop_day"

    pf.hard_rules(Ctx(crashed), lane, T0 + 60 + 900)         # 15 minutes later, still breaching
    assert not lane.has_position                             # it must sell, not re-arm
    assert lane.last_exit_reason == "stop_day"


def test_one_bad_print_alone_still_cannot_trigger_an_exit(tmp_path):
    pf, lane = _pf(tmp_path)
    pf.hard_rules(Ctx(Quote("BTC-USD", 80.0, 80.1, 80.0, T0, "t")), lane, T0 + 10)
    assert lane.has_position
    pf.hard_rules(Ctx(Quote("BTC-USD", 100.0, 100.1, 100.0, T0, "t")), lane, T0 + 20)
    assert lane.has_position
    assert pf._triggers == {}    # the good print cleared it


def _held(tmp_path, clips=2):
    db = DB(tmp_path / "t.db")
    pf = Portfolio("laser", "Laser", S, db)
    lane = pf.fund.lanes[0]
    lane.asset, lane.asset_class = "BTC-USD", "crypto"
    for _ in range(clips):
        pf.fund.buy(lane, 50.0, 100.0, T0, "signal", "t")
    return pf, lane


def test_taking_half_banks_one_clip_and_leaves_the_rest_running(tmp_path):
    """The owner's rule of Sept 29: recover some principal, let the remainder run."""
    pf, lane = _held(tmp_path)
    p = Params({"partial_take_pct": 8.0})
    up = Quote("BTC-USD", 110.0, 110.1, 110.0, T0, "t")   # +10%, past the +8% trigger
    qty_before, clips_before = lane.qty, len(lane.tranches)

    pf.hard_rules(Ctx(up, params=p), lane, T0 + 10)
    assert lane.qty == qty_before                 # first tick only arms it

    pf.hard_rules(Ctx(up, params=p), lane, T0 + 20)
    assert lane.has_position                      # NOT an exit
    assert lane.qty < qty_before                  # but half is gone
    assert len(lane.tranches) < clips_before
    assert lane.took_partial
    assert lane.cooldown_until == 0.0             # no cooldown: the lane is still in the trade
    assert lane.asset == "BTC-USD"


def test_half_is_only_taken_once_per_position(tmp_path):
    pf, lane = _held(tmp_path)
    p = Params({"partial_take_pct": 8.0})
    up = Quote("BTC-USD", 110.0, 110.1, 110.0, T0, "t")
    for i in range(6):
        pf.hard_rules(Ctx(up, params=p), lane, T0 + 10 * (i + 1))
    assert lane.took_partial
    assert len(lane.tranches) == 1                # halved once, not repeatedly


def test_the_remaining_half_still_obeys_the_stop(tmp_path):
    pf, lane = _held(tmp_path)
    p = Params({"partial_take_pct": 8.0})
    up = Quote("BTC-USD", 110.0, 110.1, 110.0, T0, "t")
    pf.hard_rules(Ctx(up, params=p), lane, T0 + 10)
    pf.hard_rules(Ctx(up, params=p), lane, T0 + 20)
    assert lane.has_position

    crash = Quote("BTC-USD", 80.0, 80.1, 80.0, T0, "t")   # far past the day stop
    pf.hard_rules(Ctx(crash, params=p), lane, T0 + 30)
    pf.hard_rules(Ctx(crash, params=p), lane, T0 + 40)
    assert not lane.has_position
    assert lane.last_exit_reason == "stop_day"
    assert lane.took_partial is False             # flat: the next position starts fresh


def test_taking_half_is_off_when_the_param_is_zero(tmp_path):
    pf, lane = _held(tmp_path)
    up = Quote("BTC-USD", 110.0, 110.1, 110.0, T0, "t")
    for i in range(4):
        pf.hard_rules(Ctx(up, params=Params({"partial_take_pct": 0.0})), lane, T0 + 10 * (i + 1))
    assert len(lane.tranches) == 2
    assert not lane.took_partial
