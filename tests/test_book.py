from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from highway.book import BookError, Fund
from highway.config import Capital, Fees, Settlement

NY = ZoneInfo("America/New_York")
CAP, FEES, SETTLE = Capital(), Fees(), Settlement()
T0 = datetime(2026, 9, 22, 10, 0, tzinfo=NY).timestamp()  # a Tuesday, market open


def fund():
    f = Fund.new(CAP, FEES, SETTLE)
    for lane, asset in zip(f.lanes, ["BTC-USD", "SOL-USD", "NVDA", "ETH-USD"]):
        lane.asset = asset
        lane.asset_class = "equity" if asset == "NVDA" else "crypto"
    return f


# The fund as it was before the ETF sleeve: four lanes and a $100 reserve. The refill machinery
# is still live whenever a reserve is funded, so it keeps its own coverage here.
LEGACY = Capital(reserve=100.0, sleeve_lanes=0)


def legacy_fund():
    f = Fund.new(LEGACY, FEES, SETTLE)
    f.lanes[0].asset, f.lanes[0].asset_class = "BTC-USD", "crypto"
    return f


def net_per_unit_value(price):
    """Value of $50 bought at `price` if the price is still `price`."""
    return 50 * (1 - FEES.taker) / (1 + FEES.slippage_bps / 1e4)


def test_new_fund_holds_exactly_500():
    f = fund()
    assert [l.cash for l in f.lanes] == [100.0] * 4
    assert f.reserve == 100.0          # restored when the shared ETF sleeve was retired
    assert f.capital_in == 400.0
    assert f.total_value({}) == pytest.approx(500.0)


def test_there_is_no_shared_sleeve_any_more():
    """A dedicated ETF manager replaced it; every fund holding the same four funds was the
    sameness the mandates exist to remove."""
    f = fund()
    assert [l.lane_id for l in f.lanes] == [1, 2, 3, 4]
    assert all(l.kind == "main" for l in f.lanes)


def test_sleeve_lanes_scale_the_rules_rather_than_inherit_them():
    """A $25 lane could never reach a $150 cap or fall to a $70 floor, so they scale."""
    assert CAP.cap_for(25.0) == pytest.approx(37.50)     # 150 * 25/100
    assert CAP.floor_for(25.0) == pytest.approx(17.50)   # 70 * 25/100
    assert CAP.skim_for(25.0) == pytest.approx(12.50)    # 50 * 25/100
    assert CAP.cap_for(100.0) == CAP.lane_cap            # main lanes are unchanged
    assert CAP.floor_for(100.0) == CAP.lane_floor
    assert CAP.skim_for(100.0) == CAP.skim_chunk


def test_a_smaller_lane_still_scales_its_own_cap():
    """The proportional rules stay live for a lane smaller than the standard $100 one, which is
    what the retired sleeve used and what any future part-sized lane would rely on."""
    f = fund()
    lane = f.lanes[0]
    lane.principal = 25.0                                # a quarter-sized lane
    lane.asset, lane.asset_class = "GLD", "equity"
    lane.cash = 40.0                                     # above its scaled $37.50 cap
    assert f.skim(lane, None, T0) == pytest.approx(12.50)
    assert f.vault + f.vault_pending == pytest.approx(12.50)
    assert lane.cash == pytest.approx(27.50)


def test_a_lane_at_the_floor_is_refilled_again_now_the_reserve_is_back():
    f = fund()
    lane = f.lanes[0]
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0, "test")
    assert f.reserve == 100.0
    assert f.check_floor(lane, 69.0 / lane.qty, T0) == "refilled"
    assert lane.status == "active"


def test_buy_over_50_is_rejected():
    f = fund()
    with pytest.raises(BookError, match="per-buy limit"):
        f.buy(f.lanes[0], 50.01, 100.0, T0, "test")


def test_buy_more_than_settled_cash_is_rejected():
    f = fund()
    lane = f.lanes[0]
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0, "test")
    with pytest.raises(BookError, match="settled cash"):
        f.buy(lane, 5, 100.0, T0, "test")


def test_buy_charges_taker_fee_and_slippage():
    f = fund()
    fill = f.buy(f.lanes[0], 50, 100.0, T0, "test")
    assert fill.fee == pytest.approx(0.45)
    assert fill.price == pytest.approx(100.05)
    assert fill.qty == pytest.approx(49.55 / 100.05)
    assert f.lanes[0].cash == pytest.approx(50.0)


def test_crypto_sale_is_usable_immediately():
    f = fund()
    lane = f.lanes[0]
    f.buy(lane, 50, 100.0, T0, "test")
    fill = f.sell_all(lane, 100.0, T0 + 60, "test")
    assert lane.pending == []
    assert lane.cash == pytest.approx(50 + fill.cash)


def test_stock_sale_settles_next_business_day():
    f = fund()
    lane = f.lanes[2]  # NVDA
    f.buy(lane, 50, 200.0, T0, "test")
    f.buy(lane, 50, 200.0, T0, "test")
    fill = f.sell_all(lane, 200.0, T0 + 3600, "test")
    assert lane.cash == pytest.approx(0.0)
    assert lane.lane_pending == pytest.approx(fill.cash)
    with pytest.raises(BookError, match="settled cash"):
        f.buy(lane, 10, 200.0, T0 + 7200, "test")
    f.settle(T0 + 20 * 3600)  # Wednesday 06:00 NY, before the open
    assert lane.cash == pytest.approx(0.0)
    f.settle(datetime(2026, 9, 23, 9, 30, tzinfo=NY).timestamp())
    assert lane.cash == pytest.approx(fill.cash)
    assert lane.pending == []


