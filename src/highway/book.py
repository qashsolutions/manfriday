"""Money accounting for the four lanes, the vault and the reserve.

Pure logic with no I/O, so the live engine, the shadow strategies and the backtester
all share exactly the same rules: $50 max buys, fees, settlement delays, the $50 skim
to the vault, the $70 floor with reserve refills, and the $500 total cap.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

from .calendar import settles_at
from .config import Capital, Fees, Settlement

EPS = 1e-9


class BookError(ValueError):
    """An order that would break a hard money rule."""


@dataclass
class Tranche:
    qty: float
    price: float  # fill price after slippage, before fees
    ts: float
    cost: float  # cash spent including the fee


@dataclass
class Pending:
    amount: float
    settles_at: float
    to_vault: bool = False


@dataclass
class Fill:
    ts: float
    lane_id: int
    asset: str
    side: str  # "buy" | "sell"
    qty: float
    price: float
    cash: float  # cash out for buys, net proceeds for sells
    fee: float
    reason: str
    strategy: str = ""


@dataclass
class Lane:
    lane_id: int
    principal: float
    asset: str | None = None
    asset_class: str = "crypto"
    status: str = "active"  # "active" | "closed"
    cash: float = 0.0  # settled cash that can be spent now
    pending: list[Pending] = field(default_factory=list)
    tranches: list[Tranche] = field(default_factory=list)
    kind: str = "main"  # "main" = one of the four $100 lanes, "etf" = a slot in the ETF sleeve
    peak_price: float = 0.0  # best bid seen since this position opened; drives the give-back stop
    venue: str = "coinbase"  # where this lane's asset trades (sets the fees)
    cooldown_until: float = 0.0
    buy_times: list[float] = field(default_factory=list)
    refills: int = 0
    last_exit_reason: str = ""

    @property
    def qty(self) -> float:
        return sum(t.qty for t in self.tranches)

    @property
    def has_position(self) -> bool:
        return self.qty > EPS

    @property
    def lane_pending(self) -> float:
        return sum(p.amount for p in self.pending if not p.to_vault)

    @property
    def cost_basis(self) -> float:
        return sum(t.cost for t in self.tranches)

    def position_value(self, bid: float | None) -> float:
        if not self.has_position:
            return 0.0
        if bid is None:
            # No price: value at cost so the lane is not mistaken for empty.
            return self.cost_basis
        return self.qty * bid

    def equity(self, bid: float | None) -> float:
        return self.cash + self.lane_pending + self.position_value(bid)


@dataclass
class Fund:
    capital: Capital
    fees: Fees
    settlement: Settlement
    lanes: list[Lane]
    vault: float = 0.0
    reserve: float = 0.0
    capital_in: float = 0.0
    fees_paid: float = 0.0
    fills: list[Fill] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)

    @classmethod
    def new(
        cls,
        capital: Capital,
        fees: Fees,
        settlement: Settlement,
        n_lanes: int | None = None,
        reserve: float | None = None,
        sleeve: int | None = None,
    ) -> Fund:
        """The real fund by default. Shadows and backtests pass n_lanes=1, reserve=0."""
        n = capital.lanes if n_lanes is None else n_lanes
        # Only the real fund carries the ETF sleeve; a one-lane shadow or backtest never does.
        sleeve_n = (capital.sleeve_lanes if n_lanes is None else 0) if sleeve is None else sleeve
        fund = cls(
            capital=capital,
            fees=fees,
            settlement=settlement,
            lanes=[Lane(lane_id=i + 1, principal=capital.lane_principal, cash=capital.lane_principal) for i in range(n)]
            + [Lane(lane_id=n + i + 1, principal=capital.sleeve_principal, cash=capital.sleeve_principal,
                    kind="etf", asset_class="equity") for i in range(sleeve_n)],
            reserve=capital.reserve if reserve is None else reserve,
            capital_in=n * capital.lane_principal + sleeve_n * capital.sleeve_principal,
        )
        fund._check_cap()
        return fund

    # ---- helpers -------------------------------------------------------------------------

    def lane(self, lane_id: int) -> Lane:
        return next(l for l in self.lanes if l.lane_id == lane_id)

    def _event(self, ts: float, kind: str, lane: Lane | None, message: str, **extra) -> None:
        self.events.append({"ts": ts, "kind": kind, "lane_id": lane.lane_id if lane else None, "message": message, **extra})

    def _check_cap(self) -> None:
        if self.capital_in > self.capital.total_risk_cap + EPS:
            raise BookError(f"capital in ${self.capital_in:.2f} exceeds the ${self.capital.total_risk_cap:.2f} cap")
        if self.reserve < -EPS:
            raise BookError("reserve went negative")

    @property
    def vault_pending(self) -> float:
        return sum(p.amount for l in self.lanes for p in l.pending if p.to_vault)

    def total_value(self, bids: dict[str, float | None]) -> float:
        lanes = sum(l.equity(bids.get(l.asset) if l.asset else None) for l in self.lanes)
        return lanes + self.vault + self.vault_pending + self.reserve

    # ---- settlement ----------------------------------------------------------------------

    def settle(self, now: float) -> None:
        for lane in self.lanes:
            keep = []
            for p in lane.pending:
                if p.settles_at <= now + EPS:
                    if p.to_vault:
                        self.vault += p.amount
                    else:
                        lane.cash += p.amount
                else:
                    keep.append(p)
            lane.pending = keep

    # ---- trading -------------------------------------------------------------------------

    def _fee_rate(self, liquidity: str, venue: str = "coinbase") -> float:
        from .venues import rates

        maker, taker = rates(self.fees, venue)
        return maker if liquidity == "maker" else taker

    def _slip(self, liquidity: str) -> float:
        return 0.0 if liquidity == "maker" else self.fees.slippage_bps / 1e4

    def buy(
        self, lane: Lane, notional: float, ask: float, now: float, reason: str, strategy: str = "", liquidity: str = "taker"
    ) -> Fill:
        """Spend `notional` (fee included). Maker = a resting limit order filled at its price."""
        c = self.capital
        if lane.status != "active" or not lane.asset:
            raise BookError(f"lane {lane.lane_id} is not active with an asset")
        if notional > c.max_buy + EPS:
            raise BookError(f"buy ${notional:.2f} exceeds the ${c.max_buy:.2f} per-buy limit")
        if notional < c.min_buy - EPS:
            raise BookError(f"buy ${notional:.2f} is below the ${c.min_buy:.2f} minimum")
        if notional > lane.cash + EPS:
            raise BookError(f"lane {lane.lane_id} has ${lane.cash:.2f} settled cash, cannot buy ${notional:.2f}")
        if ask <= 0:
            raise BookError("bad ask price")
        price = ask * (1 + self._slip(liquidity))
        fee = notional * self._fee_rate(liquidity, lane.venue)
        qty = (notional - fee) / price
        lane.cash -= notional
        lane.tranches.append(Tranche(qty=qty, price=price, ts=now, cost=notional))
        lane.buy_times.append(now)
        self.fees_paid += fee
        fill = Fill(now, lane.lane_id, lane.asset, "buy", qty, price, notional, fee, reason, strategy)
        self.fills.append(fill)
        return fill

    def sell(
        self,
        lane: Lane,
        qty: float,
        bid: float,
        now: float,
        reason: str,
        strategy: str = "",
        to_vault: bool = False,
        liquidity: str = "taker",
    ) -> Fill:
        if not lane.has_position:
            raise BookError(f"lane {lane.lane_id} has nothing to sell")
        if bid <= 0:
            raise BookError("bad bid price")
        qty = min(qty, lane.qty)
        price = bid * (1 - self._slip(liquidity))
        gross = qty * price
        fee = gross * self._fee_rate(liquidity, lane.venue)
        proceeds = gross - fee
        # FIFO: close the oldest tranches first.
        left = qty
        while left > EPS and lane.tranches:
            t = lane.tranches[0]
            if t.qty <= left + EPS:
                left -= t.qty
                lane.tranches.pop(0)
            else:
                frac = left / t.qty
                t.cost -= t.cost * frac
                t.qty -= left
                left = 0.0
        if not lane.has_position:
            lane.peak_price = 0.0  # flat: the next position starts its own high-water mark
        when = settles_at(lane.asset_class, now, self.settlement.crypto_hours, self.settlement.equity_business_days)
        if when <= now + EPS:
            if to_vault:
                self.vault += proceeds
            else:
                lane.cash += proceeds
        else:
            lane.pending.append(Pending(proceeds, when, to_vault))
        self.fees_paid += fee
        fill = Fill(now, lane.lane_id, lane.asset, "sell", qty, price, proceeds, fee, reason, strategy)
        self.fills.append(fill)
        return fill

    def sell_all(self, lane: Lane, bid: float, now: float, reason: str, strategy: str = "", liquidity: str = "taker") -> Fill | None:
        if not lane.has_position:
            return None
        return self.sell(lane, lane.qty, bid, now, reason, strategy, liquidity=liquidity)

    # ---- vault skim ----------------------------------------------------------------------

    def skim(self, lane: Lane, bid: float | None, now: float) -> float:
        """Move every full $50 above principal to the vault once the lane reaches $150."""
        c = self.capital
        if lane.status != "active":
            return 0.0
        equity = lane.equity(bid)
        if equity < c.cap_for(lane.principal) - EPS:
            return 0.0
        chunk = c.skim_for(lane.principal)
        chunks = math.floor((equity - lane.principal) / chunk + EPS)
        amount = chunks * chunk
        if amount <= 0:
            return 0.0
        remaining = amount
        # 1) settled cash
        take = min(lane.cash, remaining)
        lane.cash -= take
        self.vault += take
        remaining -= take
        # 2) unsettled lane cash gets earmarked for the vault
        for p in list(lane.pending):
            if remaining <= EPS:
                break
            if p.to_vault:
                continue
            if p.amount <= remaining + EPS:
                p.to_vault = True
                remaining -= p.amount
            else:
                p.amount -= remaining
                lane.pending.append(Pending(remaining, p.settles_at, True))
                remaining = 0.0
        # 3) sell part of the position for the rest
        if remaining > EPS:
            if bid is None or not lane.has_position:
                self._event(now, "skim_deferred", lane, f"needs ${remaining:.2f} but no price or position")
                return amount - remaining
            net_per_unit = bid * (1 - self.fees.slippage_bps / 1e4) * (1 - self._fee_rate("taker", lane.venue))
            self.sell(lane, remaining / net_per_unit, bid, now, reason="skim", to_vault=True)
        self._event(now, "skim", lane, f"moved ${amount:.2f} to the vault", amount=amount)
        return amount

    # ---- floor and refill ----------------------------------------------------------------

    def check_floor(self, lane: Lane, bid: float | None, now: float) -> str | None:
        """Close a lane at or below the floor. Refill it to principal from reserve if possible."""
        c = self.capital
        if lane.status != "active" or (bid is None and lane.has_position):
            return None
        if lane.equity(bid) > c.floor_for(lane.principal) + EPS:
            return None
        if lane.has_position:
            self.sell_all(lane, bid, now, reason="lane_floor")
        total = lane.cash + lane.lane_pending
        need = max(0.0, lane.principal - total)
        old_asset = lane.asset
        if need <= self.reserve + EPS:
            self.reserve -= need
            self.capital_in += need
            lane.cash += need
            lane.refills += 1
            lane.asset = None  # the Scout assigns a fresh asset
            lane.last_exit_reason = "lane_floor"
            self._check_cap()
            self._event(now, "refill", lane, f"lane hit the floor on {old_asset}; refilled ${need:.2f} from reserve", amount=need)
            return "refilled"
        lane.status = "closed"
        lane.last_exit_reason = "lane_floor"
        self._event(now, "lane_closed", lane, f"lane hit the floor on {old_asset}; reserve ${self.reserve:.2f} cannot refill it")
        return "closed"

    # ---- persistence ---------------------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "lanes": [asdict(l) for l in self.lanes],
            "vault": self.vault,
            "reserve": self.reserve,
            "capital_in": self.capital_in,
            "fees_paid": self.fees_paid,
        }

    @classmethod
    def from_dict(cls, d: dict, capital: Capital, fees: Fees, settlement: Settlement) -> Fund:
        lanes = []
        for ld in d["lanes"]:
            ld = dict(ld)
            ld["pending"] = [Pending(**p) for p in ld.get("pending", [])]
            ld["tranches"] = [Tranche(**t) for t in ld.get("tranches", [])]
            lanes.append(Lane(**ld))
        fund = cls(capital, fees, settlement, lanes, d["vault"], d["reserve"], d["capital_in"], d["fees_paid"])
        fund._check_cap()
        return fund
