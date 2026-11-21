// @vitest-environment node
// pdf.js checks for a DOM to decide how to load its worker; under happy-dom it
// would take the browser path.
import { describe, it, expect } from 'vitest';
import { extractPdfText, openWithCurrent, passwordVariants } from '../pdfText';
import { buildAes256TestPdf, buildRevision3Or4TestPdf, buildTestPdf } from './testPdf';

// The encryption the live statements use (2026-09-14): HDFC/Axis RC4-128 (R3),
// CDSL AES-128 (R4). Both readers open them with the right password, which is
// what pointed the locked live statements at the configured passwords instead.
describe('extractPdfText on bank-statement encryption', () => {
  it.each([3, 4] as const)('opens a revision %s PDF with the right password on either reader', async (revision) => {
    const pdf = buildRevision3Or4TestPdf(['HOLDING STATEMENT AS ON 31-08-2026'], 'ABCDE1234F', revision);
    expect(await extractPdfText(pdf, ['WRONG12345'])).toEqual({ status: 'locked', reason: 'password_incorrect' });
    expect(await extractPdfText(pdf, ['ABCDE1234F'])).toMatchObject({ status: 'ok', engine: 'pdfjs-1.10' });
    expect(await openWithCurrent(pdf, 'ABCDE1234F', 5)).toMatchObject({ status: 'ok' });
  });
});

const LINES = ['HOLDING STATEMENT AS ON 31-08-2026', 'TOTAL 1,23,456.78'];

describe('extractPdfText', () => {
  it('reads an unprotected PDF without trying any password', async () => {
    const result = await extractPdfText(buildTestPdf(LINES), ['unused']);
    expect(result).toMatchObject({ status: 'ok', pageCount: 1, passwordUsed: false, engine: 'pdfjs-1.10' });
    if (result.status === 'ok') {
      expect(result.text).toContain('HOLDING STATEMENT AS ON 31-08-2026');
      expect(result.text).toContain('TOTAL 1,23,456.78');
    }
  });

  it('unlocks a protected PDF with the right candidate, whatever its position', async () => {
    const result = await extractPdfText(buildTestPdf(LINES, 'ALIC0101'), ['wrong-one', 'ALIC0101']);
    expect(result).toMatchObject({ status: 'ok', passwordUsed: true });
    if (result.status === 'ok') expect(result.text).toContain('HOLDING STATEMENT');
  });

  // Bank statements use AES-256 (Standard handler V5 R6), not RC4. When every live
  // statement came back locked, this is what ruled the reader out as the cause.
  it('unlocks AES-256 (R6) encryption like real bank statements, and only with the exact password', async () => {
    const pdf = buildAes256TestPdf(LINES, 'ABCDE1234F');
    expect(await extractPdfText(pdf, ['ZZZZZ9999Z'])).toEqual({ status: 'locked', reason: 'password_incorrect' });
    const result = await extractPdfText(pdf, ['ZZZZZ9999Z', 'ABCDE1234F']);
    expect(result).toMatchObject({ status: 'ok', passwordUsed: true });
    if (result.status === 'ok') expect(result.text).toContain('HOLDING STATEMENT AS ON 31-08-2026');
  });

  it('reports a protected PDF as locked when no password is configured', async () => {
    expect(await extractPdfText(buildTestPdf(LINES, 'ALIC0101'))).toEqual({ status: 'locked', reason: 'password_required' });
  });

  it('reports a protected PDF as locked when every candidate is wrong', async () => {
    expect(await extractPdfText(buildTestPdf(LINES, 'ALIC0101'), ['ABCD', 'EFGH'])).toEqual({
      status: 'locked',
      reason: 'password_incorrect',
    });
  });

  it('tries each password in upper and lower case too', async () => {
    expect(passwordVariants(['Alic0505', 'ALIC0505'])).toEqual(['Alic0505', 'ALIC0505', 'alic0505']);
    const result = await extractPdfText(buildTestPdf(LINES, 'abcde1234f'), ['ABCDE1234F']);
    expect(result).toMatchObject({ status: 'ok', passwordUsed: true });
  });

  // The fallback reader, used when pdf.js 1.10 reports a statement locked.
  it('opens RC4 and AES-256 protected PDFs with the current pdf.js too', async () => {
    const rc4 = await openWithCurrent(buildTestPdf(LINES, 'ALIC0101'), 'ALIC0101', 5);
    expect(rc4).toMatchObject({ status: 'ok', pageCount: 1 });
    if (rc4.status === 'ok') expect(rc4.text).toContain('HOLDING STATEMENT');

    const aes = await openWithCurrent(buildAes256TestPdf(LINES, 'ABCDE1234F'), 'ABCDE1234F', 5);
    expect(aes).toMatchObject({ status: 'ok' });
    expect(await openWithCurrent(buildAes256TestPdf(LINES, 'ABCDE1234F'), 'wrong', 5)).toEqual({ status: 'locked' });
  });

  it('fails without throwing on bytes that are not a PDF', async () => {
    const result = await extractPdfText(Buffer.from('not a pdf at all'), []);
    expect(result.status).toBe('failed');
  });
});
