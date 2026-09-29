"""Command line: `highway run | status | pause | resume | kill | scout | backtest | coach | dashboard`."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from logging.handlers import RotatingFileHandler

from .config import DATA_DIR, load_settings


def _venues(db) -> None:
    """Lane fees depend on which venue lists the asset; load that map in one-off commands too."""
    from . import venues

    venues.set_listings(db.get_state("listings", {}))


def _logging(verbose: bool) -> None:
    (DATA_DIR / "logs").mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [RotatingFileHandler(DATA_DIR / "logs" / "engine.log", maxBytes=5_000_000, backupCount=5)]
    if sys.stdout.isatty():  # under launchd, the rotating file is the only log
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def cmd_run(args, s):
    from .engine import Engine

    Engine(s).run()


def cmd_daily(args, s):
    """One command for the daily review: operational facts, not verdicts on strategy."""
    from . import daily
    from .config import DATA_DIR
    from .db import DB
    from .mandate import names

    db = DB()
    r = daily.report(db, s, names(), DATA_DIR / "logs" / "engine.log")
    problems = []
    print(f"Day {r['day']} · {time.strftime('%Y-%m-%d %H:%M', time.localtime(r['checked']))}\n")

    if r["rows"]:
        print(f"  {'#':>2} {'manager':10}{'start':>9}{'now':>9}{'move':>8}{'trades':>8}{'fees':>7}")
        for x in r["rows"]:
            print(f"  {x['rank']:>2} {x['name']:10}{x['start_value']:>9.2f}{x['end_value']:>9.2f}"
                  f"{x['return_pct']:>7.2f}%{x['trades']:>8}{x['fees']:>7.2f}")
        print()

    def line(ok, good, bad):
        print(f"  {'OK  ' if ok else 'LOOK'}  {good if ok else bad}")
        if not ok:
            problems.append(bad)

    line(not r["health_failing"], "health: all checks passing",
         "health: " + "; ".join(f"{c['name']} ({c['detail'][:50]})" for c in r["health_failing"]))
    line(r["tick_errors"] == 0, "engine: no tick errors since it started",
         f"engine: {r['tick_errors']} ticks raised - {r['last_error']}")
    line(r["guardrails_clean"], "guardrails: every rule fired on time",
         f"guardrails: {len(r['late_rules'])} fired late")
    line(not r["no_candidates"], "scout: every manager has a candidate list",
         "scout: NO CANDIDATES for " + ", ".join(q["name"] for q in r["no_candidates"]))
    quiet = [q for q in r["quiet"] if q["has_candidates"]]
    line(not quiet, "activity: every manager traded in the last 24h",
         "activity: no trades in 24h from " + ", ".join(q["name"] for q in quiet)
         + " (fine if they are holding; suspect if they are in cash)")
    blind = [c for c in r["health_failing"] if c["name"] == "Exit rules watching"]
    line(not blind, "exit rules: every open position is being checked on every price tick",
         "exit rules: A POSITION IS NOT BEING CHECKED - " + "; ".join(c["detail"] for c in blind))
    f = r["fills"]
    if f["unfilled_pct"] is None:
        line(True, "fills: no resting buys have been worked yet", "")
    else:
        # Buys rest at the bid, so ~1 in 5 never fills. That is the design working, not a fault:
        # crossing the spread instead lost money on both test windows.
        line(f["unfilled_pct"] <= 45,
             f"fills: {f['unfilled_pct']:.0f}% of resting buys went unfilled ({f['filled']} filled)",
             f"fills: {f['unfilled_pct']:.0f}% of resting buys went unfilled - far above the ~20% "
             f"the backtest expects; check quotes and the bar clock")

    print()
    print("  nothing needs you today" if not problems else f"  {len(problems)} thing(s) to look at")
    print("\n  A day is not evidence about strategy. Change a rule only from scripts/measure/.")


def cmd_audit(args, s):
    """Replay every position the league has held and check each hard rule fired on time."""
    import time

    from . import audit
    from .db import DB
    from .mandate import names

    db = DB()
    r = audit.report(db, s, names())
    since = time.strftime("%Y-%m-%d %H:%M", time.localtime(r["since"]))
    print(f"Guardrail audit since {since} · a rule counts as late after {r['tolerance_min']:.0f} minutes\n")
    print(f"  {'manager':10}{'rule triggers':>15}{'acted late':>12}{'worst lag':>12}")
    for m in r["managers"]:
        print(f"  {m['manager']:10}{m['triggers']:>15}{m['late']:>12}{m['worst_lag_min']:>10.0f}m")
    if r["breaches"]:
        print("\nlate exits:")
        for b in r["breaches"]:
            when = "never sold" if b["still_open"] else f"sold {b['lag_min']:.0f} min later"
            print(f"  {b['manager']:10} lane {b['lane']} {b['asset']:10} {b['rule']:16} "
                  f"hit {b['value']:+.1f}% (limit {b['threshold']:+.0f}%), {when}")
    print("\n" + ("every hard rule fired on time" if r["clean"] else "SOME RULES FIRED LATE - see above"))


def cmd_rules(args, s):
    """What each exit rule has actually made or lost, per manager."""
    from . import attribution
    from .db import DB
    from .mandate import names

    db = DB()
    r = attribution.report(db, names())
    if not r["league"]:
        print("No closed trades yet, so no rule has made or lost anything.")
        return
    print("What ended each trade, and what it was worth · * = one of the owner's hard rules\n")
    print(f"  {'':2}{'rule':36}{'trades':>7}{'net $':>10}{'avg':>8}")
    for x in r["league"]:
        print(f"  {'*' if x['hard_rule'] else ' '} {x['label']:36}{x['trades']:>5}{x['pnl']:>10.2f}{x['avg_pct']:>7.1f}%")
    print(f"\n  realised across every closed trade: ${r['realised']:.2f}")

    print(f"\n  {'manager':10}{'realised':>10}   what closed its trades")
    for m in r["managers"]:
        detail = ", ".join(f"{x['reason']} {x['pnl']:+.0f}" for x in m["rules"]) or "nothing closed yet"
        print(f"  {m['name']:10}{m['realised']:>10.2f}   {detail}")

    if r["never_fired"]:
        print("\n  Never fired yet, so their level is still untested by live prices:")
        for reason in r["never_fired"]:
            print(f"    - {attribution.label(reason)}")


def cmd_assets(args, s):
    """Every asset the league has held, and what it has made or lost since the first buy."""
    import time

    from .db import DB
    from .mandate import names
    from .metrics import assets

    r = assets(DB(), names())
    rows = r["league"]
    if not rows:
        print("Nothing has been bought yet.")
        return
    if not args.all:
        rows = [x for x in rows if x["holding"] or x["trades"]]
    print("What each asset has made or lost since the day it was first bought\n")
    print(f"  {'asset':12}{'first bought':>14}{'trips':>6}{'held':>6}{'put in':>9}"
          f"{'booked':>9}{'on paper':>10}{'TOTAL':>9}{'':>7}  who")
    for a in rows:
        when = time.strftime("%b %-d", time.localtime(a["first_bought"]))
        print(f"  {a['asset']:12}{when:>14}{a['trades']:>6}{'yes' if a['holding'] else '-':>6}"
              f"{a['bought']:>9.0f}{a['realised']:>9.2f}{a['unrealised']:>10.2f}"
              f"{a['total']:>9.2f}{a['total_pct']:>6.1f}%  {len(a['managers'])}")
    print(f"\n  every asset together: ${sum(a['total'] for a in rows):.2f}")
    worst = rows[0] if rows else None
    if worst and worst["trades"] >= 3 and worst["total"] < 0:
        print(f"\n  {worst['asset']} is the biggest drag: {worst['trades']} separate trades across "
              f"{len(worst['managers'])} manager(s) for ${worst['total']:.2f}.")
        print("  Worth asking why it keeps being picked, not just why each trade went wrong.")


def cmd_status(args, s):
    from .db import DB

    snap = DB().get_state("snapshot")
    if not snap:
        print("No snapshot yet. Is the engine running? (highway run)")
        return
    age = time.time() - snap["ts"]
    print(f"{'PAUSED' if snap['paused'] else 'running'} · updated {age:.0f}s ago · AI calls today {snap.get('ai_calls_today', 0)}")
    print("LEAGUE (since league start)")
    for i, m in enumerate(snap.get("league", []), 1):
        print(f"  {i}. {m['name']:9s} ${m['total']:7.2f}  {m['since_league_pct']:+6.2f}%  invested ${m['invested']:6.2f}  "
              f"vault ${m['vault']:.2f}  fees ${m['fees_paid']:.2f}  trades {m['trades']:3d}  {', '.join(a or '-' for a in m['assets'])}")
    lanes = {snap.get("primary", "bluechip"): snap["lanes"], **snap.get("managers", {})}
    for pid, rows in lanes.items():
        print(f"{pid}:")
        for l in rows:
            print(f"    lane {l['id']} {str(l['asset']):11s} ${l['equity']:7.2f}  clips {l['clips']}/{l['target_clips']}  {l['target_reason'][:58]}"
                  + (f"  [{l['blocked_by']}]" if l.get("blocked_by") and l["target_clips"] > l["clips"] else ""))


def cmd_pause(args, s):
    (DATA_DIR / "PAUSE").write_text("paused from the command line\n")
    print("Paused: no new buys. Hard exits and skims still run. `highway resume` to continue.")


def cmd_resume(args, s):
    (DATA_DIR / "PAUSE").unlink(missing_ok=True)
    print("Resumed.")


def cmd_kill(args, s):
    (DATA_DIR / "KILL").write_text("kill requested\n")
    print("Kill switch set: the engine will sell every position on its next tick and pause.")


def cmd_scout(args, s):
    from . import agents, scout
    from .db import DB
    from .market import MarketData
    from .news import NewsDesk
    from .params import Params

    db, md = DB(), MarketData(s)
    _venues(db)
    fund = db.load_fund(s)
    orders = {o["lane_id"] for o in db.get_state("orders", [])}
    current = {l.lane_id: l.asset for l in fund.lanes if l.status == "active"} if fund else {}
    pinned = {l.lane_id: l.asset for l in fund.lanes if l.asset and (l.has_position or l.lane_pending > 0 or l.lane_id in orders)} if fund else {}
    picks = scout.pick(md, s, db, Params(db.load_params()), current=current, pinned=pinned)
    if args.claude:
        desk = NewsDesk(s, db, http=md.http)
        heads = {c["asset"]: [h["title"] for h in desk.asset_score(c["asset"])["top"]] for c in picks["candidates"][:12]}
        picks = agents.scout_review(s, db, picks, heads, pinned=pinned)
    print(f"scanned {picks['scanned']}, {picks['qualified']} liquid and moving enough, {len(picks['candidates'])} passed backtests ({picks['seconds']}s)")
    for c in picks["candidates"]:
        print(f"  {c['asset']:9s} {c['class']:6s} score {c['score']:+6.1f}  best {c['strategy']:9s} 30d {c['mom30'] * 100:+5.0f}%")
    print(json.dumps({k: picks.get(k) for k in ("lanes", "bench", "by", "claude_notes", "claude_change", "claude_rejected")}, indent=2))


def cmd_backtest(args, s):
    from . import backtest
    from .market import MarketData
    from .params import Params

    df = backtest.load_history(MarketData(s), s, args.asset)
    for r in backtest.walk_forward(df, s, Params(), args.asset):
        t = r.test
        print(f"{r.strategy:9s} {json.dumps(r.params):40s} test {t['return_pct']:+6.1f}% ({t['monthly_pct']:+6.1f}%/mo) "
              f"dd {t['max_dd_pct']:4.1f}% entries {t['entries']} fees ${t['fees']:.2f} {'PASS' if r.survived else ''}")


def cmd_weights(args, s):
    from . import sim, weights
    from .db import DB
    from .market import MarketData
    from .params import Params

    db = DB()
    params = Params(db.load_params())
    _venues(db)
    sim.set_dd_penalty(params["score_dd_penalty"])
    r = weights.run(MarketData(s), s, db, params)
    print(f"{r['assets']} assets · {r['weeks']['train']} training weeks + {r['weeks']['test']} unseen test weeks "
          f"({r['period']['from']} to {r['period']['to']}; test from {r['period']['test_from']}) · {r['seconds']}s")
    print(f"{'rank weighting':40s} {'vol/30d/7d/drop':>18s} {'train':>7s} {'TEST':>7s} {'test/mo':>8s} {'test dd':>8s} {'beat avg':>8s}")
    for x in r["rank"]:
        w = x["weights"]
        print(f"{x['name']:40s} {w['rank_w_vol']:>4g}/{w['rank_w_mom30']:g}/{w['rank_w_mom7']:g}/{w['rank_w_dd']:<5g}"
              f" {x['train'].get('score', 0):>7.1f} {x['test'].get('score', 0):>7.1f} {x['test'].get('monthly_pct', 0):>7.1f}% "
              f"{x['test'].get('max_dd_pct', 0):>7.1f}% {x['test_beats_universe'] or 0:>8.2f}")
    u = r["rank"][0]["universe_test"]
    print(f"{'(average asset, no picking)':40s} {'':>18s} {'':>7s} {u.get('score', 0):>7.1f} {u.get('monthly_pct', 0):>7.1f}% {u.get('max_dd_pct', 0):>7.1f}%")
    print("momentum 30-day weight:", "  ".join(f"{m['weights']:.1f}: train {m['train'].get('score', 0):.1f} / TEST {m['test'].get('score', 0):.1f}" for m in r["momentum"]))
    rec = r["recommendation"]
    print(f"recommendation: {rec['adopt'] or 'keep current weights'} - {rec['why']}")
    for c in rec["changes"]:
        print(f"   {c['key']} -> {c['value']:g}  ({c['reason']})")
    if args.apply and rec["changes"]:
        for c in rec["changes"]:
            old, new = params.set(c["key"], c["value"])
            db.save_param(c["key"], old, new, "weight backtest", c["reason"])
            print(f"applied {c['key']}: {old:g} -> {new:g}")
        print("The running engine picks these up within 5 minutes.")


def cmd_radar(args, s):
    from . import radar, universe
    from .db import DB
    from .market import MarketData
    from .params import Params
    from .stockdata import StockData, official_provider

    db = DB()
    sd, md = StockData(db), MarketData(s)
    _venues(db)
    if args.rebuild or not universe.load(db).get("meta"):
        print("building the universe from the whole US market…")
        universe.build(sd, md, s, db)
    uni = universe.load(db)
    print("buckets:", ", ".join(f"{universe.BUCKET_LABELS[b]} {n}" for b, n in uni["counts"].items()))
    print("official Nasdaq API:", official_provider() or "not configured (using free endpoints)")
    state = db.get_state("radar") or {}
    if args.scan or not state:
        import threading
        from types import SimpleNamespace

        ctx = SimpleNamespace(db=db, md=md, s=s, stop=threading.Event())  # a scan needs only these engine pieces
        state = radar.Radar(ctx).scan(Params(db.load_params()))
    reg = state.get("regime", {})
    print(f"market: stocks {reg.get('stocks')} · VIX {reg.get('vix')} · {reg.get('detail', '')}")
    print(f"tracked {state.get('tracked', 0)} · alerts {len(state.get('alerts', []))} (need {state.get('min_signals')} of 7 signals)")
    print(f"{'symbol':10s} {'bucket':22s} {'sig':>4s} {'score':>6s} {'20d':>7s} {'vol x':>6s} {'vs mkt':>7s}  indicators")
    for r in (state.get("alerts") or state.get("rows", []))[:20]:
        ind = " ".join(n[:4] for n in radar.INDICATORS if r["passes"][n])
        print(f"{r['symbol']:10s} {(r['buckets'] or ['-'])[0][:22]:22s} {r['signals']:>4d} {r['score']:>6.1f} "
              f"{r['r20_pct']:>6.1f}% {r['rvol']:>6.2f} {r['vs_market_pct']:>6.1f}%  {ind}")
    cands = db.get_state("radar_candidates", {})
    if cands:
        print("backtested:", ", ".join(f"{k} {'PASS ' + str(v['edge']) if v['passed'] else 'failed'}" for k, v in cands.items()))


def cmd_days(args, s):
    from . import summaries
    from .db import DB

    db = DB()
    from .mandate import names as mandate_names
    names = mandate_names()
    rows = summaries.days(db)
    if args.day:
        rows = [r for r in rows if r["day"] == args.day] or summaries.build_day(db, args.day, names)
    if not rows:
        print(f"No completed days yet. The league is on day {summaries.current_day(db)}; day 1 closes 24h after the start.")
        return
    by_day: dict[int, list] = {}
    for r in rows:
        by_day.setdefault(r["day"], []).append(r)
    for day, entries in sorted(by_day.items()):
        print(f"\nDay {day}")
        for r in sorted(entries, key=lambda x: x["rank"]):
            print(f"  {r['rank']}. {names.get(r['portfolio'], r['portfolio']):9s} {r['return_pct']:+6.2f}%  "
                  f"(${r['start_value']:.2f} -> ${r['end_value']:.2f})  since start {r['cumulative_pct']:+6.2f}%  "
                  f"trades {r['trades']:2d}  fees ${r['fees']:.2f}  best {r['best'] or '-'}")
    table = summaries.write_week_table(db, names)
    if table and not args.day:
        print("\n" + table)


def cmd_publish(args, s):
    from . import publish
    from .db import DB

    db = DB()
    out = publish.export(db, s, Path(args.dir) if args.dir else None)
    print(f"wrote {out}/index.html and data.json — open it directly, or host that folder")
    if args.push:
        print(publish.push(out))
    else:
        print("nothing was pushed anywhere (add --push once a git remote is set up in that folder)")


def cmd_dashboard(args, s):
    from .dashboard import serve

    print(f"http://{s.dashboard.host}:{s.dashboard.port}")
    serve(s)


def main(argv=None):
    p = argparse.ArgumentParser(prog="highway", description="Four-lane paper-trading bot")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run", help="run the engine (24/7)").set_defaults(fn=cmd_run)
    sub.add_parser("status", help="one-screen summary").set_defaults(fn=cmd_status)
    sub.add_parser("pause", help="stop new buys").set_defaults(fn=cmd_pause)
    sub.add_parser("resume", help="allow buys again").set_defaults(fn=cmd_resume)
    sub.add_parser("kill", help="sell everything and pause").set_defaults(fn=cmd_kill)
    sc = sub.add_parser("scout", help="re-pick lanes now")
    sc.add_argument("--claude", action="store_true", help="also run the AI review")
    sc.set_defaults(fn=cmd_scout)
    bt = sub.add_parser("backtest", help="walk-forward test one asset")
    bt.add_argument("asset")
    bt.set_defaults(fn=cmd_backtest)
    wt = sub.add_parser("weights", help="backtest Scout/Momentum weightings against alternatives")
    wt.add_argument("--apply", action="store_true", help="adopt the recommendation if it clearly wins")
    wt.set_defaults(fn=cmd_weights)
    sub.add_parser("audit", help="did every hard rule actually fire on time?").set_defaults(fn=cmd_audit)
    sub.add_parser("rules", help="what each exit rule has made or lost, per manager").set_defaults(fn=cmd_rules)
    asn = sub.add_parser("assets", help="what each asset has made or lost since day one of it")
    asn.add_argument("--all", action="store_true", help="include assets with no completed trade yet")
    asn.set_defaults(fn=cmd_assets)
    sub.add_parser("daily", help="the daily check: is anything broken, what happened").set_defaults(fn=cmd_daily)
    rd = sub.add_parser("radar", help="show what the buckets are flagging")
    rd.add_argument("--rebuild", action="store_true", help="rebuild the universe from the whole market")
    rd.add_argument("--scan", action="store_true", help="run a fresh scan now")
    rd.set_defaults(fn=cmd_radar)
    dy = sub.add_parser("days", help="day-by-day and week-by-week results")
    dy.add_argument("--day", type=int, help="just this league day")
    dy.set_defaults(fn=cmd_days)
    pb = sub.add_parser("publish", help="export the dashboard as a static page")
    pb.add_argument("--dir", help="where to write it (default data/public)")
    pb.add_argument("--push", action="store_true", help="also commit and push it (needs a git remote there)")
    pb.set_defaults(fn=cmd_publish)
    sub.add_parser("dashboard", help="serve only the dashboard").set_defaults(fn=cmd_dashboard)
    args = p.parse_args(argv)
    _logging(args.verbose)
    args.fn(args, load_settings())


if __name__ == "__main__":
    main()
