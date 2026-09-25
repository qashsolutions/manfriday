import numpy as np
import pandas as pd
import pytest

from highway.config import Fees, Settings
from highway.params import Params
from highway.radar import composite, measure
from highway.venues import COINBASE, CRYPTOCOM, STOCKS, half_spread_bps, set_listings, venue_for

S = Settings()


@pytest.fixture(autouse=True)
def clean_listings():
    yield
    set_listings({COINBASE: [], CRYPTOCOM: []})  # the venue map is global; do not leak into other tests


def bars(closes, volumes=None):
    idx = pd.date_range("2026-01-01", periods=len(closes), freq="D")
    v = volumes or [1_000_000] * len(closes)
    return pd.DataFrame({"open": closes, "high": [c * 1.01 for c in closes], "low": [c * 0.99 for c in closes],
                         "close": closes, "volume": v}, index=idx)


def test_strong_uptrend_fires_most_indicators():
    # a real uptrend: mostly up, with pullbacks, so it is not pinned at "overbought"
    closes, price = [], 100.0
    for i in range(60):
        price *= 0.96 if i % 5 == 3 else 1.035
        closes.append(price)
    volumes = [1_000_000] * 59 + [3_000_000]  # today on triple volume
    r = measure(bars(closes, volumes), bench_20d=0.02, news={"count": 3, "score": 0.4})
    assert r["passes"]["trend"] and r["passes"]["momentum"] and r["passes"]["breakout"]
    assert r["passes"]["volume"] and r["passes"]["strength"] and r["passes"]["news"]
    assert r["signals"] >= 6


def test_falling_asset_fires_almost_nothing():
    closes = [100 * (0.99 ** i) for i in range(60)]
    r = measure(bars(closes), bench_20d=0.02, news={})
    assert not r["passes"]["trend"] and not r["passes"]["momentum"] and not r["passes"]["breakout"]
    assert r["signals"] <= 2


def test_flat_asset_fails_the_movement_test():
    r = measure(bars([100 + (i % 2) * 0.05 for i in range(60)]), bench_20d=0.0, news={})
    assert not r["passes"]["movement"]  # too quiet for 22% a month


def test_weights_change_the_score():
    r = measure(bars([100 * (1.008 ** i) for i in range(60)]), bench_20d=0.0, news={})
    news_heavy = Params({f"radar_w_{n}": 0.0 for n in ("trend", "momentum", "strength", "volume", "breakout", "movement")} | {"radar_w_news": 2.0})
    assert composite(r, Params()) > composite(r, news_heavy)  # no news here, so a news-only score is lower


def test_venue_routing_and_spreads():
    set_listings({COINBASE: ["BTC", "SOL"], CRYPTOCOM: ["BTC"]})
    assert venue_for("BTC-USD") == CRYPTOCOM  # listed on both: cheapest wins
    assert venue_for("SOL-USD") == COINBASE  # Crypto.com does not list it
    assert venue_for("NVDA") == STOCKS
    f = Fees()
    assert half_spread_bps("BTC-USD", 80000, f) == 0.0  # crypto uses real quotes
    assert half_spread_bps("NVDA", 227.0, f) == 3.0
    assert half_spread_bps("ABAT", 2.5, f) == 40.0  # penny stocks cost far more to cross


def test_clock_finds_a_planted_pattern_and_ignores_noise():
    """A fake asset that always rises on Monday mornings should show up; random hours should not."""
    import numpy as np
    from highway.seasonality import EQUITY_WINDOWS, measure, tilt

    rng = np.random.default_rng(7)
    idx = pd.date_range("2025-01-06 09:30", periods=3000, freq="1h", tz="America/New_York")
    prices, p = [], 100.0
    for ts in idx:
        monday_open = ts.weekday() == 0 and ts.hour in (9, 10)
        p *= 1 + (0.004 if monday_open else 0) + rng.normal(0, 0.002)
        prices.append(p)
    bars = pd.DataFrame({"open": prices, "high": prices, "low": prices, "close": prices, "volume": [1] * len(prices)},
                        index=[int(ts.timestamp()) for ts in idx])
    book = measure(bars, EQUITY_WINDOWS)
    # The planted edge shows up where it was planted, not smeared across the whole weekday.
    assert book["window"]["first hour"]["strong"] and book["window"]["first hour"]["mean_bp"] > 0
    assert not book["window"]["midday"]["strong"]
    assert not book["weekday"]["Thursday"]["strong"]
    assert any(k.startswith("Monday") for k in book["weekday_window"])
    monday_morning = pd.Timestamp("2026-09-21 10:00", tz="America/New_York").timestamp()
    thursday_noon = pd.Timestamp("2026-09-24 13:00", tz="America/New_York").timestamp()
    assert tilt({"equity": book}, "NVDA", monday_morning)[0] > 0
    assert tilt({"equity": book}, "NVDA", thursday_noon)[0] <= 0
    assert tilt({}, "NVDA", monday_morning) == (0.0, "no measured pattern")
