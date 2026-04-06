"""Lint worker — Cloud Run Job entrypoint for nightly wiki health checks.

Runs all 8 checks:
  1. Contradictions between pages
  2. Stale claims superseded by newer sources
  3. Orphan pages (zero inbound wikilinks)
  4. Missing entity pages (mentioned 3+ times, no dedicated page)
  5. Missing concept pages (same pattern)
  6. Data gaps (claims with no source citation -> web_search)
  7. Cross-reference gaps
  8. Generate 3-5 article suggestions -> lint_queue.md

After all checks: append to log.md and update lint_queue.md.

Usage:
    python -m workers.lint.main --user-id test-user
    python -m workers.lint.main --user-id test-user --provider openai --skip-impute
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

from shared.python.manfriday_core.gcs import (
    read_text,
    exists,
    list_markdown_files,
    user_path,
)
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.write_guard import guarded_write_text
from workers.compile.log_writer import append_lint_log
from workers.compile.backlinks import WIKILINK_PATTERN
from workers.lint.health_check import (
    check_contradictions,
    check_stale_claims,
    HealthIssue,
    _load_wiki_pages,
    _extract_sources,
)
from workers.lint.imputer import impute_all
from workers.lint.queue_writer import (
    merge_candidates,
    build_candidate_from_mentions,
    ArticleCandidate,
)

logger = logging.getLogger(__name__)

_FRONTMATTER_RE = re.compile(r"^---\n(.+?)\n---", re.DOTALL)

# ── Data structures ───────────────────────────────────────


@dataclass
class LintResult:
    contradictions: list[HealthIssue] = field(default_factory=list)
    stale_claims: list[HealthIssue] = field(default_factory=list)
    orphan_pages: list[str] = field(default_factory=list)
    missing_entities: list[tuple[str, int]] = field(default_factory=list)
    missing_concepts: list[tuple[str, int]] = field(default_factory=list)
    data_gaps_filled: int = 0
    cross_ref_gaps: list[tuple[str, str]] = field(default_factory=list)
    article_suggestions: list[ArticleCandidate] = field(default_factory=list)

    @property
    def total_issues(self) -> int:
        return (
            len(self.contradictions)
            + len(self.stale_claims)
            + len(self.orphan_pages)
            + len(self.missing_entities)
            + len(self.missing_concepts)
            + len(self.cross_ref_gaps)
        )

    def summary(self) -> dict:
        return {
            "contradictions": len(self.contradictions),
            "stale_claims": len(self.stale_claims),
            "orphan_pages": len(self.orphan_pages),
            "missing_entities": len(self.missing_entities),
            "missing_concepts": len(self.missing_concepts),
            "data_gaps_filled": self.data_gaps_filled,
            "cross_ref_gaps": len(self.cross_ref_gaps),
            "article_suggestions": len(self.article_suggestions),
            "total_issues": self.total_issues,
        }


# ── Check 3: Orphan pages ────────────────────────────────


def find_orphan_pages(
    user_id: str,
    pages: list[tuple[str, str]],
) -> list[str]:
    """Find pages with zero inbound wikilinks from any other page.

    A page is orphaned if no other page contains [[page-name]] pointing to it.
    Structural files (index, log, backlinks, lint_queue) are excluded.
    """
    # Build set of all page names
    page_names: dict[str, str] = {}  # name -> path
    for path, _ in pages:
        name = path.split("/")[-1].replace(".md", "")
        page_names[name] = path

    # Count inbound links
    inbound: Counter[str] = Counter()
    for _, content in pages:
        links = set(WIKILINK_PATTERN.findall(content))
        for link in links:
            inbound[link] += 1

    orphans = []
    for name, path in page_names.items():
        if inbound.get(name, 0) == 0:
            orphans.append(name)

    return orphans


# ── Check 4 & 5: Missing entity/concept pages ────────────


def find_missing_pages(
    user_id: str,
    pages: list[tuple[str, str]],
    threshold: int = 3,
) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """Find wikilinks mentioned N+ times that have no dedicated page.

    Returns:
        (missing_entities, missing_concepts) — each a list of (name, count).
    """
    # Count all wikilink mentions across all pages
    mention_counts: Counter[str] = Counter()
    for _, content in pages:
        links = WIKILINK_PATTERN.findall(content)
        mention_counts.update(links)

    # Build set of existing page names (from file paths)
    existing_pages: set[str] = set()
    for subdir in ("entities", "concepts", "articles", "outputs"):
        prefix = user_path(user_id, "wiki", subdir) + "/"
        files = list_markdown_files(prefix)
        for fpath in files:
            name = fpath.split("/")[-1].replace(".md", "")
            existing_pages.add(name)

    # Structural pages that shouldn't be flagged
    structural = {"index", "log", "backlinks", "lint_queue"}
    existing_pages.update(structural)

    missing_entities: list[tuple[str, int]] = []
    missing_concepts: list[tuple[str, int]] = []

    for name, count in mention_counts.most_common():
        if name in existing_pages:
            continue
        if count < threshold:
            break  # Counter is sorted desc, so we can stop

        # Heuristic: names that look like proper nouns -> entity,
        # otherwise concept.  Proper nouns: first letter capitalised,
        # contains no hyphens that look like slugs.
        if name[0].isupper() and "-" not in name:
            missing_entities.append((name, count))
        else:
            missing_concepts.append((name, count))

    return missing_entities, missing_concepts


# ── Check 7: Cross-reference gaps ─────────────────────────


def find_cross_ref_gaps(
    pages: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Find pages that mention the same named entities/terms in their body text
    but don't link to each other.

    Returns:
        List of (page_a, page_b) pairs that should probably cross-reference.
    """
    # For each page, extract the set of wikilinks it contains
    page_links: dict[str, set[str]] = {}
    for path, content in pages:
        name = path.split("/")[-1].replace(".md", "")
        page_links[name] = set(WIKILINK_PATTERN.findall(content))

    # Build reverse index: entity -> set of pages that link to it
    entity_to_pages: defaultdict[str, set[str]] = defaultdict(set)
    for page_name, links in page_links.items():
        for link in links:
            entity_to_pages[link].add(page_name)

    # Find pages that share 2+ common link targets but don't link to each other
    gaps: list[tuple[str, str]] = []
    page_names = list(page_links.keys())

    for i in range(len(page_names)):
        for j in range(i + 1, len(page_names)):
            a, b = page_names[i], page_names[j]
            shared = page_links.get(a, set()) & page_links.get(b, set())

            if len(shared) >= 2:
                # They talk about the same things -- do they link to each other?
                a_links_b = b in page_links.get(a, set())
                b_links_a = a in page_links.get(b, set())

                if not a_links_b and not b_links_a:
                    gaps.append((a, b))

    return gaps


