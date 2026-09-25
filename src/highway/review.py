"""Weekly league review: every 7 days from the league start, for 6 weeks.

Python gathers the facts (scorecards, lane-by-lane results, live-vs-backtest gaps, whether
news scores predicted moves, whether Laser's expected moves were realistic, health). The AI
(Max plan) writes the review, may make up to 3 bounded setting changes, and lists structural
suggestions for the owner. At weeks 4 and 6 it also gives a keep/retire call per manager and,
at week 6, a go/no-go recommendation for real money. Structural changes are never automatic.
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from . import agents
from .config import DATA_DIR
from .health import notify
from . import summaries
from .metrics import scorecard
from .params import SPECS, clamp

if TYPE_CHECKING:
    from .engine import Engine

REPORTS = DATA_DIR / "reports"
LEAGUE_WEEKS = 6


def week_number(e: Engine, now: float) -> int:
    start = e.db.get_state("league_started") or now
    return int((now - start) // (7 * 86400))


def _corr(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 8:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy), 3) if sx and sy else None


def news_predictiveness(e: Engine, since: float) -> dict:
    """Did headline sentiment point the right way over the next 4 hours?"""
    rows = e.db.query(
        "SELECT published, assets, sentiment FROM news WHERE published > ? AND published < ? AND assets != '[]' ORDER BY RANDOM() LIMIT 300",
        (since, time.time() - 4 * 3600),
    )
    xs, ys = [], []
    for r in rows:
        for a in json.loads(r["assets"]):
            p0 = e.db.tick_near(a, r["published"], 600)
            p1 = e.db.tick_near(a, r["published"] + 4 * 3600, 600)
            if p0 and p1:
                xs.append(r["sentiment"])
                ys.append(p1 / p0 - 1)
    hits = sum(1 for x, y in zip(xs, ys) if abs(x) > 0.2 and (x > 0) == (y > 0))
    strong = sum(1 for x in xs if abs(x) > 0.2)
    return {"samples": len(xs), "correlation": _corr(xs, ys), "direction_hit_rate": round(hits / strong, 2) if strong else None}


def laser_calibration(e: Engine, since: float) -> dict:
    """Laser's expected upside vs what its picks actually did over the next 24 hours."""
    expected, realized = [], []
    for d in e.db.get_state("brain:laser_history", []):
        if d["ts"] < since or d["ts"] > time.time() - 86400:
            continue
        for lane in d["lanes"].values():
            p0 = (d.get("prices") or {}).get(lane["asset"])
            p1 = e.db.tick_near(lane["asset"], d["ts"] + 86400, 1800)
            if lane["clips"] > 0 and p0 and p1:
                expected.append(lane["expected_move_pct"])
                realized.append((p1 / p0 - 1) * 100)
    if not expected:
        return {"samples": 0}
    return {"samples": len(expected), "avg_expected_pct": round(sum(expected) / len(expected), 2),
            "avg_realized_24h_pct": round(sum(realized) / len(realized), 2),
            "picks_up_share": round(sum(1 for r in realized if r > 0) / len(realized), 2)}


def live_vs_backtest(e: Engine, now: float) -> list[dict]:
    """Did the strategy the backtest picked actually deliver, in every manager's lanes?"""
    out = []
    for key, t in e.tournaments.items():
        pid, lane_id = key if isinstance(key, tuple) else (e.primary.id, key)
        c = t.contenders.get(t.leader) if t.leader else None
        if c:
            m = c.sim.metrics()
            out.append({"manager": e.portfolios[pid].name if pid in e.portfolios else pid,
                        "lane": lane_id, "asset": t.asset, "leader": c.strategy.key,
                        "backtest_score": round(c.prior, 1),
                        "live_monthly_pct": m["monthly_pct"], "live_days": round(t.live_days(now), 1)})
    return out


