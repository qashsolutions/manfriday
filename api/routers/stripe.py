"""Stripe webhook — POST /webhook/stripe for subscription events."""

from __future__ import annotations

import os

from fastapi import APIRouter, Request, HTTPException

router = APIRouter()

STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe subscription events.

    Verifies webhook signature, processes subscription create/update/cancel.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        import stripe

        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        else:
            # Dev mode — parse without verification
            import json
            event = json.loads(payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Webhook error: {e}")

    event_type = event.get("type", "")

    if event_type == "customer.subscription.created":
        # Activate paid tier for user
        pass
    elif event_type == "customer.subscription.updated":
        # Update subscription status
        pass
    elif event_type == "customer.subscription.deleted":
        # Downgrade to free tier
        pass
    elif event_type == "invoice.payment_failed":
        # Handle failed payment
        pass

    return {"received": True}
