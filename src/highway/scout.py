"""Scout: picks the four lanes and the live watchlist ("bench").

No fixed slots. Every coin and every stock/ETF competes on the same terms:
1. Scan the top coins by Coinbase volume plus every stock/ETF Coinbase lists, keeping only
   liquid assets that move enough to make 22% a month possible.
2. Rank them cheaply on daily bars (movement, momentum, drawdown).
3. Walk-forward backtest the shortlist, fees included. An asset qualifies only if one of its
   strategies made money on data it was not tuned on; that out-of-sample score is its edge.
4. Once lanes and bench assets have a few days of live paper results, blend those in.
5. Take the best four under a correlation limit and a per-class cap. The next best become
   the bench, tracked live on paper so a lane can hand over its slot to one that is working.
"""

from __future__ import annotations

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from . import backtest
from .config import Settings
from .db import DB
from .market import MarketData, asset_class
from .mandate import kind_of
from .universe import etf_lane_eligible, etf_theme, is_etf
from .params import Params
from .sim import recent_score

log = logging.getLogger(__name__)

CLASS_LABEL = {"crypto": "crypto", "equity": "stock/ETF"}


def _daily(md: MarketData, asset: str, days: int = 75) -> pd.DataFrame:
    df = md.bars(asset, 1440, time.time() - days * 86400)
    if df.empty:
        return df
    df.index = pd.to_datetime(df.index, unit="s").normalize()
    return df[~df.index.duplicated(keep="last")]


def _metrics(md: MarketData, asset: str, crypto_volume: dict[str, float]) -> tuple[dict, pd.Series] | None:
    try:
        df = _daily(md, asset)
    except Exception as e:
        log.info("scout: no daily data for %s: %s", asset, e)
        return None
    if len(df) < 35:
        return None
    close = df["close"]
    r = np.log(close).diff().dropna()
    last30 = close.iloc[-31:]
    cls = asset_class(asset)
    dollar_volume = crypto_volume.get(asset) if cls == "crypto" else float((df["close"] * df["volume"]).iloc[-20:].mean())
    return {
        "asset": asset,
        "class": cls,
        "monthly_vol": float(r.iloc[-30:].std() * math.sqrt(30 if cls == "crypto" else 21)),
        "mom30": float(close.iloc[-1] / close.iloc[-31] - 1),
        "mom7": float(close.iloc[-1] / close.iloc[-8] - 1),
        "dd30": float((1 - last30 / last30.cummax()).max()),
        "dollar_volume": dollar_volume or 0.0,
        "price": float(close.iloc[-1]),
        "above_sma20": bool(close.iloc[-1] > close.iloc[-20:].mean()),
    }, close.pct_change()


DEFAULT_WEIGHTS = {"rank_w_vol": 1.0, "rank_w_mom30": 0.8, "rank_w_mom7": 0.4, "rank_w_dd": 0.3}
VOL_CAP = 0.9  # monthly volatility above this counts no extra, so lottery tickets don't win


def rank_scores(frame: pd.DataFrame, w: dict[str, float]) -> pd.Series:
    """The Scout's weighted rank. Shared with the weight backtest so both use the same formula."""

    def z(col: pd.Series) -> pd.Series:
        return (col - col.mean()) / (col.std() or 1)

    return (
        w["rank_w_vol"] * z(frame["monthly_vol"].clip(upper=VOL_CAP))
        + w["rank_w_mom30"] * z(frame["mom30"])
        + w["rank_w_mom7"] * z(frame["mom7"])
        - w["rank_w_dd"] * z(frame["dd30"])
    )


def momentum_score(mom30: float, mom7: float, w30: float) -> float:
    return w30 * mom30 + (1 - w30) * mom7


