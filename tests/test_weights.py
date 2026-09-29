import pandas as pd
import pytest

from highway.config import Settings
from highway.weights import ROUND_TRIP_FEE, Week, forward, pick

S = Settings()
STOP = S.rules.stop_loss_day_pct     # negative
TAKE = S.rules.take_profit_day_pct
GIVE = S.rules.giveback_pct


def frame(prices):
    idx = pd.date_range("2026-01-01", periods=len(prices), freq="D")
    return pd.DataFrame({"close": prices, "volume": [1e9] * len(prices)}, index=idx)


def test_forward_applies_the_day_stop_and_fees():
    """Thresholds are derived from settings, never written in: these used to be hardcoded at
    the original -10/+15 and silently kept testing them after the Sept 24 retune."""
    breach = 100 * (1 + STOP / 100) - 1          # just past the stop
    near = 100 * (1 + STOP / 200)                # half way there: must NOT trigger
    hist = {"X-USD": frame([100] * 50 + [near, breach, 120, 120, 120, 120, 120])}
    r = forward(hist, "X-USD", hist["X-USD"].index[49], S)
    # out at the close that breached it, not the rally afterwards
    assert r == pytest.approx(breach / 100 - 1 - ROUND_TRIP_FEE)


def test_forward_sells_on_an_up_day():
    up = 101 * (1 + TAKE / 100) + 1
    hist = {"X-USD": frame([100] * 50 + [101, up, 90, 90, 90, 90, 90])}
    r = forward(hist, "X-USD", hist["X-USD"].index[49], S)
    assert r == pytest.approx(up / 100 - 1 - ROUND_TRIP_FEE)


def test_forward_applies_the_giveback_stop():
    """A climb, then a slide off the high that never breaks the day stop, still has to exit.

    The give-back can only be the rule that fires if the position first rises far enough that
    the give-back level sits above the day stop - with a 20% give-back and a -7% stop that
    needs roughly +17%. Below that the day stop always gets there first, which is correct.
    """
    climb = [105.0, 110.0, 115.0, 120.0]
    peak = climb[-1]
    slid = peak * (1 - GIVE / 100)
    if slid <= 100 * (1 + STOP / 100):
        pytest.skip(f"a {GIVE:.0f}% give-back off +20% falls through the {STOP:.0f}% day stop")
    assert all(climb[i] <= climb[i - 1] * (1 + TAKE / 100) for i in range(1, len(climb))), \
        "the climb must not itself trigger the up-day rule"
    hist = {"X-USD": frame([100] * 50 + climb + [slid, slid, slid])}
    r = forward(hist, "X-USD", hist["X-USD"].index[49], S)
    assert r == pytest.approx(slid / 100 - 1 - ROUND_TRIP_FEE)


def test_forward_holds_to_the_end_when_no_rule_fires():
    hist = {"X-USD": frame([100] * 50 + [100, 101, 100, 101, 100, 101, 102])}
    r = forward(hist, "X-USD", hist["X-USD"].index[49], S)
    assert r == pytest.approx(1.02 - 1 - ROUND_TRIP_FEE)


def test_pick_respects_type_cap_and_correlation():
    base = [100 + (i % 7) * 3 + i * 0.1 for i in range(60)]
    hist = {
        "A-USD": frame(base), "B-USD": frame(base),  # identical moves: correlation 1.0
        "C-USD": frame(list(reversed(base))), "D-USD": frame([100 + ((i * 7) % 11) for i in range(60)]),
        "E-USD": frame([100 + ((i * 5) % 13) for i in range(60)]),
    }
    feats = pd.DataFrame({"asset": list(hist)})
    wk = Week(hist, hist["A-USD"].index[-8], feats, S)
    chosen = pick(["A-USD", "B-USD", "C-USD", "D-USD", "E-USD"], wk, S)
    assert "B-USD" not in chosen  # moves with A
    assert sum(1 for c in chosen if c.endswith("-USD")) <= S.scout.max_per_class
