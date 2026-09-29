"""Scorecards and money checks for each league manager. Pure Python over the database."""

from __future__ import annotations

import math
import time
from collections import defaultdict

from .book import Fund
from .db import DB

START_VALUE = 500.0


def reconcile(fund: Fund, db: DB, pid: str) -> float:
    """Every dollar must be accounted for: cash anywhere = $500 - all buys + all sale proceeds.

    Returns the mismatch in dollars (should be ~0). Skims and refills only move cash between
    lanes, the vault and the reserve, so they never change the total.
    """
    flows = db.query("SELECT side, SUM(cash) AS total FROM fills WHERE portfolio=? GROUP BY side", (pid,))
    spent = next((r["total"] for r in flows if r["side"] == "buy"), 0.0) or 0.0
    received = next((r["total"] for r in flows if r["side"] == "sell"), 0.0) or 0.0
    cash = sum(l.cash + sum(p.amount for p in l.pending) for l in fund.lanes) + fund.vault + fund.reserve
    return cash - (START_VALUE - spent + received)


def replay(db: DB, pid: str) -> tuple[list[dict], list[dict]]:
    """Walk this manager's fills and rebuild every trade: (closed round trips, still open).

    A trade is one lane going flat -> bought -> flat again, however many clips it took.
    """
    fills = db.query(
        "SELECT ts, lane_id, asset, side, qty, cash, fee, reason FROM fills WHERE portfolio=? ORDER BY ts, id", (pid,)
    )
    open_trip: dict[int, dict] = {}
    trips = []
    for f in fills:
        t = open_trip.get(f["lane_id"])
        if f["side"] == "buy":
            if t is None:
                t = open_trip[f["lane_id"]] = {"lane": f["lane_id"], "asset": f["asset"], "opened": f["ts"],
                                               "qty": 0.0, "cost": 0.0, "proceeds": 0.0, "fees": 0.0,
                                               "buys": 0, "sells": 0, "exits": []}
            t["qty"] += f["qty"]
            t["cost"] += f["cash"]
            t["fees"] += f["fee"]
            t["buys"] += 1
        elif t is not None:
            t["qty"] -= f["qty"]
            t["proceeds"] += f["cash"]
            t["fees"] += f["fee"]
            t["sells"] += 1
            t["exits"].append(f["reason"])
            if t["qty"] <= max(1e-9, 1e-6 * f["qty"]):
                t["closed"] = f["ts"]
                t["pnl"] = t["proceeds"] - t["cost"]
                t["pnl_pct"] = (t["pnl"] / t["cost"] * 100) if t["cost"] else 0.0
                trips.append(t)
                open_trip.pop(f["lane_id"])
    return trips, list(open_trip.values())


def round_trips(db: DB, pid: str, since: float = 0.0) -> list[dict]:
    """Completed trades, newest first cut at `since`."""
    closed, _ = replay(db, pid)
    return [t for t in closed if t["closed"] >= since]


def _series(db: DB, pid: str, since: float) -> list[tuple[float, float]]:
    rows = db.query(
        "SELECT ts, equity FROM league_equity WHERE portfolio=? AND lane_id=0 AND ts>=? ORDER BY ts", (pid, since)
    )
    return [(r["ts"], r["equity"]) for r in rows]


