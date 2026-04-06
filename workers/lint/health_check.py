"""Health check — reads CLAUDE.md, index.md, samples wiki pages, and runs
contradiction + stale claim checks.  Returns a structured report without
modifying any files.

Designed for quick diagnostic runs and monitoring dashboards.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from shared.python.manfriday_core.gcs import read_text, exists, list_markdown_files, user_path
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.backlinks import WIKILINK_PATTERN

_FRONTMATTER_RE = re.compile(r"^---\n(.+?)\n---", re.DOTALL)
_UPDATED_RE = re.compile(r"updated:\s*(\d{4}-\d{2}-\d{2})")
_SOURCES_RE = re.compile(r"sources:\s*\[([^\]]*)\]")


@dataclass
class HealthIssue:
    check: str          # "contradiction" | "stale_claim" | "structural"
    severity: str       # "high" | "medium" | "low"
    page: str           # affected page path or name
    detail: str         # human-readable explanation
    suggestion: str = ""  # recommended action


@dataclass
class HealthReport:
    user_id: str
    run_date: str
    pages_sampled: int = 0
    total_pages: int = 0
    issues: list[HealthIssue] = field(default_factory=list)
    claude_md_present: bool = False
    index_md_present: bool = False
    log_md_present: bool = False

    @property
    def issue_count(self) -> int:
        return len(self.issues)

    @property
    def high_severity_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "high")

    def summary(self) -> str:
        return (
            f"Health check for {self.user_id} on {self.run_date}: "
            f"{self.pages_sampled}/{self.total_pages} pages sampled, "
            f"{self.issue_count} issues found "
            f"({self.high_severity_count} high severity)"
        )

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "run_date": self.run_date,
            "pages_sampled": self.pages_sampled,
            "total_pages": self.total_pages,
            "structural": {
                "claude_md": self.claude_md_present,
                "index_md": self.index_md_present,
                "log_md": self.log_md_present,
            },
            "issues": [
                {
                    "check": i.check,
                    "severity": i.severity,
                    "page": i.page,
                    "detail": i.detail,
                    "suggestion": i.suggestion,
                }
                for i in self.issues
            ],
            "summary": self.summary(),
        }


# ── Structural checks ─────────────────────────────────────


def _check_structural(user_id: str, report: HealthReport) -> None:
    """Verify CLAUDE.md, index.md, log.md exist."""
    report.claude_md_present = exists(user_path(user_id, "CLAUDE.md"))
    report.index_md_present = exists(user_path(user_id, "wiki", "index.md"))
    report.log_md_present = exists(user_path(user_id, "wiki", "log.md"))

    if not report.claude_md_present:
        report.issues.append(HealthIssue(
            check="structural", severity="high",
            page="CLAUDE.md", detail="CLAUDE.md is missing.",
            suggestion="Create CLAUDE.md with operating instructions.",
        ))
    if not report.index_md_present:
        report.issues.append(HealthIssue(
            check="structural", severity="high",
            page="wiki/index.md", detail="index.md is missing.",
            suggestion="Run compile worker to regenerate index.",
        ))
    if not report.log_md_present:
        report.issues.append(HealthIssue(
            check="structural", severity="medium",
            page="wiki/log.md", detail="log.md is missing.",
            suggestion="Log will be created on next ingest or lint.",
        ))


# ── Load page contents ────────────────────────────────────


def _load_wiki_pages(
    user_id: str,
    max_pages: int = 30,
) -> list[tuple[str, str]]:
    """Load wiki page paths and contents, sampling up to max_pages.

    Returns:
        List of (path, content) tuples.
    """
    pages: list[tuple[str, str]] = []

    for subdir in ("articles", "entities", "concepts", "outputs"):
        prefix = user_path(user_id, "wiki", subdir) + "/"
        files = list_markdown_files(prefix)
        for fpath in files:
            if len(pages) >= max_pages:
                return pages
            try:
                content = read_text(fpath)
                pages.append((fpath, content))
            except Exception:
                continue

    return pages


def _extract_updated_date(content: str) -> str | None:
    """Extract the `updated:` date from frontmatter."""
    fm = _FRONTMATTER_RE.match(content)
    if not fm:
        return None
    match = _UPDATED_RE.search(fm.group(1))
    return match.group(1) if match else None


def _extract_sources(content: str) -> list[str]:
    """Extract the `sources:` list from frontmatter."""
    fm = _FRONTMATTER_RE.match(content)
    if not fm:
        return []
    match = _SOURCES_RE.search(fm.group(1))
    if not match:
        return []
    raw = match.group(1)
    return [s.strip().strip("'\"") for s in raw.split(",") if s.strip()]


# ── Contradiction check (LLM-powered) ─────────────────────

CONTRADICTION_PROMPT = """You are a wiki consistency auditor. Compare these two wiki pages
and identify any factual contradictions between them.

A contradiction is when Page A states X but Page B states not-X or a conflicting Y
about the same subject.

Page A ({path_a}):
{content_a}

Page B ({path_b}):
{content_b}

If there are contradictions, return a JSON array of objects:
[{{"claim_a": "...", "claim_b": "...", "subject": "...", "severity": "high|medium"}}]

