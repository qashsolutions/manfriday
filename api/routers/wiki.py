"""Wiki router — read wiki pages, stats, and recent articles."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from api.middleware.auth import get_current_user
from shared.python.manfriday_core.gcs import read_text, exists, list_markdown_files, user_path

router = APIRouter()


@router.get("/stats")
async def wiki_stats(user: dict = Depends(get_current_user)):
    """Get wiki stats (total pages, entities, concepts, articles)."""
    uid = user["user_id"]
    entities = len(list_markdown_files(user_path(uid, "wiki", "entities") + "/"))
    concepts = len(list_markdown_files(user_path(uid, "wiki", "concepts") + "/"))
    articles = len(list_markdown_files(user_path(uid, "wiki", "articles") + "/"))
    outputs = len(list_markdown_files(user_path(uid, "wiki", "outputs") + "/"))
    total = entities + concepts + articles + outputs

    return {
        "total_pages": total,
        "entities": entities,
        "concepts": concepts,
        "articles": articles,
        "outputs": outputs,
    }


@router.get("/recent")
async def wiki_recent(limit: int = 10, user: dict = Depends(get_current_user)):
    """Get recent wiki articles."""
    uid = user["user_id"]
    articles_prefix = user_path(uid, "wiki", "articles") + "/"
    files = list_markdown_files(articles_prefix)

    recent = []
    for path in files[:limit]:
        filename = path.split("/")[-1]
        slug = filename.replace(".md", "")
        title = slug
        summary = ""
        try:
            content = read_text(path)
            for line in content.split("\n"):
                line = line.strip()
                if line.startswith("title:"):
                    title = line.split(":", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("# ") and title == slug:
                    title = line[2:].strip()
                elif line and not line.startswith("---") and not line.startswith("type:") and not line.startswith("created:") and not line.startswith("updated:") and not line.startswith("sources:") and not line.startswith("tags:") and not line.startswith("source_count:"):
                    if not summary and not line.startswith("#"):
                        summary = line[:150]
        except Exception:
            pass

        recent.append({
            "slug": slug,
            "title": title,
            "summary": summary or slug,
            "source_count": 1,
        })

    return recent


@router.get("/{path:path}")
async def read_wiki_page(path: str, user: dict = Depends(get_current_user)):
    """Read a wiki page by path."""
    uid = user["user_id"]

    # Path traversal protection
    if ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path: directory traversal not allowed")

    full_path = user_path(uid, "wiki", path)

    if not full_path.endswith(".md"):
        full_path += ".md"

    # Verify the resolved path stays within the user's wiki directory
    expected_prefix = user_path(uid, "wiki")
    if not full_path.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="Invalid path: outside user wiki")

    if not exists(full_path):
        raise HTTPException(status_code=404, detail=f"Wiki page not found: {path}")

    content = read_text(full_path)
    return {"path": path, "content": content}
