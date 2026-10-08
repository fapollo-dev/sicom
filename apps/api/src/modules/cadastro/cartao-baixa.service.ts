import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { CartaoContabilService } from '../cobranca/cartao-contabil.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * CARTÕES — BAIXA / LIQUIDAÇÃO em lote (FRMBAIXACARTAO, `UbaixaCartao.pas`). Um LOTE (seq_idlote — o ID_IDLOTE do legado)
 * com três pernas na movimentação bancária, como na produção (lote 91347: +154,44 na conta 421; −154,44 e −5,08 na conta 1):
 *  (a) o CRÉDITO do líquido (− outras despesas) na conta de destino, IDPGTO 1, a liberar quando é conta bancária;
 *  (b) a SAÍDA do líquido e (c) a da TAXA na conta da FORMA de cada cartão, uma dupla por IDPGTO (`ValidaSaldoAntMultiEmpresa`).
 * Tudo na DATA DIGITADA da baixa (DTBAIXA, CARTAO_BX, MCB e CAIXA). Até a auditoria de esqueletos (24/09/2026) o Apollo
 * gravava só (a), com a data do dia: 8.798 dos 8.805 lotes do cliente têm (b), R$ −33,1 mi, e (c), R$ −0,62 mi.
 * O líquido vem da view get_cartao (COALESCE(valorliq, bruto − bruto×txadm_ef/100) — a mesma regra do GET_CARTAO).
 * CORTE-3 (mig 277): a baixa é LINHA em `cartao_bx` — 1.169.680 no cliente, R$ 58,4 mi, com baixa PARCIAL real
 * (5.186 recebíveis) e estorno LÓGICO (59.118 com `INDR='E'`). E com a trava que o legado não tem: baixar além do valor é
 * recusado — lá 2.921 cartões têm baixas ativas somando **R$ 131.623,12 a mais** que o próprio valor.
 * A TAXA vai à CAIXA gerencial (UbaixaCartao.pas:1180-1206): uma linha negativa por lote, no CC da taxa (ou o de multa/juros
 * da empresa), "Ref. a bx cartao lote N". OUTRAS DESPESAS (:1151-1176, :1240-1280): saem do crédito, rateadas pelos cartões
 * (VALOR_OUTRAS_DESPESAS_PAGA, sobra no maior) e vão à CAIXA antes da taxa, no CC de descontos concedidos (ou multa/juros).
 * Depois do commit, a integração contábil AUTOMATICA do lote (`IntegraBaixaCartao`, :1214).
 * ADIADO (fiel): o ajuste da diferença/baixa parcial por valor digitado (VALOR_MAXIMO_DIFERENCA_BAIXA, `AjustarDiferenca`),
 * a taxa de antecipação e a conciliação de extrato (E-Extrato/SITEF).
 */
/**
 * o HISTORICO do crédito da baixa: a tela entra no campo com "REF. BX LOTE: <lote>" (`dbmObsEnter`, UbaixaCartao.pas:1290) e o operador
 * digita o nome antes — "AMEX REF. BX LOTE: 91347", "MASTER V REF. BX LOTE: 91365". Aqui o lote só existe ao gravar: o que o operador
 * digitou vai na frente de "REF. BX LOTE: <lote>" (salvo se ele já escreveu o texto inteiro).
 */
export function historicoDaBaixa(digitado: string | undefined | null, idlote: number): string {
  const t = String(digitado ?? '').trim();
  if (!t) return `REF. BX LOTE: ${idlote}`;
  return (/BX LOTE/i.test(t) ? t : `${t} REF. BX LOTE: ${idlote}`).slice(0, 255);
}

@Injectable()
export class CartaoBaixaService {
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

