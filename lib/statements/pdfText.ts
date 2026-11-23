import pdfjsModule from 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js';

/**
 * Text out of a statement PDF, unlocking it when it is password-protected.
 *
 * Two readers, tried in order:
 *  1. the pdf.js 1.10 build bundled inside pdf-parse — also used by
 *     /api/portfolio/convert-cdsl-pdf, and enough for many files;
 *  2. a current pdf.js via unpdf, whenever the first reports locked or fails.
 *
 * The fallback exists because the bundled build cannot open some AES (R4/R5)
 * files, such as the CDSL CAS, even with the right password, while RC4 and
 * AES-256 files open fine. Each candidate is also tried in
 * upper and lower case, since "PAN" rules rarely say which.
 */

interface TextItem {
  str: string;
  transform: number[];
}

interface PdfPage {
  getTextContent(): Promise<{ items: TextItem[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy?(): void;
}

interface PdfJs {
  disableWorker?: boolean;
  verbosity?: number;
  getDocument(source: { data: Uint8Array; password?: string }): PromiseLike<PdfDocument> & { promise?: Promise<PdfDocument> };
}

const legacyPdfjs = pdfjsModule as PdfJs;
legacyPdfjs.disableWorker = true;
legacyPdfjs.verbosity = 0;

export const MAX_PAGES = 60;

export type PdfEngine = 'pdfjs-1.10' | 'pdfjs-current';

export type PdfTextResult =
  | { status: 'ok'; text: string; pageCount: number; passwordUsed: boolean; engine: PdfEngine }
  /** `readerErrors`: a reader that failed outright rather than rejecting the password — hidden behind "locked" otherwise. */
  | { status: 'locked'; reason: 'password_required' | 'password_incorrect'; readerErrors?: string[] }
  | { status: 'failed'; error: string };

type Attempt = { status: 'ok'; text: string; pageCount: number } | { status: 'locked' } | { status: 'failed'; error: string };

function isPasswordError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'PasswordException';
}

/** Each configured password as given, then upper- and lower-cased; duplicates dropped. */
export function passwordVariants(passwords: readonly string[]): string[] {
  const variants = passwords.filter((p) => p.length > 0).flatMap((p) => [p, p.toUpperCase(), p.toLowerCase()]);
  return [...new Set(variants)];
}

async function readText(doc: PdfDocument, maxPages: number): Promise<string> {
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    // Same line-joining as pdf-parse: a new line whenever the baseline moves.
    let lastY: number | undefined;
    let text = '';
    for (const item of content.items) {
      const y = item.transform[5];
      text += lastY === undefined || y === lastY ? item.str : `\n${item.str}`;
      lastY = y;
    }
    pages.push(text);
  }
  return pages.join('\n\n');
}

async function openWithLegacy(bytes: Uint8Array, password: string | undefined, maxPages: number): Promise<Attempt> {
  let doc: PdfDocument | undefined;
  try {
    // pdf.js may take ownership of the buffer, so every attempt gets its own copy.
    const task = legacyPdfjs.getDocument({ data: new Uint8Array(bytes), ...(password !== undefined ? { password } : {}) });
    doc = await (task.promise ?? task);
    return { status: 'ok', text: await readText(doc, maxPages), pageCount: doc.numPages };
  } catch (error) {
    if (isPasswordError(error)) return { status: 'locked' };
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  } finally {
    doc?.destroy?.();
  }
}

export async function openWithCurrent(bytes: Uint8Array, password: string | undefined, maxPages: number): Promise<Attempt> {
  let doc: PdfDocument | undefined;
  try {
    const { getDocumentProxy } = await import('unpdf');
    doc = (await getDocumentProxy(new Uint8Array(bytes), password !== undefined ? { password } : {})) as unknown as PdfDocument;
    return { status: 'ok', text: await readText(doc, maxPages), pageCount: doc.numPages };
  } catch (error) {
    if (isPasswordError(error)) return { status: 'locked' };
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Cleanup must never turn a result into a throw.
    try {
      if (doc && typeof doc.destroy === 'function') await Promise.resolve(doc.destroy());
    } catch {
      // ignore
    }
  }
}

const ENGINES: { engine: PdfEngine; open: typeof openWithLegacy }[] = [
  { engine: 'pdfjs-1.10', open: openWithLegacy },
  { engine: 'pdfjs-current', open: openWithCurrent },
];

/**
 * Tries no password first (many statements are unprotected, and an owner-only
 * password needs none), then each candidate variant — on each reader in turn.
 * Never throws, and never reveals which candidate worked.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  passwords: readonly string[] = [],
  options: { maxPages?: number } = {}
): Promise<PdfTextResult> {
  const maxPages = options.maxPages ?? MAX_PAGES;
  const attempts: (string | undefined)[] = [undefined, ...passwordVariants(passwords)];
  let sawLock = false;
  const failures: string[] = [];

  for (const { engine, open } of ENGINES) {
    for (const password of attempts) {
      const result = await open(bytes, password, maxPages);
      if (result.status === 'ok') {
        return { status: 'ok', text: result.text, pageCount: result.pageCount, passwordUsed: password !== undefined, engine };
      }
      if (result.status === 'locked') {
        sawLock = true;
        continue;
      }
      // Not a password problem, so the other candidates will not help on this reader.
      failures.push(`${engine}: ${result.error}`);
      break;
    }
  }

  if (sawLock) {
    return {
      status: 'locked',
      reason: passwords.length > 0 ? 'password_incorrect' : 'password_required',
      ...(failures.length > 0 ? { readerErrors: failures } : {}),
    };
  }
  return { status: 'failed', error: failures.join('; ') || 'unreadable PDF' };
}
