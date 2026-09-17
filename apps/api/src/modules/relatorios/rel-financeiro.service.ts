import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelFinanceiroDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * RELATÓRIO FINANCEIRO (`FRMRELFINANCEIRO`, `UrelFinanceiro.pas`). **43 acessos, 7 operadores.**
 * Dossiê: `uRelFinanceiro.md`. Migration 238.
 *
 * Recebíveis (`ARECEBER`, 99.768 títulos) e compromissos (`APAGAR`, 55.210) no mesmo período e com os mesmos
 * filtros, cada linha trazendo a baixa ao lado do título — é o extrato que responde "o que entra e o que sai".
 *
 * ── ⚠️ O filtro por data de BAIXA do lado A RECEBER não funciona no legado ────────────────────────────
 * O legado monta o filtro **sem prefixo de tabela** (`:596`: `' AND ' + vCampoDataPG + ' BETWEEN ...'`) e o
 * cola num SELECT que já tem `LEFT JOIN ARECEBER_BX`. Como **as duas tabelas têm `DTPGTO`**, o Oracle
 * responde **ORA-00918, "coluna definida de maneira ambígua"** — verificado na produção. O operador escolhe
 * "Baixa", manda consultar e recebe a mensagem de erro do `except` (`'Erro : ... ao tentar abrir consulta
 * areceber.'`). A opção está na tela e não produz relatório nenhum.
 *
 * E se rodasse, rodaria errado: `ARECEBER.DTPGTO` é uma coluna **denormalizada e abandonada** — preenchida em
 * **6.819** dos **50.949** títulos quitados, contra **18.601** que têm baixa em `ARECEBER_BX`. Filtrar por ela
 * esconderia **11.782 títulos baixados, R$ 12.207.925,74**. Em agosto/2026 dá **0 linhas** onde o certo dá 24.
 *
 * Aqui a data de baixa é **sempre a da baixa** (`areceber_bx.dtpgto` / `apagar_bx.dtpgto`). Do lado A PAGAR o
 * legado já acerta por acidente: `APAGAR` **não tem** `DTPGTO`, então o nome resolve para o da baixa.
 *
 * ── ⚠️ O LIKE do parceiro anula o LEFT JOIN ───────────────────────────────────────────────────────────
 * `AND P.RAZAO LIKE '%x%'` (`:610`) sobre um `LEFT JOIN PARCEIROS` derruba todo título **sem** parceiro,
 * porque `NULL LIKE '%%'` é falso — o mesmo defeito já corrigido em outras telas. Aqui o filtro só se aplica
 * quando preenchido.
 *
 * ── Cópia fiel, inclusive no vazio ────────────────────────────────────────────────────────────────────
 * O `UNION ALL` do legado inclui cheques (`CHEQUE`, `CHEQUE_REP`, `CHQ_PROPRIO`) e permutas. No cliente:
 * `CHEQUE` tem **11** linhas e as outras três, **ZERO**. O corte cobre títulos; o ramo de cheque fica
 * declarado, sem substrato que justifique.
 */
@Injectable()
export class RelFinanceiroService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelFinanceiroDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { receber: number; pagar: number; recebido: number; pago: number; saldo: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const parceiro = f.parceiro ? `%${f.parceiro.toUpperCase()}%` : null;

    // a data que o período filtra, por lado. ⚠️ BAIXA é sempre a da BAIXA, nunca a coluna do título.
    const dataR = f.filtroData === 'EMISSAO' ? sql`r.dtvenda`
      : f.filtroData === 'BAIXA' ? sql`bx.dtpgto` : sql`r.dtvenc`;
    const dataP = f.filtroData === 'EMISSAO' ? sql`a.dtcompra`
      : f.filtroData === 'BAIXA' ? sql`pbx.dtpgto` : sql`a.dtvenc`;
    const sitR = f.situacao === 'ABERTO' ? sql`AND coalesce(r.quitada, 'N') = 'N'`
      : f.situacao === 'BAIXADO' ? sql`AND coalesce(r.quitada, 'N') = 'S'` : sql``;
    const sitP = f.situacao === 'ABERTO' ? sql`AND coalesce(a.quitada, 'N') = 'N'`
      : f.situacao === 'BAIXADO' ? sql`AND coalesce(a.quitada, 'N') = 'S'` : sql``;