def facts(e: Engine, now: float) -> dict:
    start = e.db.get_state("league_started") or now
    starts = e.db.get_state("league_start_values", {})
    week_start = now - 7 * 86400
    hold = scorecard(e.db, "hold", start, starts.get("hold", 500.0))
    managers = {}
    for pid, pf in e.portfolios.items():
        managers[pf.name] = {
            "since_league_start": scorecard(e.db, pid, start, starts.get(pid, 500.0), hold.get("return_pct")),
            "this_week": scorecard(e.db, pid, max(start, week_start), _value_at(e, pid, max(start, week_start)) or starts.get(pid, 500.0)),
            "lanes": [{"lane": l["id"], "asset": l["asset"], "equity": l["equity"]} for l in pf.lane_rows(e, now)],
        }
    names = {pid: pf.name for pid, pf in e.portfolios.items()}
    week_no = week_number(e, now)
    day_rows = [d for d in summaries.days(e.db) if (d["day"] - 1) // 7 + 1 == max(week_no, 1)]
    changes = e.db.query("SELECT key, old, new, by, reason FROM param_history WHERE ts > ?", (week_start,))
    health = e.db.get_state("health") or {}
    return {
        "week": week_number(e, now),
        "of_weeks": LEAGUE_WEEKS,
        "managers": managers,
        "live_vs_backtest": live_vs_backtest(e, now),
        "news_predictiveness": news_predictiveness(e, week_start),
        "laser_calibration": laser_calibration(e, week_start),
        "health": {c["name"]: f"{c['status']}: {c['detail']}" for c in health.get("checks", [])},
        "days_this_week": [{k: d[k] for k in ("day", "portfolio", "return_pct", "cumulative_pct", "trades", "fees", "rank")} for d in day_rows],
        "weeks_so_far": summaries.weeks(e.db, names),
        "setting_changes_this_week": changes,
        "settings_now": e.params.as_dict(),
    }


def _value_at(e: Engine, pid: str, ts: float) -> float | None:
    rows = e.db.query("SELECT equity FROM league_equity WHERE portfolio=? AND lane_id=0 AND ts>=? ORDER BY ts LIMIT 1", (pid, ts))
    return rows[0]["equity"] if rows else None


def run_review(e: Engine, now: float) -> dict:
    from . import weights
    from .market import MarketData

    f = facts(e, now)
    weight_changes = []
    try:
        wb = weights.run(MarketData(e.s), e.s, e.db, e.params)
        f["weight_backtest"] = {
            "recommendation": wb["recommendation"],
            "table": [{"name": r["name"], "weights": r["weights"], "train": r["train"].get("score"), "test": r["test"].get("score"),
                       "test_monthly_pct": r["test"].get("monthly_pct")} for r in wb["rank"]],
        }
        for c in wb["recommendation"]["changes"]:  # move a quarter of the range per week at most
            spec = SPECS[c["key"]]
            step = 0.25 * (spec.hi - spec.lo)
            value = clamp(c["key"], max(e.params[c["key"]] - step, min(e.params[c["key"]] + step, c["value"])))
            if abs(value - e.params[c["key"]]) > 1e-9:
                weight_changes.append({"key": c["key"], "value": value, "reason": c["reason"]})
    except Exception as ex:
        f["weight_backtest"] = {"error": str(ex)}
    week = f["week"]
    bounds = "\n".join(f"- {k}: now {e.params[k]:g}, allowed {s.lo:g}-{s.hi:g} ({s.help})" for k, s in SPECS.items())
    decision_note = ""
    if week in (4, LEAGUE_WEEKS):
        decision_note = ("\nThis is a decision week. For each manager say KEEP, WATCH or RETIRE with one reason, "
                         "and judge whether the gaps between managers are bigger than normal day-to-day noise.")
    if week >= LEAGUE_WEEKS:
        decision_note += "\nThis is the final week: recommend GO or NO-GO for moving the best manager to real money, and why."
    prompt = f"""You are the weekly reviewer for a paper-trading league (week {week} of {LEAGUE_WEEKS}). Four managers each run $500
under identical hard rules ($50 buys, day exits, a give-back stop, $50 vault skims, $70 floor).
Managers: Quant (backtested strategy tournaments), Laser (AI judgment every few hours), Momentum (top movers), Hold (benchmark).

Facts for this week, computed by Python:
{json.dumps(f, indent=1, default=str)[:14000]}

Tunable settings (you may change at most 3, small steps, only where the facts support it; it is fine to change nothing):
{bounds}
{decision_note}

Remember one week is noisy: prefer small changes and say what evidence would justify bigger ones.
Answer with only this JSON:
{{"summary": "<plain-English review for the owner, 150-250 words: standings, what worked, what didn't, health>",
 "changes": [{{"key": "<setting>", "value": <number>, "reason": "<one sentence>"}}],
 "suggestions": ["<structural idea for the owner to approve, e.g. retire/replace a manager or change a rule>"],
 "verdicts": {{"<manager>": "KEEP|WATCH|RETIRE - reason"}},
 "go_live": null or "GO - reason" or "NO-GO - reason"}}"""
    answer = agents.extract_json(agents.ask(e.s, e.db, f"weekly review {week}", prompt)) or {}
    applied = []
    for ch in (answer.get("changes") or [])[:3]:
        key = ch.get("key")
        if key not in SPECS:
            continue
        try:
            value = float(ch.get("value"))
        except (TypeError, ValueError):
            continue
        spec = SPECS[key]
        step = 0.25 * (spec.hi - spec.lo)
        value = clamp(key, max(e.params[key] - step, min(e.params[key] + step, value)))
        if abs(value - e.params[key]) > 1e-9:
            applied.append({"key": key, "value": value, "reason": str(ch.get("reason", ""))[:300]})
    applied = weight_changes + [a for a in applied if a["key"] not in {w["key"] for w in weight_changes}]
    review = {
        "ts": now,
        "week": week,
        "summary": str(answer.get("summary") or "The AI reviewer was unavailable; facts only.")[:3000],
        "changes": applied,
        "suggestions": [str(x)[:300] for x in (answer.get("suggestions") or [])][:6],
        "verdicts": {str(k): str(v)[:200] for k, v in (answer.get("verdicts") or {}).items()},
        "go_live": answer.get("go_live"),
        "facts": f,
    }
    _write(review)
    reviews = e.db.get_state("weekly_reviews", [])
    reviews.append({k: v for k, v in review.items() if k != "facts"})
    e.db.set_state("weekly_reviews", reviews[-12:])
    notify("Highway weekly review", f"Week {week} of {LEAGUE_WEEKS} review is ready on the dashboard.")
    return review


def _write(review: dict) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    f = review["facts"]
    lines = [f"# Highway league: week {review['week']} of {LEAGUE_WEEKS}",
             f"_{datetime.fromtimestamp(review['ts'], timezone.utc):%Y-%m-%d %H:%M} UTC_", "", review["summary"], "",
             "## Scorecard (since league start)", "",
             "| Manager | Return | Monthly equiv. | Max drawdown | Win rate | Fees | vs Hold |", "|---|---|---|---|---|---|---|"]
    for name, m in f["managers"].items():
        sc = m["since_league_start"]
        lines.append(f"| {name} | {sc.get('return_pct', 0):+.2f}% | {sc.get('monthly_equiv_pct', 0):+.2f}% | {sc.get('max_dd_pct', 0):.2f}% | "
                     f"{sc.get('win_rate') if sc.get('win_rate') is not None else '-'} | ${sc.get('fees', 0):.2f} | "
                     f"{'-' if sc.get('vs_hold_pct') is None else f'{sc['vs_hold_pct']:+.2f}%'} |")
    if review["changes"]:
        lines += ["", "## Setting changes applied", ""] + [f"- `{c['key']}` -> {c['value']:g}: {c['reason']}" for c in review["changes"]]
    if review["suggestions"]:
        lines += ["", "## Suggestions for you to approve", ""] + [f"- {s}" for s in review["suggestions"]]
    if review["verdicts"]:
        lines += ["", "## Manager verdicts", ""] + [f"- **{k}**: {v}" for k, v in review["verdicts"].items()]
    if review.get("go_live"):
        lines += ["", f"## Real money: {review['go_live']}"]
    lines += ["", "## Model checks", "", f"- News predictiveness: {f['news_predictiveness']}",
              f"- Laser calibration: {f['laser_calibration']}", f"- Live vs backtest: {f['live_vs_backtest']}",
              "", "## Health", ""] + [f"- {k}: {v}" for k, v in f["health"].items()]
    (REPORTS / f"week-{review['week']}.md").write_text("\n".join(lines) + "\n")