  /** as empresas do operador (`dmPrincipal.GetMultiEmpresa`: a corrente + `RELACAO_OPERADOR_EMPRESA`) — a pesquisa `GET_CARTAO` filtra por elas */
  private async empresasPermitidas(db: AnyDB, emp: number, op: number): Promise<number[]> {
    const rel = ((await db.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', op).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa));
    return [...new Set([emp, ...rel])];
  }

  /** `TIntegracaoContabil.ValidaPeriodoFechado` (btnGravarClick :1000) — chaveamento nulo não bloqueia */
  private async assertPeriodo(db: AnyDB, data: string): Promise<void> {
    const cfg = (await sql<{ chav: string | null }>`SELECT to_char(chaveamento_periodo, 'YYYY-MM-DD') AS chav FROM config_integracao_contabil LIMIT 1`.execute(db)).rows[0];
    if (cfg?.chav && data <= cfg.chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: cfg.chav });
  }

  /** as contas ativas do operador (`CONTAS_BANCARIAS_OP`) — conta caixa só serve à TESOURARIA */
  async contas(): Promise<Array<{ codconta: number; nroconta: unknown; titular: unknown; codbco: number | null; idempresa: number; caixa: boolean }>> {
    this.emp();
    const op = this.op();
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.codconta, c.nroconta, c.titular, c.codbco, c.idempresa
        FROM contas_bancarias c
        JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${op}
       WHERE coalesce(c.ativo, 'S') = 'S'
       ORDER BY c.titular, c.codconta`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((c) => ({ codconta: Number(c.codconta), nroconta: c.nroconta, titular: c.titular, codbco: c.codbco == null ? null : Number(c.codbco), idempresa: Number(c.idempresa), caixa: Number(c.codbco) === 0 }));
  }

  async baixar(dto: {
    codconta: number; codvendcartaos: number[]; dataBaixa?: string; destino?: 'BANCARIA' | 'ANTECIPACAO' | 'TESOURARIA'; historico?: string;
    codplcTaxa?: number; outrasDespesas?: number; codplcOutrasDesp?: number;
  }): Promise<{ idlote: number; itens: number; total_liquido: number; total_taxa: number; outras_despesas: number; debitos: number; contabilizado: boolean }> {
    const emp = this.emp();
    const op = this.op();
    const ids = Array.from(new Set((dto.codvendcartaos ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
    if (!ids.length) throw new BusinessRuleError('CARTAO_BAIXA_SEM_ITENS');
    const destino = dto.destino ?? 'BANCARIA';
    const res = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // a data DIGITADA (edtDataBaixa) — não o dia da gravação: "Data da baixa não pode ser maior que a data atual!" (:1372)
      const hoje = String((await sql<{ d: string }>`SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d`.execute(trx)).rows[0].d);
      const data = dto.dataBaixa ?? hoje;
      if (data > hoje) throw new BusinessRuleError('CARTAO_BAIXA_DATA_FUTURA', { data, hoje });
      const empCc = (await trx.selectFrom('empresas').select(['ccmultajuros', 'codplc_descontos_concedidos']).where('idempresa', '=', emp).executeTakeFirst()) as { ccmultajuros?: unknown; codplc_descontos_concedidos?: unknown } | undefined;
      // "É necessário configurar na empresa o centro de custo de multas, juros e taxas!" (:996)
      if (empCc?.ccmultajuros == null) throw new BusinessRuleError('EMPRESA_SEM_CC_MULTA_JUROS');
      await this.assertPeriodo(trx, data);
      // a conta de destino: a do operador (`CONTAS_BANCARIAS_OP`, `edtCodContaExit` :1336); conta caixa só na TESOURARIA (:1340)
      const conta = (await sql<{ codconta: number; idempresa: number; codbco: unknown; codrelacao: unknown }>`
        SELECT c.codconta, c.idempresa, c.codbco, o.codconta AS codrelacao
          FROM contas_bancarias c
          LEFT JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${op}
         WHERE c.codconta = ${dto.codconta} AND coalesce(c.ativo, 'S') = 'S' LIMIT 1`.execute(trx)).rows[0];
      if (!conta) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta: dto.codconta });
      if (conta.codrelacao == null) throw new BusinessRuleError('CONTA_SEM_PERMISSAO_OPERADOR', { codconta: dto.codconta });
      if (Number(conta.codbco) === 0 && destino !== 'TESOURARIA') throw new BusinessRuleError('BAIXA_CONTA_CAIXA_OPERACAO_BANCARIA', { codconta: dto.codconta });
      // TRAVA as linhas ABERTAS na tabela base (FOR UPDATE numa view com outer join não é permitido no PG), das empresas do operador
      const permitidas = await this.empresasPermitidas(trx, emp, op);
      const abertos = (await trx
        .selectFrom('cartao')
        .select(['codvendcartao', 'valor', 'idempresa', 'idpgto'])
        .where('codvendcartao', 'in', ids)
        .where('idempresa', 'in', permitidas)
        .where('liberado', '=', 'N')
        .orderBy('codvendcartao')
        .forUpdate()
        .execute()) as Array<{ codvendcartao: number; valor: unknown; idempresa: number; idpgto: unknown }>;
      if (!abertos.length) throw new BusinessRuleError('CARTAO_BAIXA_NENHUM_ABERTO');
      // líquido COMPUTADO pela view get_cartao (sem lock — só leitura do cálculo).
      const netRows = (await trx.selectFrom('get_cartao').select(['codvendcartao', 'valor_com_taxa']).where('codvendcartao', 'in', abertos.map((a) => a.codvendcartao)).execute()) as Array<{ codvendcartao: number; valor_com_taxa: unknown }>;
      const netMap = new Map(netRows.map((r) => [Number(r.codvendcartao), r2(num(r.valor_com_taxa))]));
      const liqDe = (r: { codvendcartao: number; valor: unknown }) => netMap.get(Number(r.codvendcartao)) ?? r2(num(r.valor));
      // outras despesas: não passam do total a baixar (`edtOutrasDespExit`) e pedem o CC de descontos concedidos
      const outras = r2(num(dto.outrasDespesas));
      const totalBaixar = r2(abertos.reduce((s, r) => s + liqDe(r), 0));
      if (outras > totalBaixar) throw new BusinessRuleError('CARTAO_OUTRAS_DESPESAS_EXCEDE', { outras, totalBaixar });
      const ccOutras = Number(dto.codplcOutrasDesp ?? empCc?.codplc_descontos_concedidos ?? 0) || null;
      if (outras > 0 && ccOutras == null) throw new BusinessRuleError('BAIXA_CC_DESCONTO_CONCEDIDO');
      const ccMulta = Number(empCc?.ccmultajuros ?? 0) || null;
      // o rateio pelos cartões, proporcional ao líquido; a sobra do arredondamento vai para o maior
      const rateio = new Map<number, number>();
      if (outras > 0 && totalBaixar > 0) {
        let maior = abertos[0];
        for (const r of abertos) {
          if (liqDe(r) > liqDe(maior)) maior = r;
          rateio.set(Number(r.codvendcartao), r2((outras / totalBaixar) * liqDe(r)));
        }
        const soma = r2([...rateio.values()].reduce((s, v) => s + v, 0));
        if (soma !== outras) rateio.set(Number(maior.codvendcartao), r2((rateio.get(Number(maior.codvendcartao)) ?? 0) + (outras - soma)));
      }
      const loteRes = await trx.executeQuery(sql`select nextval('seq_idlote') as v`.compile(trx));
      const idlote = Number((loteRes.rows[0] as { v: number | string }).v);
      // `BaixaContasApagar` (:683-799): por cartão, o UPDATE do legado; e o agrupamento por IDPGTO (cdsTemp) — o cartão
      // sem forma herda a do anterior (FIdpgto só muda quando > 0), e a forma não achada cai na TEF (:766-767)
      const ccTaxa = dto.codplcTaxa ?? ccMulta;
      const grupos = new Map<number, { bruto: number; liquido: number }>();
      let fIdpgto = 0;
      let totalLiq = 0;
      let totalTaxa = 0;
      for (const r of abertos) {
        const liq = liqDe(r);
        const taxa = r2(num(r.valor) - liq);
        totalLiq = r2(totalLiq + liq);
        totalTaxa = r2(totalTaxa + taxa);
        // corte-3 (mig 277): a baixa vira LINHA em `cartao_bx` (1.169.680 no cliente), com o BRUTO baixado —
        // é o que permite baixa PARCIAL (5.186 cartões no cliente) e o estorno LÓGICO por baixa.
        await this.gravarBaixa(trx, {
          codvendcartao: Number(r.codvendcartao), idempresa: Number(r.idempresa), valorpg: r2(num(r.valor)), idlote, codopbx: op, data,
          obs: `DOCUMENTO BAIXADO NO LOTE: ${idlote}`,
        });
        // DTBAIXA = a data digitada 00:00; LIBERADO 'S' (o 'N' do legado é do ItemIndex 3, que o combo de 3 itens não tem);
        // o OBS || ' BAIXA DO LOTE' do fonte a produção não grava (0 de 670.924 baixas desde 2025) — o dado vivo decide
        await trx.updateTable('cartao').set({
          liberado: 'S', dtbaixa: sql`${data}::date`, codopbx: op, idlote, data_operacao: sql`now()`,
          codplc_acredesc: outras > 0 ? ccOutras : null, valor_outras_despesas_paga: rateio.get(Number(r.codvendcartao)) ?? 0,
          valor_taxa_paga: taxa, codplc_taxa_cartao: taxa > 0 ? ccTaxa : null,
          usultalteracao: op, dtultimalteracao: sql`now()`,
        }).where('codvendcartao', '=', r.codvendcartao).execute();
        if (num(r.idpgto) > 0) fIdpgto = Number(r.idpgto);
        const g = grupos.get(fIdpgto) ?? { bruto: 0, liquido: 0 };
        grupos.set(fIdpgto, { bruto: r2(g.bruto + r2(num(r.valor))), liquido: r2(g.liquido + liq) });
      }
      // (a) o CRÉDITO na conta de destino (cdsContaCorrente, `rdgDestinoExit` :2001-2030): IDPGTO 1, C, emissão/vencimento na
      // data da baixa; conta bancária/antecipação nascem A LIBERAR (LIBERADO 'N' + DTLIBERACAO), a tesouraria liberada.
      // O histórico é o digitado (padrão "REF. BX LOTE: N", `dbmObsEnter` :1290). Sem ORIGEM/IDORIGEM — o legado não grava.
      const aLiberar = destino !== 'TESOURARIA';
      await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa: Number(conta.idempresa), valor: r2(totalLiq - outras), tipomovimento: 'C', idlote, idpgto: 1, codopconta: 0,
        historico: historicoDaBaixa(dto.historico, idlote), liberado: aLiberar ? 'N' : 'S',
        dtemissao: sql`${data}::date`, dtvenc: sql`${data}::date`, dtliberacao: aLiberar ? sql`${data}::date` : null,
        codoperador: op, dtcadastro: sql`now()`,
      }).execute();
      // (b)+(c) as SAÍDAS da conta da forma, por IDPGTO (`ValidaSaldoAntMultiEmpresa`, udmPrincipal.pas): o líquido e a taxa,
      // D, liberadas, na data da baixa, IDPGTO da forma. É o que tira o cartão da conta onde a venda o pôs.
      let debitos = 0;
      for (const [idpgto, g] of grupos) {
        const forma = ((await sql<{ idpgto: number; codcontacorrente: unknown }>`
          SELECT idpgto, codcontacorrente FROM formas_pgto WHERE idpgto = ${idpgto}`.execute(trx)).rows[0])
          ?? (await sql<{ idpgto: number; codcontacorrente: unknown }>`
          SELECT idpgto, codcontacorrente FROM formas_pgto WHERE destino = 'TEF' AND idempresa = ${emp} ORDER BY idpgto LIMIT 1`.execute(trx)).rows[0];
        // "Não a formas de pagamento configuradas para empresa!"
        if (!forma || num(forma.codcontacorrente) <= 0) throw new BusinessRuleError('CARTAO_BAIXA_FORMA_SEM_CONTA', { idpgto });
        const origem = (await sql<{ codconta: number; idempresa: number; dtchav: string | null }>`
          SELECT codconta, idempresa, to_char(dtchaveamento, 'YYYY-MM-DD') AS dtchav FROM contas_bancarias WHERE codconta = ${Number(forma.codcontacorrente)}`.execute(trx)).rows[0];
        if (!origem) throw new BusinessRuleError('CARTAO_BAIXA_FORMA_SEM_CONTA', { idpgto });
        // "Caixa FECHADO não é permitida alteração dos documentos!"
        if (origem.dtchav && data <= origem.dtchav) throw new BusinessRuleError('BAIXA_CAIXA_FECHADO', { codconta: Number(origem.codconta), ate: origem.dtchav });
        const saidas: Array<[number, string]> = [[g.liquido, 'SAIDA PARA BAIXA DE DOCUMENTOS']];
        const taxaGrupo = r2(g.bruto - g.liquido);
        if (taxaGrupo > 0) saidas.push([taxaGrupo, 'SAIDA REF A TAXA ADMINISTRATIVA DA BAIXA DE DOCUMENTOS']);
        for (const [valor, historico] of saidas) {
          await trx.insertInto('mov_contas_bancarias').values({
            codconta: Number(origem.codconta), idempresa: Number(origem.idempresa), valor: Math.abs(valor), tipomovimento: valor < 0 ? 'C' : 'D',
            idlote, idpgto: Number(forma.idpgto), codopconta: 0, historico, liberado: 'S',
            dtemissao: sql`${data}::date`, dtvenc: sql`${data}::date`, dtliberacao: sql`${data}::date`,
            codoperador: op, dtcadastro: sql`now()`,
          }).execute();
          debitos++;
        }
      }
      // o recurso da CAIXA da baixa: "1 - DINHEIRO" (a forma 1 como a tela a mostra — 3.600 de 3.632 linhas de 2025-26)
      const f1 = (await sql<{ modalidade: string | null }>`SELECT modalidade FROM formas_pgto WHERE idpgto = 1 ORDER BY (idempresa = ${emp}) DESC LIMIT 1`.execute(trx)).rows[0];
      const recursoCaixa = f1?.modalidade ? `1 - ${f1.modalidade}` : 'DINHEIRO';
      // OUTRAS DESPESAS na CAIXA gerencial, antes da taxa: o valor digitado, negativo, na data da baixa (UbaixaCartao.pas:1151)
      if (outras > 0) {
        await trx.insertInto('caixa').values({
          data: sql`${data}::date`, valor: -outras, vrtitulo: -outras, obs: `Ref. a bx cartao lote ${idlote}`, operador: op,
          codplc: ccOutras || ccMulta, idempresa: emp, tiporecurso: recursoCaixa, codconta: null, codparceiro: 0,
          nrparcela: '1', codgrupo: null, dtvenc: sql`${data}::date`, gerado: 'SISTEMA', idlotebxcartao: idlote, origem: 'BAIXA CARTAO',
        }).execute();
      }
      // a TAXA na CAIXA gerencial: negativa, no CC da taxa ou no de multa/juros da empresa (UbaixaCartao.pas:1180)
      if (totalTaxa > 0) {
        await trx.insertInto('caixa').values({
          data: sql`${data}::date`, valor: -totalTaxa, vrtitulo: -totalTaxa, obs: `Ref. a bx cartao lote ${idlote}`, operador: op,
          codplc: ccTaxa || null, idempresa: emp, tiporecurso: recursoCaixa, codconta: null, codparceiro: 0, nrparcela: '1', codgrupo: null,
          dtvenc: sql`${data}::date`, gerado: 'SISTEMA', idlotebxcartao: idlote, origem: 'BAIXA CARTAO',
        }).execute();
      }
      return { idlote, data, itens: abertos.length, total_liquido: r2(totalLiq - outras), total_taxa: totalTaxa, outras_despesas: outras, debitos };
    });
    // depois do commit, como o legado (:1214): `EmpresaINTEGRACAO = 'AUTOMATICA'` → `IntegraBaixaCartao(IDLOTE)`
    const contabilizado = await this.integrarSeAutomatica(emp, res.idlote, res.data);
    const { data: _d, ...resto } = res;
    return { ...resto, contabilizado };
  }

  private async integrarSeAutomatica(emp: number, idlote: number, data: string): Promise<boolean> {
    try {
      const e = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
      if (String(e?.integracao ?? '') !== 'AUTOMATICA') return false;
      const r = await new CartaoContabilService(this.dbp).integrar({ dataIni: data, dataFim: data, idlote });
      return r.lancamentos > 0;
    } catch {
      return false;
    }
  }

  /** o saldo do recebível: valor − baixas ATIVAS (as com `indr='E'` não contam). */
  private async baixado(trx: AnyDB, codvendcartao: number): Promise<number> {
    const r = (await sql<{ pg: unknown }>`
      SELECT coalesce(sum(valorpg), 0) AS pg FROM cartao_bx
       WHERE codvendcartao = ${codvendcartao} AND coalesce(indr, 'I') <> 'E'`.execute(trx)).rows[0];
    return r2(num(r?.pg));
  }

  /**
   * grava a baixa — e **recusa passar do valor do recebível**, que é o defeito medido do legado:
   * 2.921 cartões lá têm baixas ativas somando R$ 131.623,12 a mais que o próprio valor (o lote era estornado
   * sem marcar a baixa, e o recebível era baixado de novo).
   */
  private async gravarBaixa(trx: AnyDB, b: { codvendcartao: number; idempresa: number; valorpg: number; idlote: number; codopbx: number | null; obs: string; data: string }) {
    const c = (await sql<{ valor: unknown }>`SELECT valor FROM cartao WHERE codvendcartao = ${b.codvendcartao} AND idempresa = ${b.idempresa}`.execute(trx)).rows[0];
    if (!c) throw new BusinessRuleError('CARTAO_NAO_ENCONTRADO', { codvendcartao: b.codvendcartao });
    const valor = r2(num(c.valor));
    const jaBaixado = await this.baixado(trx, b.codvendcartao);
    if (r2(jaBaixado + b.valorpg) > r2(valor + 0.005)) {
      throw new BusinessRuleError('CARTAO_BAIXA_EXCEDE', { codvendcartao: b.codvendcartao, valor, jaBaixado, tentando: b.valorpg });
    }
    await sql`INSERT INTO cartao_bx (codvendcartao, idempresa, valorpg, data_pgto, codopbx, idlote, obs, dtcadastro)
              VALUES (${b.codvendcartao}, ${b.idempresa}, ${b.valorpg}, ${b.data}::date, ${b.codopbx}, ${b.idlote}, ${b.obs}, now())`.execute(trx);
    return r2(jaBaixado + b.valorpg);
  }

  /** as baixas de um recebível, com o saldo — a visão que o corte-2 não tinha. */
  async baixasDoCartao(codvendcartao: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = (await sql<Record<string, unknown>>`
      SELECT codvendcartao, valor, coalesce(liberado, 'N') AS liberado, dtbaixa, idlote
        FROM cartao WHERE codvendcartao = ${codvendcartao} AND idempresa = ${emp}`.execute(db)).rows[0];
    if (!c) throw new BusinessRuleError('CARTAO_NAO_ENCONTRADO', { codvendcartao });
    const bxs = (await sql<Record<string, unknown>>`
      SELECT codvendcartaobx, valorpg, data_pgto, codopbx, idlote, obs, coalesce(indr, 'I') AS indr
        FROM cartao_bx WHERE codvendcartao = ${codvendcartao} AND idempresa = ${emp}
       ORDER BY codvendcartaobx`.execute(db)).rows;
    const ativas = bxs.filter((b) => b.indr !== 'E');
    const pago = r2(ativas.reduce((s2, b) => s2 + num(b.valorpg), 0));
    return {
      cartao: { ...c, valor: r2(num(c.valor)) },
      baixas: bxs.map((b) => ({ ...b, valorpg: num(b.valorpg), estornada: b.indr === 'E' })),
      totais: { baixas: bxs.length, ativas: ativas.length, pago, saldo: r2(num(c.valor) - pago) },
    };
  }

  /**
   * a CONSULTA do lote (`TfrmConsCRTbx`, "Cartões baixados", UConsCRTbx.pas:62-85): os cartões baixados (`SELECT * FROM GET_CARTAOBX
   * WHERE LOTE = :LOTE`, o cdsDoctoBX — uma linha por baixa ativa, como a view) e os recursos utilizados (a movimentação bancária do lote,
   * com a conta e a modalidade — o sqqContaCorrente). O lote vem inteiro, de qualquer loja, como no legado; o Apollo só exige que algum
   * cartão dele seja de uma loja do operador (a Pesquisa que acha o lote filtra por elas). O VALOR do recurso sai com o sinal do legado
   * (o Apollo guarda o absoluto e o tipo).
   */
  async consultaBaixa(idlote: number): Promise<{ idlote: number; cartoes: Record<string, unknown>[]; recursos: Record<string, unknown>[]; totais: Record<string, number> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const permitidas = await this.empresasPermitidas(db, this.emp(), this.op());
    const cartoes = (await sql<Record<string, unknown>>`
      SELECT codigo, nrocupom, operadora, valor, valor_com_taxa, to_char(data, 'YYYY-MM-DD') AS data, to_char(previsao_compensacao, 'YYYY-MM-DD') AS previsao_compensacao,
             to_char(data_baixa, 'YYYY-MM-DD') AS data_baixa, operador_baixa, codigo_empresa, contabilizado, valorpg
        FROM get_cartaobx WHERE lote = ${idlote} ORDER BY codigo`.execute(db)).rows;
    if (!cartoes.some((c) => permitidas.includes(Number(c.codigo_empresa)))) throw new BusinessRuleError('CARTAO_LOTE_NAO_ENCONTRADO', { idlote });
    const recursos = (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, m.codconta, c.nroconta, c.titular, f.modalidade, CASE WHEN m.tipomovimento = 'D' THEN -m.valor ELSE m.valor END AS valor,
             m.tipomovimento, m.historico, coalesce(m.revertido, 'N') AS revertido
        FROM mov_contas_bancarias m
        LEFT JOIN formas_pgto f      ON f.idpgto = m.idpgto
        LEFT JOIN contas_bancarias c ON c.codconta = m.codconta
       WHERE m.idlote = ${idlote}
       ORDER BY m.codmovconta`.execute(db)).rows;
    const lista = cartoes.map((c) => ({ ...c, valor: r2(num(c.valor)), valor_com_taxa: r2(num(c.valor_com_taxa)), valorpg: c.valorpg == null ? null : r2(num(c.valorpg)) }));
    return {
      idlote,
      cartoes: lista,
      recursos: recursos.map((m) => ({ ...m, valor: r2(num(m.valor)) })),
      totais: {
        cartoes: lista.length,
        valor: r2(lista.reduce((s2, c) => s2 + c.valor, 0)),
        valor_com_taxa: r2(lista.reduce((s2, c) => s2 + c.valor_com_taxa, 0)),
        recursos: r2(recursos.reduce((s2, m) => s2 + num(m.valor), 0)), // o TOTAL (SUM(VALOR)) do cdsContaCorrente
      },
    };
  }

