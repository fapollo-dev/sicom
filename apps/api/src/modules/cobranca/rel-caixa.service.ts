import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
export type ModeloCaixa = 'DIVERGENCIAS' | 'ABERTOS';

/**
 * RELATÓRIOS DE CAIXA (`FRMRELCAIXA`, `URelCaixa.pas` + as classes de `UCaixa.pas`).
 * Dossiê: `uRelCaixa.md`. 505 acessos, 11 operadores, o último **em 08/09/2026** — tela viva.
 *
 * A tela do legado tem cinco modelos (`CmbTipoRelatorio`, `URelCaixa.dfm:118`): divergências, voucher,
 * apuração, caixas abertos e pedidos. Este corte traz os dois **operacionais**:
 *
 * **DIVERGÊNCIAS** (`TDivergenciasCaixa.GetSQL`, `UCaixa.pas:96`) — a conferência clássica: compara, por
 * (empresa, PDV, operador, dia, recurso), **o que o PDV registrou** com **o que foi lançado no caixa**.
 *   · o PDV: `CX_VENDAS` fechado (`STATUS='F'`), somando `VALOR − TROCO`, **fora** desconto, acréscimo,
 *     sangria e suprimento — essas quatro não são recebimento;
 *   · o caixa: `CAIXA` cujo centro de custo é conta de caixa (`PLC.TPCONTA = 0`) e que tem PDV;
 *   · **divergência = caixa − PDV**, e a linha só aparece se um dos dois lados for diferente de zero.
 *
 * **CAIXAS ABERTOS** (`TCaixasAbertos.GetSQL` :634) — as sessões de PDV do período que **ainda não foram
 * recolhidas** (`TESOURARIA <> 'S'`), com a hora de entrada e saída. É a lista de caixa que ficou em aberto.
 *
 * ⚠️ **ajuste inócuo, medido**: a consulta de divergências soma ao lado do caixa um valor de `HIST_DEVOLUCAO`
 * (devolução tipo 'D', só no recurso DINHEIRO, `:141`). Em produção a tabela tem **ZERO linhas** — a regra
 * fica registrada aqui e a tabela não foi criada. Se um dia aparecer devolução, é este o ponto de entrada.
 *
 * ADIADO (fiel): voucher, apuração do caixa e pedidos. A de pedidos depende de `PEDIDOS` e
 * `PEDIDO_ECOMMERCE`, que ainda não existem no Apollo.
 */
