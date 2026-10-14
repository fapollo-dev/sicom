/**
 * O item da NF antes de gravar ou calcular — o `NewRecord`/`BeforePost` do legado (udmNF.pas:4703, :4814):
 *  - `ARREDONDA` que não veio: 'S', ou 'N' quando `DESCAMARCAR_ARREDONDAMENTO_NF='S'` (na produção o global é 'S' e o
 *    módulo Retaguarda sobrepõe com 'N' — por isso 26.121 de 26.887 itens de entrada de jun-set/2026 arredondam);
 *  - `VRVENDA` nulo vira 0 (é o preço de venda, não o valor da linha — `nf-valor.ts` do shared);
 *  - `DESCONTO` é o PERCENTUAL equivalente ao desconto em dinheiro (`VRDESCPROD`), que é o que se digita;
 *  - o RATEIO dos totais da nota no item novo (`cdsItensNotaNewRecord` → `RateioNota`, udmNF.pas:4859/4862): frete, seguro,
 *    IPI, IPI devolvido, frete não incluso (em %) e acessórias/outras despesas (em valor) saem dos totais do cabeçalho,
 *    salvo as caixas "Desabilitar rateio" (RATEIO / RATEIO_IPI / RATEIO_IPI_DEVOLUCAO) da aba Itens.
 */
import { percentualDesconto, totalProdutoItem, totaisProdutosNf, type TipoRateioNf } from '@apollo/shared';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;
type Linha = Record<string, unknown>;

