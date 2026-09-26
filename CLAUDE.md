# CLAUDE.md — studdly-share

Share-link backend for the Studdly Flutter app (`keewinek/studdly`). One Cloudflare Worker: JSON API (`/api/v1/*`), server-rendered landing page (`/{code}`), and App Links / Universal Links well-known files.

## Read before changing anything

1. `ai_context/SHARE_CONTEXT.md` — flows, decisions D1–D13, non-negotiables
2. `ai_context/API_SPEC.md` — the contract with the app; **breaking it breaks shipped app versions**
3. `ai_context/SECURITY.md` when touching input handling, HTML, rate limits, storage, or logging
4. `ai_context/INFRA.md` before adding a dependency, binding, or anything CPU-heavy (free plan = 10 ms CPU/request)
5. `ai_context/DEEP_LINKS.md` when touching the landing page or `/.well-known/*`

App-side counterpart: `keewinek/studdly` → `ai_context/TOPIC_SHARING.md`. Keep both in sync when the contract changes.

## Rules

- Stay on Cloudflare's free plan limits; no new paid services without the owner's approval.
- API is versioned: never change the meaning of an existing `/api/v1` field or error code; add, don't mutate. Payload `schema: 1` must keep being accepted and served forever.
- Share links are permanent: never change the code format of existing links, the host, or the `/{code}` path.
- Store and log no personal data (no raw IPs, names, device ids, OCR text, owner secrets).
- Escape all user content in HTML; no inline scripts; keep the CSP strict.
- Landing page copy: child-simple, localized (same languages as the app), Studdly visuals (see app `ai_context/DESIGN_STYLE.md`).
- No server-side AI inference — the app is BYOK/client-side for analysis.
- Every behavior change comes with tests (Vitest + workers pool) and a docs update in `ai_context/`.
- Migrations are additive and applied before the code that needs them.
