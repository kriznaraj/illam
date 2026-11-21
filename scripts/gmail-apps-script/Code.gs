/**
 * Illam — Madal (inbox) sync.
 *
 * Runs inside one Gmail account as a Google Apps Script. Every TRIGGER_MINUTES it
 * finds new mail from the senders Illam cares about and pushes each
 * message to POST /api/inbox/ingest, signed with this account's secret.
 *
 * - The sender list is not in this file: it is fetched from the app, so a new
 *   sender needs an app deploy and nothing here.
 * - The mailbox is never modified (no labels, no read state). Progress is a
 *   timestamp watermark in Script Properties; the server ignores duplicates.
 *
 * Setup: see README.md next to this file.
 *
 * Script Properties (Project Settings → Script Properties):
 *   ILLAM_URL      https://<your-illam-server>   (no trailing slash)
 *   ILLAM_OWNER    alice | bob
 *   ILLAM_SECRET   same value as INBOX_SECRET_<OWNER> in the server .env
 *   ILLAM_MAILBOX  this Gmail address (used for "Open in Gmail" links)
 */

var MAX_BODY_CHARS = 20000;
// Raw PDF bytes per email. Base64 adds a third, and Vercel rejects bodies over 4.5 MB.
var MAX_ATTACHMENT_BYTES = 2500000;
var THREAD_PAGE_SIZE = 100;
var MAX_THREADS = 500;
// How often the trigger runs. Google accepts only 1, 5, 10, 15 or 30 — no other value.
// This is the whole sync latency: everything after the trigger takes seconds.
// Consumer Gmail allows 90 minutes of trigger runtime a day, so 5 leaves little headroom
// for a statement day, when PDFs make a run take a minute or more. Change this, then run
// installTrigger again.
var TRIGGER_MINUTES = 15;

/** Pull new mail and push it to Illam. The trigger calls this. */
function runOnce() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    console.log('Another run is in progress; skipping.');
    return;
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var config = callIllam_('get', '');

    var watermark = Number(props.getProperty('WATERMARK_MS') || 0);
    var firstRun = !watermark;
    if (firstRun) {
      watermark = Date.now() - config.backfillDays * 24 * 60 * 60 * 1000;
    }

    // Gmail's after: is second-granular and a little loose; the exact cut is applied below.
    var afterSeconds = Math.floor(watermark / 1000) - 60;
    var messages = findMessagesSince_(config.query + ' after:' + afterSeconds, watermark, firstRun);

    var sent = 0;
    for (var i = 0; i < messages.length && sent < config.maxPerRun; i++) {
      var message = messages[i];
      var result = callIllam_('post', JSON.stringify(toPayload_(message, config.attachmentSenders)));
      sent++;
      // Advance only after the server accepted it, so a failure is retried next run.
      props.setProperty('WATERMARK_MS', String(message.getDate().getTime()));
      if (result && result.status === 'ignored') {
        console.log('Ignored (' + result.reason + '): ' + message.getSubject());
      }
    }

    console.log('Pushed ' + sent + ' of ' + messages.length + ' new message(s).');

    // Every run, not only when something was pushed: an unlogged spend waits 24 h
    // before it is auto-added, so later runs are what add it.
    // Each call stops after ~40 s and reports what is left, so a backlog takes a few calls.
    try {
      for (var pass = 1; pass <= 5; pass++) {
        var automation = callIllam_('post', '{}', '/api/inbox/process');
        console.log('Automation pass ' + pass + ': ' + JSON.stringify(automation.counts) + ', remaining ' + automation.remaining);
        if (!automation.remaining) break;
      }
    } catch (e) {
      console.log('Automation failed (the sync itself succeeded): ' + e.message);
    }
  } finally {
    lock.releaseLock();
  }
}

/** Oldest first, so the watermark only ever moves forward. */
function findMessagesSince_(query, watermark, inclusive) {
  var messages = [];
  for (var start = 0; start < MAX_THREADS; start += THREAD_PAGE_SIZE) {
    var threads = GmailApp.search(query, start, THREAD_PAGE_SIZE);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        var at = message.getDate().getTime();
        if (inclusive ? at >= watermark : at > watermark) messages.push(message);
      });
    });
    if (threads.length < THREAD_PAGE_SIZE) break;
  }
  messages.sort(function (a, b) {
    return a.getDate().getTime() - b.getDate().getTime();
  });
  return messages;
}

