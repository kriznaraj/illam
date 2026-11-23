import { validateDate, validatePositiveNumber, validateUUID } from '@/lib/utils/validation';

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
   * Validate required fields, throwing on the first one missing. The field validators
   * below delegate to lib/utils/validation and throw its ValidationError.
   */
  protected validateRequired(data: Record<string, unknown>, fields: string[]): void {
    for (const field of fields) {
      const value = data[field];
      if (value === null || value === undefined || value === '') {
        throw new Error(`${field} is required`);
      }
    }
  }

  protected validatePositiveNumber(value: number, fieldName: string): void {
    validatePositiveNumber(value, fieldName);
  }

  protected validateDate(dateString: string, fieldName: string): void {
    validateDate(dateString, fieldName);
  }

  protected validateUUID(uuid: string, fieldName: string = 'ID'): void {
    validateUUID(uuid, fieldName);
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
