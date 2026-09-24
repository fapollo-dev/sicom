import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { configNaTrx } from '../compras/pedido-heranca';
import { novoGrupo } from './apagar-caixa';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** o `FormatFloat('0,00')` do Delphi que o histórico de exclusão usa: inteiro, mínimo 3 dígitos, milhar com ponto */
const milhar = (v: unknown) => String(Math.round(num(v))).padStart(3, '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export interface AgruparAreceberInput {
  codrcbs: number[];
  codparceiro?: number;
  dtvenda?: string;
  dtvenc?: string;
  idpgto?: number;
  obs?: string;
  desconto?: number;
  /** os títulos com "Calc. Juros" marcado — o juro do dia entra no total */
  jurosDe?: number[];
  cobrarTaxaAdm?: boolean;
}

/**
 * AGRUPAMENTO DE CONTAS A RECEBER (`uAgrupaContasAReceber`, `uAddTituloAgrupamentoAReceber`, o menu de agrupamento do
 * `uCadAReceber`; dossiê `uAgrupaContas.md`). O MODELO DO LEGADO, provado em 194 de 194 consolidados:
 *  - o CONSOLIDADO é um título com AGRUPAMENTO='S' (ORIGEM nula — ORIGEM 'A' no legado é o acordo comercial) e CODGRUPO
 *    novo da sequência de grupos; os MEMBROS ficam AGRUPADO='S' com CODGRUPO_AGRUPAMENTO_RCB = o CODGRUPO do consolidado.
 *    (O Apollo ligava pelo CODRCB — em 77% dos vínculos migrados esse número é o de OUTRO título.)
 *  - o uso de verdade é o fechamento de convênio de vários clientes (16 de 24 grupos em 2026): com mais de um cliente, o
 *    título vai para o parceiro informado.
 *  - total = Σ valor + o juro das linhas marcadas + a taxa administrativa (valor fixo da empresa) − o desconto.
 *  - o consolidado não tem CAIXA (os membros mantêm a sua) e não vai ao contábil do contas a receber (a integração exclui
 *    AGRUPAMENTO='S'); a baixa dele quita os membros (`areceber-baixa.service.ts`).
 */
