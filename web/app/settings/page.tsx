"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiGet, apiPost, maskKey } from "@/lib/api";
import { type ConnectorType } from "@/components/ConnectedAccountCard";

/* ── Auto-detect provider from key prefix ─────────────────── */

function detectProvider(key: string): "anthropic" | "openai" | "gemini" | null {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("AIza")) return "gemini";
  if (trimmed.startsWith("sk-")) return "openai";
  return null;
}

/* ── arXiv categories ─────────────────────────────────────── */

const ARXIV_CATEGORIES = [
  { value: "cs.AI", label: "Artificial Intelligence" },
  { value: "cs.CL", label: "Computation & Language (NLP)" },
  { value: "cs.CV", label: "Computer Vision" },
  { value: "cs.LG", label: "Machine Learning" },
  { value: "cs.NE", label: "Neural & Evolutionary Computing" },
  { value: "cs.IR", label: "Information Retrieval" },
  { value: "cs.RO", label: "Robotics" },
  { value: "cs.SE", label: "Software Engineering" },
  { value: "cs.CR", label: "Cryptography & Security" },
  { value: "stat.ML", label: "Statistics: Machine Learning" },
  { value: "q-bio", label: "Quantitative Biology" },
  { value: "q-fin", label: "Quantitative Finance" },
  { value: "econ", label: "Economics" },
  { value: "physics", label: "Physics (all)" },
];

/* ── Connector types shown to free users ──────────────────── */

const OAUTH_CONNECTORS: ConnectorType[] = ["gmail", "gdrive"];
const FREE_CONNECTORS: ConnectorType[] = ["gmail", "gdrive", "telegram"];

const CONNECTOR_LABELS: Record<string, string> = {
  gmail: "Gmail",
  gdrive: "Google Drive",
  telegram: "Telegram",
};

const CONNECTOR_DESC: Record<string, string> = {
  gmail: "Auto-ingest emails. Newsletters filtered.",
  gdrive: "Import Docs, PDFs, and spreadsheets.",
  telegram: "Ingest channel messages and starred content.",
};

interface ConnectorStatus {
  connector_type: string;
  connected: boolean;
}

/* ── Main Settings Page ───────────────────────────────────── */

