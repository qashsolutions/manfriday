"use client";

import { useState, useEffect } from "react";
import ProviderSelector, { type Provider } from "@/components/ProviderSelector";
import { apiGet, apiPost, maskKey } from "@/lib/api";

interface ProviderStatus {
  provider: Provider;
  configured: boolean;
  masked_key: string | null;
}

export default function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [maskedKeys, setMaskedKeys] = useState<Record<Provider, string | null>>({
    anthropic: null,
    openai: null,
    gemini: null,
  });
  const [configured, setConfigured] = useState<Record<Provider, boolean>>({
    anthropic: false,
    openai: false,
    gemini: false,
  });
  // newKey holds the raw input ONLY while the user is actively entering a new key.
  // It is cleared immediately after save/validate completes.
  const [newKey, setNewKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiGet("/settings/providers");
        if (res.ok) {
          const statuses: ProviderStatus[] = await res.json();
          const newMasked: Record<Provider, string | null> = { anthropic: null, openai: null, gemini: null };
          const newConfigured: Record<Provider, boolean> = { anthropic: false, openai: false, gemini: false };
          for (const s of statuses) {
            newMasked[s.provider] = s.masked_key;
            newConfigured[s.provider] = s.configured;
          }
          setMaskedKeys(newMasked);
          setConfigured(newConfigured);
        }
      } catch {
        // backend not available
      }
    }
    load();
  }, []);

  // When switching providers, exit editing mode and clear any in-progress key
  useEffect(() => {
    setEditing(false);
    setNewKey("");
    setMessage(null);
  }, [provider]);

  async function handleSaveAndValidate() {
    if (!newKey) return;

    setValidating(true);
    setMessage(null);

    try {
      const res = await apiPost("/validate-key", { provider, api_key: newKey });
      const result = await res.json();

      if (res.status === 429) {
        setMessage({ text: result.detail || "Rate limit exceeded. Try again in a minute.", type: "error" });
        return;
      }

      if (result.valid) {
        // Key validated and stored. Update masked display, clear raw key immediately.
        const returnedMask = result.masked_key || maskKey(newKey);
        setMaskedKeys((prev) => ({ ...prev, [provider]: returnedMask }));
        setConfigured((prev) => ({ ...prev, [provider]: true }));
        setMessage({ text: "Key validated and stored securely.", type: "success" });
        // SECURITY: clear raw key from React state immediately
        setNewKey("");
        setEditing(false);
      } else {
        setMessage({ text: "Invalid API key. Please check and try again.", type: "error" });
      }
    } catch {
      setMessage({ text: "Could not connect to API.", type: "error" });
    } finally {
      setValidating(false);
    }
  }

  function handleReplaceKey() {
    setEditing(true);
    setNewKey("");
    setMessage(null);
  }

  function handleCancelEdit() {
    setEditing(false);
    setNewKey("");
    setMessage(null);
  }

  const keyPlaceholders: Record<Provider, string> = {
    anthropic: "sk-ant-...",
    openai: "sk-...",
    gemini: "AIza...",
  };

  const isConfigured = configured[provider];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
        <p className="text-gray-500 text-sm">Configure your LLM provider and API keys.</p>
      </div>

      {/* How your key is protected — shown prominently before the form */}
      <div className="rounded-xl p-5 border-2 border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-start gap-3">
          <svg className="w-6 h-6 text-emerald-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <div>
            <h3 className="font-semibold text-emerald-400 mb-2">How we protect your API key</h3>
            <p className="text-sm text-secondary mb-3">
              ManFriday uses a Bring Your Own Key (BYOK) model. Your key goes directly from your browser to our secure vault — we use it only to call your chosen LLM provider on your behalf. Here&apos;s exactly what happens:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                <span className="text-secondary"><strong className="text-primary">Encrypted in transit</strong> — your key is sent over HTTPS (TLS 1.3). Nobody can intercept it.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                <span className="text-secondary"><strong className="text-primary">Encrypted at rest</strong> — stored in Google Cloud Secret Manager with AES-256 encryption.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                <span className="text-secondary"><strong className="text-primary">Never visible again</strong> — once saved, only a masked version (e.g. sk-ant-****7x2Q) is shown. You cannot retrieve the full key.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                <span className="text-secondary"><strong className="text-primary">Never logged</strong> — our servers automatically redact API keys from all logs and error reports.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                <span className="text-secondary"><strong className="text-primary">Direct calls only</strong> — ManFriday calls Anthropic / OpenAI / Google directly with your key. We never proxy, inspect, or store your LLM conversations.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">&#10003;</span>
                <span className="text-secondary"><strong className="text-primary">You stay in control</strong> — replace or delete your key anytime. Revoke it at your provider&apos;s dashboard and it stops working immediately.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Provider selector */}
      <div className="card space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            LLM Provider
          </label>
          <ProviderSelector selected={provider} onChange={setProvider} />
        </div>

        {/* API key section */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            API Key
          </label>

          {isConfigured && !editing ? (
            /* Show masked key with lock icon and replace button */
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5">
                <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-sm text-gray-400 font-mono">
                  {maskedKeys[provider] || "****"}
                </span>
              </div>
              <button
                onClick={handleReplaceKey}
                className="btn-secondary"
              >
                Replace key
              </button>
            </div>
          ) : (
            /* Input mode: new key entry with type="password" */
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={keyPlaceholders[provider]}
                  className="input-field w-full"
                  autoComplete="off"
                />
              </div>
              <button
                onClick={handleSaveAndValidate}
                disabled={validating || !newKey}
                className="btn-primary disabled:opacity-40"
              >
                {validating ? "Validating..." : "Save key"}
              </button>
              {editing && (
                <button
                  onClick={handleCancelEdit}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* Inline hint */}
          <p className="text-xs text-muted mt-2">
            Your key is encrypted and stored securely. You cannot view it after saving — only replace it.
          </p>
        </div>

        {/* Message */}
        {message && (
          <p
            className={`text-sm ${
              message.type === "success" ? "text-green-400" : "text-red-400"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>

      {/* Provider status overview */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Provider Status</h2>
        <div className="space-y-3">
          {(["anthropic", "openai", "gemini"] as Provider[]).map((p) => (
            <div key={p} className="flex items-center justify-between">
              <span className="text-sm text-gray-300 capitalize">{p}</span>
              <div className="flex items-center gap-2">
                {configured[p] ? (
                  <span className="text-xs text-gray-500 font-mono">
                    {maskedKeys[p] || "****"}
                  </span>
                ) : (
                  <span className="text-xs text-gray-600">Not configured</span>
                )}
                <span
                  className={`w-2 h-2 rounded-full ${
                    configured[p] ? "bg-green-400" : "bg-gray-600"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
