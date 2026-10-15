import { sql, type Kysely, type RawBuilder } from 'kysely';
import { currentTenant } from '../../shared/tenant/tenant-context';

type AnyDB = Kysely<any>;

/**
 * O plano gerencial dos relatórios de caixa (uRelatorioCaixa.pas, `TRelCaixa`): os níveis da máscara da empresa (`GetNivelPLCEmpresa` —
 * EMPRESAS.MASCARAPLC; '#.##.###' nas lojas da produção = 3 níveis) e os níveis acima da conta (1..niveis-1).
 */
export async function estruturaPlc(db: AnyDB, empresa: number): Promise<{ niveis: number; acima: number[] }> {
  const r = (await db.selectFrom('empresas').select('mascaraplc').where('idempresa', '=', empresa).executeTakeFirst()) as { mascaraplc?: string | null } | undefined;
  const niveis = Math.max(1, String(r?.mascaraplc ?? '#.##.###').split('.').filter((x) => x !== '').length);
  return { niveis, acima: Array.from({ length: niveis - 1 }, (_, i) => i + 1) };
}

/** `GetJoinFixo`: P{n-1} é o pai da conta (`alias`), P{i} o pai de P{i+1}… */
export function joinFixo(niveis: number, alias = 'p'): RawBuilder<unknown> {
  const linhas: string[] = [];
  for (let i = niveis - 1; i >= 1; i--) linhas.push(`LEFT JOIN plc p${i} ON p${i}.codplc = ${i === niveis - 1 ? alias : `p${i + 1}`}.codpai`);
  return sql.raw(linhas.join(' '));
}

/** `GetParteFixaSQL` (com os aliases _NVLn); `comLimite` acrescenta o LIMITEPLC_NVLn que os layouts da produção leem */
export function parteFixa(acima: number[], comLimite = false): RawBuilder<unknown> {
  return sql.raw(acima.map((i) => `, p${i}.codplc AS codplc_nvl${i}, p${i}.descricao AS descricao_nvl${i}, p${i}.desccodplc AS desccodplc_nvl${i}`
    + (comLimite ? `, p${i}.limiteplc AS limiteplc_nvl${i}` : '')).join(''));
}

/** as mesmas colunas no GROUP BY (`GetParteFixaSQL(True, False)`, sem os aliases) */
export function parteFixaGrupo(acima: number[], comLimite = false): RawBuilder<unknown> {
  return sql.raw(acima.map((i) => `, p${i}.codplc, p${i}.descricao, p${i}.desccodplc` + (comLimite ? `, p${i}.limiteplc` : '')).join(''));
}

/** os nomes _NVLn de uma subconsulta (`GetParteFixaSQL(False, False, 'X', True)`) */
export function colunasNvl(acima: number[], alias: string): RawBuilder<unknown> {
  return sql.raw(acima.map((i) => `, ${alias}.codplc_nvl${i}, ${alias}.descricao_nvl${i}, ${alias}.desccodplc_nvl${i}`).join(''));
}

/**
 * `SetListaCodPLCProprietario` + `FiltraPLCProprietario` (uRelatorioCaixa.pas:243/268): para quem não é PRO, a lista dos centros de custo
 * de proprietário — a conta APENAS_PROPRIETARIO, as abaixo dela (até 3 níveis) e as de cima de cada uma. Vazia para o PRO.
 */
export async function plcsOcultosDoOperador(db: AnyDB): Promise<Set<number>> {
  const op = currentTenant().operadorId ?? null;
  const tipoop = op == null ? null : ((await db.selectFrom('operadores').select('tipoop').where('codoperador', '=', op).executeTakeFirst()) as { tipoop?: string } | undefined)?.tipoop;
  const s = new Set<number>();
  if (String(tipoop ?? '') === 'PRO') return s;
  const rows = (await sql<{ a: number | null; b: number | null; c: number | null; d: number | null }>`
    SELECT p4.codplc AS a, p3.codplc AS b, p2.codplc AS c, p1.codplc AS d
      FROM plc p4 LEFT JOIN plc p3 ON p4.codpai = p3.codplc LEFT JOIN plc p2 ON p3.codpai = p2.codplc LEFT JOIN plc p1 ON p2.codpai = p1.codplc
     WHERE p4.apenas_proprietario = 'S' OR p3.apenas_proprietario = 'S' OR p2.apenas_proprietario = 'S' OR p1.apenas_proprietario = 'S'`.execute(db)).rows;
  for (const r of rows) for (const v of [r.a, r.b, r.c, r.d]) if (v != null) s.add(Number(v));
  return s;
}