@Injectable()
export class AreceberAgrupamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async tz(db: AnyDB, emp: number): Promise<string> {
    return (await configNaTrx(db, 'FUSO_HORARIO_ACESSO', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'America/Sao_Paulo';
  }

  private async historico(trx: AnyDB, emp: number, coddoc: number, texto: string, soData = false) {
    const op = currentTenant().operadorId ?? null;
    await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
        VALUES (${String(coddoc)}, 'ARECEBER', ${texto.slice(0, 600)}, ${soData ? sql`current_date` : sql`date_trunc('second', now() AT TIME ZONE ${await this.tz(trx, emp)})`}, ${op}, ${emp})`.execute(trx);
  }

  /** o consolidado (AGRUPAMENTO='S') com o seu CODGRUPO — "Contas a receber não possui grupo." */
  private async consolidado(trx: AnyDB, emp: number, codrcb: number): Promise<Record<string, unknown>> {
    const c = (await sql<Record<string, unknown>>`SELECT r.*, p.razao FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
        WHERE r.codrcb = ${codrcb} AND r.codempresa = ${emp} FOR UPDATE OF r`.execute(trx)).rows[0];
    if (!c) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb });
    if (c.agrupamento !== 'S' || !num(c.codgrupo)) throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codrcb });
    return c;
  }

  /**
   * AGRUPAR (`uAgrupaContasAReceber`): os títulos abertos e não agrupados da busca (a do legado não barra NF, contabilizado nem
   * cliente diverso). Com mais de um cliente, "informe o parceiro para gerar o título"; a forma, o banco, o cobrador e o
   * vendedor vêm do último título da grade, como no legado.
   */
  async agrupar(dto: AgruparAreceberInput): Promise<{ codgrupo: number; consolidado: number; membros: number; total: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ids = [...new Set((dto.codrcbs ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) throw new BusinessRuleError('AGRUPAMENTO_SEM_DOCUMENTOS');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await sql`SELECT codrcb FROM areceber WHERE codrcb = ANY(${ids}::int[]) AND codempresa = ${emp} FOR UPDATE`.execute(trx);
      const lidos = (await sql<Record<string, unknown>>`SELECT r.codrcb, r.codparceiro, r.valor, r.quitada, r.agrupado, r.consiliado, r.idpgto, r.codbco,
             r.codcobrador, r.codvendedor, coalesce(v.juro, 0) AS juro
          FROM areceber r LEFT JOIN get_areceber v ON v.codrcb = r.codrcb
         WHERE r.codrcb = ANY(${ids}::int[]) AND r.codempresa = ${emp}`.execute(trx)).rows;
      if (lidos.length !== ids.length) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO');
      const membros = ids.map((id) => lidos.find((m) => num(m.codrcb) === id) as Record<string, unknown>);
      const empresa = (await sql<Record<string, unknown>>`SELECT txjuropadrao, txadm, fechamento_caixa FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0] ?? {};
      for (const m of membros) {
        if (m.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: m.codrcb });
        if (m.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codrcb: m.codrcb });
        // com o fechamento de caixa da empresa, a busca só traz o título conciliado na tesouraria
        if (empresa.fechamento_caixa === 'S' && m.consiliado !== 'S') throw new BusinessRuleError('TITULO_NAO_CONCILIADO', { codrcb: m.codrcb });
      }
      const clientes = new Set(membros.map((m) => num(m.codparceiro)));
      const codparceiro = num(dto.codparceiro) || (clientes.size === 1 ? [...clientes][0] : 0);
      if (!codparceiro) throw new BusinessRuleError('AGRUPAMENTO_INFORME_PARCEIRO');
      if (!(await sql`SELECT 1 FROM parceiros WHERE codparceiro = ${codparceiro}`.execute(trx)).rows.length) throw new BusinessRuleError('PARCEIRO_NAO_ENCONTRADO', { codparceiro });

      const juros = new Set((dto.jurosDe ?? []).map(Number));
      const taxa = dto.cobrarTaxaAdm ? num(empresa.txadm) : 0;
      const bruto = r2(membros.reduce((s, m) => s + num(m.valor) + (juros.has(num(m.codrcb)) ? num(m.juro) : 0), 0) + taxa);
      const desconto = r2(num(dto.desconto));
      if (desconto > bruto) throw new BusinessRuleError('AGRUPAMENTO_DESCONTO_MAIOR');
      const total = r2(bruto - desconto);
      if (!(total > 0)) throw new BusinessRuleError('AGRUPAMENTO_VALOR_INVALIDO');
      const ultimo = membros[membros.length - 1];
      const idpgto = num(dto.idpgto) || num(ultimo.idpgto);
      if (!idpgto) throw new BusinessRuleError('AGRUPAMENTO_FORMA_OBRIGATORIA');

      const tz = await this.tz(trx, emp);
      const hoje = (await sql<{ d: string }>`SELECT to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d`.execute(trx)).rows[0].d;
      const dtvenda = dto.dtvenda ?? hoje;
      const dtvenc = dto.dtvenc ?? hoje;
      if (dtvenc < dtvenda) throw new BusinessRuleError('AGRUPAMENTO_VENCIMENTO_ANTERIOR');
      await assertPeriodoNaoFechado(trx, emp, dtvenda, 'bloq_rcb');
      const dia = (d: string) => sql`((${d}::date)::timestamp AT TIME ZONE ${tz})`;

      const codgrupo = await novoGrupo(trx);
      const ins = (await sql<{ codrcb: number }>`
        INSERT INTO areceber (codempresa, codparceiro, valor, total, txadm, txjuros, dtvenda, dtvenc, nrodup, duplicata, idpgto, codbco,
                              codcobrador, codvendedor, consiliado, cadastrado_manualmente, agrupamento, agrupado, quitada, codgrupo, obs,
                              codoperador, usultalteracao, dtultimalteracao, dtcadastro)
        VALUES (${emp}, ${codparceiro}, ${total}, ${total}, ${taxa || null}, ${num(empresa.txjuropadrao)}, ${dia(dtvenda)}, ${dia(dtvenc)}, 1, ' - 001/001',
                ${idpgto}, ${ultimo.codbco ?? null}, ${ultimo.codcobrador ?? null}, ${ultimo.codvendedor ?? null}, 'S', 'S', 'S', 'N', 'N', ${codgrupo},
                ${dto.obs ?? null}, ${op}, ${op}, now(), now())
        RETURNING codrcb`.execute(trx)).rows[0];
      await sql`UPDATE areceber SET agrupado = 'S', codgrupo_agrupamento_rcb = ${codgrupo}, data_agrupamento = now(), usultalteracao = ${op}, dtultimalteracao = now()
          WHERE codrcb = ANY(${ids}::int[]) AND codempresa = ${emp}`.execute(trx);
      return { codgrupo, consolidado: num(ins.codrcb), membros: ids.length, total };
    });
  }

  /**
   * ADICIONAR TÍTULO (`IncluirTituloAgrupamento`, uCadAReceber.pas:3790-3860): o título aberto e não agrupado entra no grupo e o
   * consolidado soma o TOTAL dele (com o juro do dia, marcado ou não — como o legado); histórico por título e do valor novo.
   * Divergências: grava a DATA_AGRUPAMENTO (o legado deixava nula — 209 membros) e recusa consolidado já pago.
   */
  async adicionarTitulos(codConsolidado: number, codrcbs: number[]) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ids = [...new Set((codrcbs ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) throw new BusinessRuleError('AGRUPAMENTO_SEM_DOCUMENTOS');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.consolidado(trx, emp, codConsolidado);
      if (c.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: codConsolidado });
      await sql`SELECT codrcb FROM areceber WHERE codrcb = ANY(${ids}::int[]) AND codempresa = ${emp} FOR UPDATE`.execute(trx);
      const titulos = (await sql<Record<string, unknown>>`SELECT r.codrcb, r.codparceiro, r.agrupamento, r.agrupado, r.quitada, p.razao,
             coalesce(v.total, r.valor) AS total
          FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro LEFT JOIN get_areceber v ON v.codrcb = r.codrcb
         WHERE r.codrcb = ANY(${ids}::int[]) AND r.codempresa = ${emp} ORDER BY r.codrcb`.execute(trx)).rows;
      if (titulos.length !== ids.length) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO');
      for (const t of titulos) {
        if (t.agrupamento === 'S' || t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codrcb: t.codrcb });
        if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: t.codrcb });
      }
      const soma = r2(titulos.reduce((s, t) => s + num(t.total), 0));
      if (!soma) throw new BusinessRuleError('AGRUPAMENTO_SOMA_ZERO');
      for (const t of titulos) {
        await sql`UPDATE areceber SET agrupado = 'S', codgrupo_agrupamento_rcb = ${num(c.codgrupo)}, data_agrupamento = now(), usultalteracao = ${op}, dtultimalteracao = now()
            WHERE codrcb = ${num(t.codrcb)}`.execute(trx);
        await this.historico(trx, emp, num(t.codrcb), ` INCLUSO TÍTULO n° ${num(t.codrcb)} - cliente : ${num(t.codparceiro)} - ${t.razao ?? ''} ao agrupamento nº ${codConsolidado}`);
      }
      const valor = r2(num(c.valor) + soma);
      await sql`UPDATE areceber SET valor = ${valor}, total = ${valor}, usultalteracao = ${op}, dtultimalteracao = now() WHERE codrcb = ${codConsolidado}`.execute(trx);
      await this.historico(trx, emp, codConsolidado, ` ATUALIZACAO DO VALOR DO AGRUPAMENTO n° ${codConsolidado} - cliente : ${num(c.codparceiro)} - ${c.razao ?? ''}`);
      return { consolidado: codConsolidado, adicionados: titulos.length, novoValor: valor };
    });
  }

  /**
   * REVERTER (`btnReverterAgrupamentoClick`, uCadAReceber.pas:3700-3790): recusa com parcela quitada ou desconto de título; os
   * membros voltam (a DATA_AGRUPAMENTO fica, como no legado) e as parcelas do consolidado saem, com o histórico de exclusão.
   * Integridade que o legado não verificava: a baixa ativa e o título em lote de cobrança (a exclusão levaria o recebimento).
   */
  async reverter(codConsolidado: number): Promise<{ revertido: true; consolidado: number; membros: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.consolidado(trx, emp, codConsolidado);
      const g = num(c.codgrupo);
      const parcelas = (await sql<Record<string, unknown>>`SELECT codrcb, quitada, cod_desconto_titulo FROM areceber WHERE codgrupo = ${g} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows;
      if (parcelas.some((p) => p.quitada === 'S')) throw new BusinessRuleError('AGRUPAMENTO_PARCELAS_QUITADAS');
      if (parcelas.some((p) => num(p.cod_desconto_titulo) > 0)) throw new BusinessRuleError('AGRUPAMENTO_DESCONTO_TITULO');
      const codigos = parcelas.map((p) => num(p.codrcb));
      if ((await sql`SELECT 1 FROM areceber_bx WHERE codrcb = ANY(${codigos}::int[]) AND coalesce(indr, 'I') = 'I' LIMIT 1`.execute(trx)).rows.length) {
        throw new BusinessRuleError('AGRUPAMENTO_BAIXADO', { codrcb: codConsolidado });
      }
      if ((await sql`SELECT 1 FROM itens_lotecob WHERE codrcb = ANY(${codigos}::int[]) LIMIT 1`.execute(trx)).rows.length) {
        throw new BusinessRuleError('TITULO_EM_LOTE', { codrcb: codConsolidado });
      }
      const r = await sql`UPDATE areceber SET agrupado = 'N', codgrupo_agrupamento_rcb = NULL, usultalteracao = ${op}, dtultimalteracao = now()
          WHERE codgrupo_agrupamento_rcb = ${g} AND codempresa = ${emp}`.execute(trx);
      await sql`DELETE FROM caixa WHERE codrcb = ANY(${codigos}::int[])`.execute(trx);
      await sql`DELETE FROM areceber WHERE codgrupo = ${g} AND codempresa = ${emp}`.execute(trx);
      await this.historico(trx, emp, codConsolidado,
        `EXCLUSAO DO REGISTRO  REVERSÃO DE AGRUPAMENTO CLIENTE: ${num(c.codparceiro)}-${c.razao ?? ''}, DOCUMENTO: ${c.duplicata ?? ''}, VALOR: ${milhar(c.valor)}`, true);
      return { revertido: true as const, consolidado: codConsolidado, membros: Number(r.numAffectedRows ?? 0) };
    });
  }

  /**
   * REMOVER TÍTULO (`RemoverTituloAgrupamento`, uCadAReceber.pas:3900-3960): o membro volta e o consolidado perde o VALOR dele
   * (o TOTAL acompanha); histórico de remoção. Como no legado, o último membro pode sair. Integridade: consolidado pago não.
   */
  async removerTitulo(codConsolidado: number, codMembro: number): Promise<{ consolidado: number; removido: number; novoValor: number; membrosRestantes: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.consolidado(trx, emp, codConsolidado);
      if (c.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: codConsolidado });
      const m = (await sql<Record<string, unknown>>`SELECT r.codrcb, r.valor, r.codparceiro, r.codgrupo_agrupamento_rcb, p.razao FROM areceber r
          LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro WHERE r.codrcb = ${codMembro} AND r.codempresa = ${emp} FOR UPDATE OF r`.execute(trx)).rows[0];
      if (!m || num(m.codgrupo_agrupamento_rcb) !== num(c.codgrupo)) throw new BusinessRuleError('TITULO_NAO_PERTENCE_AGRUPAMENTO', { codrcb: codMembro });
      await sql`UPDATE areceber SET agrupado = 'N', codgrupo_agrupamento_rcb = NULL, usultalteracao = ${op}, dtultimalteracao = now() WHERE codrcb = ${codMembro}`.execute(trx);
      const novoValor = r2(num(c.valor) - num(m.valor));
      await sql`UPDATE areceber SET valor = ${novoValor}, total = ${novoValor}, usultalteracao = ${op}, dtultimalteracao = now() WHERE codrcb = ${codConsolidado}`.execute(trx);
      await this.historico(trx, emp, codMembro, ` REMOÇÃO DE TÍTULO n° ${codMembro} - cliente : ${num(m.codparceiro)} - ${m.razao ?? ''} do agrupamento nº ${codConsolidado}`);
      const restantes = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM areceber WHERE codgrupo_agrupamento_rcb = ${num(c.codgrupo)} AND codempresa = ${emp}`.execute(trx)).rows[0].n);
      return { consolidado: codConsolidado, removido: codMembro, novoValor, membrosRestantes: restantes };
    });
  }

  /** os membros do consolidado — pelo CODGRUPO dele (`QryAgrupados`) */
  async membros(codConsolidado: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`SELECT m.codrcb, m.codparceiro, m.valor, m.dtvenc, m.duplicata, m.quitada
        FROM areceber c JOIN areceber m ON m.codgrupo_agrupamento_rcb = c.codgrupo AND m.codempresa = c.codempresa
       WHERE c.codrcb = ${codConsolidado} AND c.codempresa = ${emp} AND c.agrupamento = 'S'
       ORDER BY m.codrcb`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }
}
