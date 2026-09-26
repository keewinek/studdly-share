# SECURITY.md — abuse, privacy, moderation

Studdly's audience includes **children** (design bar: an 8-year-old). A public "upload text → get a link on our domain" endpoint will be abused eventually. This doc lists the threats and the v1 answer to each.

## Threat → mitigation

| Threat | v1 mitigation | Later (if needed) |
|--------|---------------|-------------------|
| Free file hosting / spam links on `studdly.app` | Strict schema: only the learning-path shape, text only, size + count caps, unknown fields rejected. HTML renders text only (no links, no Markdown). `noindex` + `robots.txt Disallow` so SEO spam gains nothing. | Firebase **App Check** tokens (Play Integrity / App Attest) required on `POST` — verified in the Worker via Firebase JWKS. |
| Flooding creates (fill R2 / exhaust daily quota) | Rate limit `POST` 10/min per IP-hash (Workers rate-limit binding) + Cloudflare WAF rate-limiting rule on `/api/v1/shares` as a second layer. Daily cap per IP-hash (e.g. 200 creates) tracked in D1. | App Check; per-device quotas. |
| Enumerating codes to scrape shares | 49⁶ ≈ 1.4·10¹⁰ code space; invalid-format codes rejected before storage; read endpoints rate-limited 120/min per IP; no listing endpoint exists. | Longer codes for new shares (old ones keep working). |
| XSS / HTML injection via titles or content | All output HTML-escaped; strict CSP (`default-src 'none'; style-src 'self'; img-src 'self'; script-src 'self'; form-action 'none'; frame-ancestors 'none'`); no inline scripts; OG tag values escaped. | — |
| Duplicate creates on flaky networks | Idempotent create keyed by `sha256(owner_secret)` (see `API_SPEC.md`). | — |
| Stolen/guessed delete rights | Delete needs the 256-bit `owner_secret`, stored only on the sender's device; server keeps only its SHA-256. | — |
| Inappropriate content shown to kids | **Report** button on every landing page (and later in-app). Report → Discord moderation webhook with code + title + link. 3 reports from distinct IP-hashes → auto-hide (`410 removed`) until reviewed. Admin takedown endpoint. | Lightweight keyword pre-screen of titles on create; admin mini-page. |
| Copyrighted textbook content | Only **AI-generated summaries and quizzes** are stored — never OCR text or page images. Takedown via report `copyright` + admin endpoint; contact address in the landing footer. | Formal notice-and-takedown page. |
| Personal data inside content (a kid scans notes with names) | Payload never includes user name / ids; landing page has "Report → contains personal data"; owner can delete (API now, UI later). | "Stop sharing" button in the app. |
| Admin token leak | `ADMIN_TOKEN` only as Worker secret; admin routes also rate-limited; rotate on any suspicion. | Cloudflare Access in front of `/api/admin/*`. |

## Privacy (GDPR / kids)

- **No accounts, no cookies, no analytics scripts** on the landing page.
- IPs are used transiently for rate limiting; anything persisted (report dedupe) is `HMAC-SHA256(ip, IP_HASH_SALT)` truncated to 16 bytes; salt rotated yearly.
- Stored per share: content, title, language, counts, sizes, timestamps, app version, owner hash. Nothing that identifies a person by design.
- Retention: 365 days after last access, or immediately on owner delete / takedown (R2 object deleted, D1 row kept as a tombstone without content so the code isn't reused and the app gets a clean `410`).
- **The app's privacy policy must be updated before launch** to mention that sharing uploads the generated learning path (not scans) to Cloudflare, that anyone with the link can see it, and how to request deletion.
  - ⚠️ Found during research: the app's Info.plist / App Store notes point to `https://studdly.pl/privacy-policy`, but `studdly.pl` does not resolve (NXDOMAIN) and `https://studdly.app/privacy-policy` returns 404. Fix this independently of sharing — stores reject/flag apps with a dead privacy URL.

## Content rules the Worker enforces

- UTF-8 only; NFC normalized; strip C0/C1 control chars except `\n`, `\t`; collapse > 3 consecutive newlines.
- Reject if any string is empty after trimming, or if limits in `API_SPEC.md` are exceeded (`413` for size, `400` otherwise).
- `language` must be one of the app's shipped codes; unknown → `400`.
