import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/** o `TIPO` do legado — cada ramo da união tem o seu, e é por ele que a tela agrupa. */
export const TIPO = { RECEBER: 1, CHEQUE: 2, CARTAO: 3, PAGAR: 4, CHEQUE_PROPRIO: 5 } as const;

export interface LinhaSaldo {
  venc: string; razao: string | null; tipodoc: string; documento: string | null;
  valor: number; tipo: number; banco: string | null; idempresa: number;
}

/**
 * SALDO DA EMPRESA (`FRMSALDOEMPRESA`, `uSaldoEmpresa.pas`). Dossiê: `uSaldoEmpresa.md`.
 * 611 acessos, 19 operadores — a próxima da fila por uso real depois da análise de notas.
 *
 * É um **fluxo de caixa projetado**: a UNIÃO de cinco fontes por data de vencimento (`sqqSaldo`,
 * `udmSaldoEmpresa.dfm:366`), com o dinheiro que entra positivo e o que sai negativo.
 *
 * | tipo | fonte | sinal | data que posiciona |
 * |---|---|---|---|
 * | 1 | `areceber` não quitada e não agrupada | + | `dtvenc` |
 * | 2 | `cheque` não baixado | + | `bompara` |
 * | 3 | `cartao` **não liberado** | + | `dtvenda + diascomp × nroparcela` |
 * | 4 | `apagar` não quitada e não agrupada | − | `dtvenc` |
 * | 5 | `chq_proprio` não baixado | − | `dtvenc` |
 *
 * Duas contas que não são óbvias e vêm do legado:
 *  · **a pagar** vale `(|VALOR| + VENDOR − DESCONTO) × −1` — o vendor entra e o desconto sai;
 *  · **o cartão** é projetado: a data é a venda mais os dias de compensação da operadora vezes a parcela, e o
 *    valor é o líquido da taxa (`VALOR − VALOR × txadm / 100`). O `coalesce(txadm, 0.1)` do legado é copiado —
 *    operadora sem taxa cadastrada assume 0,1%, não zero.
 *
 * ⚠️ **o cliente quase não usa cheque**: 11 linhas em `CHEQUE`, **zero** em `CHQ_PROPRIO`. Os dois ramos
 * entram porque são dinheiro em aberto e porque a tela os soma, mas não espere ver nada neles.
 */
