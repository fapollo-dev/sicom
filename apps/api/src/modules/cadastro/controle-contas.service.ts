import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { destinosPermitidos } from './contas-transf-perm.service';
import { configNaTrx } from '../compras/pedido-heranca';
import { estornarTransferenciaLote, integrarTransferencias } from '../cobranca/documentos-contabil.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** a data da movimentação é a EMISSÃO (a carga traz a do legado); o fechamento de caixa antigo só tinha DATA_FECHAMENTO */
const DATA_MOV = sql`coalesce(dtemissao, data_fechamento::date)`;
type ContaCompleta = { codconta: number; idempresa: number; nroconta: string | null; codbco: number; dtchaveamento: string | null };
/** o lote da transferência sai do mesmo `ID_IDLOTE` das baixas, cartão e fechamento (`GetID('IDLOTE')`) */
const novoLoteTransferencia = async (trx: AnyDB): Promise<number> =>
  Number((await sql<{ id: string }>`SELECT nextval('seq_idlote') AS id`.execute(trx)).rows[0].id);

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS). Movimentação da tesouraria (mov_contas_bancarias).
 * `saldo`/`extrato`: Σ com sinal (C:+ / D:−) do LIBERADO da conta, pela data de EMISSÃO. `lancar`: 1 linha (operação
 * C/D → tipomovimento, VALOR magnitude). `transferir`: as 2 pernas do legado (lote + NRODOCUMENTO 'TRANSFERENCIA'),
 * destino em qualquer loja. `estornar`: a remoção de transferência (o lote inteiro) ou a exclusão da movimentação
 * sem lote, como as duas telas do legado. Saldo-negativo travado só na transferência a partir de conta CAIXA.
 */
