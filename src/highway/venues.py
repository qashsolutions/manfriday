"""Where each asset trades, what it costs there, and how wide its spread is.

Crypto goes to the cheapest venue that lists the coin (Crypto.com at 0.25%/0.5%, otherwise
Coinbase at 0.5%/0.9%). Stocks and ETFs price as commission-free (Webull-style), where the
real cost is the bid/ask spread: a few hundredths of a percent on a large cap, but around
0.4% each way on a $1-5 penny stock. Paper trading has to charge that or the results lie.
"""

from __future__ import annotations

import time

from .config import Fees
from .market import asset_class

COINBASE, CRYPTOCOM, STOCKS = "coinbase", "cryptocom", "webull"
CRYPTO_PREFERENCE = (CRYPTOCOM, COINBASE)  # cheapest first
NAMES = {COINBASE: "Coinbase", CRYPTOCOM: "Crypto.com", STOCKS: "Webull (commission-free)"}

# Which coins each venue lists. Filled from the database at startup and refreshed daily.
_listed: dict[str, set[str]] = {COINBASE: set(), CRYPTOCOM: set()}


def set_listings(listings: dict[str, list[str]]) -> None:
    for venue, symbols in listings.items():
        if venue in _listed:
            _listed[venue] = set(symbols)


def listings() -> dict[str, set[str]]:
    return _listed


def refresh_listings(db, http) -> dict[str, list[str]]:
    """Which coins Coinbase and Crypto.com list, so each lane trades where it is cheapest."""
    out: dict[str, list[str]] = {}
    try:
        d = http.get_json("https://api.coinbase.com/api/v3/brokerage/market/products", {"product_type": "SPOT"})
        out[COINBASE] = sorted({p["base_currency_id"] for p in d.get("products", [])
                                if p.get("quote_currency_id") == "USD" and p.get("status") == "online"})
    except Exception:
        pass
    try:
        d = http.get_json("https://api.crypto.com/exchange/v1/public/get-instruments", {})
        out[CRYPTOCOM] = sorted({i["base_ccy"] for i in d.get("result", {}).get("data", [])
                                 if i.get("inst_type") == "CCY_PAIR" and i.get("quote_ccy") == "USD"})
    except Exception:
        pass
    if out:
        stored = db.get_state("listings", {})
        stored.update({k: v for k, v in out.items() if v})
        stored["ts"] = time.time()
        db.set_state("listings", stored)
        set_listings(stored)
    return out


def venue_for(asset: str) -> str:
    """The venue a lane holding this asset would trade on."""
    if asset_class(asset) != "crypto":
        return STOCKS
    base = asset.split("-")[0]
    for venue in CRYPTO_PREFERENCE:
        if base in _listed.get(venue, ()):  # bars still come from Coinbase, so it must list it too
            if venue == COINBASE or base in _listed.get(COINBASE, ()):
                return venue
    return COINBASE


def rates(fees: Fees, venue: str) -> tuple[float, float]:
    if venue == CRYPTOCOM:
        return fees.cryptocom_maker, fees.cryptocom_taker
    if venue == STOCKS:
        return fees.stock_maker, fees.stock_taker
    return fees.maker, fees.taker


def half_spread_bps(asset: str, price: float | None, fees: Fees) -> float:
    """Half the bid/ask spread, in basis points. Crypto uses real quotes, so it needs none."""
    if asset_class(asset) == "crypto":
        return 0.0
    for floor, bps in fees.spread_tiers:
        if price is not None and price >= floor:
            return float(bps)
    return float(fees.spread_tiers[-1][1]) if fees.spread_tiers else fees.equity_half_spread_bps
