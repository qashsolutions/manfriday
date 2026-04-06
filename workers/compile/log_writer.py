"""Log writer — append-only entries to wiki/log.md.

Format:
    ## [YYYY-MM-DD] ingest | {source title}
    Pages updated: [[page1]], [[page2]]
    New pages created: [[new-page]]
    Key takeaways: one sentence
"""

from __future__ import annotations

from datetime import date

from shared.python.manfriday_core.gcs import read_text, exists, user_path
from workers.compile.write_guard import guarded_write_text


def append_log(
    user_id: str,
    action: str,
    title: str,
    details: str,
) -> None:
    """Append entry to wiki/log.md.

    Args:
        user_id: User ID
        action: "ingest" | "query" | "lint" | "compile"
        title: Brief title for the entry
        details: Multi-line details (pages updated, takeaways, etc.)
    """
    log_path = user_path(user_id, "wiki", "log.md")
    today = date.today().isoformat()

    new_entry = f"\n## [{today}] {action} | {title}\n{details}\n"

    if exists(log_path):
        existing = read_text(log_path)
        content = existing + new_entry
    else:
        content = f"# Wiki Log\n\nChronological operations log. Append-only — never edit past entries.\n{new_entry}"

    guarded_write_text(user_id, log_path, content)


def append_ingest_log(
    user_id: str,
    source_title: str,
    pages_updated: list[str],
    pages_created: list[str],
    takeaway: str,
) -> None:
    """Append an ingest entry to log.md."""
    updated = ", ".join(f"[[{p}]]" for p in pages_updated) if pages_updated else "none"
    created = ", ".join(f"[[{p}]]" for p in pages_created) if pages_created else "none"

    details = (
        f"Pages updated: {updated}\n"
        f"New pages created: {created}\n"
        f"Key takeaways: {takeaway}"
    )
    append_log(user_id, "ingest", source_title, details)


def append_query_log(
    user_id: str,
    question: str,
    output_slug: str | None = None,
    filed: bool = False,
) -> None:
    """Append a query entry to log.md."""
    details = f"Output: [[{output_slug}]] | Filed: {'yes' if filed else 'no'}" if output_slug else "Filed: no"
    append_log(user_id, "query", question[:80], details)


def append_lint_log(
    user_id: str,
    contradictions: int = 0,
    stale: int = 0,
    orphans: int = 0,
    gaps_filled: int = 0,
    queued: int = 0,
) -> None:
    """Append a lint entry to log.md."""
    details = (
        f"Contradictions: {contradictions} | Stale: {stale} | Orphans: {orphans} | "
        f"Gaps filled: {gaps_filled} | Queued: {queued}"
    )
    append_log(user_id, "lint", "health check", details)
