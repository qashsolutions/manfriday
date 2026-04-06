"""Write guard — ensures all writes target wiki/ prefix only.

Raises WriteGuardError if anything attempts to write to raw/.
This is a defense-in-depth measure alongside GCS IAM conditions.
"""

from __future__ import annotations


class WriteGuardError(Exception):
    pass


def validate_write_path(user_id: str, path: str) -> None:
    """Validate that a write path targets wiki/ and not raw/.

    Args:
        user_id: User ID (path should start with {user_id}/wiki/)
        path: Full GCS path to validate

    Raises:
        WriteGuardError if path doesn't target wiki/
    """
    # Normalize
    normalized = path.lstrip("/")

    # Must start with user_id
    if not normalized.startswith(f"{user_id}/"):
        raise WriteGuardError(f"Path must start with {user_id}/: {path}")

    # Strip user_id prefix
    relative = normalized[len(user_id) + 1 :]

    # Must be in wiki/ (or memory.md at root)
    allowed_prefixes = ("wiki/", "memory.md")
    if not any(relative.startswith(p) for p in allowed_prefixes):
        raise WriteGuardError(
            f"Compile worker can only write to wiki/ or memory.md. "
            f"Attempted write to: {path}"
        )

    # Explicitly block raw/
    if relative.startswith("raw/"):
        raise WriteGuardError(f"BLOCKED: Attempted write to raw/ — this is immutable: {path}")


def guarded_write_text(user_id: str, path: str, content: str) -> None:
    """Write text to GCS with write guard validation."""
    validate_write_path(user_id, path)
    from shared.python.manfriday_core.gcs import write_text

    write_text(path, content, "text/markdown")
