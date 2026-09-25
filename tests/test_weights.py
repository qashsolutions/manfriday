import pandas as pd
import pytest

from highway.config import Settings
from highway.weights import Week, forward, pick

S = Settings()


def frame(prices):
    idx = pd.date_range("2026-01-01", periods=len(prices), freq="D")
    return pd.DataFrame({"close": prices, "volume": [1e9] * len(prices)}, index=idx)


def test_forward_applies_the_10pct_stop_and_fees():
    hist = {"X-USD": frame([100] * 50 + [95, 88, 120, 120, 120, 120, 120])}
    r = forward(hist, "X-USD", hist["X-USD"].index[49])
    assert r == pytest.approx(0.88 - 1 - 0.0145)  # out at the close that breached -10%, not the later rally


def test_forward_sells_on_a_15pct_up_day():
    hist = {"X-USD": frame([100] * 50 + [101, 118, 90, 90, 90, 90, 90])}
    r = forward(hist, "X-USD", hist["X-USD"].index[49])
    assert r == pytest.approx(0.18 - 0.0145)


def test_pick_respects_type_cap_and_correlation():
    base = [100 + (i % 7) * 3 + i * 0.1 for i in range(60)]
    hist = {
        "A-USD": frame(base), "B-USD": frame(base),  # identical moves: correlation 1.0
        "C-USD": frame(list(reversed(base))), "D-USD": frame([100 + ((i * 7) % 11) for i in range(60)]),
        "E-USD": frame([100 + ((i * 5) % 13) for i in range(60)]),
    }
    feats = pd.DataFrame({"asset": list(hist)})
    wk = Week(hist, hist["A-USD"].index[-8], feats)
    chosen = pick(["A-USD", "B-USD", "C-USD", "D-USD", "E-USD"], wk, S)
    assert "B-USD" not in chosen  # moves with A
    assert sum(1 for c in chosen if c.endswith("-USD")) <= S.scout.max_per_class