def scorecard(db: DB, pid: str, since: float, start_value: float, hold_return_pct: float | None = None) -> dict:
    series = _series(db, pid, since)
    if not series:
        return {"id": pid}
    end_ts, end = series[-1]
    days = max((end_ts - since) / 86400, 1e-6)
    ret = end / start_value - 1
    peak, max_dd = start_value, 0.0
    for _, v in series:
        peak = max(peak, v)
        max_dd = max(max_dd, 1 - v / peak)
    current_dd = 1 - end / max(peak, end)
    # daily returns from the last value in each UTC day
    by_day: dict[int, float] = {}
    for ts, v in series:
        by_day[int(ts // 86400)] = v
    closes = [start_value] + [by_day[d] for d in sorted(by_day)]
    daily = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
    sharpe = None
    if len(daily) >= 3:
        mean = sum(daily) / len(daily)
        sd = math.sqrt(sum((x - mean) ** 2 for x in daily) / (len(daily) - 1))
        sharpe = round(mean / sd * math.sqrt(365), 2) if sd > 0 else None
    trips = round_trips(db, pid, since)
    wins = [t["pnl"] for t in trips if t["pnl"] > 0]
    losses = [t["pnl"] for t in trips if t["pnl"] <= 0]
    agg = db.query(
        "SELECT SUM(fee) AS fees, SUM(CASE WHEN side='buy' THEN cash ELSE 0 END) AS bought, "
        "SUM(CASE WHEN reason='stop_day' THEN 1 ELSE 0 END) AS stops, "
        "SUM(CASE WHEN reason='take_profit_day' THEN 1 ELSE 0 END) AS tps "
        "FROM fills WHERE portfolio=? AND ts>=?", (pid, since),
    )[0]
    fees = agg["fees"] or 0.0
    gross_gain = sum(wins)
    reasons = defaultdict(int)
    for t in trips:
        for r in t["exits"]:
            reasons[r] += 1
    return {
        "id": pid,
        "days": round(days, 2),
        "return_pct": round(ret * 100, 2),
        "monthly_equiv_pct": round(((1 + ret) ** (30 / max(days, 10)) - 1) * 100, 2),
        "max_dd_pct": round(max_dd * 100, 2),
        "current_dd_pct": round(current_dd * 100, 2),
        "sharpe": sharpe,
        "trades": len(trips),
        "win_rate": round(len(wins) / len(trips), 2) if trips else None,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else None,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else None,
        "profit_factor": round(gross_gain / abs(sum(losses)), 2) if losses and sum(losses) < 0 else None,
        "fees": round(fees, 2),
        "fee_drag_pct": round(fees / gross_gain * 100, 1) if gross_gain > 0 else None,
        "turnover_x": round((agg["bought"] or 0.0) / start_value, 2),
        "stops": agg["stops"] or 0,
        "take_profits": agg["tps"] or 0,
        "vs_hold_pct": round(ret * 100 - hold_return_pct, 2) if hold_return_pct is not None and pid != "hold" else None,
        "exit_reasons": dict(reasons),
    }


# ---- per-manager ledger: what it owns, what it traded, and how each period went ------------

_PERIODS = {
    "day": lambda t: time.strftime("%Y-%m-%d", time.localtime(t)),
    "week": lambda t: time.strftime("%G-W%V", time.localtime(t)),
    "month": lambda t: time.strftime("%Y-%m", time.localtime(t)),
    "quarter": lambda t: f"{time.localtime(t).tm_year}-Q{(time.localtime(t).tm_mon - 1) // 3 + 1}",
    "year": lambda t: time.strftime("%Y", time.localtime(t)),
}


def _marks(db: DB, pid: str) -> tuple[dict[int, dict], float]:
    """The newest price and value we have for each of this manager's lanes."""
    row = db.query("SELECT MAX(ts) AS ts FROM league_equity WHERE portfolio=?", (pid,))
    latest = (row[0]["ts"] if row else None) or 0.0
    marks = {r["lane_id"]: r for r in db.query(
        "SELECT lane_id, asset, equity, price FROM league_equity WHERE portfolio=? AND ts=? AND lane_id>0",
        (pid, latest))}
    return marks, latest


def holdings(db: DB, pid: str) -> list[dict]:
    """What this manager owns right now, with what it paid and what it is worth."""
    _, open_trips = replay(db, pid)
    marks, _ = _marks(db, pid)
    out = []
    for t in open_trips:
        m = marks.get(t["lane"]) or {}
        net_cost = t["cost"] - t["proceeds"]          # what is still tied up in the position
        price = m.get("price") or 0.0
        value = t["qty"] * price if price else net_cost
        out.append({
            "lane": t["lane"], "asset": t["asset"], "qty": t["qty"], "price": price,
            "cost": round(t["cost"], 2), "net_cost": round(net_cost, 2), "value": round(value, 2),
            "unrealised": round(value - net_cost, 2),
            "unrealised_pct": round((value / net_cost - 1) * 100, 2) if net_cost > 0 else 0.0,
            "since": t["opened"], "buys": t["buys"], "fees": round(t["fees"], 2),
        })
    return sorted(out, key=lambda h: h["lane"])


def trades(db: DB, pid: str) -> list[dict]:
    """Every completed trade, newest first: what was bought, when it was sold, what it made."""
    closed, _ = replay(db, pid)
    return [{
        "lane": t["lane"], "asset": t["asset"], "opened": t["opened"], "closed": t["closed"],
        "held_hours": round((t["closed"] - t["opened"]) / 3600, 1),
        "cost": round(t["cost"], 2), "proceeds": round(t["proceeds"], 2), "fees": round(t["fees"], 2),
        "pnl": round(t["pnl"], 2), "pnl_pct": round(t["pnl_pct"], 2),
        "exit": (t["exits"] or ["-"])[-1], "buys": t["buys"], "sells": t["sells"],
    } for t in sorted(closed, key=lambda x: -x["closed"])]


def by_asset(db: DB, pid: str) -> list[dict]:
    """Every asset this manager has ever held, and what it has made or lost since day one of it.

    The trade list answers "how did that one trade go"; this answers "has this asset been worth
    holding at all". They are different questions whenever a lane goes back into the same name,
    which is common - NEAR-USD was bought and sold four separate times in the first week, and
    nothing added those up.

    `total` is realised profit from closed trades plus the unrealised move on anything still
    held, so it is the whole story for that asset. A position part-sold and still open is not
    double-counted: `holdings` already nets the money taken out against what is still in.
    """
    closed, _ = replay(db, pid)
    held = holdings(db, pid)
    rows: dict[str, dict] = {}

    def row(asset: str, first: float) -> dict:
        r = rows.setdefault(asset, {
            "asset": asset, "first_bought": first, "last_activity": first, "trades": 0, "wins": 0,
            "realised": 0.0, "unrealised": 0.0, "fees": 0.0, "bought": 0.0, "sold": 0.0,
            "holding": False, "qty": 0.0, "value": 0.0})
        r["first_bought"] = min(r["first_bought"], first)
        return r

    for t in closed:
        r = row(t["asset"], t["opened"])
        r["last_activity"] = max(r["last_activity"], t["closed"])
        r["trades"] += 1
        r["wins"] += 1 if t["pnl"] > 0 else 0
        r["realised"] += t["pnl"]
        r["fees"] += t["fees"]
        r["bought"] += t["cost"]
        r["sold"] += t["proceeds"]
    for h in held:
        r = row(h["asset"], h["since"])
        r["unrealised"] += h["unrealised"]
        r["fees"] += h["fees"]
        r["bought"] += h["cost"]
        r["holding"] = True
        r["qty"] += h["qty"]
        r["value"] += h["value"]

    out = []
    for r in rows.values():
        r["total"] = round(r["realised"] + r["unrealised"], 2)
        # against what the asset actually tied up, not against the whole fund
        r["total_pct"] = round(r["total"] / r["bought"] * 100, 2) if r["bought"] else 0.0
        for k in ("realised", "unrealised", "fees", "bought", "sold", "value"):
            r[k] = round(r[k], 2)
        out.append(r)
    return sorted(out, key=lambda r: r["total"])


def assets(db: DB, names: dict[str, str]) -> dict:
    """The same question across the whole league: which assets have actually paid?

    An asset several managers hold is the interesting case - it is one bet the league made more
    than once, and the per-manager view cannot show that it lost money four times over.
    """
    per_manager, combined = {}, {}
    for pid, name in names.items():
        rows = by_asset(db, pid)
        per_manager[pid] = {"id": pid, "name": name, "assets": rows}
        for r in rows:
            c = combined.setdefault(r["asset"], {
                "asset": r["asset"], "first_bought": r["first_bought"], "managers": [],
                "trades": 0, "wins": 0, "realised": 0.0, "unrealised": 0.0, "fees": 0.0,
                "bought": 0.0, "holding": False})
            c["first_bought"] = min(c["first_bought"], r["first_bought"])
            c["managers"].append(name)
            c["holding"] = c["holding"] or r["holding"]
            for k in ("trades", "wins", "realised", "unrealised", "fees", "bought"):
                c[k] += r[k]
    league = []
    for c in combined.values():
        c["total"] = round(c["realised"] + c["unrealised"], 2)
        c["total_pct"] = round(c["total"] / c["bought"] * 100, 2) if c["bought"] else 0.0
        for k in ("realised", "unrealised", "fees", "bought"):
            c[k] = round(c[k], 2)
        league.append(c)
    return {"league": sorted(league, key=lambda r: r["total"]), "managers": per_manager}


def _day_start(now: float | None = None) -> float:
    """Local midnight. The owner reads this page, and "today" means their today."""
    t = time.localtime(now or time.time())
    return time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1))


