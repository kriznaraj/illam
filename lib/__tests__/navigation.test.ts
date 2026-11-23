import { describe, expect, it } from 'vitest';
import { CASH_FLOW_TABS, EXPENSE_TABS, NET_WORTH_TABS, isTabActive, sectionFor } from '@/lib/navigation';

describe('sectionFor', () => {
  it.each([
    ['/', 'home'],
    ['/home', 'home'],
    ['/expenses', 'expenses'],
    ['/expenses/reports/category-monthly', 'expenses'],
    ['/portfolio', 'net-worth'],
    ['/portfolio/accounts/abc', 'net-worth'],
    ['/inbox', 'inbox'],
    ['/cash-flow/commitments', 'cash-flow'],
    ['/notes', 'other'],
    ['/account', 'other'],
  ])('%s is in %s', (path, section) => {
    expect(sectionFor(path)).toBe(section);
  });
});

describe('isTabActive', () => {
  const active = (tabs: typeof EXPENSE_TABS, path: string) =>
    tabs.filter((t) => isTabActive(t.href, path)).map((t) => t.href);

  it('marks a section root only on the root itself', () => {
    expect(active(EXPENSE_TABS, '/expenses')).toEqual(['/expenses']);
    expect(active(EXPENSE_TABS, '/expenses/browse')).toEqual(['/expenses/browse']);
    expect(active(NET_WORTH_TABS, '/portfolio')).toEqual(['/portfolio']);
  });

  it('keeps a tab active on its sub-pages', () => {
    expect(active(NET_WORTH_TABS, '/portfolio/settings/accounts/abc')).toEqual(['/portfolio/settings']);
  });

  it('treats SIP and gold as part of Net worth settings', () => {
    expect(active(NET_WORTH_TABS, '/portfolio/sip')).toEqual(['/portfolio/settings']);
    expect(active(NET_WORTH_TABS, '/portfolio/gold')).toEqual(['/portfolio/settings']);
  });

  it('marks no tab on pages outside the tabs', () => {
    expect(active(NET_WORTH_TABS, '/portfolio/accounts/abc')).toEqual([]);
  });
});

describe('tab sets', () => {
  const labels = (tabs: typeof EXPENSE_TABS) => tabs.map((t) => t.label);

  it('keeps each row short enough for a phone', () => {
    expect(labels(EXPENSE_TABS)).toEqual(['Overview', 'Browse', 'Reports', 'Organize']);
    expect(labels(NET_WORTH_TABS)).toEqual(['Overview', 'Snapshots', 'Invest', 'Cards', 'Reports', 'Settings']);
    expect(labels(CASH_FLOW_TABS)).toEqual(['Overview', 'Income', 'Insurance & EMIs']);
  });

  it('shows Net worth settings as an icon only', () => {
    expect(NET_WORTH_TABS.find((t) => t.label === 'Settings')?.iconOnly).toBe(true);
  });

  it('puts income under Cash flow', () => {
    expect(active(CASH_FLOW_TABS, '/cash-flow/income')).toEqual(['/cash-flow/income']);
    expect(active(CASH_FLOW_TABS, '/cash-flow')).toEqual(['/cash-flow']);
    expect(active(CASH_FLOW_TABS, '/cash-flow/commitments')).toEqual(['/cash-flow/commitments']);
  });

  it('keeps Reports active on both report views', () => {
    expect(active(EXPENSE_TABS, '/expenses/insights')).toEqual(['/expenses/report']);
    expect(active(EXPENSE_TABS, '/expenses/reports/category-monthly')).toEqual(['/expenses/report']);
    expect(active(NET_WORTH_TABS, '/portfolio/insights')).toEqual(['/portfolio/report']);
  });
});

const active = (tabs: typeof EXPENSE_TABS, path: string) =>
  tabs.filter((t) => isTabActive(t.href, path)).map((t) => t.href);