def rank(md: MarketData, s: Settings, params: Params | None = None,
         bluechips: set[str] | None = None) -> tuple[list[dict], dict[str, pd.Series]]:
    """Score the whole market once. Every mandate then filters this same ranking."""
    sc = s.scout
    bluechips = bluechips or set()
    crypto = sorted(md.crypto_universe(sc.min_crypto_volume_usd), key=lambda x: -x["volume_usd"])[: sc.crypto_candidates]
    rank.names = {c["asset"]: c.get("name") for c in crypto}
    volume = {c["asset"]: c["volume_usd"] for c in crypto}
    universe = [c["asset"] for c in crypto] + sc.equities()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda a: _metrics(md, a, volume), universe))
    rows, returns = [], {}
    for res in results:
        if not res:
            continue
        m, rets = res
        # Each slice of the market is measured against its own floors. One 10% volatility bar
        # for everything would exclude 11 of the 15 largest US companies and almost every fund,
        # which is how the league ended up with four managers chasing the same few coins.
        kind = kind_of(m["asset"], bluechips)
        vol_floor, cash_floor = {
            "etf": (sc.etf_min_monthly_vol, sc.etf_min_dollar_volume),
            "bluechip": (sc.bluechip_min_monthly_vol, sc.bluechip_min_dollar_volume),
        }.get(kind, (sc.min_monthly_vol, sc.min_equity_dollar_volume))
        if m["monthly_vol"] < vol_floor:
            continue
        if m["class"] == "equity" and m["dollar_volume"] < cash_floor:
            continue
        m["kind"] = kind
        rows.append(m)
        returns[m["asset"]] = rets
    if not rows:
        return [], returns
    frame = pd.DataFrame(rows)
    weights = {k: params[k] for k in DEFAULT_WEIGHTS} if params else DEFAULT_WEIGHTS
    frame["rank_score"] = rank_scores(frame, weights)
    ranked = frame.sort_values("rank_score", ascending=False).round(4).to_dict("records")
    rank.scanned = len(universe)
    return ranked, returns


def correlation(returns: dict[str, pd.Series], a: str, b: str) -> float:
    if a not in returns or b not in returns:
        return 0.0
    joined = pd.concat([returns[a], returns[b]], axis=1, join="inner").dropna().iloc[-45:]
    return float(joined.corr().iloc[0, 1]) if len(joined) > 10 else 0.0


def survivors(md: MarketData, s: Settings, db: DB, params: Params, asset: str) -> list[dict]:
    """Walk-forward results for an asset (cached for 1 day)."""
    cached = backtest.latest(db, asset, max_age_days=1)
    if cached:
        return cached
    try:
        df = backtest.load_history(md, s, asset)
    except Exception as e:
        log.info("scout: no history for %s: %s", asset, e)
        return []
    if len(df) < 500:
        return []
    results = backtest.walk_forward(df, s, params, asset)
    backtest.save(db, results)
    return backtest.latest(db, asset, max_age_days=1)


def edge(bts: list[dict]) -> tuple[float | None, str | None]:
    """Recent out-of-sample score of the best strategy that passed, or None if none did."""
    passing = [(recent_score(b["test"]), f"{b['strategy']}") for b in bts if b["survived"]]
    return max(passing) if passing else (None, None)


def blended(edge_score: float, live: dict | None, live_weight: float = 0.5) -> float:
    """Backtest edge, blended with live paper results once there are 2+ days of them."""
    if live and live.get("days", 0) >= 2 and live.get("score") is not None:
        return (1 - live_weight) * edge_score + live_weight * live["score"]
    return edge_score


def assign_lanes(chosen: list[str], current: dict[int, str | None], pinned: dict[int, str], n_lanes: int) -> dict[int, str]:
    """Map chosen assets to lanes, moving as few lanes as possible."""
    result = dict(pinned)
    remaining = [a for a in chosen if a not in result.values()]
    for lane_id, asset in sorted(current.items()):
        if lane_id not in result and asset in remaining:
            result[lane_id] = asset
            remaining.remove(asset)
    free = [i for i in range(1, n_lanes + 1) if i not in result]
    for lane_id, asset in zip(free, remaining):
        result[lane_id] = asset
    return result


