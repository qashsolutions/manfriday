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
    has_presenter = bool(cvx.query("pipeline:brandHasPresenter", {"brandId": brand_id}))
    batch = plan_batch(templates, brief.niche, count, allow_avatar=has_presenter)
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


def generate_variant(
    user_id: str,
    concept_id: str,
    language: str,
    language_style: str | None = None,
    request_id: str | None = None,
) -> dict:
    """docs/language-ux.md §2 — "also in": re-slot-fill one kept concept in
    another market's language (never a word-for-word translation) and queue
    its final render as a variant of the original."""
    ctx = cvx.query("pipeline:variantContext", {"conceptId": concept_id})
    if not ctx:
        raise RuntimeError("variant source concept not found")
    if request_id:
        cvx.mutation("worker:updatePipelineRequest", {"requestId": request_id, "status": "drafting", "brandId": ctx["brandId"]})

    brief = dict(ctx["brief"])
    brief["language"] = language
    if language_style:
        brief["languageStyle"] = language_style
    brief["source_post_in_" + ctx["sourceLanguage"]] = ctx["sourceSlots"]  # same angle, new market
    template = ctx["template"]
    fills, llm_cost = fill_batch(brief, language, [(template, 0)])
    if not fills or fills[0] is None:
        raise RuntimeError("slot-fill produced no valid variant")

    batch_id = f"variant-{uuid.uuid4().hex[:8]}"
    args = {
        "userId": ctx["userId"],
        "brandId": ctx["brandId"],
        "briefVersion": ctx["briefVersion"],
        "language": language,
        "batchId": batch_id,
        "concepts": [
            {
                "templateId": template["id"],
                "specVersion": template["specVersion"],
                "slots": fills[0],
                "kind": "final",
                "priority": 20,
                "llmCostCents": max(1, llm_cost),
                "variantOf": concept_id,
            }
        ],
    }
    if language_style:
        args["languageStyle"] = language_style
    cvx.mutation("pipeline:createConcepts", args)
    return {"brandId": ctx["brandId"], "batchId": batch_id, "conceptCount": 1}
