import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { movimentoDaTroca, type ItemTroca } from './troca-estoque';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * TROCA — fechar e reabrir os itens. O ESTOQUE já saiu quando o item entrou na troca (o gatilho `ESTOQUE_TROCA`, troca-estoque.ts): fechar
 * (FECHADO N→S) só tira a quantidade do QTDETROCA — devolve o saldo apenas com ORIGEM_FECHAMENTO TROCA/SCRAP, que a produção nunca usa —,
 * e reabrir (S→N) devolve ao QTDETROCA. Antes o Apollo dava a baixa no fechar: as 130 linhas de troca abertas que vêm do legado (a
 * mercadoria já saiu lá) seriam baixadas de novo. Tenant fail-closed; operador obrigatório.
 */
@Injectable()
export class TrocaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }

  /** fecha a troca: os itens abertos passam a FECHADO 'S' (sai do QTDETROCA) */
  async fechar(codtroca: number): Promise<{ codtroca: number; itens: number }> {
    return this.trocarEstado(codtroca, 'S');
  }

  /** reabre a troca: os itens fechados voltam a FECHADO 'N' (volta ao QTDETROCA) */
  async reabrir(codtroca: number): Promise<{ codtroca: number; itens: number }> {
    return this.trocarEstado(codtroca, 'N');
  }

  private async trocarEstado(codtroca: number, para: 'S' | 'N'): Promise<{ codtroca: number; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = (await trx.selectFrom('troca').select(['codtroca', 'dtcadastro']).where('codtroca', '=', codtroca).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as
        { codtroca: number; dtcadastro: unknown } | undefined;
      if (!t) throw new BusinessRuleError('TROCA_NAO_ENCONTRADA', { codtroca });
      let q = trx.selectFrom('itens_troca').select(['coditenstroca', 'idproduto', 'qtde', 'vrcusto', 'estoqueretirada', 'fechado', 'origem_fechamento', 'codscrap']).where('codtroca', '=', codtroca);
      q = para === 'S' ? q.where((eb: any) => eb.or([eb('fechado', '<>', 'S'), eb('fechado', 'is', null)])) : q.where('fechado', '=', 'S');
      const itens = (await q.orderBy('coditenstroca').execute()) as Array<ItemTroca & { coditenstroca: number }>;
      if (!itens.length) throw new BusinessRuleError(para === 'S' ? 'TROCA_SEM_ITENS_ABERTOS' : 'TROCA_SEM_ITENS_FECHADOS', { codtroca });
      const c = { emp, codtroca, dtcadastro: t.dtcadastro, op };
      for (const it of itens) {
        await movimentoDaTroca(trx, c, it, { ...it, fechado: para });
        await trx.updateTable('itens_troca').set({ fechado: para, usultalteracao: op, dtultimalteracao: sql`now()` }).where('coditenstroca', '=', it.coditenstroca).execute();
      }
      return { codtroca, itens: itens.length };
    });
  }

  /**
   * IMPRIMIR a troca (`ImprimirTroca1Click`, uTrocaMercadoriaFor.pas:1003) — `Relatorios\extr - Troca.fr3`: o frxDBDatasetTroca (o
   * `sqqTroca` da troca aberta), o frxDBDatasetItens_Troca (os itens, `sqqItens_Troca`), e no sub-relatório de cada item o
   * frxDBDatasetQtde (`sqqITENS_TROCA_QTDE`: a quantidade por empresa e o TOTAL = VRCUSTO × QTDE em 3 casas). A `ITENS_TROCA_QTDE` é
   * cópia 1:1 do item (mig 118) — no Apollo a quantidade e a empresa são as do próprio item. A empresa vai no frxDBEmpresa. A grade de
   * conferência que o legado abre antes (`TfrmRelGrid`, só mostra e pergunta) não veio: a troca já está na tela.
   */
  async impressao(id: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cab = (await sql<Record<string, unknown>>`
      SELECT t.codtroca, t.codparceiro, t.data, t.status, p.razao, t.idempresa AS codempresa, t.descricao,
             coalesce(e.fantasia, e.razao_social) AS empresa
        FROM troca t
        LEFT JOIN parceiros p ON p.codparceiro = t.codparceiro
        LEFT JOIN empresas e ON e.idempresa = t.idempresa
       WHERE t.codtroca = ${id} AND t.idempresa = ${emp}`.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('TROCA_NAO_ENCONTRADA', { codtroca: id });
    const itens = (await sql<Record<string, unknown>>`
      SELECT i.coditenstroca, i.idproduto, i.codtroca, i.qtde, i.vrcusto, p.codbarra, p.descricao, i.estoqueretirada, i.idempresa AS codempresa, i.fechado,
             CASE WHEN i.fechado = 'S' THEN 'N' ELSE 'S' END AS editavel
        FROM itens_troca i
        LEFT JOIN produtos p ON p.idproduto = i.idproduto
       WHERE i.codtroca = ${id}
       ORDER BY i.coditenstroca`.execute(db)).rows;
    const nums = new Set(['codtroca', 'codparceiro', 'codempresa', 'coditenstroca', 'idproduto', 'qtde', 'vrcusto']);
    return {
      titulo: `Troca ${id}`,
      modelo: await modeloFr3(db, 'extr - Troca.fr3'),
      datasets: {
        frxDBDatasetTroca: [registroFr3(cab, nums)],
        frxDBDatasetItens_Troca: itens.map((it) => ({ ...registroFr3(it, nums), __MESTRE: 0 })),
        frxDBDatasetQtde: itens.map((it, k) => ({
          CODITENSTROCA: Number(it.coditenstroca), QTDE: Number(it.qtde ?? 0), CODEMPRESA: Number(it.codempresa),
          STATUS: it.fechado === 'S' ? 'F' : null, TOTAL: Math.round(Number(it.vrcusto ?? 0) * Number(it.qtde ?? 0) * 1000) / 1000, __DETALHE: k,
        })),
        frxDBEmpresa: [await empresaParaRelatorio(db, emp)],
      },
    };
  }
}
