"""Output ingester — re-ingest filed Q&A outputs as first-class compile inputs."""

from __future__ import annotations

from shared.python.manfriday_core.gcs import read_text, list_markdown_files, user_path


def get_unprocessed_outputs(user_id: str) -> list[dict[str, str]]:
    """Find raw/outputs/ files that haven't been compiled into wiki yet.

    Returns:
        List of dicts with path and slug
    """
    outputs_prefix = user_path(user_id, "raw", "outputs") + "/"
    files = list_markdown_files(outputs_prefix)

    wiki_outputs_prefix = user_path(user_id, "wiki", "outputs") + "/"
    wiki_files = list_markdown_files(wiki_outputs_prefix)
    wiki_slugs = {f.split("/")[-1].replace(".md", "") for f in wiki_files}

    unprocessed = []
    for filepath in files:
        slug = filepath.split("/")[-1].replace(".md", "")
        if slug not in wiki_slugs:
            unprocessed.append({"path": filepath, "slug": slug})

    return unprocessed
