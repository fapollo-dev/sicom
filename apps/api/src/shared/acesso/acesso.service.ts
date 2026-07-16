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
    // fold auditoria (fail-open): o `?? 'usuario'` só cobria undefined; um valor SETADO não-canônico (vazio, typo,
    // 'USUARIO') caía no else → 'ambos' (o MAIS permissivo). Agora canonicaliza (trim/lower) + whitelist; qualquer
    // valor fora de {usuario,perfil,ambos} degrada p/ o default SEGURO 'usuario' (fail-safe, não fail-open).
    const raw = String(process.env.APP_PERMISSAO_MODO ?? '').trim().toLowerCase();
    return raw === 'perfil' || raw === 'ambos' ? raw : 'usuario';
  }

  async possuiAcesso(form: string, opcao: string): Promise<boolean> {
    const { operadorId, empresaId } = currentTenant();
    // fail-closed: sem operador/empresa, nega.
    if (operadorId == null || empresaId == null) return false;

    const db = this.dbp.forTenantRead();
    let q = db
      .selectFrom('permissoes')
      .select(sql`1`.as('ok'))
      .where(sql`upper(form)`, '=', form.toUpperCase())
      .where(sql`upper(opcao)`, '=', opcao.toUpperCase())
      .where('codempresa', '=', empresaId);

    if (this.modo === 'usuario') {
      q = q.where('codoperador', '=', operadorId); // grants DIRETOS (default do legado, PINHEIRAO)
    } else {
      // perfil/ambos (corte-2): acesso via PERFIS do operador (RELACAO_OPERADOR_PERFIL). 'ambos' = próprios ∪ perfis.
      const perfis = (
        (await (db as AnyDB)
          .selectFrom('relacao_operador_perfil')
          .select('codperfil')
          .where('codoperador', '=', operadorId)
          .where(sql`coalesce(indr,'I')`, '<>', 'E')
          .execute()) as Array<{ codperfil: number }>
      ).map((r) => Number(r.codperfil));

      if (this.modo === 'perfil') {
        if (!perfis.length) return false; // sem perfis → sem acesso no modo perfil-puro
        q = q.where('codperfil', 'in', perfis);
      } else {
        // 'ambos': casa o operador OU um de seus perfis (se tiver algum).
        q = q.where((eb: AnyDB) =>
          eb.or([eb('codoperador', '=', operadorId), ...(perfis.length ? [eb('codperfil', 'in', perfis)] : [])]),
        );
      }
    }

    const row = await q.executeTakeFirst();
    return !!row;
  }
}

type AnyDB = any;
