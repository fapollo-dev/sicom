import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroFormasPgto {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
}

/**
 * GRÁFICO DE FORMAS DE PAGAMENTO — rel 08 do hub FRMRELVENDAS (`uVendas.pas` `TVendas.Finalizadoras`,
 * GetSQL case 08). Total por OPERACAO de CX_VENDAS no período: é a pizza/barra de participação das
 * finalizadoras. O `.fr3` é só o TfrxChartView (ScriptText vazio) — não há regra escondida no impresso.
 *
 * NÃO CONFUNDIR com a tela "Vendas e Finalizadoras" (UrelFinalizadoras, já migrada): lá só entra no total o
 * que casa com uma MODALIDADE de formas_pgto (lição 27). AQUI a regra é outra — o legado usa uma LISTA FIXA
 * de exclusão: `OPERACAO NOT IN ('DESCONTO','ACRESCIMO','SANGRIA','SUPRIMENTO')`. Qualquer outra operação
 * (mesmo sem forma cadastrada) vira fatia própria do gráfico. Copiado como está; uniformizar com a outra
 * tela mudaria o resultado.
 *
 * A medida é `SUM(VALOR − TROCO)` com CAST no TOTAL (numeric(18,2)) — o dinheiro sai LÍQUIDO do troco.
 *
 * SEM filtro de canceladas: para a rel 08 o form curto-circuita o rgCanceladas (`andwhere + ''`,
 * URelVendas.pas:879-882) — CX_VENDAS não tem essa dimensão. E o filtro de promoção do frame nem se aplicaria
 * (a query não tem o alias V). Por isso o schema desta variante só expõe período/hora.
 *
 * `CX.DATA` nos limites resolve no fuso da sessão ⇒ bounds com FUSO_HORARIO_ACESSO (lição 17).
 */
@Injectable()
export class RelFormasPgtoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroFormasPgto): Promise<{
    linhas: Record<string, unknown>[];
    totais: Record<string, unknown>;
    filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const db = this.dbp.forTenantRead() as AnyDB;
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const fimExcl = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fimExcl.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fimExcl.setUTCDate(fimExcl.getUTCDate() + 1);
    const ate = fimExcl.toISOString().slice(0, 10);

    let q = db
      .selectFrom('cx_vendas as cx')
      .select([
        sql`cx.operacao`.as('modalidade'),
        // CAST no TOTAL (não por linha) — é o que o legado escreve nesta variante
        sql`round(sum(coalesce(cx.valor,0) - coalesce(cx.troco,0))::numeric, 2)`.as('total_venda'),
      ])
      .where('cx.idempresa', '=', emp)
      // a LISTA FIXA do legado — não é "só o que casa com formas_pgto" (essa é a outra tela)
      .where(sql<boolean>`cx.operacao not in ('DESCONTO','ACRESCIMO','SANGRIA','SUPRIMENTO')`);
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      q = q.where('cx.data', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where('cx.data', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    } else {
      q = q.where('cx.data', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
        .where('cx.data', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    }
    const rows = (await q.groupBy(sql`cx.operacao`).orderBy(sql`cx.operacao`).execute()) as Record<string, unknown>[];

    const total = r2(rows.reduce((s, r) => s + num(r.total_venda), 0));
    const linhas = rows.map((r) => ({
      modalidade: r.modalidade,
      total_venda: r2(num(r.total_venda)),
      // participação p/ o gráfico — NULL com total 0 (nunca 0,00 falso; lição 12b)
      participacao: total !== 0 ? r2((num(r.total_venda) * 100) / total) : null,
    }));
    return {
      linhas,
      totais: { total_venda: total, modalidades: linhas.length },
      filtro: { ...f, empresa: emp, fuso: tz, excluidas: ['DESCONTO', 'ACRESCIMO', 'SANGRIA', 'SUPRIMENTO'] },
    };
  }
}
