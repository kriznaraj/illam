# Changelog

## 0.1.0 (unreleased)

First open-source release.

- Expenses (Selavu), net worth (Selvam), the bank-mail inbox (Madal), cash flow, notes, to-dos,
  activity tracker and annual review.
- Readers for HDFC, Axis, ICICI and Kotak alerts and statements, CDSL/NSDL CAS, NPS and Groww.
- One-command self-hosting with Docker Compose: Postgres (or your own), PostgREST, GoTrue and Caddy,
  with optional automatic HTTPS.
- Configurable household (`household.json`), with signed Gmail Apps Script ingestion per member.
- Row level security on every table, no anonymous access, and no public sign-up.
- Scripts to create users, reset passwords, load demo data and print each member's Gmail script
  settings (`scripts/gmail-setup.mjs`).
- Step-by-step Gmail sync guide (`docs/gmail-sync.md`).
