"""News desk: collect headlines, drop duplicates, tag them to our assets and score them.

All Python, no AI: VADER sentiment with a finance vocabulary, keyword rules for critical
events, and Alpha Vantage's own per-ticker scores when an API key is set.
"""

from __future__ import annotations

import calendar
import hashlib
import json
import logging
import math
import os
import re
import time
from dataclasses import dataclass
from urllib.parse import quote_plus

import feedparser
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from .config import Settings
from .db import DB
from .market import Http, asset_class

log = logging.getLogger(__name__)

FINANCE_LEXICON = {
    "surge": 2.2, "surges": 2.2, "soar": 2.5, "soars": 2.5, "rally": 2.0, "rallies": 2.0, "jumps": 1.8,
    "gains": 1.2, "rebound": 1.5, "rebounds": 1.5, "bullish": 2.5, "breakout": 1.8, "upgrade": 2.0,
    "upgraded": 2.0, "beats": 1.8, "outperform": 1.8, "inflows": 1.5, "approval": 1.5, "approved": 1.5,
    "partnership": 1.5, "adoption": 1.3, "record": 1.0, "ath": 2.0, "accumulate": 1.2, "buyback": 1.5,
    "plunge": -2.5, "plunges": -2.5, "crash": -3.0, "crashes": -3.0, "tumbles": -2.2, "slides": -1.5,
    "sinks": -2.0, "drops": -1.5, "falls": -1.3, "selloff": -2.0, "sell-off": -2.0, "bearish": -2.5,
    "downgrade": -2.0, "downgraded": -2.0, "misses": -1.8, "outflows": -1.5, "liquidations": -1.5,
    "hack": -3.0, "hacked": -3.2, "exploit": -3.0, "exploited": -3.2, "breach": -2.5, "lawsuit": -2.0,
    "sues": -2.0, "probe": -1.5, "investigation": -1.5, "fraud": -3.0, "bankruptcy": -3.2, "bankrupt": -3.2,
    "insolvent": -3.0, "delist": -3.0, "delisting": -3.0, "halt": -2.0, "halts": -2.0, "ban": -2.0,
    "bans": -2.0, "rejects": -1.5, "rejected": -1.5, "recall": -1.5, "layoffs": -1.2, "warning": -1.0,
}

CRITICAL_NEGATIVE = re.compile(
    r"\b(hack(ed|s)?|exploit(ed)?|breach(ed)?|bankrupt(cy)?|insolven(t|cy)|delist(s|ed|ing)?|fraud|"
    r"rug ?pull|depeg(ged)?|(sec|doj|cftc) (sues|charges|lawsuit)|halt(s|ed)? (trading|withdrawals)|"
    r"withdrawals? (halted|paused|suspended)|chapter 11)\b",
    re.I,
)
# Promotional pieces that would otherwise score as "good news".
PROMO = re.compile(
    r"\b(casinos?|presale|pre-sale|price predictions?|best (crypto|coins?|altcoins?|meme ?coins?|stocks?) to buy|"
    r"top \d+ (crypto|coins?|altcoins?|tokens?)|apy|airdrop|giveaway|sponsored|referral|bonus code|"
    r"next 100x|1000x|could explode|millionaire[- ]maker)\b",
    re.I,
)
NOTABLE = re.compile(
    r"\b(etf (approval|approved|filing)|acquisition|acquire[sd]?|buyout|merger|earnings|guidance|"
    r"lawsuit|investigation|probe|downgrade[sd]?|upgrade[sd]?|outage|partnership|listing|listed)\b",
    re.I,
)

# Names to look for in headlines. The Scout adds more when it picks new assets.
DEFAULT_ALIASES = {
    "BTC-USD": ["Bitcoin", "BTC"], "ETH-USD": ["Ethereum", "Ether", "ETH"], "SOL-USD": ["Solana", "SOL"],
    "XRP-USD": ["XRP", "Ripple"], "DOGE-USD": ["Dogecoin", "DOGE"], "SUI-USD": ["Sui Network", "SUI"],
    "NEAR-USD": ["NEAR Protocol"], "HYPE-USD": ["Hyperliquid", "HYPE"], "ZEC-USD": ["Zcash", "ZEC"],
    "TAO-USD": ["Bittensor", "TAO"], "AVAX-USD": ["Avalanche", "AVAX"], "LINK-USD": ["Chainlink", "LINK"],
    "ADA-USD": ["Cardano", "ADA"], "PEPE-USD": ["Pepe coin", "PEPE"],
    "NVDA": ["Nvidia", "NVDA"], "AMD": ["AMD", "Advanced Micro Devices"], "MU": ["Micron"], "META": ["Meta Platforms", "META"],
    "INTC": ["Intel", "INTC"], "SNDK": ["SanDisk", "SNDK"], "SPY": ["S&P 500", "SPY"], "QQQ": ["Nasdaq 100", "QQQ"],
    "TSLA": ["Tesla", "TSLA"], "COIN": ["Coinbase", "COIN"], "MSTR": ["MicroStrategy", "Strategy Inc", "MSTR"],
}


