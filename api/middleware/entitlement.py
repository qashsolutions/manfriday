"""Entitlement middleware — gate features behind paid tier.

Usage in a route:

    from api.middleware.entitlement import require_paid_tier

    @router.get("/arxiv/search")
    async def search_arxiv(
        user: dict = Depends(get_current_user),
        _paid: None = Depends(require_paid_tier()),
    ):
        ...
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends, HTTPException

from api.middleware.auth import get_current_user
from shared.python.manfriday_core.gcs import read_json, exists, user_path

logger = logging.getLogger(__name__)

# Features that require a paid subscription.
PAID_FEATURES: set[str] = {
    "arxiv",
    "pgvector",
    "priority_support",
}


def _get_user_config(user_id: str) -> dict[str, Any]:
    """Read user config/preferences.json from GCS, returning defaults if missing."""
    config_path = user_path(user_id, "config", "preferences.json")
    if exists(config_path):
        return read_json(config_path)
    return {"tier": "free", "payment_status": "none"}


async def check_entitlement(user_id: str, feature: str) -> bool:
    """Check if *user_id* has access to *feature* based on their tier.

    Returns True if the feature is free-tier or the user is on the paid tier.
    Returns False otherwise.
    """
    # Features not in the paid gate are available to everyone.
    if feature not in PAID_FEATURES:
        return True

    config = _get_user_config(user_id)
    tier = config.get("tier", "free")
    return tier == "paid"


def require_paid_tier():
    """FastAPI dependency that raises 403 if the user is on the free tier.

    Inject into any route that should be restricted to paying users:

        @router.get("/premium-thing")
        async def premium(
            user: dict = Depends(get_current_user),
            _: None = Depends(require_paid_tier()),
        ):
            ...
    """

    async def _dependency(user: dict = Depends(get_current_user)) -> None:
        user_id = user["user_id"]
        config = _get_user_config(user_id)
        tier = config.get("tier", "free")

        if tier != "paid":
            raise HTTPException(
                status_code=403,
                detail="This feature requires a paid subscription. "
                       "Visit /billing/checkout to upgrade.",
            )

    return _dependency