def performance(db: DB, names: dict[str, str], start_values: dict[str, float] | None = None) -> dict:
    """Money first: what everything is worth, and what it made today and in total.

    Modelled on how a broker shows a portfolio, because that is what the owner actually wants
    to know first - value, today's gain or loss in dollars and percent, total gain or loss in
    dollars and percent. Everything the league does that is strategy rather than money belongs
    a level below this, not beside it.

    `today` is measured from local midnight, not from the league clock, because "today" on a
    page a person reads means their today.
    """
    since = _day_start()
    starts = start_values or db.get_state("league_start_values", {}) or {}
    managers, totals = [], {"value": 0.0, "day": 0.0, "start": 0.0, "opened": 0.0}

    for pid, name in names.items():
        rows = db.query(
            "SELECT ts, equity FROM league_equity WHERE portfolio=? AND lane_id=0 ORDER BY ts", (pid,))
        if not rows:
            continue
        value = float(rows[-1]["equity"])
        opening = next((float(r["equity"]) for r in rows if r["ts"] >= since), None)
        if opening is None:                      # nothing recorded yet today
            opening = float(rows[-1]["equity"])
        began = float(starts.get(pid) or (rows[0]["equity"] if rows else value))
        managers.append({
            "id": pid, "name": name, "value": round(value, 2),
            "day": round(value - opening, 2),
            "day_pct": round((value / opening - 1) * 100, 2) if opening else 0.0,
            "total": round(value - began, 2),
            "total_pct": round((value / began - 1) * 100, 2) if began else 0.0,
            "start_value": round(began, 2),
        })
        totals["value"] += value
        totals["day"] += value - opening
        totals["opened"] += opening
        totals["start"] += began

    totals = {
        "value": round(totals["value"], 2),
        "day": round(totals["day"], 2),
        "day_pct": round((totals["value"] / totals["opened"] - 1) * 100, 2) if totals["opened"] else 0.0,
        "total": round(totals["value"] - totals["start"], 2),
        "total_pct": round((totals["value"] / totals["start"] - 1) * 100, 2) if totals["start"] else 0.0,
        "start_value": round(totals["start"], 2),
    }
    return {"total": totals, "managers": sorted(managers, key=lambda m: -m["total_pct"]),
            "since": since}


