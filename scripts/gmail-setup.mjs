#!/usr/bin/env node
// Prints the four Script Properties one member pastes into their Gmail Apps Script, then checks
// that the server answers a request signed with that member's secret, the same way the script
// will sign it. See docs/gmail-sync.md.
//
//   node scripts/gmail-setup.mjs --member alice
//   node scripts/gmail-setup.mjs --member alice --mailbox alice@example.com
import crypto from 'node:crypto';
import { readEnv } from './env-file.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), [])
);
const env = { ...readEnv('.env'), ...process.env };

if (!env.PUBLIC_URL) {
  console.error('No .env here. Run this from the Illam folder, after node scripts/setup.mjs.');
  process.exit(1);
}

const slugs = Object.keys(env)
  .filter((k) => k.startsWith('INBOX_SECRET_'))
  .map((k) => k.slice('INBOX_SECRET_'.length).toLowerCase());
const member = String(args.member || '').trim().toLowerCase();
if (!member || !slugs.includes(member)) {
  console.error('Usage: node scripts/gmail-setup.mjs --member <slug> [--mailbox <gmail address>]');
  console.error(`Members with an inbox secret: ${slugs.join(', ') || '(none; run node scripts/setup.mjs)'}`);
  process.exit(1);
}

const url = env.PUBLIC_URL.replace(/\/+$/, '');
const secret = env[`INBOX_SECRET_${member.toUpperCase()}`];

console.log(`Script Properties for ${member} (Project Settings → Script Properties):\n`);
console.log(`  ILLAM_URL      ${url}`);
console.log(`  ILLAM_OWNER    ${member}`);
console.log(`  ILLAM_SECRET   ${secret}`);
console.log(`  ILLAM_MAILBOX  ${args.mailbox || '<this member’s Gmail address>'}`);
console.log('\nTreat ILLAM_SECRET like a password: paste it only into that member’s own script.\n');

const local = /^http:\/\/|localhost|127\.0\.0\.1|\b192\.168\.|\b10\.\d+\./.test(url);
if (local) {
  console.log(`Warning: ${url} is not a public HTTPS address, so Google cannot reach it.`);
  console.log('Set one up first (docs/self-hosting.md, step 6), then re-run setup.mjs with --public-url.\n');
}

// The same request checkSetup() makes from Gmail: GET /api/inbox/ingest, signed over an empty body.
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.`).digest('hex');
try {
  const res = await fetch(`${url}/api/inbox/ingest`, {
    headers: { 'x-illam-owner': member, 'x-illam-timestamp': timestamp, 'x-illam-signature': signature },
  });
  const text = await res.text();
  if (!res.ok) {
    console.log(`Check failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    if (res.status === 503) console.log('The app has not picked up this secret yet. Run: docker compose up -d');
    process.exit(1);
  }
  const config = JSON.parse(text);
  const passwords = config.statements?.passwords ?? [];
  console.log(`Check passed: ${url} accepts ${member}'s signed requests.`);
  console.log(
    passwords.length
      ? `Statement passwords set for: ${passwords.join(', ')}`
      : `No statement passwords yet for ${member}; PDFs will show as "locked" (docs/gmail-sync.md, step 5).`
  );
} catch (e) {
  console.log(`Check failed: could not reach ${url} (${e.cause?.code || e.message}).`);
  process.exit(1);
}
