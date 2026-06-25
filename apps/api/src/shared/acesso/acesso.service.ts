import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../database/database.provider';
import { currentTenant } from '../tenant/tenant-context';

/** Modo de controle (legado: CONFIGURACOES.CONTROLE_PERMISSOES). PINHEIRAO = 'usuario'. */
export type ModoPermissao = 'usuario' | 'perfil' | 'ambos';

/**
 * RBAC espelhando `TdmPrincipal.PossuiAcessoForm` (udmPrincipal.pas):
 * acesso = EXISTE linha em PERMISSOES casando FORM+OPCAO + (operador|perfil) + empresa.
 * Presença = concedido (não há flag). Nesta fatia: modo 'usuario' (default do legado);
 * perfil/ambos ficam como extensão (perfis do operador ainda não modelados).
 */
@Injectable()
export class AcessoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private get modo(): ModoPermissao {
    return (process.env.APP_PERMISSAO_MODO as ModoPermissao) ?? 'usuario';
  }

  async possuiAcesso(form: string, opcao: string): Promise<boolean> {
    const { operadorId, empresaId } = currentTenant();
    // fail-closed: sem operador/empresa, nega.
    if (operadorId == null || empresaId == null) return false;

    let q = this.dbp
      .forTenantRead()
      .selectFrom('permissoes')
      .select(sql`1`.as('ok'))
      .where(sql`upper(form)`, '=', form.toUpperCase())
      .where(sql`upper(opcao)`, '=', opcao.toUpperCase())
      .where('codempresa', '=', empresaId);

    if (this.modo === 'usuario') {
      q = q.where('codoperador', '=', operadorId);
    } else {
      // perfil/ambos: extensão futura (precisa dos perfis do operador). Por ora, nega.
      return false;
    }

    const row = await q.executeTakeFirst();
    return !!row;
  }
}
