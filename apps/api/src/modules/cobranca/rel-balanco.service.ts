import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelBalancoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloEmbutido } from '../../shared/relatorios/modelo-fr3';
import { dataBr, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Linha {
  codplanocontas: number; codiexpandido: string; descricao: string; classe: string | null;
  saldoAnterior: number; debito: number; credito: number; saldoAtual: number;
}

/**
 * BALANÇO PATRIMONIAL (`FRMRELBALANCO`, `uRelBalanco.pas` 239). **8 acessos, 3 operadores.** Dossiê: `uRelBalanco.md`. Migration 265.
 *
 * Refeito pelo `btnImprimirClick` em 06/10/2026 (o corte 1 tinha nível, roll-up por prefixo com ponto e "só sintéticas" inventados):
 *  - o movimento: saldo anterior = Σ débitos − Σ créditos com `DATALAN <` o 1º dia do mês da data; débito e crédito `BETWEEN` o 1º dia e
 *    a data; das lojas do `GetMultiEmpresa`. Cada conta de código `< '3'` (ativo e passivo) soma **toda** linha do movimento cujo código
 *    começa com o dela (`Q.CODIEXPANDIDO LIKE PP.CODIEXPANDIDO || '%'` — sem o ponto: o "1.1" pegaria um "1.10", que o plano do cliente
 *    não tem);
 *  - "Imprime Contas Analíticas" desmarcado (o padrão do .dfm) acrescenta `AND PP.CLASSE = 'S'` — nenhuma conta do cliente tem CLASSE
 *    'S' (só A e T), então o relatório sai vazio com a mensagem, como no legado;
 *  - "sem movimento" desmarcado filtra as LINHAS do movimento antes de somar (`SALDO_ANTERIOR <> 0 OR DEBITO <> 0 OR CREDITO <> 0`): a
 *    conta aparece se alguma linha abaixo dela tem valor, mesmo que a soma dê zero;
 *  - a descrição em degrau; sem ORDER BY no legado — aqui em ordem de código (a do agrupamento).
 * A soma por prefixo é feita aqui (não no SQL): o `LIKE` entre as 11 mil contas e o movimento custaria segundos e dá o mesmo resultado
 * para códigos sem `%`/`_`.
 */
@Injectable()
export class RelBalancoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  /** o 1º dia do mês da data do balanço — a fronteira do "saldo anterior" no legado (`edtDtini.date - dia + 1`). */
  static inicioDoMes(data: string): string {
    return `${data.slice(0, 8)}01`;
  }

  private async montar(f: RelBalancoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await empresasDoOperador(db, f.empresas);
    const ini = RelBalancoService.inicioDoMes(f.data);
    // o Q do legado sem as linhas zeradas de cada conta (elas só garantem que toda conta do plano aparece); o UNION deduplica como lá
    const mov = (await sql<Record<string, unknown>>`
      SELECT p.codiexpandido, p.codplanocontas, -sum(d.valor) AS sa, 0 AS de, 0 AS cr FROM plano_contas p JOIN diario d ON d.contacredito = p.codplanocontas
       WHERE d.datalan < ${ini}::date AND d.codempresa = ANY(${emps}) GROUP BY p.codiexpandido, p.codplanocontas
      UNION
      SELECT p.codiexpandido, p.codplanocontas, sum(d.valor), 0, 0 FROM plano_contas p JOIN diario d ON d.contadebito = p.codplanocontas
       WHERE d.datalan < ${ini}::date AND d.codempresa = ANY(${emps}) GROUP BY p.codiexpandido, p.codplanocontas
      UNION
      SELECT p.codiexpandido, p.codplanocontas, 0, sum(d.valor), 0 FROM plano_contas p JOIN diario d ON d.contadebito = p.codplanocontas
       WHERE d.datalan BETWEEN ${ini}::date AND ${f.data}::date AND d.codempresa = ANY(${emps}) GROUP BY p.codiexpandido, p.codplanocontas
      UNION
      SELECT p.codiexpandido, p.codplanocontas, 0, 0, sum(d.valor) FROM plano_contas p JOIN diario d ON d.contacredito = p.codplanocontas
       WHERE d.datalan BETWEEN ${ini}::date AND ${f.data}::date AND d.codempresa = ANY(${emps}) GROUP BY p.codiexpandido, p.codplanocontas
    `.execute(db)).rows
      .filter((m) => m.codiexpandido != null && m.codiexpandido !== '')
      .map((m) => ({ cod: String(m.codiexpandido), sa: num(m.sa), de: num(m.de), cr: num(m.cr) }));

    const plano = (await sql<Record<string, unknown>>`
      SELECT codiexpandido, descricao, codplanocontas, classe FROM plano_contas
       WHERE coalesce(codiexpandido, '') <> '' AND codiexpandido COLLATE "C" < '3' ${f.analiticas ? sql`` : sql`AND classe = 'S'`}
       ORDER BY codiexpandido COLLATE "C"`.execute(db)).rows;

    const linhas: Linha[] = [];
    for (const p of plano) {
      const cod = String(p.codiexpandido);
      let qs = mov.filter((m) => m.cod.startsWith(cod));
      if (!f.semMovimento) qs = qs.filter((m) => m.sa !== 0 || m.de !== 0 || m.cr !== 0);
      // sem movimento marcado, a linha zerada própria da conta garante que ela aparece
      if (!f.semMovimento && !qs.length) continue;
      const sa = qs.reduce((s, m) => s + m.sa, 0), de = qs.reduce((s, m) => s + m.de, 0), cr = qs.reduce((s, m) => s + m.cr, 0);
      const descricao = f.degrau ? ' '.repeat(Math.min(20, cod.length)) + String(p.descricao ?? '') : String(p.descricao ?? '');
      linhas.push({
        codplanocontas: Number(p.codplanocontas), codiexpandido: cod, descricao, classe: (p.classe as string | null) ?? null,
        saldoAnterior: r2(sa), debito: r2(de), credito: r2(cr), saldoAtual: r2(sa + de - cr),
      });
    }
    if (!linhas.length) throw new BusinessRuleError('BALANCO_SEM_LANCAMENTOS', {}, 'Não há lançamentos no filtro informado informado. Verifique!');
    return { db, emps, ini, linhas };
  }

  async gerar(f: RelBalancoDto): Promise<Record<string, unknown>> {
    const { emps, ini, linhas } = await this.montar(f);
    const grupo = (c: string) => {
      const r = linhas.find((l) => l.codiexpandido === c);
      return r ? { codigo: c, descricao: r.descricao.trim(), saldoAnterior: r.saldoAnterior, debito: r.debito, credito: r.credito, saldoAtual: r.saldoAtual } : null;
    };
    return { data: f.data, competencia: { de: ini, ate: f.data }, empresas: emps, linhas, ativo: grupo('1'), passivo: grupo('2'), totais: { contas: linhas.length } };
  }

  /**
   * O Imprimir: o `frxReport1` desenhado no próprio `uRelBalanco.dfm` (o legado não carrega arquivo), com a consulta no `dbdConsulta` e
   * o `dbdEmpresa` — o `cdsEmpresa` do `udmRelBalanco` tem o SQL fixo `WHERE E.CODEMPRESA IN (1)` e a tela nunca o reabre: sai sempre a
   * loja 1, com o CRC e o NOME do contabilista. Variáveis DtInicial (dd/mm/aaaa), Empresa (a lista das lojas) e PaginaInicial (a página
   * do rodapé é `<Page> + <PaginaInicial> − 1`).
   */
  async impressao(f: RelBalancoDto) {
    const { db, emps, linhas } = await this.montar(f);
    const empresa = (await sql<Record<string, unknown>>`
      SELECT e.idempresa AS codempresa, e.cnpj, e.razao_social AS razaosocial, c.crc, c.nome, e.endereco, e.bairro, e.cidade, e.uf, e.fone1
        FROM empresas e LEFT JOIN contabilista c ON c.codempresa = e.idempresa
       WHERE e.idempresa IN (1)`.execute(db)).rows;
    const nums = new Set(['codplanocontas', 'saldo_anterior', 'debito', 'credito', 'saldo_atual', 'codempresa']);
    return {
      titulo: 'Balanço patrimonial',
      modelo: modeloEmbutido('frmRelBalanco.frxReport1'),
      datasets: {
        dbdConsulta: linhas.map((l) => registroFr3({
          codiexpandido: l.codiexpandido, descricao: l.descricao, codplanocontas: l.codplanocontas, ...(f.degrau ? { classe: l.classe } : {}),
          saldo_anterior: l.saldoAnterior, debito: l.debito, credito: l.credito, saldo_atual: l.saldoAtual,
        }, nums)),
        dbdEmpresa: empresa.map((e) => registroFr3(e, nums)),
      },
      variaveis: { DtInicial: textoVariavel(dataBr(f.data)), Empresa: textoVariavel(emps.join(',')), PaginaInicial: String(f.pagina) },
    };
  }
}
