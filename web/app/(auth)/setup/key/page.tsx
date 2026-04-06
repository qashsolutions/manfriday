"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProviderSelector, { type Provider } from "@/components/ProviderSelector";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function SetupKeyPage() {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keyPlaceholders: Record<Provider, string> = {
    anthropic: "sk-ant-...",
    openai: "sk-...",
    gemini: "AIza...",
  };

  async function handleValidate() {
    if (!apiKey.trim()) return;

    setValidating(true);
    setError(null);
    setValid(null);

    try {
      const res = await fetch(`${API}/sources/validate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey.trim() }),
      });

      const result = await res.json();

      if (result.valid) {
        setValid(true);
      } else {
        setValid(false);
        setError(result.error || "Invalid API key.");
      }
    } catch {
      setError("Could not connect to API. Is the backend running?");
    } finally {
      setValidating(false);
    }
  }

  function handleContinue() {
    router.push("/setup/sources");
  }

  return (
    <div className="card space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">Bring Your Own Key</h2>
        <p className="text-gray-400 text-sm mt-1">
          Connect your LLM provider to power your wiki.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">
          LLM Provider
        </label>
        <ProviderSelector selected={provider} onChange={setProvider} />
      </div>

      <div>
        <label htmlFor="api-key" className="block text-sm font-medium text-gray-300 mb-2">
          API Key
        </label>
        <input
          id="api-key"
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setValid(null);
            setError(null);
          }}
          placeholder={keyPlaceholders[provider]}
          className="input-field w-full"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {valid && <p className="text-sm text-green-400">API key is valid.</p>}

      <div className="flex gap-3">
        <button
          onClick={handleValidate}
          disabled={validating || !apiKey.trim()}
          className="btn-secondary flex-1 disabled:opacity-40"
        >
          {validating ? "Validating..." : "Validate"}
        </button>
        <button
          onClick={handleContinue}
          disabled={!valid}
          className="btn-primary flex-1 disabled:opacity-40"
        >
          Continue
        </button>
      </div>

      <p className="text-xs text-gray-600 text-center">
        Your key is stored securely and never shared.
      </p>
    </div>
  );
}
