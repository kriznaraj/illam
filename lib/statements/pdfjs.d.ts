// pdf-parse bundles pdf.js builds without type declarations. lib/statements/pdfText.ts
// types the small part it uses.
declare module 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js' {
  const pdfjs: unknown;
  export default pdfjs;
}