def positions(db: DB, names: dict[str, str]) -> list[dict]:
    """Every open position as a broker would list it: cost, value, today's move, total move."""
    since = _day_start()
    out = []
    for pid, name in names.items():
        marks, _ = _marks(db, pid)
        for h in holdings(db, pid):
            price = h["price"] or 0.0
            qty = h["qty"]
            avg_cost = h["net_cost"] / qty if qty > 1e-12 else 0.0
            # A position opened today never lived through this morning's move, so today's gain
            # runs from what we paid, not from the day's opening price. Otherwise an asset that
            # fell 14% before we bought it shows a $16 loss on a position that is $0.04 down.
            if h["since"] >= since or not avg_cost:
                opening = avg_cost or price
            else:
                opening = db.tick_near(h["asset"], since, 7200) or price
            out.append({
                "manager": name, "manager_id": pid, "lane": h["lane"], "asset": h["asset"],
                "qty": qty, "last": round(price, 6),
                "chg": round(price - opening, 6),
                "chg_pct": round((price / opening - 1) * 100, 2) if opening else 0.0,
                "day": round(qty * (price - opening), 2),
                "avg_cost": round(avg_cost, 6),
                "opened_today": h["since"] >= since,
                "total_cost": h["net_cost"], "value": h["value"],
                "total": h["unrealised"], "total_pct": h["unrealised_pct"],
                "since": h["since"],
            })
    return sorted(out, key=lambda p: -p["value"])


def _price_at(db: DB, asset: str, ts: float, latest: dict[str, float]) -> float | None:
    """Best price we have for an asset at a moment, for valuing a position at a period edge.

    The newest price is only acceptable for an edge that *is* now. Using today's price to value
    a position at last Tuesday's edge would invent a profit, so an edge we cannot price is
    skipped by the caller instead.
    """
    p = db.tick_near(asset, ts, 3600)
    if p:
        return float(p)
    row = db.query("SELECT price FROM league_equity WHERE asset=? AND ts<=? AND price>0 "
                   "ORDER BY ts DESC LIMIT 1", (asset, ts))
    if row:
        return float(row[0]["price"])
    return latest.get(asset) if time.time() - ts < 3600 else None