def _save_aliases(md: MarketData, db: DB, assets: list[str]) -> None:
    """Remember each asset's real name so the news desk can find stories about it."""
    aliases = db.get_state("aliases", {})
    names = getattr(rank, "names", {})
    for a in assets:
        if a in aliases and len(aliases[a]) >= 2:
            continue
        found = []
        if asset_class(a) == "crypto":
            if names.get(a):
                found.append(names[a])
            found.append(a.split("-")[0])
        else:
            try:
                meta = md.http.get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{a}", {"range": "1d", "interval": "1d"})["chart"]["result"][0]["meta"]
                found += [n for n in (meta.get("shortName"), meta.get("longName")) if n]
            except Exception:
                pass
            found.append(a)
        aliases[a] = list(dict.fromkeys(aliases.get(a, []) + found))
    db.set_state("aliases", aliases)


def momentum(ranked: list[dict], returns: dict[str, pd.Series], sc, keep_top: int = 8, w30: float = 0.6) -> dict:
    """Momentum manager's view: strongest 30d/7d movers that are still above their 20-day average."""
    movers = [r for r in ranked if r.get("above_sma20") and r["mom7"] > 0]
    movers.sort(key=lambda r: -momentum_score(r["mom30"], r["mom7"], w30))
    picks: list[str] = []
    for r in movers:
        if len(picks) >= 4:
            break
        a = r["asset"]
        if sum(1 for p in picks if asset_class(p) == asset_class(a)) >= sc.max_per_class:
            continue
        if any(abs(correlation(returns, a, p)) > sc.max_correlation for p in picks):
            continue
        picks.append(a)
    top = [r["asset"] for r in movers[:keep_top]]
    table = {r["asset"]: {k: r[k] for k in ("mom30", "mom7", "monthly_vol", "class")}
             for r in movers[:20] + [m for m in movers if etf_lane_eligible(m["asset"])][:6]}
    return {"picks": picks, "top": list(dict.fromkeys(picks + top)), "table": table}


def pick_sleeve(candidates: list[dict], slots: int) -> list[str]:
    """The ETF sleeve: the best fund from each of several different themes.

    One fund per theme is the whole point - four semiconductor funds would be one bet wearing
    four hats. Themes are taken best-first, and if too few pass their backtests the sleeve
    simply runs short rather than doubling up.
    """
    out, used = [], set()
    for c in sorted(candidates, key=lambda x: -x["score"]):
        if len(out) >= slots or not c.get("etf_lane_ok") or c["score"] <= 0:
            continue
        theme = c.get("theme") or c["asset"]
        if theme in used:
            continue
        used.add(theme)
        out.append(c["asset"])
    return out


