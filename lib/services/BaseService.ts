/**
 * Base Service Pattern
 * Abstract class providing common functionality for all services
 * Implements the Service Layer pattern for business logic
 */
export abstract class BaseService {
  /**
   * Handle errors consistently across all services
   */
  protected handleError(error: unknown, operation: string): never {
    console.error(`Error in ${operation}:`, error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Failed to ${operation}`);
  }

  /**
   * Validate required fields
   * Throws error if validation fails
   */
  protected validateRequired(data: Record<string, any>, fields: string[]): void {
    for (const field of fields) {
      const value = data[field];
      if (value === null || value === undefined || value === '') {
        throw new Error(`${field} is required`);
      }
    }
  }

  /**
   * Validate positive number
   */
  protected validatePositiveNumber(value: number, fieldName: string): void {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(`${fieldName} must be a valid number`);
    }
    if (value <= 0) {
      throw new Error(`${fieldName} must be greater than 0`);
    }
  }

  /**
   * Validate non-negative number
   */
  protected validateNonNegativeNumber(value: number, fieldName: string): void {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(`${fieldName} must be a valid number`);
    }
    if (value < 0) {
      throw new Error(`${fieldName} must be 0 or greater`);
    }
  }

  /**
   * Validate date string
   */
  protected validateDate(dateString: string, fieldName: string): void {
    if (!dateString) {
      throw new Error(`${fieldName} is required`);
    }

    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      throw new Error(`${fieldName} must be a valid date`);
    }
  }

  /**
   * Validate UUID format
   */
  protected validateUUID(uuid: string, fieldName: string = 'ID'): void {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(uuid)) {
      throw new Error(`${fieldName} must be a valid UUID`);
    }
  }

  /**
   * Log operation for debugging
   */
  protected log(operation: string, message: string, data?: unknown): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${operation}]`, message, data || '');
    }
  }

  /**
   * Log warning
   */
  protected warn(operation: string, message: string, data?: unknown): void {
    console.warn(`[${operation}]`, message, data || '');
  }
}