export default function SettingsPage() {
  // API Key state
  const [newKey, setNewKey] = useState("");
  const [detectedProvider, setDetectedProvider] = useState<string | null>(null);
  const [configuredKey, setConfiguredKey] = useState<{ provider: string; masked: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Connector state
  const [connectors, setConnectors] = useState<Map<string, boolean>>(new Map());
  const [telegramInput, setTelegramInput] = useState("");
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [connectorMsg, setConnectorMsg] = useState<string | null>(null);

  // arXiv state
  const [arxivCategories, setArxivCategories] = useState<string[]>([]);
  const [arxivSaving, setArxivSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Auto-detect provider as user types
  useEffect(() => {
    setDetectedProvider(detectProvider(newKey));
  }, [newKey]);

  // Load existing config
  useEffect(() => {
    async function load() {
      try {
        // Load API key status
        const keyRes = await apiGet("/settings/providers");
        if (keyRes.ok) {
          const providers = await keyRes.json();
          const configured = (Array.isArray(providers) ? providers : []).find(
            (p: any) => p.configured
          );
          if (configured) {
            setConfiguredKey({ provider: configured.provider, masked: configured.masked_key });
          }
        }
      } catch {}

      try {
        // Load connector status
        const connRes = await apiGet("/connectors/connected-accounts");
        if (connRes.ok) {
          const raw = await connRes.json();
          const data: ConnectorStatus[] = Array.isArray(raw) ? raw : raw.accounts || [];
          const map = new Map<string, boolean>();
          for (const c of data) {
            map.set(c.connector_type, c.connected);
          }
          setConnectors(map);
        }
      } catch {}
    }
    load();
  }, []);

  // Save API key
  async function handleSaveKey() {
    if (!newKey || !detectedProvider) return;
    setSaving(true);
    setKeyMsg(null);
    try {
      const res = await apiPost("/validate-key", { provider: detectedProvider, api_key: newKey });
      const result = await res.json();
      if (res.status === 429) {
        setKeyMsg({ text: "Rate limit exceeded. Try again in a minute.", type: "error" });
      } else if (result.valid) {
        setConfiguredKey({ provider: detectedProvider, masked: result.masked_key || maskKey(newKey) });
        setKeyMsg({ text: `${detectedProvider.charAt(0).toUpperCase() + detectedProvider.slice(1)} key validated and stored.`, type: "success" });
        setNewKey("");
        setEditing(false);
      } else {
        setKeyMsg({ text: "Invalid key. Please check and try again.", type: "error" });
      }
    } catch {
      setKeyMsg({ text: "Could not connect to API.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  // OAuth connect (same-window redirect)
  async function handleOAuthConnect(type: ConnectorType) {
    try {
      const res = await apiPost("/connectors/oauth/start", { connector_type: type });
      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Failed to start OAuth flow.");
      }
    } catch {
      setError("Could not connect to API.");
    }
  }

  // Telegram connect
  async function handleTelegramConnect() {
    if (!telegramInput) return;
    setTelegramConnecting(true);
    setConnectorMsg(null);
    try {
      const res = await apiPost("/connectors/connect", {
        connector_type: "telegram",
        credentials: { bot_token: telegramInput },
      });
      if (res.ok) {
        setConnectors(prev => new Map(prev).set("telegram", true));
        setTelegramInput("");
        setConnectorMsg("Telegram connected!");
      } else {
        const body = await res.json().catch(() => ({}));
        setConnectorMsg(body.detail || "Failed to connect Telegram.");
      }
    } catch {
      setConnectorMsg("Could not connect to API.");
    } finally {
      setTelegramConnecting(false);
    }
  }

  // Disconnect
  async function handleDisconnect(type: string) {
    try {
      const res = await apiPost("/connectors/disconnect", { connector_type: type });
      if (res.ok) {
        setConnectors(prev => new Map(prev).set(type, false));
      }
    } catch {}
  }

  // arXiv save
  async function handleArxivSave() {
    if (arxivCategories.length === 0) return;
    setArxivSaving(true);
    try {
      await apiPost("/connectors/connect", {
        connector_type: "arxiv",
        credentials: { categories: arxivCategories },
      });
      setConnectorMsg("arXiv topics saved!");
    } catch {}
    setArxivSaving(false);
  }

  // Check for OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const oauthError = params.get("error");
    if (connected) {
      setConnectorMsg(`${CONNECTOR_LABELS[connected] || connected} connected successfully!`);
      setConnectors(prev => new Map(prev).set(connected, true));
      window.history.replaceState({}, "", "/settings");
    }
    if (oauthError) {
      setError(`Connection failed: ${oauthError}`);
      window.history.replaceState({}, "", "/settings");
    }
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-sm text-secondary">API key, connected sources, and research topics.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {connectorMsg && (
        <div className="rounded-lg p-3 bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400">
          {connectorMsg}
        </div>
      )}

      {/* ── API Key ────────────────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-lg">Your API Key</h2>

        {configuredKey && !editing ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 bg-surface-2 border border-surface-3 rounded-lg px-4 py-2.5">
              <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-sm font-mono text-muted">{configuredKey.masked}</span>
              <span className="text-xs text-accent ml-2">{configuredKey.provider}</span>
            </div>
            <button onClick={() => { setEditing(true); setNewKey(""); setKeyMsg(null); }} className="btn-secondary text-sm">
              Replace
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-3">
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Paste your Anthropic, OpenAI, or Gemini key"
                className="input-field flex-1"
                autoComplete="off"
              />
              <button
                onClick={handleSaveKey}
                disabled={saving || !newKey || !detectedProvider}
                className="btn-primary disabled:opacity-40 text-sm"
              >
                {saving ? "Validating..." : "Save"}
              </button>
              {editing && (
                <button onClick={() => { setEditing(false); setNewKey(""); setKeyMsg(null); }} className="btn-secondary text-sm">
                  Cancel
                </button>
              )}
            </div>
            {newKey && detectedProvider && (
              <p className="text-xs text-emerald-400">Detected: {detectedProvider}</p>
            )}
            {newKey && !detectedProvider && newKey.length > 3 && (
              <p className="text-xs text-amber-400">Unrecognized key format. We accept Anthropic (sk-ant-), OpenAI (sk-), and Gemini (AIza) keys.</p>
            )}
          </div>
        )}

        {keyMsg && (
          <p className={`text-xs ${keyMsg.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
            {keyMsg.text}
          </p>
        )}

        <p className="text-xs text-muted">
          Encrypted at rest (AES-256) &bull; Never displayed after save &bull; Never logged &bull; <Link href="/settings/security" className="text-accent hover:underline">Security details</Link>
        </p>
      </div>

      {/* ── Connected Sources ──────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-lg">Connected Sources</h2>
        <p className="text-xs text-muted">ManFriday reads these sources and builds your wiki automatically.</p>

        <div className="space-y-3">
          {/* Gmail */}
          <div className="flex items-center justify-between py-2 border-b border-surface-3">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${connectors.get("gmail") ? "bg-emerald-400" : "bg-gray-500"}`} />
              <div>
                <p className="text-sm font-medium">Gmail</p>
                <p className="text-xs text-muted">{CONNECTOR_DESC.gmail}</p>
              </div>
            </div>
            {connectors.get("gmail") ? (
              <button onClick={() => handleDisconnect("gmail")} className="text-xs text-red-400 hover:text-red-300">Disconnect</button>
            ) : (
              <button onClick={() => handleOAuthConnect("gmail")} className="btn-primary text-xs px-3 py-1">Connect</button>
            )}
          </div>

          {/* Google Drive */}
          <div className="flex items-center justify-between py-2 border-b border-surface-3">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${connectors.get("gdrive") ? "bg-emerald-400" : "bg-gray-500"}`} />
              <div>
                <p className="text-sm font-medium">Google Drive</p>
                <p className="text-xs text-muted">{CONNECTOR_DESC.gdrive}</p>
              </div>
            </div>
            {connectors.get("gdrive") ? (
              <button onClick={() => handleDisconnect("gdrive")} className="text-xs text-red-400 hover:text-red-300">Disconnect</button>
            ) : (
              <button onClick={() => handleOAuthConnect("gdrive")} className="btn-primary text-xs px-3 py-1">Connect</button>
            )}
          </div>

          {/* Telegram */}
          <div className="py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${connectors.get("telegram") ? "bg-emerald-400" : "bg-gray-500"}`} />
                <div>
                  <p className="text-sm font-medium">Telegram</p>
                  <p className="text-xs text-muted">{CONNECTOR_DESC.telegram}</p>
                </div>
              </div>
              {connectors.get("telegram") ? (
                <button onClick={() => handleDisconnect("telegram")} className="text-xs text-red-400 hover:text-red-300">Disconnect</button>
              ) : null}
            </div>
            {!connectors.get("telegram") && (
              <div className="mt-2 ml-5">
                <p className="text-xs text-muted mb-2">Message @BotFather on Telegram → /newbot → copy token:</p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={telegramInput}
                    onChange={(e) => setTelegramInput(e.target.value)}
                    placeholder="Paste bot token..."
                    className="input-field flex-1 text-sm"
                    autoComplete="off"
                  />
                  <button
                    onClick={handleTelegramConnect}
                    disabled={telegramConnecting || !telegramInput}
                    className="btn-primary text-xs px-3 py-1 disabled:opacity-40"
                  >
                    {telegramConnecting ? "..." : "Connect"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── arXiv Topics ───────────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-lg">arXiv Research Topics</h2>
        <p className="text-xs text-muted">Select topics to auto-fetch new papers into your wiki.</p>
        <div className="flex flex-wrap gap-2">
          {ARXIV_CATEGORIES.map((cat) => {
            const selected = arxivCategories.includes(cat.value);
            return (
              <button
                key={cat.value}
                onClick={() => setArxivCategories(prev =>
                  prev.includes(cat.value) ? prev.filter(c => c !== cat.value) : [...prev, cat.value]
                )}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  selected
                    ? "bg-accent/15 text-accent border-accent/30"
                    : "text-secondary border-surface-3 hover:border-accent/20"
                }`}
              >
                {cat.label}{selected ? " ✓" : ""}
              </button>
            );
          })}
        </div>
        {arxivCategories.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">{arxivCategories.length} selected</p>
            <button onClick={handleArxivSave} disabled={arxivSaving} className="btn-primary text-xs px-3 py-1 disabled:opacity-40">
              {arxivSaving ? "Saving..." : "Save topics"}
            </button>
          </div>
        )}
      </div>

      {/* ── Security ───────────────────────────────────────── */}
      <div className="rounded-xl p-4 border-2 border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <div>
            <h3 className="font-semibold text-emerald-400 text-sm mb-2">Your data is secure</h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><strong>Encrypted in transit</strong><br/><span className="text-muted">HTTPS/TLS</span></div>
              <div><strong>Encrypted at rest</strong><br/><span className="text-muted">AES-256</span></div>
              <div><strong>Never visible</strong><br/><span className="text-muted">Masked after save</span></div>
              <div><strong>Never logged</strong><br/><span className="text-muted">Auto-redacted</span></div>
              <div><strong>Direct calls</strong><br/><span className="text-muted">No proxy</span></div>
              <div><strong>You control it</strong><br/><span className="text-muted">Replace anytime</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
