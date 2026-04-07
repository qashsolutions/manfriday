"use client";

import { useState, useEffect } from "react";
import ProviderSelector, { type Provider } from "@/components/ProviderSelector";
import { apiGet, apiPost, apiFetch } from "@/lib/api";

interface ProviderConfig {
  provider: Provider;
  api_key: string;
  valid: boolean | null;
}

export default function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [keys, setKeys] = useState<Record<Provider, string>>({
    anthropic: "",
    openai: "",
    gemini: "",
  });
  const [validation, setValidation] = useState<Record<Provider, boolean | null>>({
    anthropic: null,
    openai: null,
    gemini: null,
  });
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiGet("/settings/providers");
        if (res.ok) {
          const configs: ProviderConfig[] = await res.json();
          const newKeys = { ...keys };
          const newValidation = { ...validation };
          for (const c of configs) {
            if (c.api_key) {
              // masked key from API
              newKeys[c.provider] = c.api_key;
            }
            newValidation[c.provider] = c.valid;
          }
          setKeys(newKeys);
          setValidation(newValidation);
        }
      } catch {
        // backend not available
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleValidate() {
    const key = keys[provider];
    if (!key) return;

    setValidating(true);
    setMessage(null);

    try {
      const res = await apiPost("/settings/providers/validate", { provider, api_key: key });

      const result = await res.json();
      setValidation((prev) => ({ ...prev, [provider]: result.valid }));
      setMessage({
        text: result.valid ? "API key is valid." : result.error || "Invalid API key.",
        type: result.valid ? "success" : "error",
      });
    } catch {
      setMessage({ text: "Could not connect to API.", type: "error" });
    } finally {
      setValidating(false);
    }
  }

  async function handleSave() {
    const key = keys[provider];
    if (!key) return;

    setSaving(true);
    setMessage(null);

    try {
      const res = await apiFetch("/settings/providers", {
        method: "PUT",
        body: JSON.stringify({ provider, api_key: key }),
      });

      if (res.ok) {
        setMessage({ text: "Saved successfully.", type: "success" });
      } else {
        const body = await res.json().catch(() => ({}));
        setMessage({ text: body.detail || "Failed to save.", type: "error" });
      }
    } catch {
      setMessage({ text: "Could not connect to API.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const keyPlaceholders: Record<Provider, string> = {
    anthropic: "sk-ant-...",
    openai: "sk-...",
    gemini: "AIza...",
  };

  const validIcon = validation[provider];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
        <p className="text-gray-500 text-sm">Configure your LLM provider and API keys.</p>
      </div>

      {/* Provider selector */}
      <div className="card space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3">
            LLM Provider
          </label>
          <ProviderSelector selected={provider} onChange={setProvider} />
        </div>

        {/* API key input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            API Key
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <input
                type="password"
                value={keys[provider]}
                onChange={(e) =>
                  setKeys((prev) => ({ ...prev, [provider]: e.target.value }))
                }
                placeholder={keyPlaceholders[provider]}
                className="input-field w-full pr-10"
              />
              {validIcon !== null && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {validIcon ? (
                    <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </span>
              )}
            </div>
            <button
              onClick={handleValidate}
              disabled={validating || !keys[provider]}
              className="btn-secondary disabled:opacity-40"
            >
              {validating ? "Checking..." : "Validate"}
            </button>
          </div>
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

        {/* Save */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || !keys[provider]}
            className="btn-primary disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Provider status overview */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Provider Status</h2>
        <div className="space-y-3">
          {(["anthropic", "openai", "gemini"] as Provider[]).map((p) => (
            <div key={p} className="flex items-center justify-between">
              <span className="text-sm text-gray-300 capitalize">{p}</span>
              <div className="flex items-center gap-2">
                {keys[p] ? (
                  <span className="text-xs text-gray-500 font-mono">
                    {keys[p].slice(0, 8)}...
                  </span>
                ) : (
                  <span className="text-xs text-gray-600">Not configured</span>
                )}
                <span
                  className={`w-2 h-2 rounded-full ${
                    validation[p] === true
                      ? "bg-green-400"
                      : validation[p] === false
                        ? "bg-red-400"
                        : "bg-gray-600"
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
