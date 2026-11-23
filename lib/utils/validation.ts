/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate positive number
 * Throws ValidationError if number is not positive
 */
export function validatePositiveNumber(value: number, fieldName: string): void {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new ValidationError(fieldName, `${fieldName} must be a valid number`);
  }
  if (value <= 0) {
    throw new ValidationError(fieldName, `${fieldName} must be greater than 0`);
  }
}

/**
 * Validate date string
 * Throws ValidationError if date is invalid
 */
export function validateDate(dateString: string, fieldName: string): void {
  if (!dateString) {
    throw new ValidationError(fieldName, `${fieldName} is required`);
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new ValidationError(fieldName, `${fieldName} must be a valid date`);
  }
}

/**
 * Validate string length
 */
export function validateLength(
  value: string,
  fieldName: string,
  min?: number,
  max?: number
): void {
  if (!value && min && min > 0) {
    throw new ValidationError(fieldName, `${fieldName} is required`);
  }

  if (min !== undefined && value.length < min) {
    throw new ValidationError(
      fieldName,
      `${fieldName} must be at least ${min} characters`
    );
  }

  if (max !== undefined && value.length > max) {
    throw new ValidationError(
      fieldName,
      `${fieldName} must be at most ${max} characters`
    );
  }
}

/**
 * Validate UUID format
 */
export function validateUUID(uuid: string, fieldName: string = 'ID'): void {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(uuid)) {
    throw new ValidationError(fieldName, `${fieldName} must be a valid UUID`);
  }
}

/**
 * Sanitize tag name
 * Converts to lowercase, replaces spaces with underscores, removes special chars
 */
export function sanitizeTagName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Validate expense data, collecting every problem rather than stopping at the first.
 */
export function validateExpenseData(data: {
  amount?: number;
  date?: string;
  description?: string;
  category_id?: string;
  user_id?: string;
}): ValidationResult {
  const errors: string[] = [];

  // Validate required fields
  if (!data.amount && data.amount !== 0) {
    errors.push('Amount is required');
  } else {
    try {
      validatePositiveNumber(data.amount, 'Amount');
    } catch (e) {
      if (e instanceof ValidationError) {
        errors.push(e.message);
      }
    }
  }

  if (!data.date) {
    errors.push('Date is required');
  } else {
    try {
      validateDate(data.date, 'Date');
    } catch (e) {
      if (e instanceof ValidationError) {
        errors.push(e.message);
      }
    }
  }

  if (!data.category_id) {
    errors.push('Category is required');
  }

  if (!data.user_id) {
    errors.push('User is required');
  }

  // Validate description length if provided
  if (data.description) {
    try {
      validateLength(data.description, 'Description', 0, 500);
    } catch (e) {
      if (e instanceof ValidationError) {
        errors.push(e.message);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
