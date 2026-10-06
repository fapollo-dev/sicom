import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { BalanceteDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { dataBr, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Linha {
  codplanocontas: number; codiexpandido: string; descricao: string; classe: string | null; codireduzido: string | null; codpai: number | null;
  nivel: number | null; sintetica: boolean; saldoAnterior: number; debito: number; credito: number; saldoAtual: number;
}

/**
 * BALANCETE DE VERIFICAÇÃO (`FRMRELBALANCETE`, `uRelBalancete.pas` 384). **14 acessos, 4 operadores.** Dossiê: `uRelBalancete.md`.
 *
 * Refeito pelo `btnImprimirClick` em 06/10/2026 (o corte 1 trocava o roll-up do legado por um por prefixo, dizendo que o laço perdia as
 * contas sem NIVEL — **falso**: as 658 contas com lançamento no cliente, inclusive as 520 sem NIVEL, têm o pai em NIVEL 4, e o filho é
 * achado por CODPAI sem exigir nível):
 *  - o SQL: cada conta do plano com o saldo anterior (Σ débitos − Σ créditos com `DATALAN <` início), os débitos e créditos do período
 *    (`BETWEEN` início e fim) das lojas do `GetMultiEmpresa`; o "nível" do combo é o **comprimento do código** (`LENGTH(CODIEXPANDIDO) <=
 *    n`), aplicado **antes** de totalizar; a faixa de contas (`BETWEEN` as duas, ou `LIKE` a primeira + `%`); a descrição em degrau (um
 *    espaço por posição do código, até 20);
 *  - `TotalizaContasSinteticas`: do `MAX(NIVEL)` do plano − 1 até 1, cada conta do nível recebe a soma dos filhos (`CODPAI`) que estão na
 *    consulta — o valor próprio dela é substituído; um filho cortado pelo comprimento ou pela faixa não soma (com o combo abaixo de 15 os
 *    totais das sintéticas saem zerados, como no legado);
 *  - depois o filtro: sem "analíticas", só CLASSE S/T; sem "contas sem movimento", fora as linhas com saldo anterior, débito e crédito
 *    zerados; em ordem de CODIEXPANDIDO;DESCRICAO. Consulta vazia: "Não há lançamentos no filtro informado informado. Verifique!".
 */
@Injectable()
export class BalanceteService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private async consulta(db: AnyDB, f: BalanceteDto, emps: number[]): Promise<Linha[]> {
    const ini = f.contaIni?.trim() ?? '';
    const fim = f.contaFim?.trim() ?? '';
    const faixa = fim !== '' ? sql`WHERE codiexpandido BETWEEN ${ini} AND ${fim}` : ini !== '' ? sql`WHERE codiexpandido LIKE ${`${ini}%`}` : sql``;
    const descricao = f.degrau ? sql`substr(repeat(' ', 20), 1, length(pp.codiexpandido)) || coalesce(pp.descricao, '')` : sql`pp.descricao`;
    const rows = (await sql<Record<string, unknown>>`
      SELECT * FROM (
        SELECT pp.codiexpandido, ${descricao} AS descricao, pp.codplanocontas, pp.classe, pp.codireduzido, pp.codpai::integer AS codpai, pp.nivel,
               sum(q.saldo_anterior) AS saldo_anterior, sum(q.debito) AS debito, sum(q.credito) AS credito
          FROM plano_contas pp
          JOIN (
            SELECT p.codplanocontas, 0::numeric AS saldo_anterior, 0::numeric AS debito, 0::numeric AS credito FROM plano_contas p
            UNION
            SELECT d.contacredito, sum(d.valor) * -1, 0, 0 FROM diario d
             WHERE d.datalan < ${f.dataIni}::date AND d.codempresa = ANY(${emps}) GROUP BY d.contacredito
            UNION
            SELECT d.contadebito, sum(d.valor), 0, 0 FROM diario d
             WHERE d.datalan < ${f.dataIni}::date AND d.codempresa = ANY(${emps}) GROUP BY d.contadebito
            UNION
            SELECT d.contadebito, 0, sum(d.valor), 0 FROM diario d
             WHERE d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date AND d.codempresa = ANY(${emps}) GROUP BY d.contadebito
            UNION
            SELECT d.contacredito, 0, 0, sum(d.valor) FROM diario d
             WHERE d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date AND d.codempresa = ANY(${emps}) GROUP BY d.contacredito
          ) q ON q.codplanocontas = pp.codplanocontas
         WHERE length(pp.codiexpandido) <= ${f.nivelMax}
         GROUP BY pp.codiexpandido, pp.descricao, pp.codplanocontas, pp.classe, pp.codireduzido, pp.codpai::integer, pp.nivel
      ) x ${faixa}`.execute(db)).rows;
    return rows.map((r) => {
      const sa = num(r.saldo_anterior), de = num(r.debito), cr = num(r.credito);
      const classe = (r.classe as string | null) ?? null;
      return {
        codplanocontas: Number(r.codplanocontas), codiexpandido: String(r.codiexpandido), descricao: String(r.descricao ?? ''), classe,
        codireduzido: r.codireduzido == null ? null : String(r.codireduzido), codpai: r.codpai == null ? null : Number(r.codpai),
        nivel: r.nivel == null ? null : Number(r.nivel), sintetica: classe === 'S' || classe === 'T',
        saldoAnterior: sa, debito: de, credito: cr, saldoAtual: sa + de - cr,
      };
    });
  }

  /** `TotalizaContasSinteticas`: os pais por nível, de baixo para cima, com a soma dos filhos (CODPAI) que estão na consulta */
  private static totalizar(linhas: Linha[], ultimoNivel: number): void {
    if (!(ultimoNivel > 0)) return;
    const filhos = new Map<number, Linha[]>();
    for (const l of linhas) if (l.codpai != null) filhos.set(l.codpai, [...(filhos.get(l.codpai) ?? []), l]);
    for (let n = ultimoNivel - 1; n >= 1; n--) {
      for (const pai of linhas.filter((l) => l.nivel === n)) {
        let sa = 0, de = 0, cr = 0;
        for (const f of filhos.get(pai.codplanocontas) ?? []) { sa += f.saldoAnterior; de += f.debito; cr += f.credito; }
        pai.saldoAnterior = sa; pai.debito = de; pai.credito = cr; pai.saldoAtual = sa + de - cr;
      }
    }
  }

  private async montar(f: BalanceteDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await empresasDoOperador(db, f.empresas);
    const linhas = await this.consulta(db, f, emps);
    if (!linhas.length) throw new BusinessRuleError('BALANCETE_SEM_LANCAMENTOS', {}, 'Não há lançamentos no filtro informado informado. Verifique!');
    const ultimo = num((await sql<{ n: unknown }>`SELECT max(nivel) AS n FROM plano_contas`.execute(db)).rows[0]?.n);
    BalanceteService.totalizar(linhas, ultimo);
    // o IndexFieldNames 'CODIEXPANDIDO;DESCRICAO' (ordem binária do código: '.' antes dos dígitos)
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const saida = linhas
      .filter((l) => (f.analiticas || l.sintetica) && (f.semMovimento || l.saldoAnterior !== 0 || l.debito !== 0 || l.credito !== 0))
      .sort((a, b) => cmp(a.codiexpandido, b.codiexpandido) || cmp(a.descricao, b.descricao))
      .map((l) => ({ ...l, saldoAnterior: r2(l.saldoAnterior), debito: r2(l.debito), credito: r2(l.credito), saldoAtual: r2(l.saldoAtual) }));
    return { db, emps, saida };
  }

  async gerar(f: BalanceteDto): Promise<Record<string, unknown>> {
    const { emps, saida } = await this.montar(f);
    const raizes = saida.filter((l) => l.nivel === 1);
    return {
      periodo: { ini: f.dataIni, fim: f.dataFim }, empresas: emps,
      linhas: saida,
      totais: {
        contas: saida.length,
        debito: r2(raizes.reduce((s, l) => s + l.debito, 0)), credito: r2(raizes.reduce((s, l) => s + l.credito, 0)),
        saldoAnterior: r2(raizes.reduce((s, l) => s + l.saldoAnterior, 0)), saldoAtual: r2(raizes.reduce((s, l) => s + l.saldoAtual, 0)),
      },
    };
  }

  /**
   * O Imprimir: `Relatorios\BalanceteVerificacao.fr3` com a consulta no `dbdConsulta`, as lojas no `dbdEmpresa` (`sqqEmpresa`: código,
   * CNPJ, razão, o CRC e o NOME do CONTABILISTA, endereço, bairro, cidade, UF, fone, em ordem de código) e as variáveis DtInicial,
   * DtFinal ('dd/mm/aaaa'), Empresa (a lista das lojas), PaginaInicial e Negrito (S/N). O script do layout formata os saldos com
   * parênteses no negativo e põe as contas T em negrito.
   */
  async impressao(f: BalanceteDto) {
    const { db, emps, saida } = await this.montar(f);
    const empresas = (await sql<Record<string, unknown>>`
      SELECT e.idempresa AS codempresa, e.cnpj, e.razao_social AS razaosocial, c.crc, c.nome, e.endereco, e.bairro, e.cidade, e.uf, e.fone1
        FROM empresas e LEFT JOIN contabilista c ON c.codempresa = e.idempresa
       WHERE e.idempresa = ANY(${emps}) ORDER BY e.idempresa`.execute(db)).rows;
    const nums = new Set(['codplanocontas', 'codpai', 'nivel', 'saldo_anterior', 'debito', 'credito', 'saldo_atual', 'codempresa']);
    return {
      titulo: 'Balancete de verificação',
      modelo: await modeloFr3(db, 'BalanceteVerificacao.fr3'),
      datasets: {
        dbdConsulta: saida.map((l) => registroFr3({
          codiexpandido: l.codiexpandido, descricao: l.descricao, codplanocontas: l.codplanocontas, classe: l.classe, codireduzido: l.codireduzido,
          codpai: l.codpai, nivel: l.nivel, saldo_anterior: l.saldoAnterior, debito: l.debito, credito: l.credito, saldo_atual: l.saldoAtual,
        }, nums)),
        dbdEmpresa: empresas.map((e) => registroFr3(e, nums)),
      },
      variaveis: {
        DtInicial: textoVariavel(dataBr(f.dataIni)), DtFinal: textoVariavel(dataBr(f.dataFim)), Empresa: textoVariavel(emps.join(',')),
        PaginaInicial: String(f.pagina), Negrito: textoVariavel(f.negrito ? 'S' : 'N'),
      },
    };
  }
}
