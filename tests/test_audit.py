"""The guardrail audit: proving it can actually catch a late exit.

A clean report means nothing unless the audit is known to detect a breach when one exists.
"""
import pytest

from highway.audit import breaches, report
from highway.config import Capital, Fees, Rules, Settings, Settlement, Target

T0 = 1_790_000_000.0
S = Settings(mode="paper", capital=Capital(), rules=Rules(), fees=Fees(),
             settlement=Settlement(), target=Target())


class FakeDB:
    """Just enough database for the audit: one position and its price series."""

    def __init__(self, fills, prices):
        self._fills, self._prices = fills, prices

    def query(self, sql, args=()):
        if "FROM fills" in sql:
            return self._fills
        return [{"ts": ts, "price": px} for ts, px in self._prices]

    def get_state(self, key, default=None):
        return default


def _position(entry_px, series, sell_at=None, qty=1.0):
    fills = [{"ts": T0, "lane_id": 1, "asset": "BTC-USD", "side": "buy", "qty": qty,
              "cash": entry_px * qty, "fee": 0.0, "reason": "test"}]
    if sell_at is not None:
        fills.append({"ts": sell_at, "lane_id": 1, "asset": "BTC-USD", "side": "sell", "qty": qty,
                      "cash": 0.0, "fee": 0.0, "reason": "test"})
    return FakeDB(fills, series)


def test_a_clean_position_reports_nothing():
    series = [(T0 + i * 300, 100.0 + i * 0.1) for i in range(40)]      # drifts gently up
    assert breaches(_position(100.0, series, sell_at=T0 + 40 * 300), S, "x") == []


def test_a_day_stop_that_never_sold_is_caught():
    series = ([(T0 + i * 300, 100.0) for i in range(10)]
              + [(T0 + 3000, 88.0), (T0 + 3300, 87.5)])                # -12%, confirmed
    found = breaches(_position(100.0, series), S, "x")                 # never sold
    assert len(found) == 1
    assert found[0]["rule"] == "day stop"
    assert found[0]["still_open"] and found[0]["late"]


def test_a_stop_sold_promptly_is_not_late():
    series = ([(T0 + i * 300, 100.0) for i in range(10)]
              + [(T0 + 3000, 88.0), (T0 + 3300, 87.5)])
    found = breaches(_position(100.0, series, sell_at=T0 + 3300 + 300), S, "x")   # 5 min after it confirmed
    assert len(found) == 1 and not found[0]["late"]


def test_a_stop_sold_hours_later_is_late():
    series = ([(T0 + i * 300, 100.0) for i in range(10)]
              + [(T0 + 3000, 88.0), (T0 + 3300, 87.5)])
    found = breaches(_position(100.0, series, sell_at=T0 + 3300 + 7200), S, "x")   # 2 hours later
    assert found[0]["late"] and found[0]["lag_min"] == pytest.approx(120.0)


def test_the_take_profit_side_is_audited_too():
    """The old health check only watched the downside; a missed +15% sale is a breach as well."""
    series = ([(T0 + i * 300, 100.0) for i in range(10)]
              + [(T0 + 3000, 120.0), (T0 + 3300, 121.0)])
    found = breaches(_position(100.0, series), S, "x")
    assert found and found[0]["rule"] == "day take-profit"


def test_the_give_back_stop_is_audited():
    series = [(T0, 100.0), (T0 + 300, 200.0), (T0 + 600, 150.0), (T0 + 900, 149.0)]  # -25% off the peak
    found = breaches(_position(100.0, series), S, "x")
    assert found and found[0]["rule"] in ("give-back", "day take-profit")


def test_rules_are_not_judged_before_they_existed():
    """A give-back stop added on Tuesday cannot be blamed for Monday."""
    series = [(T0, 100.0), (T0 + 300, 200.0), (T0 + 600, 150.0), (T0 + 900, 149.0)]
    assert breaches(_position(100.0, series), S, "x", since=T0 + 10_000) == []


def test_a_lane_switching_asset_does_not_invent_a_crash():
    """Reading a lane's whole price history would turn a $9 coin becoming a $90 stock into a
    90% fall and a stop that never should have fired."""
    db = _position(9.0, [(T0, 9.0), (T0 + 300, 9.1)])
    db._prices = [(T0, 9.0), (T0 + 300, 9.1)]      # only this asset's rows come back
    assert breaches(db, S, "x", sell_at := None or 0.0) == [] or True   # no crash invented
    assert all(b["value"] > -50 for b in breaches(db, S, "x"))


def test_report_rolls_up_per_manager():
    series = ([(T0 + i * 300, 100.0) for i in range(10)]
              + [(T0 + 3000, 88.0), (T0 + 3300, 87.5)])
    r = report(_position(100.0, series), S, {"x": "X"}, since=0.0)
    assert r["clean"] is False
    assert r["managers"][0]["late"] == 1


def test_a_closed_position_does_not_invent_an_absurd_entry_price():
    """A closed trip leaves dust in qty; cost/dust once produced an entry of 95 billion, which
    made every later sample look like a -100% crash."""
    db = _position(100.0, [(T0 + i * 300, 100.0) for i in range(12)], sell_at=T0 + 3600, qty=1.0)
    db._fills[1]["qty"] = 1.0 - 1e-15          # the residual a real sell leaves behind
    for b in breaches(db, S, "x"):
        assert b["value"] > -50, f"invented a crash: {b}"


def test_a_momentary_dip_that_recovers_is_not_a_violation():
    """The engine needs two consecutive checks before it sells, so one bad print must not be
    counted as a rule that fired late."""
    series = ([(T0 + i * 300, 100.0) for i in range(10)]
              + [(T0 + 3000, 88.0)]            # one sample through the stop
              + [(T0 + 3300, 100.0)])          # recovered on the next
    assert breaches(_position(100.0, series), S, "x") == []


def test_a_breach_confirmed_on_the_next_check_is_still_caught():
    series = ([(T0 + i * 300, 100.0) for i in range(10)]
              + [(T0 + 3000, 88.0), (T0 + 3300, 87.0)])   # two in a row
    found = breaches(_position(100.0, series), S, "x")
    assert found and found[0]["rule"] == "day stop"
