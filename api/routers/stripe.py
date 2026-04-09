"""Stripe webhook — POST /webhook/stripe for subscription events.

Handles subscription lifecycle events with idempotency tracking
and updates user tier/payment status in GCS config.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import stripe
from fastapi import APIRouter, Request, HTTPException

from shared.python.manfriday_core.gcs import read_json, write_json, exists, user_path

logger = logging.getLogger(__name__)

router = APIRouter()

STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
ENV = os.getenv("ENV", "development")

# In-memory idempotency cache: event_id -> timestamp processed.
# In production this would be backed by a persistent store (Redis / GCS),
# but for Phase I the in-memory set handles the common case of
# Stripe retrying within the same process lifetime.
_processed_events: dict[str, float] = {}

# Max age (seconds) before we prune old entries from the cache.
_IDEMPOTENCY_TTL = 60 * 60 * 24  # 24 hours


def _prune_idempotency_cache() -> None:
    """Remove entries older than TTL to prevent unbounded memory growth."""
    cutoff = time.time() - _IDEMPOTENCY_TTL
    stale = [eid for eid, ts in _processed_events.items() if ts < cutoff]
    for eid in stale:
        del _processed_events[eid]


def _get_user_config(user_id: str) -> dict[str, Any]:
    """Read user config/preferences.json from GCS, returning defaults if missing."""
    config_path = user_path(user_id, "config", "preferences.json")
    if exists(config_path):
        return read_json(config_path)
    return {
        "tier": "free",
        "payment_status": "none",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
    }


def _save_user_config(user_id: str, config: dict[str, Any]) -> None:
    """Write user config/preferences.json to GCS."""
    config_path = user_path(user_id, "config", "preferences.json")
    write_json(config_path, config)


def _resolve_user_id(event_data: dict[str, Any]) -> str | None:
    """Extract user_id from Stripe event data.

    Stripe customer metadata should contain {"user_id": "<supabase-uid>"}.
    Falls back to customer ID as a last resort.
    """
    customer_obj = event_data.get("customer")
    metadata = event_data.get("metadata", {})

    # Prefer metadata on the subscription object itself
    if metadata and metadata.get("user_id"):
        return metadata["user_id"]

    # Try customer-level metadata (populated at checkout)
    if isinstance(customer_obj, dict):
        cust_meta = customer_obj.get("metadata", {})
        if cust_meta.get("user_id"):
            return cust_meta["user_id"]

    # Fall back to customer string ID (caller must map externally)
    if isinstance(customer_obj, str):
        return customer_obj

    return None


def _handle_subscription_created(data: dict[str, Any]) -> None:
    """customer.subscription.created — activate paid tier."""
    user_id = _resolve_user_id(data)
    if not user_id:
        logger.warning("subscription.created: could not resolve user_id")
        return

    config = _get_user_config(user_id)
    config["tier"] = "paid"
    config["payment_status"] = "active"
    config["stripe_customer_id"] = data.get("customer") if isinstance(data.get("customer"), str) else None
    config["stripe_subscription_id"] = data.get("id")
    config["subscription_status"] = data.get("status", "active")
    _save_user_config(user_id, config)
    logger.info("subscription.created: user=%s tier=paid", user_id)


def _handle_subscription_updated(data: dict[str, Any]) -> None:
    """customer.subscription.updated — sync status changes."""
    user_id = _resolve_user_id(data)
    if not user_id:
        logger.warning("subscription.updated: could not resolve user_id")
        return

    config = _get_user_config(user_id)
    status = data.get("status", "active")
    config["subscription_status"] = status

    # Map Stripe statuses to our tier model
    if status in ("active", "trialing"):
        config["tier"] = "paid"
        config["payment_status"] = "active"
    elif status in ("past_due", "unpaid"):
        config["tier"] = "paid"  # grace period — keep access
        config["payment_status"] = "past_due"
    elif status in ("canceled", "incomplete_expired"):
        config["tier"] = "free"
        config["payment_status"] = "canceled"

    config["stripe_subscription_id"] = data.get("id")
    _save_user_config(user_id, config)
    logger.info("subscription.updated: user=%s status=%s", user_id, status)


def _handle_subscription_deleted(data: dict[str, Any]) -> None:
    """customer.subscription.deleted — downgrade to free tier."""
    user_id = _resolve_user_id(data)
    if not user_id:
        logger.warning("subscription.deleted: could not resolve user_id")
        return

    config = _get_user_config(user_id)
    config["tier"] = "free"
    config["payment_status"] = "canceled"
    config["subscription_status"] = "canceled"
    config["stripe_subscription_id"] = None
    _save_user_config(user_id, config)
    logger.info("subscription.deleted: user=%s downgraded to free", user_id)


def _handle_payment_failed(data: dict[str, Any]) -> None:
    """invoice.payment_failed — mark payment as failed."""
    # Invoice events nest subscription data differently
    subscription_id = data.get("subscription")
    customer_id = data.get("customer")
    metadata = data.get("subscription_details", {}).get("metadata", {}) if data.get("subscription_details") else {}

    user_id = metadata.get("user_id") or customer_id
    if not user_id:
        logger.warning("payment_failed: could not resolve user_id")
        return

    config = _get_user_config(user_id)
    config["payment_status"] = "failed"
    _save_user_config(user_id, config)
    logger.info("payment_failed: user=%s", user_id)


_EVENT_HANDLERS = {
    "customer.subscription.created": _handle_subscription_created,
    "customer.subscription.updated": _handle_subscription_updated,
    "customer.subscription.deleted": _handle_subscription_deleted,
    "invoice.payment_failed": _handle_payment_failed,
}


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe subscription events.

    Verifies webhook signature, deduplicates by event ID,
    then dispatches to the appropriate handler.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # ── Verify signature ──────────────────────────────────────
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        elif ENV == "development":
            # Dev mode only — parse without verification
            logger.warning("Stripe webhook signature not verified (dev mode)")
            event = json.loads(payload)
        else:
            # Production/staging: reject unsigned webhooks
            logger.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook")
            raise HTTPException(
                status_code=503,
                detail="Stripe webhooks not configured",
            )
    except stripe.error.SignatureVerificationError as e:
        logger.warning("Stripe signature verification failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid signature")
    except HTTPException:
        raise  # re-raise our own 503
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Webhook error: {e}")

    # ── Idempotency check ─────────────────────────────────────
    event_id = event.get("id", "")
    if event_id in _processed_events:
        logger.info("Duplicate event %s — skipping", event_id)
        return {"received": True, "duplicate": True}

    # ── Dispatch ──────────────────────────────────────────────
    event_type = event.get("type", "")
    data = event.get("data", {}).get("object", {})

    handler = _EVENT_HANDLERS.get(event_type)
    if handler:
        try:
            handler(data)
        except Exception:
            logger.exception("Error handling %s (event %s)", event_type, event_id)
            raise HTTPException(status_code=500, detail="Webhook handler error")
    else:
        logger.debug("Unhandled event type: %s", event_type)

    # ── Mark processed ────────────────────────────────────────
    _processed_events[event_id] = time.time()
    _prune_idempotency_cache()

    return {"received": True}