  /**
   * REVERTER o lote (`TfrmConsCRTbx.btnReverterBaixaClick`, `UConsCRTbx.pas:95-275`). Não apaga a movimentação: marca cada
   * linha do lote como REVERTIDA e lança a CONTRÁRIA — cada uma num lote novo, com `IDLOTE_REVERSAO` = o lote, emissão agora,
   * tipo invertido e "Reabertura da baixa de cartões, lote N, realizada pelo usuário X." (produção: 86909 → 86911/86912).
   * Travas: período contábil (na data de hoje), contabilizado só com a integração automática (que estorna junto) e o caixa
   * FECHADO das contas do lote. Solta o recebível (DTBAIXA, conciliação, taxa, CCs e o ajuste), apaga os "não encontrados"
   * dos arquivos de conciliação do lote e as linhas da CAIXA. As tabelas TIVIT_REDE_* do fonte têm 0 linhas no cliente e
   * não vieram. A baixa em `cartao_bx` morre junto (INDR='E'), diferente do legado — ver `gravarBaixa`.
   */
  async estornarLote(idlote: number): Promise<{ idlote: number; itens: number; contraMovimentos: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const hoje = String((await sql<{ d: string }>`SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d`.execute(trx)).rows[0].d);
      await this.assertPeriodo(trx, hoje);
      const permitidas = await this.empresasPermitidas(trx, emp, op);
      // o lote INTEIRO, de qualquer loja (o cdsDoctoBX é `GET_CARTAOBX WHERE LOTE`, sem loja): a movimentação é revertida toda, e
      // reabrir só os cartões das lojas do operador deixaria os outros baixados sem o dinheiro (19 lotes de mais de uma loja desde 2025)
      const recs = (await trx.selectFrom('cartao').select(['codvendcartao', 'idempresa', 'contabilizado', sql<string>`to_char(dtbaixa, 'YYYY-MM-DD')`.as('dtbaixa')])
        .where('idlote', '=', idlote).where('liberado', '=', 'S').orderBy('codvendcartao').forUpdate().execute()) as Array<{ codvendcartao: number; idempresa: number; contabilizado: string | null; dtbaixa: string | null }>;
      // "Não existem documentos a reverter." — e o lote que nenhuma loja do operador alcança não existe para ele (a Pesquisa filtra)
      if (!recs.some((r) => permitidas.includes(Number(r.idempresa)))) throw new BusinessRuleError('CARTAO_LOTE_NAO_ENCONTRADO', { idlote });
      const contabilizados = recs.filter((r) => String(r.contabilizado ?? '') === 'S').map((r) => Number(r.codvendcartao));
      const integracao = String(((await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst()) as { integracao?: string | null } | undefined)?.integracao ?? '');
      // "Não é permitido reverter pois existe(m) documento(s) contabilizado(s). Código(s): …"
      if (contabilizados.length && integracao !== 'AUTOMATICA') throw new BusinessRuleError('CARTAO_REVERSAO_CONTABILIZADA', { idlote, codigos: contabilizados.join(', ') });
      // "Caixa FECHADO não é permitida alteração dos documentos!" — a data da baixa contra o chaveamento de cada conta do lote
      const dataBaixa = recs[0].dtbaixa;
      if (dataBaixa) {
        const fechada = (await sql<{ codconta: number; ate: string }>`
          SELECT m.codconta, to_char(c.dtchaveamento, 'YYYY-MM-DD') AS ate FROM mov_contas_bancarias m JOIN contas_bancarias c ON c.codconta = m.codconta
           WHERE m.idlote = ${idlote} AND c.dtchaveamento IS NOT NULL AND ${dataBaixa}::date <= c.dtchaveamento::date LIMIT 1`.execute(trx)).rows[0];
        if (fechada) throw new BusinessRuleError('BAIXA_CAIXA_FECHADO', { codconta: Number(fechada.codconta), ate: fechada.ate });
      }
      // "Movimentação não encontrada."
      const movs = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM mov_contas_bancarias WHERE idlote = ${idlote}`.execute(trx)).rows[0].n);
      if (!movs) throw new BusinessRuleError('CARTAO_LOTE_SEM_MOVIMENTACAO', { idlote });
      // `ApagaCartoesNaoEncontrados`: os "não encontrados" dos arquivos de conciliação do lote
      await sql`DELETE FROM cons_reg10_nao_encontrados
                 WHERE upper(nomearquivo) IN (SELECT DISTINCT upper(nomearquivoconciliacao) FROM cartao
                                               WHERE idlote = ${idlote} AND coalesce(nomearquivoconciliacao, '') <> '')`.execute(trx);
      if (contabilizados.length) await new CartaoContabilService(this.dbp).estornarNaTrx(trx, emp, { dataIni: hoje, dataFim: hoje, idlote });
      await sql`UPDATE cartao_bx SET indr = 'E', indr_usuario = ${op}, indr_data = now()
                 WHERE idlote = ${idlote} AND coalesce(indr, 'I') <> 'E'`.execute(trx);
      await trx.updateTable('cartao').set({
        liberado: 'N', referencia: null, dtbaixa: null, nomearquivoconciliacao: null, tipo_conciliacao: null, idlote: null, data_operacao: null,
        codplc_acredesc: null, valor_outras_despesas_paga: null, valor_taxa_paga: null, codplc_taxa_cartao: null, valor_ajuste_baixa: null,
        usultalteracao: op, dtultimalteracao: sql`now()`,
      }).where('codvendcartao', 'in', recs.map((r) => r.codvendcartao)).execute();
      // a movimentação contrária — uma por linha do lote, cada uma num lote novo (o `TDB.GetId('IDLOTE')` dentro do laço)
      const nome = String(((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined)?.nome ?? '');
      const ins = await sql`
        INSERT INTO mov_contas_bancarias (codconta, idempresa, valor, tipomovimento, codopconta, historico, idpgto, idlote, idlote_reversao, revertido,
                                          dtemissao, dtvenc, dtliberacao, liberado, nrodocumento, codoperador, origem, idorigem, dtcadastro)
        SELECT m.codconta, m.idempresa, m.valor, CASE WHEN m.tipomovimento = 'C' THEN 'D' ELSE 'C' END, m.codopconta,
               ${`Reabertura da baixa de cartões, lote ${idlote}, realizada pelo usuário ${nome}.`}, m.idpgto, nextval('seq_idlote'), ${idlote}, 'N',
               now(), now(), m.dtliberacao, m.liberado, m.nrodocumento, m.codoperador, m.origem, 0, now()
          FROM mov_contas_bancarias m
         WHERE m.idlote = ${idlote}
         ORDER BY m.codmovconta`.execute(trx);
      await sql`UPDATE mov_contas_bancarias SET revertido = 'S' WHERE idlote = ${idlote}`.execute(trx);
      await trx.deleteFrom('caixa').where('idlotebxcartao', '=', idlote).execute(); // UConsCRTbx.pas:265
      return { idlote, itens: recs.length, contraMovimentos: Number(ins.numAffectedRows ?? 0) };
    });
  }
}
