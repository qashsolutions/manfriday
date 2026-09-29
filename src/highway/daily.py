"""The daily check: is anything broken, and did anything notable happen?

Built after a manager sat completely inert for hours without a single check noticing. "Made no
trades" and "chose to make no trades" look identical from the outside, so this asks the question
directly rather than waiting for someone to spot it on a chart.

It deliberately reports operational facts, not verdicts on strategy. A day is far too little
evidence to judge a manager: at these volatilities even a genuinely better one finishes a whole
six weeks in front only about two times in five.
"""

from __future__ import annotations

import time

from .config import Settings
from .db import DB


def engine_errors(db: DB, log_path) -> tuple[int, str]:
    """Ticks that raised since the engine last started. A green health page can hide these."""
    try:
        lines = log_path.read_text(errors="ignore").splitlines()
    except Exception:
        return 0, "no log"
    starts = [i for i, l in enumerate(lines) if "engine running" in l]
    tail = lines[starts[-1]:] if starts else lines
    errs = [l for l in tail if "tick failed" in l]
    return len(errs), (errs[-1][:120] if errs else "none")


def quiet_managers(db: DB, names: dict[str, str], hours: float = 24.0) -> list[dict]:
    """Managers that have not traded, and whether they are holding anything.

    Flat and silent is the combination worth a look: a manager fully invested and quiet is
    simply holding, but one sitting in cash and placing nothing may be broken.
    """
    since = time.time() - hours * 3600
    out = []
    from .mandate import MANDATES

    for pid, name in names.items():
        fills = db.query("SELECT COUNT(*) AS n FROM fills WHERE portfolio=? AND ts>?", (pid, since))[0]["n"]
        # The benchmark holds a fixed basket and never scouts, so having no candidate list is
        # correct for it, not a fault.
        needs_list = MANDATES[pid].brain != "hold" if pid in MANDATES else True
        picks = db.get_state(f"scout_picks:{pid}")
        lanes = [v for v in ((picks or {}).get("lanes") or {}).values() if v]
        out.append({"id": pid, "name": name, "fills": fills,
                    "has_candidates": bool(lanes) or not needs_list, "quiet": fills == 0})
    return out


def fill_rate(db: DB, names: dict[str, str]) -> dict:
    """How often a resting buy actually fills.

    Every buy rests at the bid, so it fills only when the price comes back down to us. Measured
    over two years of bars that is the right trade - crossing the spread instead lost on both
    the full history and the recent third - but the backtest works off bar lows, so this is the
    live check on it. Roughly a fifth of attempts going unfilled is normal; far from that means
    the quotes or the bar clock have changed under us.
    """
    filled = unfilled = 0
    for pid in names:
        st = db.get_state(f"fillstats:{pid}", {}) or {}
        filled += int(st.get("filled", 0))
        unfilled += int(st.get("unfilled", 0))
    tried = filled + unfilled
    return {"filled": filled, "unfilled": unfilled,
            "unfilled_pct": round(100 * unfilled / tried, 1) if tried else None}


def report(db: DB, s: Settings, names: dict[str, str], log_path) -> dict:
    from . import audit, summaries

    now = time.time()
    health = db.get_state("health", {}) or {}
    failing = [c for c in health.get("checks", []) if c.get("status") != "ok"]
    errs, last_err = engine_errors(db, log_path)
    guard = audit.report(db, s, names)
    quiet = quiet_managers(db, names)
    day = summaries.current_day(db)
    try:
        rows = summaries.build_day(db, day, names)
    except Exception:
        rows = []
    return {
        "day": day, "checked": now,
        "health_failing": failing,
        "tick_errors": errs, "last_error": last_err,
        "guardrails_clean": guard["clean"],
        "late_rules": [b for b in guard["breaches"]],
        "quiet": [q for q in quiet if q["quiet"]],
        "no_candidates": [q for q in quiet if not q["has_candidates"]],
        "fills": fill_rate(db, names),
        "rows": rows,
    }
