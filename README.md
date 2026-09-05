# Man Friday

**You build. Friday posts.** Short-form video content engine for solo builders — Friday
drafts trend-anchored videos for your product and posts them to TikTok and YouTube Shorts;
you approve with a swipe.

- **Site:** [manfriday.app](https://manfriday.app) — Next.js app at the repo root
- **Docs:** `CLAUDE.md` (decisions + conventions) · `docs/` (plan, technical design, file hierarchy)
- **Design:** `design/` (9 artboards + canvas)
- **Env wiring:** `vercel_var.md`
- **Template-spec validation:** `validation/template-spec/`

```
npm install
npm run dev        # site at localhost:3000
```

Blog posts live in `content/blog/*.mdx` — publishing is drop a file, push.
