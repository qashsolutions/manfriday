"""Health checks: is every part of the league working and obeying the rules? Runs every minute.

Each check is ok / warn / fail with a plain-English detail. Failures are logged as events and
raise a Mac notification when they first appear.
"""

from __future__ import annotations

import subprocess
import time
from typing import TYPE_CHECKING

from .calendar import equity_market_open, minutes_since_open
from .market import asset_class
from .metrics import reconcile
from .risk import day_change

if TYPE_CHECKING:
    from .engine import Engine


def _c(name: str, status: str, detail: str) -> dict:
    return {"name": name, "status": status, "detail": detail}


def run(e: Engine, now: float) -> list[dict]:
    checks = []
    s = e.s
    open_now = equity_market_open(now)

    # 1. prices
    stale = []
    held = {a for pf in e.portfolios.values() for a in pf.assets()}
    for a in sorted(e.all_assets()):
        q = e.quotes.get(a)
        crypto = asset_class(a) == "crypto"
        limit = s.rules.max_quote_age_seconds if crypto else s.rules.max_equity_quote_age_seconds
        if q is None and a not in held:
            continue  # a candidate added this tick, waiting for its first quote
        if (crypto or open_now) and (q is None or now - q.ts > limit):
            stale.append(a)
    checks.append(_c("Prices", "ok" if not stale else "warn" if len(stale) <= 2 else "fail",
                     "all fresh" if not stale else f"stale: {', '.join(stale)}"))

    # 2. strategy bars (Quant tournaments and the watchlist)
    late = []
    for t in [*e.tournaments.values(), *e.bench.values()]:
        if not t.last_bar_ts:
            continue
        crypto = asset_class(t.asset) == "crypto"
        since_open = minutes_since_open(now)
        settled = since_open is not None and since_open > 90  # the first hourly bar closes an hour in
        if (crypto and now - t.last_bar_ts > 3 * s.bar_minutes * 60) or (not crypto and settled and now - t.last_bar_ts > 3 * 3600):
            late.append(t.asset)
    checks.append(_c("Strategy bars", "ok" if not late else "warn", "on schedule" if not late else f"behind: {', '.join(late)}"))

    # 3. news feeds
    feeds = e.db.get_state("feed_health", {})
    failing = [k for k, v in feeds.items() if now - v.get("ok_ts", 0) > 3600]
    checks.append(_c("News feeds", "ok" if not failing else "warn" if len(failing) < max(2, len(feeds) // 2) else "fail",
                     f"{len(feeds) - len(failing)}/{len(feeds)} responding" + (f"; down over 1h: {', '.join(failing[:5])}" if failing else "")))

    # 4. AI calls (Claude on the Max plan: Laser, Scout review, Coach, news checks)
    from . import agents

    used = agents.calls_today(e.db)
    errors = e.db.query("SELECT COUNT(*) AS n FROM events WHERE kind='agent_error' AND ts > ?", (now - 86400,))[0]["n"]
    last = (e.db.get_state("brain:laser") or {}).get("ts", 0)
    overdue = now - last > 2.5 * e.params["laser_manager_hours"] * 3600
    status = "fail" if overdue and errors else "warn" if overdue or errors or used >= s.agents.max_claude_calls_per_day else "ok"
    checks.append(_c("AI calls", status, f"{used}/{s.agents.max_claude_calls_per_day} calls today, {errors} errors in 24h"
                     + (f"; Laser last decided {(now - last) / 3600:.0f}h ago" if last else "; Laser has not decided yet")))

    # 5. money reconciliation + total cap, per portfolio
    worst, detail = 0.0, []
    for pid, pf in e.portfolios.items():
        gap = reconcile(pf.fund, e.db, pid)
        worst = max(worst, abs(gap))
        if abs(gap) > 0.01:
            detail.append(f"{pf.name} off by ${gap:+.2f}")
        if pf.fund.capital_in > s.capital.total_risk_cap + 1e-6:
            detail.append(f"{pf.name} over the $500 cap")
    checks.append(_c("Money adds up", "ok" if not detail else "fail", "every portfolio reconciles to the cent" if not detail else "; ".join(detail)))

    # 6. rule compliance
    problems = []
    big = e.db.query("SELECT COUNT(*) AS n FROM fills WHERE side='buy' AND cash > ?", (s.capital.max_buy + 0.005,))[0]["n"]
    if big:
        problems.append(f"{big} buys over ${s.capital.max_buy:.0f}")
    for pf in e.portfolios.values():
        for lane in pf.fund.lanes:
            q = e.fresh(lane, now) if lane.asset else None
            if not q:
                continue
            if lane.equity(q.bid) > s.capital.lane_cap + 1.0:
                problems.append(f"{pf.name} lane {lane.lane_id} above ${s.capital.lane_cap:.0f}")
            if lane.has_position and e.market_open(lane, now):
                ch = day_change(lane, q.bid, lambda ts: e.db.tick_near(lane.asset, ts, 900), now, s.rules.day_window_hours)
                if ch is not None and ch * 100 <= s.rules.stop_loss_day_pct - 1.0:
                    problems.append(f"{pf.name} lane {lane.lane_id} down {ch * 100:.1f}% today but not sold")
    checks.append(_c("Rules obeyed", "ok" if not problems else "fail", "$50 buys, day exits, $150 cap all respected" if not problems else "; ".join(problems)))

    # 6a. The owner's rule is that a stop or take-profit fires on every position, every time.
    # That can only be true if every position is actually being checked, so this asks the
    # question the "Rules obeyed" check cannot: is anything held that we currently cannot price?
    # Such a lane is skipped by every rule above and would otherwise fail completely silently.
    blind = [b for pf in e.portfolios.values() for b in pf.unprotected(now)]
    if blind:
        detail = "; ".join(f"{b['name']} lane {b['lane']} {b['asset']}: {b['why']} for {b['minutes']:.0f} min"
                           for b in blind[:4])
    else:
        watched = sum(1 for pf in e.portfolios.values() for l in pf.fund.lanes if l.has_position)
        detail = f"all {watched} open position{'' if watched == 1 else 's'} checked on every price tick"
    checks.append(_c("Exit rules watching", "ok" if not blind else "fail", detail))

    # 6b. the same question asked of the record, not just of right now. A breach that came and
    # went leaves no trace in a snapshot, so this replays every position the league has held.
    try:
        from . import audit

        a = audit.report(e.db, s, {pid: pf.name for pid, pf in e.portfolios.items()})
        late = sum(m["late"] for m in a["managers"])
        hits = sum(m["triggers"] for m in a["managers"])
        detail = (f"{hits} rule triggers, all acted on within {a['tolerance_min']:.0f} min" if not late
                  else f"{late} of {hits} acted on late; worst {max(m['worst_lag_min'] for m in a['managers']):.0f} min")
        checks.append(_c("Guardrail history", "ok" if not late else "fail", detail))
    except Exception as ex:  # an audit must never take the engine down
        checks.append(_c("Guardrail history", "warn", f"audit failed: {type(ex).__name__}"))

    # 7. stuck orders
    stuck = [f"{pf.name} lane {o.lane_id}" for pf in e.portfolios.values() for o in pf.orders
             if now - o.placed > 3 * e.bar_seconds and (asset_class(o.asset) == "crypto" or open_now)]
    checks.append(_c("Orders", "ok" if not stuck else "warn", "none stuck" if not stuck else f"stuck: {', '.join(stuck)}"))

    # 8. uptime since the league started (catches the Mac sleeping)
    start = e.db.get_state("league_started") or now
    elapsed = now - start
    if elapsed > 1800:
        n = e.db.query("SELECT COUNT(*) AS n FROM league_equity WHERE portfolio=? AND lane_id=0 AND ts>=?", (e.primary.id, start))[0]["n"]
        uptime = min(100.0, n * 300 / elapsed * 100)
        checks.append(_c("Uptime", "ok" if uptime >= 97 else "warn" if uptime >= 85 else "fail",
                         f"{uptime:.1f}% since the league started" + ("" if uptime >= 97 else " (was the Mac asleep?)")))
    return checks


def notify(title: str, message: str) -> None:
    """Mac notification (best effort)."""
    safe = message.replace('"', "'")[:220]
    try:
        subprocess.run(["osascript", "-e", f'display notification "{safe}" with title "{title}"'], timeout=5, capture_output=True)
    except Exception:
        pass


def update(e: Engine, now: float) -> dict:
    checks = run(e, now)
    order = {"ok": 0, "warn": 1, "fail": 2}
    overall = max((c["status"] for c in checks), key=order.get, default="ok")
    previous = {c["name"]: c["status"] for c in (e.db.get_state("health") or {}).get("checks", [])}
    for c in checks:
        if c["status"] == "fail" and previous.get(c["name"]) != "fail":
            e.db.event("warn", "health", f"health check failed: {c['name']} - {c['detail']}")
            notify("Highway: check failed", f"{c['name']}: {c['detail']}")
        elif c["status"] == "ok" and previous.get(c["name"]) == "fail":
            e.db.event("info", "health", f"health check recovered: {c['name']}")
    state = {"ts": now, "overall": overall, "checks": checks}
    e.db.set_state("health", state)
    return state
