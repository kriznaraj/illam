# Gmail sync script (Google Apps Script)

These two files run inside each household member's Gmail as a Google Apps Script. Every 15
minutes the script pushes mail from supported bank senders to your Illam server, signed with that
member's secret.

| File | Paste into |
|---|---|
| [`Code.gs`](Code.gs) | the project's `Code.gs` |
| [`appsscript.json`](appsscript.json) | the project's manifest (read-only Gmail, outbound HTTPS, triggers) |

**Setup, authorisation, statement passwords and troubleshooting are all in
[docs/gmail-sync.md](../../docs/gmail-sync.md).** Start there.

To print a member's Script Properties and test the connection:

```bash
node scripts/gmail-setup.mjs --member <slug>
```

## Notes for contributors

- The sender list and Gmail query come from the server (`GET /api/inbox/ingest`, built from
  `lib/inbox/sources.ts`). To add a bank, change the app, not this script.
- `sign_()` must stay byte-for-byte compatible with `lib/inbox/signature.ts`: hex
  HMAC-SHA256 of `timestamp + "." + body`, with headers `x-illam-owner`, `x-illam-timestamp`
  and `x-illam-signature`.
- The watermark (`WATERMARK_MS`) moves forward only after the server accepts a message, so a
  failed run is retried next time. The server ignores duplicates, so re-sending is always safe.
- Changes here reach users only when they paste the new file. Mention them in `CHANGELOG.md`.
- Writing a new statement reader? Set `INBOX_CAPTURE_STATEMENT_TEXT=1` on a dev server. It saves
  the masked text of up to 2 statements per source to `statement_samples`. Turn it off and empty
  that table afterwards.
