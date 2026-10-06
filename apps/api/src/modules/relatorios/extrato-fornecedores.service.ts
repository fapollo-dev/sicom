import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ExtratoFornecedoresDto } from '@apollo/shared';
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
 * EXTRATO DE FORNECEDORES (`FRMEXTRATOFORNECEDORES`, `UextratoFornecedores.pas`).
 * **38 acessos, 4 operadores.** Dossiê: `uExtratoFornecedores.md`. Migration 241.
 *
 * O que se deve a cada fornecedor. O modelo mais valioso é o **saldo numa data passada** — quanto se devia no
 * fechamento do mês —, que é uma pergunta que nenhum outro relatório responde.
 *
 * ── Os cinco modelos (`rgModelo`) ─────────────────────────────────────────────────────────────────────
 * · `PERIODO` — a data escolhida entre as duas pontas
 * · `ATE` / `DESDE` — até ou a partir da data, **incluindo os nulos** (`OR data IS NULL`): um título sem
 *   vencimento não some do extrato, que é o que o legado faz de propósito
 * · `SALDO` — comprado até a data **e ainda não pago naquela data**: `dtcompra <= d` e (`dtpgto > d` ou
 *   (`dtpgto` nulo e não quitado)). É o saldo retroativo, e repare que ele olha a data do pagamento, não o
 *   flag: um título pago DEPOIS da data ainda contava como dívida naquele dia
 * · `SALDO2` — tudo comprado até a data, pago ou não
 * · `CHEQUES` — o saldo dos cheques próprios na data (`sqqChqProp`: emitidos até a data e não baixados até ela; CHQ_PROPRIO tem 0
 *   linhas no cliente, a opção existe)
 * · `SALDO2` — o `sqqExtrato2`: tudo comprado até a data (`A.DTCOMPRA <= d`), com a data contábil da nota no lugar da compra
 *
 * ── ⚠️ Uma coluna com duas semânticas ─────────────────────────────────────────────────────────────────
 * `CASE A.quitada WHEN 'S' THEN P.DTPGTO ELSE A.DTVENC END DTVENC` — a coluna "vencimento" mostra a data do
 * **pagamento** quando o título está quitado. É intencional (o extrato quer a data que importa em cada
 * estado), e foi mantida; a tela nomeia a coluna de acordo.
 *
 * ── O campo Parceiro: os cinco operadores do `SetaFiltro` ──────────────────────────────────────────────
 * Ao sair do campo, o legado pergunta a comparação (`frmFiltro`) e reescreve o texto: `='X'`, `%X` (termina), `X%` (começa), `%X%`,
 * `<>'X'`; com `%` vai `PA.RAZAO LIKE`, sem `%` o texto é concatenado (`PA.RAZAO ='X'`). Aqui o modo vem em `parceiroModo`, com as
 * maiúsculas como digitadas e sem concatenar texto no SQL.
 *
 * ── Fidelidade (06/10/2026) ───────────────────────────────────────────────────────────────────────────
 * As lojas do GetMultiEmpresa (`A.IDEMPRESA IN`); a situação exata (`QUITADA = 'N'`); e as datas como o legado compara: SEM `TRUNC`
 * no vencimento e no pagamento (`DTVENC BETWEEN d1 AND d2`, `<= d`, `>= d`, `dtpgto > d`): o título com HORA no último dia fica fora
 * do período e do "até", e o pago no próprio dia (com hora) ainda conta no saldo — 5.285 vencimentos e 3.453 baixas com hora na produção.
 */
