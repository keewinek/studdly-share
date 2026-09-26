// CI helper: Cloudflare requires an account-level workers.dev subdomain before
// a Worker can have cron triggers, even when workers_dev is off for the Worker
// itself. Registers one if the account has none. Needs CLOUDFLARE_API_TOKEN.
import { readFileSync } from 'node:fs';

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = /"account_id":\s*"([0-9a-f]{32})"/.exec(readFileSync('wrangler.jsonc', 'utf8'))?.[1];
if (!token || !accountId) throw new Error('CLOUDFLARE_API_TOKEN and account_id in wrangler.jsonc are required');

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const current = await (await fetch(url, { headers })).json();
if (current.success && current.result?.subdomain) {
  console.log(`workers.dev subdomain already registered: ${current.result.subdomain}`);
  process.exit(0);
}

for (const subdomain of ['studdly', 'studdly-app', 'studdly-share', `studdly-${accountId.slice(0, 6)}`]) {
  const res = await (await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ subdomain }) })).json();
  if (res.success) {
    console.log(`Registered workers.dev subdomain: ${subdomain}`);
    process.exit(0);
  }
  console.log(`Could not register ${subdomain}: ${JSON.stringify(res.errors)}`);
}
throw new Error('Could not register a workers.dev subdomain; open Workers & Pages in the dashboard once to create one.');
