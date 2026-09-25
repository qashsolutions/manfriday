"""The watch universe, in buckets: what we constantly track, beyond the four lanes.

Rebuilt daily from the whole US market plus Coinbase's coin list. Penny stocks are included,
but only exchange-listed ones over $0.50 that actually trade: OTC and pink sheets are left out
because their prices are unreliable and they are the most often manipulated.
"""

from __future__ import annotations

import logging
import time

from .config import Settings
from .db import DB
from .market import MarketData
from .stockdata import StockData
from .venues import NAMES as VENUE_NAMES, venue_for

log = logging.getLogger(__name__)

BUCKET_LABELS = {
    "large_cap": "Large caps",
    "ai_tech": "AI & tech",
    "crypto_stocks": "Crypto-linked stocks",
    "leveraged_etfs": "Leveraged & sector ETFs",
    "small_mid": "Fast small & mid caps",
    "penny": "Penny stocks (listed, under $5)",
    "crypto": "Crypto",
    "etf": "ETFs (the ETF lane picks from here)",
}
CRYPTO_STOCKS = ["COIN", "MSTR", "MARA", "RIOT", "CLSK", "IREN", "CIFR", "HUT", "WULF", "CORZ", "BITF",
                 "HOOD", "BTDR", "APLD", "GLXY", "CRCL", "IBIT", "ETHA", "BITO", "FBTC"]
LEVERAGED_ETFS = ["TQQQ", "SQQQ", "SOXL", "SOXS", "UPRO", "SPXU", "TNA", "TZA", "TECL", "LABU", "FNGU",
                  "NVDL", "TSLL", "CONL", "MSTU", "BITX", "ETHU", "QLD", "SSO", "UDOW"]
SECTOR_ETFS = ["SPY", "QQQ", "IWM", "DIA", "SMH", "XLK", "XLF", "XLE", "XBI", "ARKK", "XLV", "XLI", "GLD", "SLV"]
AI_KEYWORDS = ("semiconductor", "software", "computer", "electronic", "technology", "internet", "data")

# The ETF lane. One lane always holds a fund, so the league is never four single-name bets at
# once. A fund spreads a theme across dozens of companies: the theme can be right even when one
# company disappoints. The themes are the owner's: broad market, gold, semiconductors, and the
# metals and power the data-centre build-out runs on.
ETF_LANE_THEMES = {
    "broad market": ["VOO", "SPY", "QQQ", "IWM", "DIA", "RSP"],
    "gold & silver": ["GLD", "IAU", "SLV", "GDX", "GDXJ"],
    "semiconductors": ["SMH", "SOXX", "XSD", "PSI"],
    "data-centre metals": ["COPX", "CPER", "XME", "PICK", "REMX", "LIT"],
    "power & grid": ["XLU", "URA", "URNM", "NLR", "GRID", "PAVE"],
    "AI & software": ["XLK", "IGV", "BOTZ", "ROBO", "AIQ", "ARKK"],
    "life sciences": ["XBI", "XLV", "IBB", "ARKG"],
    "energy & commodities": ["XLE", "DBC", "PDBC", "USO"],
    "other sectors": ["XLF", "XLI", "XRT"],
}
# Funds, but never for the ETF lane. A 2x fund amplifies a single theme and bleeds value when
# it is held through a choppy stretch, and a crypto trust would just repeat what the other
# lanes already own - either one turns the diversification lane into another bet on the book.
OTHER_ETFS = {
    "crypto funds": ["IBIT", "ETHA", "FBTC", "BITO"],
    "leveraged": LEVERAGED_ETFS,
}
ETF_THEMES: dict[str, list[str]] = {**ETF_LANE_THEMES, **OTHER_ETFS}
ETFS: dict[str, str] = {sym: theme for theme, syms in ETF_THEMES.items() for sym in syms}
for _sym in SECTOR_ETFS:
    ETFS.setdefault(_sym, "other sectors")
LANE_ELIGIBLE: set[str] = {sym for syms in ETF_LANE_THEMES.values() for sym in syms}


def is_etf(symbol: str) -> bool:
    """True for a fund of any kind. A curated list, never guessed from the name."""
    return (symbol or "").upper() in ETFS


def etf_lane_eligible(symbol: str) -> bool:
    """Funds the ETF lane may hold: diversified baskets, no leverage, no crypto trusts.

    Ranking rewards movement, so without this the lane fills with 2x crypto funds - the most
    volatile things that happen to be ETFs, and the opposite of what the lane is for.
    """
    return (symbol or "").upper() in LANE_ELIGIBLE


def etf_theme(symbol: str) -> str:
    """Which theme a fund belongs to, for the dashboard and the reports."""
    return ETFS.get((symbol or "").upper(), "")