# ── Check 8: Article suggestions ──────────────────────────

SUGGEST_ARTICLES_PROMPT = """You are a wiki editor. Based on the current wiki state below,
suggest 3-5 new articles that would strengthen the knowledge base.

Consider:
- Topics mentioned across multiple pages but not fully explored
- Connections between entities that deserve dedicated analysis
- Concepts that need deeper treatment
- Gaps in coverage relative to the user's apparent interests

Current wiki index:
{index_content}

Recent log entries:
{log_tail}

Known orphan pages: {orphans}
Missing entity pages: {missing_entities}
Missing concept pages: {missing_concepts}

Return a JSON array of objects:
[{{"topic": "article-slug", "rationale": "Why this article would be valuable"}}]

Return 3-5 suggestions. Output only the JSON array."""


async def generate_article_suggestions(
    user_id: str,
    result: LintResult,
    provider: str = "anthropic",
) -> list[ArticleCandidate]:
    """Use LLM to suggest 3-5 new articles based on wiki state."""
    import json

    # Read index and log for context
    index_path = user_path(user_id, "wiki", "index.md")
    index_content = ""
    if exists(index_path):
        index_content = read_text(index_path)

    log_path = user_path(user_id, "wiki", "log.md")
    log_tail = ""
    if exists(log_path):
        log_content = read_text(log_path)
        # Take last ~2000 chars
        log_tail = log_content[-2000:] if len(log_content) > 2000 else log_content

    orphan_str = ", ".join(result.orphan_pages[:10]) if result.orphan_pages else "none"
    missing_ent = ", ".join(f"{n}({c})" for n, c in result.missing_entities[:10]) or "none"
    missing_con = ", ".join(f"{n}({c})" for n, c in result.missing_concepts[:10]) or "none"

    config = LLMConfig(
        provider=provider,
        temperature=0.5,
        max_tokens=1024,
        system_prompt="You are a wiki editor. Output only valid JSON.",
    )

    prompt = SUGGEST_ARTICLES_PROMPT.format(
        index_content=index_content[:4000],
        log_tail=log_tail,
        orphans=orphan_str,
        missing_entities=missing_ent,
        missing_concepts=missing_con,
    )

    try:
        response = await call(
            messages=[{"role": "user", "content": prompt}],
            config=config,
            user_id=user_id,
        )
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        suggestions = json.loads(raw)
    except Exception as e:
        logger.warning(f"Failed to generate article suggestions: {e}")
        return []

    candidates = []
    for s in suggestions:
        if isinstance(s, dict) and "topic" in s:
            candidates.append(ArticleCandidate(
                topic=s["topic"],
                rationale=s.get("rationale", "Suggested by lint worker."),
            ))

    return candidates


