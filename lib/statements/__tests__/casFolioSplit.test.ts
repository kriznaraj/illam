import { describe, it, expect } from 'vitest';
import { fundNamesScheme, splitFoliosByFund } from '../casFolioSplit';
import type { CasFolioHolding } from '../cdslCas';

// Fund lists as entered for Bob's accounts on /portfolio/sip; scheme names shaped like CAS rows.
describe('fundNamesScheme', () => {
  it.each([
    ['Parag Parikh Flexi Cap', 'PPFAS - Parag Parikh Flexi Cap Fund - Direct Plan Growth'],
    ['Mirae Large & Midcap Fund', 'EBD1 - Mirae Asset Large and Midcap Fund (formerly Mirae Asset Emerging Bluechip Fund) - Direct Plan'],
    ['ICICI Prudential Tech Fund', 'P8098 - ICICI Prudential Technology Fund - Direct Plan - Growth'],
    ['WhiteOak Mid Cap', 'WOMCD - WhiteOak Capital Mid Cap Fund Direct Growth'],
    ['Motilal Oswal Nifty Capital Market Index Fund', 'MOCMI - Motilal Oswal Nifty Capital Market Index Fund Direct Growth'],
  ])('"%s" names "%s"', (fund, scheme) => {
    expect(fundNamesScheme(fund, scheme)).toBe(true);
  });

  it('does not match on shared words alone', () => {
    expect(fundNamesScheme('ICICI Quant Fund', 'P8098 - ICICI Prudential Technology Fund - Direct Plan - Growth')).toBe(false);
    expect(fundNamesScheme('Canara Robeco BlueChip', 'EBD1 - Mirae Asset Large and Midcap Fund (formerly Mirae Asset Emerging Bluechip Fund)')).toBe(false);
    expect(fundNamesScheme('Fund', 'Anything Fund')).toBe(false);
  });
});

const folio = (name: string, value: number): CasFolioHolding => ({ isin: `INF${value}`, name, units: 1, nav: value, invested: value, value });

describe('splitFoliosByFund', () => {
  const lists = [
    { accountId: 'grow', funds: ['ICICI Quant Fund', 'Parag Parikh Flexi Cap'] },
    { accountId: 'etmoney', funds: ['Mirae Large & Midcap Fund', 'ICICI Prudential Tech Fund'] },
  ];

  it('sends each folio to the one account whose list names it', () => {
    const split = splitFoliosByFund(
      [
        folio('PPFAS - Parag Parikh Flexi Cap Fund - Direct Plan Growth', 1000),
        folio('EBD1 - Mirae Asset Large and Midcap Fund - Direct Plan', 2000),
        folio('P8098 - ICICI Prudential Technology Fund - Direct Plan - Growth', 500),
      ],
      lists
    );
    expect(split.unassigned).toEqual([]);
    expect(split.byAccount.get('grow')?.map((f) => f.value)).toEqual([1000]);
    expect(split.byAccount.get('etmoney')?.map((f) => f.value)).toEqual([2000, 500]);
  });

  it('leaves a folio no list names — or two lists do — unassigned', () => {
    const split = splitFoliosByFund(
      [folio('HDFC - HDFC Balanced Advantage Fund', 10), folio('PPFAS - Parag Parikh Flexi Cap Fund', 20)],
      [...lists, { accountId: 'other', funds: ['Parag Parikh Flexi Cap'] }]
    );
    expect(split.unassigned).toEqual(['HDFC - HDFC Balanced Advantage Fund', 'PPFAS - Parag Parikh Flexi Cap Fund']);
    expect(split.byAccount.size).toBe(0);
  });
});