    const linhas = (await sql<Record<string, unknown>>`
      WITH receber AS (
        -- o NRODOC do legado está preenchido em 1 linha de 99.769; o número que o operador reconhece é a
        -- duplicata, e é ela que aparece quando o outro é nulo
        SELECT 'R'::text AS lado, r.codrcb AS codigo,
               coalesce(nullif(trim(coalesce(r.nrodoc, '')), ''), r.duplicata) AS documento,
               r.dtvenda AS emissao, r.dtvenc AS vencimento, bx.dtpgto AS baixa,
               r.valor, bx.valorpg, coalesce(bx.acre_desc, 0) AS acre_desc, coalesce(bx.juros, 0) AS juros,
               coalesce(p.razao, '(sem parceiro)') AS parceiro, bx.idlote,
               coalesce(r.quitada, 'N') AS quitada, trim(coalesce(r.obs, '')) AS obs
          FROM areceber r
          LEFT JOIN parceiros p    ON p.codparceiro = r.codparceiro
          -- a baixa estornada fica de fora (INDR='E'); o título sem baixa continua aparecendo
          LEFT JOIN areceber_bx bx ON bx.codrcb = r.codrcb AND coalesce(bx.indr, 'I') = 'I'
         WHERE r.codempresa = ${emp}
           AND ${f.recebiveis} = 'S'
           -- o agrupado sai: ele já está representado pelo título do grupo
           AND coalesce(r.agrupado, 'N') = 'N'
           AND ${dataR}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitR}
           -- o filtro só se aplica quando preenchido, para não derrubar título sem parceiro
           AND (${parceiro}::text IS NULL OR upper(coalesce(p.razao, '')) LIKE ${parceiro}::text)
           AND (${f.codconta ?? null}::int IS NULL OR r.codconta = ${f.codconta ?? null}::int)
      ), pagar AS (
        -- o legado imprime o NRODUP como "documento" (CAST para texto), e ele é o número da PARCELA
        SELECT 'P'::text AS lado, a.codapg AS codigo, a.nrodup::text AS documento,
               a.dtcompra AS emissao, a.dtvenc AS vencimento, pbx.dtpgto AS baixa,
               a.valor, pbx.valorpg, coalesce(pbx.acre_desc, 0) AS acre_desc, coalesce(pbx.juros, 0) AS juros,
               coalesce(pe.razao, '(sem parceiro)') AS parceiro, pbx.idlote,
               coalesce(a.quitada, 'N') AS quitada, trim(coalesce(a.obs, '')) AS obs
          FROM apagar a
          LEFT JOIN parceiros pe ON pe.codparceiro = a.codparceiro
          LEFT JOIN apagar_bx pbx ON pbx.codapg = a.codapg AND coalesce(pbx.indr, 'I') = 'I'
         WHERE a.codempresa = ${emp}
           AND ${f.compromissos} = 'S'
           AND coalesce(a.agrupado, 'N') = 'N'
           AND ${dataP}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitP}
           AND (${parceiro}::text IS NULL OR upper(coalesce(pe.razao, '')) LIKE ${parceiro}::text)
      )
      SELECT * FROM (SELECT * FROM receber UNION ALL SELECT * FROM pagar) t
       ORDER BY t.vencimento, t.parceiro, t.codigo
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { receber: 0, pagar: 0, recebido: 0, pago: 0, saldo: 0 };
    // ⚠️ o valor do TÍTULO só entra uma vez, mesmo quando ele tem várias baixas: o LEFT JOIN multiplica a
    // linha (é o que o legado mostra, uma linha por baixa), mas somar o título N vezes inflaria o total.
    const vistos = new Set<string>();
    for (const l of linhas) {
      const chave = `${l.lado}:${l.codigo}`;
      if (!vistos.has(chave)) {
        vistos.add(chave);
        if (l.lado === 'R') t.receber += num(l.valor); else t.pagar += num(l.valor);
      }
      if (l.lado === 'R') t.recebido += num(l.valorpg); else t.pago += num(l.valorpg);
    }
    t.receber = r2(t.receber); t.pagar = r2(t.pagar);
    t.recebido = r2(t.recebido); t.pago = r2(t.pago);
    t.saldo = r2(t.receber - t.pagar);
    return { linhas, totais: t };
  }
}
