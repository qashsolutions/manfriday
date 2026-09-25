"""Weight backtest: which Scout and Momentum weightings would have picked better assets?

Every week over the past year, rank the universe using only data available on that date,
"buy" the top 4 (at most 3 of one type, no two moving together), hold for 7 days under the
lane rules (exit on a 10% drop, sell on a 15% up day, fees included), and record the result.

Weights are chosen on the first 60% of weeks and judged only on the last 40%, so a weighting
cannot win just by fitting the past. New weights are adopted only if they also win there.

Caveat: the universe is today's listed assets. Coins or stocks that were delisted are missing,
which flatters every weighting a little; the comparison between weightings is what matters.
"""

from __future__ import annotations

import itertools
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .config import DATA_DIR, Settings
from .db import DB
from .market import MarketData, asset_class
from .params import RANK_KEYS, SPECS, Params
from .scout import VOL_CAP, momentum_score

log = logging.getLogger(__name__)

HISTORY_DAYS = 400
HOLD_DAYS = 7
TOP_N = 4
ROUND_TRIP_FEE = 0.0145  # limit entry + worst-case market exit
NAMED = {
    "current": None,  # filled from live params
    "momentum-heavy": {"rank_w_vol": 0.5, "rank_w_mom30": 1.2, "rank_w_mom7": 0.6, "rank_w_dd": 0.3},
    "volatility-heavy": {"rank_w_vol": 1.5, "rank_w_mom30": 0.4, "rank_w_mom7": 0.2, "rank_w_dd": 0.2},
    "short-term": {"rank_w_vol": 0.8, "rank_w_mom30": 0.4, "rank_w_mom7": 1.2, "rank_w_dd": 0.3},
    "low-drawdown": {"rank_w_vol": 0.6, "rank_w_mom30": 0.8, "rank_w_mom7": 0.4, "rank_w_dd": 1.0},
    "30-day only": {"rank_w_vol": 0.0, "rank_w_mom30": 1.0, "rank_w_mom7": 0.0, "rank_w_dd": 0.0},
    "volatility only": {"rank_w_vol": 1.0, "rank_w_mom30": 0.0, "rank_w_mom7": 0.0, "rank_w_dd": 0.0},
    "equal": {"rank_w_vol": 1.0, "rank_w_mom30": 1.0, "rank_w_mom7": 1.0, "rank_w_dd": 1.0},
}
GRID = [0.0, 0.5, 1.0, 1.5]
MOMENTUM_W30 = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]


# ---- data ------------------------------------------------------------------------------------

def load_history(md: MarketData, s: Settings, min_crypto_volume: float = 2e6) -> dict[str, pd.DataFrame]:
    """Daily bars for a broad universe: coins with >= $2M/day today (to include faders) + all Coinbase stocks."""
    crypto = [c["asset"] for c in md.crypto_universe(min_crypto_volume)]
    universe = crypto + s.scout.equities()

    def one(asset: str):
        try:
            df = md.bars(asset, 1440, time.time() - HISTORY_DAYS * 86400)
        except Exception:
            return asset, None
        if df.empty or len(df) < 60:
            return asset, None
        df.index = pd.to_datetime(df.index, unit="s").normalize()
        df = df[~df.index.duplicated(keep="last")]
        return asset, df[["close", "volume"]]

    with ThreadPoolExecutor(max_workers=6) as pool:
        return {a: df for a, df in pool.map(one, universe) if df is not None}


