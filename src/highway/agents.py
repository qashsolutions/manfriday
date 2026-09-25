"""AI agents on your Max plan, via headless `claude -p` (no API key, no API bill).

Python hands each agent a compact set of facts it already computed. The agent answers in
JSON, and Python validates every answer before anything changes. Agents never place orders.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
from datetime import datetime, timezone

from .config import ROOT, Settings
from .db import DB
from .market import asset_class
from .params import SPECS, clamp

log = logging.getLogger(__name__)

AGENT_DIR = ROOT / "data" / "agent_workspace"
# Variables that would make `claude` use an API key or think it is a child session.
_STRIP_ENV = ("ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_CHILD_SESSION",
              "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
              "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_EXECPATH", "CLAUDE_PID", "CLAUDE_EFFORT")


def _env() -> dict:
    env = {k: v for k, v in os.environ.items() if k not in _STRIP_ENV}
    env["PATH"] = ":".join(dict.fromkeys(["/opt/homebrew/bin", "/usr/local/bin", *env.get("PATH", "").split(":")]))
    return env


def calls_today(db: DB) -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return db.get_state("claude_calls", {}).get(today, 0)


def _count_call(db: DB) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    counts = {k: v for k, v in db.get_state("claude_calls", {}).items() if k >= today[:8]}
    counts[today] = counts.get(today, 0) + 1
    db.set_state("claude_calls", counts)


def ask(s: Settings, db: DB, purpose: str, prompt: str, allow_web: bool = False, timeout: int = 900) -> str | None:
    """Run one headless Claude session and return its text answer, or None."""
    if calls_today(db) >= s.agents.max_claude_calls_per_day:
        db.event("warn", "agent_limit", f"{purpose}: daily Claude call limit reached, using Python only")
        return None
    AGENT_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [s.agents.claude_bin, "-p", prompt, "--output-format", "json", "--model", s.agents.claude_model,
           "--no-session-persistence", "--strict-mcp-config"]
    if allow_web:
        cmd += ["--allowedTools", "WebSearch", "WebFetch"]
    started = time.time()
    _count_call(db)
    try:
        out = subprocess.run(cmd, cwd=AGENT_DIR, env=_env(), capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        db.event("warn", "agent_error", f"{purpose}: {e}")
        return None
    raw = out.stdout
    try:
        data = json.loads(raw[raw.index("{"):])
    except ValueError:
        db.event("warn", "agent_error", f"{purpose}: unreadable output: {raw[:200]} {out.stderr[:200]}")
        return None
    if data.get("is_error"):
        db.event("warn", "agent_error", f"{purpose}: {data.get('result')}")
        return None
    db.event("info", "agent_call", f"{purpose} answered in {time.time() - started:.0f}s")
    return data.get("result") or ""


def extract_json(text: str | None) -> dict | None:
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidate = fenced.group(1) if fenced else text[text.find("{"): text.rfind("}") + 1]
    try:
        return json.loads(candidate)
    except ValueError:
        return None


# ---- Scout review --------------------------------------------------------------------------

def scout_review(s: Settings, db: DB, picks: dict, headlines: dict[str, list[str]], pinned: dict[int, str] | None = None) -> dict:
    pinned = pinned or {}
    cands = picks.get("candidates", [])
    def live_txt(c):
        lv = c.get("live") or {}
        if not lv.get("days") or lv.get("return_pct") is None:
            return ""
        return f", live paper {lv['return_pct']:+.1f}% over {lv['days']:.1f}d"
    table = "\n".join(
        f"- {c['asset']} ({'crypto' if c['class'] == 'crypto' else 'stock/ETF'}): score {c['score']:+.1f}, "
        f"best tested strategy {c['strategy']} {c['edge']:+.1f}, 30d {c['mom30'] * 100:+.0f}%, monthly vol {c['monthly_vol'] * 100:.0f}%{live_txt(c)}"
        for c in cands
    )
    lanes = "\n".join(f"- lane {k}: {v}{' (holding a position, cannot change today)' if int(k) in pinned else ''}" for k, v in picks["lanes"].items())
    news = "\n".join(f"{a}: " + " | ".join(h[:3]) for a, h in headlines.items() if h)
    tgt = s.target
    prompt = f"""You are the Scout for a small paper-trading experiment: four lanes of $100, target {tgt.monthly_low * 100:.0f}-{tgt.monthly_high * 100:.0f}% a month.
Code already enforces: max $50 per buy, exit on {s.rules.stop_loss_day_pct:.0f}% in a day, sell on +{s.rules.take_profit_day_pct:.0f}% in a day,
sell on -{s.rules.giveback_pct:.0f}% from the best price since entry, $50 skims to a vault at $150.