@Injectable()
export class ControleContasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** confirma que a conta é da empresa e devolve codbco (0 = CAIXA, trava saldo negativo). */
  private async conta(db: AnyDB, codconta: number, emp: number): Promise<{ codbco: number }> {
    const c = (await db.selectFrom('contas_bancarias').select(['codconta', 'codbco']).where('codconta', '=', codconta).where('idempresa', '=', emp).executeTakeFirst()) as { codbco?: number } | undefined;
    if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta });
    // codbco null → −1 (NÃO tratar como CAIXA/0; fold auditoria nit). CAIXA = codbco 0 (trava saldo negativo).
    return { codbco: c.codbco == null ? -1 : Number(c.codbco) };
  }

  /** saldo (Σ com sinal) da conta. `ateData` (opcional) = saldo ATÉ a data (âncora do extrato com filtro). */
  private async saldoDe(db: AnyDB, codconta: number, emp: number, ateData?: string): Promise<number> {
    let q = db
      .selectFrom('mov_contas_bancarias')
      .select(sql`coalesce(sum(case when tipomovimento='D' then -valor else valor end),0)`.as('saldo'))
      .where('codconta', '=', codconta)
      .where('idempresa', '=', emp)
      // o saldo do legado conta só o LIBERADO (mig 297); N e nulo são "a prazo", à parte
      .where(sql`coalesce(liberado, 'N')`, '=', 'S');
    if (ateData) q = q.where(DATA_MOV, '<=', ateData);
    const r = (await q.executeTakeFirst()) as { saldo?: unknown } | undefined;
    return r2(num(r?.saldo));
  }

  /** operações manuais disponíveis (catálogo C/D, exclui a 0=TRANSFERENCIA interna). */
  async operacoes(): Promise<Array<{ codopconta: number; descricao: string; tipo: string }>> {
    return (await (this.dbp.forTenantRead() as AnyDB).selectFrom('operacoes_conta').select(['codopconta', 'descricao', 'tipo']).where('codopconta', '>', 0).orderBy('descricao').execute()) as Array<{ codopconta: number; descricao: string; tipo: string }>;
  }

  /** saldo da conta (com totais de entrada/saída). */
  async saldo(codconta: number): Promise<{ codconta: number; saldo: number; entradas: number; saidas: number; a_prazo: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, codconta, emp);
    // como o legado (udmControleContasBancarias.dfm:765): entradas, saídas e saldo só do LIBERADO; o que não
    // está liberado (N ou nulo) vira o TOTAL A PRAZO, mostrado à parte — mig 297
    const r = (await db
      .selectFrom('mov_contas_bancarias')
      .select([
        sql`coalesce(sum(case when coalesce(liberado,'N')='S' and tipomovimento='C' then valor else 0 end),0)`.as('entradas'),
        sql`coalesce(sum(case when coalesce(liberado,'N')='S' and tipomovimento='D' then valor else 0 end),0)`.as('saidas'),
        sql`coalesce(sum(case when coalesce(liberado,'N')<>'S' then (case when tipomovimento='D' then -valor else valor end) else 0 end),0)`.as('a_prazo'),
      ])
      .where('codconta', '=', codconta)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { entradas?: unknown; saidas?: unknown; a_prazo?: unknown };
    const entradas = r2(num(r?.entradas));
    const saidas = r2(num(r?.saidas));
    return { codconta, saldo: r2(entradas - saidas), entradas, saidas, a_prazo: r2(num(r?.a_prazo)) };
  }

  /** extrato: movimentos da conta (mais recentes primeiro, até 5000) + saldo corrente por linha. O header usa o
   *  saldo VERDADEIRO (Σ ALL — fold auditoria [MÉDIA]: antes o header vinha do Σ das 5000 mais ANTIGAS → errado numa
   *  conta com >5000 mov.). O saldo corrente é ancorado no saldo até dtfim (após o mais recente exibido) e desce. */
  async extrato(codconta: number, dtini?: string, dtfim?: string): Promise<{ codconta: number; saldo: number; movimentos: Record<string, unknown>[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, codconta, emp);
    const saldoAtual = await this.saldoDe(db, codconta, emp); // Σ ALL = saldo corrente real (header)
    const ancora = dtfim ? await this.saldoDe(db, codconta, emp, dtfim) : saldoAtual; // saldo após o mais recente do recorte
    let q = db
      .selectFrom('mov_contas_bancarias')
      .select(['codmovconta', 'valor', 'tipomovimento', 'codopconta', 'historico', 'origem', 'idorigem', 'data_fechamento', 'mov_conciliado', 'liberado', 'nrodocumento', 'idlote', 'contabilizado', sql<string>`to_char(${DATA_MOV}, 'YYYY-MM-DD')`.as('dtemissao')])
      .where('codconta', '=', codconta)
      .where('idempresa', '=', emp);
    if (dtini) q = q.where(DATA_MOV, '>=', dtini);
    if (dtfim) q = q.where(DATA_MOV, '<=', dtfim);
    // mais recentes primeiro (limita aos 5000 últimos, não aos primeiros).
    const rows = (await q.orderBy(DATA_MOV, 'desc').orderBy('codmovconta', 'desc').limit(5000).execute()) as Record<string, unknown>[];
    // saldo corrente: da linha mais nova (após ela = âncora) descendo p/ as mais antigas.
    let running = ancora;
    const movimentos = rows.map((m) => {
      const delta = String(m.tipomovimento) === 'D' ? -num(m.valor) : num(m.valor);
      // o que está a prazo aparece no extrato mas não mexe no saldo — a âncora (saldoDe) também não o conta
      const liberado = String(m.liberado ?? 'N') === 'S';
      const linha = { ...m, valor_com_sinal: r2(delta), a_prazo: !liberado, saldo_corrente: r2(running) };
      if (!liberado) return linha;
      running = r2(running - delta); // saldo ANTES desta linha = saldo APÓS a próxima (mais antiga)
      return linha;
    });
    return { codconta, saldo: saldoAtual, movimentos };
  }

  /** lançamento MANUAL (1 linha). A operação define o tipomovimento (C/D); VALOR gravado como magnitude. Sem teste de
   *  saldo: o lançamento do legado chama `ValidaSaldoAnterior(..., VerifSaldo=False)` (`UlancamentoSaldo.pas:54`) e o
   *  cadastro de movimentação não testa (`uCadMovContasBancarias.pas:115-131`). Com operação, LIBERADO 'S' na data. */
  async lancar(dto: { codconta: number; codopconta: number; valor: number; historico?: string; idpgto?: number; data?: string }): Promise<{ codmovconta: number; tipomovimento: string; saldo: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.conta(trx, dto.codconta, emp);
      const oc = (await trx.selectFrom('operacoes_conta').select(['codopconta', 'tipo']).where('codopconta', '=', dto.codopconta).where('codopconta', '>', 0).executeTakeFirst()) as { tipo?: string } | undefined;
      if (!oc) throw new BusinessRuleError('OPERACAO_NAO_ENCONTRADA', { codopconta: dto.codopconta });
      const tipo = String(oc.tipo) === 'D' ? 'D' : 'C';
      const valor = r2(num(dto.valor));
      const data = dto.data ? dto.data.slice(0, 10) : hoje();
      const ins = (await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa: emp, valor, tipomovimento: tipo, codopconta: dto.codopconta, origem: null, idorigem: null,
        historico: dto.historico ?? null, idpgto: dto.idpgto ?? null, codoperador: op, dtcadastro: sql`now()`,
        dtemissao: data, dtvenc: data, liberado: 'S', dtliberacao: data,
      }).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      return { codmovconta: Number(ins.codmovconta), tipomovimento: tipo, saldo: await this.saldoDe(trx, dto.codconta, emp) };
    });
  }

  /**
   * TRANSFERÊNCIA — `TfrmTransferencia.btnFechaClick` + `Transfere` (`Utransferencia.pas:118-330`). Duas movimentações
   * com o MESMO lote (`GetID('IDLOTE')`), `NRODOCUMENTO='TRANSFERENCIA'`, emissão/vencimento/liberação na data,
   * LIBERADO 'S', operação 0, a modalidade de cada lado (`IDPGTO`). É pelo NRODOCUMENTO + lote que a integração
   * contábil (origem 19) e a remoção reconhecem a transferência.
   *
   * A conta de ORIGEM é da loja (`btnBuscaCCClick`: `IDEMPRESA = empresa`); a de DESTINO é qualquer conta
   * (`SpeedButton1Click` sem filtro) — 477 dos lotes de 2025-26 foram para conta de outra loja. Cada perna fica na
   * empresa da sua conta, como a carga faz com o dado migrado.
   *
   * O histórico segue o que o binário novo grava (o fonte de 2020 dizia ORIGEM na perna de crédito; o dado de
   * produção diz DESTINO nas duas, 475 de 476): `TRANSF. CONTA DESTINO: <nº da outra conta>` + o complemento +
   * `\r\n Lote: N` + `\r\nRealizada pelo(a) usuário(a) NOME.`. O CODOPERADOR fica nulo, como no legado.
   */
  async transferir(dto: { codorigem: number; coddestino: number; valor: number; historico?: string; data?: string; idpgtoOrigem?: number; idpgtoDestino?: number }): Promise<{ idlote: number; debito: number; credito: number; contabilizada: boolean }> {
    const emp = this.emp();
    const op = this.op();
    // "A conta de destino deve ser diferente da conta de origem." (`Utransferencia.pas:151`)
    if (dto.codorigem === dto.coddestino) throw new BusinessRuleError('TRANSFERENCIA_MESMA_CONTA', { conta: dto.codorigem });
    const res = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const orig = await this.contaCompleta(trx, dto.codorigem, emp);
      const dest = await this.contaCompleta(trx, dto.coddestino, null);
      // a matriz de transferências permitidas (mig 295): origem com linhas ativas só vai para os destinos listados
      const permitidos = await destinosPermitidos(trx, dto.codorigem);
      if (permitidos && !permitidos.includes(dto.coddestino)) {
        throw new BusinessRuleError('TRANSFERENCIA_NAO_PERMITIDA', { origem: dto.codorigem, destino: dto.coddestino, permitidos });
      }
      // NAO_PERMITIDO_ALTERAR_DATA_TRANSF_MOV_CONTAS_BANCARIAS (por usuário) desabilita a data: vale o dia
      const travaData = await configNaTrx(trx, 'NAO_PERMITIDO_ALTERAR_DATA_TRANSF_MOV_CONTAS_BANCARIAS', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' });
      const data = travaData === 'S' || !dto.data ? hoje() : dto.data.slice(0, 10);
      // "Caixa FECHADO não é permitida alteração dos documentos!" — o chaveamento de cada conta (`:156-183`)
      for (const c of [orig, dest]) {
        if (c.dtchaveamento && data <= c.dtchaveamento) throw new BusinessRuleError('CONTA_CAIXA_FECHADA', { codconta: c.codconta, ate: c.dtchaveamento });
      }
      const valor = r2(num(dto.valor));
      // "Saldo insuficiente!" — só com a origem em conta caixa (`:185-190`)
      if (orig.codbco === 0) {
        const saldo = await this.saldoDe(trx, dto.codorigem, emp);
        if (r2(saldo - valor) < 0) throw new BusinessRuleError('SALDO_INSUFICIENTE', { codconta: dto.codorigem, saldo, valor });
      }
      const idpgtoOrigem = dto.idpgtoOrigem ?? (await this.idpgtoDinheiro(trx, emp));
      const idpgtoDestino = dto.idpgtoDestino ?? idpgtoOrigem;
      const lote = await novoLoteTransferencia(trx);
      const nome = op == null ? '' : String((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst() as { nome?: string } | undefined)?.nome ?? '');
      const complemento = (dto.historico ?? '').trim();
      const historico = (outra: string | null) =>
        `TRANSF. CONTA DESTINO: ${outra ?? ''}${complemento ? ' ' + complemento : ''}\r\n Lote: ${lote}\r\nRealizada pelo(a) usuário(a) ${nome}.`.slice(0, 300);
      const perna = (c: ContaCompleta, tipo: 'D' | 'C', outra: ContaCompleta, idpgto: number | null) => ({
        codconta: c.codconta, idempresa: c.idempresa, valor, tipomovimento: tipo, codopconta: 0, idpgto,
        nrodocumento: 'TRANSFERENCIA', idlote: lote, historico: historico(outra.nroconta),
        dtemissao: data, dtvenc: data, liberado: 'S', dtliberacao: data, dtcadastro: sql`now()`,
      });
      const deb = (await trx.insertInto('mov_contas_bancarias').values(perna(orig, 'D', dest, idpgtoOrigem)).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      const cre = (await trx.insertInto('mov_contas_bancarias').values(perna(dest, 'C', orig, idpgtoDestino)).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      return { idlote: lote, debito: Number(deb.codmovconta), credito: Number(cre.codmovconta) };
    });
    // com a integração AUTOMÁTICA, contabiliza o lote depois de gravar — e o erro não desfaz a transferência
    // (`IntegraTransferencia`, `:258` e `:476-488`, dentro de try/except vazio)
    const contabilizada = await this.integrarTransferencia(emp, res.idlote);
    return { ...res, contabilizada };
  }

  /**
   * REMOVER — dois caminhos do legado, pela linha escolhida:
   * - transferência (`NRODOCUMENTO='TRANSFERENCIA'`, `Removertransferencia1Click`, `UconsMovBancaria.pas:925-966`): se
   *   contabilizada, com a integração AUTOMÁTICA estorna o razão do lote e segue; sem ela, "A transferência já foi
   *   contabilizada.". Apaga TODAS as movimentações do lote (`DELETE ... WHERE IDLOTE`), inclusive a perna na conta
   *   de outra loja. Não olha conciliação.
   * - qualquer outra (`TfrmCadMovContasBancarias.btnExcluirClick`, `uCadMovContasBancarias.pas:107-111`): só barra a que
   *   tem lote ("Esse documento não pode ser excluido, pois contém referencia de Lote. Verifique!").
   */
  async estornar(codmovconta: number): Promise<{ codmovconta: number; removidos: number; transferencia: boolean }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const m = (await trx.selectFrom('mov_contas_bancarias').select(['codmovconta', 'nrodocumento', 'idlote', 'contabilizado']).where('codmovconta', '=', codmovconta).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as { nrodocumento?: string | null; idlote?: number | null; contabilizado?: string | null } | undefined;
      if (!m) throw new BusinessRuleError('MOVIMENTO_NAO_ENCONTRADO', { codmovconta });
      const idlote = num(m.idlote);
      if (String(m.nrodocumento ?? '') === 'TRANSFERENCIA' && idlote > 0) {
        await trx.selectFrom('mov_contas_bancarias').select('codmovconta').where('idlote', '=', idlote).forUpdate().execute();
        if (String(m.contabilizado ?? '') === 'S') {
          const e = (await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst()) as { integracao?: string | null } | undefined;
          if (String(e?.integracao ?? '') !== 'AUTOMATICA') throw new BusinessRuleError('TRANSFERENCIA_CONTABILIZADA', { idlote });
          await estornarTransferenciaLote(trx, idlote);
        }
        const res = await trx.deleteFrom('mov_contas_bancarias').where('idlote', '=', idlote).executeTakeFirst();
        return { codmovconta, removidos: Number((res as any)?.numDeletedRows ?? 0), transferencia: true };
      }
      if (idlote > 0) throw new BusinessRuleError('MOVIMENTO_COM_LOTE', { codmovconta, idlote });
      const res = await trx.deleteFrom('mov_contas_bancarias').where('codmovconta', '=', codmovconta).where('idempresa', '=', emp).executeTakeFirst();
      return { codmovconta, removidos: Number((res as any)?.numDeletedRows ?? 0), transferencia: false };
    });
  }

  /** a conta com o que a transferência usa; `emp` nulo = qualquer loja (o destino) */
  private async contaCompleta(db: AnyDB, codconta: number, emp: number | null): Promise<ContaCompleta> {
    let q = db.selectFrom('contas_bancarias').select(['codconta', 'codbco', 'idempresa', 'nroconta', sql<string | null>`to_char(dtchaveamento, 'YYYY-MM-DD')`.as('dtchaveamento')]).where('codconta', '=', codconta);
    if (emp != null) q = q.where('idempresa', '=', emp);
    const c = (await q.executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta });
    return {
      codconta, idempresa: Number(c.idempresa), nroconta: c.nroconta == null ? null : String(c.nroconta).trim(),
      codbco: c.codbco == null ? -1 : Number(c.codbco), dtchaveamento: c.dtchaveamento == null ? null : String(c.dtchaveamento),
    };
  }

  /** a forma DINHEIRO da loja — o que o legado posiciona antes de gravar (`cdsFormaPto.Locate('MODALIDADE','DINHEIRO')`) */
  private async idpgtoDinheiro(db: AnyDB, emp: number): Promise<number | null> {
    const f = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE upper(modalidade) = 'DINHEIRO'
                ORDER BY (idempresa = ${emp}) DESC NULLS LAST, idpgto LIMIT 1`.execute(db)).rows[0];
    return f ? Number(f.idpgto) : null;
  }

  private async integrarTransferencia(emp: number, idlote: number): Promise<boolean> {
    const db = this.dbp.forTenant() as AnyDB;
    try {
      const e = (await db.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst()) as { integracao?: string | null } | undefined;
      if (String(e?.integracao ?? '') !== 'AUTOMATICA') return false;
      return await db.transaction().execute(async (trx: AnyDB) => {
        const cfg = (await trx.selectFrom('config_integracao_contabil').selectAll().executeTakeFirst()) as Record<string, number | null> | undefined;
        if (!cfg) return false;
        const r = await integrarTransferencias(trx, emp, { dataIni: '1900-01-01', dataFim: '2999-12-31', codigo: idlote }, cfg);
        return r.lancamentos > 0;
      });
    } catch {
      return false;
    }
  }
}
