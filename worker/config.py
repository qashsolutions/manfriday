"""Worker configuration.

Local dev reads the repo root .env.local; on Railway the same names are set
as service variables (CONVEX_URL preferred, NEXT_PUBLIC_CONVEX_URL accepted).
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

CONVEX_URL = os.environ.get("CONVEX_URL") or os.environ.get("NEXT_PUBLIC_CONVEX_URL")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN")

POLL_SECONDS = 2.0

if not CONVEX_URL or not WORKER_TOKEN:
    raise SystemExit("worker: CONVEX_URL and WORKER_TOKEN are required")
