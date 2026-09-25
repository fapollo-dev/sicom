import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** as cédulas da contagem: Cx em centavos, Rx em reais (dossiê §4 — C25 só pelo nome) */
export const CEDULAS = ['c1', 'c5', 'c10', 'c25', 'c50', 'r1', 'r2', 'r5', 'r10', 'r20', 'r50', 'r100', 'r200'] as const;
export type Cedulas = Partial<Record<(typeof CEDULAS)[number], number>>;

/**
 * FECHAMENTO DE SANGRIA (`FRMFECHAMENTOSANGRIA`, "FECHAMENTO DE SANGRIA" — a tesouraria do binário novo; não está no fonte de 2020).
 * Dossiê: docs/04-screen-dossier/dossiers/retaguarda/tesouraria-sangria-fechamento.md. Tudo abaixo vem do dado da produção.
 *  - só a SANGRIA (TIPO 'SAN') entra: o suprimento nunca é autenticado nem fechado (2.763 de 2.763);
 *  - AUTENTICAR carimba cada sangria: AUTENTICADO 'S', quem, agora e um número PRÓPRIO por sangria (LOTE_AUTENTICADO, da sequência
 *    ID_LOTE_AUTENTICADO_SANGRIA — 51.241 valores distintos em 51.241 linhas); não gera movimento bancário;
 *  - FECHAR junta as sangrias de UMA loja num lote (ID_LOTE_FECHADO_SANGRIA; 3.009 de 3.009 lotes de uma loja só), carimba quem e
 *    agora, e grava UMA linha em CONTAGEM_CEDULAS (512 de 512 desde 27/07/2021) com o total. Com `FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO`
 *    = 'S' (Empresa;Usuario — a loja 1 na produção) só fecha sangria autenticada; em 2026 o fechamento não gera movimento bancário;
 *  - o VALOR da contagem = Σ das sangrias do lote (154 de 187 em 2026; as 33 restantes são de uma operadora cuja tela somou cada
 *    sangria 2 ou 3 vezes — defeito, não regra) e as cédulas são opcionais (0 em todas desde 22/08/2025);
 *  - ESTORNAR o lote: a contagem fica com INDR 'E' + quem e quando (e USULTALTERACAO/DTULTIMALTERACAO), e as sangrias voltam a abertas
 *    (as 4 colunas do fechamento a NULL) — 3 casos na produção.
 * Permissões do legado: FRMFECHAMENTOSANGRIA (acessar — é o que autentica: na loja 2 o fiscal do caixa autentica) e BTNPROCESSO
 * ("Fechar/Reverter").
 */
@Injectable()
export class FechamentoSangriaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private ctx() {
    const t = currentTenant();
    if (t.empresaId == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return { emp: Number(t.empresaId), op: t.operadorId ?? null };
  }

