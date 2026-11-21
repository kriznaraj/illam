declare module 'pdf-parse' {
  export type PdfParseResult = {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  };

  export type PdfParseOptions = {
    pagerender?: (pageData: unknown) => string | Promise<string>;
    max?: number;
    version?: string;
  };

  const pdfParse: (
    dataBuffer: Buffer,
    options?: PdfParseOptions,
  ) => Promise<PdfParseResult>;

  export default pdfParse;
}

