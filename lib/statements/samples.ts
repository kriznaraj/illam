import { oneLine, redact, truncate } from '@/lib/inbox/text';

/** Enough for a multi-page CAS; anything longer is cut, not rejected. */
export const MAX_SAMPLE_CHARS = 60_000;

/**
 * Every part is length-bounded (the RFC limits: 64 for the local part, 253 for the
 * domain). Unbounded `+` before the `@` is quadratic on a line with no address —
 * each start position consumes the rest of the line and backtracks it — and a
 * statement page arrives as one 60,000-character line, which took 1.5 s per call.
 */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;

/**
 * Mask what must never be stored even in a temporary sample: PANs and long
 * digit runs (card, account, folio, PRAN numbers) via `redact`, plus email
 * addresses. Line breaks are kept — the layout is the point of a sample.
 */
export function redactStatementText(text: string): string {
  const masked = text
    .split('\n')
    .map((line) => redact(line).replace(EMAIL, '[email]'))
    .join('\n');
  return masked.length > MAX_SAMPLE_CHARS ? `${masked.slice(0, MAX_SAMPLE_CHARS)}\n…[truncated]` : masked;
}

/**
 * The email's sentences about the PDF password ("use the first four letters of
 * your name followed by…"). A rule, not the password — it tells the user what
 * to put in STATEMENT_PASSWORDS_*.
 */
export function passwordHint(body: string): string | null {
  const sentences = oneLine(body).split(/(?<=[.!?])\s+/);
  // The sentence after a "password" sentence often finishes the rule ("…followed by your
  // date of birth"), and CDSL's was cut mid-rule at the old 400-character limit.
  const picked = sentences.flatMap((sentence, i) =>
    /password/i.test(sentence) ? [sentence, sentences[i + 1] ?? ''] : []
  );
  const unique = [...new Set(picked.filter(Boolean))];
  return unique.length > 0 ? truncate(redact(unique.join(' ')), 1200) : null;
}