@Injectable()
export class RelCaixaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(modelo: ModeloCaixa, p: { dataIni: string; dataFim: string; codoperador?: number | null; recurso?: string | null }) {
    return modelo === 'DIVERGENCIAS' ? this.divergencias(p) : this.abertos(p);
  }

  private async divergencias(p: { dataIni: string; dataFim: string; codoperador?: number | null; recurso?: string | null }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = p.codoperador ?? null;
    const rec = p.recurso ?? null;

    const linhas = (await sql<Record<string, unknown>>`
      WITH pdv AS (   -- o que o PDV registrou
        SELECT c.idempresa, c.nropdv, c.operacao, c.codoperadora, c.data::date AS data,
               sum(c.valor - coalesce(c.troco, 0)) AS valor_cx_vendas
          FROM cx_vendas c
         WHERE c.status = 'F'
           AND upper(c.operacao) NOT IN ('DESCONTO','ACRESCIMO','SANGRIA','SUPRIMENTO')
           AND c.idempresa = ${emp}
           AND c.data::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
           AND (${op}::int IS NULL OR c.codoperadora = ${op}::int)
         GROUP BY c.idempresa, c.nropdv, c.operacao, c.codoperadora, c.data::date
      ), cx AS (      -- o que foi lançado no caixa (só conta de caixa: PLC.TPCONTA = 0)
        SELECT c.idempresa, c.codpdv AS nropdv, c.tiporecurso AS operacao, c.operador AS codoperadora,
               c.data::date AS data, sum(c.valor) AS valor_caixa
          FROM caixa c
          LEFT JOIN plc pl ON pl.codplc = c.codplc
         WHERE pl.tpconta = 0
           AND c.codpdv IS NOT NULL
           AND c.idempresa = ${emp}
           AND c.data::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
           AND (${op}::int IS NULL OR c.operador = ${op}::int)
         GROUP BY c.idempresa, c.codpdv, c.tiporecurso, c.operador, c.data::date
      )
      SELECT v.idempresa, e.fantasia, v.codoperadora AS operador, o.nome,
             to_char(v.data, 'YYYY-MM-DD') AS data, v.operacao AS tiporecurso, v.nropdv AS codpdv,
             coalesce(c.valor_caixa, 0) AS valor_caixa,
             coalesce(v.valor_cx_vendas, 0) AS valor_cx_vendas,
             (coalesce(c.valor_caixa, 0) - coalesce(v.valor_cx_vendas, 0)) AS divergencia
        FROM pdv v
        JOIN operadores o ON o.codoperador = v.codoperadora
        JOIN empresas   e ON e.idempresa   = v.idempresa
        LEFT JOIN cx c ON c.idempresa = v.idempresa AND c.nropdv = v.nropdv
                      AND c.operacao = v.operacao AND c.codoperadora = v.codoperadora AND c.data = v.data
       WHERE (coalesce(v.valor_cx_vendas, 0) <> 0 OR coalesce(c.valor_caixa, 0) <> 0)
         AND (${rec}::text IS NULL OR upper(v.operacao) = upper(${rec}::text))
       ORDER BY v.data, v.nropdv, v.operacao
       LIMIT 5001
    `.execute(db)).rows;

    const n = (v: unknown) => Number(v ?? 0);
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
    const comDif = linhas.filter((l) => Math.abs(n(l.divergencia)) >= 0.005);
    return {
      modelo: 'DIVERGENCIAS' as const,
      linhas,
      totais: {
        linhas: linhas.length,
        caixa: r2(linhas.reduce((s, l) => s + n(l.valor_caixa), 0)),
        pdv: r2(linhas.reduce((s, l) => s + n(l.valor_cx_vendas), 0)),
        divergencia: r2(linhas.reduce((s, l) => s + n(l.divergencia), 0)),
        comDivergencia: comDif.length,
      },
    };
  }

  private async abertos(p: { dataIni: string; dataFim: string; codoperador?: number | null }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = p.codoperador ?? null;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT c.idempresa, c.nropdv, o.nome, c.codoperadora, c.status, c.tesouraria,
             pv.codpdv, c.chave, cp.horaentrada, cp.horasaida, to_char(c.data, 'YYYY-MM-DD') AS data
        FROM cx_vendas c
        LEFT JOIN operadores o ON o.codoperador = c.codoperadora
        LEFT JOIN pdv pv       ON pv.nropdv = c.nropdv AND pv.codempresa = c.idempresa
        LEFT JOIN caixa_pdv cp ON cp.chave = c.chave AND cp.codpdv = c.nropdv
                              AND cp.data::date = c.data::date AND cp.idempresa = c.idempresa
       WHERE coalesce(c.tesouraria, 'N') <> 'S'
         AND c.idempresa = ${emp}
         AND c.data::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
         AND (${op}::int IS NULL OR c.codoperadora = ${op}::int)
       GROUP BY c.idempresa, c.nropdv, o.nome, c.codoperadora, c.status, c.tesouraria,
                pv.codpdv, c.chave, cp.horasaida, cp.horaentrada, c.data
       ORDER BY c.data, c.idempresa, c.nropdv, o.nome, cp.horaentrada
       LIMIT 5001
    `.execute(db)).rows;

    return { modelo: 'ABERTOS' as const, linhas, totais: { linhas: linhas.length } };
  }
}
