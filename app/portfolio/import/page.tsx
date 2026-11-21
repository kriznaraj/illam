'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import type { PortfolioAccount } from '@/types';
import { deriveSnapshotDate } from '@/lib/utils';
import type { ImportRow } from '@/lib/services/PortfolioCdslImportService';

const STEP = { CONVERT: 1, REVIEW: 2, IMPORT: 3 } as const;

/** Required CSV format. */
const CSV_FORMAT =
  'Name,Symbol,Identifier,Quantity,Unit Price,Value,Date,Account Type' as const;

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'security', 'instrument', 'scheme name'],
  symbol: ['symbol'],
  identifier: ['identifier', 'isin', 'id'],
  quantity: ['quantity', 'qty', 'units', 'closing bal', 'free bal'],
  unit_amount: ['unit price', 'market price', 'nav', 'ltp', 'price'],
  amount: ['value', 'amount', 'valuation', 'cur. val'],
  date: ['date', 'report date', 'month', 'period'],
  account_type: ['account type', 'type', 'asset type', 'category'],
};

type DetectedMapping = {
  name: number; symbol: number; identifier: number;
  quantity: number; unit_amount: number; amount: number;
  date: number; account_type: number;
};

function detectColumns(headers: string[]): { mapping: DetectedMapping; error?: string } {
  const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
  const idx: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const j = headers.findIndex((h) => {
      const n = norm(h);
      return n && aliases.some((a) => n === a || n.includes(a));
    });
    idx[field] = j >= 0 ? j : -1;
  }
  const mapping: DetectedMapping = {
    name: idx.name ?? -1,
    symbol: idx.symbol ?? -1,
    identifier: idx.identifier ?? -1,
    quantity: idx.quantity ?? -1,
    unit_amount: idx.unit_amount ?? -1,
    amount: idx.amount ?? -1,
    date: idx.date ?? -1,
    account_type: idx.account_type ?? -1,
  };
  if (mapping.name < 0) return { mapping, error: 'CSV must have a Name column.' };
  if (mapping.quantity < 0) return { mapping, error: 'CSV must have a Quantity column.' };
  if (mapping.amount < 0) return { mapping, error: 'CSV must have a Value column.' };
  if (mapping.date < 0) return { mapping, error: 'CSV must have a Date column (report period, e.g. "Dec 2025").' };
  if (mapping.account_type < 0) return { mapping, error: 'CSV must have an "Account Type" column with values "stock" or "mf".' };
  return { mapping };
}

function parseCSV(raw: string): { headers: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(raw, { skipEmptyLines: true });
  const rows = result.data?.filter((r) => r && r.some((c) => String(c).trim())) ?? [];
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  return { headers, rows: dataRows };
}

interface ImportResult {
  ok: boolean;
  snapshot_date?: string;
  rows_processed?: number;
  skipped_rows?: number;
  stock?: { account_id: string; rows_processed: number; holdings_created: number; holdings_updated: number; account_total: number } | null;
  mf?: { account_id: string; rows_processed: number; holdings_created: number; holdings_updated: number; account_total: number } | null;
  error?: string;
}