/** attachmentSenders (from the app): senders whose PDFs go along, i.e. statements. */
function toPayload_(message, attachmentSenders) {
  var props = PropertiesService.getScriptProperties();
  var payload = {
    messageId: message.getId(),
    mailbox: requiredProperty_(props, 'ILLAM_MAILBOX'),
    from: message.getFrom(),
    subject: message.getSubject(),
    date: message.getDate().toISOString(),
    body: message.getPlainBody().slice(0, MAX_BODY_CHARS),
    attachmentNames: message.getAttachments({ includeInlineImages: false }).map(function (a) {
      return a.getName();
    }),
  };
  if (attachmentSenders && attachmentSenders.indexOf(senderAddress_(message.getFrom())) !== -1) {
    payload.attachments = pdfAttachments_(message);
  }
  return payload;
}

function senderAddress_(from) {
  var bracketed = from.match(/<([^>]+)>/);
  return (bracketed ? bracketed[1] : from).trim().toLowerCase();
}

function pdfAttachments_(message) {
  var total = 0;
  var out = [];
  message.getAttachments({ includeInlineImages: false }).forEach(function (a) {
    var name = a.getName();
    if (a.getContentType() !== 'application/pdf' && !/\.pdf$/i.test(name)) return;
    var bytes = a.getBytes();
    if (total + bytes.length > MAX_ATTACHMENT_BYTES) {
      console.log('Skipping ' + name + ': over the attachment size limit.');
      return;
    }
    total += bytes.length;
    out.push({ name: name, contentType: 'application/pdf', base64: Utilities.base64Encode(bytes) });
  });
  return out;
}

function callIllam_(method, body, path) {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = requiredProperty_(props, 'ILLAM_URL').replace(/\/+$/, '');
  var owner = requiredProperty_(props, 'ILLAM_OWNER');
  var secret = requiredProperty_(props, 'ILLAM_SECRET');
  var timestamp = String(Math.floor(Date.now() / 1000));

  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      'x-illam-owner': owner,
      'x-illam-timestamp': timestamp,
      'x-illam-signature': sign_(secret, timestamp, body),
    },
  };
  if (method === 'post') {
    options.contentType = 'application/json';
    options.payload = body;
  }

  var response = UrlFetchApp.fetch(baseUrl + (path || '/api/inbox/ingest'), options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Illam returned HTTP ' + code + ': ' + text.slice(0, 300));
  }
  return JSON.parse(text);
}

/** hex(HMAC-SHA256(secret, timestamp + "." + body)) — must match lib/inbox/signature.ts. */
function sign_(secret, timestamp, body) {
  var bytes = Utilities.computeHmacSha256Signature(timestamp + '.' + body, secret, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      var hex = (b < 0 ? b + 256 : b).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    })
    .join('');
}

function requiredProperty_(props, name) {
  var value = props.getProperty(name);
  if (!value) throw new Error('Script property ' + name + ' is not set. See README.md.');
  return value;
}

// ---------------------------------------------------------------------------
// Run these by hand from the editor.
// ---------------------------------------------------------------------------

/** Confirms the URL, owner and secret are right, and shows the search query. */
function checkSetup() {
  var config = callIllam_('get', '');
  console.log('Connected as ' + config.owner + '. Query: ' + config.query);
  var count = GmailApp.search(config.query + ' newer_than:' + config.backfillDays + 'd', 0, 50).length;
  console.log('Matching threads in the last ' + config.backfillDays + ' days (first 50 counted): ' + count);
}

/** Shows what automation would do with the unprocessed alerts, without changing anything. */
function dryRunAutomation() {
  var result = callIllam_('post', JSON.stringify({ dryRun: true }), '/api/inbox/process');
  console.log('Would do: ' + JSON.stringify(result.counts));
  (result.actions || []).forEach(function (a) {
    console.log(a.txnDate + '  ₹' + a.amount + '  ' + a.outcome + '  ' + a.title + (a.detail ? '  (' + a.detail + ')' : ''));
  });
}

