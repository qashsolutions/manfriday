"""Queue writer -- generate and write article candidates to wiki/lint_queue.md.

Reads existing queue, deduplicates, merges new suggestions, and writes back.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from shared.python.manfriday_core.gcs import user_path
from workers.compile.lint_queue import read_lint_queue, write_lint_queue


@dataclass
class ArticleCandidate:
    topic: str
    rationale: str

    def to_dict(self) -> dict[str, str]:
        return {
            "topic": self.topic,
            "rationale": self.rationale,
            "status": "pending",
        }


def merge_candidates(
    user_id: str,
    new_candidates: list[ArticleCandidate],
    max_pending: int = 25,
) -> int:
    """Merge new article candidates into lint_queue.md, deduplicating by topic.

    Args:
        user_id: User ID.
        new_candidates: New candidates to add.
        max_pending: Cap on total pending items to avoid unbounded growth.

    Returns:
        Number of candidates actually added (after dedup).
    """
    existing = read_lint_queue(user_id)
    existing_topics = {item["topic"].lower().strip() for item in existing}

    added = 0
    for candidate in new_candidates:
        normalised = candidate.topic.lower().strip()
        if normalised in existing_topics:
            continue
        if len(existing) >= max_pending:
            break
        existing.append(candidate.to_dict())
        existing_topics.add(normalised)
        added += 1

    write_lint_queue(user_id, existing)
    return added


def build_candidate_from_mentions(
    entity_or_concept: str,
    mention_count: int,
    page_type: str = "entity",
) -> ArticleCandidate:
    """Create a candidate from a frequently-mentioned but missing page.

    Args:
        entity_or_concept: The name as it appears in [[wikilinks]].
        mention_count: How many pages reference it.
        page_type: 'entity' or 'concept'.
    """
    return ArticleCandidate(
        topic=entity_or_concept,
        rationale=(
            f"Mentioned in {mention_count} pages as [[{entity_or_concept}]] "
            f"but no dedicated {page_type} page exists. "
            f"Suggested {date.today().isoformat()} by lint worker."
        ),
    )