@Injectable()
export class SaldoEmpresaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(p: { dataIni: string; dataFim: string; codparceiro?: number | null }): Promise<{
    linhas: LinhaSaldo[];
    porTipo: Array<{ tipo: number; tipodoc: string; itens: number; valor: number }>;
    porDia: Array<{ venc: string; entradas: number; saidas: number; saldo: number }>;
    total: { entradas: number; saidas: number; saldo: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const { dataIni, dataFim } = p;
    const parceiro = p.codparceiro ?? null;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT * FROM (
        -- 1) A RECEBER (+)
        SELECT to_char(r.dtvenc, 'YYYY-MM-DD') AS venc, p.razao, 'Contas a Receber' AS tipodoc,
               r.nrocupom::varchar(40) AS documento, r.valor AS valor, 1 AS tipo,
               b.banco::varchar(100) AS banco, r.codempresa AS idempresa
          FROM areceber r
          LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
          LEFT JOIN bancos b    ON b.codbco = r.codbco
         WHERE coalesce(r.quitada,'N') <> 'S' AND coalesce(r.agrupado,'N') = 'N'
           AND r.dtvenc::date BETWEEN ${dataIni}::date AND ${dataFim}::date
           AND r.codempresa = ${emp}
           AND (${parceiro}::int IS NULL OR r.codparceiro = ${parceiro}::int)
        UNION ALL
        -- 2) CHEQUE DE TERCEIROS (+) — pela data do "bom para"
        SELECT to_char(c.bompara, 'YYYY-MM-DD'), p.razao, 'Cheque', c.nrocheque::varchar(40),
               c.valor, 2, b.banco::varchar(100), c.idempresa
          FROM cheque c
          LEFT JOIN parceiros p ON p.codparceiro = c.codparceiro
          LEFT JOIN bancos b    ON b.codbco = c.codbco
         WHERE coalesce(c.baixado,'N') <> 'S'
           AND c.bompara::date BETWEEN ${dataIni}::date AND ${dataFim}::date
           AND c.idempresa = ${emp}
           AND (${parceiro}::int IS NULL OR c.codparceiro = ${parceiro}::int)
        UNION ALL
        -- 5) CHEQUE PRÓPRIO (−)
        SELECT to_char(cp.dtvenc, 'YYYY-MM-DD'), p.razao, 'Cheque Próprio', cp.nrocheque::varchar(40),
               (abs(cp.valor) * -1), 5, cb.titular::varchar(100), cp.idempresa
          FROM chq_proprio cp
          LEFT JOIN parceiros p        ON p.codparceiro = cp.codparceiro
          LEFT JOIN contas_bancarias cb ON cb.codconta = cp.codconta
         WHERE coalesce(cp.baixado,'N') <> 'S'
           AND cp.dtvenc::date BETWEEN ${dataIni}::date AND ${dataFim}::date
           AND cp.idempresa = ${emp}
           AND (${parceiro}::int IS NULL OR cp.codparceiro = ${parceiro}::int)
        UNION ALL
        -- 4) A PAGAR (−) — o vendor entra e o desconto sai, como no legado
        SELECT to_char(a.dtvenc, 'YYYY-MM-DD'), pe.razao, a.tipodoc, a.duplicata::varchar(40),
               ((abs(a.valor) + coalesce(a.vendor,0) - coalesce(a.desconto,0)) * -1), 4,
               b.banco::varchar(100), a.codempresa
          FROM apagar a
          LEFT JOIN parceiros pe ON pe.codparceiro = a.codparceiro
          LEFT JOIN bancos b     ON b.codbco = a.codbco
         WHERE coalesce(a.quitada,'N') <> 'S' AND coalesce(a.agrupado,'N') = 'N'
           AND a.dtvenc::date BETWEEN ${dataIni}::date AND ${dataFim}::date
           AND a.codempresa = ${emp}
           AND (${parceiro}::int IS NULL OR a.codparceiro = ${parceiro}::int)
        UNION ALL
        -- 3) CARTÃO A RECEBER (+) — data e valor PROJETADOS pela operadora
        SELECT to_char((ca.dtvenda::date + (coalesce(o.diascomp,0) * coalesce(ca.nroparcela,1))), 'YYYY-MM-DD'),
               'AO CONSUMIDOR', 'Cartão', 'ECF'::varchar(40),
               (ca.valor - (ca.valor * coalesce(o.txadm, 0.1) / 100))::numeric(13,2), 3,
               'BANCO'::varchar(100), ca.idempresa
          FROM cartao ca
          LEFT JOIN operadoras o ON o.codoperadoras = ca.codoperadora
         WHERE coalesce(ca.liberado,'N') <> 'S'
           AND (ca.dtvenda::date + (coalesce(o.diascomp,0) * coalesce(ca.nroparcela,1)))
               BETWEEN ${dataIni}::date AND ${dataFim}::date
           AND ca.idempresa = ${emp}
           AND ${parceiro}::int IS NULL   -- o cartão é "ao consumidor": não tem parceiro para filtrar
      ) s
      ORDER BY venc, tipo
      LIMIT 20001
    `.execute(db)).rows as unknown as LinhaSaldo[];

    const n = (v: unknown) => Number(v ?? 0);
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

    const porTipoMap = new Map<number, { tipo: number; tipodoc: string; itens: number; valor: number }>();
    const porDiaMap = new Map<string, { venc: string; entradas: number; saidas: number; saldo: number }>();
    let entradas = 0;
    let saidas = 0;
    for (const l of linhas) {
      const v = n(l.valor);
      const t = porTipoMap.get(l.tipo) ?? { tipo: l.tipo, tipodoc: l.tipodoc, itens: 0, valor: 0 };
      t.itens += 1; t.valor = r2(t.valor + v); porTipoMap.set(l.tipo, t);
      const d = porDiaMap.get(l.venc) ?? { venc: l.venc, entradas: 0, saidas: 0, saldo: 0 };
      if (v >= 0) d.entradas = r2(d.entradas + v); else d.saidas = r2(d.saidas + v);
      d.saldo = r2(d.entradas + d.saidas); porDiaMap.set(l.venc, d);
      if (v >= 0) entradas = r2(entradas + v); else saidas = r2(saidas + v);
    }
    return {
      linhas,
      porTipo: Array.from(porTipoMap.values()).sort((a, b) => a.tipo - b.tipo),
      porDia: Array.from(porDiaMap.values()).sort((a, b) => a.venc.localeCompare(b.venc)),
      total: { entradas, saidas, saldo: r2(entradas + saidas) },
    };
  }
}
