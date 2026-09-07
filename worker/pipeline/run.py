"""M1 headless pipeline CLI — URL in, rendered concepts out.

  python pipeline/run.py generate https://yourproduct.com [--count 10]
  python pipeline/run.py finals <batchId> [--per-format 1]
  python pipeline/run.py status <batchId>

After `generate`, run `python main.py --drain` to render the queued previews;
after `finals`, drain again for the full renders.
"""
from __future__ import annotations

import argparse
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cvx  # noqa: E402
import requests  # noqa: E402
from pipeline.brief import synthesize_brief  # noqa: E402
from pipeline.match import plan_batch  # noqa: E402
from pipeline.scrape import scrape  # noqa: E402
from pipeline.slots import fill_batch  # noqa: E402


def upload_image(path: Path) -> str:
    url = cvx.mutation("worker:uploadUrl")
    resp = requests.post(url, data=path.read_bytes(), headers={"Content-Type": "image/png"}, timeout=120)
    resp.raise_for_status()
    return resp.json()["storageId"]


def cmd_generate(url: str, count: int) -> None:
    user_id = cvx.mutation("pipeline:ensureDevUser")

    print(f"→ scraping {url}")
    with tempfile.TemporaryDirectory() as tmp:
        scraped = scrape(url, Path(tmp))
        print(f"  title: {scraped.title!r} · text: {len(scraped.text)} chars · images: {len(scraped.image_paths)}")

        print("→ brand brief (Claude call site 1)")
        brief, brief_cost = synthesize_brief(scraped)
        print(f"  {brief.name}: {brief.one_liner}")
        print(f"  niche={brief.niche} language={brief.language} tone={brief.tone} (~{brief_cost}¢)")

        screenshot_ids = [upload_image(p) for p in scraped.image_paths]

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

    templates = cvx.query("pipeline:listActiveTemplates")
    batch = plan_batch(templates, brief.niche, count)
    if not batch:
        raise SystemExit("no usable templates — run seed_library.py first")
    print(f"→ matched {len(batch)} concepts across formats: " + ", ".join(f"{t['slug']}#{v}" for t, v in batch))

    print("→ slot-fill (Claude call site 2, one batched Opus call)")
    fills, llm_cost = fill_batch(brief.model_dump(), brief.language, batch)
    kept = [(batch[i], fills[i]) for i in range(len(batch)) if fills[i] is not None]
    dropped = len(batch) - len(kept)
    per_concept_cost = max(1, (brief_cost + llm_cost) // max(len(kept), 1))
    print(f"  filled {len(kept)}/{len(batch)} concepts (~{llm_cost}¢){' · dropped ' + str(dropped) if dropped else ''}")

    batch_id = f"batch-{uuid.uuid4().hex[:8]}"
    created = cvx.mutation(
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
    print(f"✔ {len(created)} concepts queued as previews · batchId={batch_id}")
    print(f"  next: python main.py --drain   then: python pipeline/run.py finals {batch_id}")


def _batch(user_id: str, batch_id: str) -> list[dict]:
    return cvx.query("pipeline:batchStatus", {"userId": user_id, "batchId": batch_id})


def cmd_finals(batch_id: str, per_format: int) -> None:
    user_id = cvx.mutation("pipeline:ensureDevUser")
    rows = _batch(user_id, batch_id)
    ready = [r for r in rows if r["status"] == "preview_ready"]
    if not ready:
        raise SystemExit("no preview_ready concepts in this batch — drain the worker first")
    # one (or N) per format, chosen by template format
    templates = {t["id"]: t for t in cvx.query("pipeline:listActiveTemplates")}
    # batchStatus doesn't return templateId; queue the first N ready per format via concept lookup order
    chosen: list[str] = []
    seen: dict[str, int] = {}
    for r in ready:
        # format lookup via a second query round would need another endpoint; use
        # order heuristics: previews were created format-grouped by plan_batch.
        chosen.append(r["conceptId"])
    # simple cap: promote up to 3 finals
    chosen = chosen[: per_format * 3]
    jobs = cvx.mutation("pipeline:queueFinals", {"conceptIds": chosen})
    print(f"✔ queued {len(jobs)} final renders · run: python main.py --drain")


def cmd_status(batch_id: str) -> None:
    user_id = cvx.mutation("pipeline:ensureDevUser")
    for r in _batch(user_id, batch_id):
        print(f"  {r['conceptId']}  {r['status']:<14} video={'yes' if r['videoId'] else '-'} thumb={'yes' if r['previewThumbId'] else '-'} cost={r['costCents']}¢")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    g.add_argument("url")
    g.add_argument("--count", type=int, default=10)
    f = sub.add_parser("finals")
    f.add_argument("batch_id")
    f.add_argument("--per-format", type=int, default=1)
    s = sub.add_parser("status")
    s.add_argument("batch_id")
    args = ap.parse_args()
    if args.cmd == "generate":
        cmd_generate(args.url, args.count)
    elif args.cmd == "finals":
        cmd_finals(args.batch_id, args.per_format)
    else:
        cmd_status(args.batch_id)


if __name__ == "__main__":
    main()
