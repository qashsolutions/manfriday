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


def _fill(db, pid, ts, lane, asset, side, qty, cash, reason="signal", fee=0.0):
    db.execute(
        "INSERT INTO fills (ts, lane_id, asset, side, qty, price, cash, fee, reason, strategy, mode, portfolio) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (ts, lane, asset, side, qty, cash / max(qty, 1e-9), cash, fee, reason, "t", "paper", pid),
    )


def test_an_asset_bought_back_into_is_one_line_not_three(setup):
    """The trade list shows three trades; this has to show what NEAR cost us in total."""
    from highway.metrics import by_asset

    db, _ = setup
    for i, (cost, got) in enumerate([(100.0, 90.0), (100.0, 105.0), (100.0, 95.0)]):
        _fill(db, "laser", T0 + i * 1000, 1, "NEAR-USD", "buy", 10.0, cost)
        _fill(db, "laser", T0 + i * 1000 + 100, 1, "NEAR-USD", "sell", 10.0, got)
    rows = by_asset(db, "laser")
    assert len(rows) == 1
    near = rows[0]
    assert near["asset"] == "NEAR-USD"
    assert near["trades"] == 3
    assert near["wins"] == 1
    assert near["realised"] == pytest.approx(-10.0)   # -10 +5 -5
    assert near["total"] == pytest.approx(-10.0)
    assert near["first_bought"] == T0                 # day one of the asset, not of the last trade


def test_an_open_position_counts_on_paper_and_is_not_double_counted(setup):
    from highway.metrics import by_asset

    db, _ = setup
    _fill(db, "laser", T0, 1, "ZEC-USD", "buy", 10.0, 100.0)
    _fill(db, "laser", T0 + 10, 1, "ZEC-USD", "sell", 5.0, 60.0)   # part-sold, still open
    db.execute("INSERT INTO league_equity (ts, portfolio, lane_id, asset, equity, price) "
               "VALUES (?,?,?,?,?,?)", (T0 + 20, "laser", 1, "ZEC-USD", 55.0, 11.0))
    rows = by_asset(db, "laser")
    assert len(rows) == 1
    zec = rows[0]
    assert zec["holding"] is True
    assert zec["trades"] == 0                # nothing has closed yet
    assert zec["realised"] == 0.0
    # money already taken out is netted against the cost, never counted twice
    assert zec["total"] == pytest.approx(5 * 11.0 - (100.0 - 60.0))


def test_the_league_view_adds_the_same_asset_across_managers(setup):
    from highway.metrics import assets

    db, _ = setup
    _fill(db, "laser", T0, 1, "NEAR-USD", "buy", 10.0, 100.0)
    _fill(db, "laser", T0 + 10, 1, "NEAR-USD", "sell", 10.0, 90.0)
    _fill(db, "hold", T0, 1, "NEAR-USD", "buy", 10.0, 100.0)
    _fill(db, "hold", T0 + 10, 1, "NEAR-USD", "sell", 10.0, 95.0)
    r = assets(db, {"laser": "Laser", "hold": "Hold"})
    assert len(r["league"]) == 1
    near = r["league"][0]
    assert near["trades"] == 2
    assert sorted(near["managers"]) == ["Hold", "Laser"]
    assert near["total"] == pytest.approx(-15.0)


def test_asset_periods_values_a_position_held_through_a_quiet_period(setup):
    """The point of this view: an asset simply held through a day still made or lost money."""
    from highway.metrics import asset_periods

    import time as _time

    db, _ = setup
    _fill(db, "laser", T0, 1, "BTC-USD", "buy", 1.0, 100.0)
    # price it every hour from the buy until now, rising $10 a day, so every period edge is
    # priceable the way it is in the live database (a tick every ten seconds)
    hours = int((_time.time() - T0) // 3600) + 2
    for h in range(hours):
        ts = T0 + h * 3600
        px = 100.0 + 10.0 * (h // 24)
        db.execute("INSERT INTO ticks (asset, ts, bid, ask, last, gap) VALUES (?,?,?,?,?,0)",
                   ("BTC-USD", ts, px, px, px))
    rows = asset_periods(db, "laser", "day", limit=20)
    assert len(rows) >= 3
    quiet = [r for r in rows if r["assets"] and r["assets"][0]["trades"] == 0]
    assert quiet, "a held position with no trades must still appear"
    assert quiet[0]["assets"][0]["pnl"] == pytest.approx(10.0, abs=0.01)  # one day of the rise
    assert quiet[0]["assets"][0]["held_start"] and quiet[0]["assets"][0]["held_end"]


def test_a_fill_on_a_period_edge_is_not_counted_twice(setup):
    """Regression: qty carried INTO a period must exclude fills landing exactly on the edge.

    Counting such a fill as both 'already held' and 'bought' subtracts it twice, which put the
    whole-league total $50 adrift from the lifetime figure.
    """
    from highway.metrics import asset_periods, by_asset

    db, _ = setup
    _fill(db, "laser", T0, 1, "BTC-USD", "buy", 1.0, 100.0)
    _fill(db, "laser", T0 + 60, 1, "BTC-USD", "sell", 1.0, 108.0)
    db.execute("INSERT INTO ticks (asset, ts, bid, ask, last, gap) VALUES (?,?,?,?,?,0)",
               ("BTC-USD", T0, 100.0, 100.0, 100.0))
    periods = asset_periods(db, "laser", "day", limit=10)
    total = sum(p["total"] for p in periods)
    assert total == pytest.approx(8.0, abs=0.01)
    # and it must agree with the asset's own lifetime figure
    assert total == pytest.approx(by_asset(db, "laser")[0]["total"], abs=0.01)


def test_asset_periods_skips_an_edge_it_cannot_price_rather_than_inventing_one(setup):
    from highway.metrics import asset_periods

    db, _ = setup
    _fill(db, "laser", T0 - 40 * 86400, 1, "GHOST-USD", "buy", 1.0, 100.0)  # never priced
    for p in asset_periods(db, "laser", "day", limit=60):
        for a in p["assets"]:
            assert a["asset"] != "GHOST-USD"
