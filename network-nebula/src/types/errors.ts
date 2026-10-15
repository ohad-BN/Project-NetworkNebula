// API Error Types

export class NetworkError extends Error {
  constructor(message = 'Network connection failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message = 'Authentication failed', statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends Error {
  statusCode: number;
  fieldErrors?: Record<string, string>;
  constructor(message = 'Validation failed', fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.fieldErrors = fieldErrors;
  }
}

export class ServerError extends Error {
  statusCode: number;
  constructor(message = 'Internal server error', statusCode = 500) {
    super(message);
    this.name = 'ServerError';
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends Error {
  statusCode: number;
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

// Type guard to check error type
export function isApiError(error: unknown): error is Error {
  return error instanceof NetworkError ||
         error instanceof AuthError ||
         error instanceof ValidationError ||
         error instanceof ServerError ||
         error instanceof NotFoundError;
}

// Get error display message
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}