def test_skim_from_cash_when_lane_hits_150():
    f = fund()
    lane = f.lanes[0]
    fill = f.buy(lane, 50, 100.0, T0, "test")
    price = 100.0 / fill.qty  # position now worth exactly $100, lane $150
    assert lane.equity(price) == pytest.approx(150.0)
    moved = f.skim(lane, price, T0 + 60)
    assert moved == 50.0
    assert f.vault == pytest.approx(50.0)
    assert lane.equity(price) == pytest.approx(100.0)
    assert lane.has_position  # no forced sale needed


def test_no_skim_below_150():
    f = fund()
    lane = f.lanes[0]
    fill = f.buy(lane, 50, 100.0, T0, "test")
    assert f.skim(lane, 99.9 / fill.qty, T0) == 0.0
    assert f.vault == 0.0


def test_skim_sells_position_when_no_cash():
    f = fund()
    lane = f.lanes[0]
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0, "test")
    price = 150.0 / lane.qty
    moved = f.skim(lane, price, T0 + 60)
    assert moved == 50.0
    assert f.vault == pytest.approx(50.0)
    assert lane.cash == pytest.approx(0.0)
    # lane keeps ~$100 minus the fee on the forced sale
    assert 99.0 < lane.equity(price) < 100.0


def test_skim_takes_every_full_50():
    f = fund()
    lane = f.lanes[0]
    fill = f.buy(lane, 50, 100.0, T0, "test")
    price = 160.0 / fill.qty  # lane = 50 cash + 160 position = 210
    assert f.skim(lane, price, T0) == 100.0
    assert f.vault == pytest.approx(100.0)
    assert lane.equity(price) == pytest.approx(110.0, abs=1.0)


def test_skim_earmarks_unsettled_stock_proceeds():
    f = fund()
    lane = f.lanes[2]
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0, "test")
    f.sell_all(lane, 160.0, T0 + 60, "test")  # all proceeds pending until tomorrow
    assert lane.cash == 0.0
    assert lane.equity(None) >= 150
    f.skim(lane, None, T0 + 120)
    assert f.vault == 0.0
    assert f.vault_pending == pytest.approx(50.0)
    f.settle(datetime(2026, 9, 23, 9, 30, tzinfo=NY).timestamp())
    assert f.vault == pytest.approx(50.0)
    assert lane.cash == pytest.approx(lane.equity(None))


def test_floor_refills_from_reserve_then_closes():
    f = legacy_fund()
    lane = f.lanes[0]
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0, "test")
    price = 69.0 / lane.qty
    assert f.check_floor(lane, price, T0) == "refilled"
    assert lane.cash == pytest.approx(100.0)
    assert lane.asset is None
    assert f.reserve == pytest.approx(100 - (100 - 69 * (1 - FEES.taker) * (1 - FEES.slippage_bps / 1e4)))
    assert f.capital_in <= LEGACY.total_risk_cap

    # Each ~$32 refill drains the reserve until it can no longer cover one.
    results = []
    while lane.status == "active":
        lane.asset = "BTC-USD"
        f.buy(lane, 50, 100.0, T0, "test")
        f.buy(lane, 50, 100.0, T0, "test")
        results.append(f.check_floor(lane, 69.0 / lane.qty, T0))
        assert f.reserve >= 0
        assert f.capital_in <= CAP.total_risk_cap
    assert results == ["refilled", "refilled", "closed"]
    assert lane.status == "closed"
    with pytest.raises(BookError):
        f.buy(lane, 10, 100.0, T0, "test")


def test_total_money_in_never_exceeds_500():
    f = fund()
    for _ in range(20):
        for lane in f.lanes:
            if lane.status != "active":
                continue
            lane.asset = lane.asset or "BTC-USD"
            lane.asset_class = "crypto"
            while lane.cash >= CAP.min_buy:
                f.buy(lane, min(CAP.max_buy, lane.cash), 100.0, T0, "test")
            if lane.qty > 0:
                f.check_floor(lane, 50.0 / lane.qty * 0.5, T0)
        assert f.capital_in <= 500 + 1e-9
        assert f.reserve >= -1e-9
    assert f.capital_in - 400 == pytest.approx(100 - f.reserve)   # refills only move money


def test_refills_still_work_when_a_reserve_is_funded():
    """The mechanism is intact; it is the reserve that is empty, not the code."""
    f = legacy_fund()
    lane = f.lanes[0]
    f.buy(lane, 50, 100.0, T0, "test")
    f.buy(lane, 50, 100.0, T0, "test")
    assert f.check_floor(lane, 69.0 / lane.qty, T0) == "refilled"


def test_roundtrip_serialization():
    f = fund()
    f.buy(f.lanes[0], 50, 100.0, T0, "test")
    f.buy(f.lanes[2], 50, 200.0, T0, "test")
    f.sell_all(f.lanes[2], 210.0, T0 + 60, "test")
    g = Fund.from_dict(f.to_dict(), CAP, FEES, SETTLE)
    assert g.to_dict() == f.to_dict()