/** o ARREDONDA do item novo: 'N' com a config de desmarcar ligada (o legado assume 'SIM' quando a config falta) */
export async function arredondaPadraoNf(db: AnyDB, emp: number | null): Promise<'S' | 'N'> {
  const v = await configNaTrx(db, 'DESCAMARCAR_ARREDONDAMENTO_NF', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  return String(v ?? 'S').toUpperCase() === 'S' ? 'N' : 'S';
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const difere = (a: number, b: number) => r2(a).toFixed(2) !== r2(b).toFixed(2);

/** o rateio de TODOS os tipos (o `trTodos` do item novo) — as outras despesas só entram aqui, não no botão */
const TODOS: ReadonlyArray<TipoRateioNf | 'OUTRAS_DESPESAS'> = ['FRETE', 'SEGURO', 'ACESSORIAS', 'IPI', 'FRETE_NAO_INCLUSO', 'IPI_DEVOLUCAO', 'OUTRAS_DESPESAS'];

/**
 * `RateioNota` (udmNF.pas:4862): com total dos produtos > 0 e RATEIO <> 'S', cada parcela do cabeçalho vira o % do item
 * (TOTAL / TOTALPROD × 100) quando a soma dos itens não bate com o cabeçalho; cabeçalho zerado zera o item. Acessórias e
 * outras despesas vão em VALOR, proporcionais ao total do item sobre (TOTALPROD − TOTALDESC); o IPI só com RATEIO_IPI = 'N'
 * e o IPI devolvido só com RATEIO_IPI_DEVOLUCAO = 'N' (e leva o % devolvido a 100).
 * `modo` 'novos' = o NewRecord (só o item sem CODNFPROD e só o campo que veio vazio); 'todos' = o "Ratear marcados".
 * O desconto do legado (DESCONTO % a partir do TOTALDESC digitado) não tem equivalente: aqui o desconto é do item (VRDESCPROD) e
 * o TOTALDESC é a soma deles.
 */
export function ratearTotaisNosItens(cab: Linha, itens: Linha[], tipos: ReadonlyArray<TipoRateioNf | 'OUTRAS_DESPESAS'>, modo: 'novos' | 'todos'): void {
  if (!itens.length || String(cab.rateio ?? 'N').toUpperCase() === 'S') return;
  const somas = totaisProdutosNf(itens as never);
  const totalprod = n(cab.totalprod) > 0 ? n(cab.totalprod) : somas.totalprod;
  if (!(totalprod > 0)) return;
  const totaldesc = n(cab.totaldesc) > 0 ? n(cab.totaldesc) : somas.totaldesc;
  const base = totalprod - totaldesc;
  const alvo = (it: Linha) => modo === 'todos' || it.codnfprod == null || it.codnfprod === '';
  const vazio = (it: Linha, k: string) => modo === 'todos' || !(n(it[k]) > 0);
  const somaPct = (k: string) => itens.reduce((s, it) => s + (totalProdutoItem(it as never) * n(it[k])) / 100, 0);
  const somaVal = (k: string) => itens.reduce((s, it) => s + n(it[k]), 0);
  // os % do item: (total do cabeçalho / TOTALPROD) × 100 quando a soma difere; 0 quando o cabeçalho é 0
  const pct = (campoCab: string, campoItem: string, gate = true) => {
    if (!gate) return;
    const total = n(cab[campoCab]);
    const aplicar = total > 0 ? (difere(somaPct(campoItem), total) ? (total / totalprod) * 100 : null) : 0;
    if (aplicar == null) return;
    for (const it of itens) if (alvo(it) && vazio(it, campoItem)) it[campoItem] = aplicar;
  };
  if (tipos.includes('FRETE')) pct('totalfrete', 'frete');
  if (tipos.includes('SEGURO')) pct('totalseguro', 'seguro');
  if (tipos.includes('IPI')) pct('totalipi', 'ipi', String(cab.rateio_ipi ?? 'N').toUpperCase() === 'N');
  if (tipos.includes('FRETE_NAO_INCLUSO')) pct('totalfrete2', 'frete2');
  if (tipos.includes('IPI_DEVOLUCAO') && String(cab.rateio_ipi_devolucao ?? 'N').toUpperCase() === 'N') {
    const total = n(cab.totalipi_devolucao);
    if (total > 0) {
      if (difere(somaPct('ipi_devolucao'), total))
        for (const it of itens) if (alvo(it) && vazio(it, 'ipi_devolucao')) { it.ipi_devolucao = (total / totalprod) * 100; it.ipi_devolucao_perc_devol = 100; }
    } else for (const it of itens) if (alvo(it)) { it.ipi_devolucao = 0; it.ipi_devolucao_perc_devol = 0; }
  }
  // acessórias e outras despesas: VALOR do item = total do item × (total do cabeçalho / (TOTALPROD − TOTALDESC))
  const valor = (campoCab: string, campoItem: string, arredondar: boolean) => {
    const total = n(cab[campoCab]);
    if (total > 0) {
      if (!(base > 0) || !difere(somaVal(campoItem), total)) return;
      for (const it of itens) if (alvo(it) && vazio(it, campoItem)) {
        const v = (totalProdutoItem(it as never) * ((total / base) * 100)) / 100;
        it[campoItem] = arredondar ? r2(v) : v;
      }
    } else for (const it of itens) if (alvo(it)) it[campoItem] = 0;
  };
  if (tipos.includes('ACESSORIAS')) valor('totalacessorias', 'depsacess', true);
  if (tipos.includes('OUTRAS_DESPESAS')) valor('totaloutrasdesp', 'vroutrasdesp', false);
}

/** normaliza os itens NO LUGAR (o `derivar`, que vem depois, soma os totais com eles já completos); com o cabeçalho, o item novo recebe o rateio */
export async function normalizarItensNf(db: AnyDB, emp: number | null, itens: unknown, cab?: Linha): Promise<void> {
  if (!Array.isArray(itens) || !itens.length) return;
  let padrao: 'S' | 'N' | null = null;
  for (const it of itens as Array<Record<string, unknown>>) {
    const a = String(it.arredonda ?? '').toUpperCase();
    if (a === 'S' || a === 'N') it.arredonda = a;
    else it.arredonda = padrao ??= await arredondaPadraoNf(db, emp);
    if (it.vrvenda == null || it.vrvenda === '') it.vrvenda = 0;
    it.desconto = Math.round(percentualDesconto(it) * 1e6) / 1e6;
  }
  if (cab) ratearTotaisNosItens(cab, itens as Linha[], TODOS, 'novos');
}
