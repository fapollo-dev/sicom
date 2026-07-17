import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { CriarCotacaoDto, LancarPrecosCotacaoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * COTAÇÃO DE COMPRA (uCadCotacao) — corte-1: estrutura + preços (serviço VERTICAL — a árvore 3-4 níveis não cabe no
 * agregado declarativo). Cria a cotação (produtos + qtde por loja + fornecedores convidados); o comprador lança os
 * preços de cada fornecedor (matriz fornecedor×produto). Estado 'A' (Aberta, editável) / 'F' (Fechada). Apuração
 * (GANHADOR) + gerar-pedido = corte-2. Tenant `idempresa` (empresa dona) fail-closed.
 */
@Injectable()
export class CotacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** carrega a cotação do tenant (fail-closed); opcionalmente exige SITUACAO='A' (editável). */
  private async carregar(db: AnyDB, codctc: number, emp: number, exigirAberta = false): Promise<{ codctc: number; situacao: string }> {
    const c = (await db
      .selectFrom('cotacao')
      .select(['codctc', 'situacao'])
      .where('codctc', '=', codctc)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codctc: number; situacao?: string } | undefined;
    if (!c) throw new BusinessRuleError('COTACAO_NAO_ENCONTRADA', { codctc });
    if (exigirAberta && c.situacao !== 'A') throw new BusinessRuleError('COTACAO_FECHADA', { codctc });
    return { codctc, situacao: c.situacao ?? 'A' };
  }

  /** valida que produtos existem e fornecedores são FRN='S' (fail-fast, erros claros). */
  private async validarProdutosFornecedores(db: AnyDB, emp: number, idprodutos: number[], codparceiros: number[]): Promise<void> {
    if (idprodutos.length) {
      const ex = new Set(((await db.selectFrom('produtos').select('idproduto').where('idproduto', 'in', idprodutos).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)));
      for (const id of idprodutos) if (!ex.has(id)) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: id });
    }
    if (codparceiros.length) {
      const forn = new Map<number, string>(
        ((await db.selectFrom('parceiros').select(['codparceiro', 'frn']).where('codparceiro', 'in', codparceiros).where('idempresa', '=', emp).execute()) as Array<{ codparceiro: number; frn?: string }>).map((r) => [Number(r.codparceiro), r.frn ?? 'N']),
      );
      for (const cp of codparceiros) if (forn.get(cp) !== 'S') throw new BusinessRuleError('COTACAO_FORNECEDOR_INVALIDO', { codparceiro: cp });
    }
  }

  /** grava produtos (+ qtde por loja) e fornecedores da cotação (usado no criar e no atualizar). */
  private async gravarArvore(trx: AnyDB, codctc: number, emp: number, dto: Partial<CriarCotacaoDto>): Promise<void> {
    if (dto.produtos) {
      for (const p of dto.produtos) {
        const ins = (await trx
          .insertInto('cotacao_prod')
          .values({ codctc, idproduto: p.idproduto, descricao: p.descricao ?? null, quantidade: num(p.quantidade), fatorembalagem: p.fatorembalagem != null ? num(p.fatorembalagem) : 1, valorcusto: num(p.valorcusto), valorvenda: num(p.valorvenda) })
          .returning('codcpr')
          .executeTakeFirstOrThrow()) as { codcpr: number };
        for (const q of p.qtdes ?? []) {
          await trx.insertInto('cotacao_prodqtde').values({ codcpr: Number(ins.codcpr), idempresa: Number(q.idempresa), qtde: num(q.qtde) }).execute();
        }
      }
    }
    if (dto.fornecedores) {
      for (const f of dto.fornecedores) {
        await trx
          .insertInto('cotacao_forn')
          .values({ codctc, codparceiro: f.codparceiro, participa_apuracao: f.participa_apuracao ?? 'S', datavalidade: f.datavalidade ?? null, obs: f.obs ?? null })
          .execute();
      }
    }
  }

  /** cria a cotação (header + produtos + qtde/loja + fornecedores), estado 'A'. */
  async criar(dto: CriarCotacaoDto): Promise<{ codctc: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.validarProdutosFornecedores(db, emp, dto.produtos.map((p) => p.idproduto), dto.fornecedores.map((f) => f.codparceiro));
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = (await trx
        .insertInto('cotacao')
        .values({ idempresa: emp, descricao: dto.descricao ?? null, situacao: 'A', flg_origem: dto.flg_origem ?? 'C', dtinicio_preenchimento: dto.dtinicio_preenchimento ?? null, dtfim_preenchimento: dto.dtfim_preenchimento ?? null, codoperador: op, dtcadastro: sql`now()` })
        .returning('codctc')
        .executeTakeFirstOrThrow()) as { codctc: number };
      await this.gravarArvore(trx, Number(c.codctc), emp, dto);
      return { codctc: Number(c.codctc) };
    });
  }

  /**
   * atualiza a cotação (só Aberta) por DELTA (fold auditoria [ALTA]): produtos/fornecedores são casados pela chave
   * natural (idproduto / codparceiro) — os INALTERADOS mantêm seu codcpr/codctcforn (e portanto os PREÇOS já
   * lançados sobrevivem); os NOVOS entram; os REMOVIDOS caem (com seus preços por CASCADE — correto, saíram da
   * cotação). Espelha o ApplyUpdates delta do legado, NÃO o full-delete que apagava a matriz inteira. `descricao`
   * só é gravada se veio no dto (fold [MÉDIA]: update parcial não a zera).
   */
  async atualizar(codctc: number, dto: Partial<CriarCotacaoDto>): Promise<{ codctc: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.validarProdutosFornecedores(db, emp, (dto.produtos ?? []).map((p) => p.idproduto), (dto.fornecedores ?? []).map((f) => f.codparceiro));
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregar(trx, codctc, emp, true);
      const set: Record<string, unknown> = { usultalteracao: op, dtultimalteracao: sql`now()` };
      if (dto.descricao !== undefined) set.descricao = dto.descricao ?? null; // só zera/altera se veio
      await trx.updateTable('cotacao').set(set).where('codctc', '=', codctc).where('idempresa', '=', emp).execute();

      if (dto.produtos) {
        const existentes = (await trx.selectFrom('cotacao_prod').select(['codcpr', 'idproduto']).where('codctc', '=', codctc).execute()) as Array<{ codcpr: number; idproduto: number }>;
        const porProduto = new Map(existentes.map((e) => [Number(e.idproduto), Number(e.codcpr)]));
        const novos = new Set(dto.produtos.map((p) => Number(p.idproduto)));
        const remover = existentes.filter((e) => !novos.has(Number(e.idproduto))).map((e) => Number(e.codcpr));
        if (remover.length) await trx.deleteFrom('cotacao_prod').where('codcpr', 'in', remover).execute(); // cascade: prodqtde + preços do produto removido
        for (const p of dto.produtos) {
          const codcpr = porProduto.get(Number(p.idproduto));
          const campos = { descricao: p.descricao ?? null, quantidade: num(p.quantidade), fatorembalagem: p.fatorembalagem != null ? num(p.fatorembalagem) : 1, valorcusto: num(p.valorcusto), valorvenda: num(p.valorvenda) };
          let cpr = codcpr;
          if (cpr != null) {
            await trx.updateTable('cotacao_prod').set(campos).where('codcpr', '=', cpr).execute(); // mantém codcpr → preços sobrevivem
          } else {
            cpr = Number(((await trx.insertInto('cotacao_prod').values({ codctc, idproduto: p.idproduto, ...campos }).returning('codcpr').executeTakeFirstOrThrow()) as { codcpr: number }).codcpr);
          }
          await trx.deleteFrom('cotacao_prodqtde').where('codcpr', '=', cpr).execute(); // qtde/loja: substitui (sem preços a jusante)
          for (const q of p.qtdes ?? []) await trx.insertInto('cotacao_prodqtde').values({ codcpr: cpr, idempresa: Number(q.idempresa), qtde: num(q.qtde) }).execute();
        }
      }

      if (dto.fornecedores) {
        const existentes = (await trx.selectFrom('cotacao_forn').select(['codctcforn', 'codparceiro']).where('codctc', '=', codctc).execute()) as Array<{ codctcforn: number; codparceiro: number }>;
        const porParceiro = new Map(existentes.map((e) => [Number(e.codparceiro), Number(e.codctcforn)]));
        const novos = new Set(dto.fornecedores.map((f) => Number(f.codparceiro)));
        const remover = existentes.filter((e) => !novos.has(Number(e.codparceiro))).map((e) => Number(e.codctcforn));
        if (remover.length) await trx.deleteFrom('cotacao_forn').where('codctcforn', 'in', remover).execute(); // cascade: preços do fornecedor removido
        for (const f of dto.fornecedores) {
          const codctcforn = porParceiro.get(Number(f.codparceiro));
          const campos = { participa_apuracao: f.participa_apuracao ?? 'S', datavalidade: f.datavalidade ?? null, obs: f.obs ?? null };
          if (codctcforn != null) await trx.updateTable('cotacao_forn').set(campos).where('codctcforn', '=', codctcforn).execute(); // mantém codctcforn → preços sobrevivem
          else await trx.insertInto('cotacao_forn').values({ codctc, codparceiro: f.codparceiro, ...campos }).execute();
        }
      }
      return { codctc };
    });
  }

  /** exclui (soft-delete) a cotação — só Aberta (fold auditoria: consome o grant BTNEXCLUIR). */
  async excluir(codctc: number): Promise<{ codctc: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await this.carregar(this.dbp.forTenantRead() as AnyDB, codctc, emp, true);
    await (this.dbp.forTenant() as AnyDB)
      .updateTable('cotacao').set({ indr: 'E', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codctc', '=', codctc).where('idempresa', '=', emp).execute();
    return { codctc };
  }

  /** lança/atualiza os preços de UM fornecedor (upsert na matriz). Só com a cotação Aberta. */
  async lancarPrecos(codctc: number, dto: LancarPrecosCotacaoDto): Promise<{ codctc: number; codparceiro: number; itens: number }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregar(trx, codctc, emp, true);
      // o fornecedor tem de estar CONVIDADO na cotação.
      const forn = (await trx.selectFrom('cotacao_forn').select('codctcforn').where('codctc', '=', codctc).where('codparceiro', '=', dto.codparceiro).executeTakeFirst()) as { codctcforn: number } | undefined;
      if (!forn) throw new BusinessRuleError('COTACAO_FORNECEDOR_NAO_CONVIDADO', { codparceiro: dto.codparceiro });
      // mapa produto→(codcpr, quantidade) da cotação — só os produtos cotados aceitam preço; quantidade p/ o total.
      const prods = new Map<number, { codcpr: number; quantidade: number }>(
        ((await trx.selectFrom('cotacao_prod').select(['codcpr', 'idproduto', 'quantidade']).where('codctc', '=', codctc).execute()) as Array<{ codcpr: number; idproduto: number; quantidade: unknown }>).map((r) => [Number(r.idproduto), { codcpr: Number(r.codcpr), quantidade: num(r.quantidade) }]),
      );
      let n = 0;
      for (const it of dto.itens) {
        const prod = prods.get(Number(it.idproduto));
        if (prod == null) throw new BusinessRuleError('COTACAO_PRODUTO_NAO_COTADO', { idproduto: it.idproduto });
        const valor = num(it.valor);
        const fator = it.fatorembalagem != null ? num(it.fatorembalagem) : 1;
        const valorembal = it.valorembal != null ? num(it.valorembal) : r4(valor * fator);
        const valortotal = r4(prod.quantidade * valorembal); // fiel: VALORTOTAL = QUANTIDADE × VALOREMBAL (uCadCotacaoForn:224)
        await trx
          .insertInto('cotacao_forn_itens')
          .values({ codctcforn: Number(forn.codctcforn), codcpr: prod.codcpr, valor, valorembal, valortotal, fatorembalagem: fator, icms: num(it.icms), ganhador: 'I', definido: 'N', verificado: 'N', datamanut: sql`now()` })
          .onConflict((oc: any) => oc.columns(['codctcforn', 'codcpr']).doUpdateSet({ valor, valorembal, valortotal, fatorembalagem: fator, icms: num(it.icms), datamanut: sql`now()` }))
          .execute();
        n++;
      }
      return { codctc, codparceiro: dto.codparceiro, itens: n };
    });
  }

  /** fecha a cotação (Aberta → Fechada). CAS anti-corrida. */
  async fechar(codctc: number): Promise<{ codctc: number; situacao: 'F' }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const upd = await (this.dbp.forTenant() as AnyDB)
      .updateTable('cotacao').set({ situacao: 'F', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codctc', '=', codctc).where('idempresa', '=', emp).where('situacao', '=', 'A').where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst();
    if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) {
      await this.carregar(this.dbp.forTenantRead() as AnyDB, codctc, emp); // 404 se não existe; senão já estava fechada
      throw new BusinessRuleError('COTACAO_JA_FECHADA', { codctc });
    }
    return { codctc, situacao: 'F' };
  }

  /** reabre a cotação (Fechada → Aberta). No corte-2 reabrir também zera a apuração (GANHADOR). */
  async reabrir(codctc: number): Promise<{ codctc: number; situacao: 'A' }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const upd = await (this.dbp.forTenant() as AnyDB)
      .updateTable('cotacao').set({ situacao: 'A', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codctc', '=', codctc).where('idempresa', '=', emp).where('situacao', '=', 'F').where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst();
    if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) {
      await this.carregar(this.dbp.forTenantRead() as AnyDB, codctc, emp);
      throw new BusinessRuleError('COTACAO_NAO_FECHADA', { codctc });
    }
    return { codctc, situacao: 'A' };
  }

  /** lista as cotações do tenant (view get_cotacao). */
  async listar(): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('get_cotacao').selectAll().where('idempresa', '=', emp).where(sql`coalesce(indr,'I')`, '<>', 'E')
      .orderBy('codctc', 'desc').limit(500).execute();
  }

  /** lê a cotação completa (header + produtos[+qtdes] + fornecedores + matriz de preços). */
  async obter(codctc: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const header = (await db.selectFrom('get_cotacao').selectAll().where('codctc', '=', codctc).where('idempresa', '=', emp).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!header) throw new BusinessRuleError('COTACAO_NAO_ENCONTRADA', { codctc });
    const produtos = (await db.selectFrom('cotacao_prod').selectAll().where('codctc', '=', codctc).orderBy('codcpr').execute()) as Array<Record<string, unknown>>;
    const codcprs = produtos.map((p) => Number(p.codcpr));
    const qtdes = codcprs.length ? ((await db.selectFrom('cotacao_prodqtde').selectAll().where('codcpr', 'in', codcprs).execute()) as Array<Record<string, unknown>>) : [];
    const fornecedores = (await db.selectFrom('cotacao_forn').selectAll().where('codctc', '=', codctc).orderBy('codctcforn').execute()) as Array<Record<string, unknown>>;
    const codfornos = fornecedores.map((f) => Number(f.codctcforn));
    const precos = codfornos.length ? ((await db.selectFrom('cotacao_forn_itens').selectAll().where('codctcforn', 'in', codfornos).execute()) as Array<Record<string, unknown>>) : [];
    return {
      ...header,
      produtos: produtos.map((p) => ({ ...p, qtdes: qtdes.filter((q) => Number(q.codcpr) === Number(p.codcpr)) })),
      fornecedores,
      precos,
    };
  }
}
