import { describe, expect, it } from 'vitest';
import { spendTime } from '../spendTime';

describe('spendTime', () => {
  it('uses the time the bank printed', () => {
    expect(spendTime({ txnDate: '2026-10-17', txnTime: '16:50:04' }, '2026-10-17T11:20:31Z')).toEqual({
      spent_time: '16:50:04',
      spent_time_approx: false,
    });
  });

  it('falls back to the arrival time in Asia/Kolkata, marked approximate', () => {
    // 05:55:13Z is 11:25:13 IST.
    expect(spendTime({ txnDate: '2026-10-17', txnTime: null }, '2026-10-17T05:55:13+00:00')).toEqual({
      spent_time: '11:25:13',
      spent_time_approx: true,
    });
  });

  it('gives no time when the alert arrived on another day', () => {
    // A delayed or re-sent alert says nothing about the time of day.
    expect(spendTime({ txnDate: '2026-10-16', txnTime: null }, '2026-10-17T05:55:13+00:00')).toBeNull();
  });

  it('compares the date in Asia/Kolkata, not UTC', () => {
    // 20:00Z on the 16th is 01:30 IST on the 17th.
    expect(spendTime({ txnDate: '2026-10-17', txnTime: null }, '2026-10-16T20:00:00Z')).toEqual({
      spent_time: '01:30:00',
      spent_time_approx: true,
    });
  });
});
