"use client";

import { useState, useEffect, useCallback } from "react";
import ConnectedAccountCard, { type ConnectorType } from "@/components/ConnectedAccountCard";
import { apiGet, apiPost } from "@/lib/api";

const ALL_CONNECTORS: ConnectorType[] = ["gmail", "gdrive", "telegram", "whatsapp", "arxiv"];

interface ConnectedAccount {
  connector_type: ConnectorType;
  connected: boolean;
  last_polled?: string;
}

const OAUTH_CONNECTORS: ConnectorType[] = ["gmail", "gdrive"];
const API_KEY_CONNECTORS: ConnectorType[] = ["telegram", "whatsapp", "arxiv"];

export default function ConnectedAccountsPage() {
  const [accounts, setAccounts] = useState<Map<ConnectorType, ConnectedAccount>>(new Map());
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState<ConnectorType | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<{ type: ConnectorType; key: string } | null>(null);
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

  function handleConnect(type: ConnectorType) {
    if (OAUTH_CONNECTORS.includes(type)) {
      // Open OAuth popup
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/connectors/oauth/${type}`,
        `connect-${type}`,
        `width=${width},height=${height},left=${left},top=${top}`
      );
      // Poll for popup close, then refresh accounts
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
          api_key: apiKeyInput.key,
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
      const res = await apiPost(`/connectors/disconnect/${type}`, {});
      if (res.ok) {
        await fetchAccounts();
      } else {
        setError("Failed to disconnect.");
      }
    } catch {
      setError("Could not connect to API.");
    }
  }

  async function handlePollNow(type: ConnectorType) {
    setPolling(type);
    setError(null);
    try {
      const res = await apiPost(`/connectors/poll/${type}`, {});
      if (!res.ok) {
        setError(`Failed to poll ${type}.`);
      } else {
        await fetchAccounts();
      }
    } catch {
      setError("Could not connect to API.");
    } finally {
      setPolling(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-3 rounded w-56" />
          <div className="h-4 bg-surface-3 rounded w-80" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface-3 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Connected Accounts</h1>
        <p className="text-gray-500 text-sm">
          Manage data source connections. Connected sources are polled for new content.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {/* API key input modal */}
      {apiKeyInput && (
        <div className="card border-accent/50 space-y-3">
          <h3 className="text-sm font-semibold text-white">
            Connect {apiKeyInput.type.charAt(0).toUpperCase() + apiKeyInput.type.slice(1)}
          </h3>
          <p className="text-xs text-gray-500">
            Enter your API key or bot token to connect this service.
          </p>
          <div className="flex gap-3">
            <input
              type="password"
              value={apiKeyInput.key}
              onChange={(e) => setApiKeyInput({ ...apiKeyInput, key: e.target.value })}
              placeholder="API key or bot token..."
              className="input-field flex-1"
            />
            <button
              onClick={handleSubmitApiKey}
              disabled={!apiKeyInput.key}
              className="btn-primary disabled:opacity-40"
            >
              Connect
            </button>
            <button
              onClick={() => setApiKeyInput(null)}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Connector cards */}
      <div className="space-y-3">
        {ALL_CONNECTORS.map((type) => {
          const account = accounts.get(type);
          const connected = account?.connected ?? false;
          return (
            <div key={type} className="space-y-2">
              <ConnectedAccountCard
                connectorType={type}
                connected={connected}
                lastPolled={account?.last_polled}
                onConnect={() => handleConnect(type)}
                onDisconnect={() => handleDisconnect(type)}
              />
              {connected && (
                <div className="flex justify-end pr-1">
                  <button
                    onClick={() => handlePollNow(type)}
                    disabled={polling === type}
                    className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-40"
                  >
                    {polling === type ? "Polling..." : "Poll Now"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
