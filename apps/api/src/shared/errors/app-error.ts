/** Hierarquia de erros tipados com código estável (seção 02). */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Regra de negócio violada (ex.: BANCO_OBRIGATORIO). */
export class BusinessRuleError extends AppError {
  readonly httpStatus = 422;
  constructor(
    readonly code: string,
    details?: Record<string, unknown>,
  ) {
    super(code, details);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION';
  readonly httpStatus = 400;
}

export class UnauthorizedTenantError extends AppError {
  readonly code = 'TENANT_FORBIDDEN';
  readonly httpStatus = 403;
  constructor() {
    super('TENANT_FORBIDDEN');
  }
}

export class ForbiddenActionError extends AppError {
  readonly httpStatus = 403;
  constructor(
    readonly code: string,
    details?: Record<string, unknown>,
  ) {
    super(code, details);
  }
}