def pick(
    md: MarketData,
    s: Settings,
    db: DB,
    params: Params,
    current: dict[int, str | None] | None = None,
    pinned: dict[int, str] | None = None,
    allowed: set[str] | None = None,
    ranked: list[dict] | None = None,
    returns: dict | None = None,
    max_per_class: int | None = None,
    state_key: str = "scout_picks",
) -> dict:
    """Choose four lanes plus the bench. `pinned` lanes (holding something) keep their asset.

    `allowed` is the manager's mandate: the set of assets it may hold at all. `ranked` lets the
    caller score the whole market once and hand the same ranking to every manager, so six
    mandates cost one scan rather than six.
    """
    sc = s.scout
    current, pinned = current or {}, pinned or {}
    started = time.time()
    if ranked is None:
        ranked, returns = rank(md, s, params)
    if allowed is not None:
        ranked = [r for r in ranked if r["asset"] in allowed]
    live = db.get_state("live_scores", {})
    # Equal shots for both types: the best coins and the best stocks/ETFs all get backtested.
    shortlist = [r["asset"] for r in ranked if r["class"] == "crypto"][: sc.shortlist]
    shortlist += [r["asset"] for r in ranked if r["class"] == "equity"][: sc.shortlist]
    # Funds rank low on a movement score by their nature, so they get their own slice - and it
    # is taken per theme, not off the top. A shortlist ranked purely on movement would only ever
    # test whichever two themes are hot, and the sleeve is chosen for spread.
    per_theme: dict[str, int] = {}
    for r in ranked:
        a = r["asset"]
        if not etf_lane_eligible(a):
            continue
        theme = etf_theme(a)
        if per_theme.get(theme, 0) >= sc.etf_per_theme:
            continue
        per_theme[theme] = per_theme.get(theme, 0) + 1
        if a not in shortlist:
            shortlist.append(a)
    radar_passed = [a for a, c in (db.get_state("radar_candidates", {}) or {}).items() if c.get("passed")]
    for a in [*pinned.values(), *current.values(), *live.keys(), *radar_passed]:
        if a and a not in shortlist and a in {r["asset"] for r in ranked}:
            shortlist.append(a)
    ranked_by = {r["asset"]: r for r in ranked}
    candidates, rejected = [], []
    for a in shortlist:
        e, best = edge(survivors(md, s, db, params, a))
        if e is None:
            rejected.append(a)
            continue
        lv = live.get(a)
        candidates.append({
            "asset": a,
            "class": asset_class(a),
            "edge": round(e, 2),
            "strategy": best,
            "live": lv,
            "score": round(blended(e, lv, params["scout_live_weight"]), 2),
            "mom30": ranked_by[a]["mom30"],
            "monthly_vol": ranked_by[a]["monthly_vol"],
            "etf": is_etf(a),
            "etf_lane_ok": etf_lane_eligible(a),
            "theme": etf_theme(a),
        })
    candidates.sort(key=lambda c: -c["score"])

    chosen = list(pinned.values())

    def fits(asset: str) -> bool:
        if asset in chosen:
            return False
        same_class = sum(1 for c in chosen if asset_class(c) == asset_class(asset))
        if same_class >= (sc.max_per_class if max_per_class is None else max_per_class):
            return False
        return all(abs(correlation(returns, asset, other)) <= sc.max_correlation for other in chosen)

    for c in candidates:
        if len(chosen) >= s.capital.lanes:
            break
        if c["score"] > 0 and fits(c["asset"]):
            chosen.append(c["asset"])
    # Half the watchlist is coins, half stocks/ETFs, so both get a live shot at taking a lane.
    rest = [c for c in candidates if c["asset"] not in chosen]
    half = sc.bench_size // 2
    bench = [c["asset"] for c in rest if c["class"] == "crypto"][:half] + [c["asset"] for c in rest if c["class"] == "equity"][:half]
    for c in rest:  # top up if one type has too few
        if len(bench) >= sc.bench_size:
            break
        if c["asset"] not in bench:
            bench.append(c["asset"])
    sleeve = pick_sleeve(candidates, s.capital.sleeve_lanes)
    lanes = assign_lanes(chosen, current, pinned, s.capital.lanes)
    _save_aliases(md, db, chosen + bench)
    mom = momentum(ranked, returns, sc, int(params["momentum_keep_top"]), params["momentum_w30"])
    _save_aliases(md, db, mom["picks"])
    result = {
        "ts": time.time(),
        "lanes": {str(k): v for k, v in sorted(lanes.items())},
        "bench": bench,
        "momentum": mom,
        "candidates": candidates[:20],
        "ranked": ranked[:25],
        "rejected": rejected,
        "sleeve": sleeve,
        "sleeve_considered": [c["asset"] for c in candidates if c["etf_lane_ok"]],
        "mandate_size": len(allowed) if allowed is not None else None,
        "scanned": getattr(rank, "scanned", len(ranked)),
        "qualified": len(ranked),
        "seconds": round(time.time() - started),
        "by": "python",
    }
    db.set_state(state_key, result)
    return result
