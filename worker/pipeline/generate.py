"""Full generation pass for one user request: scrape → brief → match → fill → queue.

Used by the M1 CLI (run.py) and the M2 onboarding flow (pipelineRequests).
"""
from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import requests

import cvx
from pipeline.brief import synthesize_brief
from pipeline.match import plan_batch
from pipeline.scrape import scrape
from pipeline.slots import fill_batch


def _upload_image(path: Path) -> str:
    url = cvx.mutation("worker:uploadUrl")
    resp = requests.post(url, data=path.read_bytes(), headers={"Content-Type": "image/png"}, timeout=120)
    resp.raise_for_status()
    return resp.json()["storageId"]


def generate_for_user(user_id: str, url: str, count: int = 10, request_id: str | None = None) -> dict:
    def progress(status: str, brand_id: str | None = None):
        if request_id:
            args = {"requestId": request_id, "status": status}
            if brand_id:
                args["brandId"] = brand_id
            cvx.mutation("worker:updatePipelineRequest", args)

    progress("analyzing")
    with tempfile.TemporaryDirectory() as tmp:
        scraped = scrape(url, Path(tmp))
        brief, brief_cost = synthesize_brief(scraped)
        screenshot_ids = [_upload_image(p) for p in scraped.image_paths]

    res = cvx.mutation(
        "pipeline:upsertBrand",
        {
            "userId": user_id,
            "url": url,
            "name": brief.name,
            "oneLiner": brief.one_liner,
            "audience": brief.audience,
            "tone": brief.tone,
            "niche": brief.niche,
            "language": brief.language,
            "screenshotIds": screenshot_ids,
        },
    )
    brand_id, brief_version = res["brandId"], res["briefVersion"]
    progress("drafting", brand_id=brand_id)

    templates = cvx.query("pipeline:listActiveTemplates")
    batch = plan_batch(templates, brief.niche, count)
    if not batch:
        raise RuntimeError("no usable templates in the library")

    fills, llm_cost = fill_batch(brief.model_dump(), brief.language, batch)
    kept = [(batch[i], fills[i]) for i in range(len(batch)) if fills[i] is not None]
    if not kept:
        raise RuntimeError("slot-fill produced no valid concepts")
    per_concept_cost = max(1, (brief_cost + llm_cost) // len(kept))

    batch_id = f"batch-{uuid.uuid4().hex[:8]}"
    cvx.mutation(
        "pipeline:createConcepts",
        {
            "userId": user_id,
            "brandId": brand_id,
            "briefVersion": brief_version,
            "language": brief.language,
            "batchId": batch_id,
            "concepts": [
                {
                    "templateId": template["id"],
                    "specVersion": template["specVersion"],
                    "slots": slots,
                    "kind": "preview",
                    "priority": 5,
                    "llmCostCents": per_concept_cost,
                }
                for (template, _v), slots in kept
            ],
        },
    )
    return {"brandId": brand_id, "batchId": batch_id, "conceptCount": len(kept), "brief": brief.model_dump()}
