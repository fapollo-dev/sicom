import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { configNaTrx } from '../compras/pedido-heranca';
import { novoGrupo } from './apagar-caixa';
import { DocumentosContabilService } from './documentos-contabil.service';
import { emSavepoint } from './fechamento-contabil.service';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

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
  /** o convênio do MESMO CNPJ (`frmConvenioParceiro`): o centro de custo de despesa, a forma, a data do caixa e a obs */
  convenio?: { codplc?: number; idpgto?: number; data?: string; obs?: string };
}

/** a obs padrão da CAIXA do convênio (`frmConvenioParceiro`) */
const OBS_CONVENIO = 'Originado do lancamento do adiantamento de parceiro com mesmo CNPJ.';

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
  constructor(private readonly dbp: DatabaseProvider, private readonly contabil: DocumentosContabilService) {}

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
  async agrupar(dto: AgruparAreceberInput): Promise<{ codgrupo: number; consolidado: number | null; membros: number; total: number; convenio?: Record<string, unknown> }> {
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
      if (await this.mesmoCnpj(trx, emp, codparceiro)) {
        return this.agruparConvenio(trx, { emp, op, tz, hoje, ids, membros, codparceiro, total, idpgtoPadrao: num(ultimo.idpgto), convenio: dto.convenio });
      }
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

  /** o CNPJ do parceiro é o da empresa logada? (`ApenasNumero(CNPJ_CPF) = ApenasNumero(EMPRESA.CNPJ)`) — o CNPJ do parceiro mora no
   *  primeiro endereço (PARCEIROS_END), como o contábil lê */
  private async mesmoCnpj(trx: AnyDB, emp: number, codparceiro: number): Promise<boolean> {
    const r = (await sql<{ p: string | null; e: string | null }>`
      SELECT regexp_replace(coalesce((SELECT pe.cnpj_cpf FROM parceiros_end pe WHERE pe.codparceiro = ${codparceiro} ORDER BY pe.codend LIMIT 1), ''), '[^0-9]', '', 'g') AS p,
             regexp_replace(coalesce((SELECT cnpj FROM empresas WHERE idempresa = ${emp}), ''), '[^0-9]', '', 'g') AS e`.execute(trx)).rows[0];
    return !!r?.p && r.p === r.e;
  }

  /**
   * O CONVÊNIO DO MESMO CNPJ (`frmConvenioParceiro` + `GeraApagar`, uCadAReceber; dossiê §2): quando o parceiro do agrupamento é a
   * PRÓPRIA empresa (na produção, o 87199 JF SUPERMERCADOS = empresa 1; 32 grupos desde 2020, 1 em 2026), o legado não cria o
   * consolidado a receber — os títulos dos conveniados viram um A PAGAR já QUITADO para a empresa e uma CAIXA negativa na despesa:
   * - CAIXA ORIGEM 'CONVENIO PARCEIRO': a data do caixa (vários títulos: a venda do último; um: hoje), −total, o centro de custo de
   *   DESPESA (`EMPRESAS.CODPLCFECHAMENTOCONVENIO` quando houver), o nome da forma, GERADO 'SISTEMA', parceiro 0, parcela 1;
   * - APAGAR: o parceiro, DTCOMPRA = DTVENC = hoje, o total, DUPLICATA = o código, "Originado do agrupamento de contas à receber.",
   *   QUITADA 'S', NRODUP 1, OPERACAO_CONVENIO_FUNCIONARIO 'D', CONVENIO 'N', BOLETO, GERADO 'SISTEMA', IDNF 0,
   *   CODCXAGRUPAMENTOCR = a CAIXA, AGRUPAMENTO 'S' e o CODGRUPO novo;
   * - os membros: AGRUPADO 'S' com CODGRUPO_AGRUPAMENTO_APG e a data — e QUITADA 'S' (o binário novo; a auditoria mostra 230/230);
   * - com a integração automática, o contábil do convênio (origem 65) na hora; a falha não desfaz o agrupamento (o `except end`).
   * O gatilho no legado também depende de uma chave do XML da estação ('AGRUPAR BAIXA RECEBER - ATIVA CONVENIO'), que não existe
   * no banco: aqui vale só o CNPJ. Sem os dados do convênio, responde 422 com a sugestão, para a tela perguntar.
   */
  private async agruparConvenio(trx: AnyDB, a: {
    emp: number; op: number | null; tz: string; hoje: string; ids: number[]; membros: Array<Record<string, unknown>>; codparceiro: number; total: number;
    idpgtoPadrao: number; convenio?: AgruparAreceberInput['convenio'];
  }) {
    const empresa = (await sql<{ codplc: unknown; integracao: string | null }>`SELECT codplcfechamentoconvenio AS codplc, integracao FROM empresas WHERE idempresa = ${a.emp}`.execute(trx)).rows[0];
    const plcPadrao = num(empresa?.codplc) || null;
    const ultimo = a.membros[a.membros.length - 1];
    const dataPadrao = a.ids.length > 1
      ? (await sql<{ d: string | null }>`SELECT to_char(dtvenda AT TIME ZONE ${a.tz}, 'YYYY-MM-DD') AS d FROM areceber WHERE codrcb = ${num(ultimo.codrcb)}`.execute(trx)).rows[0]?.d ?? a.hoje
      : a.hoje;
    const cv = a.convenio;
    if (!cv) {
      throw new BusinessRuleError('AGRUPAMENTO_CONVENIO_MESMO_CNPJ', {
        codparceiro: a.codparceiro, total: a.total, sugestao: { codplc: plcPadrao, idpgto: a.idpgtoPadrao || null, data: dataPadrao, obs: OBS_CONVENIO },
      });
    }
    const codplc = plcPadrao ?? num(cv.codplc);
    if (!codplc) throw new BusinessRuleError('AGRUPAMENTO_CONVENIO_CC_OBRIGATORIO');
    const plc = (await sql<{ tpconta: unknown }>`SELECT tpconta FROM plc WHERE codplc = ${codplc}`.execute(trx)).rows[0];
    if (!plc || num(plc.tpconta) !== 1) throw new BusinessRuleError('AGRUPAMENTO_CONVENIO_CC_INVALIDO');
    const idpgto = num(cv.idpgto) || a.idpgtoPadrao;
    const forma = idpgto ? (await sql<{ modalidade: string }>`SELECT modalidade FROM formas_pgto WHERE idpgto = ${idpgto} AND idempresa = ${a.emp}`.execute(trx)).rows[0] : undefined;
    if (!forma) throw new BusinessRuleError('AGRUPAMENTO_FORMA_OBRIGATORIA');
    const data = cv.data ?? dataPadrao;
    await assertPeriodoNaoFechado(trx, a.emp, data, 'bloq_rcb');
    const dia = (d: string) => sql`((${d}::date)::timestamp AT TIME ZONE ${a.tz})`;
    const obs = cv.obs ?? OBS_CONVENIO;

    const cx = (await sql<{ codcx: number }>`
      INSERT INTO caixa (data, valor, vrtitulo, obs, operador, codplc, idempresa, tiporecurso, codconta, codparceiro, nrparcela, codgrupo, dtvenc,
                         gerado, codrcb, dtcadastro, origem)
      VALUES (${dia(data)}, ${-a.total}, ${-a.total}, ${obs}, ${a.op}, ${codplc}, ${a.emp}, ${forma.modalidade}, NULL, 0, 1, NULL, ${dia(data)},
              'SISTEMA', NULL, now(), 'CONVENIO PARCEIRO')
      RETURNING codcx`.execute(trx)).rows[0];
    const codgrupo = await novoGrupo(trx);
    const apg = (await sql<{ codapg: number }>`
      INSERT INTO apagar (codempresa, codparceiro, dtcompra, dtvenc, valor, obs, quitada, nrodup, operacao_convenio_funcionario, convenio, tipodoc,
                          txjuros, gerado, idnf, codcxagrupamentocr, agrupamento, codgrupo, codoperador, dtcadastro)
      VALUES (${a.emp}, ${a.codparceiro}, ${dia(a.hoje)}, ${dia(a.hoje)}, ${a.total}, 'Originado do agrupamento de contas à receber.', 'S', 1, 'D', 'N', 'BOLETO',
              0, 'SISTEMA', 0, ${Number(cx.codcx)}, 'S', ${codgrupo}, ${a.op}, now())
      RETURNING codapg`.execute(trx)).rows[0];
    const codapg = Number(apg.codapg);
    await sql`UPDATE apagar SET duplicata = ${String(codapg)} WHERE codapg = ${codapg}`.execute(trx);
    await sql`UPDATE areceber SET agrupado = 'S', codgrupo_agrupamento_apg = ${codgrupo}, data_agrupamento = now(), quitada = 'S',
                                  usultalteracao = ${a.op}, dtultimalteracao = now()
        WHERE codrcb = ANY(${a.ids}::int[]) AND codempresa = ${a.emp}`.execute(trx);
    let contabil: { lancamentos: number } | { erro: string } | null = null;
    if (String(empresa?.integracao ?? '').toUpperCase() === 'AUTOMATICA') {
      const r = await emSavepoint(trx, 'contabil_convenio', () => this.contabil.integrarConvenioNaTrx(trx, codgrupo));
      contabil = r.ok ? { lancamentos: Number((r.v as { lancamentos?: number }).lancamentos ?? 0) } : { erro: r.erro instanceof Error ? r.erro.message : String(r.erro) };
    }
    return { codgrupo, consolidado: null, membros: a.ids.length, total: a.total, convenio: { codapg, codcx: Number(cx.codcx), contabil } };
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
  /**
   * os dados das impressões do agrupamento (`btnImprimirClick`, uCadAReceber): o consolidado (frxDBDataset3 = o título), os títulos
   * agrupados (`QryAgrupados`: cupom, venda, vencimento, valor, PDV, operador, loja, cliente) — para "Agrupamento.fr3" (analítico) e
   * "Agrupamentototalizado.fr3" (por cliente) — e o extrato por funcionário (`GetSqlExtratoFuncionario`: nome, tipo = o centro de
   * custo ou a obs ou "CONVENIOS DE FUNCIONARIOS", o valor NEGATIVO, documento, parcela, cobrança e obs, na ordem do legado).
   */
  async relatorio(codConsolidado: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const tz = await this.tz(db, emp);
    const c = (await sql<Record<string, unknown>>`SELECT r.codrcb, r.codgrupo, r.valor, r.total, r.txadm, p.razao AS cliente,
        to_char(r.dtvenda AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenda, to_char(r.dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc
        FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
       WHERE r.codrcb = ${codConsolidado} AND r.codempresa = ${emp} AND r.agrupamento = 'S'`.execute(db)).rows[0];
    if (!c) throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codrcb: codConsolidado });
    const g = num(c.codgrupo);
    const membros = (await sql<Record<string, unknown>>`SELECT r.codrcb, r.nrocupom, to_char(r.dtvenda AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenda,
        to_char(r.dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc, r.valor, r.codpdv, o.nome AS operador, r.codempresa, r.codparceiro, p.razao AS cliente
        FROM areceber r LEFT JOIN operadores o ON o.codoperador = r.codoperador LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
       WHERE r.codgrupo_agrupamento_rcb = ${g} AND r.codempresa = ${emp} ORDER BY r.codrcb`.execute(db)).rows;
    const extrato = (await sql<Record<string, unknown>>`
      SELECT a.codparceiro, op.codoperador, coalesce(p.fantasia, p.razao) AS nome, pl.desccodplc,
             CASE WHEN position('Originado do lancamento do adiantamento de parceiro' in coalesce(pl.descricao, a.obs, 'CONVENIOS DE FUNCIONARIOS')) > 0
                  THEN 'Originado do lancamento do adiantamento de parceiro' ELSE coalesce(pl.descricao, a.obs, 'CONVENIOS DE FUNCIONARIOS') END AS tipo,
             to_char(a.dtvenda AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS data, a.dtvenda AS ord_data, -a.valor AS valor, a.codrcb AS documento, a.nrodup AS parcelas, a.tipodoc, a.obs
        FROM areceber a JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN (SELECT op1.codparceiro, max(op1.codoperador) AS codoperador FROM operadores op1 WHERE coalesce(op1.desabilitado, 'N') = 'N' GROUP BY op1.codparceiro) op
               ON op.codparceiro = p.codparceiro
        LEFT JOIN plc pl ON pl.codplc = a.codplc
       WHERE a.codgrupo_agrupamento_rcb = ${g}
       ORDER BY 3, 2, 1, 5, 4, 7`.execute(db)).rows;
    const empresa = (await sql<Record<string, unknown>>`SELECT razao_social, fantasia, cnpj FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    return {
      empresa: { razao: empresa.razao_social ?? null, fantasia: empresa.fantasia ?? null, cnpj: empresa.cnpj ?? null },
      consolidado: { codrcb: num(c.codrcb), cliente: c.cliente ?? null, dtvenda: c.dtvenda, dtvenc: c.dtvenc, total: num(c.total) || num(c.valor), txadm: num(c.txadm) },
      membros: membros.map((m) => ({ ...m, valor: num(m.valor) })),
      extrato: extrato.map(({ ord_data: _o, ...e }) => ({ ...e, valor: num(e.valor) })),
    };
  }

  /**
   * As impressões do agrupamento no layout do cliente (`btnImprimirClick`, uCadAReceber.pas:1237): `Agrupamento.fr3` (rgTipoRel 0),
   * `Agrupamentototalizado.fr3` (1) e `Agrupamento_extrato_funcionario.fr3` (2, o `GeraConsulta`). FDBAgrupamentoRCB = o `QryAgrupados`
   * (os títulos do grupo com o operador em OPERADORA e o cliente em RAZAO/NOMECLIENTE, na ordem do cliente e da venda), frxDBDataset3 = o
   * título consolidado da tela (TOTAL, TXADM — o script do layout soma a taxa administrativa), frxDBDataset2 = a empresa do login e
   * frxDBConsulta = o extrato por funcionário.
   */
  async impressao(codConsolidado: number, modo: 'analitico' | 'totalizado' | 'funcionario') {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const projecao = sql`SELECT r.*, o.nome AS operadora, p1.razao AS nomevendedor, p2.razao AS nomecobrador, p3.razao AS nomecliente, p3.razao AS razao,
           e.endereco, e.bairro, e.cidade, e.cep, e.uf, e.cnpj_cpf, e.rg_insc, f.modalidade, em.razao_social AS razaosocial, b.banco, plc.descricao, plc.desccodplc
      FROM areceber r
      LEFT JOIN operadores o ON o.codoperador = r.codoperador
      LEFT JOIN parceiros p1 ON p1.codparceiro = r.codvendedor
      LEFT JOIN parceiros p2 ON p2.codparceiro = r.codcobrador
      LEFT JOIN parceiros p3 ON p3.codparceiro = r.codparceiro
      LEFT JOIN LATERAL (SELECT * FROM parceiros_end pe WHERE pe.codparceiro = p3.codparceiro AND coalesce(pe.ativado, 'S') = 'S' ORDER BY pe.codend LIMIT 1) e ON true
      LEFT JOIN formas_pgto f ON f.idpgto = r.idpgto
      LEFT JOIN empresas em ON em.idempresa = r.codempresa
      LEFT JOIN bancos b ON b.codbco = r.codbco
      LEFT JOIN plc ON plc.codplc = r.codplc`;
    const cons = (await sql<Record<string, unknown>>`${projecao} WHERE r.codrcb = ${codConsolidado} AND r.codempresa = ${emp} AND r.agrupamento = 'S'`.execute(db)).rows[0];
    if (!cons) throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codrcb: codConsolidado });
    const membros = (await sql<Record<string, unknown>>`${projecao} WHERE r.codgrupo_agrupamento_rcb = ${num(cons.codgrupo)} ORDER BY p3.razao, r.dtvenda`.execute(db)).rows;
    const nums = await colunasNumericas(db, ['areceber']);
    const tirar = (r: Record<string, unknown>) => { const { senha: _s, ...resto } = r; return registroFr3(resto, nums); };
    const datasets: Record<string, Array<Record<string, unknown>>> = {
      FDBAgrupamentoRCB: membros.map(tirar), frxDBDataset3: [tirar(cons)], frxDBDataset2: [await empresaParaRelatorio(db, emp)],
    };
    if (modo === 'funcionario') {
      const r = await this.relatorio(codConsolidado);
      datasets.frxDBConsulta = r.extrato.map((x: Record<string, unknown>) => registroFr3({ ...x, data: x.data ? `${String(x.data).split('/').reverse().join('-')}T00:00:00` : null }, new Set(['valor', 'documento', 'codparceiro', 'codoperador'])));
    }
    const arquivo = modo === 'analitico' ? 'Agrupamento.fr3' : modo === 'totalizado' ? 'Agrupamentototalizado.fr3' : 'Agrupamento_extrato_funcionario.fr3';
    return { titulo: `Agrupamento ${codConsolidado}`, modelo: await modeloFr3(db, arquivo), datasets };
  }

  async membros(codConsolidado: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`SELECT m.codrcb, m.codparceiro, m.valor, m.dtvenc, m.duplicata, m.quitada
        FROM areceber c JOIN areceber m ON m.codgrupo_agrupamento_rcb = c.codgrupo AND m.codempresa = c.codempresa
       WHERE c.codrcb = ${codConsolidado} AND c.codempresa = ${emp} AND c.agrupamento = 'S'
       ORDER BY m.codrcb`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }
}