def features_at(hist: dict[str, pd.DataFrame], date: pd.Timestamp, s: Settings) -> pd.DataFrame:
    """The same features the Scout uses, computed only from bars up to `date`."""
    rows = []
    for a, df in hist.items():
        past = df[df.index <= date]
        if len(past) < 46:
            continue
        close = past["close"]
        cls = asset_class(a)
        dollar_vol = float((close * past["volume"]).iloc[-20:].mean())
        if dollar_vol < (s.scout.min_crypto_volume_usd if cls == "crypto" else s.scout.min_equity_dollar_volume):
            continue
        r = np.log(close).diff().dropna()
        vol = float(r.iloc[-30:].std() * math.sqrt(30 if cls == "crypto" else 21))
        if vol < s.scout.min_monthly_vol or not np.isfinite(vol):
            continue
        last30 = close.iloc[-31:]
        rows.append({
            "asset": a, "class": cls, "monthly_vol": vol,
            "mom30": float(close.iloc[-1] / close.iloc[-31] - 1),
            "mom7": float(close.iloc[-1] / close.iloc[-8] - 1),
            "dd30": float((1 - last30 / last30.cummax()).max()),
            "above_sma20": bool(close.iloc[-1] > close.iloc[-20:].mean()),
        })
    return pd.DataFrame(rows)


class Week:
    """Everything needed to score any weighting on one rebalance date, computed once."""

    def __init__(self, hist, date: pd.Timestamp, feats: pd.DataFrame):
        self.date, self.feats, self.hist = date, feats, hist
        self.fwd = {a: forward(hist, a, date) for a in feats["asset"]} if not feats.empty else {}
        vals = [v for v in self.fwd.values() if v is not None]
        self.universe = sum(vals) / len(vals) if vals else None
        self._rets: dict[str, pd.Series] = {}
        self._corr: dict[tuple[str, str], float] = {}

    def corr(self, a: str, b: str) -> float:
        key = (a, b) if a < b else (b, a)
        if key not in self._corr:
            ra, rb = (self._rets.setdefault(x, self.hist[x][self.hist[x].index <= self.date]["close"].pct_change().iloc[-45:]) for x in key)
            joined = pd.concat([ra, rb], axis=1, join="inner").dropna()
            self._corr[key] = float(joined.corr().iloc[0, 1]) if len(joined) > 10 else 0.0
        return self._corr[key]


def pick(order: list[str], week: Week, s: Settings) -> list[str]:
    chosen: list[str] = []
    for a in order:
        if len(chosen) >= TOP_N:
            break
        if sum(1 for c in chosen if asset_class(c) == asset_class(a)) >= s.scout.max_per_class:
            continue
        if any(abs(week.corr(a, c)) > s.scout.max_correlation for c in chosen):
            continue
        chosen.append(a)
    return chosen


def forward(hist, asset: str, date: pd.Timestamp) -> float | None:
    """7-day result of holding one asset under the lane rules, after fees."""
    df = hist[asset]
    # 7 calendar days for everyone (stocks simply have fewer bars: no weekend trading)
    path = df[(df.index > date) & (df.index <= date + pd.Timedelta(days=HOLD_DAYS))]["close"]
    entry = df[df.index <= date]["close"]
    if len(path) < 4 or entry.empty or date + pd.Timedelta(days=HOLD_DAYS) > df.index.max():
        return None
    entry = float(entry.iloc[-1])
    prev = entry
    for px in path:
        if px <= entry * 0.90:  # day stop: out at the close that breached it
            return px / entry - 1 - ROUND_TRIP_FEE
        if px > prev * 1.15:  # +15% day: sold
            return px / entry - 1 - ROUND_TRIP_FEE
        prev = px
    return float(path.iloc[-1]) / entry - 1 - ROUND_TRIP_FEE


# ---- evaluation --------------------------------------------------------------------------

def _stats(weekly: list[float]) -> dict:
    if not weekly:
        return {"weeks": 0}
    curve, peak, dd = 1.0, 1.0, 0.0
    for w in weekly:
        curve *= 1 + w
        peak = max(peak, curve)
        dd = max(dd, 1 - curve / peak)
    days = len(weekly) * HOLD_DAYS
    monthly = (curve ** (30 / days) - 1) * 100
    return {
        "weeks": len(weekly),
        "total_pct": round((curve - 1) * 100, 1),
        "monthly_pct": round(monthly, 2),
        "max_dd_pct": round(dd * 100, 1),
        "positive_weeks": round(sum(1 for w in weekly if w > 0) / len(weekly), 2),
        "worst_week_pct": round(min(weekly) * 100, 1),
        "score": round(monthly - 0.25 * dd * 100, 2),
    }


