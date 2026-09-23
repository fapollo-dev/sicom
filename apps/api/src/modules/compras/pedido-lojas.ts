import { sql } from 'kysely';

type AnyDB = any;

/**
 * PEDIDO MULTI-LOJA — as regras por loja, compartilhadas pelo agregado e pelo serviço (mig 303).
 *
 * No legado o pedido não tem dona: `PEDIDOCOMPRA.EMPRESAS` é o CSV das lojas participantes ('1, 2'), a quantidade de
 * cada item mora por loja em `PEDIDO_COMPRA_QTDE`, e o FECHAMENTO é por loja (`ItemFechado`, uPedidoCompra.pas:4817).
 */

/** as lojas do CSV do legado ('1, 2' → [1, 2]); sem CSV, a loja dona do pedido. */
export function lojasDoPedido(empresas: unknown, idempresa?: number | null): number[] {
  const lista = String(empresas ?? '')
    .split(',')
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const unicas = [...new Set(lista)];
  if (unicas.length) return unicas;
  return idempresa != null ? [Number(idempresa)] : [];
}

/** o CSV no formato que o legado grava: ordenado, separado por vírgula e espaço ('1, 2'). */
export function formatarEmpresas(lojas: number[]): string {
  return [...new Set(lojas)].sort((a, b) => a - b).join(', ');
}

export type TipoFechamento = 'nenhum' | 'parcial' | 'total';

export interface FechamentoLoja {
  idempresa: number;
  fechado: boolean;
  data_fechamento: unknown;
  codoperador: number | null;
}

/**
 * O estado de fechamento do pedido, derivado das linhas por loja (`ItemFechado` do legado): a loja está fechada se tem
 * ao menos uma linha com FECHADO='S'; o pedido está TOTAL quando todas as lojas com linha fecharam, PARCIAL quando só
 * algumas, NENHUM quando nenhuma. Sem linha nenhuma (pedido sem itens), vale o cabeçalho — é o caso de uma loja só.
 */
export async function estadoFechamento(db: AnyDB, codpedcomp: number, fechadoCabecalho?: string | null): Promise<{
  tipo: TipoFechamento;
  lojas: FechamentoLoja[];
  temLinhas: boolean;
}> {
  const rows = (await sql<{ idempresa: number; fechado: boolean; data_fechamento: unknown; codoperador: number | null }>`
      SELECT q.idempresa,
             bool_or(coalesce(q.fechado, 'N') = 'S') AS fechado,
             max(q.data_fechamento) AS data_fechamento,
             max(q.codoperador) FILTER (WHERE coalesce(q.fechado, 'N') = 'S') AS codoperador
        FROM pedido_compra_qtde q
        JOIN pedidocompra_i i ON i.codpedcompi = q.codpedcompi
       WHERE i.codpedcomp = ${codpedcomp}
       GROUP BY q.idempresa
       ORDER BY q.idempresa`.execute(db)).rows;
  const lojas = rows.map((r) => ({
    idempresa: Number(r.idempresa), fechado: !!r.fechado, data_fechamento: r.data_fechamento,
    codoperador: r.codoperador == null ? null : Number(r.codoperador),
  }));
  if (!lojas.length) {
    return { tipo: fechadoCabecalho === 'S' ? 'total' : 'nenhum', lojas, temLinhas: false };
  }
  const fechadas = lojas.filter((l) => l.fechado).length;
  const tipo: TipoFechamento = fechadas === 0 ? 'nenhum' : fechadas === lojas.length ? 'total' : 'parcial';
  return { tipo, lojas, temLinhas: true };
}

/** a loja está fechada neste pedido? (linha dela com FECHADO='S'; sem linhas, o cabeçalho) */
export function lojaFechada(estado: { lojas: FechamentoLoja[]; temLinhas: boolean; tipo: TipoFechamento }, idempresa: number): boolean {
  if (!estado.temLinhas) return estado.tipo === 'total';
  return estado.lojas.some((l) => l.idempresa === idempresa && l.fechado);
}

/** Σ quantidade (caixas) por produto e loja no banco — a base de "a loja fechada não muda". */
export async function quantidadesPorLoja(db: AnyDB, codpedcomp: number): Promise<Map<string, number>> {
  const rows = (await sql<{ idproduto: number; idempresa: number; qtde: unknown }>`
      SELECT i.idproduto, q.idempresa, sum(q.qtde) AS qtde
        FROM pedido_compra_qtde q
        JOIN pedidocompra_i i ON i.codpedcompi = q.codpedcompi
       WHERE i.codpedcomp = ${codpedcomp}
       GROUP BY i.idproduto, q.idempresa`.execute(db)).rows;
  const m = new Map<string, number>();
  for (const r of rows) m.set(`${r.idproduto}|${r.idempresa}`, Number(r.qtde ?? 0));
  return m;
}

/** a mensagem que o legado grava em `PEDIDO_COMPRA_HISTORICO` (as três formas da produção). */
export async function novoHistorico(db: AnyDB, codpedcomp: number, codoperador: number | null, texto: string): Promise<void> {
  await db.insertInto('pedido_compra_historico')
    .values({ codpedcomp, codoperador, pch_historico: texto.slice(0, 1000), pch_data: sql`now()` })
    .execute();
}
