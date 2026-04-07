"""Sources router — CRUD for sources + suppressed items."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from api.middleware.auth import get_current_user
from api.models.requests import AddSourceRequest, ValidateKeyRequest
from workers.ingest.manifest import read_manifest, write_manifest
from workers.ingest.main import ingest as run_ingest
from shared.python.manfriday_core.llm import validate_key
from shared.python.manfriday_core.secrets import store_byok_key, mask_key, key_exists, get_masked_key
from api.middleware.security import validate_key_limiter, RateLimitExceeded

router = APIRouter()

SUPPORTED_PROVIDERS = ["anthropic", "openai", "gemini"]


@router.get("")
async def list_sources(user: dict = Depends(get_current_user)):
    """List all sources from manifest."""
    entries = read_manifest(user["user_id"])
    return {"sources": entries}


@router.post("")
async def add_source(req: AddSourceRequest, user: dict = Depends(get_current_user)):
    """Add and ingest a new source."""
    result = await run_ingest(
        url=req.url,
        user_id=user["user_id"],
        source_type=req.source_type,
    )
    return result


@router.delete("/{slug}")
async def remove_source(slug: str, user: dict = Depends(get_current_user)):
    """Remove a source from manifest (marks as removed, doesn't delete raw/)."""
    entries = read_manifest(user["user_id"])
    found = False
    for entry in entries:
        if entry["slug"] == slug:
            entry["removed"] = True
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"Source not found: {slug}")

    write_manifest(user["user_id"], entries)
    return {"removed": slug}


@router.get("/suppressed")
async def list_suppressed(user: dict = Depends(get_current_user)):
    """List quality-suppressed items."""
    entries = read_manifest(user["user_id"])
    suppressed = [e for e in entries if e.get("quality_suppressed")]
    return {"suppressed": suppressed}


@router.post("/suppressed/{slug}/restore")
async def restore_suppressed(slug: str, user: dict = Depends(get_current_user)):
    """Restore a suppressed item to the compile queue."""
    entries = read_manifest(user["user_id"])
    for entry in entries:
        if entry["slug"] == slug:
            entry["quality_suppressed"] = False
            entry["compiled"] = False
            write_manifest(user["user_id"], entries)
            return {"restored": slug}
    raise HTTPException(status_code=404, detail=f"Source not found: {slug}")


@router.get("/settings/providers")
async def get_providers(user: dict = Depends(get_current_user)):
    """Return configured providers with MASKED keys only. NEVER returns actual keys."""
    providers = []
    for p in SUPPORTED_PROVIDERS:
        masked = get_masked_key(p, user["user_id"])
        providers.append({
            "provider": p,
            "configured": masked is not None,
            "masked_key": masked,
        })
    return providers


@router.post("/validate-key")
async def validate_api_key(req: ValidateKeyRequest, user: dict = Depends(get_current_user)):
    """Validate and store a BYOK API key. Returns masked key only — NEVER the actual key."""
    # Rate limit: 5 calls/min/user to prevent brute-force key testing
    try:
        validate_key_limiter.check(user["user_id"])
    except RateLimitExceeded:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Max 5 key validations per minute.",
        )

    valid = await validate_key(req.provider, req.api_key)
    if valid:
        store_byok_key(req.provider, user["user_id"], req.api_key)
        return {
            "valid": True,
            "provider": req.provider,
            "masked_key": mask_key(req.api_key),
        }
    return {"valid": False, "provider": req.provider, "masked_key": None}
