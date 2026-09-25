"""Export the dashboard as a static page anyone can open, with no engine running.

`highway publish` writes index.html + data.json into data/public. That folder can be opened
straight from disk, copied anywhere, or pushed to GitHub Pages. Nothing is pushed unless you
ask for it: `--push` only works once a git remote is set up in that folder.

What the snapshot contains: the league, day and week tables, radar, trades, events, news and
the AI notes. It contains no API keys, no account details and no real money, but it does show
the whole strategy, so treat a public page as public.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path

from .config import DATA_DIR, Settings
from .dashboard import PAGE, data
from .db import DB

PUBLIC = DATA_DIR / "public"
BANNER = ('<div style="background:#fab219;color:#0b0b0b;padding:6px 16px;font:13px -apple-system,sans-serif">'
          'Paper trading with fake money · snapshot taken {when} · not investment advice</div>')


def export(db: DB, s: Settings, out: Path | None = None) -> Path:
    out = out or PUBLIC
    out.mkdir(parents=True, exist_ok=True)
    payload = data(db)
    blob = json.dumps(payload, default=str)
    (out / "data.json").write_text(blob)
    when = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
    # The data is embedded, so the file also works when opened straight from disk.
    inject = f'<body>\n<script>window.HIGHWAY_SNAPSHOT = {blob};</script>\n' + BANNER.format(when=when)
    html = PAGE.replace("<body>", inject, 1)
    (out / "index.html").write_text(html)
    (out / ".nojekyll").write_text("")  # GitHub Pages: serve files as-is
    return out


def push(out: Path | None = None, message: str | None = None) -> str:
    """Commit and push the snapshot. Only works if you have set up a git remote in that folder."""
    out = out or PUBLIC
    if not (out / ".git").exists():
        return (f"No git repository in {out}. To publish on GitHub Pages:\n"
                f"  cd {out} && git init -b main && git remote add origin <your repo URL>\n"
                f"  then enable Pages for that repo (Settings -> Pages -> Deploy from branch: main)")
    if not shutil.which("git"):
        return "git is not installed"
    cmds = [["git", "add", "-A"],
            ["git", "commit", "-m", message or f"Highway snapshot {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}"],
            ["git", "push", "origin", "HEAD"]]
    log = []
    for cmd in cmds:
        r = subprocess.run(cmd, cwd=out, capture_output=True, text=True)
        log.append((r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr) else "")
        if r.returncode and "nothing to commit" not in (r.stdout + r.stderr):
            return f"{' '.join(cmd)} failed: {(r.stderr or r.stdout).strip()[:300]}"
    return "pushed: " + " | ".join(x for x in log if x)
