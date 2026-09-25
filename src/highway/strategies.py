"""Trading strategies. Each one looks at closed bars and says how many $50 clips it wants.

A strategy never places orders. It returns a Decision; the lane simulator (for shadows and
backtests) or the engine (for the real lane) turns that into orders through the Risk Manager.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product

from datetime import datetime

import numpy as np
import pandas as pd

from .calendar import NY


@dataclass(frozen=True)
class Decision:
    target_clips: int  # 0, 1 or 2 clips of $50
    expected_move_pct: float = 0.0
    reason: str = ""


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def base_features(df: pd.DataFrame, bars_per_day: int) -> pd.DataFrame:
    out = df.copy()
    out["ts"] = out.index  # strategies that care what time it is
    out["atr"] = atr(out)
    out["atr_pct"] = out["atr"] / out["close"] * 100
    hi = out["high"].rolling(bars_per_day, min_periods=bars_per_day // 2).max()
    lo = out["low"].rolling(bars_per_day, min_periods=bars_per_day // 2).min()
    out["day_range_pct"] = (hi - lo) / out["close"] * 100
    return out


class Strategy:
    name = "base"
    eligible = True  # may lead a lane
    backtestable = True
    grid: dict[str, list] = {}

    def __init__(self, **params):
        self.params = {**self.defaults(), **params}

    @classmethod
    def defaults(cls) -> dict:
        return {k: v[0] for k, v in cls.grid.items()}

    @property
    def key(self) -> str:
        p = ",".join(f"{k}={v}" for k, v in sorted(self.params.items()))
        return f"{self.name}({p})"

    def warmup_bars(self, bars_per_day: int) -> int:
        return bars_per_day * 2

    def prepare(self, df: pd.DataFrame, bars_per_day: int) -> pd.DataFrame:
        return df

    def decide(self, row: pd.Series, clips: int, state: dict, news: dict) -> Decision:
        raise NotImplementedError

    @classmethod
    def variants(cls) -> list[Strategy]:
        if not cls.grid:
            return [cls()]
        keys = list(cls.grid)
        return [cls(**dict(zip(keys, combo))) for combo in product(*(cls.grid[k] for k in keys))]


class TrendEMA(Strategy):
    """Ride trends: hold while the fast average is above the slow one."""

    name = "trend"
    grid = {"fast": [20, 10, 40], "slow": [96, 60, 192]}

    def prepare(self, df, bars_per_day):
        df = df.copy()
        df["ema_f"] = ema(df["close"], self.params["fast"])
        df["ema_s"] = ema(df["close"], self.params["slow"])
        df["ema_s_up"] = df["ema_s"] > df["ema_s"].shift(4)
        return df

    def warmup_bars(self, bars_per_day):
        return self.params["slow"] * 2

    def decide(self, row, clips, state, news):
        up = row["ema_f"] > row["ema_s"] and row["close"] > row["ema_s"] and row["ema_s_up"]
        if clips and (row["ema_f"] < row["ema_s"] or row["close"] < row["ema_s"] - row["atr"]):
            return Decision(0, reason="trend broke")
        if up:
            return Decision(2, row["day_range_pct"], "uptrend")
        return Decision(clips, reason="holding" if clips else "waiting for an uptrend")


class Regime(Strategy):
    """Slow trend: hold while price is above its multi-day average and that average rises.

    Trades rarely, so fees barely matter, and it stays in for the big multi-week moves.
    """

    name = "regime"
    grid = {"days": [20, 10, 30], "buffer": [0.02, 0.0, 0.04]}

    def prepare(self, df, bars_per_day):
        df = df.copy()
        n = int(self.params["days"] * bars_per_day)
        df["reg_ema"] = ema(df["close"], n)
        df["reg_up"] = df["reg_ema"] > df["reg_ema"].shift(bars_per_day)
        return df

    def warmup_bars(self, bars_per_day):
        return int(self.params["days"] * bars_per_day)

    def decide(self, row, clips, state, news):
        days = self.params["days"]
        if clips and row["close"] < row["reg_ema"] * (1 - self.params["buffer"]):
            return Decision(0, reason=f"fell below the {days}-day trend")
        if row["close"] > row["reg_ema"] and row["reg_up"]:
            return Decision(2, row["day_range_pct"] * 2, f"above the rising {days}-day trend")
        return Decision(clips, reason=f"holding; {days}-day trend not rising" if clips else f"waiting: price below or {days}-day trend flat")


class SessionTiming(Strategy):
    """Buy the strong part of the day, leave before the weak part.

    Market lore: stocks open strong and sell off into the close. The measured edge is small,
    so this only buys when the slower trend agrees, and it has to beat the other strategies
    in the tournament like anything else.
    """

    name = "session"
    grid = {"hold_bars": [8, 4, 24], "trend_filter": [1, 0]}

    def prepare(self, df, bars_per_day):
        df = df.copy()
        df["sess_ema"] = ema(df["close"], max(20, bars_per_day * 5))
        hours, weekdays = [], []
        for ts in df["ts"]:
            when = datetime.fromtimestamp(float(ts), NY)
            hours.append(when.hour + when.minute / 60)
            weekdays.append(when.weekday())
        df["hour_ny"], df["weekday"] = hours, weekdays
        return df

    def warmup_bars(self, bars_per_day):
        return max(40, bars_per_day * 5)

    def decide(self, row, clips, state, news):
        hour, weekday = row["hour_ny"], row["weekday"]
        crypto = row.get("day_range_pct") is not None and hour is not None
        opening = 9 <= hour < 11 if weekday < 5 else False
        closing = hour >= 14.5 if weekday < 5 else False
        if clips:
            state["held"] = state.get("held", 0) + 1
            if closing or state["held"] >= self.params["hold_bars"]:
                state.pop("held", None)
                return Decision(0, reason="leaving before the weak part of the day")
            return Decision(state.get("want", clips), reason="holding through the strong window")
        if opening and (not self.params["trend_filter"] or row["close"] > row["sess_ema"]):
            state["held"], state["want"] = 0, 2
            return Decision(2, row["day_range_pct"], "opening window, trend agrees" if self.params["trend_filter"] else "opening window")
        return Decision(0, reason="waiting for the opening window")


class Breakout(Strategy):
    """Buy new highs on strong volume, trail a stop under the peak."""

    name = "breakout"
    grid = {"lookback": [96, 48, 192], "trail_atr": [3.0, 2.0, 4.0]}

    def prepare(self, df, bars_per_day):
        n = self.params["lookback"]
        df = df.copy()
        df["dc_hi"] = df["high"].rolling(n).max().shift(1)
        df["dc_lo"] = df["low"].rolling(n // 2).min().shift(1)
        df["vol_ma"] = df["volume"].rolling(n).mean()
        return df

    def warmup_bars(self, bars_per_day):
        return self.params["lookback"] + 10

    def decide(self, row, clips, state, news):
        if clips:
            state["peak"] = max(state.get("peak", row["close"]), row["close"])
            if row["close"] < state["peak"] - self.params["trail_atr"] * row["atr"] or row["close"] < row["dc_lo"]:
                state.pop("peak", None)
                state.pop("want", None)
                return Decision(0, reason="trailing stop")
            return Decision(state.get("want", clips), reason="riding the breakout")
        if row["close"] > row["dc_hi"] and row["volume"] > 1.5 * row["vol_ma"]:
            state["peak"], state["want"] = row["close"], 2
            return Decision(2, row["day_range_pct"], "breakout on volume")
        return Decision(0, reason="waiting for a breakout on volume")


class MeanRevert(Strategy):
    """Buy sharp dips below the lower band; sell back at the middle."""

    name = "dip"
    grid = {"rsi_lo": [28, 22, 34], "bb_k": [2.0, 2.5]}

    def prepare(self, df, bars_per_day):
        df = df.copy()
        n = 40
        mid = df["close"].rolling(n).mean()
        sd = df["close"].rolling(n).std()
        df["bb_mid"], df["bb_lo"] = mid, mid - self.params["bb_k"] * sd
        df["rsi"] = rsi(df["close"])
        return df

    def warmup_bars(self, bars_per_day):
        return 60

    def decide(self, row, clips, state, news):
        lo = self.params["rsi_lo"]
        if clips:
            state["held"] = state.get("held", 0) + 1
            if row["close"] >= row["bb_mid"] or state["held"] > 96:
                state.pop("held", None)
                return Decision(0, reason="reverted to mean" if row["close"] >= row["bb_mid"] else "time stop")
            if clips == 1 and row["rsi"] < lo - 8:
                return Decision(2, (row["bb_mid"] / row["close"] - 1) * 100, "deeper dip, add")
            return Decision(clips, reason="waiting for bounce")
        if row["rsi"] < lo and row["close"] < row["bb_lo"]:
            state["held"] = 0
            return Decision(1, (row["bb_mid"] / row["close"] - 1) * 100, "oversold dip")
        return Decision(0, reason="waiting for an oversold dip")


class NewsMomentum(Strategy):
    """Buy when news is clearly positive and price agrees. Needs live news, so no backtest."""

    name = "news"
    backtestable = False
    grid = {"thresh": [0.25, 0.4]}

    def prepare(self, df, bars_per_day):
        df = df.copy()
        df["mom_4h"] = df["close"] / df["close"].shift(16) - 1
        return df

    def warmup_bars(self, bars_per_day):
        return 20

    def decide(self, row, clips, state, news):
        score, count = news.get("score", 0.0), news.get("count", 0)
        if clips:
            state["held"] = state.get("held", 0) + 1
            if score < 0 or state["held"] > 48:
                state.pop("held", None)
                state.pop("want", None)
                return Decision(0, reason="news faded")
            return Decision(state.get("want", clips), reason="news still positive")
        if count >= 3 and score > self.params["thresh"] and row["mom_4h"] > 0:
            state["held"] = 0
            state["want"] = 2 if score > 2 * self.params["thresh"] else 1
            return Decision(state["want"], row["day_range_pct"], f"positive news {score:+.2f} x{count}")
        return Decision(0, reason=f"waiting for news above {self.params['thresh']:+.2f} (now {score:+.2f})")


class Hold(Strategy):
    """Buy and hold. The benchmark every lane is compared against; never leads."""

    name = "hold"
    eligible = False

    def warmup_bars(self, bars_per_day):
        return 1

    def decide(self, row, clips, state, news):
        return Decision(2, 99.0, "benchmark")


STRATEGIES: list[type[Strategy]] = [Regime, TrendEMA, Breakout, MeanRevert, SessionTiming, NewsMomentum, Hold]


def build(key_or_name: str, params: dict | None = None) -> Strategy:
    for cls in STRATEGIES:
        if cls.name == key_or_name:
            return cls(**(params or {}))
    raise KeyError(key_or_name)


@dataclass
class StrategyState:
    """Per-shadow memory a strategy can use between bars (peaks, bars held)."""

    data: dict = field(default_factory=dict)
