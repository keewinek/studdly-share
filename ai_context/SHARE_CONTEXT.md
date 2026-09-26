# SHARE_CONTEXT.md — studdly-share

**Status:** design approved for implementation (nothing built yet) · **Updated:** 2026-09-26

Single source of truth for **what** studdly-share is, **why** it is built this way, and the decisions behind it. Companion docs:

| Doc | What it covers |
|-----|----------------|
| [`API_SPEC.md`](API_SPEC.md) | HTTP endpoints, payload schema, error codes, D1 schema |
| [`INFRA.md`](INFRA.md) | Platform research, free-tier limits, capacity math, DNS, deploy, scale path |
| [`SECURITY.md`](SECURITY.md) | Abuse, rate limits, privacy (kids), moderation, takedown |
| [`DEEP_LINKS.md`](DEEP_LINKS.md) | Landing page, Android App Links, iOS Universal Links, install → import |
| [`ROADMAP.md`](ROADMAP.md) | Phases, checklist, open decisions |

Client-side (Flutter) spec lives in the app repo: `keewinek/studdly` → `ai_context/TOPIC_SHARING.md`.

---

## What it is

`share.studdly.app` is a tiny, free-to-run service that lets a Studdly user turn a **ready learning path** (topic → sub-topics → quizzes) into a short public link like `https://share.studdly.app/k4Rf8`, and lets anyone who opens that link **import the same learning path** into their own Studdly app — without scanning anything and without spending AI tokens.

It is one Cloudflare Worker that serves:

1. **JSON API** (`/api/v1/...`) — create a share, check it is still alive, fetch it for import, report it.
2. **Landing page** (`/{code}`) — server-rendered preview (title, lesson list, "Open in Studdly", store badges) with Open Graph tags so the link looks good in Messenger / WhatsApp / Discord / iMessage.
3. **Well-known files** — `assetlinks.json` (Android App Links) and `apple-app-site-association` (iOS Universal Links), so the link opens the app directly when installed.

## Why it exists (product)

- Studdly has ~30k downloads. Classmates learn from the **same textbook pages**. Today every one of them has to scan and wait for AI analysis with their own key.
- Sharing turns one analysis into many learners → free growth loop (every shared link is an invite to install).
- **Decided:** the recipient must finish normal onboarding (including their own AI key) before the shared topic is created in their app. The link is remembered through onboarding and the import happens right after it. No key-less mode.

## User flow (sender) — from the product brief

1. User creates a topic by scanning a textbook.
2. Waits for AI analysis → learning path is ready (`topic.ready == true`).
3. Opens the topic → **TopicDetailPage** → share icon in the top-right corner (Font Awesome).
4. Taps it → icon becomes a **loading spinner** until the upload finishes.
5. Server stores the path → the **native share sheet** opens with `https://share.studdly.app/<code>`.
6. Icon changes to **share icon + small green check badge** (Font Awesome `solidCircleCheck`).

**Tapping again later:** the app asks `share.studdly.app` whether that share is still alive.
- Alive → open the native share sheet with the same link (no upload).
- Gone (404/410: expired, deleted, moderated) → upload again → new link → share sheet.
- **No internet / server unreachable / 5xx / 429** → open the share sheet with the **remembered link** (decided — it almost certainly still works, the friend opens it later).
- Local content changed since the last upload (fingerprint mismatch) → upload again.

## User flow (recipient)

- **App installed, onboarding done** → the link opens Studdly directly (App Links / Universal Links) → the app downloads the payload → shows a friendly "Add this topic?" confirmation → topic appears on Home as **ready**, progress starts at 0.
- **App installed, onboarding not done yet** (fresh install, or no AI key) → the code is saved as a *pending import* → normal onboarding (name + provider + key) → right after onboarding the "Add this topic?" confirmation appears.
- **App not installed** → landing page in the browser: title, list of lessons, big "Get Studdly" button (Play / App Store). After install, the user taps the link again (iOS) or the app picks up the code from the Play Install Referrer (Android, phase 2).
- **Opened inside an in-app browser** (Instagram/TikTok/Messenger often block universal links) → landing page shows "Open in Studdly" button (Android `intent://` URL with store fallback; iOS custom scheme fallback). See `DEEP_LINKS.md`.

---

## Core decisions (and why)

