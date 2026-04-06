"""Data-gap imputer -- finds claims with no source citation, runs web search,
and appends found information to wiki pages with `lint_imputed: true` in frontmatter.

A "data gap" is a page section that makes a factual claim but does not cite
any [[article-slug]] from raw/.  The imputer searches for corroborating info
and appends a clearly-marked block so the user can verify later.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from shared.python.manfriday_core.gcs import read_text, user_path, list_markdown_files
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.write_guard import guarded_write_text
from workers.compile.backlinks import WIKILINK_PATTERN
from workers.lint.web_search import brave_search, results_to_dicts

# Pattern that identifies a source citation: [[some-article-slug]] where the slug
# points to an article in wiki/articles/.  We look for paragraphs without these.
_FRONTMATTER_RE = re.compile(r"^---\n(.+?)\n---", re.DOTALL)

EXTRACT_GAPS_PROMPT = """You are a wiki quality auditor. Read the page below and identify
claims or statements that are NOT backed by a source citation ([[article-slug]] link).

Rules:
- A statement is "cited" if it contains or is near a [[wikilink]] that refers to a source article.
- Ignore section headers, frontmatter, and structural text.
- Return a JSON array of objects, each with:
  - "claim": the uncited sentence (verbatim)
  - "search_query": a concise web search query to verify or enrich this claim

If there are no data gaps, return an empty array: []

Page content:
{content}

Return only the JSON array, no other text."""


@dataclass
class DataGap:
    claim: str
    search_query: str
    page_path: str
    results: list[dict[str, str]] = field(default_factory=list)


async def find_gaps_in_page(
    page_path: str,
    page_content: str,
    user_id: str,
    provider: str = "anthropic",
) -> list[DataGap]:
    """Use LLM to identify uncited claims in a single wiki page.

    Returns:
        List of DataGap objects with claim and search_query populated.
    """
    config = LLMConfig(
        provider=provider,
        temperature=0.1,
        max_tokens=2048,
        system_prompt="You are a citation auditor. Output only valid JSON.",
    )

    response = await call(
        messages=[{
            "role": "user",
            "content": EXTRACT_GAPS_PROMPT.format(content=page_content[:6000]),
        }],
        config=config,
        user_id=user_id,
    )

    import json
    try:
        raw = response.content.strip()
        # Handle markdown-wrapped JSON
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        items = json.loads(raw)
    except (json.JSONDecodeError, IndexError):
        return []

    gaps = []
    for item in items:
        if isinstance(item, dict) and "claim" in item and "search_query" in item:
            gaps.append(
                DataGap(
                    claim=item["claim"],
                    search_query=item["search_query"],
                    page_path=page_path,
                )
            )

    return gaps


async def search_for_gap(gap: DataGap) -> DataGap:
    """Run web search for a single data gap and attach results."""
    try:
        results = await brave_search(gap.search_query, count=3)
        gap.results = results_to_dicts(results)
    except Exception:
        gap.results = []
    return gap


def append_imputed_block(
    user_id: str,
    page_path: str,
    page_content: str,
    gaps_with_results: list[DataGap],
) -> str:
    """Append an imputed-data block to the bottom of a wiki page.

    Marks the page frontmatter with `lint_imputed: true` and adds a clearly
    separated section so the user can review and either keep or remove.

    Returns:
        The updated page content.
    """
    if not gaps_with_results:
        return page_content

    # Filter to gaps that actually got search results
    filled = [g for g in gaps_with_results if g.results]
    if not filled:
        return page_content

    today = date.today().isoformat()

    # Build the imputed block
    lines = [
        "",
        "---",
        "",
        f"> **Lint-imputed data** (added {today}, pending user review)",
        "",
    ]
    for gap in filled:
        lines.append(f"**Claim**: {gap.claim}")
        lines.append("")
        for r in gap.results[:2]:  # max 2 results per claim
            lines.append(f"- [{r['title']}]({r['url']}): {r['snippet'][:200]}")
        lines.append("")

    imputed_section = "\n".join(lines)

    # Add lint_imputed to frontmatter if present
    updated = page_content
    fm_match = _FRONTMATTER_RE.match(updated)
    if fm_match:
        fm_body = fm_match.group(1)
        if "lint_imputed:" not in fm_body:
            new_fm = fm_body + f"\nlint_imputed: true"
            updated = updated[:fm_match.start(1)] + new_fm + updated[fm_match.end(1):]

    # Append the imputed section
    updated = updated.rstrip() + "\n" + imputed_section

    guarded_write_text(user_id, page_path, updated)
    return updated


async def impute_page(
    page_path: str,
    user_id: str,
    provider: str = "anthropic",
    max_gaps: int = 3,
) -> int:
    """Full imputation pipeline for a single page.

    Returns:
        Number of gaps filled with search results.
    """
    content = read_text(page_path)

    # Skip if already imputed this run
    if "lint_imputed: true" in content:
        return 0

    gaps = await find_gaps_in_page(page_path, content, user_id, provider)
    gaps = gaps[:max_gaps]  # cap per page

    for gap in gaps:
        await search_for_gap(gap)

    filled = [g for g in gaps if g.results]
    if filled:
        append_imputed_block(user_id, page_path, content, filled)

    return len(filled)


async def impute_all(
    user_id: str,
    provider: str = "anthropic",
    max_pages: int = 10,
    max_gaps_per_page: int = 3,
) -> int:
    """Run imputation across all entity and concept pages.

    Returns:
        Total number of gaps filled.
    """
    total = 0
    pages_checked = 0

    for subdir in ("entities", "concepts"):
        prefix = user_path(user_id, "wiki", subdir) + "/"
        files = list_markdown_files(prefix)

        for fpath in files:
            if pages_checked >= max_pages:
                return total
            filled = await impute_page(fpath, user_id, provider, max_gaps_per_page)
            total += filled
            pages_checked += 1

    return total
