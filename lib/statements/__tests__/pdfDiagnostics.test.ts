// @vitest-environment node
// testPdf.ts uses Node's crypto. Under happy-dom, Vercel's Node fails to load the
// file at all ("No such built-in module: node:"), which fails the build.
import { describe, it, expect } from 'vitest';
import { describeEncryption, describeEncryptionInfo, describeIntegrity, passwordShape } from '../pdfDiagnostics';

describe('describeIntegrity', () => {
  it('reports size, header, end marker and trailer ID', () => {
    const whole = buildTestPdf(['x'], 'secret');
    expect(describeIntegrity(whole)).toBe(`${whole.length}b %PDF-1.4 EOF ID`);
  });

  it('notices a truncated file', () => {
    const whole = buildTestPdf(['x'], 'secret');
    const cut = whole.subarray(0, Math.floor(whole.length / 2));
    expect(describeIntegrity(cut)).toBe(`${cut.length}b %PDF-1.4 no EOF no ID`);
  });
});
import { buildTestPdf } from './testPdf';

describe('describeEncryption', () => {
  it('reads the security handler of an encrypted PDF', () => {
    const info = describeEncryption(buildTestPdf(['x'], 'secret'));
    expect(info).toEqual({ filter: 'Standard', version: 1, revision: 2, lengthBits: null, cryptFilter: null });
    expect(describeEncryptionInfo(info)).toBe('Standard V1 R2');
  });

  it('reports an unencrypted PDF as such', () => {
    const info = describeEncryption(buildTestPdf(['x']));
    expect(info).toBeNull();
    expect(describeEncryptionInfo(info)).toBe('not encrypted');
  });

  it('reads an AES-256 dictionary like the ones banks produce', () => {
    const pdf = Buffer.from(
      '%PDF-1.7\n9 0 obj\n<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /CFM /AESV3 /Length 32 >> >> /O <00> /U <00> >>\nendobj\ntrailer\n<< /Encrypt 9 0 R >>\n',
      'latin1'
    );
    expect(describeEncryptionInfo(describeEncryption(pdf))).toBe('Standard V5 R6 AESV3 256');
  });
});

describe('passwordShape', () => {
  it('describes length and character classes without the value', () => {
    expect(passwordShape('ABCDE1234F')).toBe('10ch A9');
    expect(passwordShape('abcde1234f ')).toBe('11ch a9_');
    expect(passwordShape('Alic@0101')).toBe('9ch Aa9#');
  });
});