# ── Orchestrator ──────────────────────────────────────────


async def run_lint(
    user_id: str,
    provider: str = "anthropic",
    skip_impute: bool = False,
    max_pages: int = 50,
) -> LintResult:
    """Run all 8 lint checks for a user's wiki.

    Args:
        user_id: User ID.
        provider: LLM provider for LLM-powered checks.
        skip_impute: If True, skip web-search imputation (check 6).
        max_pages: Max pages to load for analysis.

    Returns:
        LintResult with all findings.
    """
    result = LintResult()

    logger.info(f"Starting lint for {user_id}")

    # Load all wiki pages
    pages = _load_wiki_pages(user_id, max_pages)
    if not pages:
        logger.info(f"No wiki pages found for {user_id}")
        return result

    logger.info(f"Loaded {len(pages)} pages for lint analysis")

    # Check 1: Contradictions (LLM-powered)
    logger.info("Check 1/8: Contradictions")
    result.contradictions = await check_contradictions(pages, user_id, provider)
    logger.info(f"  Found {len(result.contradictions)} contradictions")

    # Check 2: Stale claims (heuristic)
    logger.info("Check 2/8: Stale claims")
    result.stale_claims = check_stale_claims(pages)
    logger.info(f"  Found {len(result.stale_claims)} stale claims")

    # Check 3: Orphan pages
    logger.info("Check 3/8: Orphan pages")
    result.orphan_pages = find_orphan_pages(user_id, pages)
    logger.info(f"  Found {len(result.orphan_pages)} orphan pages")

    # Check 4 & 5: Missing entity and concept pages
    logger.info("Check 4-5/8: Missing entity/concept pages")
    result.missing_entities, result.missing_concepts = find_missing_pages(user_id, pages)
    logger.info(
        f"  Missing entities: {len(result.missing_entities)}, "
        f"concepts: {len(result.missing_concepts)}"
    )

    # Check 6: Data gaps (web search imputation)
    if not skip_impute:
        logger.info("Check 6/8: Data gaps (web search)")
        try:
            result.data_gaps_filled = await impute_all(
                user_id, provider, max_pages=10, max_gaps_per_page=3
            )
            logger.info(f"  Filled {result.data_gaps_filled} data gaps")
        except Exception as e:
            logger.warning(f"  Data gap imputation failed: {e}")
            result.data_gaps_filled = 0
    else:
        logger.info("Check 6/8: Data gaps — SKIPPED")

    # Check 7: Cross-reference gaps
    logger.info("Check 7/8: Cross-reference gaps")
    result.cross_ref_gaps = find_cross_ref_gaps(pages)
    logger.info(f"  Found {len(result.cross_ref_gaps)} cross-ref gaps")

    # Check 8: Article suggestions
    logger.info("Check 8/8: Article suggestions")
    result.article_suggestions = await generate_article_suggestions(
        user_id, result, provider
    )
    logger.info(f"  Generated {len(result.article_suggestions)} suggestions")

    # ── Post-checks: write results ────────────────────────

    # Add missing entities/concepts as queue candidates
    candidates: list[ArticleCandidate] = list(result.article_suggestions)
    for name, count in result.missing_entities[:5]:
        candidates.append(build_candidate_from_mentions(name, count, "entity"))
    for name, count in result.missing_concepts[:5]:
        candidates.append(build_candidate_from_mentions(name, count, "concept"))

    queued = merge_candidates(user_id, candidates)
    logger.info(f"Queued {queued} new article candidates")

    # Append to log.md
    append_lint_log(
        user_id=user_id,
        contradictions=len(result.contradictions),
        stale=len(result.stale_claims),
        orphans=len(result.orphan_pages),
        gaps_filled=result.data_gaps_filled,
        queued=queued,
    )

    summary = result.summary()
    logger.info(f"Lint complete for {user_id}: {summary}")
    return result


# ── CLI entrypoint ────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="ManFriday Lint Worker")
    parser.add_argument("--user-id", required=True, help="User ID to lint")
    parser.add_argument("--provider", default="anthropic", help="LLM provider")
    parser.add_argument(
        "--skip-impute",
        action="store_true",
        help="Skip web-search data gap imputation",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=50,
        help="Max wiki pages to analyse",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    result = asyncio.run(
        run_lint(
            user_id=args.user_id,
            provider=args.provider,
            skip_impute=args.skip_impute,
            max_pages=args.max_pages,
        )
    )

    import json
    print(json.dumps(result.summary(), indent=2))


if __name__ == "__main__":
    main()
