import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { CongelaEstoqueDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * CONGELAR / DESCONGELAR ESTOQUE (`FRMCONGELAESTOQUE`). **4 acessos, 2 operadores.**
 * Dossiê: `uCongelaEstoque.md`. Migration 269.
 *
 * A foto do estoque para o balanço/inventário. Congelar copia `qtde` para `qtde_cong` e `qtde_bk` em
 * `estoque` e `estoque_dep` da empresa e marca `empresas.flagetqcong='S'` com operador e data;
 * descongelar levanta a marca (a foto continua gravada — é o que o legado faz: `DescongelarEstoque` não
 * apaga `QTDE_CONG`). Tudo em uma transação, como no fonte.
 *
 * O cliente tem a foto de um inventário passado em 100% das linhas, e ela já diverge do saldo atual em
 * 13.960 produtos da loja 1 — por isso a tela mostra a divergência antes de perguntar se congela de novo.
 * `USUCONGETQ`/`DATACONGETQ` estão nulos lá: a foto foi tirada sem deixar quem nem quando. Aqui o
 * histórico fica em `congelamento_estoque`.
 */
@Injectable()
export class CongelaEstoqueService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o estado atual: se está congelado, quem congelou, e o quanto a foto já divergiu do saldo. */
  async situacao(): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const e = (await sql<Record<string, unknown>>`
      SELECT coalesce(flagetqcong, 'N') AS flagetqcong, usucongetq, datacongetq, fantasia
        FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const est = (await sql<Record<string, unknown>>`
      SELECT count(*) AS linhas, count(qtde_cong) AS congeladas,
             count(*) FILTER (WHERE coalesce(qtde_cong, 0) <> coalesce(qtde, 0)) AS divergentes,
             coalesce(sum(coalesce(qtde, 0) - coalesce(qtde_cong, 0)), 0) AS diferenca_qtde
        FROM estoque WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const dep = (await sql<Record<string, unknown>>`
      SELECT count(*) AS linhas, count(qtde_cong) AS congeladas
        FROM estoque_dep WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const hist = (await sql<Record<string, unknown>>`
      SELECT idcongelamento, acao, codoperador, linhas_estoque, linhas_deposito, data
        FROM congelamento_estoque WHERE idempresa = ${emp} ORDER BY data DESC, idcongelamento DESC LIMIT 20`.execute(db)).rows;
    return {
      empresa: { idempresa: emp, fantasia: e.fantasia ?? null },
      congelado: e.flagetqcong === 'S',
      operador: e.usucongetq == null ? null : Number(e.usucongetq),
      data: e.datacongetq ?? null,
      estoque: { linhas: Number(est.linhas ?? 0), congeladas: Number(est.congeladas ?? 0), divergentes: Number(est.divergentes ?? 0), diferencaQtde: num(est.diferenca_qtde) },
      deposito: { linhas: Number(dep.linhas ?? 0), congeladas: Number(dep.congeladas ?? 0) },
      historico: hist.map((h) => ({ ...h, idcongelamento: Number(h.idcongelamento), codoperador: h.codoperador == null ? null : Number(h.codoperador) })),
    };
  }

  async executar(b: CongelaEstoqueDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      const atual = (await sql<Record<string, unknown>>`SELECT coalesce(flagetqcong, 'N') AS f FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
      const congelado = atual?.f === 'S';
      if (b.acao === 'CONGELAR' && congelado) throw new BusinessRuleError('ESTOQUE_JA_CONGELADO', { idempresa: emp });
      if (b.acao === 'DESCONGELAR' && !congelado) throw new BusinessRuleError('ESTOQUE_NAO_CONGELADO', { idempresa: emp });

      let linhasEstoque = 0;
      let linhasDeposito = 0;
      if (b.acao === 'CONGELAR') {
        // a cópia do legado: qtde_cong = qtde e qtde_bk = qtde, nas duas tabelas
        linhasEstoque = Number((await sql<{ n: unknown }>`
          WITH u AS (UPDATE estoque SET qtde_cong = qtde, qtde_bk = qtde WHERE idempresa = ${emp} RETURNING 1)
          SELECT count(*) AS n FROM u`.execute(trx)).rows[0]?.n ?? 0);
        linhasDeposito = Number((await sql<{ n: unknown }>`
          WITH u AS (UPDATE estoque_dep SET qtde_cong = qtde, qtde_bk = qtde WHERE idempresa = ${emp} RETURNING 1)
          SELECT count(*) AS n FROM u`.execute(trx)).rows[0]?.n ?? 0);
        await sql`UPDATE empresas SET flagetqcong = 'S', usucongetq = ${op}, datacongetq = now() WHERE idempresa = ${emp}`.execute(trx);
      } else {
        // descongelar só levanta a marca — a foto fica gravada, como no legado
        await sql`UPDATE empresas SET flagetqcong = 'N', usucongetq = ${op}, datacongetq = now() WHERE idempresa = ${emp}`.execute(trx);
      }

      await sql`INSERT INTO congelamento_estoque (idempresa, acao, codoperador, linhas_estoque, linhas_deposito)
                VALUES (${emp}, ${b.acao}, ${op}, ${linhasEstoque}, ${linhasDeposito})`.execute(trx);

      return { idempresa: emp, acao: b.acao, congelado: b.acao === 'CONGELAR', linhasEstoque, linhasDeposito, codoperador: op };
    });
  }
}