def build(sd: StockData, md: MarketData, s: Settings, db: DB) -> dict:
    started = time.time()
    snap = sd.snapshot(max_age=0)
    buckets: dict[str, list[str]] = {}
    meta: dict[str, dict] = {}

    def add(bucket: str, symbols: list[str], rows=None) -> None:
        buckets.setdefault(bucket, [])
        for sym in symbols:
            if sym in buckets[bucket]:
                continue
            buckets[bucket].append(sym)
            row = (rows or {}).get(sym, {})
            meta.setdefault(sym, {
                "name": row.get("name", sym), "price": row.get("price"), "market_cap": row.get("market_cap"),
                "sector": row.get("sector", ""), "buckets": [], "venue": VENUE_NAMES.get(venue_for(sym), venue_for(sym)),
                "coinbase_listed": sym in set(s.scout.equities()),
            })
            meta[sym]["buckets"].append(bucket)

    if not snap.empty:
        rows = snap.to_dict("index")
        liquid = snap[snap["dollar_volume"] > 0].sort_values("dollar_volume", ascending=False)
        large = liquid[(liquid["market_cap"] >= 10e9) & (liquid["price"] >= 5)]
        add("large_cap", list(large.index[: s.radar.large_cap]), rows)
        tech = large[large["industry"].str.lower().str.contains("|".join(AI_KEYWORDS), na=False)]
        add("ai_tech", list(tech.index[: s.radar.ai_tech]), rows)
        small = liquid[(liquid["market_cap"].between(3e8, 10e9)) & (liquid["price"] >= 5)]
        add("small_mid", list(small.index[: s.radar.small_mid]), rows)
        penny = liquid[(liquid["price"].between(0.5, 5)) & (liquid["dollar_volume"] >= s.radar.min_penny_dollar_volume)]
        add("penny", list(penny.index[: s.radar.penny]), rows)
        add("crypto_stocks", [x for x in CRYPTO_STOCKS if x in snap.index], rows)
        add("leveraged_etfs", [x for x in LEVERAGED_ETFS + SECTOR_ETFS if x in snap.index], rows)

    if not snap.empty:
        add("etf", [x for x in ETFS if x in snap.index], snap.to_dict("index"))

    try:
        coins = sorted(md.crypto_universe(s.scout.min_crypto_volume_usd), key=lambda c: -c["volume_usd"])
        add("crypto", [c["asset"] for c in coins[: s.radar.crypto]],
            {c["asset"]: {"name": c.get("name") or c["asset"], "sector": "crypto"} for c in coins})
    except Exception as e:
        log.warning("universe: crypto list failed: %s", e)

    result = {
        "ts": time.time(), "seconds": round(time.time() - started),
        "buckets": buckets, "meta": meta,
        "counts": {b: len(v) for b, v in buckets.items()},
        "scanned_stocks": int(len(snap)),
    }
    db.set_state("universe", result)
    log.info("universe: %s from %d listed stocks in %ds", result["counts"], len(snap), result["seconds"])
    return result


BLUECHIP_MIN_CAP = 40e9          # "the big boys that are market movers"
BLUECHIP_COUNT = 120


def bluechips(sd: StockData, db: DB, max_age: float = 86400) -> list[str]:
    """The S&P 500 giants, by market cap, from the live screener.

    The league's old stock list was Coinbase's tokenised-stock list, which is missing GOOGL,
    META, AVGO, UNH and XOM among others - which is exactly why every manager kept landing on
    the same few names. This reads the real market instead.
    """
    cached = db.get_state("bluechips", {})
    if cached.get("ts", 0) + max_age > time.time() and cached.get("symbols"):
        return cached["symbols"]
    snap = sd.snapshot(max_age=max_age)
    if snap.empty:
        return cached.get("symbols", [])
    stocks = snap[(snap["kind"] == "stock") & (snap["market_cap"] >= BLUECHIP_MIN_CAP) & (snap["price"] >= 5)]
    stocks = stocks[~stocks.index.str.contains(r"[^A-Z]")]          # drop BRK/A-style tickers
    stocks = stocks.sort_values("market_cap", ascending=False)
    seen, out = set(), []
    for sym, row in stocks.iterrows():
        # One line per company. GOOG, GOOGL and GOOGM are the same bet wearing three tickers,
        # so the share-class and depositary-receipt wording is stripped before comparing.
        key = (row.get("name") or sym)
        for marker in (" Common Stock", " Class ", " American Depositary", " Depositary",
                       " Ordinary Shares", " Shares"):
            key = key.split(marker)[0]
        key = key.strip().rstrip(".").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(sym)
        if len(out) >= BLUECHIP_COUNT:
            break
    db.set_state("bluechips", {"ts": time.time(), "symbols": out})
    log.info("bluechips: %d names from %d screened", len(out), len(snap))
    return out


def load(db: DB) -> dict:
    return db.get_state("universe", {"buckets": {}, "meta": {}, "counts": {}})
