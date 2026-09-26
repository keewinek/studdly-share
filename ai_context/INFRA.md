# INFRA.md — platform choice, free-tier limits, capacity, DNS, deploy

Research date: **2026-09-26**. Re-verify limits on the linked pages before relying on a number — vendors change free tiers.

---

## 1. Requirements

- **Free** at today's scale (~30k installs) with real headroom, and no surprise bills.
- **Reliable:** no cold starts, no "paused after inactivity", no vendor ToS risk, strong read-after-write (a friend opens the link seconds after it was created).
- Custom domain `share.studdly.app`, HTTPS, can serve `/.well-known/*` for App Links / Universal Links.
- Server-rendered HTML for link previews + JSON API from the same origin.
- Solo-developer friendly: git-based deploy, local dev, tests, migrations.

## 2. Options considered

| Option | Free tier (relevant parts) | Deal-breakers | Verdict |
|--------|---------------------------|---------------|---------|
| **Cloudflare Workers + D1** | Workers 100k req/day, 10 ms CPU/req; D1 5M rows read/day, 100k rows written/day, 500 MB/db, 10 dbs, 5 GB/account — **hard limits, no card** | Needs the DNS zone on Cloudflare for a custom domain (see §5). 10 ms CPU budget → keep code lean. | ✅ **Chosen** |
| Firebase (already in the app: Analytics) — Firestore + Hosting | Firestore 1 GiB, 50k reads/day, 20k writes/day, 1 MiB/doc | Cloud Functions (needed for OG tags, validation, rate limits, cron) require the **Blaze** plan (card on file, pay-as-you-go → possible surprise bill). Client-direct writes with Security Rules can't rate-limit well. | ❌ Plan B only |
| Supabase | Postgres 500 MB, generous API | **Free projects pause after 7 days of inactivity** → links die. | ❌ |
| Vercel Hobby (+ Neon) | Generous functions | Hobby is **non-commercial only**; Studdly is a published app → ToS risk / suspension. Neon adds cold starts. | ❌ |
| Netlify (studdly.app + live banner live here today) | Credit-based free plan (300 credits/month) | When credits run out **all projects on the account are paused** until the next cycle — a viral share spike could take down studdly.app *and* the app's live banner. | ❌ (and keep share traffic **off** the Netlify account) |
| Deno Deploy + Deno KV | Free tier | Product churn (Deploy Classic → new Deploy), KV availability/limits uncertain; the app previously removed a Deno backend. | ❌ |
| Self-hosted VPS | Oracle Always Free etc. | Ops burden, single point of failure, account reclaim risk. | ❌ |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Netlify credit billing FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/).

**Why not R2 for payloads (original plan):** enabling R2 requires a **payment method on file**, even for the free tier, and usage above the free tier is billed instead of refused. D1 needs no card and hard-stops at its limits, so payloads live in D1 "payload shards" (`PAYLOADS_1`, `PAYLOADS_2`, …). R2 stays an option if the owner ever adds a card.

**Why not Workers KV as the store:** free KV allows only ~1k writes/day and is *eventually consistent* (up to ~60 s across locations) — a freshly created link could 404 for the recipient, and the "is it still shared?" check could lie. D1 (single primary) is read-after-write consistent.

## 3. Capacity math (why free is enough)

Assumptions (deliberately pessimistic for today): 30k installs → **3k DAU**; **5 %** of DAU share per day → **150 shares/day**; each share is opened **5×**; each open = 1 landing HTML (or app fetch) + ~1 link-preview crawler hit; each sender re-taps the icon twice later.

| Resource | Daily usage | Free limit | Used |
|----------|-------------|-----------|------|
| Worker requests | 150 create + 300 status + 750 opens × ~3 ≈ **2.7k** | 100k/day | ~3 % |
| D1 rows written | 150 × 2 (pending→active) + ≤ 750 access bumps ≈ **1k** | 100k/day | ~1 % |
| D1 rows read | ≈ **3k** | 5M/day | < 0.1 % |
| Payload storage (D1 shards) | 150 × ~20 KB gz ≈ 3 MB/day ≈ **1.1 GB/year** | 500 MB per shard, up to 9 shards (5 GB/account) | shard 1 fills in ~5 months at this pace; with the 365-day expiry steady state is ~1.1 GB ≈ 3 shards |
| Metadata storage (D1 `DB`) | ~0.5 KB/row → ~27 MB/year | 500 MB | ~5 % |

