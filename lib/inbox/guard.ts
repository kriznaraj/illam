/**
 * OTP / verification / password-reset mail is dropped before extraction and
 * never stored — the table is readable with the anon key.
 *
 * The body check deliberately needs a code *next to* the word: nearly every
 * bank alert and statement carries a "never share your OTP" footer, and a bare
 * keyword match would throw those away.
 */

const SENSITIVE_SUBJECT =
  /\b(otp|one[\s-]?time\s+password|verification\s+code|security\s+code|password\s+reset|reset\s+(?:your\s+)?password)\b/i;

const SENSITIVE_BODY =
  /\b(?:otp|one[\s-]?time\s+password|verification\s+code)\b\s*(?:is|:|-)?\s*\d{4,8}\b|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:otp|one[\s-]?time\s+password|verification\s+code)\b/i;

export function isSensitiveMessage(subject: string, body: string): boolean {
  return SENSITIVE_SUBJECT.test(subject) || SENSITIVE_BODY.test(body);
}
