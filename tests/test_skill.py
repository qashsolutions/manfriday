"""Scoring managers on skill rather than on who took the most risk."""

import numpy as np
import pytest

from highway.skill import (alpha_beta, deflated_sharpe, expected_max_sharpe,
                           orthogonal_alpha, probabilistic_sharpe, sharpe_contribution)

rng = np.random.default_rng(11)
MARKET = rng.normal(0.0, 0.01, 600)


# ---- alpha and beta ----------------------------------------------------------------------

def test_a_manager_that_only_took_more_risk_shows_beta_not_alpha():
    """Twice the market is not skill, and the score must not call it skill."""
    r = alpha_beta(2.0 * MARKET, MARKET)
    assert r["beta"] == pytest.approx(2.0)
    assert abs(r["alpha"]) < 1e-9
    assert abs(r["t"]) < 2.0


def test_a_manager_adding_a_steady_edge_shows_alpha():
    """A real edge comes with its own scatter, and over 600 samples it should be visible."""
    r = alpha_beta(MARKET + 0.002 + rng.normal(0, 0.002, 600), MARKET)
    assert r["alpha"] > 0.0019
    assert r["t"] > 2.0
    assert r["beta"] == pytest.approx(1.0, abs=0.05)


def test_a_noiseless_edge_keeps_its_alpha_but_claims_no_significance():
    """Degenerate, but the alpha must survive the dust guard rather than be zeroed."""
    r = alpha_beta(MARKET + 0.002, MARKET)
    assert r["alpha"] == pytest.approx(0.002)
    assert r["t"] == 0.0


def test_tracking_the_benchmark_exactly_is_neither_good_nor_bad():
    r = alpha_beta(MARKET, MARKET)
    assert abs(r["alpha"]) < 1e-9 and abs(r["beta"] - 1) < 1e-9


# ---- contribution beyond the consensus ---------------------------------------------------

def test_copying_the_others_adds_nothing():
    """The Numerai point: submitting the consensus scores zero, however good it looks."""
    others = [MARKET + 0.001, MARKET + 0.001, MARKET + 0.001]
    r = orthogonal_alpha(np.mean(np.vstack(others), axis=0), others)
    assert abs(r["added"]) < 1e-9
    assert abs(r["consensus_beta"] - 1) < 1e-6


def test_something_the_others_do_not_have_is_credited():
    own = rng.normal(0.0015, 0.01, 600)      # its own edge, unrelated to the rest
    r = orthogonal_alpha(own, [MARKET, MARKET * 1.1, MARKET * 0.9])
    assert r["added"] > 0.001
    assert r["t"] > 2.0


def test_a_duplicate_manager_barely_changes_the_league():
    base = {"a": MARKET + 0.001, "b": MARKET + 0.001, "c": MARKET + 0.001}
    base["dup"] = base["a"].copy()
    assert abs(sharpe_contribution(base, "dup")) < 0.05


def test_a_differently_moving_manager_is_worth_keeping():
    different = rng.normal(0.001, 0.01, 600)  # same edge, uncorrelated path
    mix = {"a": MARKET + 0.001, "b": MARKET + 0.001, "c": MARKET + 0.001, "odd": different}
    assert sharpe_contribution(mix, "odd") > sharpe_contribution(mix, "a")


# ---- honesty about small samples ---------------------------------------------------------

def test_a_short_record_is_not_taken_at_face_value():
    good = rng.normal(0.002, 0.01, 10)
    assert probabilistic_sharpe(good) < 0.99      # 10 observations prove very little
    assert probabilistic_sharpe(np.array([0.01, 0.01])) == 0.5   # too few to say anything


def test_searching_harder_raises_the_bar():
    """Best of 42 beats best of 2 by luck alone, so the threshold has to move."""
    assert expected_max_sharpe(42, 0.5) > expected_max_sharpe(2, 0.5) > 0
    assert expected_max_sharpe(1, 0.5) == 0.0


def test_a_winner_picked_from_many_is_deflated_the_hardest():
    picked = rng.normal(0.0015, 0.01, 400)
    assert deflated_sharpe(picked, 2, 0.5) > deflated_sharpe(picked, 42, 0.5)


def test_deflation_can_wipe_out_a_lucky_winner():
    lucky = rng.normal(0.0004, 0.01, 200)         # a thin edge found by searching hard
    assert probabilistic_sharpe(lucky) > deflated_sharpe(lucky, 42, 0.5)


def test_a_perfect_tracker_reports_no_alpha_rather_than_a_huge_t_statistic():
    """A pure multiple of the benchmark leaves only floating-point dust behind; dividing one
    speck by another must not look like a discovery."""
    for multiple in (1.0, 2.0, 0.5, -1.0):
        r = alpha_beta(multiple * MARKET, MARKET)
        assert r["alpha"] == 0.0
        assert r["t"] == 0.0
        assert r["beta"] == pytest.approx(multiple)
