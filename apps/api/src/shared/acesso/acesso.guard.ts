import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AcessoService } from './acesso.service';
import { REQUER_ACESSO } from './requer-acesso.decorator';
import { ForbiddenActionError } from '../errors/app-error';
import { currentTenant } from '../tenant/tenant-context';

/**
 * Guard de RBAC (substitui o stub do service). Lê (form, opção) do @RequerAcesso
 * e nega se PERMISSOES não conceder — espelha `PossuiAcessoForm` do form-base.
 * Rotas sem @RequerAcesso passam livres (ex.: leitura/listagem).
 */
@Injectable()
export class AcessoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly acesso: AcessoService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<{ form: string; opcao: string } | undefined>(
      REQUER_ACESSO,
      ctx.getHandler(),
    );
    if (!meta) return true;

    if (!(await this.acesso.possuiAcesso(meta.form, meta.opcao))) {
      throw new ForbiddenActionError('SEM_PERMISSAO', {
        form: meta.form,
        opcao: meta.opcao,
        operador: currentTenant().operadorId,
      });
    }
    return true;
  }
}
