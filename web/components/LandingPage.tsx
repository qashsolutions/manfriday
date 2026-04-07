"use client";

import Link from "next/link";

/* ────────────────────────────────────────────────────────────
   SVG Icon Components — flagship-quality, 48×48 stroke icons
   ──────────────────────────────────────────────────────────── */

function WikiIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="36" height="40" rx="3" />
      <path d="M14 4v40" />
      <path d="M22 14h12" />
      <path d="M22 20h12" />
      <path d="M22 26h8" />
      <circle cx="10" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="10" cy="20" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="10" cy="26" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BrainIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 44V26" />
      <path d="M24 26c-4-2-10-2-12 2s0 10 4 12" />
      <path d="M24 26c4-2 10-2 12 2s0 10-4 12" />
      <path d="M12 28c-4-2-8-6-6-12s8-8 12-6" />
      <path d="M36 28c4-2 8-6 6-12s-8-8-12-6" />
      <path d="M18 10c0-4 2-8 6-8s6 4 6 8" />
      <circle cx="16" cy="20" r="2" fill="currentColor" stroke="none" opacity="0.3" />
      <circle cx="32" cy="20" r="2" fill="currentColor" stroke="none" opacity="0.3" />
      <circle cx="24" cy="14" r="2" fill="currentColor" stroke="none" opacity="0.3" />
    </svg>
  );
}

function SearchIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="20" cy="20" r="14" />
      <path d="M30 30l12 12" strokeWidth={2.5} />
      <path d="M14 16h12" />
      <path d="M14 22h8" />
    </svg>
  );
}

function GraphIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="12" r="5" />
      <circle cx="10" cy="36" r="5" />
      <circle cx="38" cy="36" r="5" />
      <circle cx="40" cy="16" r="3" />
      <circle cx="8" cy="20" r="3" />
      <path d="M22 17L12 32" />
      <path d="M26 17l10 15" />
      <path d="M15 36h18" />
      <path d="M28 14l10 3" />
      <path d="M20 14l-10 5" />
    </svg>
  );
}

function ShieldIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 4L6 12v12c0 11 8 18 18 20 10-2 18-9 18-20V12L24 4z" />
      <path d="M17 24l5 5 10-10" strokeWidth={2} />
    </svg>
  );
}

function MailIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="40" height="28" rx="3" />
      <path d="M4 14l20 13 20-13" />
      <circle cx="38" cy="14" r="6" fill="#4285F4" stroke="none" />
      <path d="M35.5 14l1.5 2 3-3.5" stroke="white" strokeWidth={1.5} fill="none" />
    </svg>
  );
}

function DriveIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 6h16l14 24H30L16 6z" />
      <path d="M2 30l8-14" />
      <path d="M16 6L2 30h14" />
      <path d="M16 30h30" />
      <path d="M16 30l8 12h16l-8-12" />
      <path d="M2 30l8 12h6" />
    </svg>
  );
}

function TelegramIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="20" fill="#2AABEE" />
      <path d="M12 24l5 2 2 6 3-4 5 4 9-20-24 12z" fill="white" />
      <path d="M17 26l1 6 3-4" fill="#D0E8F4" />
    </svg>
  );
}

function KeyIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="14" cy="28" r="10" />
      <path d="M22 20l18-12" strokeWidth={2} />
      <path d="M36 8l4 4" />
      <path d="M32 12l4 4" />
      <circle cx="14" cy="28" r="4" />
    </svg>
  );
}

function ChecklistIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="36" height="40" rx="3" />
      <path d="M14 16l3 3 6-6" strokeWidth={2} />
      <path d="M28 16h10" />
      <path d="M14 28l3 3 6-6" strokeWidth={2} />
      <path d="M28 28h10" />
      <rect x="14" y="36" width="6" height="6" rx="1" opacity="0.3" />
      <path d="M28 39h10" />
    </svg>
  );
}

function OutputIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="24" height="32" rx="2" />
      <path d="M10 12h12" />
      <path d="M10 18h12" />
      <path d="M10 24h8" />
      <rect x="20" y="12" width="24" height="32" rx="2" fill="none" />
      <path d="M26 22h12" />
      <path d="M26 28h12" />
      <path d="M26 34h8" />
      <path d="M34 20v-8l8 8h-8z" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

function PdfIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4h20l12 12v28a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z" />
      <path d="M28 4v12h12" />
      <rect x="12" y="26" width="24" height="12" rx="2" fill="#E53E3E" stroke="none" />
      <text x="24" y="35.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="system-ui" stroke="none">PDF</text>
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────
   Landing Page Component
   ──────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-20 py-8">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="text-center space-y-6 pt-8">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center">
            <BrainIcon className="w-12 h-12 text-white" />
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
          Your personal knowledge base,
          <br />
          <span className="text-accent">maintained by AI.</span>
        </h1>
        <p className="text-lg max-w-2xl mx-auto leading-relaxed text-secondary">
          Feed it URLs, PDFs, emails, and documents. ManFriday reads everything, builds a structured wiki
          with interlinked pages, and gets smarter with every source you add. Not a chatbot — a compounding knowledge engine.
        </p>
        <div className="flex gap-3 justify-center pt-4">
          <Link href="/signup" className="bg-accent hover:bg-accent-hover text-white font-semibold text-lg px-8 py-3.5 rounded-xl transition-all hover:shadow-lg hover:shadow-accent/25">
            Get started free
          </Link>
          <Link href="/wiki" className="btn-secondary text-lg px-8 py-3.5 rounded-xl">
            See demo
          </Link>
        </div>
        <p className="text-sm text-muted">
          Free forever. Bring your own API key. We never see your data.
        </p>
      </section>

      {/* ── How it works ─────────────────────────────────── */}
      <section className="space-y-10">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">How it works</h2>
          <p className="text-secondary">Three steps to a smarter knowledge base</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: <SearchIcon className="w-14 h-14 text-blue-400" />,
              step: "1",
              title: "Add sources",
              desc: "Paste a URL, upload a PDF, connect Gmail or Drive. ManFriday fetches, cleans, and quality-scores every source automatically.",
            },
            {
              icon: <WikiIcon className="w-14 h-14 text-emerald-400" />,
              step: "2",
              title: "Wiki builds itself",
              desc: "AI extracts entities (people, orgs), concepts (ideas, methods), writes article summaries — all interlinked with [[wikilinks]].",
            },
            {
              icon: <BrainIcon className="w-14 h-14 text-purple-400" />,
              step: "3",
              title: "Ask anything",
              desc: "Q&A draws from your compiled wiki — not raw document chunks. Answers cite sources, show reasoning, and can be filed as new pages.",
            },
          ].map((item) => (
            <div key={item.step} className="card text-center space-y-4 hover:border-accent/30 transition-colors">
              <div className="flex justify-center">{item.icon}</div>
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent/10 text-accent font-bold text-sm">{item.step}</div>
              <h3 className="text-xl font-semibold">{item.title}</h3>
              <p className="text-sm text-secondary leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature Showcase ─────────────────────────────── */}
      <section className="space-y-10">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Everything you need</h2>
          <p className="text-secondary">A complete knowledge management platform</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            {
              icon: <WikiIcon className="w-12 h-12 text-indigo-400" />,
              title: "Structured Wiki with [[Wikilinks]]",
              desc: "Entity pages for people and orgs. Concept pages for ideas. Article summaries. All interlinked — click any [[wikilink]] to navigate.",
            },
            {
              icon: <GraphIcon className="w-12 h-12 text-cyan-400" />,
              title: "Knowledge Graph Visualization",
              desc: "See how your knowledge connects. Force-directed graph shows entities, concepts, and relationships. Click to explore neighborhoods.",
            },
            {
              icon: <ChecklistIcon className="w-12 h-12 text-amber-400" />,
              title: "Nightly Health Checks",
              desc: "AI lint agent finds contradictions, stale claims, orphan pages, and missing links. Suggests new articles automatically.",
            },
            {
              icon: <ShieldIcon className="w-12 h-12 text-emerald-400" />,
              title: "Quality Scoring (1-10)",
              desc: "Every source scored on signal density, relevance, novelty, and credibility. Low-quality sources filtered before they pollute your wiki.",
            },
            {
              icon: <OutputIcon className="w-12 h-12 text-rose-400" />,
              title: "Multi-Format Output",
              desc: "Get answers as markdown, Marp slide decks, matplotlib charts, or comparison tables. File any output back as a wiki page.",
            },
            {
              icon: <SearchIcon className="w-12 h-12 text-violet-400" />,
              title: "Hybrid Search (BM25 + Semantic)",
              desc: "Keyword search for precision. Semantic search for meaning. Hybrid mode combines both — falls back automatically when needed.",
            },
          ].map((item) => (
            <div key={item.title} className="card flex gap-5 items-start hover:border-accent/30 transition-colors">
              <div className="flex-shrink-0 mt-1">{item.icon}</div>
              <div>
                <h3 className="font-semibold text-lg mb-1">{item.title}</h3>
                <p className="text-sm text-secondary leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Connect Your Sources ─────────────────────────── */}
      <section className="space-y-10">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Connect your world</h2>
          <p className="text-secondary">Ingest from anywhere — ManFriday does the rest</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              icon: <MailIcon className="w-14 h-14" />,
              title: "Gmail",
              desc: "Connect with Google OAuth. Read-only access — ManFriday reads your emails, extracts knowledge, filters newsletters automatically.",
              setup: "Settings → Connected Accounts → Connect Gmail",
            },
            {
              icon: <DriveIcon className="w-14 h-14 text-green-400" />,
              title: "Google Drive",
              desc: "Docs, PDFs, spreadsheets. ManFriday extracts text from Google Docs, profiles CSVs, and reads PDFs — all read-only.",
              setup: "Settings → Connected Accounts → Connect Drive",
            },
            {
              icon: <TelegramIcon className="w-14 h-14" />,
              title: "Telegram",
              desc: "Create a bot via @BotFather in Telegram, paste the token. ManFriday polls your channels and starred messages.",
              setup: "1. Message @BotFather → /newbot\n2. Copy the token\n3. Settings → Connected Accounts → Paste token",
            },
            {
              icon: <PdfIcon className="w-14 h-14" />,
              title: "PDF / URL / RSS",
              desc: "Paste any URL — Jina Reader extracts clean markdown. Upload PDFs directly. Add RSS feeds for automatic polling.",
              setup: "Sources → Add Source → Paste URL or upload file",
            },
          ].map((item) => (
            <div key={item.title} className="card space-y-3 hover:border-accent/30 transition-colors">
              <div className="flex justify-center">{item.icon}</div>
              <h3 className="font-semibold text-center">{item.title}</h3>
              <p className="text-xs text-secondary leading-relaxed">{item.desc}</p>
              <div className="bg-surface-2 rounded-lg p-2.5">
                <p className="text-xs text-muted font-mono whitespace-pre-line">{item.setup}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BYOK ─────────────────────────────────────────── */}
      <section className="space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Bring Your Own Key</h2>
          <p className="text-secondary">Your API key, your data, your choice of provider</p>
        </div>
        <div className="card space-y-6">
          <div className="flex items-start gap-5">
            <KeyIcon className="w-14 h-14 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-secondary leading-relaxed">
                ManFriday uses <strong>your</strong> API key — we never store, proxy, or see your LLM calls.
                All processing happens between you and your chosen provider. Switch providers anytime in Settings.
              </p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { name: "Anthropic", models: "Claude Sonnet 4 / Haiku", color: "from-orange-500/20 to-orange-600/5", border: "border-orange-500/20" },
              { name: "OpenAI", models: "GPT-4o / GPT-4o-mini", color: "from-green-500/20 to-green-600/5", border: "border-green-500/20" },
              { name: "Google", models: "Gemini 1.5 Pro / Flash", color: "from-blue-500/20 to-blue-600/5", border: "border-blue-500/20" },
            ].map((p) => (
              <div key={p.name} className={`rounded-xl p-5 bg-gradient-to-br ${p.color} border ${p.border} text-center`}>
                <p className="font-semibold text-lg">{p.name}</p>
                <p className="text-xs text-muted mt-1">{p.models}</p>
              </div>
            ))}
          </div>
          <div className="bg-surface-2 rounded-lg p-4">
            <p className="text-xs text-muted font-mono">
              How to set up: Settings → API Key → Select provider → Paste your key → Validate → Done.
              <br />
              Get your key: anthropic.com/api • platform.openai.com/api-keys • aistudio.google.com/apikey
            </p>
          </div>
        </div>
      </section>

      {/* ── RAG vs ManFriday ─────────────────────────────── */}
      <section className="space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Not RAG. A compiled wiki.</h2>
          <p className="text-secondary">Knowledge that compounds instead of decaying</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="card space-y-3 opacity-60">
            <p className="font-semibold text-red-400">Traditional RAG</p>
            <ul className="text-sm text-secondary space-y-2">
              <li className="flex gap-2"><span className="text-red-400">✕</span> Re-derives knowledge every query</li>
              <li className="flex gap-2"><span className="text-red-400">✕</span> No memory between sessions</li>
              <li className="flex gap-2"><span className="text-red-400">✕</span> No entity or concept tracking</li>
              <li className="flex gap-2"><span className="text-red-400">✕</span> No contradiction detection</li>
              <li className="flex gap-2"><span className="text-red-400">✕</span> 100 documents = 100 disconnected chunks</li>
            </ul>
          </div>
          <div className="card space-y-3 border-accent/30">
            <p className="font-semibold text-accent">ManFriday</p>
            <ul className="text-sm text-secondary space-y-2">
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Wiki compiled once, kept current</li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Memory persists across sessions</li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Dedicated entity + concept pages</li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Lint agent flags conflicts automatically</li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> 100 sources = rich, interlinked knowledge graph</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="text-center space-y-6 pb-12">
        <h2 className="text-3xl font-bold">Start building your knowledge base</h2>
        <p className="text-secondary text-lg">Free forever. Set up in 2 minutes. No credit card required.</p>
        <Link href="/signup" className="bg-accent hover:bg-accent-hover text-white font-semibold text-lg px-10 py-4 rounded-xl transition-all hover:shadow-lg hover:shadow-accent/25 inline-block">
          Sign up free
        </Link>
      </section>
    </div>
  );
}
