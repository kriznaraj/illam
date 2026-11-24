# Changelog

## 0.1.0 (2026-11-24)

First open-source release.

- Expenses, net worth, the bank-mail inbox, cash flow, notes, to-dos, activity tracker and
  annual review.
- A calm light and dark theme that follows the system setting or a per-device choice (Account),
  system fonts (no font downloads)
  and a new logo.
- Readers for HDFC, Axis, ICICI and Kotak alerts and statements, CDSL/NSDL CAS, NPS and Groww.
- One-command self-hosting with Docker Compose: Postgres (or your own), PostgREST, GoTrue and Caddy,
  with optional automatic HTTPS.
- A published image (`ghcr.io/kriznaraj/illam`, amd64 and arm64) configured entirely at runtime, so
  nobody needs to build. Update with `git pull && docker compose pull && docker compose up -d`.
- Configurable household (`household.json`), with signed Gmail Apps Script ingestion per member.
- Row level security on every table, no anonymous access, and no public sign-up.
- Scripts to create users, reset passwords, load demo data and print each member's Gmail script
  settings (`scripts/gmail-setup.mjs`).
- Step-by-step Gmail sync guide (`docs/gmail-sync.md`).
- An About page (version, licence, source code, who makes it) and a source link on the sign-in
  page, as the AGPL asks.
- A short launch splash and a quiet "from Aatra" credit on the sign-in page.
