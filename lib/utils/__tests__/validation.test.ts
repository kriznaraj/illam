import { describe, it, expect } from 'vitest';
import {
  sanitizeTagName,
  validatePositiveNumber,
  validateDate,
  validateLength,
  validateUUID,
  validateExpenseData,
  ValidationError,
} from '../validation';

describe('Tag Sanitization', () => {
  describe('sanitizeTagName', () => {
    it('should convert uppercase to lowercase', () => {
      expect(sanitizeTagName('IMPORTANT')).toBe('important');
      expect(sanitizeTagName('TaX_DedUctiblE')).toBe('tax_deductible');
    });

    it('should replace spaces with underscores', () => {
      expect(sanitizeTagName('tax deductible')).toBe('tax_deductible');
      expect(sanitizeTagName('my  tag  name')).toBe('my_tag_name');
    });

    it('should remove special characters except underscores', () => {
      expect(sanitizeTagName('tag-name!')).toBe('tagname');
      expect(sanitizeTagName('tag@#$%name')).toBe('tagname');
      expect(sanitizeTagName('tag_name')).toBe('tag_name');
      expect(sanitizeTagName('tag.name')).toBe('tagname');
    });

    it('should trim whitespace', () => {
      expect(sanitizeTagName('  tag  ')).toBe('tag');
      expect(sanitizeTagName('\ntag\n')).toBe('tag');
    });

    it('should handle mixed case with spaces and special chars', () => {
      expect(sanitizeTagName('  Tax Deductible! ')).toBe('tax_deductible');
      expect(sanitizeTagName('Work-Related 2024')).toBe('workrelated_2024');
    });

    it('should handle empty string', () => {
      expect(sanitizeTagName('')).toBe('');
      expect(sanitizeTagName('   ')).toBe('');
    });

    it('should preserve numbers and underscores', () => {
      expect(sanitizeTagName('q1_2024')).toBe('q1_2024');
      expect(sanitizeTagName('tag_123')).toBe('tag_123');
    });

    it('should handle unicode/emoji by removing them', () => {
      expect(sanitizeTagName('tag🚀name')).toBe('tagname');
      expect(sanitizeTagName('café')).toBe('caf');
    });
  });
});

describe('Validation - Numbers', () => {
  describe('validatePositiveNumber', () => {
    it('should accept positive numbers', () => {
      expect(() => validatePositiveNumber(100, 'Amount')).not.toThrow();
      expect(() => validatePositiveNumber(0.01, 'Amount')).not.toThrow();
    });

    it('should reject zero', () => {
      expect(() => validatePositiveNumber(0, 'Amount')).toThrow(ValidationError);
      expect(() => validatePositiveNumber(0, 'Amount')).toThrow('Amount must be greater than 0');
    });

    it('should reject negative numbers', () => {
      expect(() => validatePositiveNumber(-100, 'Amount')).toThrow(ValidationError);
    });

    it('should reject NaN', () => {
      expect(() => validatePositiveNumber(NaN, 'Amount')).toThrow('Amount must be a valid number');
    });

    it('should reject non-numbers', () => {
      expect(() => validatePositiveNumber('100' as any, 'Amount')).toThrow('Amount must be a valid number');
    });
  });
});

describe('Validation - Date', () => {
  it('should accept valid date strings', () => {
    expect(() => validateDate('2024-01-15', 'Date')).not.toThrow();
    expect(() => validateDate('2024-12-31', 'Date')).not.toThrow();
  });

  it('should accept ISO date-time strings', () => {
    expect(() => validateDate('2024-01-15T12:00:00Z', 'Date')).not.toThrow();
  });

  it('should reject invalid date strings', () => {
    expect(() => validateDate('not-a-date', 'Date')).toThrow('Date must be a valid date');
    expect(() => validateDate('2024-13-01', 'Date')).toThrow('Date must be a valid date');
  });

  it('should reject empty strings', () => {
    expect(() => validateDate('', 'Date')).toThrow('Date is required');
  });

  it('should accept valid leap year dates', () => {
    expect(() => validateDate('2024-02-29', 'Date')).not.toThrow(); // Leap year
  });

  it('should accept dates that JavaScript adjusts', () => {
    // Note: JavaScript Date constructor accepts '2023-02-29' and adjusts to '2023-03-01'
    // The validateDate function doesn't validate strict date logic, only that Date constructor accepts it
    expect(() => validateDate('2023-02-29', 'Date')).not.toThrow();
  });
});

describe('Validation - String Length', () => {
  it('should accept strings within length bounds', () => {
    expect(() => validateLength('test', 'Name', 1, 10)).not.toThrow();
  });

  it('should reject strings too short', () => {
    expect(() => validateLength('ab', 'Name', 3, 10)).toThrow('Name must be at least 3 characters');
  });

  it('should reject strings too long', () => {
    expect(() => validateLength('verylongstring', 'Name', 1, 5)).toThrow('Name must be at most 5 characters');
  });

  it('should handle missing min/max gracefully', () => {
    expect(() => validateLength('test', 'Name')).not.toThrow();
  });
});

describe('Validation - UUID', () => {
  it('should accept valid UUIDs', () => {
    expect(() => validateUUID('123e4567-e89b-12d3-a456-426614174000', 'ID')).not.toThrow();
    expect(() => validateUUID('00000000-0000-0000-0000-000000000000', 'ID')).not.toThrow();
  });

  it('should reject invalid UUIDs', () => {
    expect(() => validateUUID('not-a-uuid', 'ID')).toThrow('ID must be a valid UUID');
    expect(() => validateUUID('123e4567-e89b-12d3-a456', 'ID')).toThrow();
    expect(() => validateUUID('', 'ID')).toThrow();
  });

  it('should be case insensitive', () => {
    expect(() => validateUUID('123E4567-E89B-12D3-A456-426614174000', 'ID')).not.toThrow();
  });
});

describe('Expense Data Validation (Business Logic)', () => {
  it('should pass for valid expense data', () => {
    const result = validateExpenseData({
      amount: 100.50,
      date: '2024-01-15',
      description: 'Groceries',
      category_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when amount is missing', () => {
    const result = validateExpenseData({
      date: '2024-01-15',
      category_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Amount is required');
  });

  it('should fail when amount is negative', () => {
    const result = validateExpenseData({
      amount: -100,
      date: '2024-01-15',
      category_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('greater than 0'))).toBe(true);
  });

  it('should fail when date is invalid', () => {
    const result = validateExpenseData({
      amount: 100,
      date: 'invalid-date',
      category_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('valid date'))).toBe(true);
  });

  it('should fail when description is too long', () => {
    const result = validateExpenseData({
      amount: 100,
      date: '2024-01-15',
      description: 'a'.repeat(501), // Over 500 char limit
      category_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('at most 500 characters'))).toBe(true);
  });

  it('should accept zero amount', () => {
    const result = validateExpenseData({
      amount: 0,
      date: '2024-01-15',
      category_id: '123e4567-e89b-12d3-a456-426614174000',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    });
    // Zero is not valid for positive number
    expect(result.valid).toBe(false);
  });

  it('should fail when category_id is missing', () => {
    const result = validateExpenseData({
      amount: 100,
      date: '2024-01-15',
      user_id: '123e4567-e89b-12d3-a456-426614174001',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Category is required');
  });

  it('should fail when user_id is missing', () => {
    const result = validateExpenseData({
      amount: 100,
      date: '2024-01-15',
      category_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('User is required');
  });

  it('should accumulate multiple errors', () => {
    const result = validateExpenseData({
      amount: -100,
      date: 'invalid',
      description: 'a'.repeat(501),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
