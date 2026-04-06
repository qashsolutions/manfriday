"""Model registry — track fine-tuned models per user.

Stores model metadata in GCS at {user_id}/finetune/models.json.
The Q&A pipeline queries this to decide whether to use a fine-tuned model
instead of the base model for a given user.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from shared.python.manfriday_core.gcs import exists, read_json, user_path, write_json

logger = logging.getLogger(__name__)


def _models_path(user_id: str) -> str:
    return user_path(user_id, "finetune", "models.json")


def _read_models(user_id: str) -> list[dict[str, Any]]:
    path = _models_path(user_id)
    if exists(path):
        return read_json(path)
    return []


def _write_models(user_id: str, models: list[dict[str, Any]]) -> None:
    write_json(_models_path(user_id), models)


async def register_model(
    user_id: str,
    provider: str,
    model_id: str,
    base_model: str,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Register a newly fine-tuned model.

    Deactivates any previous active model for the same provider,
    then stores the new model as active.

    Args:
        user_id: The user who owns this model.
        provider: LLM provider ('openai', 'anthropic').
        model_id: The fine-tuned model identifier from the provider.
        base_model: The base model that was fine-tuned.
        metrics: Optional training metrics (trained_tokens, article_count, etc.).

    Returns:
        The newly created model record.
    """
    models = _read_models(user_id)

    # Deactivate previous models for the same provider
    for model in models:
        if model["provider"] == provider and model.get("active"):
            model["active"] = False
            model["deactivated_at"] = datetime.now(timezone.utc).isoformat()
            logger.info(
                "Deactivated previous model %s for user %s",
                model["model_id"],
                user_id,
            )

    # Create new model record
    record = {
        "model_id": model_id,
        "provider": provider,
        "base_model": base_model,
        "active": True,
        "metrics": metrics or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    models.append(record)
    _write_models(user_id, models)

    logger.info("Registered model %s for user %s (provider: %s)", model_id, user_id, provider)
    return record


async def get_active_model(user_id: str, provider: str) -> dict[str, Any] | None:
    """Get the currently active fine-tuned model for a user and provider.

    Returns None if the user has no fine-tuned model for this provider.
    """
    models = _read_models(user_id)
    for model in reversed(models):  # most recent first
        if model["provider"] == provider and model.get("active"):
            return model
    return None


async def list_models(user_id: str) -> list[dict[str, Any]]:
    """List all fine-tuned models for a user (active and inactive)."""
    return _read_models(user_id)


async def deactivate_model(user_id: str, model_id: str) -> bool:
    """Manually deactivate a model. Returns True if found and deactivated."""
    models = _read_models(user_id)
    found = False
    for model in models:
        if model["model_id"] == model_id:
            model["active"] = False
            model["deactivated_at"] = datetime.now(timezone.utc).isoformat()
            found = True
            break

    if found:
        _write_models(user_id, models)
        logger.info("Deactivated model %s for user %s", model_id, user_id)
    return found
