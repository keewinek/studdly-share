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
| **Cloudflare Workers + D1 + R2** | Workers 100k req/day, 10 ms CPU/req; D1 5M rows read/day, 100k rows written/day, 500 MB/db, 5 GB/account; R2 10 GB, 1M class A + 10M class B ops/month, **free egress** | Needs the DNS zone on Cloudflare for a custom domain (see §5). 10 ms CPU budget → keep code lean. | ✅ **Chosen** |
| Firebase (already in the app: Analytics) — Firestore + Hosting | Firestore 1 GiB, 50k reads/day, 20k writes/day, 1 MiB/doc | Cloud Functions (needed for OG tags, validation, rate limits, cron) require the **Blaze** plan (card on file, pay-as-you-go → possible surprise bill). Client-direct writes with Security Rules can't rate-limit well. | ❌ Plan B only |
| Supabase | Postgres 500 MB, generous API | **Free projects pause after 7 days of inactivity** → links die. | ❌ |
| Vercel Hobby (+ Neon) | Generous functions | Hobby is **non-commercial only**; Studdly is a published app → ToS risk / suspension. Neon adds cold starts. | ❌ |
| Netlify (studdly.app + live banner live here today) | Credit-based free plan (300 credits/month) | When credits run out **all projects on the account are paused** until the next cycle — a viral share spike could take down studdly.app *and* the app's live banner. | ❌ (and keep share traffic **off** the Netlify account) |
| Deno Deploy + Deno KV | Free tier | Product churn (Deploy Classic → new Deploy), KV availability/limits uncertain; the app previously removed a Deno backend. | ❌ |
| Self-hosted VPS | Oracle Always Free etc. | Ops burden, single point of failure, account reclaim risk. | ❌ |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Netlify credit billing FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/).

**Why not Workers KV as the store:** free KV allows only ~1k writes/day and is *eventually consistent* (up to ~60 s across locations) — a freshly created link could 404 for the recipient, and the "is it still shared?" check could lie. D1 (single primary) and R2 are read-after-write consistent.

## 3. Capacity math (why free is enough)

Assumptions (deliberately pessimistic for today): 30k installs → **3k DAU**; **5 %** of DAU share per day → **150 shares/day**; each share is opened **5×**; each open = 1 landing HTML (or app fetch) + ~1 link-preview crawler hit; each sender re-taps the icon twice later.

| Resource | Daily usage | Free limit | Used |
|----------|-------------|-----------|------|
| Worker requests | 150 create + 300 status + 750 opens × ~3 ≈ **2.7k** | 100k/day | ~3 % |
| D1 rows written | 150 × 2 (pending→active) + ≤ 750 access bumps ≈ **1k** | 100k/day | ~1 % |
| D1 rows read | ≈ **3k** | 5M/day | < 0.1 % |
| R2 class A (writes) | 150/day ≈ 4.5k/month | 1M/month | < 1 % |
| R2 class B (reads) | 750/day ≈ 23k/month | 10M/month | < 1 % |
| R2 storage | 150 × ~20 KB gz ≈ 3 MB/day ≈ **1.1 GB/year** | 10 GB | ~9 years of growth before the 365-day expiry even matters |
| D1 storage | ~0.5 KB/row → ~27 MB/year | 500 MB/db | ~5 % |

**First wall:** Workers 100k requests/day ≈ **35× today's estimate**. A viral day (20×) still fits.

**Failure mode if exceeded:** Cloudflare returns error 1027 until 00:00 UTC; D1 returns errors after its daily quota. No bill. The app treats this like "server unavailable" (see client spec) — existing links on the recipient side fail until reset, which is the only real risk.

**Break-glass:** Workers Paid **$5/month** → 10M requests/month included, D1 25B reads / 50M writes per month, 30 s CPU. Upgrade takes minutes, no code change. Trigger: cron stats show > 50 % of any daily limit on 3 days in a week.

**Cheaper scale path before paying (only if ever needed):** serve payloads directly from a public R2 bucket on a custom subdomain (CDN-cached, no Worker invocation), keep the Worker only for create/status/landing.

## 4. CPU budget (10 ms on free)

Heaviest request is `POST` (parse ≤ 1 MiB JSON, validate, gzip, SHA-256). Rules:
- Validate with a small schema lib (Zod / Valibot); no per-field regex storms.
- `crypto.subtle.digest` and `CompressionStream` are native.
- Measure p99 CPU in Workers Observability after launch; if `POST` for "exact" topics trends > 8 ms, lower the size caps or move gzip to the client (`Content-Encoding: gzip` upload) before paying.

## 5. DNS / custom domain — **action needed**

Current state (checked 2026-09-26): `studdly.app` nameservers are **Netlify DNS** (`dns1..4.p09.nsone.net`). `share.studdly.app` does not exist yet.
Registrar: **OVH** (RDAP). ⚠️ Registration **expires 2026-10-31** — make sure auto-renew is on; if the domain lapses, every share link dies.

### Why a plain DNS record is not enough