**Adding a payload shard** (the daily Discord stats warn at 350 MB): add a `PAYLOADS_<n+1>` entry to `wrangler.jsonc` (`database_name: studdly-share-payloads-<n+1>`, `migrations_dir: migrations/payloads`), add it to `Env` in `src/env.ts`, add its `migrations apply` line to `.github/workflows/deploy.yml`, set `PAYLOAD_WRITE_SHARD` to `n+1`, push. New shares go to the new shard; old ones keep reading from theirs (`shares.payload_shard`).

**First wall:** Workers 100k requests/day ≈ **35× today's estimate**. A viral day (20×) still fits.

**Failure mode if exceeded:** Cloudflare returns error 1027 until 00:00 UTC; D1 returns errors after its daily quota. No bill. The app treats this like "server unavailable" (see client spec) — existing links on the recipient side fail until reset, which is the only real risk.

**Break-glass:** Workers Paid **$5/month** → 10M requests/month included, D1 25B reads / 50M writes per month, 30 s CPU. Upgrade takes minutes, no code change. Trigger: cron stats show > 50 % of any daily limit on 3 days in a week.

**Cheaper scale path before paying (only if ever needed):** cache `GET /api/v1/shares/{code}` responses in the Cache API (payloads are immutable), or — with a card on file — move payloads to R2 behind a CDN-cached public bucket.

## 4. CPU budget (10 ms on free)

Heaviest request is `POST` (parse ≤ 1 MiB JSON, validate, gzip, SHA-256). Rules:
- Validate with the small hand-written validator (`src/lib/payload.ts`); no heavy schema libraries, no per-field regex storms.
- `crypto.subtle.digest` and `CompressionStream` are native.
- Measure p99 CPU in Workers Observability after launch; if `POST` for "exact" topics trends > 8 ms, lower the size caps or move gzip to the client (`Content-Encoding: gzip` upload) before paying.

## 5. DNS / custom domain — ✅ decided: Option A (move DNS to Cloudflare)

Current state (checked 2026-09-26): `studdly.app` nameservers are **Netlify DNS** (`dns1..4.p09.nsone.net`). `share.studdly.app` does not exist yet.
Registrar: **OVH** (RDAP). Registration renews on 2026-10-31 — auto-renew is on (confirmed by the owner). If the domain ever lapses, every share link dies.

### Why a plain DNS record is not enough

The obvious idea — in Netlify DNS add `share CNAME studdly-share.<acct>.workers.dev` — **does not work**. Cloudflare's edge routes requests by hostname and only serves Workers for hostnames that belong to a zone on a Cloudflare account; a foreign hostname CNAME'd to `workers.dev` gets a Cloudflare error, not the Worker, and no certificate for `share.studdly.app` is issued. The Cloudflare features that attach a hostname whose parent zone lives elsewhere are:

| Cloudflare feature | What it allows | Plan |
|---|---|---|
| Full setup (move nameservers) | Worker Custom Domain on any hostname of the zone | **Free** |
| Partial / CNAME setup | Keep NS elsewhere, proxy selected records | Business / Enterprise only |
| Subdomain setup (delegate `share.` with NS records) | Only `share.studdly.app` becomes a Cloudflare zone | Enterprise only |
| **Cloudflare for SaaS** (custom hostnames) | Any external hostname `CNAME`s to a zone you own on Cloudflare; a Worker on that zone serves it | **Free plan: 100 hostnames included** |

Sources: [subdomain setup](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/), [partial setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/), [Cloudflare for SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/), [Worker as fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/).

### Option A (✅ chosen) — move `studdly.app` DNS to Cloudflare (free)

1. Add `studdly.app` to Cloudflare (Free). It imports existing records; compare with Netlify DNS and fix anything missing (apex → Netlify load balancer, `www` → `<site>.netlify.app`, MX/TXT if any).
2. Set the Netlify records to **DNS only (grey cloud)** so Netlify keeps serving the site and renewing its certificate.
3. Change nameservers at the **registrar (OVH panel → Domains → studdly.app → DNS servers)** to the two Cloudflare NS (and remove the domain from Netlify DNS afterwards — the site itself stays on Netlify as an external-DNS domain).
4. Add `share.studdly.app` as the Worker's Custom Domain (Cloudflare creates the record + certificate).