export default function ImportCdslPage() {
  const [step, setStep] = useState<typeof STEP[keyof typeof STEP]>(STEP.CONVERT);
  const [csvRaw, setCsvRaw] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [parseError, setParseError] = useState('');
  const [formatError, setFormatError] = useState('');
  const [convertingPdf, setConvertingPdf] = useState(false);
  const [stockAccountId, setStockAccountId] = useState('');
  const [mfAccountId, setMfAccountId] = useState('');
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const parseAndSetCsv = (text: string) => {
    setCsvRaw(text);
    try {
      const { headers: h, rows: r } = parseCSV(text);
      setHeaders(h);
      setRows(r);
      if (r.length === 0) setParseError('No data rows found.');
      else {
        const { error } = detectColumns(h);
        setFormatError(error ?? '');
      }
    } catch {
      setParseError('Could not parse CSV.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setFormatError('');

    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      setConvertingPdf(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/portfolio/convert-cdsl-pdf', {
          method: 'POST',
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data?.ok || !data?.csv) {
          setParseError(data?.error || 'Could not convert PDF.');
          return;
        }
        parseAndSetCsv(String(data.csv));
      } catch {
        setParseError('Could not convert PDF.');
      } finally {
        setConvertingPdf(false);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => parseAndSetCsv(String(reader.result ?? ''));
    reader.readAsText(file, 'UTF-8');
  };

  const handlePasteAndParse = () => {
    setParseError('');
    setFormatError('');
    if (!csvRaw.trim()) { setParseError('Paste CSV content first.'); return; }
    try {
      const { headers: h, rows: r } = parseCSV(csvRaw);
      setHeaders(h);
      setRows(r);
      if (r.length === 0) setParseError('No data rows found.');
      else {
        const { error } = detectColumns(h);
        setFormatError(error ?? '');
        if (!error) setStep(STEP.REVIEW);
      }
    } catch {
      setParseError('Could not parse CSV.');
    }
  };

  const handleConvertNext = () => {
    if (headers.length && rows.length && !formatError) { setStep(STEP.REVIEW); return; }
    if (!csvRaw.trim()) { setParseError('Upload a CSV file or paste CSV content.'); return; }
    handlePasteAndParse();
  };

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch('/api/portfolio/accounts?includeArchived=true');
      const data = await res.json();
      const arr: PortfolioAccount[] = Array.isArray(data) ? data : [];
      setAccounts(arr);
      setStockAccountId((prev) => {
        if (prev) return prev;
        return arr.find((a) => /stock/i.test(a.type))?.id ?? '';
      });
      setMfAccountId((prev) => {
        if (prev) return prev;
        return arr.find((a) => /mutual|mf/i.test(a.type))?.id ?? '';
      });
    } catch {
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === STEP.REVIEW) loadAccounts();
  }, [step, loadAccounts]);

  const { mapping: detectedMapping } = useMemo(() => detectColumns(headers), [headers]);

  const mappedRows = useMemo((): ImportRow[] => {
    const m = detectedMapping;
    if (m.name < 0 || m.quantity < 0 || m.amount < 0) return [];
    return rows.map((row) => {
      const get = (idx: number) => (idx >= 0 && idx < row.length ? row[idx].trim() : '');
      const num = (idx: number) => {
        const s = get(idx).replace(/,/g, '');
        const n = parseFloat(s);
        return Number.isNaN(n) ? 0 : n;
      };
      const name = get(m.name) || get(m.symbol) || '—';
      return {
        name,
        symbol: m.symbol >= 0 ? get(m.symbol) || null : null,
        identifier: m.identifier >= 0 ? get(m.identifier) || null : null,
        quantity: num(m.quantity),
        unit_amount: m.unit_amount >= 0 ? num(m.unit_amount) : null,
        amount: num(m.amount),
        date: m.date >= 0 ? get(m.date) || null : null,
        account_type: m.account_type >= 0 ? get(m.account_type).toLowerCase() || null : null,
      };
    }).filter((r) => r.name && r.name !== '—');
  }, [rows, detectedMapping]);

  // Derive snapshot date from the first row that has a date value
  const derivedSnapshotDate = useMemo(() => {
    const firstDate = mappedRows.find((r) => r.date)?.date ?? '';
    return firstDate ? deriveSnapshotDate(firstDate) : null;
  }, [mappedRows]);

  const stockRows = useMemo(() => mappedRows.filter((r) => r.account_type === 'stock'), [mappedRows]);
  const mfRows = useMemo(() => mappedRows.filter((r) => r.account_type === 'mf'), [mappedRows]);
  const unknownRows = useMemo(
    () => mappedRows.filter((r) => r.account_type !== 'stock' && r.account_type !== 'mf'),
    [mappedRows],
  );

  const canImport =
    !!derivedSnapshotDate &&
    mappedRows.length > 0 &&
    (stockRows.length === 0 || !!stockAccountId) &&
    (mfRows.length === 0 || !!mfAccountId);

  const runImport = async () => {
    if (!canImport) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/portfolio/import-cdsl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_account_id: stockAccountId || undefined,
          mf_account_id: mfAccountId || undefined,
          rows: mappedRows,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult({ ok: true, ...data });
      } else {
        setImportResult({ ok: false, error: data.error || 'Import failed' });
      }
    } catch {
      setImportResult({ ok: false, error: 'Request failed' });
    } finally {
      setImporting(false);
    }
  };

  const resetFlow = () => {
    setStep(STEP.CONVERT);
    setCsvRaw('');
    setHeaders([]);
    setRows([]);
    setParseError('');
    setFormatError('');
    setImportResult(null);
  };

  return (
    <PageContainer maxWidth="7xl">
      <Link href="/portfolio/settings" className="inline-block text-sm text-gray-500 hover:text-gray-700 mb-4">
        ← Settings
      </Link>
      <PageHeader
        title="Import from CDSL report"
        description="Prepare a single CSV with both stocks and mutual funds, then import into your accounts."
      />

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[STEP.CONVERT, STEP.REVIEW, STEP.IMPORT].map((s) => (
          <span
            key={s}
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              step === s ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {s === STEP.CONVERT && '1. Upload CSV'}
            {s === STEP.REVIEW && '2. Review & Configure'}
            {s === STEP.IMPORT && '3. Import'}
          </span>
        ))}
      </div>

      {/* ── Step 1: Upload CSV ── */}
      {step === STEP.CONVERT && (
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Upload your CSV</h2>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <p className="font-medium text-gray-700">Required CSV format:</p>
            <code className="block bg-white border border-gray-200 rounded px-3 py-2 text-xs text-gray-800 overflow-x-auto whitespace-nowrap">
              {CSV_FORMAT}
            </code>
            <ul className="text-gray-500 space-y-1 text-xs mt-2">
              <li>• <strong>Date</strong> — report month, e.g. <code>&quot;Dec 2025&quot;</code>. Snapshot date is set to the 1st of the <em>next</em> month automatically.</li>
              <li>• <strong>Account Type</strong> — <code>stock</code> or <code>mf</code> per row.</li>
              <li>• Name, Quantity, Value are required. Symbol, Identifier, Unit Price are optional.</li>
            </ul>
            <a
              href="/samples/cdsl-import-sample.csv"
              download
              className="inline-block text-indigo-600 hover:underline font-medium text-xs mt-1"
            >
              Download sample CSV
            </a>
          </div>

          <div>
            <label className="label">Upload CSV file</label>
            <input
              type="file"
              accept=".csv,.pdf,text/csv,text/plain,application/pdf"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-indigo-50 file:text-indigo-700"
            />
          </div>
          {convertingPdf && (
            <div className="pt-1">
              <LoadingSpinner message="Converting CDSL PDF to CSV…" />
            </div>
          )}
          <div>
            <label className="label">Or paste CSV content</label>
            <textarea
              className="input font-mono text-sm resize-y min-h-[120px] max-h-[40vh]"
              placeholder={`Name,Symbol,Identifier,Quantity,Unit Price,Value,Date,Account Type\nBajaj Auto,,INE917I01010,6,8500.00,51000.00,Dec 2025,stock`}
              value={csvRaw}
              onChange={(e) => setCsvRaw(e.target.value)}
              rows={5}
            />
          </div>

          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
          {formatError && <p className="text-sm text-red-600">{formatError}</p>}
          {headers.length > 0 && rows.length > 0 && !formatError && (
            <p className="text-sm text-green-600">✓ Parsed: {rows.length} rows across {headers.length} columns.</p>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={handleConvertNext}
              className="btn btn-primary"
              disabled={!!formatError}
            >
              Next: Review CSV
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Review & Configure ── */}
      {step === STEP.REVIEW && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Review & Configure</h2>

            {/* Derived date banner */}
            {derivedSnapshotDate ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
                <span className="text-green-700 font-medium">Snapshot date:</span>
                <span className="font-semibold text-green-900">{derivedSnapshotDate}</span>
                <span className="text-green-600 text-xs">
                  (derived from &ldquo;{mappedRows.find((r) => r.date)?.date}&rdquo; — 1st of next month)
                </span>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                Could not derive snapshot date. Check the Date column values.
              </div>
            )}

            {accountsLoading ? (
              <LoadingSpinner message="Loading accounts…" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Stock account */}
                <div>
                  <label className="label">
                    Stock account
                    {stockRows.length > 0 && (
                      <span className="ml-1 text-xs font-normal text-gray-500">({stockRows.length} rows)</span>
                    )}
                  </label>
                  <select
                    className={`select ${stockRows.length === 0 ? 'opacity-50' : ''}`}
                    value={stockAccountId}
                    onChange={(e) => setStockAccountId(e.target.value)}
                    disabled={stockRows.length === 0}
                  >
                    <option value="">
                      {stockRows.length === 0 ? 'No stock rows in CSV' : 'Select stock account'}
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                    ))}
                  </select>
                  {stockRows.length > 0 && !stockAccountId && (
                    <p className="text-xs text-amber-600 mt-1">Select an account for stock rows.</p>
                  )}
                </div>

                {/* MF account */}
                <div>
                  <label className="label">
                    Mutual fund account
                    {mfRows.length > 0 && (
                      <span className="ml-1 text-xs font-normal text-gray-500">({mfRows.length} rows)</span>
                    )}
                  </label>
                  <select
                    className={`select ${mfRows.length === 0 ? 'opacity-50' : ''}`}
                    value={mfAccountId}
                    onChange={(e) => setMfAccountId(e.target.value)}
                    disabled={mfRows.length === 0}
                  >
                    <option value="">
                      {mfRows.length === 0 ? 'No MF rows in CSV' : 'Select MF account'}
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                    ))}
                  </select>
                  {mfRows.length > 0 && !mfAccountId && (
                    <p className="text-xs text-amber-600 mt-1">Select an account for MF rows.</p>
                  )}
                </div>
              </div>
            )}

            {unknownRows.length > 0 && (
              <p className="text-xs text-amber-600">
                ⚠ {unknownRows.length} row(s) have an unrecognised account_type and will be skipped.
              </p>
            )}

            {/* Preview table */}
            <div>
              <p className="text-sm text-gray-500 mb-2">Preview ({mappedRows.length} rows):</p>
              <div className="overflow-x-auto max-h-72 border border-gray-200 rounded-lg">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Type</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-600">Name</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">Qty</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">Unit price</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-600">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 30).map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-1.5 px-2">
                          {r.account_type === 'stock' && (
                            <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-medium">stock</span>
                          )}
                          {r.account_type === 'mf' && (
                            <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium">mf</span>
                          )}
                          {r.account_type !== 'stock' && r.account_type !== 'mf' && (
                            <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px]">?</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 max-w-[200px] truncate">{r.name}</td>
                        <td className="py-1.5 px-2 text-right">{r.quantity}</td>
                        <td className="py-1.5 px-2 text-right">{r.unit_amount ?? '—'}</td>
                        <td className="py-1.5 px-2 text-right font-medium">{r.amount.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mappedRows.length > 30 && (
                <p className="text-xs text-gray-500 mt-1">… and {mappedRows.length - 30} more rows</p>
              )}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(STEP.CONVERT)} className="btn btn-secondary">
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(STEP.IMPORT)}
                disabled={!canImport}
                className="btn btn-primary"
              >
                Next: Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Import ── */}
      {step === STEP.IMPORT && (
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Import</h2>

          {!importResult && (
            <>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Snapshot date:</span>
                  <span className="font-semibold text-gray-900">{derivedSnapshotDate}</span>
                </div>
                {stockRows.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">stock</span>
                    <span className="text-gray-600">{stockRows.length} rows →</span>
                    <span className="font-medium">{accounts.find((a) => a.id === stockAccountId)?.name}</span>
                  </div>
                )}
                {mfRows.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">mf</span>
                    <span className="text-gray-600">{mfRows.length} rows →</span>
                    <span className="font-medium">{accounts.find((a) => a.id === mfAccountId)?.name}</span>
                  </div>
                )}
                {unknownRows.length > 0 && (
                  <p className="text-xs text-amber-600">⚠ {unknownRows.length} row(s) will be skipped (unknown type)</p>
                )}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(STEP.REVIEW)} className="btn btn-secondary">
                  Back
                </button>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={importing || !canImport}
                  className="btn btn-primary"
                >
                  {importing ? 'Importing…' : `Run import (${mappedRows.length - unknownRows.length} rows)`}
                </button>
              </div>
            </>
          )}

          {importResult && (
            <div className={`rounded-lg p-4 space-y-3 ${importResult.ok ? 'bg-green-50' : 'bg-red-50'}`}>
              {importResult.ok ? (
                <>
                  <p className="font-semibold text-green-800">Import completed for {importResult.snapshot_date}</p>
                  <div className="space-y-3">
                    {importResult.stock && (
                      <div className="bg-white rounded-lg px-4 py-3 border border-green-200 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">stock</span>
                          <span className="font-medium text-gray-900">
                            {accounts.find((a) => a.id === importResult.stock?.account_id)?.name}
                          </span>
                        </div>
                        <ul className="text-green-700 text-xs space-y-0.5 list-disc list-inside">
                          <li>{importResult.stock.rows_processed} rows processed</li>
                          <li>{importResult.stock.holdings_created} new instruments created</li>
                          <li>{importResult.stock.holdings_updated} instruments updated</li>
                          <li>Account total: ₹{importResult.stock.account_total.toLocaleString('en-IN')}</li>
                        </ul>
                        <Link href={`/portfolio/accounts/${importResult.stock.account_id}`} className="inline-block mt-2 text-xs font-medium text-green-700 hover:underline">
                          View account →
                        </Link>
                      </div>
                    )}
                    {importResult.mf && (
                      <div className="bg-white rounded-lg px-4 py-3 border border-green-200 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">mf</span>
                          <span className="font-medium text-gray-900">
                            {accounts.find((a) => a.id === importResult.mf?.account_id)?.name}
                          </span>
                        </div>
                        <ul className="text-green-700 text-xs space-y-0.5 list-disc list-inside">
                          <li>{importResult.mf.rows_processed} rows processed</li>
                          <li>{importResult.mf.holdings_created} new instruments created</li>
                          <li>{importResult.mf.holdings_updated} instruments updated</li>
                          <li>Account total: ₹{importResult.mf.account_total.toLocaleString('en-IN')}</li>
                        </ul>
                        <Link href={`/portfolio/accounts/${importResult.mf.account_id}`} className="inline-block mt-2 text-xs font-medium text-green-700 hover:underline">
                          View account →
                        </Link>
                      </div>
                    )}
                    {(importResult.skipped_rows ?? 0) > 0 && (
                      <p className="text-xs text-amber-700">{importResult.skipped_rows} row(s) skipped (unrecognised account type).</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-red-800">{importResult.error}</p>
              )}
              <button type="button" onClick={resetFlow} className="btn btn-secondary mt-2">
                Import another file
              </button>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
