"use client";

export type ConnectorType = "gmail" | "gdrive" | "telegram" | "whatsapp" | "arxiv";

interface ConnectedAccountCardProps {
  connectorType: ConnectorType;
  connected: boolean;
  lastPolled?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

const CONNECTOR_META: Record<ConnectorType, { label: string; icon: JSX.Element }> = {
  gmail: {
    label: "Gmail",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M2 6l10 7 10-7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth={2} fill="none" />
      </svg>
    ),
  },
  gdrive: {
    label: "Google Drive",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M8 2l8 0 4 7H4l4-7z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
        <path d="M4 9l4 7h12l-4-7" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
        <path d="M8 16l4 6 4-6" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    ),
  },
  telegram: {
    label: "Telegram",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M22 2L11 13" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 2L15 22l-4-9-9-4L22 2z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    ),
  },
  whatsapp: {
    label: "WhatsApp",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  arxiv: {
    label: "arXiv",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    ),
  },
};

export default function ConnectedAccountCard({
  connectorType,
  connected,
  lastPolled,
  onConnect,
  onDisconnect,
}: ConnectedAccountCardProps) {
  const meta = CONNECTOR_META[connectorType];

  return (
    <div className="border border-surface-3 bg-surface-2 rounded-lg p-4">
      <div className="flex items-center justify-between">
        {/* Left: icon + name + status */}
        <div className="flex items-center gap-3">
          <div className="text-gray-300">{meta.icon}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{meta.label}</span>
              <span
                className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-gray-600"}`}
                title={connected ? "Connected" : "Disconnected"}
              />
            </div>
            {lastPolled ? (
              <p className="text-xs text-gray-500 mt-0.5">
                Last polled: {new Date(lastPolled).toLocaleString()}
              </p>
            ) : (
              <p className="text-xs text-gray-600 mt-0.5">Never polled</p>
            )}
          </div>
        </div>

        {/* Right: action button */}
        <button
          onClick={connected ? onDisconnect : onConnect}
          className={`text-sm px-4 py-1.5 rounded-md font-medium transition-colors ${
            connected
              ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30"
              : "btn-primary"
          }`}
        >
          {connected ? "Disconnect" : "Connect"}
        </button>
      </div>
    </div>
  );
}
