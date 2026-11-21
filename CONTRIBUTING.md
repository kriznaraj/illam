# Contributing

Thanks for helping. Illam is small and opinionated, so open an issue before starting a large
change.

## Setup

```bash
pnpm install
pnpm test:ci        # must pass
npx tsc --noEmit    # must be clean; the build skips type errors, so CI checks here
```

Tests use the example household in `household.example.json` (Alice and Bob) and never call an
AI provider.

## Ground rules

- **No real data.** No real names, account numbers, amounts from your own statements, merchant
  histories or email addresses in code, tests or comments. Build fixtures from made-up values.
  CI runs gitleaks, but it cannot catch everything.
- **Layers.** Pages call hooks (`lib/hooks`), hooks call API routes (`app/api`), routes call
  services (`lib/services`), services call repositories (`lib/repositories`).
- **Schema changes** go in a new file in `db/migrations/` (dbmate format: `-- migrate:up`).
  Never edit a migration that has shipped.
- **Mail and PDFs are untrusted input.** Extractors must not execute or follow anything they read.

## Adding a bank or statement

1. **Sender.** Add an entry to `lib/inbox/sources.ts` with the sender addresses, and set
   `attachments: true` if its mails carry statement PDFs.
2. **Alerts.** Add or extend an extractor in `lib/inbox/extractors/`, and add tests in
   `lib/inbox/__tests__/extractors.test.ts` built from a *made-up* alert in the bank's exact wording.
3. **Statements.** Add a reader in `lib/statements/`. Build test PDFs with
   `lib/statements/__tests__/testPdf.ts`, using synthetic numbers in the real layout.
4. **Capturing a real layout without sharing it.** Set `INBOX_CAPTURE_STATEMENT_TEXT=1`, so the app
   stores the masked text of a few statements in `statement_samples`. Write the reader against
   that text, then rewrite every value before it goes into a test.

## Pull requests

- Keep each PR to one change. Add tests for behaviour changes.
- Describe what you checked by hand, such as a statement you parsed locally. Do not attach the
  statement.
