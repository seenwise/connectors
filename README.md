# Seenwise connectors

Drop-in connectors that forward **AI traffic** to Seenwise from your edge/server:

- **crawls** — an AI bot fetched a page (`User-Agent`: GPTBot, ChatGPT-User, PerplexityBot, Grok, …)
- **referrals** — a human arrived from an AI answer (`Referer`: chatgpt.com, perplexity.ai, claude.ai, …)

Each filters to AI traffic only (via `lib/bots.js`, generated — the Seenwise server re-validates) and
POSTs the same batch to `https://api.tryseenwise.com/ingest`.

> **Generated mirror.** This repo is published from the Seenwise monorepo — don't edit it directly.
> `lib/bots.js` / `lib/bots.cjs` are code-generated from one source, so the bot list never drifts.

## Which connector?

Prefer a layer that sees the **response status** — only those capture **404 content-gaps** (pages AI
asks for that don't exist):

| Connector                                                                                                                             | Reads | 404s | Deploy                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------- | :---: | :--: | ----------------------------------------------------------------------------------------- |
| `cloudflare-worker.js` + `wrangler.toml`                                                                                              |  ✅   |  ✅  | `wrangler deploy` + a route. **Recommended** (an edge in front sees everything).          |
| `node-express-middleware.js`                                                                                                          |  ✅   |  ✅  | `app.use(seenwiseAttribution())` (Express, or Remix/Next via a custom server).            |
| `vercel-middleware.ts`                                                                                                                |  ✅   |  ❌  | Copy as `middleware.ts`. 404s need Cloudflare/Node (middleware runs before the response). |
| `cloudflare-logpush.js` · `vercel-log-drain.js` · `aws-cloudfront-lambda.mjs` (+ `aws-cloudformation.yaml`) · `gcp-log-sink-setup.sh` |  ✅   |  ✅  | Async log pipelines (complete coverage, higher tiers).                                    |

## Setup

Set two values from your Seenwise dashboard (Attribution → connect your site) as **env vars / secrets —
never commit them**:

- `SEENWISE_BRAND` — your brand id
- `SEENWISE_KEY` (Worker) / `SEENWISE_INGEST_KEY` (others) — your write-only ingest key

## Importing `lib/`

Every artifact imports the generated filter: `./lib/bots.js` (ESM) or `./lib/bots.cjs` (CommonJS,
for Express). Deploy tools that bundle (wrangler, Vercel, esbuild) pull it in automatically. If you
**copy a single file** into your own project (e.g. `vercel-middleware.ts`), copy `lib/` alongside it —
or just paste the self-contained snippet from the Seenwise dashboard, which has the filter inlined.

## Test

```bash
node --test test/*.mjs   # zero-dep smoke test (the monorepo owns the full drift/parity guard)
```
