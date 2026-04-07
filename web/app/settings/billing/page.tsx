"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Subscription {
  tier: "free" | "paid";
  status: string;
  current_period_end?: string;
}

const FEATURES: { name: string; free: string; paid: string }[] = [
  { name: "Sources", free: "10", paid: "Unlimited" },
  { name: "Wiki pages", free: "50", paid: "Unlimited" },
  { name: "Q&A queries / day", free: "20", paid: "Unlimited" },
  { name: "Search mode", free: "Keyword (BM25)", paid: "Keyword + Semantic + Hybrid" },
  { name: "Connectors", free: "URL only", paid: "Gmail, Drive, Telegram, WhatsApp, arXiv" },
  { name: "Lint health checks", free: "Manual", paid: "Scheduled + Manual" },
  { name: "Priority support", free: "---", paid: "Yes" },
];

export default function BillingPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSubscription() {
      try {
        const res = await apiGet("/billing/subscription");
        if (res.ok) {
          setSubscription(await res.json());
        } else {
          setError("Failed to load subscription details.");
        }
      } catch {
        setError("Could not connect to API.");
      } finally {
        setLoading(false);
      }
    }
    fetchSubscription();
  }, []);

  async function handleUpgrade() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await apiPost("/billing/checkout", {});
      if (res.ok) {
        const { checkout_url } = await res.json();
        window.location.href = checkout_url;
      } else {
        setError("Failed to create checkout session.");
      }
    } catch {
      setError("Could not connect to API.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManage() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await apiGet("/billing/portal");
      if (res.ok) {
        const { portal_url } = await res.json();
        window.location.href = portal_url;
      } else {
        setError("Failed to open billing portal.");
      }
    } catch {
      setError("Could not connect to API.");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-3 rounded w-48" />
          <div className="h-4 bg-surface-3 rounded w-72" />
          <div className="h-64 bg-surface-3 rounded" />
        </div>
      </div>
    );
  }

  const tier = subscription?.tier ?? "free";
  const isPaid = tier === "paid";

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Billing</h1>
        <p className="text-gray-500 text-sm">Manage your subscription and billing details.</p>
      </div>

      {/* Current plan card */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">Current Plan</h2>
            <p className="text-lg font-bold text-white mt-1 capitalize">{tier}</p>
            {subscription?.status && (
              <p className="text-xs text-gray-500 mt-0.5">
                Status: <span className="capitalize">{subscription.status}</span>
              </p>
            )}
            {subscription?.current_period_end && (
              <p className="text-xs text-gray-500">
                Renews: {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            {isPaid ? (
              <button
                onClick={handleManage}
                disabled={actionLoading}
                className="btn-secondary disabled:opacity-40"
              >
                {actionLoading ? "Loading..." : "Manage Billing"}
              </button>
            ) : (
              <button
                onClick={handleUpgrade}
                disabled={actionLoading}
                className="btn-primary disabled:opacity-40"
              >
                {actionLoading ? "Loading..." : "Upgrade to Paid"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {/* Features comparison table */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Plan Comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-3">
                <th className="text-left py-2 pr-4 text-gray-400 font-medium">Feature</th>
                <th className="text-left py-2 px-4 text-gray-400 font-medium">Free</th>
                <th className="text-left py-2 pl-4 text-gray-400 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.name} className="border-b border-surface-3 last:border-0">
                  <td className="py-2.5 pr-4 text-gray-300">{f.name}</td>
                  <td className="py-2.5 px-4 text-gray-500">{f.free}</td>
                  <td className="py-2.5 pl-4 text-white font-medium">{f.paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