The obvious idea — in Netlify DNS add `share CNAME studdly-share.<acct>.workers.dev` — **does not work**. Cloudflare's edge routes requests by hostname and only serves Workers for hostnames that belong to a zone on a Cloudflare account; a foreign hostname CNAME'd to `workers.dev` gets a Cloudflare error, not the Worker, and no certificate for `share.studdly.app` is issued. The Cloudflare features that attach a hostname whose parent zone lives elsewhere are:

| Cloudflare feature | What it allows | Plan |
|---|---|---|
| Full setup (move nameservers) | Worker Custom Domain on any hostname of the zone | **Free** |
| Partial / CNAME setup | Keep NS elsewhere, proxy selected records | Business / Enterprise only |
| Subdomain setup (delegate `share.` with NS records) | Only `share.studdly.app` becomes a Cloudflare zone | Enterprise only |
| **Cloudflare for SaaS** (custom hostnames) | Any external hostname `CNAME`s to a zone you own on Cloudflare; a Worker on that zone serves it | **Free plan: 100 hostnames included** |

Sources: [subdomain setup](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/), [partial setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/), [Cloudflare for SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/), [Worker as fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/).

### Option A (recommended) — move `studdly.app` DNS to Cloudflare (free)

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

## 6. Environments & deploy

| Env | Host | D1 / R2 | Used by |
|-----|------|---------|---------|
| `staging` | `studdly-share-staging.<acct>.workers.dev` | `studdly-share-staging` db + bucket | debug builds (`--dart-define=SHARE_BASE_URL=...`), CI e2e |
| `production` | `share.studdly.app` | `studdly-share` db + bucket | release builds |

- Repo layout (planned):
  ```
  src/index.ts            # Hono app wiring + scheduled() cron
  src/routes/api.ts       # /api/v1/*
  src/routes/admin.ts     # /api/admin/*
  src/routes/landing.ts   # /{code} HTML, 404/410 pages
  src/routes/wellKnown.ts # assetlinks.json, apple-app-site-association
  src/lib/code.ts         # share-code generator + validator
  src/lib/schema.ts       # payload v1 schema + limits
  src/lib/store.ts        # D1 + R2 access (the only place touching storage)
  src/lib/rateLimit.ts
  src/lib/i18n/*.json     # landing page copy (same language list as the app)
  migrations/0001_init.sql
  public/                 # static assets: css, logo, favicon, fonts (Workers Static Assets – free, not counted as Worker requests)
  test/                   # Vitest + @cloudflare/vitest-pool-workers (real D1/R2 in miniflare)
  wrangler.jsonc
  .github/workflows/ci.yml, deploy.yml
  ```
- `wrangler.jsonc` sketch:
  ```jsonc
  {
    "name": "studdly-share",
    "main": "src/index.ts",
    "compatibility_date": "2026-09-01",
    "assets": { "directory": "public", "binding": "ASSETS" },
    "d1_databases": [{ "binding": "DB", "database_name": "studdly-share", "database_id": "<id>" }],
    "r2_buckets": [{ "binding": "PAYLOADS", "bucket_name": "studdly-share" }],
    "ratelimits": [
      { "name": "RL_CREATE", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
      { "name": "RL_READ",   "namespace_id": "1002", "simple": { "limit": 120, "period": 60 } },
      { "name": "RL_REPORT", "namespace_id": "1003", "simple": { "limit": 5, "period": 60 } },
      { "name": "RL_MISS",   "namespace_id": "1004", "simple": { "limit": 20, "period": 60 } }   // 404 lookups (anti-enumeration)
    ],
    "triggers": { "crons": ["0 3 * * *"] },
    "observability": { "enabled": true },
    "routes": [{ "pattern": "share.studdly.app", "custom_domain": true }],
    "env": { "staging": { /* own name, db, bucket; workers_dev: true */ } }
  }
  ```
- Secrets (`wrangler secret put`): `ADMIN_TOKEN`, `IP_HASH_SALT`, `DISCORD_MODERATION_WEBHOOK`, `DISCORD_STATS_WEBHOOK`. Never in git.
- CI: `npm ci && npm run typecheck && npm test` on every push. Deploy: `main` → staging automatically; production on a git tag / manual workflow (`cloudflare/wrangler-action`, secret `CLOUDFLARE_API_TOKEN` scoped to Workers + D1 + R2 of this account). Migrations run with `wrangler d1 migrations apply --remote` **before** deploying code that needs them.
- Rollback: `wrangler rollback` (instant). Data safety: D1 Time Travel (7 days on free) for point-in-time restore.

## 7. Monitoring

- Workers Observability (logs + metrics) — log only: route, status, error code, CPU ms, payload size. Never log bodies, secrets, or raw IPs.
- External uptime check on `/api/v1/health` every 5 min (e.g. UptimeRobot free) → Discord.
- Daily cron stats → Discord (see `API_SPEC.md`).
- App side: Firebase Analytics events `topic_share_*` / `topic_import_*` (see client spec) give end-to-end success rate.
