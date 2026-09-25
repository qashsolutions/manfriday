from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from highway.book import Fund
from highway.config import Capital, Fees, Settlement
from highway.db import DB
from highway.metrics import reconcile, round_trips

NY = ZoneInfo("America/New_York")
T0 = datetime(2026, 9, 22, 10, 0, tzinfo=NY).timestamp()


@pytest.fixture
def setup(tmp_path):
    db = DB(tmp_path / "t.db")
    f = Fund.new(Capital(), Fees(), Settlement())
    for lane, asset in zip(f.lanes, ["BTC-USD", "SOL-USD", "NVDA", "ETH-USD"]):
        lane.asset = asset
        lane.asset_class = "equity" if asset == "NVDA" else "crypto"
    return db, f


def test_money_reconciles_through_trades_skims_and_refills(setup):
    db, f = setup
    a, b, c = f.lanes[0], f.lanes[1], f.lanes[2]
    f.buy(a, 50, 100.0, T0, "t", liquidity="maker")
    f.buy(a, 50, 100.0, T0, "t")
    f.skim(a, 160.0 / 0.49, T0)  # big gain forces a partial sale into the vault
    f.buy(b, 50, 10.0, T0, "t")
    f.buy(b, 50, 10.0, T0, "t")
    f.check_floor(b, 6.5, T0)  # floor: sell everything, refill from reserve
    f.buy(c, 50, 200.0, T0, "t")
    f.sell_all(c, 210.0, T0 + 60, "t")  # stock proceeds still settling
    db.save_fund(f, "paper", portfolio="quant", key="fund")
    assert reconcile(f, db, "quant") == pytest.approx(0.0, abs=1e-6)


def test_round_trips_rebuild_completed_trades(setup):
    db, f = setup
    a = f.lanes[0]
    f.buy(a, 50, 100.0, T0, "t")
    f.buy(a, 50, 100.0, T0 + 900, "t")
    f.sell_all(a, 110.0, T0 + 3600, "take_profit_day")
    f.buy(a, 50, 100.0, T0 + 7200, "t")  # still open: not a completed trip
    db.save_fund(f, "paper", portfolio="quant", key="fund")
    trips = round_trips(db, "quant")
    assert len(trips) == 1
    assert trips[0]["exits"] == ["take_profit_day"]
    assert trips[0]["pnl"] == pytest.approx(trips[0]["proceeds"] - 100.0)
    assert trips[0]["pnl"] > 0
