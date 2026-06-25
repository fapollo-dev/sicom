import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant } from './tenant-context';
import { UnauthorizedTenantError } from '../errors/app-error';

/**
 * Resolve o tenant de FONTE CONFIÁVEL e abre o escopo async do request.
 * Nesta fatia (esqueleto): header `x-tenant-id` (em produção: JWT assinado).
 * Fail-closed: sem tenant → lança.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const tenantId = req.header('x-tenant-id');
    if (!tenantId) throw new UnauthorizedTenantError();
    // Identidade do operador NÃO tem default silencioso (carimbo de auditoria é audit log).
    const opHeader = req.header('x-operador-id');
    const operadorId = opHeader ? Number(opHeader) : undefined;
    const empHeader = req.header('x-empresa-id');
    const empresaId = empHeader ? Number(empHeader) : undefined;
    runWithTenant({ tenantId, operadorId, empresaId }, () => next());
  }
}