Python scanned {picks.get('scanned', '?')} coins and stocks/ETFs; these passed a walk-forward backtest (score = tested monthly return minus a drawdown penalty):
{table}

Current picks:
{lanes}

Recent headlines:
{news}

You may keep the picks, or swap ONE lane that is not holding a position for another candidate in the table.
Rules: at most {s.scout.max_per_class} lanes of the same type (crypto vs stock/ETF); do not pick two assets that move together.
Swap only for a concrete reason (bad news on a pick, or a clearly better candidate). You may use web search to check.

Answer with only this JSON:
{{"replace": null or {{"lane": <lane number>, "asset": "<exact symbol from the table>", "reason": "<one sentence>"}}, "notes": "<two sentences on the lineup>"}}"""
    answer = extract_json(ask(s, db, "scout review", prompt, allow_web=True))
    if not answer:
        return picks
    picks = dict(picks)
    picks["claude_notes"] = str(answer.get("notes", ""))[:600]
    rep = answer.get("replace")
    if isinstance(rep, dict):
        lane, asset = str(rep.get("lane")), str(rep.get("asset", "")).strip()
        valid = {c["asset"] for c in cands}
        others = [v for k, v in picks["lanes"].items() if k != lane]
        same_class = sum(1 for o in others if asset_class(o) == asset_class(asset))
        if (lane in picks["lanes"] and int(lane) not in pinned and asset in valid and asset not in others
                and same_class < s.scout.max_per_class):
            old = picks["lanes"][lane]
            picks["lanes"] = {**picks["lanes"], lane: asset}
            picks["bench"] = [old] + [b for b in picks.get("bench", []) if b not in (asset, old)]
            picks["by"] = "python+claude"
            picks["claude_change"] = f"lane {lane}: {old} -> {asset}: {rep.get('reason', '')}"[:300]
        else:
            picks["claude_rejected"] = f"invalid replacement {rep}"[:300]
    db.set_state("scout_picks", picks)
    return picks


# ---- Coach ---------------------------------------------------------------------------------

def coach(s: Settings, db: DB, report: dict, params: dict[str, float]) -> dict:
    bounds = "\n".join(f"- {k}: now {params[k]}, allowed {spec.lo}-{spec.hi} ({spec.help})" for k, spec in SPECS.items())
    prompt = f"""You are the Coach for a four-lane paper-trading bot (target: {s.target.monthly_low * 100:.0f}-{s.target.monthly_high * 100:.0f}% a month, $100 lanes, $50 buys).
Every lane runs a tournament of strategies on paper and follows the leader. Hard money rules cannot be changed.

Last 24 hours, computed by Python:
{json.dumps(report, indent=1, default=str)[:9000]}

Tunable settings you may adjust:
{bounds}

Suggest at most 3 changes, only where the numbers above support it. Small steps. It is fine to change nothing.
Then write a short plain-English journal entry for the owner (under 150 words): what happened, what worked, what you changed and why.

Answer with only this JSON:
{{"changes": [{{"key": "<setting>", "value": <number>, "reason": "<one sentence>"}}], "journal": "<text>"}}"""
    answer = extract_json(ask(s, db, "nightly coach", prompt))
    if not answer:
        return {"changes": [], "journal": None}
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
        max_step = 0.25 * (spec.hi - spec.lo)  # no big jumps in one night
        value = clamp(key, max(params[key] - max_step, min(params[key] + max_step, value)))
        if abs(value - params[key]) > 1e-9:
            applied.append({"key": key, "value": value, "reason": str(ch.get("reason", ""))[:300]})
    return {"changes": applied, "journal": str(answer.get("journal") or "")[:2000]}


# ---- Headline triage ----------------------------------------------------------------------

def triage(s: Settings, db: DB, asset: str, headlines: list[str], move_1h_pct: float) -> str | None:
    prompt = f"""A trading bot holds a small position in {asset}. These headlines were flagged as possibly critical:
{chr(10).join('- ' + h for h in headlines)}
Price change in the last hour: {move_1h_pct:+.2f}%.
Is this a direct, material threat to {asset} itself (e.g. its own hack, delisting, fraud charge), or noise about something else?
Answer with only this JSON: {{"action": "exit" or "hold", "reason": "<one sentence>"}}"""
    answer = extract_json(ask(s, db, f"news triage {asset}", prompt, timeout=300))
    if not answer or answer.get("action") not in ("exit", "hold"):
        return None
    db.event("info", "triage", f"{asset}: {answer['action']} - {answer.get('reason', '')}")
    return answer["action"]
