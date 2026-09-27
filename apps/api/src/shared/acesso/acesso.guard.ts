import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AcessoService } from './acesso.service';
import { REQUER_ACESSO, REQUER_CONTROLE } from './requer-acesso.decorator';
import { ForbiddenActionError, UnauthenticatedError } from '../errors/app-error';
import { currentTenant } from '../tenant/tenant-context';

/**
 * Guard de RBAC + porta de AUTENTICAÇÃO (OPERADORES corte-3a). Espelha `PossuiAcessoForm` do form-base:
 *  - fold M1: TODA rota de domínio (guarda de classe) exige um operador resolvido (JWT ou header-identity em
 *    dev). Sem operador → 401 (fecha a leitura cross-tenant não autenticada em produção; antes as leituras,
 *    sem @RequerAcesso, passavam livres só com x-tenant-id).
 *  - fold M2: operador com troca de senha OBRIGATÓRIA (claim `chg`) só acessa /auth/* → aqui é barrado.
 *  - RBAC: rotas com @RequerAcesso exigem o grant em PERMISSOES; sem @RequerAcesso (leitura), basta a auth acima.
 */
@Injectable()
export class AcessoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly acesso: AcessoService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const tenant = currentTenant();
    // M1: identidade obrigatória em qualquer rota guardada (inclui leituras).
    if (tenant.operadorId == null) throw new UnauthenticatedError('NAO_AUTENTICADO');
    // M2: troca de senha obrigatória pendente → só /auth/* (fora deste guard) é permitido.
    if (tenant.mustChange) throw new ForbiddenActionError('SENHA_TROCA_OBRIGATORIA');

    const meta = this.reflector.get<{ form: string; opcao: string } | undefined>(
      REQUER_ACESSO,
      ctx.getHandler(),
    );
    // as permissões de CONTROLE do botão/menu que dispara a rota (além do gate) — `@RequerControle`
    const controles = this.reflector.get<Array<{ form: string; opcao: string }> | undefined>(REQUER_CONTROLE, ctx.getHandler()) ?? [];
    for (const req of meta ? [meta, ...controles] : controles) {
      if (!(await this.acesso.possuiAcesso(req.form, req.opcao))) {
        throw new ForbiddenActionError('SEM_PERMISSAO', {
          form: req.form,
          opcao: req.opcao,
          operador: currentTenant().operadorId,
        });
      }
    }
    return true;
  }
}