@dataclass
class Headline:
    id: str
    published: float
    source: str
    title: str
    url: str
    summary: str


def _norm(title: str) -> str:
    title = re.sub(r"\s+-\s+[^-]+$", "", title)  # Google News appends " - Publisher"
    return re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()


def _tokens(title: str) -> set[str]:
    return {w for w in _norm(title).split() if len(w) > 2}


def _alias_pattern(alias: str) -> re.Pattern:
    # Short all-caps tickers must match exactly in caps (so "sol" in "solution" never counts).
    if alias.isupper() and len(alias) <= 5:
        return re.compile(rf"(?<![A-Za-z0-9])\$?{re.escape(alias)}(?![A-Za-z0-9])")
    return re.compile(rf"\b{re.escape(alias)}\b", re.I)


class NewsDesk:
    def __init__(self, settings: Settings, db: DB, http: Http | None = None):
        self.s = settings
        self.db = db
        self.http = http or Http(settings.news.user_agent)
        self.vader = SentimentIntensityAnalyzer()
        self.vader.lexicon.update(FINANCE_LEXICON)
        self.av_key = os.environ.get("ALPHAVANTAGE_API_KEY")
        self._last_av = 0.0
        self._last_fng = 0.0

    # ---- aliases -------------------------------------------------------------------------

    def aliases(self) -> dict[str, list[str]]:
        extra = self.db.get_state("aliases", {})
        merged = {k: list(v) for k, v in DEFAULT_ALIASES.items()}
        for k, v in extra.items():
            merged[k] = list(dict.fromkeys(merged.get(k, []) + v))
        return merged

    def match_assets(self, text: str, assets: list[str]) -> list[str]:
        al = self.aliases()
        hits = []
        for a in assets:
            names = al.get(a) or [a.split("-")[0]]
            if any(_alias_pattern(n).search(text) for n in names):
                hits.append(a)
        return hits

    # ---- scoring -------------------------------------------------------------------------

    def score(self, title: str, summary: str) -> tuple[float, int, list[str]]:
        t = self.vader.polarity_scores(title)["compound"]
        s = self.vader.polarity_scores(summary[:400])["compound"] if summary else 0.0
        sentiment = max(-1.0, min(1.0, 0.8 * t + 0.2 * s))
        tags = []
        severity = 0
        if CRITICAL_NEGATIVE.search(title):
            severity, tags = 3, ["critical"]
            sentiment = min(sentiment, -0.5)
        elif NOTABLE.search(title):
            severity, tags = 1, [NOTABLE.search(title).group(0).lower()]
        return sentiment, severity, tags

    # ---- collection ----------------------------------------------------------------------

    def _feed_urls(self, assets: list[str]) -> list[tuple[str, str]]:
        urls = [tuple(f) for f in self.s.news.general_feeds]
        al = self.aliases()
        for a in assets:
            name = (al.get(a) or [a.split("-")[0]])[0]
            kind = "crypto" if asset_class(a) == "crypto" else "stock"
            q = quote_plus(f'"{name}" {kind} when:1d')
            urls.append((f"Google News/{a}", f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"))
            urls.append((f"Yahoo/{a}", f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={a}&region=US&lang=en-US"))
            if kind == "stock":
                urls.append((f"SEC/{a}", f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={a}&type=8-K&count=10&output=atom"))
        return urls

    def _fetch(self, source: str, url: str) -> list[Headline]:
        ua = self.s.news.sec_user_agent if source.startswith("SEC/") else self.s.news.user_agent
        try:
            r = self.http.client.get(url, headers={"User-Agent": ua})
            r.raise_for_status()
        except Exception as e:
            log.info("feed %s failed: %s", source, e)
            return []
        self._feed_ok[source.split("/")[0]] = time.time()
        parsed = feedparser.parse(r.content)
        out = []
        now = time.time()
        for e in parsed.entries[:60]:
            title = (e.get("title") or "").strip()
            if not title:
                continue
            pp = e.get("published_parsed") or e.get("updated_parsed")
            published = calendar.timegm(pp) if pp else now
            if now - published > 48 * 3600:
                continue
            summary = re.sub(r"<[^>]+>", " ", e.get("summary") or "")
            summary = re.sub(r"\s+", " ", summary).strip()
            hid = hashlib.sha1(_norm(title).encode()).hexdigest()[:16]
            out.append(Headline(hid, min(published, now), source.split("/")[0], title, e.get("link", ""), summary))
        return out

    def collect(self, assets: list[str]) -> int:
        """Pull every feed once. Returns the number of new headlines stored."""
        self._feed_ok: dict[str, float] = {}
        seen_ids = {r["id"] for r in self.db.query("SELECT id FROM news WHERE seen > ?", (time.time() - 72 * 3600,))}
        recent = self.db.query("SELECT title, assets FROM news WHERE published > ?", (time.time() - 24 * 3600,))
        recent_tokens = [(_tokens(r["title"]), set(json.loads(r["assets"] or "[]"))) for r in recent]
        rows = []
        for source, url in self._feed_urls(assets):
            for h in self._fetch(source, url):
                if h.id in seen_ids or PROMO.search(h.title):
                    continue
                seen_ids.add(h.id)
                text = f"{h.title} {h.summary[:300]}"
                tagged = self.match_assets(text, assets)
                # Google News results were searched by asset name and SEC filings are the
                # company's own, so both belong to that asset. Yahoo feeds mix in general news.
                if source.startswith(("Google News/", "SEC/")):
                    owner = source.split("/", 1)[1]
                    if owner not in tagged:
                        tagged.append(owner)
                toks = _tokens(h.title)
                if any(_jaccard(toks, t) >= 0.75 and (set(tagged) & a or not tagged) for t, a in recent_tokens):
                    continue  # same story from another outlet
                recent_tokens.append((toks, set(tagged)))
                sentiment, severity, tags = self.score(h.title, h.summary)
                rows.append((h.id, h.published, time.time(), h.source, h.title, h.url, h.summary[:500],
                             json.dumps(tagged), sentiment, severity, json.dumps(tags), None))
        if rows:
            self.db.executemany("INSERT OR IGNORE INTO news VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        health = self.db.get_state("feed_health", {})
        for name, _ in self._feed_urls(assets):
            health.setdefault(name.split("/")[0], {"ok_ts": 0.0})
        for name, ts in self._feed_ok.items():
            health[name] = {"ok_ts": ts}
        self.db.set_state("feed_health", health)
        self._maybe_alpha_vantage(assets)
        self._maybe_fear_greed()
        return len(rows)

    def _maybe_alpha_vantage(self, assets: list[str]) -> None:
        if not self.av_key or time.time() - self._last_av < self.s.news.alphavantage_minutes * 60:
            return
        self._last_av = time.time()
        tickers = ",".join(f"CRYPTO:{a.split('-')[0]}" if asset_class(a) == "crypto" else a for a in assets)
        try:
            d = self.http.get_json(
                "https://www.alphavantage.co/query",
                {"function": "NEWS_SENTIMENT", "tickers": tickers, "limit": 50, "apikey": self.av_key},
            )
        except Exception as e:
            log.info("alpha vantage failed: %s", e)
            return
        rows = []
        for item in d.get("feed", []):
            ts = calendar.timegm(time.strptime(item["time_published"], "%Y%m%dT%H%M%S"))
            for t in item.get("ticker_sentiment", []):
                sym = t["ticker"]
                asset = f"{sym.split(':')[1]}-USD" if sym.startswith("CRYPTO:") else sym
                if asset not in assets or float(t["relevance_score"]) < 0.25:
                    continue
                hid = hashlib.sha1(f"av:{_norm(item['title'])}:{asset}".encode()).hexdigest()[:16]
                score = float(t["ticker_sentiment_score"])
                _, severity, tags = self.score(item["title"], "")
                rows.append((hid, ts, time.time(), "AlphaVantage", item["title"], item["url"], item.get("summary", "")[:500],
                             json.dumps([asset]), max(-1, min(1, score * 2)), severity, json.dumps(tags), score))
        if rows:
            self.db.executemany("INSERT OR IGNORE INTO news VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)

    def _maybe_fear_greed(self) -> None:
        if time.time() - self._last_fng < self.s.news.fear_greed_minutes * 60:
            return
        self._last_fng = time.time()
        try:
            d = self.http.get_json("https://api.alternative.me/fng/", {"limit": 1})
            v = d["data"][0]
            self.db.set_state("fear_greed", {"value": int(v["value"]), "label": v["value_classification"], "ts": time.time()})
        except Exception as e:
            log.info("fear & greed failed: %s", e)

    # ---- reading scores ------------------------------------------------------------------

    def asset_score(self, asset: str, now: float | None = None, half_life_h: float = 3.0, window_h: float = 12.0) -> dict:
        """Recency-weighted sentiment for one asset over the last `window_h` hours."""
        now = now or time.time()
        rows = self.db.query(
            "SELECT published, sentiment, severity, title, source FROM news WHERE published > ? AND assets LIKE ?",
            (now - window_h * 3600, f'%"{asset}"%'),
        )
        if not rows:
            return {"score": 0.0, "count": 0, "critical": [], "top": []}
        num = den = 0.0
        for r in rows:
            w = math.exp(-math.log(2) * (now - r["published"]) / 3600 / half_life_h) * (1 + r["severity"])
            num += w * r["sentiment"]
            den += w
        critical = [r for r in rows if r["severity"] >= 3 and now - r["published"] < 6 * 3600]
        top = sorted(rows, key=lambda r: -r["published"])[:5]
        return {
            "score": num / den if den else 0.0,
            "count": len(rows),
            "critical": [{"title": r["title"], "source": r["source"], "published": r["published"]} for r in critical],
            "top": [{"title": r["title"], "sentiment": round(r["sentiment"], 2), "source": r["source"]} for r in top],
        }


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def same_story(a: str, b: str) -> bool:
    """Loose match for 'another outlet covering the same event'."""
    ta, tb = _tokens(a), _tokens(b)
    return _jaccard(ta, tb) >= 0.3 or len(ta & tb) >= 4
