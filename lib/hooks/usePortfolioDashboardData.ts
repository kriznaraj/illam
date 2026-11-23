'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PortfolioAccount, PortfolioSnapshot } from '@/types';
import type { PortfolioDashboardReport } from '@/lib/portfolio/dashboardCalculations';

export type PortfolioDashboardErrorKind = 'setup' | 'load' | null;

const REPORT_MONTHS_FOR_TREND = 24;

const looksLikeMissingPortfolioTables = (payload: unknown): boolean => {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const value = raw.toLowerCase();
  return (
    value.includes('005_create_portfolio_tables') ||
    value.includes('portfolio tables not found') ||
    (value.includes('portfolio_accounts') &&
      (value.includes('does not exist') || value.includes('relation') || value.includes('42p01'))) ||
    (value.includes('portfolio_snapshots') &&
      (value.includes('does not exist') || value.includes('relation') || value.includes('42p01')))
  );
};

const extractApiErrorMessage = (payload: unknown): string => {
  if (payload == null) return 'Unknown error';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object') {
    const maybePayload = payload as {
      error?: unknown;
      message?: unknown;
      details?: unknown;
    };

    if (typeof maybePayload.error === 'string' && maybePayload.error.trim()) return maybePayload.error;
    if (maybePayload.error && typeof maybePayload.error === 'object') {
      const nestedMessage = (maybePayload.error as { message?: unknown }).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage;
    }
    if (typeof maybePayload.message === 'string' && maybePayload.message.trim()) return maybePayload.message;
    if (typeof maybePayload.details === 'string' && maybePayload.details.trim()) return maybePayload.details;
    return JSON.stringify(payload);
  }

  return String(payload);
};

const readJsonSafely = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

interface UsePortfolioDashboardDataResult {
  loading: boolean;
  error: string | null;
  errorKind: PortfolioDashboardErrorKind;
  rawAccounts: PortfolioAccount[] | null;
  rawSnapshots: PortfolioSnapshot[] | null;
  rawReport: PortfolioDashboardReport | null;
  refetch: () => Promise<void>;
}

export function usePortfolioDashboardData(): UsePortfolioDashboardDataResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<PortfolioDashboardErrorKind>(null);
  const [rawAccounts, setRawAccounts] = useState<PortfolioAccount[] | null>(null);
  const [rawSnapshots, setRawSnapshots] = useState<PortfolioSnapshot[] | null>(null);
  const [rawReport, setRawReport] = useState<PortfolioDashboardReport | null>(null);

  const resetData = useCallback(() => {
    setRawAccounts(null);
    setRawSnapshots(null);
    setRawReport(null);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accountsResponse, snapshotsResponse, reportResponse] = await Promise.all([
        fetch('/api/portfolio/accounts', { cache: 'no-store' }),
        fetch('/api/portfolio/snapshots'),
        fetch(`/api/portfolio/report?months=${REPORT_MONTHS_FOR_TREND}`),
      ]);

      const accountsPayload = await readJsonSafely(accountsResponse);
      const snapshotsPayload = await readJsonSafely(snapshotsResponse);
      const reportPayload = reportResponse.ok ? await readJsonSafely(reportResponse) : null;

      if (!accountsResponse.ok || !snapshotsResponse.ok) {
        const combined = { accounts: accountsPayload, snapshots: snapshotsPayload };
        const message = extractApiErrorMessage(!accountsResponse.ok ? accountsPayload : snapshotsPayload);
        if (looksLikeMissingPortfolioTables(combined) || looksLikeMissingPortfolioTables(message)) {
          setErrorKind('setup');
          setError('Portfolio tables not found. Check that the database migrations ran (docker compose logs migrate).');
        } else {
          setErrorKind('load');
          setError(`Failed to load portfolio data. ${message}`);
        }
        resetData();
        return;
      }

      if (!Array.isArray(accountsPayload) || !Array.isArray(snapshotsPayload)) {
        const combined = { accounts: accountsPayload, snapshots: snapshotsPayload };
        if (looksLikeMissingPortfolioTables(combined)) {
          setErrorKind('setup');
          setError('Portfolio tables not found. Check that the database migrations ran (docker compose logs migrate).');
        } else {
          setErrorKind('load');
          setError(`Failed to load portfolio data. ${extractApiErrorMessage(combined)}`);
        }
        resetData();
        return;
      }

      setError(null);
      setErrorKind(null);
      setRawAccounts(accountsPayload as PortfolioAccount[]);
      setRawSnapshots(snapshotsPayload as PortfolioSnapshot[]);
      setRawReport((reportPayload as PortfolioDashboardReport | null) ?? null);
    } catch (err) {
      console.error('Failed to fetch portfolio data:', err);
      setErrorKind('load');
      setError(err instanceof Error ? err.message : 'Failed to load portfolio data');
      resetData();
    } finally {
      setLoading(false);
    }
  }, [resetData]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    loading,
    error,
    errorKind,
    rawAccounts,
    rawSnapshots,
    rawReport,
    refetch: fetchData,
  };
}
