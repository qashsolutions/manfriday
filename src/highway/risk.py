"""Hard risk rules. Plain code; no agent can override these."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Callable

from .book import EPS, Lane
from .config import Settings
from .params import Params

PriceAt = Callable[[float], float | None]  # price of the lane's asset at a past timestamp


@dataclass(frozen=True)
class Quote:
    asset: str
    bid: float
    ask: float
    last: float
    ts: float
    source: str
    cross_check_pct: float | None = None  # gap vs a second venue, if one exists
    venue_quotes: dict[str, tuple[float, float]] = field(default_factory=dict)

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2

    def at(self, venue: str) -> Quote:
        """The same moment priced on the venue this lane trades on."""
        pair = self.venue_quotes.get(venue)
        if not pair or pair[0] <= 0 or pair[1] <= 0:
            return self
        return replace(self, bid=pair[0], ask=pair[1], source=venue)


@dataclass(frozen=True)
class Verdict:
    ok: bool
    reason: str


def day_change(lane: Lane, bid: float, price_at: PriceAt, now: float, window_hours: float) -> float | None:
    """Position change over the last day, as a fraction.

    Each buy is compared with the price one day ago, or with its own purchase price if it
    was bought within the last day. So a position bought 2 hours ago that is down 10% is
    exited, and so is one held for a week that fell 10% since this time yesterday.
    """
    if not lane.has_position:
        return None
    window = window_hours * 3600
    ref_value = 0.0
    day_ago_price: float | None = None
    for t in lane.tranches:
        if now - t.ts >= window:
            if day_ago_price is None:
                day_ago_price = price_at(now - window)
            ref_price = day_ago_price if day_ago_price else t.price
        else:
            ref_price = t.price
        ref_value += t.qty * ref_price
    if ref_value <= EPS:
        return None
    return (lane.qty * bid) / ref_value - 1


def hold_hours(lane: Lane, now: float) -> float:
    """How long this position has been open, counted from its first clip."""
    return (now - min(t.ts for t in lane.tranches)) / 3600 if lane.tranches else 0.0


def signal_exit_ok(lane: Lane, now: float, min_hold_hours: float) -> bool:
    """May a strategy signal close this position yet?

    Only strategy exits wait. The -10% stop, the +15% take-profit and the give-back stop are
    hard rules and always fire, however young the position is. A lane holding nothing has
    nothing to wait on.
    """
    return not min_hold_hours or not lane.tranches or hold_hours(lane, now) >= min_hold_hours


def giveback_pct(peak: float, bid: float) -> float | None:
    """How far below its best this position now sits, as a percentage (negative = below).

    The high-water mark starts at the price the position opened at, so a holding that never
    rose is measured from its entry. None when there is no usable price yet.
    """
    if peak <= 0 or bid <= 0:
        return None
    return (bid / peak - 1) * 100


def stale_decision_reason(asset: str, age_hours: float, crossed_a_close: bool, news: dict, ask: float | None,
                          reference: float | None, day_ago: float | None, stale_hours: float, max_gap_pct: float) -> str | None:
    """Should an ageing buy decision still execute?

    A call made last night, or before the weekend, should not buy blind into this morning: the
    price may have gapped and the news may have turned. Returns a reason to hold off, or None.
    """
    if age_hours < stale_hours and not crossed_a_close:
        return None
    when = f"{age_hours:.0f}h old" if age_hours >= 1 else "from before the open"
    if news.get("count", 0) >= 2 and news.get("score", 0.0) < -0.1:
        return f"decision {when}; news turned negative ({news['score']:+.2f}) - waiting for a fresh call"
    if ask and reference:
        gap = (ask / reference - 1) * 100
        if abs(gap) > max_gap_pct:
            return f"decision {when}; {asset} gapped {'up' if gap > 0 else 'down'} {abs(gap):.1f}% since - waiting for a fresh call"
    if ask and day_ago and ask < day_ago * 0.97:
        return f"decision {when}; {asset} is down {100 * (1 - ask / day_ago):.1f}% over 24h - waiting for a fresh call"
    return None


class RiskManager:
    def __init__(self, settings: Settings, params: Params):
        self.s = settings
        self.p = params

    def round_trip_pct(self, venue: str = "coinbase", half_spread_bps: float = 0.0) -> float:
        """Limit entry (maker) + worst-case market exit (taker + slippage), plus the spread for stocks."""
        from .venues import rates

        maker, taker = rates(self.s.fees, venue)
        return (maker + taker + self.s.fees.slippage_bps / 1e4 + 2 * half_spread_bps / 1e4) * 100

    def quote_ok(self, quote: Quote | None, asset_class: str, now: float, check_divergence: bool = True) -> Verdict:
        """Is this price usable? The venue cross-check only guards new buys: during a crash venues
        drift apart, and that must never stop a protective sell on the venue we trade on."""
        r = self.s.rules
        if quote is None:
            return Verdict(False, "no quote")
        max_age = r.max_quote_age_seconds if asset_class == "crypto" else r.max_equity_quote_age_seconds
        if now - quote.ts > max_age:
            return Verdict(False, f"quote is {now - quote.ts:.0f}s old")
        if quote.bid <= 0 or quote.ask <= 0 or quote.ask < quote.bid:
            return Verdict(False, "bad bid/ask")
        if check_divergence and quote.cross_check_pct is not None and abs(quote.cross_check_pct) > r.max_price_divergence_pct:
            return Verdict(False, f"venues disagree by {quote.cross_check_pct:.2f}%")
        return Verdict(True, "ok")

    def exit_signal(self, lane: Lane, bid: float, price_at: PriceAt, now: float) -> tuple[str, float] | None:
        """Returns ("stop_day" | "take_profit_day" | "giveback", change) when a rule fires."""
        change = day_change(lane, bid, price_at, now, self.s.rules.day_window_hours)
        if change is not None:
            pct = change * 100
            if pct <= self.s.rules.stop_loss_day_pct + EPS:
                return "stop_day", pct
            if pct > self.s.rules.take_profit_day_pct:
                return "take_profit_day", pct
        # The day rules only see the last 24 hours, so a slow bleed off a high slips past them.
        give = giveback_pct(lane.peak_price, bid)
        if give is not None and give <= -self.s.rules.giveback_pct + EPS:
            return "giveback", give
        return None

    def start_cooldown(self, lane: Lane, reason: str, now: float) -> None:
        hours = {
            "stop_day": self.p["cooldown_after_stop_h"],
            "take_profit_day": self.p["cooldown_after_tp_h"],
            "giveback": self.p["cooldown_after_tp_h"],
            "signal": self.p["cooldown_after_signal_h"],
            "signal_market": self.p["cooldown_after_signal_h"],
            "news_exit": self.p["cooldown_after_stop_h"],
        }.get(reason, 0.0)
        lane.cooldown_until = max(lane.cooldown_until, now + hours * 3600)
        lane.last_exit_reason = reason

    def approve_buy(
        self,
        lane: Lane,
        notional: float,
        quote: Quote | None,
        now: float,
        expected_move_pct: float,
        market_open: bool,
        paused: bool,
    ) -> Verdict:
        c, r = self.s.capital, self.s.rules
        if paused:
            return Verdict(False, "trading paused")
        if lane.status != "active" or not lane.asset:
            return Verdict(False, "lane not active")
        if now < lane.cooldown_until:
            return Verdict(False, f"cooling down for {(lane.cooldown_until - now) / 3600:.1f}h after {lane.last_exit_reason}")
        if not market_open:
            return Verdict(False, "market closed")
        q = self.quote_ok(quote, lane.asset_class, now)
        if not q.ok:
            return q
        if notional > c.max_buy + EPS:
            return Verdict(False, f"${notional:.2f} is over the ${c.max_buy:.0f} per-buy limit")
        if notional < c.min_buy - EPS:
            return Verdict(False, "below minimum order size")
        if notional > lane.cash + EPS:
            return Verdict(False, f"only ${lane.cash:.2f} settled cash")
        if lane.equity(quote.bid) + EPS >= c.lane_cap:
            return Verdict(False, "lane is at its cap")
        recent = [t for t in lane.buy_times if now - t < 24 * 3600]
        if len(recent) >= r.max_buys_per_lane_per_day:
            return Verdict(False, f"{len(recent)} buys in the last 24h")
        from .venues import half_spread_bps

        cost = self.round_trip_pct(lane.venue, half_spread_bps(lane.asset, quote.mid, self.s.fees))
        needed = self.p["fee_edge_multiple"] * cost
        if expected_move_pct < needed:
            return Verdict(False, f"expected move {expected_move_pct:.2f}% < {needed:.2f}% needed to beat fees")
        return Verdict(True, "ok")
