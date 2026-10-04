"""Worker configuration.

Local dev reads the repo root .env.local; on Railway the same names are set
as service variables (CONVEX_URL preferred, NEXT_PUBLIC_CONVEX_URL accepted).
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# override=True: the repo's .env.local is the source of truth — a stale
# ANTHROPIC_API_KEY exported in someone's shell profile must not shadow it.
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local", override=True)

CONVEX_URL = os.environ.get("CONVEX_URL") or os.environ.get("NEXT_PUBLIC_CONVEX_URL")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN")

# Polling costs Convex function calls: two mutations per pass. At a flat 2s that
# is ~2.6M calls a month against a 1M free allowance, for a queue that is empty
# almost all the time. So: poll fast while there is work, back off when idle.
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "2.0"))        # busy
POLL_IDLE_SECONDS = float(os.environ.get("POLL_IDLE_SECONDS", "20.0"))  # fully backed off
POLL_BACKOFF_AFTER = int(os.environ.get("POLL_BACKOFF_AFTER", "10"))    # idle passes before backing off

if not CONVEX_URL or not WORKER_TOKEN:
    raise SystemExit("worker: CONVEX_URL and WORKER_TOKEN are required")