def asset_periods(db: DB, pid: str | None, period: str = "day", limit: int = 40) -> list[dict]:
    """Profit and loss by asset inside each day, week, month, quarter or year.

    `by_period` answers this for a whole fund and `by_asset` answers it for an asset's whole
    life; neither crosses the two, so "what did NEAR cost us last week" had no home.

    A position carried across a period edge is valued at that edge, so the answer is the honest
    one: what the asset did *inside* the period, not just what was banked in it. For each asset,
    over a window that runs from t0 to t1:

        profit = (what it is worth at t1) - (what it was worth at t0) - (bought) + (sold)

    which is exact whether the position was opened, closed, added to or simply held throughout.
    """
    if period not in _PERIODS:
        raise KeyError(f"unknown period {period}")
    key = _PERIODS[period]
    where = "WHERE portfolio=?" if pid else ""
    args = (pid,) if pid else ()
    fills = db.query(f"SELECT ts, asset, side, qty, cash, fee FROM fills {where} ORDER BY ts, id", tuple(args))
    if not fills:
        return []

    now = time.time()
    latest = {r["asset"]: float(r["price"]) for r in db.query(
        "SELECT asset, price FROM league_equity WHERE price>0 ORDER BY ts") if r["asset"]}

    # Every period between the first fill and now, including ones with no trading in them:
    # an asset simply held through a quiet week still made or lost money that week.
    starts: dict[str, float] = {}
    t = fills[0]["ts"]
    while t <= now:
        starts.setdefault(key(t), t)
        t += 3600
    starts.setdefault(key(now), now)
    ordered = sorted(starts.items(), key=lambda kv: kv[1])
    edges = [(name, t0, (ordered[i + 1][1] if i + 1 < len(ordered) else now))
             for i, (name, t0) in enumerate(ordered)]
    edges = edges[-limit:]

    by_asset_fills: dict[str, list[dict]] = {}
    for f in fills:
        by_asset_fills.setdefault(f["asset"], []).append(f)

    def qty_at(asset: str, ts: float) -> float:
        q = 0.0
        for f in by_asset_fills[asset]:
            if f["ts"] > ts:
                break
            q += f["qty"] if f["side"] == "buy" else -f["qty"]
        return q

    out = []
    for name, t0, t1 in edges:
        rows = []
        for asset, af in by_asset_fills.items():
            inside = [f for f in af if t0 <= f["ts"] < t1]
            # Strictly BEFORE each edge. A fill landing exactly on t0 belongs to this period's
            # `bought`/`sold`, never to the quantity carried into it - counting it as both
            # subtracts the same trade twice, which is a real bug this had.
            q0, q1 = qty_at(asset, t0 - 1e-6), qty_at(asset, t1 - 1e-6)
            if not inside and q0 <= 1e-12 and q1 <= 1e-12:
                continue
            bought = sum(f["cash"] for f in inside if f["side"] == "buy")
            sold = sum(f["cash"] for f in inside if f["side"] == "sell")
            p0 = _price_at(db, asset, t0, latest) if q0 > 1e-12 else 0.0
            p1 = _price_at(db, asset, min(t1, now), latest) if q1 > 1e-12 else 0.0
            if (q0 > 1e-12 and not p0) or (q1 > 1e-12 and not p1):
                continue  # cannot value an edge, so do not invent a number
            pnl = (q1 * (p1 or 0.0)) - (q0 * (p0 or 0.0)) - bought + sold
            rows.append({
                "asset": asset, "pnl": round(pnl, 2), "bought": round(bought, 2),
                "sold": round(sold, 2), "fees": round(sum(f["fee"] for f in inside), 2),
                "trades": len(inside), "held_start": q0 > 1e-12, "held_end": q1 > 1e-12,
            })
        if not rows:
            continue
        rows.sort(key=lambda r: r["pnl"])
        out.append({"period": name, "start": t0, "end": t1,
                    "assets": rows, "total": round(sum(r["pnl"] for r in rows), 2)})
    return out[::-1]  # newest first


