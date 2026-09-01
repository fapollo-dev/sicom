import { type Kysely } from 'kysely';

type AnyDB = Kysely<any>;

/**
 * ESTORNO das pontes do inventário rotativo, isolado aqui porque tem DOIS chamadores que não podem divergir:
 * o cancelamento da NF-e (`nf-nfe.service.ts`) e a exclusão da NF (`nf.aggregate.ts`). No legado é a mesma
 * rotina nos dois casos — `udmNF.pas:3406-3463`, sob `taExcluir, taCancelar`.
 *
 * A escolha do lado é pelo **TIPO da nota** (`:3414`): `'S'` desfaz PERDAS, qualquer outro desfaz SOBRAS. O
 * legado não tenta os dois, e nós também não — nota de saída nunca carrega carimbo de sobra, porque o
 * `vincularNf` recusa o par errado com `NF_TIPO_INCOMPATIVEL`.
 *
 * Sempre na linha `OPERACAO='FECHADO'` (é onde o carimbo mora) e sempre dentro da transação do chamador, para
 * o estorno não sobreviver a um rollback do cancelamento/exclusão.
 */
export async function estornarVinculoRotativo(
  trx: AnyDB,
  codnf: number,
  tipoNf: string | null,
  emp: number,
): Promise<number> {
  const perdas = tipoNf === 'S';
  const r = await trx
    .updateTable('inventario_rotativo')
    .set(perdas ? { importado_perdas: 'N', codnf_perdas: null } : { importado_sobras: 'N', codnf_sobras: null })
    .where(perdas ? 'codnf_perdas' : 'codnf_sobras', '=', codnf)
    .where(perdas ? 'importado_perdas' : 'importado_sobras', '=', 'S')
    .where('operacao', '=', 'FECHADO')
    .where('idempresa', '=', emp)
    .executeTakeFirst();
  return Number(r?.numUpdatedRows ?? 0);
}
