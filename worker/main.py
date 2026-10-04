"""Man Friday render worker — long-polls the Convex renderJobs queue.

Friday Internals contract 1: the queue lives in the DB; this process claims
jobs, renders deterministically (templateSpec v1.1 plans), uploads artifacts
to Convex storage, and reports completion. Stateless: safe to run N replicas.

Usage: python main.py [--once] [--drain]
  --once   process at most one job, then exit
  --drain  process until the queue is empty, then exit
"""
import PIL.features as _pf
if not _pf.check("raqm"):
    print("WARNING: Pillow has no libraqm — Indic text will render unshaped (see CLAUDE.md D6 rendering note)")
import platform
import sys
import tempfile
import time
import uuid
from pathlib import Path

import requests

import cvx
from config import POLL_SECONDS, POLL_IDLE_SECONDS, POLL_BACKOFF_AFTER
from render.dispatch import render_job
from pipeline.generate import generate_for_user, generate_variant

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


def process_pipeline_request(req: dict) -> None:
    rid = req["requestId"]
    print(f"[{WORKER_ID}] pipeline request {rid} kind={req.get('kind', 'generate')}: {req['url']}")
    try:
        if req.get("kind") == "variant":
            result = generate_variant(
                req["userId"], req["conceptId"], req["language"], req.get("languageStyle"), request_id=rid
            )
        else:
            result = generate_for_user(req["userId"], req["url"], request_id=rid)
        cvx.mutation(
            "worker:completePipelineRequest",
            {"requestId": rid, "brandId": result["brandId"], "batchId": result["batchId"]},
        )
        print(f"[{WORKER_ID}] pipeline done {rid}: {result['conceptCount']} concepts queued")
    except Exception as exc:
        print(f"[{WORKER_ID}] pipeline FAILED {rid}: {exc}", file=sys.stderr)
        cvx.mutation("worker:failPipelineRequest", {"requestId": rid, "error": str(exc)[:500]})


def next_delay(idle_passes: int) -> float:
    """Seconds to wait before polling again.

    Fast while work keeps arriving, then a linear ramp to POLL_IDLE_SECONDS once
    the queue has been empty for POLL_BACKOFF_AFTER passes. A job queued during
    the quiet period waits at most POLL_IDLE_SECONDS, which the UI already tells
    the user to expect ("a few minutes").
    """
    if idle_passes <= POLL_BACKOFF_AFTER:
        return POLL_SECONDS
    ramp = min(1.0, (idle_passes - POLL_BACKOFF_AFTER) / 10.0)
    return POLL_SECONDS + (POLL_IDLE_SECONDS - POLL_SECONDS) * ramp


def main() -> None:
    once = "--once" in sys.argv
    drain = "--drain" in sys.argv
    print(f"[{WORKER_ID}] polling")
    idle_passes = 0
    while True:
        did_work = False
        req = cvx.mutation("worker:claimPipelineRequest", {"workerId": WORKER_ID})
        if req is not None:
            process_pipeline_request(req)
            did_work = True
        job = cvx.mutation("worker:claimJob", {"workerId": WORKER_ID})
        if job is not None:
            process(job)
            did_work = True
        if did_work:
            idle_passes = 0
            if once:
                return
        else:
            if once or drain:
                print(f"[{WORKER_ID}] queue empty")
                return
            idle_passes += 1
            time.sleep(next_delay(idle_passes))


if __name__ == "__main__":
    main()