def evaluate(weeks: list[Week], s: Settings, order_fn) -> tuple[list[float], list[float]]:
    """Weekly portfolio returns for one ranking rule, plus the universe average each week."""
    port, universe = [], []
    for wk in weeks:
        if wk.feats.empty or wk.universe is None:
            continue
        chosen = pick(order_fn(wk.feats), wk, s)
        results = [wk.fwd[a] for a in chosen if wk.fwd.get(a) is not None]
        if results:
            port.append(sum(results) / len(results))
            universe.append(wk.universe)
    return port, universe


def rank_order(w: dict):
    def fn(feats: pd.DataFrame) -> list[str]:
        z = lambda c: (c - c.mean()) / (c.std() or 1)  # noqa: E731
        score = (w["rank_w_vol"] * z(feats["monthly_vol"].clip(upper=VOL_CAP)) + w["rank_w_mom30"] * z(feats["mom30"])
                 + w["rank_w_mom7"] * z(feats["mom7"]) - w["rank_w_dd"] * z(feats["dd30"]))
        return list(feats.assign(score=score).sort_values("score", ascending=False)["asset"])
    return fn


def momentum_order(w30: float):
    def fn(feats: pd.DataFrame) -> list[str]:
        movers = feats[(feats["above_sma20"]) & (feats["mom7"] > 0)]
        score = movers.apply(lambda r: momentum_score(r["mom30"], r["mom7"], w30), axis=1) if len(movers) else pd.Series(dtype=float)
        return list(movers.assign(score=score).sort_values("score", ascending=False)["asset"]) if len(movers) else []
    return fn


def run(md: MarketData, s: Settings, db: DB, params: Params) -> dict:
    started = time.time()
    hist = load_history(md, s)
    last = max(df.index.max() for df in hist.values())
    dates = pd.date_range(last - pd.Timedelta(days=HISTORY_DAYS - 60), last - pd.Timedelta(days=HOLD_DAYS), freq="7D")
    weeks = [Week(hist, d, features_at(hist, d, s)) for d in dates]
    split = int(len(dates) * 0.6)
    train, test = weeks[:split], weeks[split:]

    current = {k: params[k] for k in RANK_KEYS}
    named = {**NAMED, "current": current}
    results = []

    def assess(name, w, kind="rank"):
        order = rank_order(w) if kind == "rank" else momentum_order(w)
        tr, tr_u = evaluate(train, s, order)
        te, te_u = evaluate(test, s, order)
        beat = [p > u for p, u in zip(te, te_u)]
        return {"name": name, "weights": w, "train": _stats(tr), "test": _stats(te),
                "test_beats_universe": round(sum(beat) / len(beat), 2) if beat else None,
                "universe_test": _stats(te_u)}

    for name, w in named.items():
        results.append(assess(name, w))
    grid = []
    for combo in itertools.product(GRID, GRID, GRID, GRID):
        w = dict(zip(RANK_KEYS, combo))
        if not any(combo[:3]):
            continue
        tr, _ = evaluate(train, s, rank_order(w))
        grid.append((_stats(tr).get("score", -1e9), w))
    grid.sort(key=lambda g: -g[0])
    # Consensus of the 10 best training weightings: steadier than the single best (less luck).
    top = [w for _, w in grid[:10]]
    consensus = {k: round(sum(w[k] for w in top) / len(top), 2) for k in RANK_KEYS}
    results.append(assess("grid consensus (top 10 in training)", consensus))
    results.append(assess("grid best in training", grid[0][1]))
    momentum = [assess(f"momentum 30-day weight {w30:.1f}", w30, "momentum") for w30 in MOMENTUM_W30]

    rec = recommend(results, momentum, params)
    report = {
        "ts": time.time(), "seconds": round(time.time() - started), "assets": len(hist),
        "weeks": {"train": len(train), "test": len(test)},
        "period": {"from": str(dates[0].date()), "to": str((dates[-1] + pd.Timedelta(days=HOLD_DAYS)).date()),
                   "test_from": str(dates[split].date()) if split < len(dates) else None},
        "rank": results, "momentum": momentum, "recommendation": rec,
    }
    db.set_state("weight_backtest", report)
    _write(report)
    return report


