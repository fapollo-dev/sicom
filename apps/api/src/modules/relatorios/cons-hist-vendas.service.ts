import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConsHistVendasDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** o PDV é o PREFIXO de 2 dígitos do NROPEDIDO (`PDV(2)+DDMMYY(6)+HHMMSS(6)`) — `FormatFloat('00', pdv) + '%'`. */
const prefixoPdv = (pdv: number) => `${String(pdv).padStart(2, '0')}%`;

export interface ItemCupom {
  nropedido: string | null;
  nrocupom: number | null;
  nroitem: number | null;
  codbarra: string | null;
  descricao: string | null;
  unidade: string | null;
  qtde: number;
  vrvenda: number;
  aliquota: string | null;
  total: number;
  total_item: number;
  total_canc: number;
  /** 'Vlr.Acrescimo' e 'Vlr.Desconto' do grid do legado (as partes positiva/negativa separadas). */
  acrescimo: number;
  desconto: number;
  cancelado: string | null;
  cancitem: string;
  canc: string;
}

/**
 * CONSULTA DE HISTÓRICO DE VENDAS (FRMCONSHISTVENDAS / uConsHistVendas.pas) — corte-1: **um cupom por vez**, o
 * oposto do hub de relatórios (que agrega período). Devolve o cabeçalho da venda (pedido, cliente, vendedor,
 * operador, data), os itens com a aritmética do legado, o rodapé (subtotal − cancelados) e os **finalizadores**
 * do cupom lidos de `cx_vendas`.
 *
 * Fidelidade que importa (dossiê uConsHistVendas.md §4):
 *  · o `IAT` decide arredondar ('A') ou TRUNCAR em centavos — a mesma pegadinha das rel-vendas;
 *  · `total_item` aplica os quatro descontos DENTRO do mesmo CASE do IAT:
 *    (qtde×vrvenda) − (desc_promocao + desc_departamento) + (desc_acre_medio + desc_acre_item);
 *  · `total_canc` só conta quando `coalesce(cancelado,'N')='S'`, e o total exibido é subtotal − cancelados;
 *  · a descrição vem da VENDA quando há `idproduto_filho` (produto pesado/fracionado), senão do cadastro;
 *  · cupom vazio + existe venda com `cancelado='S' AND tipocanc='C'` ⇒ responde `cupom_cancelado` (a diferença
 *    entre "não existe" e "existe e foi cancelado", que é o que o atendente precisa saber);
 *  · o grid de finalizadores mostra `valor − troco` por operação SEM filtrar operação: em 2024 o golden tem 16
 *    operações e entre elas SANGRIA/DESCONTO/ACRESCIMO/DEVOLUCAO — que não são forma de pagamento (lição 27).
 *    Por isso o total pago é devolvido separado do total do cupom, sem "conferência" inventada.
 */
