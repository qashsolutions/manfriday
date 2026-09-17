import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeCall, verifyStripeSignature } from "./stripeApi";

const http = httpRouter();

/** Stripe → Convex. The signature is checked against the raw body before anything
 *  is parsed; each event is applied and recorded in one mutation, so retries are
 *  harmless. A processing error returns 500 so Stripe retries later. */
export async function handleStripeWebhook(ctx: ActionCtx, req: Request): Promise<Response> {
  const payload = await req.text();
  const ok = await verifyStripeSignature(payload, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET ?? "");
  if (!ok) return new Response("bad signature", { status: 400 });

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (typeof event?.id !== "string" || typeof event?.type !== "string" || typeof event?.data?.object !== "object") {
    return new Response("bad event", { status: 400 });
  }
  const obj = event.data.object;
  const idOf = (x: unknown) => (typeof x === "string" ? x : typeof (x as any)?.id === "string" ? (x as any).id : undefined);

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const userId = obj.metadata?.userId ?? obj.client_reference_id ?? undefined;
        const lookupKey = obj.metadata?.lookupKey;
        const customerId = idOf(obj.customer);
        if (obj.mode === "payment") {
          if (obj.payment_status !== "paid") break; // delayed methods finish in async_payment_succeeded
          await ctx.runMutation(internal.billing.applyOneTimePurchase, {
            eventId: event.id, userId, customerId, lookupKey: String(lookupKey ?? ""), paidAt: (obj.created ?? Math.floor(Date.now() / 1000)) * 1000,
          });
          return new Response("ok");
        }
        if (obj.mode === "subscription" && idOf(obj.subscription) && customerId) {
          // Don't wait for the subscription event: activate from the source of truth now.
          const sub = await stripeCall(env.STRIPE_SECRET_KEY, "GET", `/subscriptions/${idOf(obj.subscription)}`);
          await ctx.runMutation(internal.billing.applySubscription, {
            eventId: event.id, type: event.type, userId, customerId, subscriptionId: sub.id, status: sub.status,
            lookupKey: sub.items?.data?.[0]?.price?.lookup_key ?? lookupKey,
            cancelAt: sub.cancel_at ? sub.cancel_at * 1000 : undefined,
          });
          return new Response("ok");
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const customerId = idOf(obj.customer);
        if (!customerId) break;
        await ctx.runMutation(internal.billing.applySubscription, {
          eventId: event.id, type: event.type, userId: obj.metadata?.userId, customerId, subscriptionId: obj.id, status: obj.status,
          lookupKey: obj.items?.data?.[0]?.price?.lookup_key ?? undefined,
          cancelAt: obj.cancel_at ? obj.cancel_at * 1000 : undefined,
        });
        return new Response("ok");
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const customerId = idOf(obj.customer);
        if (!customerId) break;
        await ctx.runMutation(internal.billing.applyInvoice, { eventId: event.id, type: event.type, customerId, paid: event.type === "invoice.paid" });
        return new Response("ok");
      }
    }
    await ctx.runMutation(internal.billing.recordIgnored, { eventId: event.id, type: event.type });
    return new Response("ignored");
  } catch (err) {
    console.error("stripe webhook failed", event.type, event.id, err instanceof Error ? err.message : String(err));
    return new Response("retry", { status: 500 });
  }
}

http.route({ path: "/stripe/webhook", method: "POST", handler: httpAction(handleStripeWebhook) });

export default http;