def recommend(results: list[dict], momentum: list[dict], params: Params, margin: float = 2.0) -> dict:
    """Adopt a new weighting only if it beats the current one in BOTH training and test weeks."""
    cur = next(r for r in results if r["name"] == "current")
    best = None
    for r in results:
        if r["name"] == "current" or r["test"].get("weeks", 0) < 4:
            continue
        if r["test"]["score"] >= cur["test"]["score"] + margin and r["train"]["score"] >= cur["train"]["score"]:
            if best is None or r["test"]["score"] > best["test"]["score"]:
                best = r
    changes = []
    if best:
        for k in RANK_KEYS:
            if abs(best["weights"][k] - params[k]) > 1e-9:
                changes.append({"key": k, "value": float(best["weights"][k]),
                                "reason": f"weight backtest: '{best['name']}' scored {best['test']['score']:+.1f} vs current {cur['test']['score']:+.1f} on unseen weeks"})
    cur_m = min(momentum, key=lambda m: abs(m["weights"] - params["momentum_w30"]))
    best_m = max(momentum, key=lambda m: (m["train"].get("score", -1e9)))
    if (best_m is not cur_m and best_m["test"].get("score", -1e9) >= cur_m["test"].get("score", -1e9) + margin):
        changes.append({"key": "momentum_w30", "value": float(best_m["weights"]),
                        "reason": f"weight backtest: {best_m['weights']:.1f} scored {best_m['test']['score']:+.1f} vs {cur_m['test']['score']:+.1f} on unseen weeks"})
    for c in changes:
        c["value"] = max(SPECS[c["key"]].lo, min(SPECS[c["key"]].hi, c["value"]))
    return {"adopt": best["name"] if best else None, "changes": changes,
            "why": ("clearly better on unseen weeks and not worse in training" if best
                    else f"no weighting beat the current one by {margin}+ points on unseen weeks while also holding up in training")}


def _write(report: dict) -> None:
    out = DATA_DIR / "reports"
    out.mkdir(parents=True, exist_ok=True)
    lines = [f"# Weight backtest · {datetime.fromtimestamp(report['ts'], timezone.utc):%Y-%m-%d}",
             f"{report['assets']} assets · weekly picks {report['period']['from']} to {report['period']['to']} · "
             f"training {report['weeks']['train']} weeks, unseen test {report['weeks']['test']} weeks (from {report['period']['test_from']})", "",
             "| Rank weighting | vol / 30d / 7d / drop | Training score | Test score | Test monthly | Test max drop | Beat the average asset |",
             "|---|---|---|---|---|---|---|"]
    for r in report["rank"]:
        w = r["weights"]
        lines.append(f"| {r['name']} | {w['rank_w_vol']:g} / {w['rank_w_mom30']:g} / {w['rank_w_mom7']:g} / {w['rank_w_dd']:g} | "
                     f"{r['train'].get('score', '-')} | {r['test'].get('score', '-')} | {r['test'].get('monthly_pct', '-')}% | "
                     f"{r['test'].get('max_dd_pct', '-')}% | {r['test_beats_universe']} |")
    lines += ["", "| Momentum 30-day weight | Training score | Test score | Test monthly |", "|---|---|---|---|"]
    for m in report["momentum"]:
        lines.append(f"| {m['weights']:.1f} | {m['train'].get('score', '-')} | {m['test'].get('score', '-')} | {m['test'].get('monthly_pct', '-')}% |")
    rec = report["recommendation"]
    lines += ["", f"**Recommendation:** {rec['adopt'] or 'keep current weights'} ({rec['why']})"]
    lines += [f"- `{c['key']}` -> {c['value']:g}: {c['reason']}" for c in rec["changes"]]
    (out / f"weights-{datetime.fromtimestamp(report['ts'], timezone.utc):%Y%m%d}.md").write_text("\n".join(lines) + "\n")
