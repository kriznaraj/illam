#!/usr/bin/env node
// Creates a login for a household member, and the matching app user row.
//
//   node scripts/create-user.mjs --email alice@example.com --member alice [--password …] [--name "Alice A"]
//
// Talks to the running stack at PUBLIC_URL with the service key from .env.
import crypto from 'node:crypto';
import { readEnv } from './env-file.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), [])
);
if (args.email) args.email = args.email.trim().toLowerCase();
const env = { ...readEnv('.env'), ...process.env };
const household = JSON.parse(env.ILLAM_HOUSEHOLD || '{"members":[]}');
const member = household.members.find((m) => m.slug === args.member) ?? (household.members.length === 1 ? household.members[0] : null);

if (!args.email || !member) {
  console.error('Usage: node scripts/create-user.mjs --email <email> --member <slug> [--password <pw>] [--name <full name>]');
  console.error(`Members: ${household.members.map((m) => m.slug).join(', ') || '(none — run scripts/setup.mjs)'}`);
  process.exit(1);
}

const base = env.PUBLIC_URL || 'http://localhost:8000';
const key = env.SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const password = args.password || crypto.randomBytes(12).toString('base64url');

const res = await fetch(`${base}/auth/v1/admin/users`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email: args.email, password, email_confirm: true }),
});
const created = await res.json();
if (!res.ok) {
  console.error(`Could not create the login: ${created.msg || created.message || res.status}`);
  process.exit(1);
}

const row = {
  id: created.id,
  username: member.username || member.slug,
  full_name: args.name || member.name,
  email: args.email,
};
const insert = await fetch(`${base}/rest/v1/users`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'return=minimal' },
  body: JSON.stringify(row),
});
if (!insert.ok) {
  console.error(`Login created, but the user row failed: ${await insert.text()}`);
  process.exit(1);
}

console.log(`Created ${args.email} for ${member.name} (${member.slug}).`);
if (!args.password) console.log(`Password: ${password}  (change it from Account after signing in)`);
