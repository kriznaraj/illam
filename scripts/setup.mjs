#!/usr/bin/env node
// Writes .env for a self-hosted Illam: database password, JWT secret, the anon and service
// keys signed with it, one inbox secret per household member, and the household itself
// (from household.json). Safe to re-run: existing secrets are kept, so edit household.json
// and run it again to update members.
//
//   node scripts/setup.mjs [--public-url https://illam.example.com] [--database-url postgres://…]
import crypto from 'node:crypto';
import fs from 'node:fs';
import { formatEnvValue, readEnv } from './env-file.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), [])
);

const ENV_PATH = '.env';
const HOUSEHOLD_PATH = 'household.json';
const existing = readEnv(ENV_PATH);

if (!fs.existsSync(HOUSEHOLD_PATH)) {
  fs.writeFileSync(
    HOUSEHOLD_PATH,
    JSON.stringify({ members: [{ slug: 'me', name: 'Me', payeeNames: [] }] }, null, 2) + '\n'
  );
  console.log(`Created ${HOUSEHOLD_PATH} with one member. Edit it (see household.example.json) and re-run.`);
}
const household = JSON.parse(fs.readFileSync(HOUSEHOLD_PATH, 'utf8'));
if (!Array.isArray(household.members) || household.members.length === 0) {
  throw new Error(`${HOUSEHOLD_PATH} needs at least one member`);
}

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const b64url = (input) => Buffer.from(input).toString('base64url');

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const keep = (key, make) => existing[key] || make();
const jwtSecret = keep('JWT_SECRET', () => hex(32));
// Keys signed with an older secret would be rejected, so re-sign them when the secret changed.
const keyFor = (key, role) => {
  const iat = Math.floor(Date.now() / 1000);
  const fresh = () => signJwt({ role, iss: 'illam', iat, exp: iat + 10 * 365 * 24 * 3600 }, jwtSecret);
  return existing.JWT_SECRET === jwtSecret ? keep(key, fresh) : fresh();
};

const postgresPassword = keep('POSTGRES_PASSWORD', () => hex(24));
const publicUrl = args['public-url'] || existing.PUBLIC_URL || 'http://localhost:8000';

const env = {
  PUBLIC_URL: publicUrl,
  POSTGRES_PASSWORD: postgresPassword,
  DATABASE_URL:
    args['database-url'] || existing.DATABASE_URL || `postgres://illam:${postgresPassword}@db:5432/illam?sslmode=disable`,
  JWT_SECRET: jwtSecret,
  ANON_KEY: keyFor('ANON_KEY', 'anon'),
  SERVICE_ROLE_KEY: keyFor('SERVICE_ROLE_KEY', 'service_role'),
  ILLAM_HOUSEHOLD: JSON.stringify(household),
};
// GoTrue's migrations create unqualified types, so its connection must default to the auth schema.
{
  const url = new URL(env.DATABASE_URL);
  url.searchParams.set('search_path', 'auth');
  env.AUTH_DATABASE_URL = url.toString();
}
for (const member of household.members) {
  const key = `INBOX_SECRET_${String(member.slug).toUpperCase()}`;
  env[key] = keep(key, () => hex(32));
}

// Keep anything else already in .env (ANTHROPIC_API_KEY, STATEMENT_PASSWORDS_*, …).
for (const [key, value] of Object.entries(existing)) {
  if (key in env) continue;
  if (key.startsWith('INBOX_SECRET_')) continue; // a member removed from household.json
  if (['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].includes(key)) continue; // copies early installs kept
  env[key] = value;
}
if (!('ANTHROPIC_API_KEY' in env)) env.ANTHROPIC_API_KEY = '';

const lines = [
  '# Written by scripts/setup.mjs. Re-run it after editing household.json; secrets are kept.',
  '# Never commit this file.',
  ...Object.entries(env).map(([key, value]) => `${key}=${formatEnvValue(String(value))}`),
];
fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', { mode: 0o600 });
console.log(`Wrote ${ENV_PATH} for ${household.members.length} member(s) at ${publicUrl}.`);
console.log(args['database-url'] ? 'Next: docker compose up -d' : 'Next: docker compose --profile bundled-db up -d');
