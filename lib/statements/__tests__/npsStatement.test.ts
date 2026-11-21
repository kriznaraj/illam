import { describe, it, expect } from 'vitest';
import { parseNpsStatement } from '../npsStatement';

/*
 * Layout copied from the real Protean NPS statement captured on 2026-09-14, as
 * pdf.js extracts it — the scheme-wise table glued into digit runs, the summary
 * figures glued into one line. PRAN, units, NAVs and values are invented; the
 * arithmetic (units × NAV = value, Σ values = holdings) is kept exact because the
 * reader depends on it.
 */
const statement = (overrides: { values?: string; summary?: string } = {}) => `NPS TRANSACTION STATEMENT
Jul 01, 2026 To Jul 31, 2026
Statement Generation Date:August 04, 2026 05:22 AM
PRIDE disha CalculatorNPS Transaction Statement for Tier I Account
PRAN110012341404Registration Date16-May-23
Investment Summary
Value of your Holdings
(Investments) as on
Jul 31, 2026 (in Rs)
(A)
No of Contributions
Return on Investment
(XIRR)
8.06%
${overrides.summary ?? '1074076.2137800000.000.00274076.2188.50'}

Investment Details - Scheme Wise Summary
ParticularsReferences
Scheme wise Value of your
Holdings (Investments) (in Rs)
E=U*N
NAV as on 31-Jul-26N
Total UnitsU
NPS TRUST- A/C HDFC PENSION FUND
MANAGEMENT LIMITED SCHEME E - TIER
I POP
${overrides.values ?? '795988.55111828.49166259.17'}
15210.44713602.11855800.9054
52.331731.045228.6609

Changes made during the selected period
No change affected in this period.
31-Jul-26Closing Balance
15210.4471
3602.1185
5800.9054
`;

describe('parseNpsStatement', () => {
  it('reads the holdings value when units × NAV reproduce every scheme and the summary', () => {
    const parsed = parseNpsStatement(statement());
    expect(parsed.pranLast4).toBe('1404');
    expect(parsed.asOn).toBe('2026-07-31');
    expect(parsed.schemes).toHaveLength(3);
    expect(parsed.schemes[0]).toEqual({ units: 15210.4471, nav: 52.3317, value: 795988.55 });
    expect(parsed.total).toBe(1074076.21);
    expect(parsed.reconciled).toBe(true);
  });

  it('is not reconciled when a scheme value does not match its units × NAV', () => {
    const parsed = parseNpsStatement(statement({ values: '795988.55111828.49166299.17' }));
    expect(parsed.reconciled).toBe(false);
  });

  it('is not reconciled when the schemes do not add up to the summary', () => {
    const parsed = parseNpsStatement(statement({ summary: '1074976.2137800000.000.00274076.2188.50' }));
    expect(parsed.reconciled).toBe(false);
  });

  it('reads nothing from text that is not the expected layout', () => {
    const parsed = parseNpsStatement('NPS TRANSACTION STATEMENT\nnothing here');
    expect(parsed.total).toBeNull();
    expect(parsed.reconciled).toBe(false);
  });
});
