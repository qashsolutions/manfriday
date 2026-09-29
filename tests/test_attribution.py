"""Attributing realised money to whichever rule closed the trade."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from highway.attribution import HARD_RULES, by_rule, label, report
from highway.db import DB

NY = ZoneInfo("America/New_York")
T0 = datetime(2026, 9, 22, 10, 0, tzinfo=NY).timestamp()


@pytest.fixture
def db(tmp_path):
    return DB(tmp_path / "t.db")


def fill(db, pid, ts, lane, asset, side, qty, cash, reason, fee=0.25):
    db.execute(
        "INSERT INTO fills (ts, lane_id, asset, side, qty, price, cash, fee, reason, strategy, mode, portfolio) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (ts, lane, asset, side, qty, cash / max(qty, 1e-9), cash, fee, reason, "t", "paper", pid),
    )


def test_a_trade_is_credited_to_the_rule_that_closed_it(db):
    # bought twice, part-sold by the strategy, then stopped out: the stop ended it, so it is a stop
    fill(db, "laser", T0, 1, "BTC-USD", "buy", 1.0, 50.0, "signal")
    fill(db, "laser", T0 + 60, 1, "BTC-USD", "buy", 1.0, 50.0, "signal")
    fill(db, "laser", T0 + 120, 1, "BTC-USD", "sell", 0.5, 30.0, "signal")
    fill(db, "laser", T0 + 180, 1, "BTC-USD", "sell", 1.5, 45.0, "stop_day")
    rows = by_rule(db, "laser")
    assert [r["reason"] for r in rows] == ["stop_day"]
    assert rows[0]["trades"] == 1
    assert rows[0]["pnl"] == pytest.approx(30.0 + 45.0 - 100.0)  # -25.00
    assert rows[0]["hard_rule"] is True


def test_profit_and_loss_split_by_rule_and_manager(db):
    fill(db, "etf", T0, 1, "VOO", "buy", 1.0, 100.0, "signal")
    fill(db, "etf", T0 + 60, 1, "VOO", "sell", 1.0, 112.0, "take_profit_day")
    fill(db, "etf", T0 + 120, 2, "GLD", "buy", 1.0, 100.0, "signal")
    fill(db, "etf", T0 + 180, 2, "GLD", "sell", 1.0, 93.0, "stop_day")
    rows = {r["reason"]: r for r in by_rule(db, "etf")}
    assert rows["take_profit_day"]["pnl"] == pytest.approx(12.0)
    assert rows["stop_day"]["pnl"] == pytest.approx(-7.0)
    assert rows["take_profit_day"]["wins"] == 1
    assert rows["stop_day"]["wins"] == 0

    r = report(db, {"etf": "ETF"})
    assert r["realised"] == pytest.approx(5.0)
    assert r["managers"][0]["name"] == "ETF"
    # the give-back stop is live but untriggered here, and that must be visible, not hidden
    assert "giveback" in r["never_fired"]
    assert "stop_day" not in r["never_fired"]


def test_an_open_position_is_not_counted_until_it_closes(db):
    fill(db, "hold", T0, 1, "BTC-USD", "buy", 1.0, 50.0, "signal")
    assert by_rule(db, "hold") == []
    assert report(db, {"hold": "Hold"})["realised"] == 0.0


def test_every_hard_rule_has_a_plain_english_label():
    for reason in HARD_RULES:
        assert label(reason) != reason
        assert "_" not in label(reason)
