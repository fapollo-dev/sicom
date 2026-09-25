import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** conteúdo computado de UMA etiqueta (server-authoritative). O preço IMPRESSO é `valor_venda_promocao`. */
export interface Etiqueta {
  idetiqueta?: number;
  idproduto: number;
  codbarra: string | null;
  descricao: string;
  unidade: string | null;
  fator: number;
  qtde: number;
  valor_venda: number; // VRVENDA × fator
  valor_promocao: number; // (PROMOCAO='S') ? VRPROMO × fator : 0
  valor_venda_promocao: number; // preço IMPRESSO: (PROMOCAO='S') ? VRPROMO × fator : VRVENDA × fator
  promocao: string; // 'S'/'N'
}

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA) — corte-1. `fila`: pendentes (IMPRESSA='N') da EMPRESA (fiel: não filtra
 * operador). `montar`: computa o conteúdo da etiqueta SERVER-AUTHORITATIVE — VALOR_VENDA = VRVENDA×fator;
 * VALOR_VENDA_PROMOCAO (o preço impresso) = (PROMOCAO='S' ? VRPROMO : VRVENDA)×fator, lido do MULTI_PRECO já
 * denormalizado (NÃO reconsulta as tabelas de promoção — fiel a Uetiqueta.pas:9-13). `adicionar`: enfileira um
 * produto (por id ou codbarra). `imprimir`: grava o log web + marca a fila IMPRESSA='S' + MULTI_PRECO.ETQ_IMPRESSA='S'
 * e devolve as etiquetas p/ o layout imprimível. Tenant fail-closed por idempresa.
 */
