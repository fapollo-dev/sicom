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
 * ── Os cinco ramos do legado (UdmRelFinanceiro.dfm, `sqqDtos`) ────────────────────────────────────────
 * Recebíveis: títulos (ARECEBER), CHEQUE (11 no cliente) e CARTÃO (2,06 mi) — o cartão vence em
 * `DTVENDA + DIASCOMP × NROPARCELA`, recebe o valor menos a taxa da operadora (0,1% se a operadora não tem) quando LIBERADO,
 * mostra a taxa na coluna de juros e a operadora no lugar do parceiro (o filtro de parceiro não vale para ele). Compromissos: títulos
 * (APAGAR) e CHEQUE PRÓPRIO. O cheque de terceiros mostra o VALOR como pago mesmo em aberto — é o SQL do legado. `cmbRecebiveis`
 * e `cmbCompromissos` escolhem os ramos. O filtro de CONTA é o do legado: o LOTE que passou pela conta
 * (`IDLOTE IN (SELECT IDLOTE FROM MOV_CONTAS_BANCARIAS WHERE CODCONTA = …)`), em todos os ramos.
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
    // os outros três ramos: a data e a situação de cada um, como o `MontaRelatorioAnaliseDescritiva` (UrelFinanceiro.pas:529-575)
    const vencCartao = sql`(ca.dtvenda + (coalesce(o.diascomp, 0) * coalesce(ca.nroparcela, 1)) * interval '1 day')`;
    const dataCa = f.filtroData === 'EMISSAO' ? sql`ca.dtvenda` : f.filtroData === 'BAIXA' ? sql`ca.dtbaixa` : vencCartao;
    const dataCh = f.filtroData === 'EMISSAO' ? sql`ch.dtemissao` : f.filtroData === 'BAIXA' ? sql`ch.databaixa` : sql`ch.bompara`;
    const dataCp = f.filtroData === 'EMISSAO' ? sql`cp.dtemissao` : f.filtroData === 'BAIXA' ? sql`cp.dtbaixa` : sql`cp.dtvenc`;
    const sitSN = (col: ReturnType<typeof sql>) => (f.situacao === 'ABERTO' ? sql`AND coalesce(${col}, 'N') = 'N'`
      : f.situacao === 'BAIXADO' ? sql`AND coalesce(${col}, 'N') = 'S'` : sql``);
    const rTitulos = f.recebiveis === 'S' && (f.tipoRecebivel === 'TODOS' || f.tipoRecebivel === 'TITULOS');
    const rCheque = f.recebiveis === 'S' && (f.tipoRecebivel === 'TODOS' || f.tipoRecebivel === 'CHEQUE');
    const rCartao = f.recebiveis === 'S' && (f.tipoRecebivel === 'TODOS' || f.tipoRecebivel === 'CARTAO');
    const pTitulos = f.compromissos === 'S' && (f.tipoCompromisso === 'TODOS' || f.tipoCompromisso === 'TITULOS');
    const pCheque = f.compromissos === 'S' && (f.tipoCompromisso === 'TODOS' || f.tipoCompromisso === 'CHEQUE');
    const sim = (b: boolean) => (b ? 'S' : 'N');

    const linhas = (await sql<Record<string, unknown>>`
      WITH receber AS (
        -- o NRODOC do legado está preenchido em 1 linha de 99.769; o número que o operador reconhece é a
        -- duplicata, e é ela que aparece quando o outro é nulo
        SELECT 'R'::text AS lado, 'TITULO'::text AS tipo_doc, r.codrcb AS codigo,
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
           AND ${sim(rTitulos)} = 'S'
           -- o agrupado sai: ele já está representado pelo título do grupo
           AND coalesce(r.agrupado, 'N') = 'N'
           AND ${dataR}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitR}
           -- o filtro só se aplica quando preenchido, para não derrubar título sem parceiro
           AND (${parceiro}::text IS NULL OR upper(coalesce(p.razao, '')) LIKE ${parceiro}::text)
      ), cheque AS (
        SELECT 'R'::text AS lado, 'CHEQUE'::text AS tipo_doc, ch.codchq AS codigo, ch.nrocheque::text AS documento,
               ch.dtemissao AS emissao, ch.bompara AS vencimento, ch.databaixa AS baixa,
               ch.valor, ch.valor AS valorpg, 0::numeric AS acre_desc, 0::numeric AS juros,
               coalesce(p.razao, '(sem parceiro)') AS parceiro, ch.idlote,
               coalesce(ch.baixado, 'N') AS quitada, trim(coalesce(ch.observacao, '')) AS obs
          FROM cheque ch
          LEFT JOIN parceiros p ON p.codparceiro = ch.codparceiro
         WHERE ch.idempresa = ${emp}
           AND ${sim(rCheque)} = 'S'
           AND ${dataCh}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitSN(sql`ch.baixado`)}
           AND (${parceiro}::text IS NULL OR upper(coalesce(p.razao, '')) LIKE ${parceiro}::text)
      ), cartao AS (
        SELECT 'R'::text AS lado, 'CARTAO'::text AS tipo_doc, ca.codvendcartao AS codigo, ca.nrocupom::text AS documento,
               ca.dtvenda AS emissao, ${vencCartao} AS vencimento, ca.dtbaixa AS baixa,
               ca.valor,
               CASE WHEN coalesce(ca.liberado, 'N') = 'N' THEN 0 ELSE ca.valor - (ca.valor * coalesce(o.txadm, 0.1) / 100) END AS valorpg,
               0::numeric AS acre_desc, (ca.valor * coalesce(o.txadm, 0.1) / 100) AS juros,
               coalesce(o.operadora, '(sem operadora)') AS parceiro, ca.idlote,
               coalesce(ca.liberado, 'N') AS quitada, trim(coalesce(ca.obs, '')) AS obs
          FROM cartao ca
          LEFT JOIN operadoras o ON o.codoperadoras = ca.codoperadora
         WHERE ca.idempresa = ${emp}
           AND ${sim(rCartao)} = 'S'
           AND ${dataCa}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitSN(sql`ca.liberado`)}
      ), chq_proprio AS (
        SELECT 'P'::text AS lado, 'CHQ_PROPRIO'::text AS tipo_doc, cp.codchqproprio AS codigo, cp.nrocheque::text AS documento,
               cp.dtemissao AS emissao, cp.dtvenc AS vencimento, cp.dtbaixa AS baixa,
               cp.valor, cp.valor AS valorpg, 0::numeric AS acre_desc, 0::numeric AS juros,
               coalesce(p.razao, '(sem parceiro)') AS parceiro, cp.idlote,
               coalesce(cp.baixado, 'N') AS quitada, trim(coalesce(cp.historico, '')) AS obs
          FROM chq_proprio cp
          LEFT JOIN parceiros p ON p.codparceiro = cp.codparceiro
         WHERE cp.idempresa = ${emp}
           AND ${sim(pCheque)} = 'S'
           AND ${dataCp}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitSN(sql`cp.baixado`)}
           AND (${parceiro}::text IS NULL OR upper(coalesce(p.razao, '')) LIKE ${parceiro}::text)
      ), pagar AS (
        -- o legado imprime o NRODUP como "documento" (CAST para texto), e ele é o número da PARCELA
        SELECT 'P'::text AS lado, 'TITULO'::text AS tipo_doc, a.codapg AS codigo, a.nrodup::text AS documento,
               a.dtcompra AS emissao, a.dtvenc AS vencimento, pbx.dtpgto AS baixa,
               a.valor, pbx.valorpg, coalesce(pbx.acre_desc, 0) AS acre_desc, coalesce(pbx.juros, 0) AS juros,
               coalesce(pe.razao, '(sem parceiro)') AS parceiro, pbx.idlote,
               coalesce(a.quitada, 'N') AS quitada, trim(coalesce(a.obs, '')) AS obs
          FROM apagar a
          LEFT JOIN parceiros pe ON pe.codparceiro = a.codparceiro
          LEFT JOIN apagar_bx pbx ON pbx.codapg = a.codapg AND coalesce(pbx.indr, 'I') = 'I'
         WHERE a.codempresa = ${emp}
           AND ${sim(pTitulos)} = 'S'
           AND coalesce(a.agrupado, 'N') = 'N'
           AND ${dataP}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitP}
           AND (${parceiro}::text IS NULL OR upper(coalesce(pe.razao, '')) LIKE ${parceiro}::text)
      )
      SELECT * FROM (SELECT * FROM receber UNION ALL SELECT * FROM cheque UNION ALL SELECT * FROM cartao
                     UNION ALL SELECT * FROM chq_proprio UNION ALL SELECT * FROM pagar) t
       -- a conta: o LOTE que passou por ela (o filtro do legado, em todos os ramos)
       WHERE (${f.codconta ?? null}::int IS NULL
              OR t.idlote IN (SELECT m.idlote FROM mov_contas_bancarias m WHERE m.codconta = ${f.codconta ?? null}::int AND m.idlote IS NOT NULL))
       ORDER BY t.vencimento, t.parceiro, t.codigo
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { receber: 0, pagar: 0, recebido: 0, pago: 0, saldo: 0 };
    // ⚠️ o valor do TÍTULO só entra uma vez, mesmo quando ele tem várias baixas: o LEFT JOIN multiplica a
    // linha (é o que o legado mostra, uma linha por baixa), mas somar o título N vezes inflaria o total.
    const vistos = new Set<string>();
    for (const l of linhas) {
      const chave = `${l.lado}:${l.tipo_doc}:${l.codigo}`;
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
