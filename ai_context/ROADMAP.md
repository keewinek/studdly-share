# ROADMAP.md — phases, checklist, open decisions

## Decisions (✅ = decided by the owner)

| # | Question | Recommendation |
|---|----------|----------------|
| Q1 | How to attach `share.studdly.app` to Cloudflare? | ✅ **Decided: move `studdly.app` nameservers (OVH) to Cloudflare free**, Netlify records DNS-only, no challenge features on the share host. See `INFRA.md` §5. |
| Q2 | Code length | ✅ **Decided: 5 chars.** Apps and well-known files accept 5–6 so new links can grow later without an app update. |
| Q3 | Re-tap check fails because of no internet / server down | ✅ **Decided: open the share sheet with the remembered link.** Only `404`/`410` triggers re-upload. |
| Q4 | Can a recipient without an AI key use imported topics? | ✅ **Decided: no.** Recipient finishes normal onboarding (incl. key) first; the link is kept as a pending import and the topic is created right after onboarding. |
| Q5 | When the sender deletes the topic locally, delete the share on the server? | **No** in v1 (friends may still be importing). Add explicit "Stop sharing" later. |
| Q6 | Share only fully-ready topics, or also partially analysed ones? | **Only `ready`** (icon hidden until then) — simplest for kids, and payload stays immutable. |
| Q7 | Landing page languages | Same as the app (en, pl, es, de, fr, uk, hi, id); PL + EN required for launch. |

## Phase 0 — prerequisites (owner)

- [ ] Cloudflare account (free), add `studdly.app`, switch nameservers in OVH, verify studdly.app still works on Netlify.
- [ ] Apply the zone security settings from `INFRA.md` §5 (Bot Fight Mode off, no challenge rules) before the first share.
- [ ] Get Android SHA-256 fingerprints (Play App Signing + upload + debug) and Apple Team ID.
- [x] Fix the broken privacy-policy URL in the app → `https://studdly.netlify.app/privacy_policy` (done in the app repo 2026-09-26).
- [ ] Same URL in Play Console + App Store Connect; add a "Sharing" section to the policy.

## Phase 1 — backend MVP (this repo)

- [ ] Scaffold: `wrangler`, TypeScript, Hono, Zod/Valibot, Vitest + `@cloudflare/vitest-pool-workers`, ESLint/Prettier.
- [ ] `migrations/0001_init.sql`, D1 + R2 bindings for staging and prod.
- [ ] `POST /api/v1/shares` (idempotent), `GET .../status`, `GET /api/v1/shares/{code}`, `DELETE` (owner), health.
- [ ] Code generator (rejection sampling) + regex guard.
- [ ] Rate limits (binding + WAF rule).
- [ ] Landing page (PL/EN first), 404/410 page, OG tags, CSP, `robots.txt`, static assets.
- [ ] `assetlinks.json`, `apple-app-site-association`.
- [ ] Reports endpoint + Discord moderation webhook + admin takedown/restore.
- [ ] Daily cron: expiry, pending cleanup, stats.
- [ ] Tests: validation limits, idempotent retry, collision retry, pending recovery, status transitions, report threshold, HTML escaping (XSS payloads in title/content), well-known files content-type.
- [ ] CI + deploy workflows; staging auto-deploy.

## Phase 2 — app integration (repo `keewinek/studdly`, spec `ai_context/TOPIC_SHARING.md`)

- [ ] Share button state machine on TopicDetailPage, `TopicShareService`, local share records.
- [ ] Deep link handling + import flow + pending import through onboarding.
- [ ] Localized strings (all 8 languages), analytics events, UI preview states.
- [ ] Android intent filter + iOS associated domains + custom scheme.
- [ ] Release to internal testing against staging → production.

## Phase 3 — polish / growth

- [ ] Android Play Install Referrer → auto-import after install.
- [ ] "Stop sharing" in the app (uses `DELETE`).
- [ ] In-app "Report" for imported topics.
- [ ] Firebase App Check on `POST` if abuse appears.
- [ ] Per-share OG image (only if CPU budget allows / paid plan).
- [ ] Import counter shown to the sender ("3 friends are learning this") — needs a write per import; budget first.
