/**
 * Failures the repositories can produce. Named types, so a caller can tell
 * "that id does not exist" from "that payload is unusable" without parsing
 * a message.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join(' | '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
