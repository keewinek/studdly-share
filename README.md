# studdly-share

Share-link service for [Studdly](https://studdly.app) learning paths: `https://share.studdly.app/<code>`.

A Studdly user who finished AI analysis of a topic taps **Share** → the app uploads the generated learning path (sub-topics + quizzes, never the scanned pages) → gets a short link → friends open it and import the same path into their app, or see a preview page with store links if they don't have Studdly yet.

**Status:** design phase — no code yet. Start with the docs below.

## Stack (planned)

Cloudflare Workers (TypeScript + Hono) · D1 (metadata) · R2 (gzipped payloads) · Workers Static Assets (landing page assets) · Vitest. Runs on Cloudflare's **free plan** with ~35× headroom at today's scale — see [`ai_context/INFRA.md`](ai_context/INFRA.md).

## Docs

| Doc | Purpose |
|-----|---------|
| [`ai_context/SHARE_CONTEXT.md`](ai_context/SHARE_CONTEXT.md) | Product flows, core decisions, non-negotiables — **read first** |
| [`ai_context/API_SPEC.md`](ai_context/API_SPEC.md) | Endpoints, payload schema v1, errors, D1 schema, cron |
| [`ai_context/INFRA.md`](ai_context/INFRA.md) | Platform comparison, free-tier limits, capacity math, DNS, deploy, monitoring |
| [`ai_context/SECURITY.md`](ai_context/SECURITY.md) | Abuse, rate limits, privacy (kids), moderation |
| [`ai_context/DEEP_LINKS.md`](ai_context/DEEP_LINKS.md) | Landing page, Android App Links, iOS Universal Links, install → import |
| [`ai_context/ROADMAP.md`](ai_context/ROADMAP.md) | Open decisions, phases, checklist |

The Flutter client spec lives in the app repo: [`keewinek/studdly` → `ai_context/TOPIC_SHARING.md`](https://github.com/keewinek/studdly/blob/main/ai_context/TOPIC_SHARING.md).

## Development (once scaffolded)

```bash
npm ci
npx wrangler d1 migrations apply studdly-share --local
npm run dev        # wrangler dev
npm test           # vitest (workers pool, local D1/R2)
```
