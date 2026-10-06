import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelDiarioContabilDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { dataBr, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * LIVRO DIÁRIO (`FRMRELDIARIOCONTABIL`, `uRelDiarioContabil.pas` 160). **4 acessos, 4 operadores.** Dossiê: `uRelDiarioContabil.md`.
 * Migration 270.
 *
 * Refeito pelo `btnImprimirClick` em 06/10/2026 (o corte 1 trocava o UNION por UNION ALL, recortava na loja do login, tinha LIMIT e
 * filtros de conta/origem que o legado não tem): cada lançamento do diário vira duas linhas — a conta debitada (DEBITO = valor) e a
 * creditada (CREDITO = valor) — com o dia, o código expandido, o código e a descrição da conta, o histórico `TRIM(DESCHIST) || ' ' ||
 * COMPLEMENTO`, a origem, o id da origem e o documento; das lojas do `GetMultiEmpresa`, `TRUNC(DATALAN) BETWEEN`; `ORDER BY 1, 2`.
 * ⚠️ **`UNION`, não `UNION ALL`**: duas linhas iguais em todas essas colunas colapsam numa só (o SELECT não tem a loja nem o código do
 * lançamento) — em 2026, no débito, 2 linhas e R$ 248,06. É o livro que o cliente imprime; fica.
 */
@Injectable()
export class RelDiarioContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private async montar(f: RelDiarioContabilDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await empresasDoOperador(db, f.empresas);
    const lado = (conta: 'contadebito' | 'contacredito', deb: boolean) => sql`
      SELECT d.datalan AS dia, p.codiexpandido AS conta, p.codplanocontas AS codigoconta, p.descricao AS descricao,
             coalesce(trim(d.deschist), '') || ' ' || coalesce(d.complemento, '') AS historico,
             d.codorigem AS origem, d.idorigem AS idorigem, d.documento,
             ${deb ? sql`d.valor` : sql`0::numeric`} AS debito, ${deb ? sql`0::numeric` : sql`d.valor`} AS credito
        FROM diario d
        LEFT JOIN plano_contas p ON d.${sql.ref(conta)} = p.codplanocontas
       WHERE d.${sql.ref(conta)} IS NOT NULL AND d.codempresa = ANY(${emps})
         AND d.datalan::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`;
    // ORDER BY 1, 2 do legado; o desempate (histórico, origem) só fixa a ordem que o Oracle deixa ao acaso
    const linhas = (await sql<Record<string, unknown>>`
      SELECT u.*, o.descorigem AS nome_origem
        FROM (${lado('contadebito', true)} UNION ${lado('contacredito', false)}) u
        LEFT JOIN origem_contabil o ON o.codorigem = u.origem
       ORDER BY u.dia, u.conta COLLATE "C", u.historico, u.idorigem, u.debito DESC`.execute(db)).rows
      .map((l) => ({ ...l, debito: num(l.debito), credito: num(l.credito) }) as Record<string, unknown> & { debito: number; credito: number });
    if (!linhas.length) throw new BusinessRuleError('DIARIO_SEM_LANCAMENTOS', {}, 'Não há lançamentos no filtro informado informado. Verifique!');
    return { db, emps, linhas };
  }

  async gerar(f: RelDiarioContabilDto): Promise<Record<string, unknown>> {
    const emp = currentTenant().empresaId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    const { db, emps, linhas } = await this.montar(f);
    const contabilista = (await sql<Record<string, unknown>>`
      SELECT nome, cpf, crc, cnpj FROM contabilista WHERE codempresa = ${emp}`.execute(db)).rows[0] ?? null;
    const debito = r2(linhas.reduce((s, l) => s + l.debito, 0));
    const credito = r2(linhas.reduce((s, l) => s + l.credito, 0));
    return {
      periodo: { de: f.dataIni, ate: f.dataFim }, empresas: emps, contabilista, linhas,
      totais: { linhas: linhas.length, debito, credito, diferenca: r2(debito - credito) },
    };
  }

  /**
   * O Imprimir: `Relatorios\LivroDiarioContabil.fr3` com a consulta no `dbdConsulta` (agrupada por DIA no layout, com os totais do dia
   * e os acumulados) e o `dbdEmpresa` — o `cdsEmpresa` do `udmRelDiarioContabil` tem o SQL fixo `WHERE E.CODEMPRESA IN (1)` e a tela não o
   * reabre: sai sempre a loja 1, com o contabilista. Variáveis DtInicial, DtFinal, Empresa (a lista das lojas) e PaginaInicial.
   */
  async impressao(f: RelDiarioContabilDto) {
    const { db, emps, linhas } = await this.montar(f);
    const empresa = (await sql<Record<string, unknown>>`
      SELECT e.idempresa AS codempresa, e.cnpj, e.razao_social AS razaosocial, c.crc, c.nome, e.endereco, e.bairro, e.cidade, e.uf, e.fone1
        FROM empresas e LEFT JOIN contabilista c ON c.codempresa = e.idempresa
       WHERE e.idempresa IN (1)`.execute(db)).rows;
    const nums = new Set(['codigoconta', 'origem', 'idorigem', 'debito', 'credito', 'codempresa']);
    return {
      titulo: 'Livro diário',
      modelo: await modeloFr3(db, 'LivroDiarioContabil.fr3'),
      datasets: {
        dbdConsulta: linhas.map(({ nome_origem: _n, ...l }) => registroFr3(l, nums)),
        dbdEmpresa: empresa.map((e) => registroFr3(e, nums)),
      },
      variaveis: {
        DtInicial: textoVariavel(dataBr(f.dataIni)), DtFinal: textoVariavel(dataBr(f.dataFim)), Empresa: textoVariavel(emps.join(',')),
        PaginaInicial: String(f.pagina),
      },
    };
  }
}
