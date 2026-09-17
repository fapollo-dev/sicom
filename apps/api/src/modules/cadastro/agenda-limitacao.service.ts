import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { AdicionarProdutosDto, AgendaLimitacaoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * AGENDA DE LIMITAÇÃO DE VENDA (`FRMCADAGENDALIMITACAOVENDA`). **51 acessos, 6 operadores.**
 * Migration 235. Dossiê: `uCadAgendaLimitacaoVenda.md`.
 *
 * Limita **quanto de um produto cada cliente pode levar** num período. No cliente o uso é sazonal e casado
 * com o "DIA D": das 11 agendas, 8 têm o nome ligado a ele e as outras limitam um item que sumiu da praça
 * (`HEINEKEN`, `LEITE PORTO ALEGRE 1L`). 92 itens no total, a maior com 41 produtos.
 *
 * ── As travas do legado ───────────────────────────────────────────────────────────────────────────────
 * ⚠️ **agenda FECHADA não se altera** (`'Agenda Fechada. Impossível alterar.'`, `:147`). No cliente as 11
 *    estão fechadas, porque todas já passaram.
 * ⚠️ **sem empresas participantes não se adiciona item** (`'Selecione as Empresas participantes'`, `:136`) —
 *    uma limitação sem loja não limita nada.
 * ⚠️ **o produto não entra duas vezes**: o pesquisador do legado monta `NOT (CODIGO IN (...))` com o que já
 *    está na agenda (`:97`).
 * ⚠️ **só produto ATIVO e que não seja item de composição** (`ATIVO='S' AND IMPRIMIRCOMP='N'`, `:104`).
 *
 * ⚠️ **`CODGRUPO` do item é o grupo de PREÇO** (`COD_GRUPOPRECO`, `:119`), não o de produto — e é com ele que
 * o flag `ATUALIZACAO_GRUPO='S'` estende a limitação à família inteira.
 */
@Injectable()
export class AgendaLimitacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(p: { abertas?: boolean }): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT a.codagenda_produto, a.descricao, a.dtinicio, a.dtfim, a.tipo, a.estatus, a.empresas,
             (SELECT count(*) FROM agenda_produto_item i WHERE i.codagenda_produto = a.codagenda_produto)::int AS itens
        FROM agenda_produto a
       WHERE a.codempresa = ${emp}
         AND (${p.abertas ?? false}::boolean = false OR coalesce(a.estatus, 'A') = 'A')
       ORDER BY a.dtinicio DESC, a.codagenda_produto DESC
    `.execute(db)).rows;
  }

  async obter(cod: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cab = (await sql<Record<string, unknown>>`
      SELECT * FROM agenda_produto WHERE codagenda_produto = ${cod} AND codempresa = ${emp}
    `.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('AGENDA_NAO_ENCONTRADA', { cod });
    const itens = (await sql<Record<string, unknown>>`
      SELECT i.codagenda_produto_item, i.idproduto, i.quantidade, i.atualizacao_grupo, i.codgrupo, i.ativo,
             p.codbarra, p.descricao AS dsprod,
             -- não existe cadastro de grupo de preço no legado: o CODGRUPOPRECO é um número agrupador, e o
             -- que identifica a família é quantos produtos o compartilham
             (SELECT count(*) FROM produtos q WHERE q.codgrupopreco = i.codgrupo)::int AS produtos_no_grupo
        FROM agenda_produto_item i
        LEFT JOIN produtos p ON p.idproduto = i.idproduto
       WHERE i.codagenda_produto = ${cod}
       ORDER BY p.descricao
    `.execute(db)).rows;
    return { ...cab, itens };
  }

  async criar(dto: AgendaLimitacaoDto, operador: number | null): Promise<{ codagenda_produto: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const r = (await sql<{ codagenda_produto: number }>`
        INSERT INTO agenda_produto (codempresa, descricao, dtinicio, dtfim, tipo, estatus, empresas,
                                    usultalteracao, dtultimalteracao)
        VALUES (${emp}, ${dto.descricao}, ${dto.dtinicio}::date, ${dto.dtfim}::date, ${dto.tipo},
                ${dto.estatus}, ${dto.empresas}, ${operador}, now())
        RETURNING codagenda_produto
      `.execute(trx)).rows[0];
      const cod = Number(r.codagenda_produto);
      for (const i of dto.itens) await this.inserirItem(trx, cod, i.idproduto, i.quantidade, i.atualizacao_grupo, operador);
      return { codagenda_produto: cod };
    });
  }

  async atualizar(cod: number, dto: AgendaLimitacaoDto, operador: number | null): Promise<{ codagenda_produto: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertAberta(trx, cod, emp);
      await sql`
        UPDATE agenda_produto
           SET descricao = ${dto.descricao}, dtinicio = ${dto.dtinicio}::date, dtfim = ${dto.dtfim}::date,
               tipo = ${dto.tipo}, estatus = ${dto.estatus}, empresas = ${dto.empresas},
               usultalteracao = ${operador}, dtultimalteracao = now()
         WHERE codagenda_produto = ${cod} AND codempresa = ${emp}
      `.execute(trx);
      return { codagenda_produto: cod };
    });
  }

  /** `btnAdicionarItemClick` :80 — escolhe N produtos e todos entram com a MESMA quantidade padrão. */
  async adicionarProdutos(cod: number, dto: AdicionarProdutosDto, operador: number | null): Promise<{ adicionados: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertAberta(trx, cod, emp);
      // ⚠️ o pesquisador do legado só oferece produto ATIVO que não seja item de composição (`:104`)
      const validos = (await sql<{ idproduto: number }>`
        SELECT idproduto FROM produtos
         WHERE idproduto = ANY(${dto.idprodutos}::int[])
           AND coalesce(ativo, 'S') = 'S' AND coalesce(imprimircomp, 'N') = 'N'
      `.execute(trx)).rows.map((r) => Number(r.idproduto));
      const recusados = dto.idprodutos.filter((p) => !validos.includes(Number(p)));
      if (recusados.length) throw new BusinessRuleError('PRODUTO_NAO_ELEGIVEL', { produtos: recusados.slice(0, 20) });

      let n = 0;
      for (const idproduto of validos) {
        const ja = (await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM agenda_produto_item
           WHERE codagenda_produto = ${cod} AND idproduto = ${idproduto}
        `.execute(trx)).rows[0];
        if (Number(ja?.n)) continue; // o legado simplesmente não o oferece de novo
        await this.inserirItem(trx, cod, idproduto, dto.quantidade, 'N', operador);
        n += 1;
      }
      return { adicionados: n };
    });
  }

  async alterarItem(
    cod: number, item: number, dados: { quantidade?: number; atualizacao_grupo?: 'S' | 'N'; ativo?: 'S' | 'N' },
  ): Promise<{ codagenda_produto_item: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertAberta(trx, cod, emp);
      const r = await sql`
        UPDATE agenda_produto_item
           SET quantidade        = coalesce(${dados.quantidade ?? null}::numeric, quantidade),
               atualizacao_grupo = coalesce(${dados.atualizacao_grupo ?? null}::char(1), atualizacao_grupo),
               ativo             = coalesce(${dados.ativo ?? null}::char(1), ativo),
               dtultimalteracao  = now()
         WHERE codagenda_produto_item = ${item} AND codagenda_produto = ${cod}
      `.execute(trx);
      if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('AGENDA_ITEM_NAO_ENCONTRADO', { item });
      return { codagenda_produto_item: item };
    });
  }

  async excluirItem(cod: number, item: number): Promise<{ codagenda_produto_item: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertAberta(trx, cod, emp);
      await sql`DELETE FROM agenda_produto_item WHERE codagenda_produto_item = ${item} AND codagenda_produto = ${cod}`.execute(trx);
      return { codagenda_produto_item: item };
    });
  }

  async excluir(cod: number): Promise<{ codagenda_produto: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertAberta(trx, cod, emp);
      await sql`DELETE FROM agenda_produto WHERE codagenda_produto = ${cod} AND codempresa = ${emp}`.execute(trx);
      return { codagenda_produto: cod };
    });
  }

  /** ⚠️ `btnEditarClick` :147 — `'Agenda Fechada. Impossível alterar.'` */
  private async assertAberta(trx: AnyDB, cod: number, emp: number): Promise<void> {
    const a = (await sql<{ estatus: string; empresas: string | null }>`
      SELECT estatus, empresas FROM agenda_produto WHERE codagenda_produto = ${cod} AND codempresa = ${emp}
    `.execute(trx)).rows[0];
    if (!a) throw new BusinessRuleError('AGENDA_NAO_ENCONTRADA', { cod });
    if (String(a.estatus ?? 'A') === 'F') throw new BusinessRuleError('AGENDA_FECHADA', { cod });
    // ⚠️ `:136` — uma limitação sem loja participante não limita nada
    if (!String(a.empresas ?? '').trim()) throw new BusinessRuleError('AGENDA_SEM_EMPRESAS', { cod });
  }

  private async inserirItem(
    trx: AnyDB, cod: number, idproduto: number, quantidade: number, grupo: 'S' | 'N', operador: number | null,
  ): Promise<void> {
    // ⚠️ o CODGRUPO do item é o grupo de PREÇO (`COD_GRUPOPRECO`, :119), não o grupo de produto
    await sql`
      INSERT INTO agenda_produto_item (codagenda_produto, idproduto, quantidade, atualizacao_grupo, codgrupo,
                                       ativo, usultalteracao, dtultimalteracao)
      SELECT ${cod}, ${idproduto}, ${quantidade}, ${grupo}, p.codgrupopreco, 'S', ${operador}, now()
        FROM produtos p WHERE p.idproduto = ${idproduto}
    `.execute(trx);
  }
}