@Injectable()
export class EtiquetaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** computa o conteúdo da etiqueta a partir da linha crua (view/produto). O preço vem de MULTI_PRECO × fator.
   *  `fatorOverride` = fator de embalagem do código auxiliar (caixa) quando o scan foi por codbarra aux. */
  private montar(row: Record<string, unknown>, qtde?: number, descricaoOverride?: string, fatorOverride?: number): Etiqueta {
    const fator = fatorOverride != null && fatorOverride > 0 ? fatorOverride : num(row.fator) > 0 ? num(row.fator) : 1;
    const vrvenda = num(row.vrvenda);
    const vrpromo = num(row.vrpromo);
    // fold auditoria [MÉDIA]: promo só é VÁLIDA se houver preço promo > 0. Senão (flag 'S' com vrpromo nulo/0) o
    // servidor, o log e o papel divergiam (tela mostrava R$0,00⚡, papel caía p/ o preço de venda). Trata como sem-promo.
    const promo = String(row.promocao ?? 'N') === 'S' && vrpromo > 0;
    const valorVenda = r2(vrvenda * fator);
    const valorPromocao = promo ? r2(vrpromo * fator) : 0;
    const q = qtde != null ? qtde : num(row.qtde_etiquetas) > 0 ? num(row.qtde_etiquetas) : 1;
    const descricao = (descricaoOverride && descricaoOverride.trim()) || String(row.descricao_produto ?? row.descricao ?? '').trim();
    return {
      idetiqueta: row.idetiqueta != null ? Number(row.idetiqueta) : undefined,
      idproduto: Number(row.idproduto),
      codbarra: (row.codbarra as string) ?? null,
      descricao,
      unidade: (row.unidade as string) ?? null,
      fator,
      qtde: q,
      valor_venda: valorVenda,
      valor_promocao: valorPromocao,
      valor_venda_promocao: promo ? valorPromocao : valorVenda, // o preço IMPRESSO
      promocao: promo ? 'S' : 'N',
    };
  }

  /** fila do coletor: produtos pendentes (IMPRESSA='N') da empresa, com o conteúdo da etiqueta computado. */
  async fila(): Promise<Etiqueta[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await db
      .selectFrom('get_etiqueta_fila')
      .selectAll()
      .where('idempresa', '=', emp)
      .where(sql`coalesce(impressa,'N')`, '=', 'N')
      .orderBy('data_consulta')
      .orderBy('idetiqueta')
      .limit(2000)
      .execute()) as Record<string, unknown>[];
    return rows.map((r) => this.montar(r));
  }

  /**
   * A PESQUISA POR ETQ_IMPRESSA (`btnAdicionarRegistroClick`, Uetiqueta.pas:700-735, o rádio "Já impressa / Não impressa /
   * Todos"): os produtos ativos da loja pelo flag do preço — 'N' é a gôndola com PREÇO ALTERADO e etiqueta velha (o trigger do
   * MULTI_PRECO zera o flag a cada troca de preço). A fila do coletor tem só 309 linhas em 2025-26; as impressões são 116 mil —
   * o grosso vem daqui (auditoria de esqueletos §4.10: 4.965 produtos pendentes na loja 1, 7.159 na 2, 7.586 na 52).
   */
  async pesquisar(f: { situacao?: 'N' | 'S' | 'T'; busca?: string; limite?: number }): Promise<Array<Etiqueta & { etq_impressa: string | null; dtultprecoalterado: unknown }>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const situacao = f.situacao ?? 'N';
    const busca = (f.busca ?? '').trim().toUpperCase();
    let q = db
      .selectFrom('produtos as p')
      .innerJoin('multi_preco as mp', (j: any) => j.onRef('mp.idproduto', '=', 'p.idproduto').on('mp.idempresa', '=', emp))
      .select(['p.idproduto', 'p.codbarra', 'p.unidade', 'p.descricao as descricao_produto', sql`coalesce(nullif(p.fator_filho,0),1)`.as('fator'),
        sql`coalesce(nullif(p.prod_qtde_etiquetas,0),1)`.as('qtde_etiquetas'), 'mp.vrvenda', 'mp.vrpromo', sql`coalesce(mp.promocao,'N')`.as('promocao'),
        'mp.etq_impressa', 'mp.dtultprecoalterado'])
      .where(sql`coalesce(p.ativo, 'S')`, '=', 'S');
    if (situacao !== 'T') q = q.where(sql`coalesce(mp.etq_impressa, 'N')`, '=', situacao);
    if (busca) q = q.where((eb: any) => eb.or([eb(sql`upper(p.descricao)`, 'like', `%${busca}%`), eb('p.codbarra', '=', busca)]));
    const rows = (await q.orderBy('mp.dtultprecoalterado', 'desc').orderBy('p.descricao').limit(Math.min(f.limite ?? 500, 2000)).execute()) as Record<string, unknown>[];
    return rows.map((r) => ({ ...this.montar(r), etq_impressa: (r.etq_impressa as string | null) ?? null, dtultprecoalterado: r.dtultprecoalterado }));
  }

  /** resolve um produto por codbarra (incl. código auxiliar) ou id e devolve a etiqueta computada (preview/add manual). */
  async buscarProduto(idproduto?: number, codbarra?: string): Promise<Etiqueta> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let pid = idproduto ?? null;
    let fatorAux: number | undefined; // fator de embalagem quando o scan foi por código auxiliar (caixa)
    if (pid == null && codbarra) {
      const cb = codbarra.trim();
      const p = (await db.selectFrom('produtos').select('idproduto').where('codbarra', '=', cb).executeTakeFirst()) as { idproduto?: number } | undefined;
      if (p) pid = Number(p.idproduto);
      if (pid == null) {
        // código auxiliar (caixa/embalagem): usa o FATOREMB do auxiliar (fold auditoria [MÉDIA]: senão a etiqueta da
        // CAIXA imprimia o preço UNITÁRIO — fiel a GetFatorEmbalagem/Uetiqueta.pas:2433).
        const ca = (await db.selectFrom('codauxiliar').select(['idproduto', 'fatoremb']).where('codbarra', '=', cb).executeTakeFirst()) as { idproduto?: number; fatoremb?: unknown } | undefined;
        if (ca) {
          pid = Number(ca.idproduto);
          fatorAux = num(ca.fatoremb) > 0 ? num(ca.fatoremb) : undefined;
        }
      }
    }
    if (pid == null) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { codbarra });
    const row = (await db
      .selectFrom('produtos as p')
      .leftJoin('multi_preco as mp', (j) => j.onRef('mp.idproduto', '=', 'p.idproduto').on('mp.idempresa', '=', emp))
      .select(['p.idproduto', 'p.codbarra', 'p.unidade', 'p.descricao as descricao_produto', sql`coalesce(nullif(p.fator_filho,0),1)`.as('fator'), sql`coalesce(nullif(p.prod_qtde_etiquetas,0),1)`.as('qtde_etiquetas'), 'mp.vrvenda', 'mp.vrpromo', sql`coalesce(mp.promocao,'N')`.as('promocao')])
      .where('p.idproduto', '=', pid)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: pid });
    return this.montar(row, undefined, undefined, fatorAux);
  }

  /** enfileira um produto p/ etiqueta (IMPRESSA='N'). Por id ou por codbarra (resolve). */
  async adicionar(dto: { idproduto?: number; codbarra?: string }): Promise<{ idetiqueta: number; etiqueta: Etiqueta }> {
    const emp = this.emp();
    const op = this.op();
    const et = await this.buscarProduto(dto.idproduto, dto.codbarra); // valida existência + computa
    const ins = (await (this.dbp.forTenant() as AnyDB)
      .insertInto('etiqueta_cons_prod')
      .values({ idproduto: et.idproduto, idempresa: emp, operador: op, impressa: 'N', data_consulta: sql`now()` })
      .returning('idetiqueta')
      .executeTakeFirstOrThrow()) as { idetiqueta: number };
    return { idetiqueta: Number(ins.idetiqueta), etiqueta: { ...et, idetiqueta: Number(ins.idetiqueta) } };
  }

  /** remove um item da fila (não impresso). */
  async remover(idetiqueta: number): Promise<{ idetiqueta: number; removido: boolean }> {
    const emp = this.emp();
    const res = await (this.dbp.forTenant() as AnyDB).deleteFrom('etiqueta_cons_prod').where('idetiqueta', '=', idetiqueta).where('idempresa', '=', emp).executeTakeFirst();
    return { idetiqueta, removido: Number((res as any)?.numDeletedRows ?? 0) > 0 };
  }

  /** imprime: computa cada etiqueta server-authoritative, grava o log web, marca a fila IMPRESSA='S' +
   *  MULTI_PRECO.ETQ_IMPRESSA='S', e devolve as etiquetas (replicadas por qtde) p/ o layout imprimível. */
  async imprimir(dto: { itens: Array<{ idetiqueta?: number; idproduto: number; qtde: number; descricao?: string; modelo?: string }> }): Promise<{ etiquetas: Etiqueta[]; total_etiquetas: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const out: Etiqueta[] = [];
      for (const it of dto.itens) {
        const row = (await trx
          .selectFrom('produtos as p')
          .leftJoin('multi_preco as mp', (j) => j.onRef('mp.idproduto', '=', 'p.idproduto').on('mp.idempresa', '=', emp))
          .select(['p.idproduto', 'p.codbarra', 'p.unidade', 'p.descricao as descricao_produto', sql`coalesce(nullif(p.fator_filho,0),1)`.as('fator'), 'mp.vrvenda', 'mp.vrpromo', sql`coalesce(mp.promocao,'N')`.as('promocao')])
          .where('p.idproduto', '=', Number(it.idproduto))
          .executeTakeFirst()) as Record<string, unknown> | undefined;
        if (!row) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: it.idproduto });
        const et = this.montar(row, Number(it.qtde), it.descricao);
        et.idetiqueta = it.idetiqueta;
        out.push(et);
        // LOG_IMPRESSAO_ETIQUETA como a produção grava (binário novo): UMA LINHA POR CÓPIA, com o preço impresso em
        // VALOR_IMPRESSAO e o modelo (6.279 de 6.279 linhas de set/2026 com VALOR_IMPRESSAO; a amostra do operador 63, 24/09
        // 18:49:58, 7896098905999 a 4,99, "GONDULA PINHEIRAO")
        const copias = Math.max(1, Math.round(Number(et.qtde) || 1));
        for (let c = 0; c < copias; c++) {
          await trx.insertInto('log_impressao_etiqueta').values({
            idempresa: emp, codoperador: op, datahora_impressao: sql`now()`, codbarra: et.codbarra,
            valor_impressao: et.valor_venda_promocao, modelo_etiqueta: it.modelo ?? null,
          }).execute();
        }
        // a fila do coletor: TODAS as pendentes do produto (MarcarImpressaEtqConsProd, Uetiqueta.pas:430-443) + o flag do preço
        await trx.updateTable('etiqueta_cons_prod').set({ impressa: 'S' })
          .where('idproduto', '=', et.idproduto).where(sql`coalesce(impressa, 'N')`, '=', 'N').where('idempresa', '=', emp).execute();
        await trx.updateTable('multi_preco').set({ etq_impressa: 'S' }).where('idproduto', '=', et.idproduto).where('idempresa', '=', emp).execute();
      }
      const total = out.reduce((s, e) => s + e.qtde, 0);
      return { etiquetas: out, total_etiquetas: total };
    });
  }
}
