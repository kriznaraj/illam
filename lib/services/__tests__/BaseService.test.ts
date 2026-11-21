import { describe, it, expect, vi, afterEach } from 'vitest';
import { BaseService } from '../BaseService';

/**
 * BaseService is abstract and its members are protected, so tests drive it
 * through a tiny concrete subclass that re-exposes them. Every service in
 * lib/services extends this class, so a regression here is a regression in
 * the validation of all 29 of them.
 */
class TestService extends BaseService {
  required(data: Record<string, any>, fields: string[]) {
    return this.validateRequired(data, fields);
  }
  positive(value: number, field: string) {
    return this.validatePositiveNumber(value, field);
  }
  nonNegative(value: number, field: string) {
    return this.validateNonNegativeNumber(value, field);
  }
  date(value: string, field: string) {
    return this.validateDate(value, field);
  }
  uuid(value: string, field?: string) {
    return this.validateUUID(value, field);
  }
  fail(error: unknown, operation: string): never {
    return this.handleError(error, operation);
  }
}

const service = new TestService();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateRequired', () => {
  it('passes when every field has a value', () => {
    expect(() => service.required({ a: 'x', b: 1 }, ['a', 'b'])).not.toThrow();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(() => service.required({ title: value }, ['title'])).toThrow('title is required');
  });

  it('names the first missing field in the error', () => {
    expect(() => service.required({ a: '', b: '' }, ['a', 'b'])).toThrow('a is required');
  });

  it('treats a missing key the same as an undefined value', () => {
    expect(() => service.required({}, ['title'])).toThrow('title is required');
  });

  it('accepts 0 and false — they are values, not absences', () => {
    // Guards against a `!value` rewrite, which would reject a zero amount.
    expect(() => service.required({ amount: 0, flag: false }, ['amount', 'flag'])).not.toThrow();
  });
});

describe('validatePositiveNumber', () => {
  it('accepts a positive number', () => {
    expect(() => service.positive(1, 'Amount')).not.toThrow();
  });

  it('rejects zero', () => {
    expect(() => service.positive(0, 'Amount')).toThrow('Amount must be greater than 0');
  });

  it('rejects a negative number', () => {
    expect(() => service.positive(-5, 'Amount')).toThrow('Amount must be greater than 0');
  });

  it('rejects NaN as an invalid number, not as a range failure', () => {
    expect(() => service.positive(NaN, 'Amount')).toThrow('Amount must be a valid number');
  });

  it('rejects a non-number', () => {
    expect(() => service.positive('12' as unknown as number, 'Amount')).toThrow(
      'Amount must be a valid number'
    );
  });
});

describe('validateNonNegativeNumber', () => {
  it('accepts zero', () => {
    expect(() => service.nonNegative(0, 'Balance')).not.toThrow();
  });

  it('accepts a positive number', () => {
    expect(() => service.nonNegative(10, 'Balance')).not.toThrow();
  });

  it('rejects a negative number', () => {
    expect(() => service.nonNegative(-0.01, 'Balance')).toThrow('Balance must be 0 or greater');
  });

  it('rejects NaN', () => {
    expect(() => service.nonNegative(NaN, 'Balance')).toThrow('Balance must be a valid number');
  });
});

describe('validateDate', () => {
  it('accepts an ISO date', () => {
    expect(() => service.date('2026-08-15', 'Event date')).not.toThrow();
  });

  it('rejects an empty string as missing rather than invalid', () => {
    expect(() => service.date('', 'Event date')).toThrow('Event date is required');
  });

  it('rejects an unparseable string', () => {
    expect(() => service.date('not-a-date', 'Event date')).toThrow('Event date must be a valid date');
  });
});

describe('validateUUID', () => {
  it('accepts a v4 UUID', () => {
    expect(() => service.uuid('123e4567-e89b-12d3-a456-426614174000')).not.toThrow();
  });

  it('accepts uppercase', () => {
    expect(() => service.uuid('123E4567-E89B-12D3-A456-426614174000')).not.toThrow();
  });

  it('rejects a malformed id', () => {
    expect(() => service.uuid('abc')).toThrow('ID must be a valid UUID');
  });

  it('rejects an empty string', () => {
    expect(() => service.uuid('')).toThrow('ID must be a valid UUID');
  });

  it('uses the supplied field name in the message', () => {
    expect(() => service.uuid('abc', 'Event ID')).toThrow('Event ID must be a valid UUID');
  });
});

describe('handleError', () => {
  it('rethrows an Error unchanged so the original message survives', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = new Error('duplicate key');
    expect(() => service.fail(original, 'create expense')).toThrow(original);
  });

  it('wraps a non-Error throw in a message naming the operation', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => service.fail('boom', 'create expense')).toThrow('Failed to create expense');
  });

  it('always throws — it never returns', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => service.fail(undefined, 'do thing')).toThrow();
  });
});
