"""Scoring the managers on skill rather than on raw return.

Raw return ranks whoever took the most risk. Three things fix that, and all of them come from
the literature rather than from taste:

* **Alpha against Hold.** Hold is the passive benchmark, so regressing a manager on it splits
  its return into the market move it merely rode (beta) and what it actually added (alpha).
* **A paired score.** Ranking managers on their standalone Sharpe needs decades of data
  (Jobson-Korkie with Memmel's correction). Scoring the daily *difference* against a common
  benchmark collapses that to weeks, because the market move the managers share cancels.
* **Contribution, not return.** Numerai pays for what a model adds beyond the consensus, so
  submitting the consensus earns nothing. The same idea here: a manager that simply tracks
  another adds no information to the league however well it does.

Small samples flatter everyone, so every figure carries its own significance: a t-statistic on
alpha, and the Probabilistic Sharpe Ratio - the chance the true Sharpe is above zero given the
observations, the skew and the fat tails.
"""

from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np

from .db import DB

BUCKET = 3600.0  # returns are bucketed hourly: finer sampling is mostly microstructure noise
PER_DAY = 24.0
_N = NormalDist()


def aligned_returns(db: DB, pids: list[str], bucket: float = BUCKET,
                    since: float = 0.0) -> tuple[list[float], dict[str, np.ndarray]]:
    """One return series per manager, on a shared clock so they can be compared like for like."""
    curves: dict[str, dict[int, float]] = {}
    for pid in pids:
        rows = db.query(
            "SELECT ts, equity FROM league_equity WHERE portfolio=? AND lane_id=0 AND ts>=? ORDER BY ts",
            (pid, since))
        marks: dict[int, float] = {}
        for r in rows:
            marks[int(r["ts"] // bucket)] = r["equity"]  # last value in each bucket wins
        curves[pid] = marks
    if not curves or not all(curves.values()):
        return [], {}
    shared = sorted(set.intersection(*(set(v) for v in curves.values())))
    if len(shared) < 3:
        return [], {}
    out = {}
    for pid, marks in curves.items():
        values = np.array([marks[b] for b in shared], dtype=float)
        out[pid] = np.diff(values) / values[:-1]
    return [b * bucket for b in shared], out


def alpha_beta(y: np.ndarray, bench: np.ndarray) -> dict:
    """Split a return into the benchmark move it rode and what it added on top."""
    if len(y) < 3 or bench.std() == 0:
        return {"beta": 1.0, "alpha": 0.0, "t": 0.0, "resid_vol": float(y.std()), "info_ratio": 0.0}
    beta, alpha = np.polyfit(bench, y, 1)
    resid = y - (beta * bench + alpha)
    # A manager that is an exact linear function of the benchmark leaves a residual of
    # floating-point dust. Whatever constant it added is still its alpha, but there is no
    # scatter left to test that alpha against, so the t-statistic is undefined rather than
    # enormous - dividing one speck by another must not look like a discovery.
    if resid.std() <= 1e-9 * max(y.std(), 1e-18):
        clean = float(alpha) if abs(alpha) > 1e-12 else 0.0
        return {"beta": float(beta), "alpha": clean, "t": 0.0, "resid_vol": 0.0, "info_ratio": 0.0}
    se = resid.std(ddof=2) / math.sqrt(len(y)) if len(y) > 2 else 0.0
    return {
        "beta": float(beta),
        "alpha": float(alpha),
        "t": float(alpha / se) if se else 0.0,
        "resid_vol": float(resid.std()),
        # information ratio: alpha earned per unit of the risk taken to earn it
        "info_ratio": float(alpha / resid.std() * math.sqrt(PER_DAY)) if resid.std() else 0.0,
    }


def probabilistic_sharpe(returns: np.ndarray, benchmark_sr: float = 0.0) -> float:
    """The chance this manager's true Sharpe beats `benchmark_sr`, given skew and fat tails.

    Bailey & Lopez de Prado. A short record with fat tails is worth far less than its raw
    Sharpe suggests, and this says by how much.
    """
    n = len(returns)
    if n < 8 or returns.std() == 0:
        return 0.5
    sr = returns.mean() / returns.std()
    m = returns - returns.mean()
    sd = returns.std()
    skew = float((m ** 3).mean() / sd ** 3)
    kurt = float((m ** 4).mean() / sd ** 4)
    denom = 1 - skew * sr + (kurt - 1) / 4 * sr ** 2
    if denom <= 0:
        return 0.5
    z = (sr - benchmark_sr) * math.sqrt(n - 1) / math.sqrt(denom)
    return float(_N.cdf(z))


def expected_max_sharpe(n_trials: int, sr_variance: float) -> float:
    """The Sharpe you expect from the best of N worthless strategies, purely by luck.

    Bailey & Lopez de Prado's threshold: anything below this is what a search of that size
    produces from noise alone.
    """
    if n_trials < 2 or sr_variance <= 0:
        return 0.0
    g = 0.5772156649  # Euler-Mascheroni
    return math.sqrt(sr_variance) * ((1 - g) * _N.inv_cdf(1 - 1 / n_trials)
                                     + g * _N.inv_cdf(1 - 1 / (n_trials * math.e)))


def deflated_sharpe(returns: np.ndarray, n_trials: int, sr_variance: float) -> float:
    """Probabilistic Sharpe measured against what a search of this size yields by luck alone.

    Pick the best of 42 strategy variants and the winner's headline Sharpe is mostly selection.
    This is the honest version of that number.
    """
    return probabilistic_sharpe(returns, expected_max_sharpe(n_trials, sr_variance))


def orthogonal_alpha(y: np.ndarray, others: list[np.ndarray]) -> dict:
    """What this manager adds beyond what the rest of the league already does.

    Numerai's Meta Model Contribution in portfolio form: neutralise a manager against the
    consensus of its rivals and see what is left. Track the consensus and this is ~0, however
    good the raw return looks - the league learns nothing from a duplicate.
    """
    if not others or len(y) < 3:
        return {"consensus_beta": 0.0, "added": 0.0, "t": 0.0}
    consensus = np.mean(np.vstack(others), axis=0)
    if consensus.std() == 0:
        return {"consensus_beta": 0.0, "added": float(y.mean()), "t": 0.0}
    beta, added = np.polyfit(consensus, y, 1)
    resid = y - (beta * consensus + added)
    se = resid.std(ddof=2) / math.sqrt(len(y)) if len(y) > 2 else 0.0
    return {"consensus_beta": float(beta), "added": float(added), "t": float(added / se) if se else 0.0}


def sharpe_contribution(returns: dict[str, np.ndarray], pid: str) -> float:
    """How much worse the league would be without this manager.

    An equal-weight blend of everyone, with and without them. A manager that duplicates another
    can be dropped and barely change it; one that moves differently is worth keeping even when
    its own return is unremarkable.
    """
    def blend_sharpe(keys: list[str]) -> float:
        if not keys:
            return 0.0
        blend = np.mean(np.vstack([returns[k] for k in keys]), axis=0)
        return float(blend.mean() / blend.std() * math.sqrt(PER_DAY)) if blend.std() else 0.0

    everyone = list(returns)
    return blend_sharpe(everyone) - blend_sharpe([k for k in everyone if k != pid])


def scoreboard(db: DB, names: dict[str, str], bench: str = "hold", since: float = 0.0) -> dict:
    """The skill table: who actually added something, and is the sample big enough to say."""
    ts, rets = aligned_returns(db, list(names), since=since)
    if not rets or bench not in rets:
        return {"rows": [], "samples": 0, "hours": 0.0, "benchmark": names.get(bench, bench)}
    rows = []
    for pid, y in rets.items():
        # The benchmark cannot have alpha against itself; regressing it on itself would
        # otherwise report a t-statistic computed on floating-point dust.
        ab = ({"beta": 1.0, "alpha": 0.0, "t": 0.0, "resid_vol": 0.0, "info_ratio": 0.0}
              if pid == bench else alpha_beta(y, rets[bench]))
        orth = orthogonal_alpha(y, [v for k, v in rets.items() if k != pid])
        rows.append({
            "id": pid, "name": names[pid], "is_benchmark": pid == bench,
            "return_pct": round(float(np.prod(1 + y) - 1) * 100, 2),
            "beta": round(ab["beta"], 2),
            "alpha_day_pct": round(ab["alpha"] * PER_DAY * 100, 3),
            "alpha_t": round(ab["t"], 2),
            "info_ratio": round(ab["info_ratio"], 2),
            "psr": round(probabilistic_sharpe(y), 3),
            "added_day_pct": round(orth["added"] * PER_DAY * 100, 3),
            "added_t": round(orth["t"], 2),
            "contribution": round(sharpe_contribution(rets, pid), 3),
            "significant": abs(ab["t"]) >= 2.0,
        })
    rows.sort(key=lambda r: (r["is_benchmark"], -r["alpha_day_pct"]))
    return {"rows": rows, "samples": len(next(iter(rets.values()))),
            "hours": round((ts[-1] - ts[0]) / 3600, 1) if ts else 0.0,
            "benchmark": names.get(bench, bench)}