  /** as sangrias da loja no período (pela DATA da sangria) e os lotes (contagens) delas, com a divergência VALOR × Σ */
  async listar(f: { dataIni: string; dataFim: string }) {
    const { emp } = this.ctx();
    const db = this.dbp.forTenantRead() as AnyDB;
    const tz = String((await configNaTrx(db, 'FUSO_HORARIO_ACESSO', { empresaId: emp, operadorId: null, modulo: 'Retaguarda' })) ?? 'America/Sao_Paulo');
    const sangrias = (await sql<Record<string, unknown>>`
      SELECT h.codhistsangria, to_char(h.data AT TIME ZONE ${tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS data, h.codpdv, h.descricao, h.valor, h.nrodocumento,
             h.codoperador, o.nome AS operador, h.responsavel, orsp.nome AS nome_responsavel,
             h.autenticado, h.codoperador_autenticado, oa.nome AS autenticado_por, to_char(h.data_autenticado AT TIME ZONE ${tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_autenticado,
             h.lote_autenticado,
             h.fechado, h.codoperador_fechado, ofe.nome AS fechado_por, to_char(h.data_fechado AT TIME ZONE ${tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_fechado, h.lote_fechado
        FROM hist_sangria_suprimento h
        LEFT JOIN operadores o ON o.codoperador = h.codoperador
        LEFT JOIN operadores orsp ON orsp.codoperador = h.responsavel
        LEFT JOIN operadores oa ON oa.codoperador = h.codoperador_autenticado
        LEFT JOIN operadores ofe ON ofe.codoperador = h.codoperador_fechado
       WHERE h.idempresa = ${emp} AND h.tipo = 'SAN'
         AND h.data >= (${f.dataIni}::date)::timestamp AT TIME ZONE ${tz}
         AND h.data <  ((${f.dataFim}::date + 1)::timestamp AT TIME ZONE ${tz})
       ORDER BY h.data, h.codhistsangria`.execute(db)).rows;
    const lotesDasSangrias = [...new Set(sangrias.map((s) => n(s.lote_fechado)).filter((l) => l > 0))];
    const lotes = lotesDasSangrias.length
      ? (await sql<Record<string, unknown>>`
          SELECT c.codcontagem_cedulas, c.lote_fechado, c.valor, c.codoperador, o.nome AS operador,
                 to_char(c.data AT TIME ZONE ${tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS data, c.indr,
                 (SELECT coalesce(sum(h.valor), 0) FROM hist_sangria_suprimento h WHERE h.lote_fechado = c.lote_fechado) AS soma_sangrias,
                 (SELECT count(*) FROM hist_sangria_suprimento h WHERE h.lote_fechado = c.lote_fechado)::int AS sangrias,
                 ${sql.raw(CEDULAS.map((c) => `c.${c}`).join(', '))}
            FROM contagem_cedulas c LEFT JOIN operadores o ON o.codoperador = c.codoperador
           WHERE c.idempresa = ${emp} AND c.lote_fechado = ANY(${lotesDasSangrias}::int[]) AND coalesce(c.indr, '') <> 'E'
           ORDER BY c.lote_fechado`.execute(db)).rows
      : [];
    const exige = String((await configNaTrx(db, 'FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'N')
      .toUpperCase() === 'S';
    return {
      exigeAutenticacao: exige,
      sangrias: sangrias.map((s) => ({ ...s, valor: n(s.valor) })),
      lotes: lotes.map((l) => ({ ...l, valor: n(l.valor), soma_sangrias: n(l.soma_sangrias), divergente: r2(n(l.valor)) !== r2(n(l.soma_sangrias)) })),
    };
  }

  /** AUTENTICAR: cada sangria ganha AUTENTICADO 'S', o operador, agora e um número próprio da sequência (na ordem do código) */
  async autenticar(codigos: number[]): Promise<{ autenticadas: number }> {
    const { emp, op } = this.ctx();
    const ids = [...new Set((codigos ?? []).map(Number).filter((x) => x > 0))].sort((a, b) => a - b);
    if (!ids.length) throw new BusinessRuleError('SANGRIA_NENHUMA_SELECIONADA');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const linhas = (await sql<{ codhistsangria: number; tipo: string | null; autenticado: string | null }>`
        SELECT codhistsangria, tipo, autenticado FROM hist_sangria_suprimento
         WHERE codhistsangria = ANY(${ids}::int[]) AND idempresa = ${emp} ORDER BY codhistsangria FOR UPDATE`.execute(trx)).rows;
      if (linhas.length !== ids.length) throw new BusinessRuleError('SANGRIA_NAO_ENCONTRADA');
      if (linhas.some((l) => String(l.tipo ?? '') !== 'SAN')) throw new BusinessRuleError('SANGRIA_SUPRIMENTO_NAO_AUTENTICA');
      const ja = linhas.filter((l) => String(l.autenticado ?? '') === 'S').map((l) => Number(l.codhistsangria));
      if (ja.length) throw new BusinessRuleError('SANGRIA_JA_AUTENTICADA', { sangrias: ja });
      for (const id of ids) {
        await sql`UPDATE hist_sangria_suprimento SET autenticado = 'S', codoperador_autenticado = ${op}, data_autenticado = now(),
                    lote_autenticado = nextval('seq_lote_autenticado_sangria') WHERE codhistsangria = ${id}`.execute(trx);
      }
      return { autenticadas: ids.length };
    });
  }

  /** FECHAR: um lote da loja com as sangrias escolhidas e a contagem (VALOR = Σ; cédulas opcionais) */
  async fechar(dto: { sangrias: number[]; cedulas?: Cedulas }): Promise<{ lote: number; codcontagem_cedulas: number; valor: number }> {
    const { emp, op } = this.ctx();
    const ids = [...new Set((dto.sangrias ?? []).map(Number).filter((x) => x > 0))].sort((a, b) => a - b);
    if (!ids.length) throw new BusinessRuleError('SANGRIA_NENHUMA_SELECIONADA');
    for (const c of CEDULAS) {
      const v = dto.cedulas?.[c];
      if (v != null && (!Number.isInteger(Number(v)) || Number(v) < 0)) throw new BusinessRuleError('SANGRIA_CEDULA_INVALIDA', { cedula: c });
    }
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const linhas = (await sql<{ codhistsangria: number; tipo: string | null; valor: unknown; autenticado: string | null; fechado: string | null }>`
        SELECT codhistsangria, tipo, valor, autenticado, fechado FROM hist_sangria_suprimento
         WHERE codhistsangria = ANY(${ids}::int[]) AND idempresa = ${emp} ORDER BY codhistsangria FOR UPDATE`.execute(trx)).rows;
      if (linhas.length !== ids.length) throw new BusinessRuleError('SANGRIA_NAO_ENCONTRADA');
      if (linhas.some((l) => String(l.tipo ?? '') !== 'SAN')) throw new BusinessRuleError('SANGRIA_SUPRIMENTO_NAO_FECHA');
      const fechadas = linhas.filter((l) => String(l.fechado ?? '') === 'S').map((l) => Number(l.codhistsangria));
      if (fechadas.length) throw new BusinessRuleError('SANGRIA_JA_FECHADA', { sangrias: fechadas });
      const exige = String((await configNaTrx(trx, 'FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N').toUpperCase() === 'S';
      const semAutenticar = linhas.filter((l) => String(l.autenticado ?? '') !== 'S').map((l) => Number(l.codhistsangria));
      if (exige && semAutenticar.length) throw new BusinessRuleError('SANGRIA_EXIGE_AUTENTICACAO', { sangrias: semAutenticar });
      const lote = Number((await sql<{ v: string }>`SELECT nextval('seq_lote_fechado_sangria') AS v`.execute(trx)).rows[0].v);
      await sql`UPDATE hist_sangria_suprimento SET fechado = 'S', codoperador_fechado = ${op}, data_fechado = now(), lote_fechado = ${lote}
                 WHERE codhistsangria = ANY(${ids}::int[])`.execute(trx);
      const valor = r2(linhas.reduce((s, l) => s + n(l.valor), 0));
      const ced = Object.fromEntries(CEDULAS.map((c) => [c, Math.trunc(n(dto.cedulas?.[c]))]));
      const cont = (await trx.insertInto('contagem_cedulas').values({
        idempresa: emp, data: sql`now()`, dtcadastro: sql`now()`, valor, codoperador: op, lote_fechado: lote, ...ced,
      }).returning('codcontagem_cedulas').executeTakeFirstOrThrow()) as { codcontagem_cedulas: unknown };
      return { lote, codcontagem_cedulas: Number(cont.codcontagem_cedulas), valor };
    });
  }

  /** ESTORNAR o lote: a contagem fica marcada (INDR 'E') e as sangrias voltam a abertas */
  async estornar(codcontagem: number): Promise<{ lote: number; sangrias: number }> {
    const { emp, op } = this.ctx();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = (await sql<{ lote_fechado: unknown; indr: string | null }>`
        SELECT lote_fechado, indr FROM contagem_cedulas WHERE codcontagem_cedulas = ${codcontagem} AND idempresa = ${emp} FOR UPDATE`.execute(trx)).rows[0];
      if (!c) throw new BusinessRuleError('CONTAGEM_NAO_ENCONTRADA', { codcontagem });
      if (String(c.indr ?? '') === 'E') throw new BusinessRuleError('CONTAGEM_JA_ESTORNADA', { codcontagem });
      await sql`UPDATE contagem_cedulas SET indr = 'E', indr_usuario = ${op}, indr_data = now(), usultalteracao = ${op}, dtultimalteracao = now()
                 WHERE codcontagem_cedulas = ${codcontagem}`.execute(trx);
      const r = await sql`UPDATE hist_sangria_suprimento SET fechado = NULL, codoperador_fechado = NULL, data_fechado = NULL, lote_fechado = NULL
                           WHERE lote_fechado = ${n(c.lote_fechado)} AND idempresa = ${emp}`.execute(trx);
      return { lote: n(c.lote_fechado), sangrias: Number(r.numAffectedRows ?? 0) };
    });
  }
}