@Injectable()
export class ConsHistVendasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** empresa do filtro: o legado deixa digitar outra empresa no campo. Se vier do CLIENTE, exigir o grant DELA
   *  (fold auditoria [ALTA]): o RBAC é por empresa, e sem isso um `"idempresa": 2` no corpo furaria o 403 que o
   *  header respeita. Mesmo padrão de `precificacao-custo.service.ts:73`. */
  private async empresaFiltro(db: AnyDB, dto: ConsHistVendasDto): Promise<number> {
    const propria = this.emp();
    if (dto.idempresa == null || dto.idempresa === propria) return propria;
    const ok = await db
      .selectFrom('permissoes')
      .select('form')
      .where('form', '=', 'FRMCONSHISTVENDAS')
      .where('codempresa', '=', dto.idempresa)
      .where('codoperador', '=', this.op())
      .executeTakeFirst();
    if (!ok) throw new BusinessRuleError('SEM_PERMISSAO_EMPRESA', { idempresa: dto.idempresa });
    return dto.idempresa;
  }

  /** resposta de "não achou" (com ou sem o aviso de cupom cancelado). */
  private vazio(cupomCancelado: boolean) {
    return {
      encontrado: false, cupom_cancelado: cupomCancelado, cabecalho: null, itens: [] as ItemCupom[],
      totais: { qtd_itens: 0, subtotal: 0, cancelados: 0, total: 0 },
      finalizadores: [] as Array<{ operacao: string | null; valor: number }>, total_finalizadores: 0,
    };
  }

  async consultar(dto: ConsHistVendasDto): Promise<{
    encontrado: boolean;
    cupom_cancelado: boolean;
    cabecalho: Record<string, unknown> | null;
    itens: ItemCupom[];
    totais: { qtd_itens: number; subtotal: number; cancelados: number; total: number };
    finalizadores: Array<{ operacao: string | null; valor: number }>;
    total_finalizadores: number;
  }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = await this.empresaFiltro(db, dto);
    const nfc = dto.venda_nfc ?? 'S';

    // a SEGUNDA porta do legado: chamada com só o NROPEDIDO (de A Receber/Cheque/Cartão — `ChamaFrmConsHistVendas`
    // + `ExisteVenda`, uConsHistVendas.pas:478-511/625-648), derivando o cupom da 1ª linha da venda e o PDV dos 2
    // primeiros caracteres do pedido (fold auditoria [BAIXA]).
    let cupom = dto.nrocupom ?? null;
    let pdv = dto.pdv ?? null;
    if (dto.nropedido != null && (cupom == null || pdv == null)) {
      const v = (await db
        .selectFrom('vendas')
        .select('nrocupom')
        .where('nropedido', '=', dto.nropedido)
        .where('idempresa', '=', emp)
        .limit(1)
        .executeTakeFirst()) as { nrocupom?: number } | undefined;
      if (v == null) return this.vazio(false);
      cupom = cupom ?? (v.nrocupom == null ? 0 : Number(v.nrocupom));
      pdv = pdv ?? Number(dto.nropedido.slice(0, 2));
    }
    if (cupom == null || pdv == null) throw new BusinessRuleError('CUPOM_PDV_OBRIGATORIO');

    // o CASE do IAT, reaproveitado nas três medidas (bruto, com descontos e cancelado).
    const bruto = sql`case when v.iat = 'A' then cast(v.qtde * v.vrvenda as numeric(18,2))
                            else cast(trunc(v.qtde * v.vrvenda * 100) as numeric(18,2)) / 100 end`;
    const liquido = sql`(v.qtde * v.vrvenda) - (coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0))
                        + (coalesce(v.desc_acre_medio,0) + coalesce(v.desc_acre_item,0))`;
    const comDescontos = sql`case when v.iat = 'A' then cast(${liquido} as numeric(18,2))
                                  else cast(trunc((${liquido}) * 100) as numeric(18,2)) / 100 end`;
    // ⚠️ o TOTAL_CANC do legado **não tem o CASE do IAT** (dfm, bloco do cupom): item cancelado é SEMPRE truncado.
    // Não é preciosismo — `IAT='A'` é 100% do golden e 252 dos 1.482 itens cancelados de jun/2023 diferem em 1
    // centavo (ex.: 0,364 × 25,90 = 9,4276 → legado 9,42, arredondado daria 9,43), o que faz um cupom inteiramente
    // cancelado fechar em R$ 0,01 no legado e R$ 0,00 se copiarmos a medida arredondada (fold auditoria [ALTA]).
    const canceladoTrunc = sql`cast(trunc((${liquido}) * 100) as numeric(18,2)) / 100`;
    // as duas colunas de exibição do grid, que SEPARAM o sinal do desc_acre_medio/item (fold auditoria [MÉDIA]):
    // 'Vlr.Acrescimo' junta as partes positivas; 'Vlr.Desconto' junta promoção + departamento + as negativas
    // positivadas. Os dois sinais ocorrem no golden, então a separação não é decorativa.
    const acrescimo = sql`(case when coalesce(v.desc_acre_medio,0) > 0 then coalesce(v.desc_acre_medio,0) else 0 end)
                        + (case when coalesce(v.desc_acre_item,0)  > 0 then coalesce(v.desc_acre_item,0)  else 0 end)`;
    const desconto = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
                       + (case when coalesce(v.desc_acre_medio,0) < 0 then coalesce(v.desc_acre_medio,0) * -1 else 0 end)
                       + (case when coalesce(v.desc_acre_item,0)  < 0 then coalesce(v.desc_acre_item,0)  * -1 else 0 end)`;

    let q = db
      .selectFrom('vendas as v')
      .leftJoin('parceiros as p', 'p.codparceiro', 'v.codparceiro')
      .leftJoin('parceiros as ve', 've.codparceiro', 'v.codvendedor')
      .leftJoin('produtos as pr', 'pr.idproduto', 'v.codproduto')
      .leftJoin('operadores as o', 'o.codoperador', 'v.operador')
      .select([
        'v.nropedido', 'v.nrocupom', 'v.nroitem', 'v.qtde', 'v.vrvenda', 'v.aliquota', 'v.cancelado', 'v.tipocanc',
        'v.dtvenda', 'v.desc_acre', 'v.idempresa', 'v.venda_nfc',
        'p.razao as cliente', 've.razao as vendedor', 'o.nome as operador_nome', 'pr.codbarra', 'pr.unidade',
        sql<string>`case when v.idproduto_filho is not null then v.descricao else pr.descricao end`.as('descricao'),
        sql<number>`sum(${bruto})`.as('total'),
        sql<number>`sum(${comDescontos})`.as('total_item'),
        sql<number>`case when coalesce(v.cancelado,'N') = 'S' then sum(${canceladoTrunc}) else 0 end`.as('total_canc'),
        sql<number>`sum(${acrescimo})`.as('acrescimo'),
        sql<number>`sum(${desconto})`.as('desconto'),
      ])
      .where('v.idempresa', '=', emp)
      .where('v.nrocupom', '=', cupom)
      .where(sql`v.nropedido`, 'like', prefixoPdv(pdv))
      .where(sql`coalesce(v.venda_nfc,'N')`, '=', nfc)
      // o GROUP BY do legado (dfm, bloco do cupom): linhas IDÊNTICAS colapsam numa só com as medidas SOMADAS — e
      // a QTDE **não** é somada (está na chave; o `SUM(V.QTDE)` está comentado no fonte). Acontece de verdade: 19
      // grupos / 38 linhas extras em 2024 (ex. pedido 06240624210734 item 1 = 4 registros de 9,00 → 1 linha de
      // 36,00 com qtde 1). Os totais do rodapé não mudam; a CONTAGEM de itens e o valor por linha mudam.
      .groupBy([
        'v.nropedido', 'v.nrocupom', 'v.nroitem', 'v.qtde', 'v.vrvenda', 'v.aliquota', 'v.cancelado', 'v.tipocanc',
        'v.dtvenda', 'v.desc_acre', 'v.idempresa', 'v.venda_nfc', 'p.razao', 've.razao', 'o.nome',
        'pr.codbarra', 'pr.unidade', 'pr.descricao', 'v.descricao', 'v.idproduto_filho',
        'v.desc_promocao', 'v.desc_departamento', 'v.desc_acre_medio', 'v.desc_acre_item',
      ]);
    if (dto.nropedido) q = q.where('v.nropedido', '=', dto.nropedido);

    const rows = (await q.orderBy('v.nroitem').execute()) as Array<Record<string, any>>;

    if (rows.length === 0) {
      // "O cupom informado está cancelado." — a 2ª query do legado (VendaEstaCancelada), mesmos filtros.
      let qc = db
        .selectFrom('vendas as v')
        .select(sql`1`.as('ok'))
        .where('v.idempresa', '=', emp)
        .where('v.nrocupom', '=', cupom)
        .where('v.cancelado', '=', 'S')
        .where('v.tipocanc', '=', 'C');
      // o legado só acrescenta o LIKE do PDV nesta 2ª query **se o PDV for ≠ 0** (uConsHistVendas.pas:335).
      if (pdv !== 0) qc = qc.where(sql`v.nropedido`, 'like', prefixoPdv(pdv));
      if (dto.nropedido) qc = qc.where('v.nropedido', '=', dto.nropedido);
      const cancelado = await qc.executeTakeFirst();
      return this.vazio(!!cancelado);
    }

    const primeira = rows[0];
    const itens: ItemCupom[] = rows.map((r) => ({
      nropedido: r.nropedido ?? null,
      nrocupom: r.nrocupom == null ? null : Number(r.nrocupom),
      nroitem: r.nroitem == null ? null : Number(r.nroitem),
      codbarra: r.codbarra ?? null,
      descricao: r.descricao ?? null,
      unidade: r.unidade ?? null,
      qtde: num(r.qtde),
      vrvenda: num(r.vrvenda),
      aliquota: r.aliquota ?? null,
      total: r2(num(r.total)),
      total_item: r2(num(r.total_item)),
      total_canc: r2(num(r.total_canc)),
      acrescimo: r2(num(r.acrescimo)),
      desconto: r2(num(r.desconto)),
      cancelado: r.cancelado ?? null,
      // os rótulos do legado (dbtxtCANC / coluna CANCITEM)
      cancitem: String(r.cancelado ?? 'N') === 'S' ? 'CANCELADO' : '',
      canc: String(r.tipocanc ?? 'N') === 'C' ? 'CUPOM CANCELADO' : '',
    }));

    const subtotal = r2(itens.reduce((s, i) => s + i.total_item, 0));
    const cancelados = r2(itens.reduce((s, i) => s + i.total_canc, 0));

    // finalizadores do cupom: por NROPEDIDO, `valor − troco`, sem filtrar operação (fiel ao legado).
    const fin = (await db
      .selectFrom('cx_vendas')
      .select(['operacao', sql<number>`valor - coalesce(troco,0)`.as('valor')])
      .where('nropedido', '=', String(primeira.nropedido))
      .where('idempresa', '=', emp)
      .orderBy('codcxvendas')
      .execute()) as Array<{ operacao: string | null; valor: unknown }>;
    const finalizadores = fin.map((f) => ({ operacao: f.operacao ?? null, valor: r2(num(f.valor)) }));

    return {
      encontrado: true,
      cupom_cancelado: itens.some((i) => i.canc !== ''),
      cabecalho: {
        nropedido: primeira.nropedido ?? null,
        nrocupom: primeira.nrocupom == null ? null : Number(primeira.nrocupom),
        idempresa: Number(primeira.idempresa),
        dtvenda: primeira.dtvenda ?? null,
        cliente: primeira.cliente ?? null,
        vendedor: primeira.vendedor ?? null,
        operador: primeira.operador_nome ?? null,
        desc_acre: primeira.desc_acre == null ? null : r2(num(primeira.desc_acre)),
        venda_nfc: primeira.venda_nfc ?? null,
        // o ticket do legado só habilita quando o cupom NÃO está cancelado (btnImprimirTicket.Enabled)
        permite_ticket: !itens.some((i) => i.canc !== ''),
      },
      itens,
      totais: { qtd_itens: itens.length, subtotal, cancelados, total: r2(subtotal - cancelados) },
      finalizadores,
      total_finalizadores: r2(finalizadores.reduce((s, f) => s + f.valor, 0)),
    };
  }
}
