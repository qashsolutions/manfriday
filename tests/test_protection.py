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

    def __init__(self, quote, open_market=True):
        self.s = S
        self.risk = RiskManager(S, Params())
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
