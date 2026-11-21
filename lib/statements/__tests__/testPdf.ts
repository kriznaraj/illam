import { createCipheriv, createHash, randomBytes } from 'crypto';

/**
 * Builds a tiny one-page PDF, optionally protected with a user password
 * (Standard security handler, RC4 40-bit, revision 2), so the unlock path is
 * tested against a genuinely encrypted file rather than a mock of pdf.js.
 * Real bank statements use stronger handlers; pdf.js treats them the same way
 * from the caller's side.
 */

const PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (...parts: Buffer[]) => createHash('md5').update(Buffer.concat(parts)).digest();

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const pad = (password: string) => Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(0, 32);

export function buildTestPdf(lines: string[], userPassword?: string): Buffer {
  const content = Buffer.from(
    ['BT', '/F1 12 Tf', '72 720 Td', '14 TL', ...lines.map((line, i) => `${i ? 'T* ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`), 'ET'].join('\n'),
    'latin1'
  );

  const id = md5(Buffer.from('illam-test'));
  const permissions = Buffer.from([0xfc, 0xff, 0xff, 0xff]); // P = -4
  let key: Buffer | null = null;
  let ownerEntry: Buffer | null = null;
  let userEntry: Buffer | null = null;

  if (userPassword !== undefined) {
    ownerEntry = rc4(md5(pad('owner-secret')).subarray(0, 5), pad(userPassword));
    key = md5(pad(userPassword), ownerEntry, permissions, id).subarray(0, 5);
    userEntry = rc4(key, PADDING);
  }

  const objectKey = (num: number) => md5(key as Buffer, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10);
  const stream = key ? rc4(objectKey(4), content) : content;

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  if (key && ownerEntry && userEntry) {
    objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${ownerEntry.toString('hex')}> /U <${userEntry.toString('hex')}> /P -4 >>`));
  }

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let size = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(size);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    chunks.push(object);
    size += object.length;
  });

  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  const encryption = key ? ` /Encrypt ${objects.length} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>]` : '';
  chunks.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryption} >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

/**
 * Algorithm 2.B (ISO 32000-2): the iterated SHA-256/384/512 hash used by
 * revision 6 (AES-256) security handlers.
 */
function hashR6(password: Buffer, salt: Buffer, userData: Buffer): Buffer {
  let k = createHash('sha256').update(Buffer.concat([password, salt, userData])).digest();
  for (let round = 0; ; round++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([password, k, userData])));
    const cipher = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    const e = Buffer.concat([cipher.update(k1), cipher.final()]);
    const mod = e.subarray(0, 16).reduce((sum, byte) => sum + byte, 0) % 3;
    k = createHash(['sha256', 'sha384', 'sha512'][mod]).update(e).digest();
    // Spec: at least 64 rounds, then stop once the last byte of E <= (rounds done) - 32.
    if (round >= 63 && e[e.length - 1] <= round + 1 - 32) break;
  }
  return k.subarray(0, 32);
}

const aes256NoPad = (key: Buffer, data: Buffer) => {
  const cipher = createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
};

/**
 * A one-page PDF protected the way bank statements are: Standard handler V5 R6,
 * AESV3 (AES-256). Proves the reader opens modern encryption, not only RC4.
 */
export function buildAes256TestPdf(lines: string[], userPassword: string): Buffer {
  const content = Buffer.from(
    ['BT', '/F1 12 Tf', '72 720 Td', '14 TL', ...lines.map((line, i) => `${i ? 'T* ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`), 'ET'].join('\n'),
    'latin1'
  );

  const fileKey = randomBytes(32);
  const user = Buffer.from(userPassword, 'utf8');
  const owner = Buffer.from('owner-secret', 'utf8');

  const userValidationSalt = randomBytes(8);
  const userKeySalt = randomBytes(8);
  const U = Buffer.concat([hashR6(user, userValidationSalt, Buffer.alloc(0)), userValidationSalt, userKeySalt]);
  const UE = aes256NoPad(hashR6(user, userKeySalt, Buffer.alloc(0)), fileKey);

  const ownerValidationSalt = randomBytes(8);
  const ownerKeySalt = randomBytes(8);
  const O = Buffer.concat([hashR6(owner, ownerValidationSalt, U), ownerValidationSalt, ownerKeySalt]);
  const OE = aes256NoPad(hashR6(owner, ownerKeySalt, U), fileKey);

  const permsPlain = Buffer.concat([Buffer.from([0xfc, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), Buffer.from('Tadb'), randomBytes(4)]);
  const permsCipher = createCipheriv('aes-256-ecb', fileKey, null);
  permsCipher.setAutoPadding(false);
  const Perms = Buffer.concat([permsCipher.update(permsPlain), permsCipher.final()]);

  const iv = randomBytes(16);
  const streamCipher = createCipheriv('aes-256-cbc', fileKey, iv);
  const stream = Buffer.concat([iv, streamCipher.update(content), streamCipher.final()]);

  const hex = (b: Buffer) => b.toString('hex');
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from(
      `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF ` +
        `/O <${hex(O)}> /U <${hex(U)}> /OE <${hex(OE)}> /UE <${hex(UE)}> /P -4 /Perms <${hex(Perms)}> >>`
    ),
  ];

  const id = randomBytes(16).toString('hex');
  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n')];
  const offsets: number[] = [];
  let size = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(size);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    chunks.push(object);
    size += object.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  chunks.push(
    Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt ${objects.length} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${size}\n%%EOF\n`)
  );
  return Buffer.concat(chunks);
}

/**
 * Revision 3 (RC4-128) and revision 4 (AES-128, AESV2) — what the live HDFC,
 * Axis and CDSL statements use (2026-09-14). Algorithms 2, 3 and 5 of the PDF
 * 1.7 spec, with the 50 MD5 rounds and 19 RC4 passes revision 3+ adds.
 */
export function buildRevision3Or4TestPdf(lines: string[], userPassword: string, revision: 3 | 4): Buffer {
  const content = Buffer.from(
    ['BT', '/F1 12 Tf', '72 720 Td', '14 TL', ...lines.map((line, i) => `${i ? 'T* ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`), 'ET'].join('\n'),
    'latin1'
  );
  const n = 16;
  const id = md5(Buffer.from(`illam-r${revision}`));
  const permissions = Buffer.from([0xfc, 0xff, 0xff, 0xff]);

  // Algorithm 3: the O entry.
  let ownerHash = md5(pad('owner-secret'));
  for (let i = 0; i < 50; i++) ownerHash = md5(ownerHash.subarray(0, n));
  const ownerKey = ownerHash.subarray(0, n);
  let O = rc4(ownerKey, pad(userPassword));
  for (let i = 1; i <= 19; i++) O = rc4(Buffer.from(ownerKey.map((b) => b ^ i)), O);

  // Algorithm 2: the file key.
  let keyHash = md5(pad(userPassword), O, permissions, id);
  for (let i = 0; i < 50; i++) keyHash = md5(keyHash.subarray(0, n));
  const key = keyHash.subarray(0, n);

  // Algorithm 5: the U entry.
  let U = rc4(key, md5(PADDING, id));
  for (let i = 1; i <= 19; i++) U = rc4(Buffer.from(key.map((b) => b ^ i)), U);
  U = Buffer.concat([U, Buffer.alloc(16)]);

  const objectNumber = 4;
  const objectBytes = Buffer.from([objectNumber & 255, (objectNumber >> 8) & 255, (objectNumber >> 16) & 255, 0, 0]);
  let stream: Buffer;
  if (revision === 3) {
    stream = rc4(md5(key, objectBytes).subarray(0, 16), content);
  } else {
    const objectKey = md5(key, objectBytes, Buffer.from('sAlT')).subarray(0, 16);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-128-cbc', objectKey, iv);
    stream = Buffer.concat([iv, cipher.update(content), cipher.final()]);
  }

  const encrypt =
    revision === 3
      ? `<< /Filter /Standard /V 2 /R 3 /Length 128 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P -4 >>`
      : `<< /Filter /Standard /V 4 /R 4 /Length 128 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P -4 >>`;

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from(encrypt),
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.6\n')];
  const offsets: number[] = [];
  let size = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(size);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    chunks.push(object);
    size += object.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  chunks.push(
    Buffer.from(
      `${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt ${objects.length} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${size}\n%%EOF\n`
    )
  );
  return Buffer.concat(chunks);
}
