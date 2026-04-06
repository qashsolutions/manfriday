/**
 * Mock data for static GitHub Pages demo.
 * When API is unavailable, pages fall back to this demo content.
 */

export const DEMO_MODE = typeof window !== "undefined" && !window.location.hostname.includes("localhost");

export const mockStats = {
  total_pages: 24,
  total_entities: 8,
  total_concepts: 6,
  total_articles: 7,
  total_outputs: 3,
};

export const mockArticles = [
  { slug: "attention-is-all-you-need", title: "Attention Is All You Need", type: "article", summary: "Foundational transformer paper introducing self-attention mechanism", created: "2026-04-06" },
  { slug: "mixture-of-experts", title: "Mixture of Experts", type: "article", summary: "Sparse MoE architecture for scaling language models efficiently", created: "2026-04-05" },
  { slug: "constitutional-ai", title: "Constitutional AI", type: "article", summary: "Anthropic's approach to AI alignment via constitutional principles", created: "2026-04-04" },
  { slug: "sparse-autoencoders", title: "Sparse Autoencoders for Interpretability", type: "article", summary: "Using SAEs to extract interpretable features from neural networks", created: "2026-04-03" },
  { slug: "scaling-laws", title: "Scaling Laws for Neural LMs", type: "article", summary: "Kaplan et al. on compute-optimal scaling of language models", created: "2026-04-02" },
];

export const mockEntities = [
  { slug: "andrej-karpathy", name: "Andrej Karpathy", type: "person" },
  { slug: "anthropic", name: "Anthropic", type: "org" },
  { slug: "openai", name: "OpenAI", type: "org" },
  { slug: "google-deepmind", name: "Google DeepMind", type: "org" },
  { slug: "transformer", name: "Transformer", type: "project" },
];

export const mockConcepts = [
  { slug: "attention-mechanism", name: "Attention Mechanism", definition: "Weighted focus on input elements" },
  { slug: "mixture-of-experts", name: "Mixture of Experts", definition: "Sparse routing to specialized sub-networks" },
  { slug: "constitutional-ai", name: "Constitutional AI", definition: "Alignment via self-critique against principles" },
  { slug: "bm25-search", name: "BM25 Search", definition: "Probabilistic information retrieval ranking function" },
  { slug: "knowledge-distillation", name: "Knowledge Distillation", definition: "Training smaller models from larger ones" },
];

export const mockSources = [
  { slug: "attention-is-all-you-need", url: "https://arxiv.org/abs/1706.03762", type: "url", quality_score: 9.2, quality_suppressed: false, ingested_at: "2026-04-06T10:00:00Z" },
  { slug: "karpathy-llm-os", url: "https://www.youtube.com/watch?v=zjkBMFhNj_g", type: "url", quality_score: 8.5, quality_suppressed: false, ingested_at: "2026-04-05T14:00:00Z" },
  { slug: "low-quality-rss", url: "https://example.com/feed", type: "rss", quality_score: 2.1, quality_suppressed: true, suppression_reason: "RSS item too short (45 words, min 200)", ingested_at: "2026-04-05T12:00:00Z" },
];

export const mockTopics = [
  { topic: "attention mechanism", count: 6, last_active: "2026-04-06" },
  { topic: "mixture of experts", count: 4, last_active: "2026-04-05" },
  { topic: "interpretability", count: 3, last_active: "2026-04-04" },
  { topic: "scaling laws", count: 2, last_active: "2026-04-03" },
];

export const mockEpisodes = [
  { date: "2026-04-06", query: "What connects attention and MoE architectures?", topics_detected: ["attention-mechanism", "mixture-of-experts"], output_type: "md", filed: true },
  { date: "2026-04-05", query: "Summarise constitutional AI papers", topics_detected: ["constitutional-ai"], output_type: "md", filed: true },
  { date: "2026-04-04", query: "Compare scaling laws across model families", topics_detected: ["scaling-laws"], output_type: "table", filed: false },
];

export const mockWikiPage = {
  slug: "attention-is-all-you-need",
  title: "Attention Is All You Need",
  type: "article",
  content: `## Summary

The **Transformer** architecture, introduced by [[Vaswani et al.]] at [[Google]] in 2017, replaces recurrence entirely with [[attention-mechanism]] — specifically multi-head self-attention.

## Key Contributions

- **Self-attention**: Each token attends to all other tokens in the sequence
- **Multi-head attention**: Multiple attention heads capture different relationship types
- **Positional encoding**: Sinusoidal functions inject sequence order without recurrence
- **Encoder-decoder structure**: 6 layers each with residual connections and layer normalization

## Impact

This paper is the foundation for all modern LLMs including [[GPT]], [[Claude]], and [[Gemini]]. The architecture scales efficiently and has been extended to vision ([[ViT]]), audio, and multimodal domains.

## Related Concepts

- [[attention-mechanism]]
- [[knowledge-distillation]]
- [[scaling-laws]]

*Source: [[attention-is-all-you-need]]*`,
  created: "2026-04-06",
  updated: "2026-04-06",
  tags: ["transformers", "attention", "architecture"],
  sources: ["attention-is-all-you-need"],
  source_count: 1,
};

export const mockBacklinks = [
  { slug: "attention-mechanism", title: "Attention Mechanism", type: "concept" },
  { slug: "transformer", title: "Transformer", type: "entity" },
  { slug: "scaling-laws", title: "Scaling Laws for Neural LMs", type: "article" },
];

/**
 * Wrapper for fetch that falls back to mock data in demo mode.
 */
export async function demoFetch(url: string, fallback: unknown): Promise<Response> {
  try {
    const res = await fetch(url);
    if (res.ok) return res;
    throw new Error(`${res.status}`);
  } catch {
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
