import type { Kysely } from 'kysely';
import { BusinessRuleError } from '../errors/app-error';
import { currentTenant } from '../tenant/tenant-context';

type AnyDB = Kysely<any>;

/**
 * As empresas do `dmPrincipal.GetMultiEmpresa` do legado: as marcadas, recortadas às lojas do operador (RELACAO_OPERADOR_EMPRESA; a do
 * login sempre entra). Nada marcado = a loja do login (o `IdEmpresas := EmpresaCODEMPRESA` quando o diálogo volta vazio).
 */
export async function empresasDoOperador(db: AnyDB, pedidas: number[] | null | undefined): Promise<number[]> {
  const emp = currentTenant().empresaId ?? null;
  if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
  const op = currentTenant().operadorId ?? null;
  const rel = op == null ? [] : ((await db.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', op).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa));
  const permitidas = new Set([emp, ...rel]);
  const lista = [...new Set(pedidas?.length ? pedidas : [emp])].filter((e) => permitidas.has(e));
  if (!lista.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: pedidas });
  return lista;
}

/**
 * Todas as lojas que o operador alcança (a do login + RELACAO_OPERADOR_EMPRESA): para as telas cujo SQL do legado não filtra loja
 * nenhuma (o simulador de vendas soma o banco inteiro) — o Apollo não passa do que o operador pode ver.
 */
export async function todasAsEmpresasDoOperador(db: AnyDB): Promise<number[]> {
  const emp = currentTenant().empresaId ?? null;
  if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
  const op = currentTenant().operadorId ?? null;
  const rel = op == null ? [] : ((await db.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', op).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa));
  return [...new Set([emp, ...rel])].sort((a, b) => a - b);
}
