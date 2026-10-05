import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { RelPedidosCompraDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const CDS = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;

export interface VencimentoPedido {
  idempresa: number;
  nropedido: number;
  codparceiro: number | null;
  fornecedor: string | null;
  data_pedido: string | null;
  dt_vencimento: string | null;
  dt_faturamento: string | null;
  dt_venc_parc: string;
  condpag: number;
  valor_parcela: number;
  status: 'Fechado' | 'Aberto';
}

/** a ordem da impressão por agrupamento (`cdsVencimentos.IndexFieldNames`, uRelPedidosCompra.pas:62) e a quebra */
/** o `.fr3` de cada agrupamento (`btnImprimirClick`, :108-114) */
const TEMPLATE: Record<RelPedidosCompraDto['agrupamento'], string> = {
  FORNECEDOR: 'Pedidos_Compra_Previsao_Financeira.fr3', DATA_PEDIDO: 'Pedidos_Compra_Previsao_Financeira_Datapedido.fr3',
  VENCIMENTO: 'Pedidos_Compra_Previsao_Financeira_DataVenc.fr3', FATURAMENTO: 'Pedidos_Compra_Previsao_Financeira_DataFatu.fr3',
  VENC_PARCELA: 'Pedidos_Compra_Previsao_Financeira_DataVencParc.fr3',
};

/**
 * o texto da variável PERIODO. O legado tem três rótulos para os quatro rádios (`case rgFiltroDatas.ItemIndex of 0/1/2`, :102-106): o
 * filtro por FATURAMENTO sai como "Data de Vencimento da Parcela" e o da parcela sai sem rótulo — aqui cada um com o seu nome.
 */
const ROTULO_DATA: Record<RelPedidosCompraDto['filtroData'], string> = {
  PEDIDO: 'Data do Pedido ', VENCIMENTO: 'Data de Vencimento do Pedido ', FATURAMENTO: 'Data de Faturamento ', PARCELA: 'Data de Vencimento da Parcela ',
};

const QUEBRA: Record<RelPedidosCompraDto['agrupamento'], keyof VencimentoPedido> = {
  FORNECEDOR: 'fornecedor', DATA_PEDIDO: 'data_pedido', VENCIMENTO: 'dt_vencimento',
  FATURAMENTO: 'dt_faturamento', VENC_PARCELA: 'dt_venc_parc',
};

/**
 * RELATÓRIO DE PEDIDOS DE COMPRA — PREVISÃO DE PAGAMENTOS (`FRMRELPEDIDOCOMPRA`, uRelPedidosCompra.pas +
 * uDMRelPedidosCompra.dfm). 63 acessos, 6 operadores. Dossiê: `uRelPedidosCompra.md`.
 *
 * O quanto os pedidos de compra vão custar, e quando. A base é POR PEDIDO E POR LOJA: `Σ PEDIDO_COMPRA_QTDE.TOTALCUSTO`
 * agrupado pela loja da quantidade (o pedido das lojas 1 e 2 dá duas linhas). Cada linha vira as parcelas da
 * condição (`MontaVencimentos`): o valor dividido pelo nº de prazos CD1..CD8 maiores que zero — SEM arredondar e sem
 * sobra, como o legado —, vencendo em DATA DE FATURAMENTO + CDn. Pedido sem prazo não gera parcela (fica na grade,
 * sai da impressão).
 *
 * Filtros: o período sobre a data do pedido, o vencimento do pedido, a data de faturamento ou o VENCIMENTO DE
 * ALGUMA PARCELA (faturamento + CDn no período — e a impressão lista TODAS as parcelas do pedido, também as fora do
 * período: o recorte por parcela está comentado no fonte, :281); status pelo `FECHADO` do cabeçalho; fornecedor
 * pelo código ou por parte da razão; lojas (em branco, a da sessão).
 *
 * ⚠️ A "data de faturamento" do legado (`P.DTFATURAMENTO`, a digitada) é o `data_faturamento` do Apollo — o
 * `dtfaturamento` daqui é o carimbo de recebido (FILA, Achado 17).
 */
@Injectable()
export class RelPedidosCompraService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async gerar(f: RelPedidosCompraDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });
    // as marcadas recortadas às lojas do operador (o GetMultiEmpresa)
    const empresas = await empresasDoOperador(db, f.empresas);
    const ini = sql`${f.dataIni}::date`;
    const fim = sql`${f.dataFim}::date`;

    const filtroData = {
      PEDIDO: sql`p.data::date BETWEEN ${ini} AND ${fim}`,
      VENCIMENTO: sql`p.dt_vencimento::date BETWEEN ${ini} AND ${fim}`,
      FATURAMENTO: sql`p.data_faturamento::date BETWEEN ${ini} AND ${fim}`,
      PARCELA: sql`(${sql.join(CDS.map((c) => sql`p.data_faturamento::date + ${sql.ref(`p.${c}`)} BETWEEN ${ini} AND ${fim}`), sql` OR `)})`,
    }[f.filtroData];
    const onde = [
      filtroData,
      sql`pq.idempresa = ANY(${empresas})`,
      sql`coalesce(p.indr, 'I') <> 'E'`,
    ];
    if (f.status === 'ABERTOS') onde.push(sql`coalesce(p.fechado, 'N') <> 'S'`);
    if (f.status === 'FECHADOS') onde.push(sql`coalesce(p.fechado, 'N') = 'S'`);
    if (f.razao) onde.push(sql`pa.razao ILIKE ${`%${f.razao}%`}`);
    else if (f.codparceiro) onde.push(sql`p.codparceiro = ${f.codparceiro}`);

    const pedidos = (await sql<Record<string, unknown>>`
        SELECT p.codpedcomp AS nropedido, pa.codparceiro, pa.razao AS fornecedor,
               to_char(p.data::date, 'YYYY-MM-DD') AS data_pedido,
               to_char(p.dt_vencimento::date, 'YYYY-MM-DD') AS data_vencimento,
               to_char(p.data_faturamento::date, 'YYYY-MM-DD') AS data_faturamento,
               pq.idempresa, p.cd1, p.cd2, p.cd3, p.cd4, p.cd5, p.cd6, p.cd7, p.cd8, p.fechado,
               sum(pq.totalcusto) AS valor
          FROM pedido_compra_qtde pq
          JOIN pedidocompra_i pe ON pe.codpedcompi = pq.codpedcompi
          JOIN pedidocompra p ON p.codpedcomp = pe.codpedcomp
          LEFT JOIN parceiros pa ON pa.codparceiro = p.codparceiro
         WHERE ${sql.join(onde, sql` AND `)}
         GROUP BY p.codpedcomp, pa.codparceiro, pa.razao, p.data::date, p.dt_vencimento::date, p.data_faturamento::date,
                  p.cd1, p.cd2, p.cd3, p.cd4, p.cd5, p.cd6, p.cd7, p.cd8, p.fechado, pq.idempresa
         ORDER BY pq.idempresa, pa.razao, p.data::date, p.codpedcomp`.execute(db)).rows
      .map((r: Record<string, unknown>) => ({
        nropedido: Number(r.nropedido), codparceiro: r.codparceiro == null ? null : Number(r.codparceiro),
        fornecedor: (r.fornecedor as string | null) ?? null, data_pedido: (r.data_pedido as string | null) ?? null,
        data_vencimento: (r.data_vencimento as string | null) ?? null, data_faturamento: (r.data_faturamento as string | null) ?? null,
        idempresa: Number(r.idempresa), fechado: r.fechado === 'S',
        prazos: CDS.map((c) => num(r[c])).filter((d) => d > 0),
        valor: r2(num(r.valor)),
      }));

    // MontaVencimentos (uRelPedidosCompra.pas:231): uma parcela por prazo > 0, valor ÷ nº de prazos, venc = faturamento + CDn
    const vencimentos: VencimentoPedido[] = [];
    for (const p of pedidos) {
      if (!p.prazos.length || !p.data_faturamento) continue;
      const parcela = p.valor / p.prazos.length;
      for (const dias of p.prazos) {
        const d = new Date(`${p.data_faturamento}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dias);
        vencimentos.push({
          idempresa: p.idempresa, nropedido: p.nropedido, codparceiro: p.codparceiro, fornecedor: p.fornecedor,
          data_pedido: p.data_pedido, dt_vencimento: p.data_vencimento, dt_faturamento: p.data_faturamento,
          dt_venc_parc: d.toISOString().slice(0, 10), condpag: dias, valor_parcela: parcela,
          status: p.fechado ? 'Fechado' : 'Aberto',
        });
      }
    }
    const chave = QUEBRA[f.agrupamento];
    const txt = (v: unknown) => String(v ?? '');
    vencimentos.sort((a, b) => a.idempresa - b.idempresa || txt(a[chave]).localeCompare(txt(b[chave]))
      || (chave === 'fornecedor' ? txt(a.data_pedido).localeCompare(txt(b.data_pedido)) : txt(a.fornecedor).localeCompare(txt(b.fornecedor)))
      || a.nropedido - b.nropedido || a.condpag - b.condpag);

    // a quebra do `.fr3` é pelo campo do agrupamento, na ordem acima (o GroupHeader não olha a loja)
    const grupos: Array<{ chave: string | null; total: number; parcelas: VencimentoPedido[] }> = [];
    for (const v of vencimentos) {
      const k = (v[chave] as string | null) ?? null;
      const ult = grupos[grupos.length - 1];
      if (ult && ult.chave === k) ult.parcelas.push(v);
      else grupos.push({ chave: k, total: 0, parcelas: [v] });
    }
    for (const g of grupos) g.total = r2(g.parcelas.reduce((s, v) => s + v.valor_parcela, 0));

    return {
      filtro: { ...f, empresas },
      pedidos,
      vencimentos,
      grupos,
      totais: {
        registros: pedidos.length,
        valor: r2(pedidos.reduce((s, p) => s + p.valor, 0)),
        parcelas: r2(vencimentos.reduce((s, v) => s + v.valor_parcela, 0)),
      },
    };
  }

  /**
   * O "Imprimir" (F11): as parcelas (`cdsVencimentos` → `frxDBVencimentos`) na ordem do agrupamento (o `IndexFieldNames`), no `.fr3`
   * do agrupamento, com PERIODO, STATUS ("Status dos Pedidos:  Abertos.") e EMPRESAS ("Empresa(s): 1,2").
   */
  async impressao(f: RelPedidosCompraDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.gerar(f);
    const dmy = (d: string) => d.split('-').reverse().join('/');
    const status = { TODOS: ' Abertos e Fechados.', ABERTOS: ' Abertos.', FECHADOS: ' Fechados.' }[f.status];
    return {
      titulo: 'Pedidos de compra — previsão de pagamentos',
      modelo: await modeloFr3(db, TEMPLATE[f.agrupamento]),
      datasets: {
        frxDBVencimentos: r.vencimentos.map((v) => registroFr3({ ...v })),
        frxDBPrevFin: r.pedidos.map((p) => registroFr3({
          nropedido: p.nropedido, codparceiro: p.codparceiro, fornecedor: p.fornecedor, data_pedido: p.data_pedido, data_vencimento: p.data_vencimento,
          data_faturamento: p.data_faturamento, idempresa: p.idempresa, fechado: p.fechado ? 'S' : 'N', valor: p.valor,
        })),
      },
      variaveis: {
        PERIODO: textoVariavel(`${ROTULO_DATA[f.filtroData]} de ${dmy(f.dataIni)} até ${dmy(f.dataFim)}`),
        STATUS: textoVariavel(`Status dos Pedidos: ${status}`),
        EMPRESAS: textoVariavel(`Empresa(s): ${r.filtro.empresas.join(',')}`),
      },
    };
  }
}
