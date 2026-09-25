"""Brains for the league's managers. Each says, per lane: which asset, and 0-2 clips of $50.

- Quant: lives in the engine (Scout picks + per-lane strategy tournaments).
- Laser: every few hours an AI (Claude, on the Max plan) reads its portfolio, the Scout's candidates, prices
  and news, and sets each lane. Python validates every answer.
- Momentum: holds the strongest movers above their 20-day average; rotates daily.
- Hold: the benchmark. Buys the Scout's picks at league start and just holds them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from . import agents
from .market import asset_class
from .portfolio import Portfolio, Target
from .universe import etf_theme

if TYPE_CHECKING:
    from .engine import Engine


def sleeve_targets(pf: Portfolio, assets: list[str]) -> dict[int, Target]:
    """The ETF sleeve, identical for every manager.

    The sleeve is ballast, not part of the contest: the managers are still judged on the four
    lanes where their brains differ, so all four hold the same funds here and the league table
    keeps measuring the thing that actually varies. One $25 clip fills a sleeve lane.
    """
    out: dict[int, Target] = {}
    for lane, asset in zip([l for l in pf.fund.lanes if l.kind == "etf"], assets):
        if asset:
            out[lane.lane_id] = Target(asset, 1, 8.0, f"ETF sleeve: {etf_theme(asset) or 'fund'}", "sleeve")
    return out


def momentum_targets(pf: Portfolio, picks: dict, max_per_class: int) -> dict[int, Target]:
    m = (picks or {}).get("momentum")
    if not m:
        return {}
    top, wanted, table = m["top"], m["picks"], m["table"]
    lanes = [l for l in pf.fund.lanes if l.status == "active" and l.kind == "main"]
    assigned = {l.lane_id: l.asset for l in lanes if l.asset in top}  # still strong: keep holding
    fresh = [a for a in wanted if a not in assigned.values()]
    out: dict[int, Target] = {}
    for lane in lanes:
        a = assigned.get(lane.lane_id)
        if a is None:
            others = [x for lid, x in assigned.items() if lid != lane.lane_id]
            a = next((c for c in fresh if sum(1 for o in others if asset_class(o) == asset_class(c)) < max_per_class), None)
            if a is None:
                out[lane.lane_id] = Target(lane.asset, 0, 0.0, "no strong mover free for this lane", "momentum")
                continue
            if a in fresh:
                fresh.remove(a)
            assigned[lane.lane_id] = a
            why = "top mover"
        else:
            why = "still a top mover"
        info = table.get(a, {})
        out[lane.lane_id] = Target(a, 2, max(10.0, info.get("monthly_vol", 0.2) * 50),
                                   f"{why}: 30d {info.get('mom30', 0) * 100:+.0f}%, 7d {info.get('mom7', 0) * 100:+.0f}%",
                                   "momentum", (picks or {}).get("ts", 0.0))
    return out


def hold_targets(pf: Portfolio, assets: list[str]) -> dict[int, Target]:
    out = {}
    for lane, asset in zip([l for l in pf.fund.lanes if l.kind == "main"], assets):
        if asset:
            out[lane.lane_id] = Target(asset, 2, 99.0, "buy and hold (benchmark)", "hold")
    return out


def laser_targets(pf: Portfolio, decision: dict | None) -> dict[int, Target]:
    if not decision:
        return {}
    out = {}
    for lane in [l for l in pf.fund.lanes if l.kind == "main"]:
        d = decision["lanes"].get(str(lane.lane_id))
        if d:
            out[lane.lane_id] = Target(d["asset"], d["clips"], d["expected_move_pct"], d["reason"], "laser",
                                       decision.get("ts", 0.0), (decision.get("prices") or {}).get(d["asset"]) or 0.0)
    return out


def laser_decide(ctx: Engine, pf: Portfolio, now: float) -> dict | None:
    """Ask the AI to manage Laser's portfolio. Returns a validated decision, or None."""
    s = ctx.s
    picks = ctx.db.get_state("scout_picks:laser", {}) or ctx.db.get_state("scout_picks", {}) or {}
    ranked = picks.get("ranked", [])
    edges = {c["asset"]: c for c in picks.get("candidates", [])}
    allowed = {r["asset"] for r in ranked} | {l.asset for l in pf.fund.lanes if l.asset}
    rows = []
    for r in ranked[:25]:
        e = edges.get(r["asset"])
        news = ctx.news_scores.get(r["asset"]) or {}
        rows.append(
            f"- {r['asset']} ({'crypto' if r['class'] == 'crypto' else 'stock/ETF'}): 30d {r['mom30'] * 100:+.0f}%, 7d {r['mom7'] * 100:+.0f}%, "
            f"monthly vol {r['monthly_vol'] * 100:.0f}%, 30d max drawdown {r['dd30'] * 100:.0f}%"
            + (f", backtest best {e['strategy']} score {e['edge']:+.1f}" if e else "")
            + (f", news {news['score']:+.2f} ({news['count']} stories)" if news.get("count") else "")
        )
    lanes = []
    for l in pf.lane_rows(ctx, now):
        lanes.append(f"- lane {l['id']}: {l['asset'] or 'empty'}, {l['clips']} clips held, lane value ${l['equity']:.2f}, "
                     f"cash ${l['cash']:.2f}" + (f", 24h {l['day_change_pct']:+.1f}%" if l['day_change_pct'] is not None else "")
                     + (f", cooldown {l['cooldown_h']}h" if l["cooldown_h"] else ""))
    league = ctx.db.get_state("snapshot", {}).get("league", [])
    board = "\n".join(f"- {m['name']}: ${m['total']:.2f} ({m['since_league_pct']:+.2f}% since league start)" for m in league)
    heads = []
    for a in list(pf.assets())[:4] + [r["asset"] for r in ranked[:6]]:
        sc = ctx.news_scores.get(a) or {}
        for h in (sc.get("top") or [])[:2]:
            heads.append(f"{a}: {h['title']}")
    fg = ctx.db.get_state("fear_greed") or {}
    rd = ctx.db.get_state("radar", {}) or {}
    reg = rd.get("regime", {})
    flagged = "\n".join(
        f"- {r['symbol']} ({r['name'][:28]}): {r['signals']}/7 signals, score {r['score']}, 20d {r['r20_pct']:+.0f}%, "
        f"volume {r['rvol']:.1f}x normal, vs market {r['vs_market_pct']:+.0f}%"
        for r in rd.get("alerts", [])[:10])
    prompt = f"""You are "Laser", one of six managers in a paper-trading league. Each manager runs its own $500
(four lanes of $100 + $100 reserve). Target: {s.target.monthly_low * 100:.0f}-{s.target.monthly_high * 100:.0f}% a month, and beat the other managers.
You are the only manager with no mandate - you may hold crypto, S&P giants or funds. Your rivals are pinned to
one slice each: S&P giants, funds only, crypto on Coinbase, and a momentum rotation on Crypto.com, plus a
buy-and-hold benchmark. Holding something none of them can hold is worth more than copying the leader.

Rules enforced by code, whatever you decide: each lane holds ONE asset; buys are $50 clips (max 2 per lane,
one clip per 15 minutes); exit on -10% in a day; sell on +15% in a day; every $50 above $100 per lane goes
to a vault; a lane at $70 is closed and refilled. Fees: 0.5% per limit order. Stocks trade only in US hours.
At most {s.scout.max_per_class} lanes of the same type (crypto vs stock/ETF). Changing a lane's asset sells the old one first.

Your lanes now:
{chr(10).join(lanes)}

League standings:
{board or '- just started'}

Candidates (liquid, moving; Python-computed):
{chr(10).join(rows)}

Market: stocks are {reg.get('stocks', '?')} ({reg.get('detail', '')}), VIX {reg.get('vix', '?')}.
Crypto Fear & Greed: {fg.get('value', '?')} ({fg.get('label', '?')})

Radar flagged these (7 indicators: trend, momentum, strength vs market, volume, breakout, movement, news):
{flagged or '- nothing flagged right now'}
Headlines:
{chr(10).join(heads[:14])}

You may use web search to check news or catalysts. Decide each lane for the next few hours.
Answer with only this JSON (one entry per lane 1-4):
{{"lanes": {{"1": {{"asset": "<symbol from the list or your current one>", "clips": 0|1|2, "expected_move_pct": <your expected upside %>, "reason": "<one sentence>"}}, "2": ..., "3": ..., "4": ...}},
 "notes": "<two sentences on your plan>"}}"""
    answer = agents.extract_json(agents.ask(s, ctx.db, "league: Laser manager", prompt, allow_web=True))
    if not answer or not isinstance(answer.get("lanes"), dict):
        return None
    decision, used = {}, []
    for lane in [l for l in pf.fund.lanes if l.kind == "main"]:
        d = answer["lanes"].get(str(lane.lane_id)) or {}
        asset = str(d.get("asset") or lane.asset or "").strip()
        try:
            clips = max(0, min(2, int(d.get("clips", 0))))
            move = max(0.0, min(100.0, float(d.get("expected_move_pct", 0))))
        except (TypeError, ValueError):
            continue
        if asset not in allowed or asset in used:
            continue
        # The ETF lane only ever changes into a fund. Keeping what it holds is always allowed,
        # so a lane grandfathered in before this rule is never force-sold.
        if sum(1 for u in used if asset_class(u) == asset_class(asset)) >= s.scout.max_per_class:
            continue
        used.append(asset)
        decision[str(lane.lane_id)] = {"asset": asset, "clips": clips, "expected_move_pct": move, "reason": str(d.get("reason", ""))[:200]}
    if not decision:
        return None
    result = {"ts": now, "lanes": decision, "notes": str(answer.get("notes", ""))[:500]}
    ctx.db.set_state("brain:laser", result)
    prices = {d["asset"]: (ctx.quotes[d["asset"]].mid if d["asset"] in ctx.quotes else None) for d in decision.values()}
    history = ctx.db.get_state("brain:laser_history", [])[-200:]
    history.append({"ts": now, "lanes": decision, "prices": prices})
    ctx.db.set_state("brain:laser_history", history)
    pf.event("decision", "; ".join(f"lane {k} {v['asset']} x{v['clips']}" for k, v in decision.items()) + f" - {result['notes']}")
    return result