If no contradictions, return: []

Return only the JSON array."""


async def check_contradictions(
    pages: list[tuple[str, str]],
    user_id: str,
    provider: str = "anthropic",
    max_comparisons: int = 15,
) -> list[HealthIssue]:
    """Compare pairs of pages for contradictions using LLM.

    We compare pages that share common wikilinks (likely about same topic).
    """
    import json

    # Build wikilink index to find overlapping pages
    link_index: dict[str, list[int]] = {}
    for idx, (path, content) in enumerate(pages):
        links = set(WIKILINK_PATTERN.findall(content))
        for link in links:
            link_index.setdefault(link, []).append(idx)

    # Find page pairs that share wikilinks (high chance of discussing same topic)
    pairs_seen: set[tuple[int, int]] = set()
    pairs: list[tuple[int, int]] = []
    for indices in link_index.values():
        for i in range(len(indices)):
            for j in range(i + 1, len(indices)):
                pair = (min(indices[i], indices[j]), max(indices[i], indices[j]))
                if pair not in pairs_seen:
                    pairs_seen.add(pair)
                    pairs.append(pair)
                if len(pairs) >= max_comparisons:
                    break

    config = LLMConfig(
        provider=provider,
        temperature=0.0,
        max_tokens=1024,
        system_prompt="You are a factual consistency checker. Output only valid JSON.",
    )

    issues: list[HealthIssue] = []

    for idx_a, idx_b in pairs[:max_comparisons]:
        path_a, content_a = pages[idx_a]
        path_b, content_b = pages[idx_b]

        # Truncate for token economy
        prompt = CONTRADICTION_PROMPT.format(
            path_a=path_a.split("/")[-1],
            content_a=content_a[:3000],
            path_b=path_b.split("/")[-1],
            content_b=content_b[:3000],
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
            contradictions = json.loads(raw)
        except Exception:
            continue

        for c in contradictions:
            if not isinstance(c, dict):
                continue
            issues.append(HealthIssue(
                check="contradiction",
                severity=c.get("severity", "medium"),
                page=f"{path_a.split('/')[-1]} vs {path_b.split('/')[-1]}",
                detail=f"On '{c.get('subject', '?')}': "
                       f"A says '{c.get('claim_a', '?')}', "
                       f"B says '{c.get('claim_b', '?')}'",
                suggestion="Resolve by checking the newer source and updating the stale page.",
            ))

    return issues


# ── Stale claim check ─────────────────────────────────────


def check_stale_claims(
    pages: list[tuple[str, str]],
) -> list[HealthIssue]:
    """Detect pages whose sources have been superseded by newer pages.

    A page is "stale" if another page lists the same source slug but has a
    more recent `updated` date, suggesting the newer page has fresher info.
    """
    issues: list[HealthIssue] = []

    # Map source slug -> list of (path, updated_date)
    source_to_pages: dict[str, list[tuple[str, str]]] = {}
    for path, content in pages:
        sources = _extract_sources(content)
        updated = _extract_updated_date(content) or "1970-01-01"
        for src in sources:
            source_to_pages.setdefault(src, []).append((path, updated))

    for src, page_list in source_to_pages.items():
        if len(page_list) < 2:
            continue
        # Sort by date descending
        sorted_pages = sorted(page_list, key=lambda x: x[1], reverse=True)
        newest_date = sorted_pages[0][1]
        for path, updated in sorted_pages[1:]:
            # If a page is 30+ days behind the newest, flag it
            try:
                newest = date.fromisoformat(newest_date)
                this = date.fromisoformat(updated)
                delta = (newest - this).days
            except ValueError:
                continue
            if delta >= 30:
                name = path.split("/")[-1]
                issues.append(HealthIssue(
                    check="stale_claim",
                    severity="medium",
                    page=name,
                    detail=(
                        f"Page was last updated {updated} but source '{src}' has a "
                        f"newer treatment dated {newest_date} ({delta} days newer)."
                    ),
                    suggestion=f"Re-compile from source '{src}' or manually review.",
                ))

    return issues


# ── Main health check ─────────────────────────────────────


async def run_health_check(
    user_id: str,
    provider: str = "anthropic",
    max_pages: int = 30,
) -> HealthReport:
    """Run full health check and return structured report.

    This is read-only -- it does not modify any wiki files.
    """
    report = HealthReport(
        user_id=user_id,
        run_date=date.today().isoformat(),
    )

    # 1. Structural checks
    _check_structural(user_id, report)

    # 2. Load sampled pages
    all_files = list_markdown_files(user_path(user_id, "wiki") + "/")
    report.total_pages = len(all_files)

    pages = _load_wiki_pages(user_id, max_pages)
    report.pages_sampled = len(pages)

    if not pages:
        return report

    # 3. Contradiction check (LLM)
    contradiction_issues = await check_contradictions(pages, user_id, provider)
    report.issues.extend(contradiction_issues)

    # 4. Stale claim check (heuristic)
    stale_issues = check_stale_claims(pages)
    report.issues.extend(stale_issues)

    return report