Pros: simplest long-term setup, one extra record per future service, free WAF rate-limiting rule and bot protection. Cons: a one-time migration (~30 min + propagation). Lower TTLs a day earlier; `.app` is HSTS-preloaded, so check HTTPS on every hostname right after.

### Option B — keep Netlify DNS, add only records (Cloudflare for SaaS)

Possible, but needs a **second domain** whose DNS is on Cloudflare (any cheap domain, ~$10/year, e.g. `studdly-edge.com`):

1. Put the helper domain on Cloudflare (Free), create a proxied record `edge.studdly-edge.com` as the **fallback origin**, and a Worker route `*/*` on that zone → the share Worker.
2. Enable Cloudflare for SaaS on that zone (100 custom hostnames free; Cloudflare may ask for a payment method on file to enable it — verify in the dashboard) and add custom hostname `share.studdly.app`.
3. In **Netlify DNS** add only records: `share CNAME edge.studdly-edge.com` plus the TXT record(s) Cloudflare shows for hostname/certificate validation.

Pros: `studdly.app` DNS stays untouched. Cons: extra domain to pay for and renew forever (if it lapses, **every share link dies**), more moving parts, WAF rules apply per SaaS zone.

### Not recommended

- `studdly-share.<acct>.workers.dev` as the public link host — fine for **staging** only (ugly, sometimes filtered by school networks, can't move later without breaking links).
- Proxying through Netlify (`_redirects` 200 rewrite to workers.dev) — every share request would consume Netlify credits, and running out pauses **all** Netlify projects (studdly.app + live banner).

⚠️ Links are forever: pick the final host **before** the first production share.

### Cloudflare zone security settings — no "Verify you are human" pages

The challenge page ("Just a moment… / Verify you are human") only appears on **proxied** (orange-cloud) traffic, and only when a security feature decides to challenge. Two consequences:

- **`studdly.app` / `www` (Netlify, DNS-only / grey cloud):** Cloudflare only answers DNS; traffic goes straight to Netlify. **No challenge is ever possible** there.
- **`share.studdly.app` (Worker, always proxied):** a challenge here would be a **bug**, not just an annoyance — the Flutter app's HTTP client can't solve it (API calls fail) and link-preview bots (Messenger, WhatsApp, iMessage, Discord) would get the challenge instead of the Open Graph tags. Required settings for the zone:

| Setting (dashboard) | Value | Why |
|---|---|---|
| Security → Bots → **Bot Fight Mode** | **Off** | On the free plan it can't be scoped or skipped by rules; it challenges non-browser clients such as the app and preview crawlers. |
| Security → Bots → **Block AI bots** / AI Labyrinth | Off | Same reason; nothing to protect from crawlers (pages are `noindex`). |
| **Under Attack Mode** | Off (never as a permanent setting) | Challenges every visitor. |
| Security level / challenge passage | Lowest available ("Essentially off") for `share.studdly.app` via a Configuration Rule | Avoid challenging school NATs with shared IPs. |
| **Browser Integrity Check** | Off for `share.studdly.app` (Configuration Rule) | Can block non-browser user agents. |
| WAF custom rules | Only **Block** or **rate limit (429)** actions — never *Managed Challenge*, *JS Challenge* or *Interactive Challenge* | The app maps `429` to friendly copy; it cannot handle a challenge page. |

Abuse protection comes from the Worker's own rate limits + validation (`SECURITY.md`), not from challenges. After the migration, verify with `curl -A "Dart/3.5 (dart:io)" https://share.studdly.app/api/v1/health` and `curl -A "facebookexternalhit/1.1" https://share.studdly.app/<code>` — both must return the real response, not HTML with a challenge.

## 6. Environments & deploy (implemented)

One environment: **production** (`share.studdly.app` only; `workers_dev` and preview URLs are off — the account has no workers.dev subdomain). Local development uses `wrangler dev` with local D1; there is no staging yet (add one only when the app needs it).

Repo layout:
```
src/index.ts            # Hono app wiring + scheduled() cron
src/env.ts              # bindings / vars / secrets
src/cron.ts             # daily expiry, pending cleanup, Discord stats
src/i18n.ts             # landing page copy (en, pl; others fall back to en)
src/routes/api.ts       # /api/v1/*
src/routes/admin.ts     # /api/admin/* (only when ADMIN_TOKEN is set)
src/routes/landing.ts   # /{code} HTML, 404/410/429 pages
src/routes/wellKnown.ts # assetlinks.json, apple-app-site-association
src/lib/code.ts         # share-code generator + validator
src/lib/payload.ts      # payload v1 validator + limits
src/lib/store.ts        # all D1 access (the only place touching storage)
src/lib/lookup.ts       # shared code lookup + rate limits + status mapping
src/lib/rateLimit.ts, crypto.ts, http.ts, discord.ts
migrations/meta/        # DB (metadata)
migrations/payloads/    # PAYLOADS_<n> (same schema for every shard)
public/                 # css, logo, sloth, Figtree, report.js, robots.txt (Workers Static Assets)
test/                   # Vitest + @cloudflare/vitest-pool-workers (local D1, real runtime)
scripts/ensure-d1.mjs   # CI: create D1 dbs if missing (weur) and fill database_id
scripts/sync-secrets.mjs# CI: upload optional secrets, create IP_HASH_SALT once
scripts/ensure-workers-subdomain.mjs # CI: register the account workers.dev subdomain if missing
.github/workflows/deploy.yml   # test on every push/PR; deploy main when Cloudflare secrets exist
.github/workflows/moderate.yml # manual takedown / restore of a share code
```

**Deploy pipeline (`deploy.yml`, on every push to `main`):** `npm ci` → typecheck → tests → *(only if the `CLOUDFLARE_API_TOKEN` repo secret exists)* ensure D1 databases → ensure an account workers.dev subdomain (Cloudflare requires one for cron triggers, error 10063, even though this Worker has `workers_dev` off) → `d1 migrations apply --remote` (meta + payload shards) → `wrangler deploy --var GIT_SHA:<sha>` (creates the `share.studdly.app` custom domain + certificate) → sync secrets → smoke test `/api/v1/health`.

**Cloudflare account:** `keewinek@gmail.com` (`account_id` `3a683c190c3642e01dc1113896acd5f4`, set in `wrangler.jsonc`). D1 databases `studdly-share-meta` (`33712324-…`) and `studdly-share-payloads-1` (`c8c99399-…`) were created in WEUR on 2026-09-26; migrations are applied by CI.

**GitHub repo secrets:**

| Secret | Required | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | yes | "Edit Cloudflare Workers" template + Account D1 Edit + Zone DNS Edit (zone `studdly.app`) |
| `DISCORD_MODERATION_WEBHOOK` | optional | report notifications |
| `DISCORD_STATS_WEBHOOK` | optional | daily stats + shard-size warnings |
| `ADMIN_TOKEN` | optional | enables `/api/admin/*` (the `moderate.yml` workflow works without it) |

`IP_HASH_SALT` is generated once by `sync-secrets.mjs` and never leaves Cloudflare.

**Android App Links:** `wrangler.jsonc` → `ANDROID_CERT_SHA256` holds the Play App Signing and upload key SHA-256 (set 2026-09-26). Debug builds use a different key, so links open the browser there.

**Moderation without code:** GitHub → Actions → *Moderate a share* → Run workflow → code + `remove`/`restore`.

Rollback: `wrangler rollback` (instant). Data safety: D1 Time Travel (7 days on free) for point-in-time restore.

**Compatibility date:** keep `compatibility_date` ≤ the newest date supported by the `workerd` bundled with the pinned `@cloudflare/vitest-pool-workers`, or local tests fail to start.

## 7. Monitoring

- Workers Observability (logs + metrics) — log only: route, status, error code, CPU ms, payload size. Never log bodies, secrets, or raw IPs.
- External uptime check on `/api/v1/health` every 5 min (e.g. UptimeRobot free) → Discord.
- Daily cron stats → Discord (see `API_SPEC.md`).
- App side: Firebase Analytics events `topic_share_*` / `topic_import_*` (see client spec) give end-to-end success rate.
