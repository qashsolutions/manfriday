"""The ETF sleeve: lane 5 is four funds of $25, one per theme."""

from types import SimpleNamespace

from highway.brains import sleeve_targets
from highway.scout import pick_sleeve
from highway.universe import (ETF_LANE_THEMES, ETF_THEMES, etf_lane_eligible,
                              etf_theme, is_etf)


def _pf(sleeve_assets: dict[int, str | None] | None = None, sleeve: int = 4):
    lanes = [SimpleNamespace(lane_id=i, asset=None, status="active", kind="main") for i in range(1, 5)]
    lanes += [SimpleNamespace(lane_id=4 + i, asset=(sleeve_assets or {}).get(4 + i), status="active", kind="etf")
              for i in range(1, sleeve + 1)]
    return SimpleNamespace(fund=SimpleNamespace(lanes=lanes))


def _cand(asset, score, ok=True):
    return {"asset": asset, "score": score, "etf_lane_ok": ok, "theme": etf_theme(asset)}


# ---- the fund list -----------------------------------------------------------------------

def test_the_owners_themes_are_all_covered():
    assert is_etf("GLD") and is_etf("VOO")          # gold and broad market
    assert is_etf("SMH") and is_etf("SOXX")         # semiconductors
    assert is_etf("COPX") and is_etf("CPER")        # copper, for the data-centre build-out
    assert etf_theme("COPX") == "data-centre metals"
    assert etf_theme("GLD") == "gold & silver"


def test_single_names_and_coins_are_not_funds():
    for not_a_fund in ("NVDA", "MSTR", "BTC-USD", "NEAR-USD", "", "ZZZZ"):
        assert not is_etf(not_a_fund)


def test_leveraged_and_crypto_funds_are_funds_but_never_enter_the_sleeve():
    """Ranking rewards movement, so these would fill the sleeve and defeat its purpose."""
    for loophole in ("SOXL", "MSTU", "BITX", "ETHU", "ETHA", "IBIT", "FBTC"):
        assert is_etf(loophole), loophole
        assert not etf_lane_eligible(loophole), loophole


def test_the_named_funds_are_sleeve_eligible():
    for wanted in ("GLD", "VOO", "SMH", "SOXX", "COPX", "CPER", "URA", "XME"):
        assert etf_lane_eligible(wanted), wanted


def test_every_theme_has_at_least_three_funds():
    for theme, syms in ETF_THEMES.items():
        assert len(syms) >= 3, theme


def test_no_fund_is_in_two_sleeve_themes():
    seen = set()
    for syms in ETF_LANE_THEMES.values():
        for sym in syms:
            assert sym not in seen, f"{sym} appears twice"
            seen.add(sym)


# ---- choosing the four -------------------------------------------------------------------

def test_the_sleeve_takes_one_fund_per_theme():
    """Four semiconductor funds would be one bet wearing four hats."""
    got = pick_sleeve([_cand("SOXX", 9), _cand("SMH", 8), _cand("XSD", 7),   # all semiconductors
                       _cand("GLD", 6), _cand("COPX", 5), _cand("VOO", 4)], slots=4)
    assert got == ["SOXX", "GLD", "COPX", "VOO"]
    assert len({etf_theme(a) for a in got}) == 4


def test_the_sleeve_takes_the_best_scoring_fund_of_each_theme():
    got = pick_sleeve([_cand("SMH", 3), _cand("SOXX", 9)], slots=4)
    assert got == ["SOXX"]


def test_funds_that_failed_their_backtest_are_skipped():
    assert pick_sleeve([_cand("GLD", 0), _cand("COPX", -2), _cand("VOO", 1)], slots=4) == ["VOO"]


def test_leveraged_funds_cannot_reach_the_sleeve():
    assert pick_sleeve([_cand("MSTU", 99, ok=False), _cand("ETHA", 90, ok=False), _cand("GLD", 1)], slots=4) == ["GLD"]


def test_a_short_sleeve_is_better_than_doubling_up():
    assert pick_sleeve([_cand("SMH", 9), _cand("SOXX", 8)], slots=4) == ["SMH"]


def test_the_sleeve_never_exceeds_its_slots():
    cands = [_cand(a, 10 - i) for i, a in enumerate(["GLD", "VOO", "SMH", "COPX", "URA", "XLE"])]
    assert len(pick_sleeve(cands, slots=4)) == 4


# ---- filling the lanes -------------------------------------------------------------------

def test_each_sleeve_lane_gets_one_fund_and_one_clip():
    out = sleeve_targets(_pf(), ["GLD", "VOO", "SMH", "COPX"])
    assert sorted(out) == [5, 6, 7, 8]                  # the four sleeve lanes, never 1-4
    assert [out[i].asset for i in (5, 6, 7, 8)] == ["GLD", "VOO", "SMH", "COPX"]
    assert all(t.clips == 1 for t in out.values())      # one $25 clip fills a sleeve lane
    assert "gold" in out[5].reason


def test_the_sleeve_never_touches_the_four_contested_lanes():
    out = sleeve_targets(_pf(), ["GLD", "VOO", "SMH", "COPX"])
    assert not {1, 2, 3, 4} & set(out)


def test_a_short_sleeve_leaves_the_spare_lanes_alone():
    out = sleeve_targets(_pf(), ["GLD", "VOO"])
    assert sorted(out) == [5, 6]


def test_no_picks_means_no_targets():
    assert sleeve_targets(_pf(), []) == {}


# ---- mandates: each manager gets its own slice of the market ------------------------------

def test_a_venue_pinned_mandate_is_not_emptied_by_unloaded_listings():
    """An empty listing set means "not loaded yet", not "lists nothing". Treating those the
    same left the Coinbase manager with a mandate of zero assets on a cold start."""
    from highway.mandate import MANDATES, allows
    m = MANDATES["coinbase"]
    assert allows(m, "BTC-USD", set(), None)          # listings not passed at all
    assert allows(m, "BTC-USD", set(), {})            # listings empty
    assert allows(m, "BTC-USD", set(), {"coinbase": set()})   # that venue not loaded
    assert allows(m, "BTC-USD", set(), {"coinbase": {"BTC"}})
    assert not allows(m, "ZEC-USD", set(), {"coinbase": {"BTC"}})   # loaded and genuinely absent


def test_mandates_keep_managers_out_of_each_others_markets():
    from highway.mandate import MANDATES, allows
    chips = {"NVDA", "META"}
    assert allows(MANDATES["bluechip"], "NVDA", chips, None)
    assert not allows(MANDATES["bluechip"], "BTC-USD", chips, None)
    assert not allows(MANDATES["bluechip"], "GLD", chips, None)
    assert allows(MANDATES["etf"], "GLD", chips, None)
    assert not allows(MANDATES["etf"], "NVDA", chips, None)
    assert allows(MANDATES["laser"], "BTC-USD", chips, None)   # the generalist may hold anything
    assert allows(MANDATES["laser"], "NVDA", chips, None)
