#!/usr/bin/env node
// Fills a fresh install with made-up data so every page has something to show: three months
// of expenses, salary, a year of net-worth snapshots, commitments, notes, todos and events.
// For demos, screenshots and development only. Never run it against a real household.
//
//   node scripts/seed-demo.mjs            # refuses if the household already has expenses
//   node scripts/seed-demo.mjs --force    # adds the demo data anyway
//
// Needs at least one user (scripts/create-user.mjs). Talks to PUBLIC_URL with the service key.
import { readEnv } from './env-file.mjs';

const env = { ...readEnv('.env'), ...process.env };
const base = `${env.PUBLIC_URL || 'http://localhost:8000'}/rest/v1`;
const headers = {
  apikey: env.SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};
const force = process.argv.includes('--force');

async function api(method, path, body) {
  const res = await fetch(`${base}/${path}`, {
    method,
    headers: { ...headers, Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const insert = (table, rows) => api('POST', table, rows);

// A small deterministic random, so every run produces the same household.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];
const round = (n, to = 10) => Math.round(n / to) * to;

const today = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 12));
const monthStart = (back) => new Date(today.getFullYear(), today.getMonth() - back, 1, 12);
const ym = (d) => ymd(d).slice(0, 7);

const users = await api('GET', 'users?select=id,full_name&is_active=eq.true');
if (users.length === 0) {
  console.error('No users yet. Run scripts/create-user.mjs first.');
  process.exit(1);
}
const existing = await api('GET', 'expenses?select=id&limit=1');
if (existing.length > 0 && !force) {
  console.error('This household already has expenses. Re-run with --force to add demo data anyway.');
  process.exit(1);
}

const categories = Object.fromEntries((await api('GET', 'categories?select=id,name')).map((c) => [c.name, c.id]));
const cat = (name) => categories[name] ?? categories['Miscellaneous'];

// ── Expenses: about three months of ordinary household spending ──────────────
const spends = [
  ['Groceries & Staples', ['Weekly groceries', 'Vegetables and fruit', 'Milk and curd', 'Rice and dal'], [600, 3200], 18],
  ['Dining Out', ['Dinner out', 'Weekend lunch', 'Snacks', 'Coffee'], [180, 1800], 10],
  ['Fuel', ['Petrol'], [500, 2500], 6],
  ['Mobile & Broadband', ['Broadband bill', 'Mobile recharge'], [299, 999], 4],
  ['Electricity', ['Electricity bill'], [1200, 3400], 2],
  ['Online Shopping', ['Household supplies', 'Books', 'Kitchenware'], [350, 4200], 6],
  ['Healthcare', ['Pharmacy', 'Doctor visit'], [200, 1500], 3],
  ['Commute & Travel', ['Cab', 'Metro card top-up', 'Auto'], [80, 650], 8],
  ['Subscriptions', ['Music subscription', 'Video subscription'], [119, 649], 3],
  ['Education', ['School fee instalment', 'Stationery', 'Dance class'], [400, 9000], 3],
  ['Recreation', ['Movie tickets', 'Weekend outing'], [400, 2400], 3],
];
const expenses = [];
for (const [category, descriptions, [min, max], count] of spends) {
  for (let i = 0; i < count; i++) {
    expenses.push({
      date: daysAgo(Math.floor(rand() * 85)),
      amount: round(min + rand() * (max - min)),
      category_id: cat(category),
      description: pick(descriptions),
      user_id: pick(users).id,
      source: 'manual',
    });
  }
}
await insert('expenses', expenses);

// ── Income: salary on the last working day ────────────────────────────────────
const income = [];
for (let back = 3; back >= 1; back--) {
  const end = new Date(today.getFullYear(), today.getMonth() - back + 1, 0, 12);
  users.forEach((u, i) =>
    income.push({ date: ymd(end), amount: 95000 + i * 30000, kind: 'salary', source_name: 'ACME Technologies', user_id: u.id, source: 'manual' })
  );
}
income.push({ date: daysAgo(20), amount: 1840, kind: 'interest', source_name: 'Savings interest', user_id: users[0].id, source: 'manual' });
await insert('income', income);

// ── Selvam: account types, accounts and a year of monthly snapshots ──────────
const types = [
  { name: 'Savings', color: '#0EA5E9', show_in_growth: true, is_equity: false, is_liability: false },
  { name: 'Mutual Funds', color: '#8B5CF6', show_in_growth: true, is_equity: true, is_liability: false },
  { name: 'Stocks', color: '#10B981', show_in_growth: true, is_equity: true, is_liability: false },
  { name: 'Retirement', color: '#F59E0B', show_in_growth: true, is_equity: false, is_liability: false },
  { name: 'Gold', color: '#EAB308', show_in_growth: true, is_equity: false, is_liability: false },
  { name: 'Credit Card', color: '#EF4444', show_in_growth: false, is_equity: false, is_liability: true },
];
const haveTypes = new Set((await api('GET', 'portfolio_account_types?select=name')).map((t) => t.name));
const newTypes = types.filter((t) => !haveTypes.has(t.name));
if (newTypes.length) await insert('portfolio_account_types', newTypes);

const accountPlan = [
  ['Savings - HDFC', 'Savings', 240000, 0.004, true],
  ['Savings - Kotak', 'Savings', 120000, 0.003, true],
  ['Index Fund SIP', 'Mutual Funds', 410000, 0.018, false],
  ['Flexi Cap Fund', 'Mutual Funds', 280000, 0.016, false],
  ['Brokerage - Stocks', 'Stocks', 350000, 0.012, false],
  ['EPF', 'Retirement', 820000, 0.009, false],
  ['PPF', 'Retirement', 310000, 0.006, false],
  ['Gold Coins', 'Gold', 150000, 0.01, false],
];
const accounts = await insert(
  'portfolio_accounts',
  accountPlan.map(([name, type, , , isCash], i) => ({ name, type, currency: 'INR', sort_order: i, is_active: true, is_cash: isCash }))
);
const cards = await insert('portfolio_accounts', [
  { name: 'Rewards Credit Card - 4321', type: 'Credit Card', currency: 'INR', is_active: true, sort_order: 20, details: { is_credit_card: true, bank: 'HDFC Bank', last4: '4321', billing_date: 12, due_date: 2 } },
]);

const snapshots = [];
accounts.forEach((account, i) => {
  const [, , start, growth] = accountPlan[i];
  let value = start;
  for (let back = 11; back >= 0; back--) {
    snapshots.push({ account_id: account.id, snapshot_date: ymd(monthStart(back)), amount: round(value, 100) });
    value = value * (1 + growth + (rand() - 0.45) * 0.02) + (accountPlan[i][1] === 'Mutual Funds' ? 10000 : 0);
  }
});
for (let back = 11; back >= 0; back--) {
  snapshots.push({ account_id: cards[0].id, snapshot_date: ymd(monthStart(back)), amount: -round(18000 + rand() * 22000, 100) });
}
await insert('portfolio_snapshots', snapshots);

const investments = [];
for (let back = 5; back >= 0; back--) {
  const d = new Date(today.getFullYear(), today.getMonth() - back, 5, 12);
  if (d > today) continue;
  investments.push({ account_id: accounts[2].id, investment_date: ymd(d), amount: 10000, kind: 'recurring', note: 'Monthly SIP' });
  investments.push({ account_id: accounts[3].id, investment_date: ymd(d), amount: 5000, kind: 'recurring', note: 'Monthly SIP' });
}
await insert('portfolio_investments', investments);

// ── Cash flow commitments ─────────────────────────────────────────────────────
await insert('commitments', [
  { name: 'Term life insurance', kind: 'insurance', amount: 24000, frequency: 'annual', start_month: ym(monthStart(4)), due_day: 15, active: true },
  { name: 'Home loan EMI', kind: 'loan', amount: 32500, frequency: 'monthly', start_month: ym(monthStart(24)), due_day: 5, active: true },
  { name: 'Health insurance', kind: 'insurance', amount: 18500, frequency: 'annual', start_month: ym(monthStart(9)), due_day: 1, active: true },
]);

// ── Notes, todos and the activity tracker ─────────────────────────────────────
await insert('notes', [
  { user_id: users[0].id, title: 'Tax-saving checklist', content: 'ELSS top-up before March. Collect rent receipts. Health insurance premium receipt.', is_pinned: true, tags: ['tax'] },
  { user_id: pick(users).id, title: 'Home repairs', content: 'Kitchen tap leaking. Ask about repainting the balcony before the monsoon.', is_pinned: false, tags: [] },
]);
await insert('todos', [
  { user_id: users[0].id, title: 'Renew vehicle insurance', status: 'pending', priority: 'high', due_date: daysAgo(-6) },
  { user_id: pick(users).id, title: 'Update nominee on the PPF account', status: 'in_progress', priority: 'medium', due_date: null },
  { user_id: pick(users).id, title: 'Book the annual health check-up', status: 'pending', priority: 'low', due_date: daysAgo(-20) },
]);
await insert('family_tracker_events', [
  { title: 'Swimming lessons', event_type: 'activity', event_date: daysAgo(30), status: 'open', reminder_days_before: null },
  { title: 'Passport renewal', event_type: 'one_time', event_date: daysAgo(-45), status: 'open', reminder_days_before: 14 },
]);

console.log(
  `Seeded ${expenses.length} expenses, ${income.length} income rows, ${accounts.length + cards.length} accounts with ` +
    `${snapshots.length} snapshots, 3 commitments, notes, todos and events.`
);
