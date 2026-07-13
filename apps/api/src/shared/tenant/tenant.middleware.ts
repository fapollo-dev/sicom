import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant } from './tenant-context';
import { UnauthorizedTenantError } from '../errors/app-error';
import { verifyJwt, isProducao } from '../auth/jwt';

/**
 * Resolve o tenant/identidade de FONTE CONFIÁVEL e abre o escopo async do request (OPERADORES corte-3a).
 *
 * MODO-DUPLO (transição):
 *  - JWT (Authorization: Bearer): fonte real da identidade (tenant/operador/empresa vêm dos claims assinados).
 *  - Fallback por HEADER (`x-tenant-id`/`x-operador-id`/`x-empresa-id`): identidade CRUA, herdada do esqueleto.
 *    Só é honrada quando `AUTH_ALLOW_HEADER_IDENTITY !== '0'` (default: permitido) — dev/test/smoke usam headers
 *    e não quebram; em produção define-se `AUTH_ALLOW_HEADER_IDENTITY=0` e só o Bearer vale. O front migra para
 *    token no corte-3b, então este fallback será removido.
 *
 * O tenant (seletor do banco) SEMPRE pode vir do header `x-tenant-id` — necessário no /auth/login (ainda sem
 * token). Fail-closed: sem tenant algum → lança. Operador/empresa NÃO têm default silencioso.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private headerIdentityAllowed(): boolean {
    // fold A1: em PRODUÇÃO a identidade por header NUNCA é honrada (fail-closed, mesmo se esquecerem o env).
    // Fora de produção (dev/test/smoke): permitida por default, desligável com AUTH_ALLOW_HEADER_IDENTITY='0'.
    return !isProducao() && process.env.AUTH_ALLOW_HEADER_IDENTITY !== '0';
  }

  use(req: Request, _res: Response, next: NextFunction) {
    const bearer = extractBearer(req.header('authorization'));
    const claims = bearer ? verifyJwt(bearer, Math.floor(Date.now() / 1000)) : null;

    // tenant: do JWT (autoritativo) senão do header x-tenant-id (login público / modo header).
    const tenantId = claims?.tenant ?? req.header('x-tenant-id');
    if (!tenantId) throw new UnauthorizedTenantError();

    let operadorId: number | undefined;
    let empresaId: number | undefined;
    let mustChange = false;
    if (claims) {
      operadorId = claims.sub;
      empresaId = claims.emp;
      mustChange = claims.chg === true; // fold M2: token de troca-obrigatória só libera /auth/*
    } else if (this.headerIdentityAllowed()) {
      const opHeader = req.header('x-operador-id');
      operadorId = opHeader ? Number(opHeader) : undefined;
      const empHeader = req.header('x-empresa-id');
      empresaId = empHeader ? Number(empHeader) : undefined;
    }
    // sem JWT e sem header-identity: só o tenant é conhecido (ex.: /auth/login). As rotas protegidas caem no
    // AcessoGuard fail-closed (operador null → 401), como esperado em produção sem token.

    runWithTenant({ tenantId, operadorId, empresaId, mustChange }, () => next());
  }
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : undefined;
}
