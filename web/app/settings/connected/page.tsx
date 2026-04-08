"use client";

import { useState, useEffect, useCallback } from "react";
import ConnectedAccountCard, { type ConnectorType } from "@/components/ConnectedAccountCard";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/lib/supabase";

const ALL_CONNECTORS: ConnectorType[] = ["gmail", "gdrive", "telegram", "whatsapp", "arxiv"];

interface ConnectedAccount {
  connector_type: ConnectorType;
  connected: boolean;
  last_polled?: string;
}

const OAUTH_CONNECTORS: ConnectorType[] = ["gmail", "gdrive"];
const API_KEY_CONNECTORS: ConnectorType[] = ["telegram", "whatsapp", "arxiv"];

/* ── Connector info: what it does + how to set up ──────────── */

const CONNECTOR_INFO: Record<ConnectorType, { what: string; how: string; access: string }> = {
  gmail: {
    what: "Auto-ingest emails. Newsletters filtered. Starred messages prioritized.",
    how: "Click Connect → sign in with Google → grant read-only access.",
    access: "Read-only. ManFriday reads your emails but cannot send, delete, or modify anything.",
  },
  gdrive: {
    what: "Import Google Docs, PDFs, and spreadsheets from your Drive.",
    how: "Click Connect → sign in with Google → grant read-only access.",
    access: "Read-only. ManFriday reads your files but cannot edit, delete, or share them.",
  },
  telegram: {
    what: "Ingest channel messages and starred content from Telegram.",
    how: "1. Open Telegram → message @BotFather → send /newbot\n2. Follow prompts to name your bot\n3. Copy the bot token\n4. Paste it below",
    access: "Bot can only read messages in chats where it's added. It cannot access your private messages.",
  },
  whatsapp: {
    what: "Pull messages from WhatsApp Business conversations.",
    how: "1. Create a Meta Business App at developers.facebook.com\n2. Enable WhatsApp API\n3. Get your access token + phone number ID\n4. Paste them below",
    access: "Reads messages from your business number only. Cannot access personal WhatsApp.",
  },
  arxiv: {
    what: "Auto-fetch new papers in your chosen research categories.",
    how: "Enter arXiv category codes (e.g. cs.AI, cs.LG, math.AG).",
    access: "Public API. No authentication needed — just category preferences.",
  },
};