/** Runs runOnce every TRIGGER_MINUTES. Safe to call again; it replaces the old trigger. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runOnce').timeBased().everyMinutes(TRIGGER_MINUTES).create();
  console.log('Trigger installed: runOnce every ' + TRIGGER_MINUTES + ' minutes.');
}

/**
 * Logs the latest few messages from each sender, with long numbers and PANs
 * masked, so the app's reading rules can be checked against real wording.
 * Nothing is sent anywhere: open Executions, copy the log, and share only what
 * you are comfortable sharing.
 */
function dumpSamples() {
  var config = callIllam_('get', '');
  var senders = config.query.match(/from:\(([^)]*)\)/)[1].split(' OR ');
  senders.forEach(function (sender) {
    var threads = GmailApp.search('from:' + sender + ' newer_than:120d', 0, 5);
    threads.forEach(function (thread) {
      var messages = thread.getMessages();
      var message = messages[messages.length - 1];
      console.log(
        '==== ' + sender + ' | ' + message.getSubject() + '\n' + mask_(message.getPlainBody()).slice(0, 1500)
      );
    });
  });
}

/**
 * For a statement that never reached the app (the snapshots page lists them): did it
 * arrive in this mailbox at all, and from which address? Logs the last 45 days from
 * each statement sender the app knows, then any other statement-looking mail with a
 * PDF — a sender that changed its address shows up only in the second list. Only
 * senders, subjects and dates are logged.
 */
function findStatements() {
  var config = callIllam_('get', '');
  var senders = config.attachmentSenders || [];
  senders.forEach(function (sender) {
    var threads = GmailApp.search('from:' + sender + ' has:attachment newer_than:45d', 0, 10);
    var lines = [];
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        if (message.getFrom().toLowerCase().indexOf(sender) !== -1) {
          lines.push('  ' + message.getDate().toISOString().slice(0, 10) + '  ' + message.getSubject());
        }
      });
    });
    console.log(sender + (lines.length ? '\n' + lines.join('\n') : '  — nothing in 45 days'));
  });

  var others = GmailApp.search(
    '(statement OR CAS OR eCAS OR NPS) has:attachment newer_than:45d -from:(' + senders.join(' OR ') + ')',
    0,
    30
  );
  console.log('Other statement-looking mail with attachments (' + others.length + ' threads):');
  others.forEach(function (thread) {
    var message = thread.getMessages()[thread.getMessageCount() - 1];
    console.log('  ' + message.getDate().toISOString().slice(0, 10) + '  ' + senderAddress_(message.getFrom()) + '  ' + message.getSubject());
  });
}

function mask_(text) {
  return text
    .replace(/[A-Z]{5}\d{4}[A-Z]/g, '[PAN]')
    .replace(/\d{8,}/g, function (m) {
      return '••' + m.slice(-4);
    })
    .replace(/\b(?:OTP|one time password)\b[^.\n]*/gi, '[otp line removed]');
}

/**
 * Re-sends recent statement emails with their PDFs — for statements synced
 * before attachments were sent. Leaves the watermark alone; the app updates the
 * existing items instead of duplicating them. Safe to run again, e.g. after
 * adding a statement password in the server .env.
 */
function resendStatements() {
  var config = callIllam_('get', '');
  var senders = config.attachmentSenders || [];
  if (senders.length === 0) {
    console.log('The app lists no statement senders; deploy the latest version first.');
    return;
  }
  var query = 'from:(' + senders.join(' OR ') + ') has:attachment newer_than:' + config.backfillDays + 'd';
  var messages = findMessagesSince_(query, 0, true);
  messages.forEach(function (message) {
    callIllam_('post', JSON.stringify(toPayload_(message, senders)));
  });
  console.log('Re-sent ' + messages.length + ' statement email(s) with their PDFs.');
}

/** Forget progress, so the next run re-sends the backfill window. The server ignores duplicates. */
function resetWatermark() {
  PropertiesService.getScriptProperties().deleteProperty('WATERMARK_MS');
  console.log('Watermark cleared.');
}
