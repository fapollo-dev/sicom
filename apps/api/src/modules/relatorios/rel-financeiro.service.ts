import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelFinanceiroDto, RelFinanceiroReceberDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

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
 *
 * ── Fidelidade (06/10/2026) ───────────────────────────────────────────────────────────────────────────
 * As lojas do GetMultiEmpresa; a ordem do `sqqDtos` (`ORDER BY 9, 8` = LOTE, RAZÃO — o relatório agrupa por TIPO, CÓDIGO e LOTE nessa
 * ordem); a situação e o LIKE do parceiro exatos (`QUITADA = 'N'`; `P.RAZAO LIKE '%x%'`, com maiúsculas como digitado); e o
 * `rgTipoClick`: com a situação "todos" o filtro de data fica travado em VENCIMENTO. As linhas trazem também as colunas do `cdsDoctos`
 * (VENC, EMISSAO, PAGAMENTO, RAZAO crua, NRODOC, CODIGO "cod_tipo", TIPO 1-5, IDLOTEBXRCB) para a impressão.
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
    const db = this.dbp.forTenantRead() as AnyDB;
    const linhas = await this.docs(db, f, await this.lojas(db, f.empresas));
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

  private async lojas(db: AnyDB, empresas?: string): Promise<number[]> {
    const pedidas = empresas ? empresas.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : [];
    return pedidas.length ? empresasDoOperador(db, pedidas) : [this.emp()];
  }

  /** o `cdsDoctos` (sqqDtos + os filtros do `MontaRelatorioAnaliseDescritiva`) */
  private async docs(db: AnyDB, f0: RelFinanceiroDto, emps: number[], limite = f0.limite): Promise<Array<Record<string, unknown>>> {
    // o rgTipoClick: com "todos" o rgFiltro fica desabilitado e travado em VENCIMENTO
    const f = { ...f0, filtroData: f0.situacao === 'TODOS' ? 'VENCIMENTO' as const : f0.filtroData };
    const parceiro = f.parceiro ? `%${f.parceiro}%` : null;

    // a data que o período filtra, por lado. ⚠️ BAIXA é sempre a da BAIXA, nunca a coluna do título.
    const dataR = f.filtroData === 'EMISSAO' ? sql`r.dtvenda`
      : f.filtroData === 'BAIXA' ? sql`bx.dtpgto` : sql`r.dtvenc`;
    const dataP = f.filtroData === 'EMISSAO' ? sql`a.dtcompra`
      : f.filtroData === 'BAIXA' ? sql`pbx.dtpgto` : sql`a.dtvenc`;
    const sitR = f.situacao === 'ABERTO' ? sql`AND r.quitada = 'N'` : f.situacao === 'BAIXADO' ? sql`AND r.quitada = 'S'` : sql``;
    const sitP = f.situacao === 'ABERTO' ? sql`AND a.quitada = 'N'` : f.situacao === 'BAIXADO' ? sql`AND a.quitada = 'S'` : sql``;
    // os outros três ramos: a data e a situação de cada um, como o `MontaRelatorioAnaliseDescritiva` (UrelFinanceiro.pas:529-575)
    const vencCartao = sql`(ca.dtvenda + (coalesce(o.diascomp, 0) * coalesce(ca.nroparcela, 1)) * interval '1 day')`;
    const dataCa = f.filtroData === 'EMISSAO' ? sql`ca.dtvenda` : f.filtroData === 'BAIXA' ? sql`ca.dtbaixa` : vencCartao;
    const dataCh = f.filtroData === 'EMISSAO' ? sql`ch.dtemissao` : f.filtroData === 'BAIXA' ? sql`ch.databaixa` : sql`ch.bompara`;
    const dataCp = f.filtroData === 'EMISSAO' ? sql`cp.dtemissao` : f.filtroData === 'BAIXA' ? sql`cp.dtbaixa` : sql`cp.dtvenc`;
    const sitSN = (col: ReturnType<typeof sql>) => (f.situacao === 'ABERTO' ? sql`AND ${col} = 'N'` : f.situacao === 'BAIXADO' ? sql`AND ${col} = 'S'` : sql``);
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
               coalesce(r.quitada, 'N') AS quitada, trim(coalesce(r.obs, '')) AS obs,
               '1'::text AS tipo, r.codrcb || '_1' AS codigo_doc, r.nrodoc::text AS nrodoc, p.razao, bx.idlote AS idlotebxrcb, r.codempresa AS idempresa
          FROM areceber r
          LEFT JOIN parceiros p    ON p.codparceiro = r.codparceiro
          -- a baixa estornada fica de fora (INDR='E'); o título sem baixa continua aparecendo
          LEFT JOIN areceber_bx bx ON bx.codrcb = r.codrcb AND coalesce(bx.indr, 'I') = 'I'
         WHERE r.codempresa = ANY(${emps})
           AND ${sim(rTitulos)} = 'S'
           -- o agrupado sai: ele já está representado pelo título do grupo
           AND coalesce(r.agrupado, 'N') = 'N'
           AND ${dataR}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitR}
           -- o filtro só se aplica quando preenchido, para não derrubar título sem parceiro
           AND (${parceiro}::text IS NULL OR p.razao LIKE ${parceiro}::text)
      ), cheque AS (
        SELECT 'R'::text AS lado, 'CHEQUE'::text AS tipo_doc, ch.codchq AS codigo, ch.nrocheque::text AS documento,
               ch.dtemissao AS emissao, ch.bompara AS vencimento, ch.databaixa AS baixa,
               ch.valor, ch.valor AS valorpg, 0::numeric AS acre_desc, 0::numeric AS juros,
               coalesce(p.razao, '(sem parceiro)') AS parceiro, ch.idlote,
               coalesce(ch.baixado, 'N') AS quitada, trim(coalesce(ch.observacao, '')) AS obs,
               '2'::text, ch.codchq || '_2', ch.nrocheque::text, p.razao, ch.idlotebxrcb, ch.idempresa
          FROM cheque ch
          LEFT JOIN parceiros p ON p.codparceiro = ch.codparceiro
         WHERE ch.idempresa = ANY(${emps})
           AND ${sim(rCheque)} = 'S'
           AND ${dataCh}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitSN(sql`ch.baixado`)}
           AND (${parceiro}::text IS NULL OR p.razao LIKE ${parceiro}::text)
      ), cartao AS (
        SELECT 'R'::text AS lado, 'CARTAO'::text AS tipo_doc, ca.codvendcartao AS codigo, ca.nrocupom::text AS documento,
               ca.dtvenda AS emissao, ${vencCartao} AS vencimento, ca.dtbaixa AS baixa,
               ca.valor,
               CASE WHEN coalesce(ca.liberado, 'N') = 'N' THEN 0 ELSE ca.valor - (ca.valor * coalesce(o.txadm, 0.1) / 100) END AS valorpg,
               0::numeric AS acre_desc, (ca.valor * coalesce(o.txadm, 0.1) / 100) AS juros,
               coalesce(o.operadora, '(sem operadora)') AS parceiro, ca.idlote,
               coalesce(ca.liberado, 'N') AS quitada, trim(coalesce(ca.obs, '')) AS obs,
               '3'::text, ca.codvendcartao || '_3', ca.nrocupom::text, o.operadora::text, ca.idlote, ca.idempresa
          FROM cartao ca
          LEFT JOIN operadoras o ON o.codoperadoras = ca.codoperadora
         WHERE ca.idempresa = ANY(${emps})
           AND ${sim(rCartao)} = 'S'
           AND ${dataCa}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitSN(sql`ca.liberado`)}
      ), chq_proprio AS (
        SELECT 'P'::text AS lado, 'CHQ_PROPRIO'::text AS tipo_doc, cp.codchqproprio AS codigo, cp.nrocheque::text AS documento,
               cp.dtemissao AS emissao, cp.dtvenc AS vencimento, cp.dtbaixa AS baixa,
               cp.valor, cp.valor AS valorpg, 0::numeric AS acre_desc, 0::numeric AS juros,
               coalesce(p.razao, '(sem parceiro)') AS parceiro, cp.idlote,
               coalesce(cp.baixado, 'N') AS quitada, trim(coalesce(cp.historico, '')) AS obs,
               '4'::text, cp.codchqproprio || '_4', cp.nrocheque::text, p.razao, cp.idlote, cp.idempresa
          FROM chq_proprio cp
          LEFT JOIN parceiros p ON p.codparceiro = cp.codparceiro
         WHERE cp.idempresa = ANY(${emps})
           AND ${sim(pCheque)} = 'S'
           AND ${dataCp}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitSN(sql`cp.baixado`)}
           AND (${parceiro}::text IS NULL OR p.razao LIKE ${parceiro}::text)
      ), pagar AS (
        -- o legado imprime o NRODUP como "documento" (CAST para texto), e ele é o número da PARCELA
        SELECT 'P'::text AS lado, 'TITULO'::text AS tipo_doc, a.codapg AS codigo, a.nrodup::text AS documento,
               a.dtcompra AS emissao, a.dtvenc AS vencimento, pbx.dtpgto AS baixa,
               a.valor, pbx.valorpg, coalesce(pbx.acre_desc, 0) AS acre_desc, coalesce(pbx.juros, 0) AS juros,
               coalesce(pe.razao, '(sem parceiro)') AS parceiro, pbx.idlote,
               coalesce(a.quitada, 'N') AS quitada, trim(coalesce(a.obs, '')) AS obs,
               '5'::text, a.codapg || '_5', a.nrodup::text, pe.razao, pbx.idlote, a.codempresa
          FROM apagar a
          LEFT JOIN parceiros pe ON pe.codparceiro = a.codparceiro
          LEFT JOIN apagar_bx pbx ON pbx.codapg = a.codapg AND coalesce(pbx.indr, 'I') = 'I'
         WHERE a.codempresa = ANY(${emps})
           AND ${sim(pTitulos)} = 'S'
           AND coalesce(a.agrupado, 'N') = 'N'
           AND ${dataP}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${sitP}
           AND (${parceiro}::text IS NULL OR pe.razao LIKE ${parceiro}::text)
      )
      SELECT * FROM (SELECT * FROM receber UNION ALL SELECT * FROM cheque UNION ALL SELECT * FROM cartao
                     UNION ALL SELECT * FROM chq_proprio UNION ALL SELECT * FROM pagar) t
       -- a conta: o LOTE que passou por ela (o filtro do legado, em todos os ramos)
       WHERE (${f.codconta ?? null}::int IS NULL
              OR t.idlote IN (SELECT m.idlote FROM mov_contas_bancarias m WHERE m.codconta = ${f.codconta ?? null}::int AND m.idlote IS NOT NULL))
       -- o ORDER BY 9, 8 do sqqDtos: o LOTE e a RAZÃO (nulos por último, como o Oracle)
       ORDER BY t.idlote, t.razao, t.tipo, t.codigo
       LIMIT ${limite}
    `.execute(db)).rows;
    return linhas;
  }

  /**
   * O Imprimir do "Financeiro análise descritiva" (`AbreRelatorio`): `Relatorios\RelatorioFinanceiroGeral.fr3` (918) com o `cdsDoctos`
   * no `frxDBDatasetDocs` e os detalhes ANINHADOS de cada linha pelo lote (`MasterFields = IDLOTE`, um conjunto por linha do mestre —
   * `__MESTRE`): `frxDBDatasetContasCorrentes` (MOV_CONTAS_BANCARIAS do lote, com o VALOR do `sqqContaCorrente`: o crédito MENOS e o débito
   * MAIS o Σ das baixas a receber do lote cujo título está FORA do período), `DBDatasetCheques` (os cheques com IDLOTEBXRCB = o lote),
   * `DBDatasetChequeProp` (CHQ_PROPRIO do lote), `DBDatasetPermuta`/`DBDatasetRep` (PERMUTAS e CHEQUE_REP: 0 linhas na produção, a tabela
   * não veio — vazios); o `frxDBDatasetResumo` (o `cdsResumoconta` do laço do legado: a 1ª conta corrente do lote de cada linha, somada
   * por conta quando o lote ou a conta muda) e a empresa do login no `frxDBDataset2`. Variáveis CodEmpresas, DataInicial, Datafinal.
   * ⚠️ O laço também apagaria o cheque (TIPO 2) cujo IDLOTEBXRCB está nos cheques do 1º documento quando o lote dele não tem conta
   * corrente — e entraria em laço infinito quando tem (o `Continue` sem `Next`); com 11 cheques de 2023 na produção, não reproduzido.
   */
  async impressaoGeral(f: RelFinanceiroDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await this.lojas(db, f.empresas);
    const docs = await this.docs(db, f, emps, 20000);
    if (!docs.length) throw new BusinessRuleError('REL_FINANCEIRO_VAZIO', {}, 'A lista de registro para ser impresso está vazia.');
    const lotes = [...new Set(docs.map((d) => d.idlote).filter((x) => x != null).map(Number))];
    const ff = f.situacao === 'TODOS' ? 'VENCIMENTO' : f.filtroData;
    const dataTitulo = ff === 'EMISSAO' ? sql`ar.dtvenda` : ff === 'BAIXA' ? sql`bx.dtpgto` : sql`ar.dtvenc`;
    const fora = lotes.length ? (await sql<{ idlote: number; v: unknown }>`
      SELECT bx.idlote, coalesce(sum(bx.valorpg), 0) AS v FROM areceber_bx bx JOIN areceber ar ON ar.codrcb = bx.codrcb
       WHERE bx.idlote = ANY(${lotes}) AND coalesce(bx.indr, 'I') = 'I'
         AND NOT (${dataTitulo}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date)
       GROUP BY bx.idlote`.execute(db)).rows : [];
    const foraDe = new Map(fora.map((x) => [Number(x.idlote), num(x.v)]));
    const movs = lotes.length ? (await sql<Record<string, unknown>>`
      SELECT mov.codmovconta, mov.codconta, mov.valor AS valor_mov, mov.dtemissao, mov.dtvenc, mov.nrodocumento, mov.liberado, mov.tipomovimento,
             mov.historico, mov.codopconta, mov.idlote, mov.idpgto, fp.modalidade, op.descricao, c.nroconta, c.titular, c.codbco, c.idempresa
        FROM mov_contas_bancarias mov
        LEFT JOIN operacoes_conta op ON op.codopconta = mov.codopconta
        LEFT JOIN formas_pgto fp ON fp.idpgto = mov.idpgto
        LEFT JOIN contas_bancarias c ON c.codconta = mov.codconta
       WHERE mov.idlote = ANY(${lotes}) ORDER BY mov.codmovconta`.execute(db)).rows : [];
    for (const m of movs) {
      const ajuste = foraDe.get(Number(m.idlote)) ?? 0;
      m.valor = m.tipomovimento === 'C' ? num(m.valor_mov) - ajuste : num(m.valor_mov) + ajuste;
      delete m.valor_mov;
    }
    const cheques = lotes.length ? (await sql<Record<string, unknown>>`
      SELECT ch.codchq, ch.nrocheque, ch.valor, ch.titular, ch.dtemissao, ch.bompara, ch.operador, ch.codcx, ch.codbco, ch.codparceiro, ch.nropedido,
             ch.databaixa, ch.codopbx, ch.baixado, ch.observacao, ch.idempresa, ch.liberado, ch.qtdechq, ch.idlote, ch.idlotebxrcb, p.razao,
             b.banco, b.agencia, ch.idpgto, fp.modalidade
        FROM cheque ch
        LEFT JOIN parceiros p ON p.codparceiro = ch.codparceiro
        LEFT JOIN bancos b ON b.codbco = ch.codbco
        LEFT JOIN formas_pgto fp ON fp.idpgto = ch.idpgto
       WHERE ch.idlotebxrcb = ANY(${lotes}) ORDER BY ch.codchq`.execute(db)).rows : [];
    const proprios = lotes.length ? (await sql<Record<string, unknown>>`
      SELECT cp.*, p.razao FROM chq_proprio cp LEFT JOIN parceiros p ON p.codparceiro = cp.codparceiro
       WHERE cp.idlote = ANY(${lotes}) ORDER BY cp.codchqproprio`.execute(db)).rows : [];

    const porLote = <T extends Record<string, unknown>>(rows: T[], col: string) => {
      const m = new Map<number, T[]>();
      for (const r of rows) { const k = Number(r[col]); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
      return m;
    };
    const movL = porLote(movs, 'idlote'), chL = porLote(cheques, 'idlotebxrcb'), cpL = porLote(proprios, 'idlote');
    const contas: Record<string, unknown>[] = [], chqs: Record<string, unknown>[] = [], props: Record<string, unknown>[] = [];
    // o cdsResumoconta: o laço do legado (vIdLote/vCodConta começam em 0)
    const resumo: Array<{ codconta: number; conta: string; valor: number; idempresa: number }> = [];
    let vLote = 0, vConta = 0;
    docs.forEach((d, i) => {
      const lote = d.idlote == null ? 0 : Number(d.idlote);
      const cc = lote ? movL.get(lote) ?? [] : [];
      const primeira = cc[0];
      const codconta = primeira ? Number(primeira.codconta ?? 0) : 0;
      if (lote !== vLote || codconta !== vConta) {
        const r = resumo.find((x) => x.codconta === codconta);
        if (r) r.valor += primeira ? num(primeira.valor) : 0;
        else resumo.push({ codconta, conta: primeira ? String(primeira.titular ?? '') : '', valor: primeira ? num(primeira.valor) : 0, idempresa: primeira ? Number(primeira.idempresa ?? 0) : 0 });
      }
      vLote = lote; vConta = codconta;
      for (const m of cc) contas.push({ ...m, __MESTRE: i });
      for (const c of (lote ? chL.get(lote) ?? [] : [])) chqs.push({ ...c, __MESTRE: i });
      for (const c of (lote ? cpL.get(lote) ?? [] : [])) props.push({ ...c, __MESTRE: i });
    });
    const br = (x: string) => x.split('-').reverse().join('/');
    const numsDoc = new Set(['venc_n', 'valor', 'valorpg', 'acre_desc', 'juros', 'idlote', 'idlotebxrcb', 'idempresa']);
    const docsFr3 = docs.map((d) => registroFr3({
      venc: d.vencimento, valor: d.valor, emissao: d.emissao, pagamento: d.baixa, valorpg: d.valorpg, acre_desc: d.acre_desc, juros: d.juros,
      razao: d.razao, idlote: d.idlote, nrodoc: d.nrodoc, codigo: d.codigo_doc, tipo: d.tipo, idlotebxrcb: d.idlotebxrcb, idempresa: d.idempresa,
      obs: d.obs || null,
    }, numsDoc));
    const comMestre = (rows: Record<string, unknown>[], nums: string[]) => rows.map((r) => ({ ...registroFr3(r, new Set(nums)), __MESTRE: r.__MESTRE }));
    return {
      titulo: 'Relatório Financeiro',
      modelo: await modeloFr3(db, 'RelatorioFinanceiroGeral.fr3'),
      datasets: {
        frxDBDatasetDocs: docsFr3,
        frxDBDatasetContasCorrentes: comMestre(contas, ['codmovconta', 'codconta', 'valor', 'codopconta', 'idlote', 'idpgto', 'codbco', 'idempresa']),
        DBDatasetCheques: comMestre(chqs, ['codchq', 'valor', 'codcx', 'codbco', 'codparceiro', 'codopbx', 'idempresa', 'qtdechq', 'idlote', 'idlotebxrcb', 'idpgto']),
        DBDatasetChequeProp: comMestre(props, ['codchqproprio', 'valor', 'idlote', 'idempresa', 'codparceiro']),
        DBDatasetPermuta: [],
        DBDatasetRep: [],
        frxDBDatasetResumo: resumo.map((r) => registroFr3(r, new Set(['codconta', 'valor', 'idempresa']))),
        frxDBDataset2: [await empresaParaRelatorio(db, this.emp())],
      },
      variaveis: { CodEmpresas: textoVariavel(emps.join(',')), DataInicial: textoVariavel(br(f.dataIni)), Datafinal: textoVariavel(br(f.dataFim)) },
    };
  }

  /**
   * O 2º relatório da tela, "Contas a receber" (`MontaRelatorioContasAReceber` + `TRelatorio.GetSQLAReceber`): os títulos das lojas
   * marcadas pela emissão, pelo vencimento ou pela baixa, a situação, sem os agrupados; o primeiro CNPJ/CPF ativo do parceiro; o documento
   * (`COALESCE(NROCUPOM, DOCNF)`); o tipo — NF (a nota do título), NFC (a NFC-e do pedido: no Apollo, a venda do pedido com a NFC-e, já
   * que a tabela NFC fica com o PDV), ECF (uma venda do pedido sem NFC-e) ou vazio — e o status da nota (Processada, Cancelada,
   * Contingência, Revogada). ⚠️ Pela baixa, o legado filtra `R.DTPGTO`, a coluna abandonada do título (6.819 de 50.949 quitados): aqui, a
   * data da BAIXA (a regra do §2 do dossiê para esta tela).
   */
  async contasReceber(f: RelFinanceiroReceberDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await this.lojas(db, f.empresas);
    const periodo = f.filtroData === 'EMISSAO' ? sql`AND r.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`
      : f.filtroData === 'BAIXA'
        ? sql`AND EXISTS (SELECT 1 FROM areceber_bx bx WHERE bx.codrcb = r.codrcb AND coalesce(bx.indr, 'I') = 'I' AND bx.dtpgto::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date)`
        : sql`AND r.dtvenc::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`;
    const sit = f.situacao === 'ABERTO' ? sql`AND r.quitada = 'N'` : f.situacao === 'BAIXADO' ? sql`AND r.quitada = 'S'` : sql``;
    return (await sql<Record<string, unknown>>`
      SELECT r.codrcb AS codigo, r.codempresa AS idempresa, r.dtvenda::date AS emissao, r.dtvenc::date AS venc, r.valor, r.codparceiro, p.razao,
             (SELECT x.cnpj_cpf FROM parceiros_end x WHERE x.codparceiro = r.codparceiro AND x.ativado = 'S' ORDER BY x.codend LIMIT 1) AS cnpj_cpf,
             coalesce(r.nrocupom::text, r.docnf::text) AS nro_doc,
             CASE WHEN n.nronf IS NOT NULL THEN 'NF' WHEN cf.codnfc IS NOT NULL THEN 'NFC'
                  WHEN EXISTS (SELECT 1 FROM vendas x WHERE x.nropedido = r.nropedido AND coalesce(x.venda_nfc, 'N') = 'N') THEN 'ECF'
                  ELSE '  ' END AS tipo_doc,
             r.quitada,
             CASE coalesce(cf.statusnfe, n.statusnfe) WHEN 'P' THEN 'Processada' WHEN 'C' THEN 'Cancelada' WHEN 'G' THEN 'Contingência'
                  WHEN 'R' THEN 'Revogada' END AS status,
             r.nropedido
        FROM areceber r
        LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
        LEFT JOIN nf n ON n.codparceiro = p.codparceiro AND n.codnf = r.idnf
        LEFT JOIN LATERAL (SELECT v.codnfc, v.statusnfe FROM vendas v WHERE v.nropedido = r.nropedido AND v.idempresa = r.codempresa
                            AND v.codnfc IS NOT NULL LIMIT 1) cf ON true
       WHERE r.codempresa = ANY(${emps}) ${periodo} ${sit}
         AND coalesce(r.agrupado, 'N') = 'N'
       ORDER BY r.codrcb
       LIMIT 20001`.execute(db)).rows;
  }

  /** o Imprimir do "Contas a receber": `RelatorioFinanceiroContasReceber.fr3` (916) com o `QryConsulta` no `frxDBConsulta` */
  async impressaoContasReceber(f: RelFinanceiroReceberDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const linhas = await this.contasReceber(f);
    if (!linhas.length) throw new BusinessRuleError('REL_FINANCEIRO_VAZIO', {}, 'A lista de registro para ser impresso está vazia.');
    const emps = await this.lojas(db, f.empresas);
    const br = (x: string) => x.split('-').reverse().join('/');
    return {
      titulo: 'Contas a receber',
      modelo: await modeloFr3(db, 'RelatorioFinanceiroContasReceber.fr3'),
      datasets: { frxDBConsulta: linhas.map((l) => registroFr3(l, new Set(['codigo', 'idempresa', 'valor', 'codparceiro']))) },
      variaveis: { CodEmpresas: textoVariavel(emps.join(',')), DataInicial: textoVariavel(br(f.dataIni)), Datafinal: textoVariavel(br(f.dataFim)) },
    };
  }
}
