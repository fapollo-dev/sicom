import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * APURAÇÃO PIS/COFINS — a TELA (`FRMAPURACAOPISCOFINS`, `UapuracaoPISCOFINS.pas`).
 * **39 acessos, 2 operadores.** Migration 240.
 *
 * O motor já existia: `sped-apuracao-pc.service` apura o período e popula `apuracao_pc`/`_det` para o bloco M
 * do EFD-Contribuições. Faltava o que a tela do legado faz em volta dele — **listar as apurações realizadas,
 * abrir uma, ver crédito e débito lado a lado com o saldo, e excluir para refazer**.
 *
 * ── O saldo, que é o que o contador procura ───────────────────────────────────────────────────────────
 * O detalhe guarda linhas `C` (crédito de entrada) e `D` (débito de saída). O **saldo é débito − crédito**,
 * separado por tributo — é o valor a recolher do M200/M600. Negativo significa crédito a transportar, e a
 * tela mostra assim em vez de um número com sinal, que é como o contador lê.
 *
 * ⚠️ **excluir é o "reabrir" do legado**: a apuração é idempotente por período (`UNIQUE (idempresa, dataini,
 * datafim)` e delete-then-insert no motor), então refazer é apurar de novo. A exclusão existe para quando o
 * período muda de recorte, não para "corrigir" — e é por isso que ela leva o detalhe junto.
 */
@Injectable()
export class ApuracaoPcConsultaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** as "Apurações Realizadas" da tela, com o total de cada uma. */
  async listar(): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT a.codapuracao_pc, a.dataini, a.datafim, a.codoperador, a.dtcadastro,
             coalesce(o.nome, '') AS operador,
             (SELECT count(*) FROM apuracao_pc_det d WHERE d.codapuracao_pc = a.codapuracao_pc)::int AS linhas,
             coalesce((SELECT sum(d.valorpis + d.valorcofins) FROM apuracao_pc_det d
                        WHERE d.codapuracao_pc = a.codapuracao_pc AND d.tipo = 'C'), 0) AS credito,
             coalesce((SELECT sum(d.valorpis + d.valorcofins) FROM apuracao_pc_det d
                        WHERE d.codapuracao_pc = a.codapuracao_pc AND d.tipo = 'D'), 0) AS debito
        FROM apuracao_pc a
        LEFT JOIN operadores o ON o.codoperador = a.codoperador
       WHERE a.idempresa = ${emp}
       ORDER BY a.dataini DESC, a.codapuracao_pc DESC
    `.execute(db)).rows;
  }

  /** uma apuração aberta: o detalhe por tipo e o saldo por tributo. */
  async obter(cod: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cab = (await sql<Record<string, unknown>>`
      SELECT * FROM apuracao_pc WHERE codapuracao_pc = ${cod} AND idempresa = ${emp}
    `.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('APURACAO_PC_NAO_ENCONTRADA', { cod });

    const itens = (await sql<Record<string, unknown>>`
      SELECT d.codapuracao_pc_det, d.tipo, d.id_tipocredito, d.id_basecredito, d.idpiscofins, d.cst_pis,
             d.basecalculo, d.aliqpis, d.valorpis, d.aliqcofins, d.valorcofins,
             coalesce(p.descricao, '') AS descricao
        FROM apuracao_pc_det d
        LEFT JOIN piscofins p ON p.idpiscofins = d.idpiscofins
       WHERE d.codapuracao_pc = ${cod}
       ORDER BY d.tipo, d.cst_pis, d.aliqpis
    `.execute(db)).rows;

    const soma = (t: string, campo: 'valorpis' | 'valorcofins' | 'basecalculo') =>
      r2(itens.filter((i) => i.tipo === t).reduce((s, i) => s + num(i[campo]), 0));

    const credPis = soma('C', 'valorpis');
    const credCof = soma('C', 'valorcofins');
    const debPis = soma('D', 'valorpis');
    const debCof = soma('D', 'valorcofins');

    return {
      ...cab,
      itens,
      totais: {
        baseCredito: soma('C', 'basecalculo'), baseDebito: soma('D', 'basecalculo'),
        creditoPis: credPis, creditoCofins: credCof, debitoPis: debPis, debitoCofins: debCof,
        // o M200/M600: a recolher é o que sobra do débito depois do crédito; o resto transporta
        aRecolherPis: r2(Math.max(debPis - credPis, 0)),
        aRecolherCofins: r2(Math.max(debCof - credCof, 0)),
        creditoTransportarPis: r2(Math.max(credPis - debPis, 0)),
        creditoTransportarCofins: r2(Math.max(credCof - debCof, 0)),
      },
    };
  }

  async excluir(cod: number): Promise<{ codapuracao_pc: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const r = await sql`
      DELETE FROM apuracao_pc WHERE codapuracao_pc = ${cod} AND idempresa = ${emp}
    `.execute(db);
    if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('APURACAO_PC_NAO_ENCONTRADA', { cod });
    return { codapuracao_pc: cod };
  }
}
