#!/usr/bin/env node
// Sets a new password for an existing login. Self-hosted Illam sends no email, so this is how a
// forgotten password is reset.
//
//   node scripts/reset-password.mjs --email alice@example.com [--password <new>]
//
// Without --password a random one is generated and printed. Talks to the running stack at
// PUBLIC_URL with the service key from .env.
import crypto from 'node:crypto';
import { readEnv } from './env-file.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), [])
);
if (args.email) args.email = args.email.trim().toLowerCase();
const env = { ...readEnv('.env'), ...process.env };

if (!args.email) {
  console.error('Usage: node scripts/reset-password.mjs --email <email> [--password <new password>]');
  process.exit(1);
}

const base = env.PUBLIC_URL || 'http://localhost:8000';
const key = env.SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const list = await fetch(`${base}/auth/v1/admin/users?per_page=1000`, { headers });
if (!list.ok) {
  console.error(`Could not list logins: ${list.status} ${await list.text()}`);
  process.exit(1);
}
const { users = [] } = await list.json();
const user = users.find((u) => u.email?.toLowerCase() === args.email.toLowerCase());
if (!user) {
  console.error(`No login for ${args.email}. Existing: ${users.map((u) => u.email).join(', ') || '(none)'}`);
  process.exit(1);
}

const password = args.password || crypto.randomBytes(12).toString('base64url');
const res = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ password }),
});
if (!res.ok) {
  console.error(`Could not reset the password: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`Password reset for ${args.email}.`);
if (!args.password) console.log(`New password: ${password}`);
