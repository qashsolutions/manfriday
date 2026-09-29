"""Hold is the yardstick every alpha number is measured against, so it must not drift.

It used to have its basket recomputed on every Scout pass, which turned the benchmark into an
active manager - 12 distinct assets and 30 buys in the league's first week.
"""
from highway.db import DB
from highway.engine import Engine


class StubEngine:
    """Just enough of the engine to exercise the basket rule."""

    _ensure_hold_basket = Engine._ensure_hold_basket

    def __init__(self, db, basket):
        self.db = db
        self._basket = basket
        self.picks = 0

    def hold_basket(self):
        self.picks += 1
        return list(self._basket)


def test_the_benchmark_basket_is_chosen_once_and_then_left_alone(tmp_path):
    db = DB(tmp_path / "t.db")
    e = StubEngine(db, ["BTC-USD", "AAPL"])
    e._ensure_hold_basket()
    assert db.get_state("hold_assets") == ["BTC-USD", "AAPL"]

    e._basket = ["ZEC-USD", "NVDA"]   # the Scout has moved on; the benchmark must not
    e._ensure_hold_basket()
    e._ensure_hold_basket()
    assert db.get_state("hold_assets") == ["BTC-USD", "AAPL"]
    assert e.picks == 1


def test_a_lost_basket_is_repicked_rather_than_left_empty(tmp_path):
    db = DB(tmp_path / "t.db")
    e = StubEngine(db, ["BTC-USD"])
    e._ensure_hold_basket()
    db.set_state("hold_assets", [])
    e._ensure_hold_basket()
    assert db.get_state("hold_assets") == ["BTC-USD"]
    assert e.picks == 2


def test_a_stopped_lane_keeps_its_place_in_the_basket(tmp_path):
    """The whole point of the owner's choice: stops still fire, but they cannot rotate Hold.

    The basket still names the asset, so the lane buys the same one back after the cooldown
    instead of being re-scouted into something else.
    """
    db = DB(tmp_path / "t.db")
    e = StubEngine(db, ["BTC-USD", "AAPL", "GLD", "ZEC-USD"])
    e._ensure_hold_basket()
    before = db.get_state("hold_assets")
    e._basket = ["SOL-USD", "MSFT", "VOO", "UNI-USD"]  # a stop, then a fresh Scout pass
    e._ensure_hold_basket()
    assert db.get_state("hold_assets") == before