| # | Decision | Why |
|---|----------|-----|
| D1 | **Cloudflare Workers + D1 + R2**, TypeScript, Hono router | Only mainstream option that is *free with no card, no cold starts, no inactivity pausing, no non-commercial clause*, with a global edge and hard (not billed) limits. Full comparison in `INFRA.md`. |
| D2 | **D1 = metadata, R2 = payload** (gzipped JSON) | D1 free is 500 MB per database — ~25k topics if we stored bodies there. R2 free is 10 GB (~500k topics) with zero egress. D1 gives a primary key / unique constraints / SQL for moderation. |
| D3 | **Only AI-generated learning content is uploaded** — never OCR page text, never the user's name, device id, or progress | Smaller payload, far less copyright exposure (no verbatim textbook scans), no personal data from a kids' app. |
| D4 | **Share codes are random, 5 chars (owner's decision), 49-symbol alphabet with no vowels and no look-alikes** (`23456789BCDFGHJKLMNPQRSTVWXYZbcdfghjkmnpqrstvwxyz`). Clients and well-known files **accept 5–6 chars** from day one. | 49⁵ ≈ 282 million codes — plenty for years (collision on insert is retried). Guessing is throttled by the miss-rate limit (`SECURITY.md`). No vowels ⇒ random codes can't spell rude words (kids' audience). No `0/O/1/l/I` ⇒ readable aloud. Accepting 6 chars in the app now means the server can switch new links to 6 chars later without an app update. |
| D5 | **Idempotent create via a client-generated `owner_secret`** (32 random bytes, stored in the app *before* the request). The server stores only `sha256(owner_secret)` (unique). | Mobile networks time out after the server already committed. Retrying with the same secret returns the same code instead of creating duplicates. The same secret later authorizes `DELETE` ("stop sharing") without any accounts. |
| D6 | **No accounts, no auth for reading.** Anyone with the link can read. | Matches "send a link to a classmate". Content is study material, not private data (see D3). |
| D7 | **Shares don't expire while people use them.** A share not opened for **365 days** is deleted by a daily cron. | Storage stays bounded, and the app's "check → re-upload if gone" flow makes expiry invisible to senders. |
| D8 | **Payload is immutable per code.** Changing content = new code. | Lets clients/CDN cache payloads, keeps imports reproducible, simplifies moderation (a reviewed code can't be swapped). |
| D9 | **Landing page is server-rendered by the Worker** (no SPA) with per-share Open Graph tags, `noindex`, strict CSP, text-only rendering | Rich previews in chat apps are the main acquisition surface. `noindex` stops the domain from becoming an SEO spam host. |
| D10 | **`/api/v1` versioning + `schema` field in payload** | Old app versions keep working when the payload evolves; the app refuses to import a schema it doesn't understand and asks the user to update. |
| D11 | **Free plan hard limits are a feature** — there is no way to get a surprise bill. Break-glass = Workers Paid ($5/month) which raises every limit by 100×. | "Darmowe i niezawodne": the capacity math in `INFRA.md` shows ~35× headroom at today's scale. |
| D12 | **Re-tap offline → remembered link** (owner's decision). Only a definite `404`/`410` triggers a re-upload. | The link almost never dies (D7), and sharing must not fail just because the phone is offline for a moment. |
| D13 | **No key-less mode for recipients** (owner's decision). Import happens only after onboarding is complete. | Keeps the app's onboarding rules (`APP_CONTEXT.md`: one provider, one key) unchanged. |

## Non-negotiables

- ✅ Never store or log raw `owner_secret`, IPs in plain text, user names, device ids, OCR text, or API keys.
- ✅ Validate every payload strictly (schema, sizes, counts, string lengths). Reject unknown fields.
- ✅ Render user content as **text only** (escape everything; no Markdown→HTML, no links).
- ✅ Every non-2xx API response has a stable machine-readable `error` code (see `API_SPEC.md`) — the app maps codes to localized copy, never shows raw bodies.
- ✅ Landing page copy must meet the Studdly **8-year-old simplicity bar** (see the app's `ai_context/APP_CONTEXT.md`), be localized (at least PL + EN, same language list as the app), and match Studdly visuals (black, Figtree, ocean `#4D67AA`).
- ✅ Keep the Worker CPU-cheap (free plan = 10 ms CPU/request): no heavy libraries, no server-side Markdown, no image generation.
- ❌ No AI inference on the server. Studdly stays BYOK / client-side for analysis — this service only stores already-generated paths.
- ❌ No user accounts, no tracking cookies, no third-party scripts on the landing page.
- ❌ Do not use this service as a general file host: no binary uploads, no images in v1.

## Glossary

- **Share** — one immutable uploaded learning path, addressed by a **code**.
- **Code** — 5-char public id in the URL (clients accept 5–6).
- **owner_secret** — random secret known only to the sender's device; proves ownership for idempotent retries and deletion.
- **Fingerprint** — client-side SHA-256 of the exact payload the app uploaded; used only by the app to detect local changes.
- **Import** — recipient's app creating a new local ready topic from a share.
