import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { sincronizarVinculos, TABELA_DO_TIPO, validarOperadoresDoPerfil, operadoresVinculados } from './perfil-vinculos';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

type AnyDB = any;

/**
 * PERFIL — atribuição de perfis a operadores (RELACAO_OPERADOR_PERFIL). Matriz operador→perfis: lista todos
 * os perfis ativos com o flag `atribuido`, e o set grava/apaga o vínculo (idempotente via UNIQUE parcial).
 * O acesso efetivo (grants dos perfis) é ligado no acesso.service no corte-2.
 */
@Injectable()
export class PerfilRelacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  /** matriz: todos os perfis ativos + se o operador os tem. */
  async listar(codoperador: number): Promise<{ codoperador: number; perfis: Array<Record<string, unknown>> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = await db.selectFrom('operadores').select('codoperador').where('codoperador', '=', codoperador).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
    if (!op) throw new BusinessRuleError('OPERADOR_NAO_ENCONTRADO', { codoperador });
    const atribuidos = new Set(
      ((await db.selectFrom('relacao_operador_perfil').select('codperfil').where('codoperador', '=', codoperador).where(sql`coalesce(indr,'I')`, '<>', 'E').execute()) as Array<{ codperfil: number }>).map((r) => Number(r.codperfil)),
    );
    const perfis = (await db.selectFrom('perfil').select(['codperfil', 'perfil', 'ativo']).where(sql`coalesce(indr,'I')`, '<>', 'E').orderBy('perfil').execute()) as Array<{ codperfil: number; perfil: string; ativo: string }>;
    return { codoperador, perfis: perfis.map((p) => ({ ...p, atribuido: atribuidos.has(Number(p.codperfil)) })) };
  }

  /** o tipo do perfil e a tabela dos vínculos dele — o PARCEIRO não tem operadores (`tpParceiro: Exit`, uRdmCadUsuarios.pas:264) */
  private async perfilComTabela(db: AnyDB, codperfil: number): Promise<{ tipo: string; tabela: string | null }> {
    const p = (await db.selectFrom('perfil').select(['tipo']).where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { tipo: string | null } | undefined;
    if (!p) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
    const tipo = String(p.tipo ?? '').toUpperCase();
    return { tipo, tabela: TABELA_DO_TIPO[tipo] ?? null };
  }

  /**
   * OS OPERADORES VINCULADOS ao perfil (a grade do cadastro de perfil, uCadPerfilOperador / udmCadPerfilOperador.dfm:150-170 e
   * :320-340): os vínculos ativos da tabela do tipo do perfil.
   */
  async operadoresDoPerfil(codperfil: number): Promise<{ codperfil: number; tipo: string; operadores: Array<{ codoperador: number; nome: string | null }> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const { tipo, tabela } = await this.perfilComTabela(db, codperfil);
    const operadores = !tabela ? [] : await operadoresVinculados(db, tabela, codperfil);
    return { codperfil, tipo, operadores };
  }

  /**
   * grava a lista de operadores do perfil (o Gravar do cadastro de perfil): o "Adicionar operador vinculado" é a Pesquisa da
   * GET_OPERADORES em multisseleção (`ExisteOperadorSelecionado`, uCadPerfilOperador.pas:197-207 — a view tira o SICOM e os excluídos);
   * o retirado vira 'E' e o reposto é linha nova, como na tela de usuários.
   */
  async gravarOperadoresDoPerfil(codperfil: number, codoperadores: number[]): Promise<{ codperfil: number; operadores: number }> {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { tipo, tabela } = await this.perfilComTabela(trx, codperfil);
      if (!tabela) throw new BusinessRuleError('PERFIL_SEM_OPERADORES', { codperfil, tipo });
      await sincronizarVinculos(trx, tabela, { coluna: 'codperfil', valor: codperfil }, codoperadores, (novos) => validarOperadoresDoPerfil(trx, novos));
      return { codperfil, operadores: new Set(codoperadores).size };
    });
  }

  /** atribui (S) ou remove (soft-delete) o vínculo operador↔perfil. */
  /**
   * "Relação perfil x operador" (MnItemRelacaoPerfilxOperadorClick → TRelPerfilOperador, uCadPerfilOperador.pas:385-410, :524-549): os
   * vínculos ativos com o nome do operador, no OperadoresVinculadosPerfil.fr3 (RELATORIOS — a produção tem o PERSONALIZADO 854). O SQL do
   * legado lê sempre a RELACAO_OPERADOR_PERFIL — no perfil de COMPRA o relatório sairia vazio; aqui é a tabela do tipo. O layout lê a
   * lista no FrxDBMasterDet, que o legado só liga quando a consulta de detalhe não está vazia: os dois datasets levam as linhas.
   */
  async relatorioOperadores(codperfil: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const p = (await db.selectFrom('perfil').select(['perfil', 'tipo']).where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { perfil: string | null; tipo: string | null } | undefined;
    if (!p) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
    const tabela = TABELA_DO_TIPO[String(p.tipo ?? '').toUpperCase()];
    const ops = tabela ? await operadoresVinculados(db, tabela, codperfil) : [];
    // "Registros não encontrados para esse perfil." (TRelatoriosPO.Texto)
    if (!ops.length) throw new BusinessRuleError('PERFIL_RELATORIO_VAZIO', { codperfil });
    const nums = new Set(['codoperador', 'codperfil']);
    const linhas = ops.map((o) => registroFr3({ codoperador: o.codoperador, codperfil, perfil: p.perfil, operador: o.nome }, nums));
    const empresa = await empresaParaRelatorio(db, this.emp());
    return {
      titulo: 'Relação operadores vinculados ao perfil',
      modelo: await modeloFr3(db, 'OperadoresVinculadosPerfil.fr3'),
      datasets: { FrxDBMaster: linhas, FrxDBMasterDet: linhas, FrxDBEmpresa: [empresa], dbdEmpresa: [empresa] },
    };
  }

  /**
   * "Relação perfil x permissões de acesso" (MnItemPermissoesPerfilClick → TRelPerfilPermissao, :362-383, :494-512): as permissões do
   * perfil NA EMPRESA DO LOGIN, uma linha por tela × opção (GROUP BY PERFIL, FORM_CAPTION, CAPTION, na ordem deles), no
   * PermissaoVinculadaPerfil.fr3 (PERSONALIZADO 874). O legado antes completa os rótulos que faltam na PERMISSOES abrindo cada tela
   * (`ValidaCampoCaptionTabelaPermissao`) — não há tela Delphi para abrir; o Apollo grava o rótulo ao conceder.
   */
  async relatorioPermissoes(codperfil: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const linhas = (await sql<Record<string, unknown>>`
      SELECT pf.perfil, p.form_caption, p.caption
        FROM permissoes p JOIN perfil pf ON pf.codperfil = p.codperfil
       WHERE p.codperfil = ${codperfil} AND p.codempresa = ${emp}
       GROUP BY pf.perfil, p.form_caption, p.caption
       ORDER BY p.form_caption, p.caption`.execute(db)).rows;
    if (!linhas.length) throw new BusinessRuleError('PERFIL_RELATORIO_VAZIO', { codperfil });
    const empresa = await empresaParaRelatorio(db, emp);
    return {
      titulo: 'Relatório de permissões do perfil',
      modelo: await modeloFr3(db, 'PermissaoVinculadaPerfil.fr3'),
      datasets: { FrxDBMaster: linhas.map((l) => registroFr3(l)), FrxDBEmpresa: [empresa], dbdEmpresa: [empresa] },
    };
  }

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async set(codoperador: number, codperfil: number, atribuido: boolean): Promise<{ codoperador: number; codperfil: number; atribuido: boolean }> {
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const oper = await trx.selectFrom('operadores').select('codoperador').where('codoperador', '=', codoperador).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
      if (!oper) throw new BusinessRuleError('OPERADOR_NAO_ENCONTRADO', { codoperador });
      const perf = await trx.selectFrom('perfil').select('codperfil').where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
      if (!perf) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
      if (atribuido) {
        // reativa um vínculo soft-deletado OU cria; o UNIQUE parcial (indr<>E) garante 1 ativo.
        const ex = await trx.selectFrom('relacao_operador_perfil').select(['codrelacao', 'indr']).where('codoperador', '=', codoperador).where('codperfil', '=', codperfil).executeTakeFirst();
        if (ex) {
          await trx.updateTable('relacao_operador_perfil').set({ indr: 'I', usultalteracao: op, dtultimalteracao: sql`now()` }).where('codrelacao', '=', (ex as any).codrelacao).execute();
        } else {
          await trx.insertInto('relacao_operador_perfil').values({ codoperador, codperfil, usucadastro: op, indr: 'I' }).execute();
        }
      } else {
        await trx.updateTable('relacao_operador_perfil').set({ indr: 'E', usultalteracao: op, dtultimalteracao: sql`now()` }).where('codoperador', '=', codoperador).where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E').execute();
      }
      return { codoperador, codperfil, atribuido };
    });
  }
}
