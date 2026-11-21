# Security

Illam holds a household's financial data, so security reports are very welcome.

**Please don't open a public issue for a vulnerability.** Report it privately through
[GitHub's private vulnerability reporting](https://github.com/kriznaraj/illam/security/advisories/new).
You should hear back within a week.

## Scope

In scope:
- Anything that lets a request without a session read or change data.
- A way around the HMAC check on `/api/inbox/ingest` or `/api/inbox/process`.
- Leaks of statement passwords, inbox secrets or the service key.
- Injection through mail content: bank alerts and PDFs are untrusted input.

Out of scope:
- One signed-in household member seeing another member's data. That is by design: a
  deployment serves one household.
- Findings that need access to the server's `.env`.

## Hardening checklist for operators

- Keep `.env` and `household.json` private. Neither is committed: `.gitignore` covers them.
- Serve Illam over HTTPS when it is reachable beyond your own machine.
- Sign-up stays disabled (`GOTRUE_DISABLE_SIGNUP`). Create accounts with `scripts/create-user.mjs`.
- Rotate `INBOX_SECRET_<SLUG>` if a Gmail account's Apps Script project is shared or compromised.
