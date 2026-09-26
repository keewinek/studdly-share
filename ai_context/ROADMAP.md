# ROADMAP.md — phases, checklist, open decisions

## Open decisions (need the owner's call)

| # | Question | Recommendation |
|---|----------|----------------|
| Q1 | Where does DNS for `studdly.app` live? (today: Netlify DNS) | Move the zone to Cloudflare free, keep Netlify records DNS-only. See `INFRA.md` §5. **Blocks production launch.** |
| Q2 | Code length: 5 chars (brief example `e4Rf8`) or 6? | **6** (no-vowel alphabet, 49⁶ ≈ 13.8B). 5 would be 282M — fine today, weaker vs. enumeration later. Decide before the first real share; changing length later only affects new links. |
| Q3 | Re-tap check fails because of **no internet / server down** — what now? | Open the share sheet with the **cached link anyway** (it almost certainly still works; the friend opens it later). Only a definite `404`/`410` triggers re-upload. Alternative: show "No internet" toast and do nothing. |
| Q4 | Can a recipient **without an AI key** use imported topics? Today onboarding forces a key. | Big growth lever: let onboarding finish without a key when a pending import exists, show the imported topic, ask for a key only when they create their own topic. Needs an `APP_CONTEXT.md` change in the app — product call. |
| Q5 | When the sender deletes the topic locally, delete the share on the server? | **No** in v1 (friends may still be importing). Add explicit "Stop sharing" later. |
| Q6 | Share only fully-ready topics, or also partially analysed ones? | **Only `ready`** (icon hidden until then) — simplest for kids, and payload stays immutable. |
| Q7 | Landing page languages | Same as the app (en, pl, es, de, fr, uk, hi, id); PL + EN required for launch. |

## Phase 0 — prerequisites (owner)

- [ ] Cloudflare account (free) + decide Q1, migrate DNS, verify studdly.app still works on Netlify.
- [ ] Get Android SHA-256 fingerprints (Play App Signing + upload + debug) and Apple Team ID.
- [ ] Fix the broken privacy-policy URL (see `SECURITY.md`) and add a "Sharing" section.

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
