import { describe, it, expect } from 'vitest';
import { parseCdslCas } from '../cdslCas';

/*
 * Layout copied from the real CDSL CAS captured on 2026-09-14, as pdf.js extracts
 * it — glued cells, wrapped names, a soft-hyphen-split ISIN, page noise. Every
 * security, ISIN, folio and amount is invented; the arithmetic is kept exact
 * because the reader depends on it.
 */

const SUMMARY = `Consolidated Portfolio for Accounts for the Month
Asset ClassValuePercentage
Equity
65,054.1011.32
Mutual Fund Folios
2,74,220.6947.73
Mutual Funds Held in Demat Form
14,707.842.56
Others
2,20,576.0038.39
Total
5,74,558.63100.00`;

const DEMAT = `No Transaction during the period
HOLDING STATEMENT AS ON 30-06-202630-06-2026
ISINSecurity
Current
Bal
Free Bal
Market
Price /
Face
Value
Value (\`)
INE000A01011
TEST MOTORS LIMITED - EQUITY
SHARES
6.000------6.00010842.350065,054.10
IN0020200999
GOVT OF INDIA#2.5% SGB
2020-21 SERIES IX 2029-LOAN
CODE 29848 - RED DT
05.01.2029
16.000------16.00013786.00002,20,576.00
Page 6 of 13
INF000K01AA1
TEST AMC LTD # TEST MF-NIFTY 50
INDEX FUND DIRECT
PLAN GROWTH
85.747------85.747171.526014,707.84
Portfolio Value \` 3,00,337.94 as on 30-06-2026`;

const FOLIOS = `MUTUAL FUND UNITS HELD AS ON 30-06-202630-06-2026
Scheme NameISINFolio No.
Closing
Bal
(Units)
Invested (in
INR)
Valuation (\`)
Unrealised
Profit/Loss
Unreali­
sed
Profit/
Loss(%)
MCDG - Test Mid Cap
Fund - Direct Growth
INF000K01EH34402718/01187.452142.671,21,162.861,69,413.7848,250.9239.82
123D - Test Midcap
Fund-  Direct Plan -
Growth
INF000K01L­
T0
1234567438.6161.27448,848.4370,734.7821,886.3544.80
TPDG - Test ELSS
Tax Saver Fund -
Direct Plan - Growth
INF000L019863307/076448.317540,000.0034,072.13-5,927.87-14.82
Grand Total2,10,011.292,74,220.69`;

const CAS = [SUMMARY, DEMAT, FOLIOS].join('\n');

describe('parseCdslCas', () => {
  it('reads the as-on date and the statement’s own totals', () => {
    expect(parseCdslCas(CAS)).toMatchObject({
      asOn: '2026-06-30',
      summary: { demat: 300337.94, equity: 65054.1, mfFolios: 274220.69, mfDemat: 14707.84, others: 220576, total: 574558.63 },
    });
  });

  it('reads demat holdings — shares, SGBs and fund units held in demat — with wrapped names', () => {
    expect(parseCdslCas(CAS).demat).toEqual([
      { isin: 'INE000A01011', name: 'TEST MOTORS LIMITED - EQUITY SHARES', quantity: 6, price: 10842.35, value: 65054.1 },
      {
        isin: 'IN0020200999',
        name: 'GOVT OF INDIA#2.5% SGB 2020-21 SERIES IX 2029-LOAN CODE 29848 - RED DT 05.01.2029',
        quantity: 16,
        price: 13786,
        value: 220576,
      },
      { isin: 'INF000K01AA1', name: 'TEST AMC LTD # TEST MF-NIFTY 50 INDEX FUND DIRECT PLAN GROWTH', quantity: 85.747, price: 171.526, value: 14707.84 },
    ]);
  });

  it('splits glued folio rows by arithmetic: a wrapped ISIN, a whole unit balance printed with no point, and a loss', () => {
    expect(parseCdslCas(CAS).folios).toEqual([
      { isin: 'INF000K01EH3', name: 'MCDG - Test Mid Cap Fund - Direct Growth', units: 1187.452, nav: 142.67, invested: 121162.86, value: 169413.78 },
      { isin: 'INF000K01LT0', name: '123D - Test Midcap Fund- Direct Plan - Growth', units: 438.6, nav: 161.274, invested: 48848.43, value: 70734.78 },
      { isin: 'INF000L01986', name: 'TPDG - Test ELSS Tax Saver Fund - Direct Plan - Growth', units: 76, nav: 448.3175, invested: 40000, value: 34072.13 },
    ]);
  });

  it('reconciles when every row is read', () => {
    expect(parseCdslCas(CAS)).toMatchObject({ unreadRows: 0, reconciled: { demat: true, folios: true } });
  });

  it('counts a row whose arithmetic does not hold, and then does not reconcile', () => {
    const broken = CAS.replace('76448.317540,000.00', '76458.317540,000.00').replace('6.00010842.3500', '6.00010942.3500');
    const parsed = parseCdslCas(broken);

    expect(parsed.folios).toHaveLength(2);
    expect(parsed.demat).toHaveLength(2);
    expect(parsed).toMatchObject({ unreadRows: 2, reconciled: { demat: false, folios: false } });
  });

  it('reconciles a statement with no mutual fund folios against nothing', () => {
    const dematOnly = [SUMMARY.replace(/Mutual Fund Folios\n[^\n]+\n/, ''), DEMAT].join('\n');
    expect(parseCdslCas(dematOnly)).toMatchObject({ folios: [], reconciled: { demat: true, folios: true } });
  });

  it('reads a folio whose NAV prints with its trailing zero trimmed (170.0)', () => {
    const text = [
      'MUTUAL FUND UNITS HELD AS ON 30-06-2026',
      'Loss(%)',
      '8275 - Test Bluechip Fund - Direct Plan - Growth',
      'INF000K01Z415196/421021.656170.01,51,000.001,73,681.5222,681.5215.02',
      'Grand Total1,51,000.001,73,681.52',
    ].join('\n');
    expect(parseCdslCas(text).folios).toEqual([
      { isin: 'INF000K01Z41', name: '8275 - Test Bluechip Fund - Direct Plan - Growth', units: 1021.656, nav: 170.0, invested: 151000, value: 173681.52 },
    ]);
  });

  it('returns empty, unreconciled results for text that is not a CAS', () => {
    expect(parseCdslCas('nothing useful here')).toEqual({
      asOn: null,
      demat: [],
      folios: [],
      summary: { demat: null, equity: null, mfFolios: null, mfDemat: null, others: null, total: null },
      unreadRows: 0,
      reconciled: { demat: false, folios: false },
    });
  });
});
