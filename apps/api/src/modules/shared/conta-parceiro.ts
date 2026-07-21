import { type Kysely } from 'kysely';

type AnyDB = Kysely<any>;

/** natureza contábil do parceiro: CLI (cliente → codcontabil) / FOR (fornecedor → codcontabil_for). */
export type NaturezaConta = 'CLI' | 'FOR';

/**
 * Resolve a CONTA CONTÁBIL de um parceiro para o lançamento (baixa AR/AP + NF), T1.4.
 * Precedência (fiel a uTron.pas + CONFIG_PLANO_CONTAS): (1) a conta PRÓPRIA do parceiro
 * (PARCEIROS.CODCONTABIL p/ CLI, CODCONTABIL_FOR p/ FOR); (2) senão a ANALÍTICA DEFAULT do
 * CONFIG_PLANO_CONTAS (CODCONTAANALITICA_CLI/_FOR — as contas "DIVERSOS" catch-all); (3) senão null
 * (o chamador lança CONTA_PARCEIRO_NAO_DEFINIDA). Aplicado no MOMENTO do lançamento (não muta o parceiro
 * como o batch uTron; o resultado contábil é o mesmo). `parceiros.codcontabil/_for` são varchar → coação.
 */
export async function resolverContaContabilParceiro(db: AnyDB, codparceiro: number | null, natureza: NaturezaConta): Promise<number | null> {
  if (codparceiro == null) return null;
  const pc = (await db
    .selectFrom('parceiros')
    .select(['codcontabil', 'codcontabil_for'])
    .where('codparceiro', '=', codparceiro)
    .executeTakeFirst()) as { codcontabil?: unknown; codcontabil_for?: unknown } | undefined;
  const propria = natureza === 'CLI' ? pc?.codcontabil : pc?.codcontabil_for;
  const pn = Number(propria);
  // conta própria válida = numérica e > 0 (a coluna é VARCHAR; '0'/''/espaços/não-numérico caem no default).
  if (propria != null && String(propria).trim() !== '' && Number.isFinite(pn) && pn > 0) return pn;

  // fallback: conta-default analítica do CONFIG_PLANO_CONTAS (TIPO='E').
  const cfg = (await db
    .selectFrom('config_plano_contas')
    .select(['codcontaanalitica_cli', 'codcontaanalitica_for'])
    .where('tipo', '=', 'E')
    .executeTakeFirst()) as { codcontaanalitica_cli?: unknown; codcontaanalitica_for?: unknown } | undefined;
  const def = natureza === 'CLI' ? cfg?.codcontaanalitica_cli : cfg?.codcontaanalitica_for;
  const dn = Number(def);
  return def != null && Number.isFinite(dn) ? dn : null;
}