export default function ConnectedAccountsPage() {
  const [accounts, setAccounts] = useState<Map<ConnectorType, ConnectedAccount>>(new Map());
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState<ConnectorType | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<{ type: ConnectorType; key: string } | null>(null);
  const [expandedGuide, setExpandedGuide] = useState<ConnectorType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await apiGet("/connectors/connected-accounts");
      if (res.ok) {
        const raw = await res.json();
        const data: ConnectedAccount[] = Array.isArray(raw) ? raw : raw.accounts || [];
        const map = new Map<ConnectorType, ConnectedAccount>();
        for (const a of data) {
          map.set(a.connector_type, a);
        }
        setAccounts(map);
      }
    } catch {
      setError("Could not connect to API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleConnect(type: ConnectorType) {
    if (OAUTH_CONNECTORS.includes(type)) {
      // Get user_id from Supabase session to pass to OAuth flow
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id || "";
      // OAuth goes through Vercel proxy → Cloud Run (user only sees manfriday.app)
      const w = 500, h = 600;
      const x = window.screenX + (window.outerWidth - w) / 2;
      const y = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        `/api/connectors/oauth/${type}?user_id=${userId}`,
        `connect-${type}`,
        `width=${w},height=${h},left=${x},top=${y}`
      );
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          fetchAccounts();
        }
      }, 500);
    } else if (API_KEY_CONNECTORS.includes(type)) {
      setApiKeyInput({ type, key: "" });
    }
  }

  async function handleSubmitApiKey() {
    if (!apiKeyInput) return;
    setError(null);
    try {
      const res = await apiPost("/connectors/connect", {
        connector_type: apiKeyInput.type,
        credentials: apiKeyInput.type === "telegram"
          ? { bot_token: apiKeyInput.key }
          : apiKeyInput.type === "arxiv"
            ? { categories: apiKeyInput.key.split(",").map(s => s.trim()) }
            : { access_token: apiKeyInput.key },
      });
      if (res.ok) {
        setApiKeyInput(null);
        await fetchAccounts();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Failed to connect.");
      }
    } catch {
      setError("Could not connect to API.");
    }
  }

  async function handleDisconnect(type: ConnectorType) {
    setError(null);
    try {
      const res = await apiPost("/connectors/disconnect", { connector_type: type });
      if (res.ok) await fetchAccounts();
      else setError("Failed to disconnect.");
    } catch {
      setError("Could not connect to API.");
    }
  }

  async function handlePollNow(type: ConnectorType) {
    setPolling(type);
    setError(null);
    try {
      const res = await apiPost(`/connectors/poll/${type}`, {});
      if (!res.ok) setError(`Failed to poll ${type}.`);
      else await fetchAccounts();
    } catch {
      setError("Could not connect to API.");
    } finally {
      setPolling(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-3 rounded w-56" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-surface-3 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Connected Accounts</h1>
        <p className="text-sm text-secondary">
          Connect your data sources. ManFriday reads them and builds your wiki automatically.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* API key input */}
      {apiKeyInput && (
        <div className="card border-accent/50 space-y-3">
          <h3 className="text-sm font-semibold">
            Connect {apiKeyInput.type === "gdrive" ? "Google Drive" : apiKeyInput.type.charAt(0).toUpperCase() + apiKeyInput.type.slice(1)}
          </h3>
          <p className="text-xs text-muted whitespace-pre-line">
            {CONNECTOR_INFO[apiKeyInput.type].how}
          </p>
          <div className="flex gap-3">
            <input
              type={apiKeyInput.type === "arxiv" ? "text" : "password"}
              value={apiKeyInput.key}
              onChange={(e) => setApiKeyInput({ ...apiKeyInput, key: e.target.value })}
              placeholder={
                apiKeyInput.type === "telegram" ? "Paste bot token from @BotFather..."
                : apiKeyInput.type === "arxiv" ? "cs.AI, cs.LG, math.AG..."
                : "Paste access token..."
              }
              className="input-field flex-1"
              autoComplete="off"
            />
            <button onClick={handleSubmitApiKey} disabled={!apiKeyInput.key} className="btn-primary disabled:opacity-40">
              Connect
            </button>
            <button onClick={() => setApiKeyInput(null)} className="btn-secondary">
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted">
            {CONNECTOR_INFO[apiKeyInput.type].access}
          </p>
        </div>
      )}

      {/* Connector cards with guides */}
      <div className="space-y-4">
        {ALL_CONNECTORS.map((type) => {
          const account = accounts.get(type);
          const connected = account?.connected ?? false;
          const info = CONNECTOR_INFO[type];
          const isExpanded = expandedGuide === type;

          return (
            <div key={type} className="space-y-0">
              <ConnectedAccountCard
                connectorType={type}
                connected={connected}
                lastPolled={account?.last_polled}
                onConnect={() => handleConnect(type)}
                onDisconnect={() => handleDisconnect(type)}
              />

              {/* Info row: what it does + how to connect */}
              <div className="bg-surface-1 border border-t-0 border-surface-3 rounded-b-lg px-4 py-2 flex items-center justify-between">
                <p className="text-xs text-muted">{info.what}</p>
                <div className="flex items-center gap-3">
                  {connected && (
                    <button
                      onClick={() => handlePollNow(type)}
                      disabled={polling === type}
                      className="text-xs text-accent hover:text-accent-hover disabled:opacity-40"
                    >
                      {polling === type ? "Polling..." : "Poll Now"}
                    </button>
                  )}
                  {!connected && (
                    <button
                      onClick={() => setExpandedGuide(isExpanded ? null : type)}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      {isExpanded ? "Hide guide" : "How to connect"}
                    </button>
                  )}
                </div>
              </div>

              {/* Expandable setup guide */}
              {isExpanded && !connected && (
                <div className="bg-surface-2 border border-t-0 border-surface-3 rounded-b-lg px-4 py-3 space-y-2">
                  <p className="text-xs font-medium">Setup steps</p>
                  <p className="text-xs text-secondary whitespace-pre-line">{info.how}</p>
                  <div className="flex items-start gap-2 mt-2">
                    <svg className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <p className="text-xs text-muted">{info.access}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