@Injectable()
export class ExtratoFornecedoresService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async lojas(db: AnyDB, empresas?: string): Promise<number[]> {
    const pedidas = empresas ? empresas.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : [];
    return pedidas.length ? empresasDoOperador(db, pedidas) : [this.emp()];
  }

  /** o filtro do parceiro, pelo modo do SetaFiltro */
  private parceiro(f: ExtratoFornecedoresDto) {
    if (!f.parceiro) return sql``;
    const x = f.parceiro;
    switch (f.parceiroModo) {
      case 'IGUAL': return sql`AND pa.razao = ${x}`;
      case 'DIFERENTE': return sql`AND pa.razao <> ${x}`;
      case 'INICIA': return sql`AND pa.razao LIKE ${`${x}%`}`;
      case 'TERMINA': return sql`AND pa.razao LIKE ${`%${x}`}`;
      default: return sql`AND pa.razao LIKE ${`%${x}%`}`;
    }
  }

  async gerar(f: ExtratoFornecedoresDto): Promise<{
    modelo: string;
    linhas: Array<Record<string, unknown>>;
    totais: { titulos: number; valor: number; pago: number; juros: number; acreDesc: number; aberto: number };
  }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await this.lojas(db, f.empresas);
    const d1 = f.dataIni;
    const d2 = f.dataFim ?? f.dataIni;
    const sit = f.situacao === 'ABERTO' ? sql`AND a.quitada = 'N'` : f.situacao === 'BAIXADO' ? sql`AND a.quitada = 'S'` : sql``;

    if (f.modelo === 'CHEQUES') {
      // o sqqChqProp: emitidos até a data e não baixados até ela (sem loja, sem situação, sem parceiro — o fonte não filtra)
      const linhas = (await sql<Record<string, unknown>>`
        SELECT c.dtemissao, c.dtvenc, c.nrocheque, p.razao, c.valor, b.banco
          FROM chq_proprio c
          LEFT JOIN parceiros p ON p.codparceiro = c.codparceiro
          LEFT JOIN contas_bancarias o ON o.codconta = c.codconta
          LEFT JOIN bancos b ON b.codbco = o.codbco
         WHERE c.dtemissao::date <= ${d1}::date AND (c.dtbaixa > ${d1}::date OR c.dtbaixa IS NULL)
         ORDER BY p.razao, c.dtemissao
         LIMIT ${f.limite}`.execute(db)).rows;
      const valor = r2(linhas.reduce((acc, l) => acc + num(l.valor), 0));
      return { modelo: f.modelo, linhas, totais: { titulos: linhas.length, valor, pago: 0, juros: 0, acreDesc: 0, aberto: valor } };
    }

    // a data-base do recorte, conforme o rgDatas — sem TRUNC, como o legado (o vencimento e o pagamento podem ter hora)
    const base = f.base === 'CONTABIL' ? sql`nf.dtcontabil` : f.base === 'PAGAMENTO' ? sql`p.dtpgto` : sql`a.dtvenc`;
    const recorte = f.modelo === 'PERIODO' ? sql`${base} BETWEEN ${d1}::date AND ${d2}::date`
      // ⚠️ o nulo ENTRA nos modelos de vigência: é o que o legado faz (`OR data IS NULL`)
      : f.modelo === 'ATE' ? sql`(${base} <= ${d1}::date OR ${base} IS NULL)`
      : f.modelo === 'DESDE' ? sql`(${base} >= ${d1}::date OR ${base} IS NULL)`
      // o saldo retroativo: comprado até a data (TRUNC) e ainda não pago NAQUELE dia (sem TRUNC: o pago no dia com hora ainda conta)
      : f.modelo === 'SALDO' ? sql`(a.dtcompra::date <= ${d1}::date AND (p.dtpgto > ${d1}::date OR (p.dtpgto IS NULL AND a.quitada <> 'S')))`
      // o modelo 5 (sqqExtrato2): A.DTCOMPRA <= d, sem TRUNC
      : sql`a.dtcompra <= ${d1}::date`;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT a.codapg, a.duplicata, nf.nronf, a.dtcompra::date AS dtcompra, nf.dtcontabil,
             -- ⚠️ a coluna muda de significado: PAGAMENTO quando quitado, VENCIMENTO quando não
             CASE WHEN a.quitada = 'S' THEN p.dtpgto ELSE a.dtvenc END AS data_referencia,
             a.dtvenc, p.dtpgto,
             -- o sqqExtrato2 (modelo 5) mostra a data contábil da nota no lugar da compra
             coalesce(nf.dtcontabil, a.dtcompra::date) AS dtcompra2,
             pa.razao,
             round(coalesce(a.valor, 0)::numeric, 2) AS valor,
             round(coalesce(p.juros, 0)::numeric, 2) AS juros,
             round(coalesce(p.acre_desc, 0)::numeric, 2) AS acre_desc,
             round(coalesce(p.valorpg, 0)::numeric, 2) AS valor_pg,
             a.quitada, p.idlote
        FROM apagar a
        LEFT JOIN apagar_bx p ON p.codapg = a.codapg AND coalesce(p.indr, 'I') = 'I'
        LEFT JOIN parceiros pa ON pa.codparceiro = a.codparceiro
        LEFT JOIN nf ON nf.codnf = a.idnf
       WHERE ${recorte}
         ${sit} ${this.parceiro(f)}
         AND a.codempresa = ANY(${emps})
         -- o agrupado sai: já está representado pelo título do grupo
         AND coalesce(a.agrupado, 'N') = 'N'
       -- ORDER BY 5,4: a razão e a coluna "vencimento" (no modelo 5, a compra)
       ORDER BY pa.razao, ${f.modelo === 'SALDO2' ? sql`9` : sql`6`}, a.codapg
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { titulos: 0, valor: 0, pago: 0, juros: 0, acreDesc: 0, aberto: 0 };
    // o LEFT JOIN com a baixa multiplica: o VALOR do título entra uma vez, o pago soma todas
    const vistos = new Set<number>();
    for (const l of linhas) {
      const cod = Number(l.codapg);
      if (!vistos.has(cod)) {
        vistos.add(cod);
        t.titulos += 1;
        t.valor += num(l.valor);
        if (String(l.quitada) !== 'S') t.aberto += num(l.valor);
      }
      t.pago += num(l.valor_pg);
      t.juros += num(l.juros);
      t.acreDesc += num(l.acre_desc);
    }
    return {
      modelo: f.modelo,
      linhas,
      totais: {
        titulos: t.titulos, valor: r2(t.valor), pago: r2(t.pago),
        juros: r2(t.juros), acreDesc: r2(t.acreDesc), aberto: r2(t.aberto),
      },
    };
  }

  /**
   * O Imprimir (`btnImprimirClick`): modelos 0-3 → `ExtratoFornecedores3.fr3` com o `cdsExtrato` no `frxDBDataset1`; o de cheques próprios
   * → `ExtratoFornecedores1.fr3` (`frxDBDataset3`); o modelo 5 → `ExtratoFornecedores2.fr3` (`frxDBExtrato2`, com a data contábil como
   * DTCOMPRA e o DTPGTO); a empresa do login no `frxDBDataset2` e a variável DATA (a 1ª data). O legado imprime mesmo vazio.
   */
  async impressao(f: ExtratoFornecedoresDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.gerar({ ...f, limite: 20000 });
    const empresa = [await empresaParaRelatorio(db, this.emp())];
    const variaveis = { DATA: textoVariavel(f.dataIni.split('-').reverse().join('/')) };
    if (f.modelo === 'CHEQUES') {
      return {
        titulo: 'Saldo dos cheques próprios', modelo: await modeloFr3(db, 'ExtratoFornecedores1.fr3'), variaveis,
        datasets: { frxDBDataset3: r.linhas.map((l) => registroFr3(l, new Set(['valor']))), frxDBDataset2: empresa },
      };
    }
    if (f.modelo === 'SALDO2') {
      return {
        titulo: 'Saldo do contas a pagar', modelo: await modeloFr3(db, 'ExtratoFornecedores2.fr3'), variaveis,
        datasets: {
          frxDBExtrato2: r.linhas.map((l) => registroFr3({ duplicata: l.duplicata, nronf: l.nronf, dtpgto: l.dtpgto, dtcompra: l.dtcompra2, razao: l.razao,
            valor: l.valor, valor_pg: l.valor_pg, quitada: l.quitada }, new Set(['valor', 'valor_pg']))),
          frxDBDataset2: empresa,
        },
      };
    }
    return {
      titulo: 'Extrato de fornecedores', modelo: await modeloFr3(db, 'ExtratoFornecedores3.fr3'), variaveis,
      datasets: {
        frxDBDataset1: r.linhas.map((l) => registroFr3({ duplicata: l.duplicata, nronf: l.nronf, dtcompra: l.dtcompra, dtvenc: l.data_referencia, razao: l.razao,
          valor: l.valor, juros: l.juros, acre_desc: l.acre_desc, valor_pg: l.valor_pg, quitada: l.quitada }, new Set(['valor', 'juros', 'acre_desc', 'valor_pg']))),
        frxDBDataset2: empresa,
      },
    };
  }
}
