# Self-hosting Illam

This guide takes you from a fresh machine to a running Illam that your household can use on
their phones. Plan on about 15 minutes, plus 10 minutes per Gmail account if you set up the
bank-mail sync.

- [1. What you need](#1-what-you-need)
- [2. Install](#2-install)
- [3. Describe your household](#3-describe-your-household)
- [4. Start it](#4-start-it)
- [5. Create logins](#5-create-logins)
- [6. Make it reachable (HTTPS)](#6-make-it-reachable-https)
- [7. Connect Gmail (optional)](#7-connect-gmail-optional)
- [8. Turn on AI features (optional)](#8-turn-on-ai-features-optional)
- [9. Day-to-day operations](#9-day-to-day-operations): backups, upgrades, logs, passwords
- [10. Troubleshooting](#10-troubleshooting)
- [Reference: household.json and .env](#reference-householdjson-and-env)

---

## 1. What you need

| | Minimum |
|---|---|
| Machine | Any 64-bit Linux, macOS or Windows (WSL2) box. A ₹500/month VPS, a Raspberry Pi 5 or a home server is enough. 1 GB RAM free, 2 GB disk |
| Docker | Docker Engine 24+ with the Compose v2 plugin (`docker compose version`) |
| Node.js | 20+. Only the setup scripts need it; the app runs inside Docker |
| Git | To clone and later upgrade |

Optional:
- A domain name, for HTTPS and the Gmail sync.
- An Anthropic API key, for the AI features.

## 2. Install

```bash
git clone https://github.com/kriznaraj/illam.git
cd illam
```

## 3. Describe your household

Illam serves **one household per installation**. Each member is someone whose bank mail Illam
reads and who can sign in.

```bash
cp household.example.json household.json
```

Edit `household.json`. To start, keep just the slug, name and payee names:

```json
{
  "members": [
    { "slug": "priya", "name": "Priya", "payeeNames": ["PRIYA"] },
    { "slug": "arjun", "name": "Arjun", "payeeNames": ["ARJUN"] }
  ]
}
```

- **`slug`**: lower-case letters, digits and `_`. It names the member in the Gmail script and in
  env vars (`INBOX_SECRET_PRIYA`).
- **`payeeNames`**: how banks print this person in a transfer narration, upper-case. They let
  Illam recognise money moved between your own accounts and between members.

You can add the account mappings (`cas`, `statementAccounts`, `contributionDestinations`) later,
once your accounts exist under **Net worth**. Each is explained in the
[reference](#householdjson) at the end of this guide.

## 4. Start it

```bash
node scripts/setup.mjs
docker compose --profile bundled-db up -d
```

`setup.mjs` writes `.env` with these generated values:
- a database password
- a JWT secret, plus the API keys signed with it
- one inbox secret per member
- the household

Re-run it whenever you edit `household.json`. Existing secrets are kept.

The first build takes a few minutes. When it finishes, check the stack:

```bash
docker compose ps        # db, rest, auth, app and gateway should be "running"; migrate "exited (0)"
```

Open <http://localhost:8000>. You should see the sign-in page.

**Already run Postgres?** Use it instead of the bundled one: any Postgres 15+, such as Neon,
RDS, Supabase or your own server. The user needs to be able to create roles and schemas.

```bash
node scripts/setup.mjs --database-url 'postgres://user:pass@host:5432/illam?sslmode=require'
docker compose up -d                  # no bundled-db profile
```

## 5. Create logins

There is no sign-up page, so create one login per member:

```bash
node scripts/create-user.mjs --email priya@example.com --member priya
node scripts/create-user.mjs --email arjun@example.com --member arjun
```

Each command prints a generated password. Members can change it under **Account → Change
password**.

**Want to look around first?** Load a made-up household's data (three months of expenses, a
year of net worth, commitments, notes). Don't do this on the install you'll use for real.

```bash
node scripts/seed-demo.mjs
```

## 6. Make it reachable (HTTPS)

On `localhost` only you can use it. To use it from phones, pick one of these:

**A. Your own domain, with automatic certificates (recommended on a VPS).** Point the domain's
DNS at the server and open ports 80 and 443. Then run:

```bash
node scripts/setup.mjs --public-url https://illam.example.com
DOMAIN=illam.example.com docker compose -f docker-compose.yml -f docker-compose.https.yml --profile bundled-db up -d --build
```

Caddy gets and renews a Let's Encrypt certificate on its own.

**B. A tunnel, with no open ports (good for a home server).** Run
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
or [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) pointing at `http://localhost:8000`,
then:

```bash
node scripts/setup.mjs --public-url https://<your-tunnel-hostname>
docker compose --profile bundled-db up -d
```

**C. Your home Wi-Fi only.** Use the machine's LAN address:

```bash
node scripts/setup.mjs --public-url http://192.168.1.20:8000
docker compose --profile bundled-db up -d
```

The Gmail sync needs option A or B.

> Already run a reverse proxy (nginx, Traefik, your own Caddy)? Point it at port 8000, the
> gateway, not at the app's container, and block `/_next/image` in it: Illam doesn't use
> Next.js's image optimizer, and the gateway keeps it closed for security.

> Changed `--public-url` later? Re-run `docker compose up -d` so the services pick up the new `.env`. Nothing needs rebuilding.

Then, on each phone, open the URL and choose **Add to Home Screen** (iOS Safari) or **Install
app** (Android Chrome).

## 7. Connect Gmail (optional)

This is what makes Illam track spending on its own. Each member runs a small Google Apps Script
in their own Gmail. Every 15 minutes it pushes new mail from supported bank senders to your
server, signed with that member's secret. The script is read-only on the mailbox, and the
server keeps only the extracted facts, never the email or the statement PDF.

**→ Follow [docs/gmail-sync.md](gmail-sync.md).** It takes about 10 minutes per member and needs
option A or B from step 6. In short:

1. On the server, print the member's four script settings and test the connection:

   ```bash
   node scripts/gmail-setup.mjs --member priya --mailbox priya@gmail.com
   ```

2. In their Gmail, create a project at <https://script.google.com>. Paste in
   `scripts/gmail-apps-script/Code.gs` and `appsscript.json`, and add the four Script
   Properties.
3. Run `checkSetup` (authorise when asked), then `runOnce` (imports 90 days), then
   `installTrigger`.
4. Add the member's statement PDF passwords as `STATEMENT_PASSWORDS_<SLUG>` in `.env`, then run
   `resendStatements`.

## 8. Turn on AI features (optional)

Add an Anthropic API key to `.env` and restart:

```bash
ANTHROPIC_API_KEY=sk-ant-...
docker compose up -d
```

The key turns on category suggestions, receipt scanning and help with ambiguous bank transfers.
Every feature works without a key, using rules instead.

## 9. Day-to-day operations

### Backups

Everything is in Postgres, including logins. The commands below are for the bundled database.

To back up:

```bash
docker compose exec -T db pg_dump -U illam -d illam --clean --if-exists | gzip > illam-$(date +%F).sql.gz
```

To restore into a running stack:

```bash
gunzip -c illam-2026-11-21.sql.gz | docker compose exec -T db psql -q -U illam -d illam
```

Also keep a copy of `.env` and `household.json` somewhere safe, such as a password manager.
Without `.env`, a restored database can't be opened by a new install's keys.

To back up nightly, add the backup line to `crontab -e`, for example `0 2 * * *`, and copy the
file off the machine.

### Upgrades

```bash
git pull
docker compose pull
docker compose --profile bundled-db up -d     # leave out the profile with your own Postgres
```

`git pull` brings the compose file and migrations; `docker compose pull` brings the matching image
(`ghcr.io/kriznaraj/illam`). Migrations run on their own on every start. Take a backup first.
To stay on a release, set `ILLAM_VERSION=0.1.0` in `.env`. To build from source instead of pulling,
add `--build`.

### Logs

```bash
docker compose logs -f app     # the Next.js app
docker compose logs -f auth    # sign-in
docker compose logs -f rest    # the data API
```

### Forgotten password

```bash
node scripts/reset-password.mjs --email priya@example.com
```

### Adding a member later

1. Add them to `household.json`.
2. Run `node scripts/setup.mjs`.
3. Run `docker compose up -d`.
4. Run `node scripts/create-user.mjs --email … --member …`.

### Stopping, and starting over

```bash
docker compose --profile bundled-db down        # stop; data is kept
docker compose --profile bundled-db down -v     # stop and DELETE all data
```

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `run node scripts/setup.mjs first` from compose | `.env` is missing. Run `node scripts/setup.mjs` in the repo folder |
| `auth` keeps restarting | Run `docker compose logs auth`. With an external Postgres, the user usually lacks rights to create roles or the `auth` schema |
| Sign-in says "Invalid login credentials" | Check the email for typos and the password for autofill, or reset it (above) |
| The page loads but data calls fail after changing the URL | Run `docker compose up -d` so the app reads the new `PUBLIC_URL` |
| Port 8000 is taken | Set `ILLAM_PORT=8080` in `.env` and re-run `setup.mjs --public-url http://localhost:8080` |
| Gmail script gets `HTTP 401 … mismatch` | `ILLAM_SECRET` in the script doesn't match `INBOX_SECRET_<SLUG>` in `.env`, or `ILLAM_OWNER` is wrong |
| Gmail script gets `HTTP 503 … not configured` | That member has no `INBOX_SECRET_<SLUG>`. Re-run `setup.mjs` and `docker compose up -d` |
| A statement stays "locked" | Its password is missing from `STATEMENT_PASSWORDS_<SLUG>`. The inbox item shows the bank's password hint |

Still stuck? [Open an issue](https://github.com/kriznaraj/illam/issues). Include
`docker compose ps` and the relevant `docker compose logs` lines, with secrets removed.

## Reference: household.json and .env

### household.json

`node scripts/setup.mjs` copies this file into `.env` as `ILLAM_HOUSEHOLD`. Re-run it after
every edit. Each member is a person whose mail Illam reads:

```json
{
  "members": [
    {
      "slug": "alice",
      "name": "Alice",
      "payeeNames": ["ALICE"],
      "cas": { "demat": "<account id>", "folios": "<account id>" },
      "statementAccounts": { "hdfc_account_statement:1234": "<account id>" },
      "contributionDestinations": { "5678": { "accountId": "<account id>", "alsoCheck": [] } }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `slug` | Lower-case id. Used in the Gmail script (`ILLAM_OWNER`) and in env var names |
| `name` | Display name |
| `payeeNames` | How banks print this person as a payee. A debit to yourself is an own-account move; a debit to another member is a household transfer |
| `cas` | Which accounts this member's CDSL CAS updates: a demat account, plus one folio account or a fund-name split (`folioAccounts`) |
| `statementAccounts` | Which account each emailed balance statement sets, keyed `<source id>:<last 4 digits>` |
| `contributionDestinations` | Accounts outside the household (a broker wallet, a savings scheme) that statements show money going into, keyed by last 4 digits |

Only `slug` and `name` are required. An account's id is in its page URL under **Net worth**.
Source ids are listed in `lib/inbox/sources.ts`. A complete example is
[`household.example.json`](../household.example.json).

### .env

`node scripts/setup.mjs` writes it; you rarely edit it by hand.

| Variable | Required | Purpose |
|---|---|---|
| `PUBLIC_URL` | yes | Where people open Illam. The gateway serves the API there too |
| `DATABASE_URL` | yes | Postgres connection used by migrations, PostgREST and GoTrue |
| `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | yes | Generated. The service key is server-only |
| `ILLAM_HOUSEHOLD` | yes | Generated from `household.json` |
| `ILLAM_PORT` | no | Host port for the gateway. Default `8000` |
| `ILLAM_VERSION` | no | Image tag to run, e.g. `0.1.0`. Default `latest` |
| `ILLAM_API_URL` | no | The API's address when it is not `PUBLIC_URL` (hosted Supabase) |
| `INBOX_SECRET_<SLUG>` | for Gmail sync | One per member. Signs the Apps Script's requests |
| `STATEMENT_PASSWORDS_<SLUG>` | for statement PDFs | JSON map of source id to passwords. Stays in the environment, never in the database |
| `ANTHROPIC_API_KEY` | no | Turns on the AI features |
| `INBOX_CAPTURE_STATEMENT_TEXT` | no | `1` saves masked statement text for writing a new reader (see CONTRIBUTING.md) |
| `ILLAM_TODO_FROM` | no | `yyyy-mm-dd`. Inbox To-do ignores mail received before it (it stays in Money and All). Useful after a long backfill. Default: none |
| `TZ` | no | Server time zone, e.g. `Asia/Kolkata`, so server-rendered dates and "this month" match your clock. Default: UTC |

### What runs

| Service | Role |
|---|---|
| `db` | Postgres 17. Only with `--profile bundled-db`; otherwise bring your own Postgres 15+ |
| `migrate` | Applies `db/migrations/` with dbmate on every start, then exits |
| `rest` | PostgREST: the data API the app's supabase-js client talks to |
| `auth` | GoTrue: email and password sign-in. Sign-up is disabled |
| `app` | The Next.js app: the published image, or built from this repo's `Dockerfile` with `--build` |
| `gateway` | Caddy: one origin for `/rest/v1`, `/auth/v1` and the app |

**Already on Supabase?** Illam talks to PostgREST and GoTrue through supabase-js, so a hosted
Supabase project works too. Apply `db/migrations/*.sql` to it, then run the app image (or
`pnpm build && pnpm start`) with `PUBLIC_URL` (where Illam is), `ILLAM_API_URL`
(`https://<project>.supabase.co`), `ANON_KEY`, `SERVICE_ROLE_KEY` and `ILLAM_HOUSEHOLD`.
