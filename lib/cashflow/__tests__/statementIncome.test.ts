import { describe, expect, it } from 'vitest';
import { readIncomeLine, statementRefs } from '../statementIncome';
import type { StatementLine } from '@/lib/statements/accountStatements';

const credit = (narration: string) => ({ narration, direction: 'credit' as const });

// Narrations as the June/July 2026 HDFC and Kotak statements printed them (masked).
describe('readIncomeLine', () => {
  it('reads a salary credit and names the employer', () => {
    expect(
      readIncomeLine(credit('A2AINT01 - ACME TECHNOLOGIES PVT LTD0979 - Salary - ACME Salary July 26 Value Dt 30/07/2026 Ref ••6651'))
    ).toEqual({ kind: 'salary', sourceName: 'ACME TECHNOLOGIES PVT LTD' });
  });

  it('does not guess a salary from a bare reference number', () => {
    expect(readIncomeLine(credit('••0522 Value Dt 29/06/2026 Ref ••0522'))).toBeNull();
  });

  it('reads bank interest from both banks', () => {
    expect(readIncomeLine(credit('Interest paid till 30-JUN-2026 Value Dt 30/06/2026'))?.kind).toBe('interest');
    expect(readIncomeLine(credit('Int.Pd:••1505:01-04-2026 to 30-06-2026'))?.kind).toBe('interest');
  });

  it('reads dividends paid by mandate or named as DIV', () => {
    expect(readIncomeLine(credit('ACH C- HUL LIMITED-1933044 Value Dt 28/07/2026 Ref ••6938'))).toEqual({
      kind: 'dividend',
      sourceName: 'HUL LIMITED',
    });
    expect(readIncomeLine(credit('••7231 EXAMPLE MOTORS LTD EQ DIV25 26 Value Dt 30/06/2026 Ref ••1334'))?.kind).toBe('dividend');
    expect(readIncomeLine(credit('DR REDDY S LABORATORIES LTD DIV 2025 26 Value Dt 28/07/2026 Ref ••8721'))?.kind).toBe('dividend');
    expect(readIncomeLine(credit('ACH C- ACME1stIntDiv••2026-2300001 Value Dt 31/07/2026 Ref ••1234'))?.kind).toBe('dividend');
  });

  it('leaves the household’s own money moving alone', () => {
    for (const narration of [
      '••3101 NET BANKING SI -MonthlyValue Dt 01/07/2026',
      '••3101-TPT-HDFCC2C7962784D 7-ALICE V Value Dt 14/07/2026 Ref ••8091',
      'NEFT Cr-YESB0000001-ZERODHA BROKING LTD-DSCNB A/C-BOB-YESF••8754 Value Dt 04/07/2026 Ref YESF••8754',
      'FD MATURITY PROCEEDS :••5936/01-07- 26/K BOB TO',
      'NEFT HDFCH••8837 ALICE V HDFC0000240 NEFTINW-••14',
      'UPI-DHIVYA DEVI-dhivyadevi@ okhdfcbank-HDFC0000001-••1111- UPI',
    ]) {
      expect(readIncomeLine(credit(narration)), narration).toBeNull();
    }
  });

  it('never reads a debit as income', () => {
    expect(readIncomeLine({ narration: 'ACH D- BD-Banayan Tree-TIOZ••2438', direction: 'debit' })).toBeNull();
  });
});

describe('statementRefs', () => {
  const line = (date: string, amount: number): StatementLine => ({ date, amount, narration: 'x', direction: 'credit', balance: 0 });

  it('is stable across reads and tells identical lines apart', () => {
    const lines = [line('2026-07-02', 1000), line('2026-07-02', 1000), line('2026-07-03', 1000)];
    const refs = statementRefs('hdfc_account_statement', '1303', lines);
    expect(refs).toEqual([
      'hdfc_account_statement:1303:2026-07-02:credit:1000.00:1',
      'hdfc_account_statement:1303:2026-07-02:credit:1000.00:2',
      'hdfc_account_statement:1303:2026-07-03:credit:1000.00:1',
    ]);
    expect(statementRefs('hdfc_account_statement', '1303', lines)).toEqual(refs);
  });
});
