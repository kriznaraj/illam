/**
 * Why a statement will not open, without revealing anything secret.
 *
 * A statement can come back locked even with its password configured. That
 * leaves two explanations: the configured value does not match (case, spacing), or the
 * PDF uses an encryption handler the reader cannot open. These helpers record
 * enough to tell them apart: the PDF's encryption dictionary (algorithm and
 * revision, never the O/U hashes) and the shape of each candidate password
 * (length and character classes, never the value).
 */

export interface EncryptionInfo {
  filter: string | null;
  version: number | null;
  revision: number | null;
  lengthBits: number | null;
  cryptFilter: string | null;
}

function readName(dict: string, key: string): string | null {
  return dict.match(new RegExp(`/${key}\\s*/([A-Za-z0-9]+)`))?.[1] ?? null;
}

function readNumber(dict: string, key: string): number | null {
  const value = dict.match(new RegExp(`/${key}\\s+(\\d+)`))?.[1];
  return value ? Number(value) : null;
}

/** The Standard security handler parameters, or null for an unencrypted file. */
export function describeEncryption(bytes: Uint8Array): EncryptionInfo | null {
  const pdf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const reference = pdf.match(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/);
  if (!reference) return null;

  const objectStart = pdf.search(new RegExp(`(?:^|[^0-9])${reference[1]}\\s+${reference[2]}\\s+obj`));
  if (objectStart < 0) return { filter: null, version: null, revision: null, lengthBits: null, cryptFilter: null };
  const objectEnd = pdf.indexOf('endobj', objectStart);
  const dict = pdf.slice(objectStart, objectEnd < 0 ? objectStart + 2000 : objectEnd);

  return {
    filter: readName(dict, 'Filter'),
    version: readNumber(dict, 'V'),
    revision: readNumber(dict, 'R'),
    lengthBits: readNumber(dict, 'Length'),
    cryptFilter: readName(dict, 'CFM'),
  };
}

/**
 * Whether the file arrived whole: its size, the %%EOF marker, and the trailer
 * /ID. A truncated PDF can lose its /ID, and revisions 2–4 derive the key from
 * it — the right password would then be reported incorrect.
 */
export function describeIntegrity(bytes: Uint8Array): string {
  const pdf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const tail = pdf.slice(-2048);
  return [
    `${bytes.byteLength}b`,
    pdf.startsWith('%PDF-') ? pdf.slice(0, 8) : 'no %PDF header',
    tail.includes('%%EOF') ? 'EOF' : 'no EOF',
    /\/ID\s*\[/.test(pdf) ? 'ID' : 'no ID',
  ].join(' ');
}

/** "10ch A9" — length plus which character classes appear (A upper, a lower, 9 digit, # other, _ space). */
export function passwordShape(password: string): string {
  const classes = [
    /[A-Z]/.test(password) ? 'A' : '',
    /[a-z]/.test(password) ? 'a' : '',
    /[0-9]/.test(password) ? '9' : '',
    /[^A-Za-z0-9\s]/.test(password) ? '#' : '',
    /\s/.test(password) ? '_' : '',
  ].join('');
  return `${password.length}ch ${classes}`;
}

export function describeEncryptionInfo(info: EncryptionInfo | null): string {
  if (!info) return 'not encrypted';
  const parts = [
    info.filter ?? '?',
    info.version !== null ? `V${info.version}` : null,
    info.revision !== null ? `R${info.revision}` : null,
    info.cryptFilter,
    info.lengthBits !== null ? `${info.lengthBits}` : null,
  ];
  return parts.filter(Boolean).join(' ');
}
