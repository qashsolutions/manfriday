"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-16 py-8">
      {/* Hero */}
      <section className="text-center space-y-6">
        <h1 className="text-4xl md:text-5xl font-bold text-primary tracking-tight">
          Your personal knowledge base,
          <br />
          <span className="text-accent">maintained by AI.</span>
        </h1>
        <p className="text-lg text-secondary max-w-2xl mx-auto leading-relaxed">
          ManFriday builds and maintains a structured wiki from your sources — URLs, PDFs, emails, and more.
          Knowledge compounds over time. Not a RAG system — a living, interlinked wiki.
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <Link href="/signup" className="btn-primary text-lg px-6 py-3">
            Get started free
          </Link>
          <Link href="/wiki" className="btn-secondary text-lg px-6 py-3">
            See demo
          </Link>
        </div>
        <p className="text-sm text-muted">
          Free forever. Bring your own API key — we never see your data.
        </p>
      </section>

      {/* How it works */}
      <section className="space-y-8">
        <h2 className="text-2xl font-bold text-center text-primary">How it works</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="card text-center space-y-3">
            <div className="text-3xl">1</div>
            <h3 className="font-semibold text-primary">Add sources</h3>
            <p className="text-sm text-secondary">
              Paste a URL, upload a PDF, or connect Gmail/Drive. ManFriday fetches and cleans the content.
            </p>
          </div>
          <div className="card text-center space-y-3">
            <div className="text-3xl">2</div>
            <h3 className="font-semibold text-primary">Wiki builds automatically</h3>
            <p className="text-sm text-secondary">
              AI extracts entities, concepts, and relationships. Articles are written, interlinked, and indexed.
            </p>
          </div>
          <div className="card text-center space-y-3">
            <div className="text-3xl">3</div>
            <h3 className="font-semibold text-primary">Ask anything</h3>
            <p className="text-sm text-secondary">
              Q&A draws from your compiled wiki — not raw chunks. Answers cite sources with [[wikilinks]].
            </p>
          </div>
        </div>
      </section>

      {/* BYOK */}
      <section className="card space-y-4">
        <h2 className="text-xl font-bold text-primary">Bring Your Own Key (BYOK)</h2>
        <p className="text-secondary">
          ManFriday uses <strong>your</strong> API key — Anthropic, OpenAI, or Google Gemini. We never store, proxy, or see your LLM calls. Your data stays between you and your chosen provider.
        </p>
        <div className="grid md:grid-cols-3 gap-4 pt-2">
          <div className="bg-surface-2 rounded-lg p-4 text-center">
            <p className="font-semibold text-primary">Anthropic</p>
            <p className="text-xs text-muted mt-1">Claude Sonnet / Haiku</p>
          </div>
          <div className="bg-surface-2 rounded-lg p-4 text-center">
            <p className="font-semibold text-primary">OpenAI</p>
            <p className="text-xs text-muted mt-1">GPT-4o / GPT-4o-mini</p>
          </div>
          <div className="bg-surface-2 rounded-lg p-4 text-center">
            <p className="font-semibold text-primary">Google</p>
            <p className="text-xs text-muted mt-1">Gemini 1.5 Pro / Flash</p>
          </div>
        </div>
      </section>

      {/* What makes it different */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-center text-primary">Not RAG. A compiled wiki.</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card space-y-2">
            <p className="text-sm font-semibold text-red-400">Traditional RAG</p>
            <ul className="text-sm text-secondary space-y-1">
              <li>Re-derives knowledge every query</li>
              <li>No memory between sessions</li>
              <li>No entity or concept tracking</li>
              <li>No contradiction detection</li>
            </ul>
          </div>
          <div className="card space-y-2 border-accent/30">
            <p className="text-sm font-semibold text-accent">ManFriday</p>
            <ul className="text-sm text-secondary space-y-1">
              <li>Wiki compiled once, kept current</li>
              <li>Memory persists across sessions</li>
              <li>Dedicated entity + concept pages</li>
              <li>Lint agent flags conflicts automatically</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-center text-primary">Everything included</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            ["Wiki with [[wikilinks]]", "Entities, concepts, articles — all interlinked"],
            ["Quality scoring", "Sources scored 1-10 on signal, relevance, novelty, credibility"],
            ["Nightly health checks", "Contradictions, stale claims, orphan pages detected automatically"],
            ["Concept graph", "Force-directed visualization of your knowledge network"],
            ["Connectors", "Gmail, Google Drive, Telegram, WhatsApp, arXiv"],
            ["Multi-format output", "Markdown, Marp slides, charts, comparison tables"],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-3 items-start">
              <div className="w-2 h-2 rounded-full bg-accent mt-2 flex-shrink-0" />
              <div>
                <p className="font-medium text-primary">{title}</p>
                <p className="text-sm text-secondary">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="text-center space-y-4 pb-8">
        <h2 className="text-2xl font-bold text-primary">Start building your knowledge base</h2>
        <p className="text-secondary">Free forever. Set up in 2 minutes.</p>
        <Link href="/signup" className="btn-primary text-lg px-8 py-3 inline-block">
          Sign up free
        </Link>
      </section>
    </div>
  );
}
