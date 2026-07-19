import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { CriarCotacaoDto, LancarPrecosCotacaoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { pedidoCompraAggregateConfig } from './pedido-compra.aggregate';
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
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly engine: AggregateEngineService,
  ) {}

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

  /**
   * reabre a cotação (Fechada → Aberta) e ZERA a apuração automática (fold auditoria [MÉDIA]: honra o docstring e
   * elimina vencedor OBSOLETO sobrevivendo à reabertura). Zera GANHADOR/VERIFICADO de todos os itens → o gerar-pedido
   * volta a exigir reapuração. MANTÉM a escolha manual (DEFINIDO) e o log PEDIDOS (a anti-regeração continua a proteger
   * contra pedidos duplicados quando a cotação já os gerou).
   */
  async reabrir(codctc: number): Promise<{ codctc: number; situacao: 'A' }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const upd = await trx
        .updateTable('cotacao').set({ situacao: 'A', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codctc', '=', codctc).where('idempresa', '=', emp).where('situacao', '=', 'F').where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) {
        await this.carregar(trx, codctc, emp);
        throw new BusinessRuleError('COTACAO_NAO_FECHADA', { codctc });
      }
      const cprs = ((await trx.selectFrom('cotacao_prod').select('codcpr').where('codctc', '=', codctc).execute()) as Array<{ codcpr: number }>).map((r) => Number(r.codcpr));
      if (cprs.length) await trx.updateTable('cotacao_forn_itens').set({ ganhador: 'I', verificado: 'N' }).where('codcpr', 'in', cprs).execute();
      return { codctc, situacao: 'A' as const };
    });
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

  // ─────────────────────────── corte-2: APURAÇÃO + GERAR-PEDIDO ───────────────────────────

  /**
   * APURA o vencedor por PRODUTO (fiel a SetaFornecedorGanhador, uCadCotacao:3005): entre os fornecedores que
   * PARTICIPA_APURACAO='S' e cotaram (valor>0), o vencedor tem o menor VALOR_LIQ = valor − valor×icms/100. A
   * escolha manual (DEFINIDO='S') SOBREVIVE à reapuração. Empate → o primeiro por codctcforn (determinístico; o
   * legado abre diálogo manual — divergência CONSCIENTE). Grava GANHADOR='A'/'I' + VERIFICADO='S'. Só Aberta.
   */
  async apurar(codctc: number): Promise<{ codctc: number; produtos: number; vencedores: number }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregar(trx, codctc, emp, true);
      const prods = (await trx.selectFrom('cotacao_prod').select('codcpr').where('codctc', '=', codctc).execute()) as Array<{ codcpr: number }>;
      let venc = 0;
      for (const p of prods) {
        const codcpr = Number(p.codcpr);
        // candidatos: participa da apuração + cotou (valor>0), ordenados por VALOR_LIQ (menor primeiro), tiebreak codctcforn.
        const itens = (await trx
          .selectFrom('cotacao_forn_itens as fi')
          .innerJoin('cotacao_forn as f', 'f.codctcforn', 'fi.codctcforn')
          .select(['fi.codctcfit as codctcfit'])
          .where('fi.codcpr', '=', codcpr)
          .where('f.codctc', '=', codctc)
          .where(sql`coalesce(f.participa_apuracao,'S')`, '=', 'S')
          .where('fi.valor', '>', 0)
          .orderBy(sql`fi.valor - fi.valor * coalesce(fi.icms,0)/100`, 'asc')
          .orderBy('fi.codctcforn', 'asc')
          .execute()) as Array<{ codctcfit: number }>;
        // reset da apuração do produto (mantém DEFINIDO — manual sobrevive); marca verificado.
        await trx.updateTable('cotacao_forn_itens').set({ ganhador: 'I', verificado: 'S' }).where('codcpr', '=', codcpr).execute();
        // fold auditoria [MÉDIA]: a escolha MANUAL (definido='S') sobrevive à reapuração INDEPENDENTE de
        // PARTICIPA_APURACAO — o comprador pode travar um fornecedor que fica FORA da apuração automática (participa='N').
        // Por isso o manual é buscado em TODOS os itens do produto, não só na lista de candidatos participantes.
        const manual = (await trx.selectFrom('cotacao_forn_itens').select('codctcfit').where('codcpr', '=', codcpr).where('definido', '=', 'S').where('valor', '>', 0).executeTakeFirst()) as { codctcfit: number } | undefined;
        const winner = manual ?? itens[0];
        if (winner) {
          await trx.updateTable('cotacao_forn_itens').set({ ganhador: 'A' }).where('codctcfit', '=', Number(winner.codctcfit)).execute();
          venc++;
        }
      }
      return { codctc, produtos: prods.length, vencedores: venc };
    });
  }

  /** define MANUALMENTE o vencedor de um produto (F5, DEFINIDO='S' — sobrevive à reapuração). Só Aberta. */
  async definirGanhador(codctc: number, dto: { idproduto: number; codparceiro: number }): Promise<{ codctc: number; idproduto: number; codparceiro: number }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregar(trx, codctc, emp, true);
      const cpr = (await trx.selectFrom('cotacao_prod').select('codcpr').where('codctc', '=', codctc).where('idproduto', '=', dto.idproduto).executeTakeFirst()) as { codcpr: number } | undefined;
      if (!cpr) throw new BusinessRuleError('COTACAO_PRODUTO_NAO_COTADO', { idproduto: dto.idproduto });
      const forn = (await trx.selectFrom('cotacao_forn').select('codctcforn').where('codctc', '=', codctc).where('codparceiro', '=', dto.codparceiro).executeTakeFirst()) as { codctcforn: number } | undefined;
      if (!forn) throw new BusinessRuleError('COTACAO_FORNECEDOR_NAO_CONVIDADO', { codparceiro: dto.codparceiro });
      const item = (await trx.selectFrom('cotacao_forn_itens').select('codctcfit').where('codctcforn', '=', Number(forn.codctcforn)).where('codcpr', '=', Number(cpr.codcpr)).where('valor', '>', 0).executeTakeFirst()) as { codctcfit: number } | undefined;
      if (!item) throw new BusinessRuleError('COTACAO_SEM_PRECO', { idproduto: dto.idproduto, codparceiro: dto.codparceiro });
      await trx.updateTable('cotacao_forn_itens').set({ ganhador: 'I', definido: 'N' }).where('codcpr', '=', Number(cpr.codcpr)).execute();
      await trx.updateTable('cotacao_forn_itens').set({ ganhador: 'A', definido: 'S', verificado: 'S' }).where('codctcfit', '=', Number(item.codctcfit)).execute();
      return { codctc, idproduto: dto.idproduto, codparceiro: dto.codparceiro };
    });
  }

  /**
   * GERA os PEDIDOS de compra da apuração (fiel a GerarPedido, uCadCotacao:1663): 1 PEDIDOCOMPRA por FORNECEDOR
   * VENCEDOR (agrupa os itens ganhos por ele), reusando o agregado do pedido-compra (createAggregate). Fluxo:
   *  1) CLAIM atômico (CAS `situacao 'A'→'F'` só com PEDIDOS vazio) — fold auditoria [ALTA]: fecha a corrida
   *     duplo-clique/retry (duas chamadas concorrentes: só uma flipa; a outra cai em JA_GERADOS/FECHADA). Já
   *     reservada (F), nenhuma apuração/edição concorrente roda (todas exigem Aberta) → as leituras abaixo são estáveis.
   *  2) apuração completa (todo produto com cotação válida tem vencedor) + itens vencedores → sem vencedor/incompleto
   *     faz ROLLBACK do claim ('F'→'A') e reabre para o comprador corrigir.
   *  3) gera os pedidos (flag `_sistema` → o GerarPedido do legado insere DIRETO, sem os gates interativos do
   *     btnGravar do pedido: condição-obrigatória / pendências-fornecedor / prazo). O FATOR de embalagem e o custo
   *     vêm da PROPOSTA VENCEDORA (cotacao_forn_itens), não do snapshot do produto — fold auditoria [MÉDIA].
   *  4) grava COTACAO.PEDIDOS (log). A cotação já está 'F' (claim).
   * Residual documentado: cada createAggregate é sua própria trx (como o recebimento) → falha parcial no meio do
   * loop deixa pedidos órfãos com a cotação 'F' sem PEDIDOS (re-run bloqueia em FECHADA — SEM duplicar); recuperar
   * exige reabrir manual. Split multi-loja (COTACAO_PRODQTDE → PEDIDO_COMPRA_QTDE) ADIADO (alinha com o cross-docking).
   */
  async gerarPedido(codctc: number): Promise<{ codctc: number; pedidos: number[] }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const dbw = this.dbp.forTenant() as AnyDB;

    // (1) CLAIM atômico: só UMA chamada flipa A→F com PEDIDOS vazio (anti-corrida / anti-dupla-geração).
    const claim = await dbw
      .updateTable('cotacao').set({ situacao: 'F', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codctc', '=', codctc).where('idempresa', '=', emp).where('situacao', '=', 'A').where(sql`coalesce(pedidos,'')`, '=', '').where(sql`coalesce(indr,'I')`, '<>', 'E')
      .returning('codctc').executeTakeFirst();
    if (!claim) {
      const c = (await (this.dbp.forTenantRead() as AnyDB).selectFrom('cotacao').select(['pedidos', 'situacao', 'indr']).where('codctc', '=', codctc).where('idempresa', '=', emp).executeTakeFirst()) as { pedidos?: string; situacao?: string; indr?: string } | undefined;
      if (!c || c.indr === 'E') throw new BusinessRuleError('COTACAO_NAO_ENCONTRADA', { codctc });
      if ((c.pedidos ?? '').trim()) throw new BusinessRuleError('COTACAO_PEDIDOS_JA_GERADOS', { codctc }); // anti-regeração
      throw new BusinessRuleError('COTACAO_FECHADA', { codctc }); // fechada manualmente sem pedidos → reabra p/ gerar
    }
    const rollback = () =>
      dbw.updateTable('cotacao').set({ situacao: 'A' }).where('codctc', '=', codctc).where('idempresa', '=', emp).where(sql`coalesce(pedidos,'')`, '=', '').execute();

    // guardas pré-geração fazem rollback do claim; falha DENTRO do loop de geração mantém 'F' de propósito
    // (re-run cai em FECHADA — impede duplicar os pedidos já commitados; recuperação = reabrir manual).
    {
      const db = this.dbp.forTenantRead() as AnyDB;
      // (2) apuração completa: nenhum produto COM cotação válida (participa+valor>0) pode estar SEM vencedor.
      const semVencedor = Number(((await db
        .selectFrom('cotacao_prod as p')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('p.codctc', '=', codctc)
        .where((eb) => eb.exists(eb.selectFrom('cotacao_forn_itens as fi').innerJoin('cotacao_forn as f', 'f.codctcforn', 'fi.codctcforn').select(sql`1`.as('x')).whereRef('fi.codcpr', '=', 'p.codcpr').where(sql`coalesce(f.participa_apuracao,'S')`, '=', 'S').where('fi.valor', '>', 0)))
        .where((eb) => eb.not(eb.exists(eb.selectFrom('cotacao_forn_itens as fi2').select(sql`1`.as('x')).whereRef('fi2.codcpr', '=', 'p.codcpr').where('fi2.ganhador', '=', 'A'))))
        .executeTakeFirst()) as { n?: unknown } | undefined)?.n ?? 0);
      if (semVencedor > 0) {
        await rollback();
        throw new BusinessRuleError('COTACAO_APURACAO_INCOMPLETA', { produtos_sem_vencedor: semVencedor });
      }

      // itens vencedores (GANHADOR='A'): FATOR + valor da PROPOSTA vencedora (fi), quantidade do produto (p).
      const ganhos = (await db
        .selectFrom('cotacao_forn_itens as fi')
        .innerJoin('cotacao_forn as f', 'f.codctcforn', 'fi.codctcforn')
        .innerJoin('cotacao_prod as p', 'p.codcpr', 'fi.codcpr')
        .select(['f.codparceiro as codparceiro', 'p.idproduto as idproduto', 'p.quantidade as quantidade', 'fi.fatorembalagem as fatorembalagem', 'fi.valor as valor'])
        .where('f.codctc', '=', codctc)
        .where('fi.ganhador', '=', 'A')
        .orderBy('f.codparceiro')
        .execute()) as Array<{ codparceiro: number; idproduto: number; quantidade: unknown; fatorembalagem: unknown; valor: unknown }>;
      if (!ganhos.length) {
        await rollback();
        throw new BusinessRuleError('COTACAO_SEM_VENCEDOR', { codctc }); // apure antes
      }

      // agrupa por fornecedor → 1 pedido cada (reusa o agregado; deriva vlrembalagem/qtdtotal/totalcusto).
      const porForn = new Map<number, Array<{ idproduto: number; qtde: number; fatorembalagem: number; vrcusto: number }>>();
      for (const g of ganhos) {
        const arr = porForn.get(Number(g.codparceiro)) ?? [];
        arr.push({ idproduto: Number(g.idproduto), qtde: num(g.quantidade) > 0 ? num(g.quantidade) : 1, fatorembalagem: num(g.fatorembalagem) > 0 ? num(g.fatorembalagem) : 1, vrcusto: num(g.valor) });
        porForn.set(Number(g.codparceiro), arr);
      }
      // (3) gera — `_sistema:true` faz o agregado PULAR os gates interativos do btnGravar (o GerarPedido insere direto).
      const hoje = new Date().toISOString().slice(0, 10);
      const pedidos: number[] = [];
      for (const [codparceiro, itens] of porForn) {
        const codpedcomp = await this.engine.createAggregate(pedidoCompraAggregateConfig, { codparceiro, data: hoje, itens, _sistema: true });
        pedidos.push(Number(codpedcomp));
      }
      // (4) grava o log dos pedidos (a cotação já está 'F' pelo claim).
      await dbw.updateTable('cotacao').set({ pedidos: `Pedidos: ${pedidos.join(', ')}` }).where('codctc', '=', codctc).where('idempresa', '=', emp).execute();
      return { codctc, pedidos };
    }
  }
}
