"""GitHub repo fetcher — README + file tree + key files → markdown."""

from __future__ import annotations

import re
from typing import Any

import httpx

from workers.ingest.fetchers.base import FetcherBase, FetchResult

GITHUB_API = "https://api.github.com"
GITHUB_URL_PATTERN = re.compile(r"^https?://github\.com/([\w.-]+)/([\w.-]+)")


class GitHubFetcher(FetcherBase):
    SOURCE_TYPE = "github"

    @staticmethod
    def matches(url: str) -> bool:
        """Check if URL is a GitHub repo."""
        return bool(GITHUB_URL_PATTERN.match(url))

    def _parse_owner_repo(self, url: str) -> tuple[str, str]:
        match = GITHUB_URL_PATTERN.match(url)
        if not match:
            raise ValueError(f"Not a GitHub repo URL: {url}")
        return match.group(1), match.group(2)

    async def fetch(self, source: str, **kwargs: Any) -> FetchResult:
        owner, repo = self._parse_owner_repo(source)

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Fetch repo metadata
            repo_resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}",
                headers={"Accept": "application/vnd.github.v3+json"},
            )
            repo_resp.raise_for_status()
            repo_data = repo_resp.json()

            # Fetch README
            readme_md = ""
            try:
                readme_resp = await client.get(
                    f"{GITHUB_API}/repos/{owner}/{repo}/readme",
                    headers={"Accept": "application/vnd.github.v3.raw"},
                )
                if readme_resp.status_code == 200:
                    readme_md = readme_resp.text
            except httpx.HTTPError:
                pass

            # Fetch file tree (top-level only to avoid rate limits)
            tree_items = []
            try:
                tree_resp = await client.get(
                    f"{GITHUB_API}/repos/{owner}/{repo}/contents/",
                    headers={"Accept": "application/vnd.github.v3+json"},
                )
                if tree_resp.status_code == 200:
                    for item in tree_resp.json():
                        icon = "📁" if item["type"] == "dir" else "📄"
                        tree_items.append(f"  {icon} {item['name']}")
            except httpx.HTTPError:
                pass

        # Build markdown
        lines = [
            f"# {repo_data.get('full_name', f'{owner}/{repo}')}",
            "",
            f"**Description**: {repo_data.get('description', 'No description')}",
            f"**Language**: {repo_data.get('language', 'Unknown')}",
            f"**Stars**: {repo_data.get('stargazers_count', 0)}",
            f"**Forks**: {repo_data.get('forks_count', 0)}",
            f"**License**: {repo_data.get('license', {}).get('name', 'None') if repo_data.get('license') else 'None'}",
            "",
        ]

        if tree_items:
            lines.extend(["## File Structure", "", *tree_items, ""])

        if readme_md:
            lines.extend(["## README", "", readme_md])

        content_md = "\n".join(lines)
        slug = self.slugify(f"github-{owner}-{repo}")

        return FetchResult(
            slug=slug,
            content_md=content_md,
            metadata={
                "source_url": source,
                "source_type": "github",
                "title": repo_data.get("full_name", f"{owner}/{repo}"),
                "repo_name": f"{owner}/{repo}",
                "language": repo_data.get("language"),
                "stars": repo_data.get("stargazers_count", 0),
                "forks": repo_data.get("forks_count", 0),
                "description": repo_data.get("description", ""),
                "word_count": len(content_md.split()),
            },
            images=self.extract_image_urls(content_md),
        )
