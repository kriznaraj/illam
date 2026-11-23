# Gmail sync: bank mail into Illam

Illam tracks spending without you typing it in, by reading the mail your bank already sends
you: debit alerts, card bills and statements. This guide connects one or more Gmail accounts to
your Illam server. Plan on 10 minutes per member.

- [How it works](#how-it-works)
- [Before you start](#before-you-start)
- [Step 1. Get the member's values](#step-1-get-the-members-values)
- [Step 2. Create the script in Gmail](#step-2-create-the-script-in-gmail)
- [Step 3. Authorise and test](#step-3-authorise-and-test)
- [Step 4. Backfill and switch on](#step-4-backfill-and-switch-on)
- [Step 5. Statement passwords](#step-5-statement-passwords)
- [What is supported](#what-is-supported)
- [Living with it](#living-with-it): timing, quotas, updates, turning it off
- [Troubleshooting](#troubleshooting)
- [Script function reference](#script-function-reference)

---

## How it works

```
 Member's Gmail                                   Your Illam server
┌──────────────────────────┐   every 15 min      ┌────────────────────────────────┐
│ Google Apps Script       │ ── HTTPS, signed ─▶ │ /api/inbox/ingest              │
│ (Code.gs, runs as them)  │                     │  checks the signature          │
│                          │ ◀── sender list ─── │  reads amount, merchant, card  │
│ reads matching mail only │                     │  unlocks statement PDFs        │
└──────────────────────────┘                     │ /api/inbox/process             │
                                                 │  links, auto-adds, settles     │
                                                 └───────────────┬────────────────┘
                                                                 ▼
                                                  Inbox, Expenses and Net worth
```

1. Each member runs a small **Google Apps Script** inside their own Gmail. It is a script on
   Google's servers, so nothing has to run on your phone or laptop.
2. Every 15 minutes it asks your Illam server which bank senders to look for, searches Gmail for
   new mail from them, and posts each message to your server.
3. Every request is signed with that member's secret (HMAC-SHA256) and refused if it's more
   than 5 minutes old. Nobody can push mail into your Illam without the secret.
4. The server pulls out the facts (amount, merchant, date, card's last 4 digits, due date) and
   keeps those. **It never stores the email body or the PDF.** OTP mail is dropped.
5. After each sync, automation links alerts to expenses you already logged, adds the spends
   nobody logged (labelled `auto`), marks card bills paid, and settles transfers it can explain.
   Anything it can't decide waits for you in the **Inbox**.

What the script can do in Gmail: **read only**. It never labels, marks read, moves or deletes
anything. It asks Google for exactly three permissions (`appsscript.json`):

| Permission | Why |
|---|---|
| Read your email messages and settings | To find the bank mail |
| Connect to an external service | To post that mail to your server |
| Allow this application to run when you are not present | The 15-minute trigger |

## Before you start

You need all three:

1. **A public HTTPS address for Illam.** Google's servers must be able to reach it, so
   `localhost` or a home-Wi-Fi address won't work. Use option A (your domain) or B (a tunnel)
   from [self-hosting step 6](self-hosting.md#6-make-it-reachable-https). Only the two inbox
   endpoints are open without a login, and both check the signature.
2. **The member in `household.json`**, with their `payeeNames` filled in. Then run
   `node scripts/setup.mjs` and `docker compose up -d`, which gives them an inbox secret.
3. **That member's Gmail account**, signed in on a computer. The Apps Script editor doesn't work
   well on a phone.

Google Workspace accounts work too, unless the admin blocks Apps Script.

## Step 1. Get the member's values

On the server, in the Illam folder:

```bash
node scripts/gmail-setup.mjs --member priya --mailbox priya@gmail.com
```

It prints the four values for the next step and checks that your public URL accepts requests
signed with Priya's secret:

```
Script Properties for priya (Project Settings → Script Properties):

  ILLAM_URL      https://illam.example.com
  ILLAM_OWNER    priya
  ILLAM_SECRET   72a6e47a…  (64 characters)
  ILLAM_MAILBOX  priya@gmail.com

Check passed: https://illam.example.com accepts priya's signed requests.
```

If the check fails, fix it before going on. The [troubleshooting](#troubleshooting) table
covers each message. Treat `ILLAM_SECRET` like a password: send it to the member over a private
channel, or do the next steps together.

## Step 2. Create the script in Gmail

Signed in **as that member**:

1. Open <https://script.google.com> and click **New project**. Click the title *Untitled
   project* and rename it `Illam sync`.
2. **Code.** Delete everything in the editor's `Code.gs`. Paste in the whole of
   [`scripts/gmail-apps-script/Code.gs`](../scripts/gmail-apps-script/Code.gs) from your Illam
   checkout, or from GitHub's **Raw** view. Press **Ctrl/⌘ + S**.
3. **Manifest.** Click the gear icon (**Project Settings**) on the left and tick **Show
   "appsscript.json" manifest file in editor**. Go back to the editor (`< >` icon), open
   `appsscript.json`, and replace its contents with
   [`scripts/gmail-apps-script/appsscript.json`](../scripts/gmail-apps-script/appsscript.json).
   Save. This is what limits the script to read-only Gmail.
   The manifest sets the time zone to `Asia/Kolkata`. Change it if you live elsewhere.
4. **Properties.** In **Project Settings**, scroll to **Script Properties** and click **Add
   script property** four times. Paste the four names and values from step 1, without spaces
   around them:

   | Property | Value |
   |---|---|
   | `ILLAM_URL` | your public URL, with no trailing slash |
   | `ILLAM_OWNER` | the member's slug, e.g. `priya` |
   | `ILLAM_SECRET` | the member's secret from step 1 |
   | `ILLAM_MAILBOX` | this Gmail address |

   Click **Save script properties**.

## Step 3. Authorise and test

1. In the editor, choose **`checkSetup`** in the function dropdown at the top, then click
   **Run**.
2. Google asks for authorisation, the first time only:
   - **Review permissions** → choose the member's account.
   - *"Google hasn't verified this app"* appears because it's a private script, not a published
     app. Click **Advanced** → **Go to Illam sync (unsafe)**. It's the script you just pasted.
   - Check the three permissions match the table above, then **Allow**.
3. The **Execution log** at the bottom should show:

   ```
   Connected as priya. Query: (from:(alerts@hdfcbank.net OR …
   Matching threads in the last 90 days (first 50 counted): 37
   ```

   `Connected as priya` means the URL, owner and secret are right. A count of 0 just means none
   of the [supported senders](#what-is-supported) have mailed this account in 90 days.

## Step 4. Backfill and switch on

1. Choose **`runOnce`** and click **Run**. This first run imports the last **90 days**. Each run
   sends at most 150 messages and Apps Script stops a run after 6 minutes, so a busy mailbox may
   need `runOnce` two or three times. Each run picks up where the last one stopped. The log
   ends with lines like:

   ```
   Pushed 150 of 212 new message(s).
   Automation pass 1: {"linked":12,"created":31,"card_bill":2,"waiting":4,…}, remaining 0
   ```

2. Open Illam → **Inbox** → **All**. The imported mail is there, newest first. Backfilled mail
   is recorded but not flagged as needing attention, so you aren't buried in three months of
   alerts on day one.
3. Choose **`installTrigger`** and click **Run**. The log says
   `Trigger installed: runOnce every 15 minutes.` You'll find it under **Triggers** (the clock
   icon), where Google can also email you if runs start failing.

Repeat steps 1 to 4 for each member, in their own Gmail.

## Step 5. Statement passwords

Card, bank and investment statements arrive as password-protected PDFs. The script sends those
PDFs (up to 2.5 MB each). The server unlocks them **in memory**, reads balances and transactions,
and throws the file away. It needs each member's passwords, which live only in the server's
`.env`:

```bash
# .env: one line per member, JSON in single quotes.
# Keys are the source ids in the table below; "*" is tried for every source.
STATEMENT_PASSWORDS_PRIYA='{"hdfc_card_statement":["PRIY0101"],"cdsl_cas":["ABCDE1234F"],"*":["ABCDE1234F"]}'
```

- Each value is a list, so you can give several candidates for one source.
- The format is usually in the email itself. Common ones are your PAN, your date of birth
  (`DDMMYYYY`), or the first four letters of your name plus `DDMM`.
- Apply with `docker compose up -d`, then confirm with
  `node scripts/gmail-setup.mjs --member priya`. It lists which sources have passwords. It
  never prints them.

Then, in that member's script, run **`resendStatements`** to send the last 90 days of statements
again. A statement still marked **locked** in the Inbox shows the email's password hint. Fix that
entry in `.env`, apply, and run `resendStatements` again. Duplicates are ignored.

## What is supported

| Institution | What Illam reads | Source id(s) | PDF |
|---|---|---|---|
| HDFC Bank | Debit and credit alerts; card statements; account statements | `hdfc_alerts`, `hdfc_card_statement`, `hdfc_account_statement` | statements |
| Axis Bank | Alerts; card statements | `axis_alerts`, `axis_card_statement` | statements |
| ICICI Bank | Card alerts and statements | `icici_cards`, `icici_card_statement` | ✓ |
| Kotak Bank | Alerts; account statements | `kotak_alerts`, `kotak_account_statement` | statements |
| SBI | Account statements | `sbi_account_statement` | ✓ |
| BOBCARD | Card statements | `bob_card_statement` | ✓ |
| CDSL / NSDL | Consolidated account statement (CAS): demat and mutual funds | `cdsl_cas`, `nsdl_cas` | ✓ |
| NPS (Protean) | NPS statements | `nps_protean` | ✓ |
| Zerodha, Groww, INDmoney | Contract notes, holdings and statements | `zerodha`, `groww`, `indmoney` | ✓ |

The sender list lives in the app ([`lib/inbox/sources.ts`](../lib/inbox/sources.ts)), and the
script fetches it on every run. **Adding a bank needs an Illam update but no change to anyone's
script.** Mail from banks not on the list never leaves Gmail. To ask for a bank, use the
*Support a new bank* issue form. Never paste a real statement into it.

## Living with it

**How fast.** A new alert reaches the Inbox within one trigger interval, 15 minutes by default.
To change it, edit `TRIGGER_MINUTES` at the top of `Code.gs`. Google allows only 1, 5, 10, 15
or 30. Save, then run `installTrigger` again. A personal Gmail account gets 90 minutes of
trigger runtime a day. 15 minutes leaves plenty of room. 5 minutes can run out on a day with
several statement PDFs.

**Seeing what happened.** **Executions** (the list icon in the script's sidebar) shows each
run's log. In Illam, **Inbox → All** shows everything received.

**Preview automation.** Run `dryRunAutomation` to list what automation *would* do with the
alerts not yet processed, without changing anything.

**After upgrading Illam.** The script rarely changes. When the
[changelog](../CHANGELOG.md) says it did, paste the new `Code.gs` into each member's project and
save. Properties and the trigger stay as they are.

**Changing a member's secret.** Delete their `INBOX_SECRET_<SLUG>` line from `.env`, run
`node scripts/setup.mjs` (it makes a new one) and `docker compose up -d`. Then put the new value
from `gmail-setup.mjs` into their `ILLAM_SECRET` property. Do this if the secret may have
leaked.

**Moving to a new URL.** Re-run `setup.mjs --public-url …` and rebuild, then update
`ILLAM_URL` in every member's script.

**Turning it off.** In the script, open **Triggers** and delete the `runOnce` trigger. To
remove its access completely, go to <https://myaccount.google.com/permissions>, choose **Illam
sync** and remove access. Data already in Illam stays.

## Troubleshooting

Check the run's log under **Executions** first. Most problems show up as one of these:

| Message or symptom | What it means and what to do |
|---|---|
| `Script property ILLAM_URL is not set` | A property is missing or misspelt. Re-check step 2.4 |
| `HTTP 401 … "reason":"mismatch"` | `ILLAM_SECRET` doesn't match the server, or `ILLAM_OWNER` names another member. Re-copy both from `gmail-setup.mjs` |
| `HTTP 401 … "reason":"stale"` | The request was over 5 minutes old. Apps Script clocks are accurate, so retry. If it repeats, the **server's** clock is wrong; enable NTP |
| `HTTP 401` with an HTML page | Something in front of Illam wants a login, e.g. Cloudflare Access. Let `/api/inbox/ingest` and `/api/inbox/process` through without it |
| `HTTP 503 … not configured` | The server has no `INBOX_SECRET_<SLUG>` for this member. Run `setup.mjs` and `docker compose up -d` |
| `DNS error`, `Address unavailable`, or a timeout | `ILLAM_URL` isn't reachable from the internet. Open it on a phone with Wi-Fi off. Only option A or B from self-hosting step 6 works |
| `Exception: Request failed … SSL` | The certificate isn't valid yet. Let Caddy finish getting it and check ports 80 and 443 are open |
| `Authorization is required` or a `GmailApp` permission error | Run any function by hand once to re-authorise. If it persists, remove `oauthScopes` from `appsscript.json` and authorise again (Google then asks for broader Gmail access) |
| `Service invoked too many times` or `exceeded maximum execution time` | Daily quota reached. Runs resume tomorrow. Set `TRIGGER_MINUTES` back to 15 or 30 |
| `Another run is in progress; skipping.` | Harmless. A manual run overlapped the trigger |
| `Ignored (sensitive): …` | Harmless. It looked like an OTP or password mail, so it was not stored |
| `Ignored (unknown_sender): …` | Harmless. A sender the app no longer lists |
| `Automation failed (the sync itself succeeded)` | Mail arrived, but the follow-up step errored. See `docker compose logs app` |
| `Matching threads … 0` but you have bank mail | That sender isn't supported yet, or it changed its address. Run `findStatements` to list who actually mails this account |
| A statement shows **locked** in the Inbox | Missing or wrong password. See [step 5](#step-5-statement-passwords) |
| Net worth says a statement wasn't received | Run `findStatements`. Listed under its sender: run `resendStatements`. Only under "Other": the bank changed address; open an issue. Not listed: it never reached this mailbox |
| Mail missing after an Illam update added a bank | Run `resetWatermark`, then `runOnce`. It re-sends 90 days and duplicates are ignored |
| An amount or merchant is read wrongly | Run `dumpSamples` and attach the relevant log lines to an issue. PAN, long account numbers and OTP lines are masked, but names, addresses and short numbers are not, so edit those out before posting |

## Script function reference

Choose a function in the editor's dropdown and click **Run**.

| Function | What it does |
|---|---|
| `checkSetup` | Confirms URL, owner and secret; shows the search and how many threads match |
| `runOnce` | One sync. The first run backfills 90 days. The trigger runs this |
| `installTrigger` | Runs `runOnce` every `TRIGGER_MINUTES`. Safe to run again; it replaces the old trigger |
| `dryRunAutomation` | Shows what automation would do, changing nothing |
| `resendStatements` | Re-sends the last 90 days of statement emails with their PDFs |
| `findStatements` | Lists the last 45 days of statement mail in this account by sender, to find missing or moved senders |
| `dumpSamples` | Logs partly masked samples of matching mail, for writing or fixing a bank's rules |
| `resetWatermark` | Forgets progress, so the next `runOnce` re-sends the 90-day window |
