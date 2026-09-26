// CI helper: makes sure every D1 database named in wrangler.jsonc exists
// (creating it in Western Europe if needed) and writes the real database_id
// into wrangler.jsonc for this run. Needs CLOUDFLARE_API_TOKEN/ACCOUNT_ID.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = 'wrangler.jsonc';
const LOCATION = 'weur';

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const listDatabases = () => {
  const out = wrangler('d1', 'list', '--json');
  return JSON.parse(out.slice(out.indexOf('[')));
};

let config = readFileSync(CONFIG, 'utf8');
const names = [...config.matchAll(/"database_name":\s*"([^"]+)"/g)].map((m) => m[1]);
let existing = listDatabases();

for (const name of names) {
  if (!existing.some((db) => db.name === name)) {
    console.log(`Creating D1 database ${name} (${LOCATION})…`);
    wrangler('d1', 'create', name, '--location', LOCATION);
    existing = listDatabases();
  }
  const db = existing.find((d) => d.name === name);
  if (!db) throw new Error(`D1 database ${name} not found after create`);
  const pattern = new RegExp(`("database_name":\\s*"${name}",\\s*"database_id":\\s*")[^"]*(")`);
  if (!pattern.test(config)) throw new Error(`database_id for ${name} not found in ${CONFIG}`);
  config = config.replace(pattern, `$1${db.uuid}$2`);
  console.log(`${name} → ${db.uuid}`);
}

writeFileSync(CONFIG, config);
