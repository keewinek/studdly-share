// CI helper: uploads optional Worker secrets from GitHub secrets, and creates
// IP_HASH_SALT once (random) if the Worker doesn't have it yet.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const out = wrangler('secret', 'list', '--format', 'json');
const present = new Set(JSON.parse(out.slice(out.indexOf('['))).map((s) => s.name));

const secrets = {};
for (const name of ['ADMIN_TOKEN', 'DISCORD_MODERATION_WEBHOOK', 'DISCORD_STATS_WEBHOOK']) {
  if (process.env[name]) secrets[name] = process.env[name];
}
if (!present.has('IP_HASH_SALT')) secrets.IP_HASH_SALT = randomBytes(32).toString('base64url');

const names = Object.keys(secrets);
if (names.length === 0) {
  console.log('No secrets to update.');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
const file = join(dir, 'secrets.json');
try {
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  wrangler('secret', 'bulk', file);
  console.log(`Updated secrets: ${names.join(', ')}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
