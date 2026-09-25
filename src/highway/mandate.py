"""What each manager is allowed to hold, and where it trades.

The league started with four managers that all picked from one universe, so they converged on
the same handful of assets: two of them ended up 0.97 correlated, and one contributed nothing
the others did not already provide. Four names for one bet teaches you nothing.

A mandate fixes that at the source. Each manager gets its own slice of the market and, where
it matters, its own venue. They still run identical money rules and an identical risk engine -
the only differences are what they may buy and who they trade it through.
"""

from __future__ import annotations

from dataclasses import dataclass

from .market import asset_class
from .universe import etf_lane_eligible
from .venues import COINBASE, CRYPTOCOM


@dataclass(frozen=True)
class Mandate:
    id: str
    name: str
    about: str
    kinds: tuple[str, ...]      # which asset kinds it may hold: crypto / bluechip / etf
    brain: str                  # tournament | laser | momentum | hold
    venue: str | None = None    # force this venue, or None to use the cheapest that lists it
    competes: bool = True       # the benchmark is scored but is not in the contest

    @property
    def class_cap(self) -> int:
        """"At most 3 lanes of one type" only means something when a manager may hold more than
        one type. A crypto-only manager could never fill its fourth lane under that rule."""
        return 99 if len(self.kinds) < 2 else 3


MANDATES: dict[str, Mandate] = {
    "bluechip": Mandate(
        "bluechip", "Bluechip", "the S&P 500 giants that move the market",
        kinds=("bluechip",), brain="tournament"),
    "etf": Mandate(
        "etf", "ETF", "funds only: the S&P, gold, semiconductors, life sciences",
        kinds=("etf",), brain="tournament"),
    "coinbase": Mandate(
        "coinbase", "Coinbase", "crypto, traded on Coinbase",
        kinds=("crypto",), brain="tournament", venue=COINBASE),
    "momentum": Mandate(
        "momentum", "Momentum", "the strongest movers, traded on Crypto.com",
        kinds=("crypto",), brain="momentum", venue=CRYPTOCOM),
    "laser": Mandate(
        "laser", "Laser", "AI judgement, free to pick anything",
        kinds=("crypto", "bluechip", "etf"), brain="laser"),
    "hold": Mandate(
        "hold", "Hold", "buys once and never changes: the yardstick",
        kinds=("crypto", "bluechip", "etf"), brain="hold", competes=False),
}
ORDER = ["bluechip", "etf", "coinbase", "momentum", "laser", "hold"]


def kind_of(asset: str, bluechips: set[str]) -> str:
    """Which slice of the market an asset belongs to."""
    if asset_class(asset) == "crypto":
        return "crypto"
    if etf_lane_eligible(asset):
        return "etf"
    return "bluechip" if asset.upper() in bluechips else "other"


def allows(m: Mandate, asset: str, bluechips: set[str], listed: dict[str, set[str]] | None = None) -> bool:
    """May this manager hold this asset at all?"""
    if kind_of(asset, bluechips) not in m.kinds:
        return False
    # A manager pinned to one venue can only hold what that venue actually lists. An empty
    # listing set means "not loaded yet", not "lists nothing" - treating those the same once
    # left the Coinbase manager with a mandate of zero assets.
    if m.venue and asset_class(asset) == "crypto" and listed:
        known = listed.get(m.venue) or set()
        return not known or asset.split("-")[0] in known
    return True


def names() -> dict[str, str]:
    return {m.id: m.name for m in MANDATES.values()}


def competing() -> list[str]:
    return [m.id for m in MANDATES.values() if m.competes]
