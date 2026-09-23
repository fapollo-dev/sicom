/**
 * O item da NF antes de gravar ou calcular — o `NewRecord`/`BeforePost` do legado (udmNF.pas:4703, :4814):
 *  - `ARREDONDA` que não veio: 'S', ou 'N' quando `DESCAMARCAR_ARREDONDAMENTO_NF='S'` (na produção o global é 'S' e o
 *    módulo Retaguarda sobrepõe com 'N' — por isso 26.121 de 26.887 itens de entrada de jun-set/2026 arredondam);
 *  - `VRVENDA` nulo vira 0 (é o preço de venda, não o valor da linha — `nf-valor.ts` do shared);
 *  - `DESCONTO` é o PERCENTUAL equivalente ao desconto em dinheiro (`VRDESCPROD`), que é o que se digita.
 */
import { percentualDesconto } from '@apollo/shared';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;

/** o ARREDONDA do item novo: 'N' com a config de desmarcar ligada (o legado assume 'SIM' quando a config falta) */
export async function arredondaPadraoNf(db: AnyDB, emp: number | null): Promise<'S' | 'N'> {
  const v = await configNaTrx(db, 'DESCAMARCAR_ARREDONDAMENTO_NF', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  return String(v ?? 'S').toUpperCase() === 'S' ? 'N' : 'S';
}

/** normaliza os itens NO LUGAR (o `derivar`, que vem depois, soma os totais com eles já completos) */
export async function normalizarItensNf(db: AnyDB, emp: number | null, itens: unknown): Promise<void> {
  if (!Array.isArray(itens) || !itens.length) return;
  let padrao: 'S' | 'N' | null = null;
  for (const it of itens as Array<Record<string, unknown>>) {
    const a = String(it.arredonda ?? '').toUpperCase();
    if (a === 'S' || a === 'N') it.arredonda = a;
    else it.arredonda = padrao ??= await arredondaPadraoNf(db, emp);
    if (it.vrvenda == null || it.vrvenda === '') it.vrvenda = 0;
    it.desconto = Math.round(percentualDesconto(it) * 1e6) / 1e6;
  }
}
