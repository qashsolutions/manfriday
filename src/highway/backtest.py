"""Walk-forward backtests: tune each strategy on older data, judge it only on newer data.

A strategy "survives" for an asset only if the settings picked on the training window
also made money, after fees, on the later test window it never saw.
"""

from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import Settings, bar_minutes_for
from .db import DB
from .market import MarketData, asset_class
from .params import Params
from .sim import NEUTRAL_NEWS, LaneSim, score
from .strategies import STRATEGIES, Hold, Strategy, base_features

log = logging.getLogger(__name__)

HISTORY_DAYS = {"crypto": 180, "equity": 725}  # 15-minute crypto bars; 1-hour stock bars (Yahoo keeps 730 days)
MIN_ENTRIES = 1  # slow strategies may enter once and still be holding at the end
MAX_TEST_DD = 25.0
RECENT_DAYS = 60


def bars_per_day(asset: str, bar_minutes: int) -> int:
    return int(24 * 60 / bar_minutes) if asset_class(asset) == "crypto" else math.ceil(6.5 * 60 / bar_minutes)


def load_history(md: MarketData, s: Settings, asset: str, days: int | None = None) -> pd.DataFrame:
    days = days or HISTORY_DAYS[asset_class(asset)]
    return md.bars(asset, bar_minutes_for(s, asset), time.time() - days * 86400)


class PriceLookup:
    """Fast 'close price at or before ts' over a bar frame."""

    def __init__(self, df: pd.DataFrame, bar_seconds: float):
        self.ts = df.index.to_numpy(dtype=float) + bar_seconds
        self.close = df["close"].to_numpy(dtype=float)

    def __call__(self, ts: float) -> float | None:
        i = int(np.searchsorted(self.ts, ts, side="right")) - 1
        return float(self.close[i]) if i >= 0 else None


def run(strategy: Strategy, df: pd.DataFrame, s: Settings, params: Params, asset: str, start: int = 0, end: int | None = None) -> LaneSim:
    minutes = bar_minutes_for(s, asset)
    bpd = bars_per_day(asset, minutes)
    bar_seconds = minutes * 60
    prepared = strategy.prepare(base_features(df, bpd), bpd)
    rows = prepared.to_dict("records")
    index = prepared.index.to_numpy(dtype=float)
    lookup = PriceLookup(prepared, bar_seconds)
    sim = LaneSim(strategy, s, params, asset)
    first = max(start, strategy.warmup_bars(bpd))
    for i in range(first, len(rows) if end is None else end):
        sim.on_bar(index[i], rows[i], lookup, NEUTRAL_NEWS, bar_seconds)
    return sim


@dataclass
class WalkForward:
    asset: str
    strategy: str
    params: dict
    train: dict
    test: dict
    survived: bool

    @property
    def test_score(self) -> float:
        return score(self.test)


def walk_forward(df: pd.DataFrame, s: Settings, params: Params, asset: str, train_frac: float = 2 / 3) -> list[WalkForward]:
    split = int(len(df) * train_frac)
    results = []
    for cls in STRATEGIES:
        if not cls.backtestable:
            continue
        best, best_score = None, -np.inf
        for variant in cls.variants():
            m = run(variant, df, s, params, asset, end=split).metrics()
            sc = score(m) if m["entries"] >= MIN_ENTRIES or cls is Hold else -np.inf
            if sc > best_score:
                best, best_score, best_train = variant, sc, m
        if best is None:
            continue
        test = run(type(best)(**best.params), df, s, params, asset, start=split).metrics()
        # Everyone is also scored on the same recent window, so a 60-day crypto test and an
        # 8-month stock test can be ranked fairly. Passing still uses the full test window.
        recent_start = max(split, len(df) - RECENT_DAYS * bars_per_day(asset, bar_minutes_for(s, asset)) * (1 if asset_class(asset) == "crypto" else 5 / 7))
        recent = run(type(best)(**best.params), df, s, params, asset, start=int(recent_start)).metrics()
        test["recent_monthly_pct"], test["recent_max_dd_pct"] = recent["monthly_pct"], recent["max_dd_pct"]
        survived = (
            cls.eligible
            and test["return_pct"] > 0
            and test["entries"] >= MIN_ENTRIES
            and test["max_dd_pct"] < MAX_TEST_DD
        )
        results.append(WalkForward(asset, cls.name, best.params, best_train, test, survived))
    return results


def save(db: DB, results: list[WalkForward]) -> None:
    now = time.time()
    db.executemany(
        "INSERT INTO backtests(ts,asset,strategy,params,train,test,survived) VALUES(?,?,?,?,?,?,?)",
        [(now, r.asset, r.strategy, json.dumps(r.params), json.dumps(r.train), json.dumps(r.test), int(r.survived)) for r in results],
    )


def latest(db: DB, asset: str, max_age_days: float = 3) -> list[dict]:
    rows = db.query(
        "SELECT * FROM backtests WHERE asset=? AND ts=(SELECT MAX(ts) FROM backtests WHERE asset=?) AND ts>?",
        (asset, asset, time.time() - max_age_days * 86400),
    )
    for r in rows:
        r["params"], r["train"], r["test"] = json.loads(r["params"]), json.loads(r["train"]), json.loads(r["test"])
    return rows
