# SECURITY.md — abuse, privacy, moderation

Studdly's audience includes **children** (design bar: an 8-year-old). A public "upload text → get a link on our domain" endpoint will be abused eventually. This doc lists the threats and the v1 answer to each.

## Threat → mitigation

| Threat | v1 mitigation | Later (if needed) |
|--------|---------------|-------------------|
| Free file hosting / spam links on `studdly.app` | Strict schema: only the learning-path shape, text only, size + count caps, unknown fields rejected. HTML renders text only (no links, no Markdown). `noindex` + `robots.txt Disallow` so SEO spam gains nothing. | Firebase **App Check** tokens (Play Integrity / App Attest) required on `POST` — verified in the Worker via Firebase JWKS. |
| Flooding creates (fill payload storage / exhaust daily quota) | Rate limit `POST` 10/min per IP-hash (Workers rate-limit binding) + Cloudflare WAF rate-limiting rule on `/api/v1/shares` as a second layer. Daily cap per IP-hash (e.g. 200 creates) tracked in D1. | App Check; per-device quotas. |
| Enumerating codes to scrape shares | 49⁵ ≈ 2.8·10⁸ code space (5-char codes, owner's decision). Invalid-format codes rejected before storage; read endpoints rate-limited 120/min per IP-hash; **misses (404) are rate-limited separately: 20/min per IP-hash**, after that every code lookup from that IP gets `429` for the rest of the window, so hits and misses look the same. At 50k live shares that caps a single IP at a handful of lucky hits per day — acceptable for study material with no personal data (D3). No listing endpoint exists. | Switch new links to 6 chars (apps already accept 5–6). |
| XSS / HTML injection via titles or content | All output HTML-escaped; strict CSP (`default-src 'none'; style-src 'self'; img-src 'self'; script-src 'self'; form-action 'none'; frame-ancestors 'none'`); no inline scripts; OG tag values escaped. | — |
| Duplicate creates on flaky networks | Idempotent create keyed by `sha256(owner_secret)` (see `API_SPEC.md`). | — |
| Stolen/guessed delete rights | Delete needs the 256-bit `owner_secret`, stored only on the sender's device; server keeps only its SHA-256. | — |
| Inappropriate content shown to kids | **Report** button on every landing page (and later in-app). Report → Discord moderation webhook with **code, reason and a link to `/admin/shares/{code}` only** — never the title and never the reporter's free text, because both can carry personal data and Discord is a third party with no processing agreement. The content itself stays in D1 and is read in the dashboard. 3 reports from distinct IP-hashes → auto-hide (`410 removed`) until reviewed. Admin takedown endpoint. | Lightweight keyword pre-screen of titles on create; admin mini-page. |
| Copyrighted textbook content | Only **AI-generated summaries and quizzes** are stored — never OCR text or page images. Takedown via report `copyright` + admin endpoint. ⚠️ **The landing footer carries only a privacy-policy link — there is no contact address anywhere in `src/` yet** (DSA art. 12 and Apple Guideline 1.2 both require one; task B3 in the app repo's `ai_context/legal/`). | Formal notice-and-takedown page. |
| Personal data inside content (a kid scans notes with names) | Payload carries no ids and no OCR/page text. The single exception is the optional `sharer_name` (≤ 32 chars, display name only, never logged, deleted with the share) — see API_SPEC. Landing page has "Report → contains personal data"; owner can delete (API now, UI later). | "Stop sharing" button in the app. |
| `sharer_name` abused as a message channel (slurs, links, a phone number) | Capped at 32 chars, single-line, control chars stripped, HTML-escaped on the landing page; it is covered by the same report → auto-hide flow as the rest of the payload. | Word-list check at create time if it is ever abused in practice. |
| Admin token leak | `ADMIN_TOKEN` only as Worker secret; admin routes also rate-limited; rotate on any suspicion. | Cloudflare Access in front of `/api/admin/*`. |

**Never use Cloudflare challenges** (Bot Fight Mode, Under Attack Mode, Managed/JS/Interactive Challenge rules) on `share.studdly.app`: the app and link-preview bots cannot pass them. Use Worker rate limits (`429`) and Block rules only. Settings list: `INFRA.md` §5.

## Limits (all in `src/lib/limits.ts` + rate-limit bindings in `wrangler.jsonc`)

| Limit | Value | Response |
|-------|-------|----------|
| Creates per IP hash per minute | 10 | `429 rate_limited` |
| Creates per IP hash per UTC day | 100 (school NATs share an IP) | `429 daily_limit_reached`, `Retry-After: 3600` |
| Creates by everyone per UTC day | 5 000 | `503 capacity_reached` + Discord alert |
| Payload shard size | warn at 350 MB, refuse at 480 MB | `503 storage_full` + Discord alert |
| Request body | 1 MiB, read as a stream and aborted past the limit | `413 payload_too_large` |
| Code lookups per IP hash per minute | 120 (+ 20 unknown codes → 1 min block) | `429` / friendly HTML page |
| Reports per IP hash per minute | 5; one per code per day | always `202` |
| Admin logins per IP hash | 5/min, 20 failures/day | `429` |
| Link lifetime | 30 days from creation | `410 expired` |

Retries of an already-created share (same owner secret) don't count against daily quotas.

## Error handling

- Every API error is JSON `{ error, message }` with a stable code; `503` always carries `Retry-After`. Unhandled exceptions → `503 storage_unavailable` for `/api/*`, friendly localized HTML (`503`) for pages — never a stack trace.
- Server errors are logged to D1 `events` (shown on the dashboard) and counted in metrics; storage failures during create keep the pending row so a retry with the same secret finishes it.
- Metrics/alerts are best effort and can never fail a request.

## Admin dashboard security

- Password never leaves the browser in clear text: the page sends `sha256(password)`; the server stores `sha256(sha256(password))` in D1 `settings` (not in this public repo) and compares in constant time.
- Session: HMAC-signed cookie (`HttpOnly; Secure; SameSite=Strict`, 12 h), key rotated on password change. Cookie writes require a same-origin `Origin` header.
- Brute force: 5 attempts/min and 20 failures/day per IP hash. Use a long random password.
- Pages: `noindex`, `no-store`, `X-Frame-Options: DENY`, strict CSP; all user content escaped. `/admin*` is excluded from iOS Universal Links; the Android app opens non-topic `share.studdly.app` URLs in a browser tab.

## Privacy (GDPR / kids)

- **No accounts, no cookies, no analytics scripts** on the landing page.
- IPs are used transiently for rate limiting; anything persisted (report dedupe) is `HMAC-SHA256(ip, IP_HASH_SALT)` truncated to 16 bytes; salt rotated yearly.
- Stored per share: content, title, language, counts, sizes, timestamps, app version, owner hash. Nothing that identifies a person by design.
- Retention: **30 days after creation** (then `410 expired`, payload deleted), or immediately on owner delete / takedown (payload deleted, metadata row kept as a tombstone without content so the code isn't reused and the app gets a clean `410`). Reports are kept 365 days, error events 14 days, daily counters 120 days.
- **The app's privacy policy must be updated before launch** to mention that sharing uploads the generated learning path (not scans) to Cloudflare, that anyone with the link can see it, and how to request deletion.
  - Current policy URL: `https://studdly.netlify.app/privacy_policy` (the old `studdly.pl/privacy-policy` URL was dead; the app manifest/plist were updated on 2026-09-26 — also update it in Play Console and App Store Connect).

## Content rules the Worker enforces

- UTF-8 only; NFC normalized; strip C0/C1 control chars except `\n`, `\t`; collapse > 3 consecutive newlines.
- Reject if any string is empty after trimming, or if limits in `API_SPEC.md` are exceeded (`413` for size, `400` otherwise).
- `language` must be one of the app's shipped codes; unknown → `400`.
