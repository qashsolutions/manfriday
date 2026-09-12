"""Seed the trend-template library: worker/templates/*.json (hand-made) +
worker/templates/lib/*.json (built from curated references by pipeline/build_templates.py),
both keyed into library.json."""
import json
import time
from pathlib import Path

import cvx

TDIR = Path(__file__).resolve().parent / "templates"


def main() -> None:
    meta = json.loads((TDIR / "library.json").read_text())
    files = sorted(TDIR.glob("*.json")) + sorted((TDIR / "lib").glob("*.json"))
    for f in files:
        if f.name == "library.json":
            continue
        structure = json.loads(f.read_text())
        slug = structure["slug"]
        m = meta.get(slug, {})
        cvx.mutation(
            "pipeline:upsertTemplate",
            {
                "slug": slug,
                "format": structure["format"],
                "niches": structure.get("niches", []),
                "hookPattern": structure.get("hookPattern", ""),
                "refUrl": m.get("refUrl", "[PLACEHOLDER-TREND-REF]"),
                "refStats": {
                    "platform": m.get("platform", "tiktok"),
                    "views": m.get("views", 0),
                    "capturedAt": int(time.time() * 1000),
                },
                "structure": structure,
                "specVersion": structure.get("specVersion", 1),
                "engagementScore": m.get("engagementScore", 50),
            },
        )
        print(f"✔ {slug} ({structure['format']})")


if __name__ == "__main__":
    main()
