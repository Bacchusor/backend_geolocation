/**
 * Domain errors. The HTTP layer maps these to status codes; the domain never
 * knows about HTTP.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input violates a domain invariant (bad coordinates, radius, etc.). */
export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}

/** Input is well-formed but rejected by a business rule (stale fix, implausible speed). */
export class RejectedFixError extends DomainError {
  constructor(message: string) {
    super(message, "FIX_REJECTED");
  }
}

/** A third-party provider is unavailable (circuit open, timeout, upstream 5xx). */
export class ProviderUnavailableError extends DomainError {
  constructor(message: string) {
    super(message, "PROVIDER_UNAVAILABLE");
  }
}
