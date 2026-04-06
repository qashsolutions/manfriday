"""Billing routes — checkout, portal, and subscription status.

All routes require authentication via get_current_user.
"""

from __future__ import annotations

import os
from typing import Any

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth import get_current_user
from shared.python.manfriday_core.gcs import read_json, write_json, exists, user_path

router = APIRouter()

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "")  # paid-tier price
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


# ── Request / response models ────────────────────────────────


class CheckoutRequest(BaseModel):
    success_url: str | None = None
    cancel_url: str | None = None


class CheckoutResponse(BaseModel):
    checkout_url: str


class PortalResponse(BaseModel):
    portal_url: str


class SubscriptionResponse(BaseModel):
    tier: str
    payment_status: str
    subscription_status: str | None = None
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None


# ── Helpers ───────────────────────────────────────────────────


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
    config_path = user_path(user_id, "config", "preferences.json")
    write_json(config_path, config)


def _get_or_create_stripe_customer(user_id: str, email: str) -> str:
    """Return existing Stripe customer ID or create a new one.

    Stores the customer ID back into the user's config so future
    calls reuse the same Stripe customer.
    """
    config = _get_user_config(user_id)
    customer_id = config.get("stripe_customer_id")

    if customer_id:
        return customer_id

    customer = stripe.Customer.create(
        email=email,
        metadata={"user_id": user_id},
    )
    config["stripe_customer_id"] = customer.id
    _save_user_config(user_id, config)
    return customer.id


# ── Routes ────────────────────────────────────────────────────


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(
    body: CheckoutRequest | None = None,
    user: dict = Depends(get_current_user),
):
    """Create a Stripe Checkout session for the paid tier.

    Returns a checkout_url that the frontend should redirect to.
    """
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    if not STRIPE_PRICE_ID:
        raise HTTPException(status_code=503, detail="Stripe price ID is not configured")

    user_id = user["user_id"]
    email = user.get("email", "")

    customer_id = _get_or_create_stripe_customer(user_id, email)

    success_url = (body.success_url if body and body.success_url else f"{FRONTEND_URL}/billing?success=true")
    cancel_url = (body.cancel_url if body and body.cancel_url else f"{FRONTEND_URL}/billing?canceled=true")

    try:
        session = stripe.checkout.Session.create(
            customer=customer_id,
            mode="subscription",
            line_items=[{"price": STRIPE_PRICE_ID, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            subscription_data={"metadata": {"user_id": user_id}},
        )
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    return CheckoutResponse(checkout_url=session.url)


@router.get("/portal", response_model=PortalResponse)
async def create_portal_session(user: dict = Depends(get_current_user)):
    """Create a Stripe Customer Portal session.

    Returns a portal_url so the user can manage their subscription,
    update payment methods, or cancel.
    """
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    user_id = user["user_id"]
    config = _get_user_config(user_id)
    customer_id = config.get("stripe_customer_id")

    if not customer_id:
        raise HTTPException(status_code=404, detail="No Stripe customer found. Subscribe first.")

    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{FRONTEND_URL}/billing",
        )
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    return PortalResponse(portal_url=session.url)


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(user: dict = Depends(get_current_user)):
    """Return the current subscription status for the authenticated user."""
    user_id = user["user_id"]
    config = _get_user_config(user_id)

    return SubscriptionResponse(
        tier=config.get("tier", "free"),
        payment_status=config.get("payment_status", "none"),
        subscription_status=config.get("subscription_status"),
        stripe_customer_id=config.get("stripe_customer_id"),
        stripe_subscription_id=config.get("stripe_subscription_id"),
    )
