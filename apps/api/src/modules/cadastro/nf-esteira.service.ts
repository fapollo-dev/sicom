import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { NfEsteiraConsultaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * A ESTEIRA DA NOTA — as dez etapas do manifesto à devolução. Migration 292.
 * Dossiê `uNfStatusProcesso.md`.
 *
 * ⚠️ `P` (pendente) não tem data: a etapa está prevista e não aconteceu. **201.557 das 440.571 linhas** do
 * cliente estão assim, e é justamente isso que permite responder a pergunta que importa — em que etapa
 * cada nota travou.
 */
@Injectable()
export class NfEsteiraService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(q: NfEsteiraConsultaDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    if (q.chavenfe) {
      const etapas = (await sql<Record<string, unknown>>`
          SELECT e.ordem, e.processo, e.processo_desc, e.status, e.dataprocesso, e.codoperador,
                 o.nome AS operador
            FROM nf_status_processo e
            LEFT JOIN operadores o ON o.codoperador = e.codoperador
           WHERE e.idempresa = ${emp} AND e.chavenfe = ${q.chavenfe}
           ORDER BY e.ordem`.execute(db)).rows;
      // a nota pode existir ou não: a esteira começa no manifesto, antes de virar NF
      const nota = (await sql<{ codnf: number; nronf: string }>`
          SELECT codnf, nronf FROM nf
           WHERE chavenfe = ${q.chavenfe} AND idempresa = ${emp}`.execute(db)).rows[0];
      // onde travou = a primeira etapa pendente, na ordem
      const travou = etapas.find((e) => e.status === 'P') ?? null;
      return {
        chavenfe: q.chavenfe,
        codnf: nota ? Number(nota.codnf) : null,
        nronf: nota?.nronf ?? null,
        // a nota que nunca entrou tem esteira mesmo assim — é o registro de que ela foi manifestada
        virou_nf: !!nota,
        concluidas: etapas.filter((e) => e.status === 'R').length,
        total: etapas.length,
        parada_em: travou ? { ordem: Number(travou.ordem), processo: travou.processo,
                              descricao: travou.processo_desc } : null,
        etapas: etapas.map((e) => ({
          ordem: Number(e.ordem), processo: e.processo, descricao: e.processo_desc,
          status: e.status, realizada: e.status === 'R',
          // pendente NÃO tem data, e a resposta diz isso em vez de inventar uma
          dataprocesso: e.dataprocesso ?? null,
          operador: e.operador ?? null,
        })),
      };
    }

    // o painel: quantas notas estão paradas em cada etapa
    const paradas = (await sql<Record<string, unknown>>`
        SELECT e.ordem, e.processo, e.processo_desc, count(*) AS notas
          FROM nf_status_processo e
         WHERE e.idempresa = ${emp} AND e.status = 'P'
           -- só conta como "parada AQUI" a PRIMEIRA pendente da nota: as seguintes são consequência
           AND NOT EXISTS (SELECT 1 FROM nf_status_processo a
                            WHERE a.idempresa = e.idempresa AND a.chavenfe = e.chavenfe
                              AND a.status = 'P' AND a.ordem < e.ordem)
         GROUP BY e.ordem, e.processo, e.processo_desc
         ORDER BY e.ordem
         LIMIT ${q.limite}`.execute(db)).rows;
    return {
      paradas: paradas.map((p) => ({
        ordem: Number(p.ordem), processo: p.processo, descricao: p.processo_desc,
        notas: Number(p.notas),
      })),
      total_paradas: paradas.reduce((a, p) => a + Number(p.notas), 0),
    };
  }
}
