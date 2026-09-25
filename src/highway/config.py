"""Load settings.toml into typed, read-only settings objects."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "config" / "settings.toml"
DATA_DIR = ROOT / "data"


@dataclass(frozen=True)
class Capital:
    lanes: int = 4
    lane_principal: float = 100.0
    lane_cap: float = 150.0
    skim_chunk: float = 50.0
    lane_floor: float = 70.0
    reserve: float = 100.0
    sleeve_lanes: int = 0
    sleeve_principal: float = 25.0
    max_buy: float = 50.0
    min_buy: float = 5.0
    total_risk_cap: float = 500.0

    def scale(self, principal: float) -> float:
        """A $25 sleeve lane lives by the same rules as a $100 lane, in proportion.

        The cap, the floor and the vault skim are all written for a $100 lane, so a smaller
        lane scales them rather than inheriting numbers it could never reach.
        """
        return principal / self.lane_principal if self.lane_principal else 1.0

    def cap_for(self, principal: float) -> float:
        return self.lane_cap * self.scale(principal)

    def floor_for(self, principal: float) -> float:
        return self.lane_floor * self.scale(principal)

    def skim_for(self, principal: float) -> float:
        return self.skim_chunk * self.scale(principal)


@dataclass(frozen=True)
class Rules:
    day_window_hours: float = 24.0
    stop_loss_day_pct: float = -7.0
    take_profit_day_pct: float = 12.0
    giveback_pct: float = 20.0
    max_buys_per_lane_per_day: int = 4
    max_price_divergence_pct: float = 2.0
    max_quote_age_seconds: float = 90.0
    max_equity_quote_age_seconds: float = 900.0


@dataclass(frozen=True)
class Fees:
    maker: float = 0.005  # Coinbase Advanced, Intro tier
    taker: float = 0.009
    cryptocom_maker: float = 0.0025
    cryptocom_taker: float = 0.005
    stock_maker: float = 0.0  # commission-free brokers: the cost is the spread
    stock_taker: float = 0.0
    slippage_bps: float = 5.0
    equity_half_spread_bps: float = 3.0
    spread_tiers: tuple = ((20.0, 3.0), (5.0, 8.0), (1.0, 40.0), (0.0, 150.0))


@dataclass(frozen=True)
class Settlement:
    crypto_hours: float = 0.0
    equity_business_days: int = 1


@dataclass(frozen=True)
class Target:
    monthly: float = 0.135
    monthly_low: float = 0.12
    monthly_high: float = 0.15


@dataclass(frozen=True)
class Agents:
    claude_bin: str = "claude"
    claude_model: str = "sonnet"
    max_claude_calls_per_day: int = 14
    scout_hour_utc: int = 13
    coach_hour_utc: int = 3


@dataclass(frozen=True)
class News:
    poll_minutes: float = 5
    fear_greed_minutes: float = 60
    alphavantage_minutes: float = 70
    user_agent: str = "HighwayBot/0.1"
    sec_user_agent: str = "HighwayBot research"
    general_feeds: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class Scout:
    crypto_candidates: int = 25
    min_crypto_volume_usd: float = 15e6
    equities_file: str = "config/equities.txt"
    min_equity_dollar_volume: float = 50e6
    min_monthly_vol: float = 0.10
    shortlist: int = 14
    bench_size: int = 8
    max_per_class: int = 3
    max_correlation: float = 0.85
    promote_after_flat_h: float = 24.0
    etf_per_theme: int = 2
    etf_min_monthly_vol: float = 0.025
    bluechip_min_monthly_vol: float = 0.04
    bluechip_min_dollar_volume: float = 250e6
    etf_min_dollar_volume: float = 5e6

    def equities(self) -> list[str]:
        path = ROOT / self.equities_file
        if not path.exists():
            return []
        return [l.strip() for l in path.read_text().splitlines() if l.strip() and not l.startswith("#")]


@dataclass(frozen=True)
class Radar:
    scan_minutes: float = 20
    large_cap: int = 250
    ai_tech: int = 60
    small_mid: int = 150
    penny: int = 120
    crypto: int = 50
    min_penny_dollar_volume: float = 2e6


@dataclass(frozen=True)
class Dashboard:
    host: str = "127.0.0.1"
    port: int = 8787


@dataclass(frozen=True)
class Settings:
    mode: str = "paper"
    poll_seconds: float = 10
    bar_minutes: int = 15
    equity_bar_minutes: int = 60
    capital: Capital = field(default_factory=Capital)
    rules: Rules = field(default_factory=Rules)
    fees: Fees = field(default_factory=Fees)
    settlement: Settlement = field(default_factory=Settlement)
    target: Target = field(default_factory=Target)
    agents: Agents = field(default_factory=Agents)
    news: News = field(default_factory=News)
    scout: Scout = field(default_factory=Scout)
    radar: Radar = field(default_factory=Radar)
    dashboard: Dashboard = field(default_factory=Dashboard)


def _build(cls, raw: dict):
    known = {f.name for f in fields(cls)}
    unknown = set(raw) - known
    if unknown:
        raise ValueError(f"Unknown settings in [{cls.__name__.lower()}]: {sorted(unknown)}")
    kwargs = {}
    for f in fields(cls):
        if f.name not in raw:
            continue
        value = raw[f.name]
        if isinstance(value, list):
            value = tuple(tuple(v) if isinstance(v, list) else v for v in value)
        kwargs[f.name] = value
    return cls(**kwargs)


def bar_minutes_for(s: Settings, asset: str) -> int:
    """Crypto trades on 15-minute bars, stocks and ETFs on 1-hour bars."""
    return s.bar_minutes if "-" in asset else s.equity_bar_minutes


def load_settings(path: Path = CONFIG_PATH) -> Settings:
    raw = tomllib.loads(path.read_text())
    sections = {
        "capital": Capital,
        "rules": Rules,
        "fees": Fees,
        "settlement": Settlement,
        "target": Target,
        "agents": Agents,
        "news": News,
        "scout": Scout,
        "radar": Radar,
        "dashboard": Dashboard,
    }
    top = {k: v for k, v in raw.items() if k not in sections}
    nested = {name: _build(cls, raw.get(name, {})) for name, cls in sections.items()}
    settings = _build(Settings, top)
    settings = Settings(**{**{f.name: getattr(settings, f.name) for f in fields(Settings)}, **nested})
    _validate(settings)
    return settings


def _validate(s: Settings) -> None:
    c = s.capital
    committed = c.lanes * c.lane_principal + c.reserve
    if committed > c.total_risk_cap + 1e-9:
        raise ValueError(f"lanes x principal + reserve = {committed} exceeds the ${c.total_risk_cap} cap")
    if not (c.lane_floor < c.lane_principal < c.lane_cap):
        raise ValueError("need lane_floor < lane_principal < lane_cap")
    if c.max_buy > c.lane_principal:
        raise ValueError("max_buy cannot exceed lane_principal")
    if s.rules.stop_loss_day_pct >= 0 or s.rules.take_profit_day_pct <= 0:
        raise ValueError("stop must be negative and take-profit positive")
    if s.mode not in ("paper",):
        raise ValueError("only paper mode is enabled; live trading is wired after the paper week")
