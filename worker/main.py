"""Man Friday render worker — long-polls the Convex renderJobs queue.

Friday Internals contract 1: the queue lives in the DB; this process claims
jobs, renders deterministically (templateSpec v1.1 plans), uploads artifacts
to Convex storage, and reports completion. Stateless: safe to run N replicas.

Usage: python main.py [--once] [--drain]
  --once   process at most one job, then exit
  --drain  process until the queue is empty, then exit
"""
import platform
import sys
import tempfile
import time
import uuid
from pathlib import Path

import requests

import cvx
from config import POLL_SECONDS
from render.dispatch import render_job

WORKER_ID = f"{platform.node()}-{uuid.uuid4().hex[:6]}"


def upload(path: Path, content_type: str) -> str:
    url = cvx.mutation("worker:uploadUrl")
    resp = requests.post(url, data=path.read_bytes(), headers={"Content-Type": content_type}, timeout=300)
    resp.raise_for_status()
    return resp.json()["storageId"]


def process(job: dict) -> None:
    job_id = job["jobId"]
    fmt = (job.get("template") or {}).get("format")
    print(f"[{WORKER_ID}] claimed {job_id} kind={job['kind']} format={fmt}")
    cvx.mutation("worker:heartbeat", {"jobId": job_id})
    try:
        with tempfile.TemporaryDirectory() as tmp:
            result = render_job(job, Path(tmp))
            args: dict = {"jobId": job_id, "costCents": result["costCents"]}
            if result.get("video"):
                args["videoId"] = upload(result["video"], "video/mp4")
            if result.get("thumb"):
                args["previewThumbId"] = upload(result["thumb"], "image/png")
        cvx.mutation("worker:completeJob", args)
        print(f"[{WORKER_ID}] done {job_id}")
    except Exception as exc:
        print(f"[{WORKER_ID}] FAILED {job_id}: {exc}", file=sys.stderr)
        cvx.mutation("worker:failJob", {"jobId": job_id, "error": str(exc)[:500]})


def main() -> None:
    once = "--once" in sys.argv
    drain = "--drain" in sys.argv
    print(f"[{WORKER_ID}] polling")
    while True:
        job = cvx.mutation("worker:claimJob", {"workerId": WORKER_ID})
        if job is not None:
            process(job)
            if once:
                return
        else:
            if once or drain:
                print(f"[{WORKER_ID}] queue empty")
                return
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
