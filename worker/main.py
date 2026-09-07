"""Man Friday render worker — long-polls the Convex renderJobs queue.

Friday Internals contract 1: the queue lives in the DB; this process claims
jobs, renders deterministically, uploads artifacts to Convex storage, and
reports completion. Stateless: safe to run N replicas.

Usage: python main.py [--once]
"""
import platform
import sys
import tempfile
import time
import uuid
from pathlib import Path

import requests
from convex import ConvexClient

from config import CONVEX_URL, WORKER_TOKEN, POLL_SECONDS
from render.stub import render_stub

client = ConvexClient(CONVEX_URL)
WORKER_ID = f"{platform.node()}-{uuid.uuid4().hex[:6]}"


def call(name: str, args: dict):
    return client.mutation(f"worker:{name}", {"token": WORKER_TOKEN, **args})


def upload(path: Path, content_type: str) -> str:
    url = call("uploadUrl", {})
    resp = requests.post(url, data=path.read_bytes(), headers={"Content-Type": content_type}, timeout=120)
    resp.raise_for_status()
    return resp.json()["storageId"]


def process(job: dict) -> None:
    job_id = job["jobId"]
    print(f"[{WORKER_ID}] claimed {job_id} kind={job['kind']}")
    call("heartbeat", {"jobId": job_id})
    try:
        with tempfile.TemporaryDirectory() as tmp:
            video = render_stub(job, Path(tmp))
            video_id = upload(video, "video/mp4")
        call("completeJob", {"jobId": job_id, "videoId": video_id, "costCents": 0})
        print(f"[{WORKER_ID}] done {job_id} -> storage {video_id}")
    except Exception as exc:  # report; failJob re-queues until MAX_ATTEMPTS
        print(f"[{WORKER_ID}] FAILED {job_id}: {exc}", file=sys.stderr)
        call("failJob", {"jobId": job_id, "error": str(exc)[:500]})


def main() -> None:
    once = "--once" in sys.argv
    print(f"[{WORKER_ID}] polling {CONVEX_URL}")
    while True:
        job = call("claimJob", {"workerId": WORKER_ID})
        if job is not None:
            process(job)
            if once:
                return
        else:
            if once:
                print(f"[{WORKER_ID}] queue empty")
                return
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
