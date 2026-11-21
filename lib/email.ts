/** How an email is compared at sign-in: no surrounding whitespace, lower-case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