def by_period(db: DB, pid: str) -> dict[str, list[dict]]:
    """Each calendar day, week, month, quarter and year: what the fund did and what was traded.

    `return_pct` is the fund's real move including positions still open, taken from the equity
    curve. `realised` is only the profit from trades actually closed in that period - the two
    differ whenever a winner is still being held, which is normal and not an error.
    """
    closed, _ = replay(db, pid)
    curve = db.query(
        "SELECT ts, equity FROM league_equity WHERE portfolio=? AND lane_id=0 ORDER BY ts", (pid,))
    out: dict[str, list[dict]] = {}
    for name, key in _PERIODS.items():
        buckets: dict[str, dict] = {}
        for row in curve:
            b = buckets.setdefault(key(row["ts"]), {
                "period": key(row["ts"]), "start_value": row["equity"], "end_value": row["equity"],
                "realised": 0.0, "fees": 0.0, "trades": 0, "wins": 0, "start": row["ts"], "end": row["ts"]})
            b["end_value"], b["end"] = row["equity"], row["ts"]
        for t in closed:
            b = buckets.get(key(t["closed"]))
            if b is None:
                continue
            b["realised"] += t["pnl"]
            b["fees"] += t["fees"]
            b["trades"] += 1
            b["wins"] += 1 if t["pnl"] > 0 else 0
        rows = []
        for b in sorted(buckets.values(), key=lambda x: x["start"]):
            b["return_pct"] = round((b["end_value"] / b["start_value"] - 1) * 100, 2) if b["start_value"] else 0.0
            for k in ("start_value", "end_value", "realised", "fees"):
                b[k] = round(b[k], 2)
            rows.append(b)
        out[name] = rows[::-1]  # newest first
    return out


def ledger(db: DB, pid: str, name: str = "") -> dict:
    return {"manager": pid, "name": name or pid, "holdings": holdings(db, pid),
            "trades": trades(db, pid), "periods": by_period(db, pid)}


def activity(db: DB, names: dict[str, str], limit: int = 150) -> dict:
    """Every manager's trades and events, plus what each period made or lost.

    Each sell carries the result of the trade it closed, so the list answers "what did that
    one actually make" without cross-referencing anything.
    """
    managers, league_periods = {}, {}
    for pid, name in names.items():
        closed, _ = replay(db, pid)
        # the sell that finished a trade, so its result can sit on the row
        finals = {(t["lane"], round(t["closed"], 3)): t for t in closed}
        fills = db.query(
            "SELECT ts, lane_id, asset, side, qty, cash, fee, reason, strategy FROM fills "
            "WHERE portfolio=? ORDER BY ts DESC LIMIT ?", (pid, limit))
        for f in fills:
            # Only a sell closes a trade. A buy can share a timestamp with the sell that
            # stopped it out, and it must not inherit that trade's result.
            trip = finals.get((f["lane_id"], round(f["ts"], 3))) if f["side"] == "sell" else None
            f["closed_pnl"] = round(trip["pnl"], 2) if trip else None
            f["closed_pnl_pct"] = round(trip["pnl_pct"], 2) if trip else None
        periods = by_period(db, pid)
        managers[pid] = {
            "id": pid, "name": name, "fills": fills, "periods": periods,
            "events": db.query(
                "SELECT ts, level, kind, message, lane_id FROM events WHERE portfolio=? "
                "ORDER BY ts DESC LIMIT ?", (pid, limit)),
            "buys": sum(1 for f in fills if f["side"] == "buy"),
            "sells": sum(1 for f in fills if f["side"] == "sell"),
            "fees": round(sum(f["fee"] for f in fills), 2),
            "booked": round(sum(t["pnl"] for t in closed), 2),
        }
        for span, rows in periods.items():
            bucket = league_periods.setdefault(span, {})
            for r in rows:
                b = bucket.setdefault(r["period"], {"period": r["period"], "start_value": 0.0, "end_value": 0.0,
                                                    "realised": 0.0, "fees": 0.0, "trades": 0, "wins": 0})
                for k in ("start_value", "end_value", "realised", "fees", "trades", "wins"):
                    b[k] += r[k]
    # The same money cut by asset instead of by fund: "what did NEAR cost us last week".
    # by_period answers it per manager and by_asset answers it for an asset's whole life;
    # neither crosses the two, which is the question the owner actually asks.
    per_asset = {span: asset_periods(db, None, span, limit=24) for span in _PERIODS}

    league = {}
    for span, bucket in league_periods.items():
        rows = []
        for b in bucket.values():
            b["return_pct"] = round((b["end_value"] / b["start_value"] - 1) * 100, 2) if b["start_value"] else 0.0
            b["gain"] = round(b["end_value"] - b["start_value"], 2)
            for k in ("start_value", "end_value", "realised", "fees"):
                b[k] = round(b[k], 2)
            rows.append(b)
        league[span] = sorted(rows, key=lambda r: r["period"], reverse=True)
    # The house-wide events nobody owns: engine restarts, radar scans, health warnings.
    system = db.query(
        "SELECT ts, level, kind, message, lane_id FROM events WHERE portfolio IS NULL "
        "AND kind NOT IN ('agent_call') ORDER BY ts DESC LIMIT ?", (limit,))
    return {"managers": managers, "league": league, "system": system, "by_asset": per_asset}
