import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;

/**
 * Os RECIBOS das baixas no layout do cliente — o "Documentos baixados com sucesso. Deseja fazer a emissão do recibo?" da baixa e o
 * "Recibo" da consulta de baixas: `Config\recibopagar.fr3` (UBaixaApagar.pas:851, UConsAPGbx.pas:429) e `Config\recibo.fr3`
 * (UBaixaAreceber.pas:1847, UconsRCBbx.pas:603). O `dbdRecibo` é o `cdsDoctoBX` (`SELECT * FROM GET_APAGARBX WHERE LOTE = :LOTE`, na
 * ordem do FORNECEDOR; `GET_ARECEBERBX … ORDER BY DATA_VENCEU`) e o `dbdEmpresa` a empresa do login; o a pagar leva VARIOS_FORNECEDORES.
 * O recibopagar de Config tem o diálogo "Layout de impressão" (Recibo × Lista de recibos), que a tela mostra antes de montar.
 */
@Injectable()
export class ReciboBaixaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o lote revertido lê a GET_APAGARBX_REVERTIDAS (`SetRevertido` da consulta); o lote vivo, a GET_APAGARBX */
  async reciboPagar(lote: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    let rows = (await sql<Record<string, unknown>>`SELECT * FROM get_apagarbx WHERE lote = ${lote} ORDER BY fornecedor`.execute(db)).rows;
    if (!rows.length) rows = (await sql<Record<string, unknown>>`SELECT * FROM get_apagarbx_revertidas WHERE lote = ${lote} ORDER BY fornecedor`.execute(db)).rows;
    if (!rows.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', { lote }, 'Nenhum título foi selecionado.');
    const nums = await colunasNumericas(db, ['apagar_bx', 'apagar'], ['registros', 'valor_pago', 'valor_documento', 'valor_bruto_documento', 'acres_desc', 'juros', 'lote',
      'codigo_fornecedor', 'idempresa', 'codigo_documento', 'codigo_documentobx', 'codigo_operadorbx', 'nr_parcela', 'tx_juros', 'acrescimo_desconto']);
    const varios = new Set(rows.map((r) => String(r.codigo_fornecedor ?? ''))).size > 1;
    return {
      titulo: `Recibo do lote ${lote}`,
      modelo: await modeloFr3(db, 'recibopagar.fr3', { pasta: 'Config' }),
      datasets: { dbdRecibo: rows.map((r) => registroFr3(r, nums)), dbdEmpresa: [await empresaParaRelatorio(db, this.emp())] },
      variaveis: { VARIOS_FORNECEDORES: textoVariavel(varios ? 'S' : 'N') },
    };
  }

  async reciboReceber(lote: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    let rows = (await sql<Record<string, unknown>>`SELECT * FROM get_areceberbx WHERE lote = ${lote} ORDER BY data_venceu`.execute(db)).rows;
    if (!rows.length) rows = (await sql<Record<string, unknown>>`SELECT * FROM get_areceberbx_revertidas WHERE lote = ${lote} ORDER BY data_venceu`.execute(db)).rows;
    if (!rows.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', { lote }, 'Nenhum título foi selecionado.');
    const nums = await colunasNumericas(db, ['areceber_bx', 'areceber'], ['valor_pago', 'valor_documento', 'valor_liquido', 'acres_desc', 'juros', 'lote', 'codigo_cliente',
      'idempresa', 'codigo_documento', 'codigo_documentobx', 'codigo_operadorbx', 'juro_calculado', 'tx_juros', 'vr_antecipacao', 'tx_antecipacao']);
    return {
      titulo: `Recibo do lote ${lote}`,
      modelo: await modeloFr3(db, 'recibo.fr3', { pasta: 'Config' }),
      datasets: { dbdRecibo: rows.map((r) => registroFr3(r, nums)), dbdEmpresa: [await empresaParaRelatorio(db, this.emp())] },
    };
  }

  /** o `cdsContaCorrente` das duas consultas (`sqqContaCorrente`, UdmBaixaApagar/UdmbaixaAreceber.dfm): o movimento bancário do lote */
  private async recursos(db: AnyDB, lote: number) {
    const rows = (await sql<Record<string, unknown>>`
      SELECT mov.codmovconta, mov.codconta, mov.valor, mov.dtemissao, mov.dtvenc, mov.nrodocumento, mov.liberado, mov.tipomovimento, mov.historico,
             mov.codopconta, mov.idlote, mov.idpgto, mov.dtliberacao, f.modalidade, op.descricao, c.nroconta, c.titular, c.codbco
        FROM mov_contas_bancarias mov
        LEFT JOIN operacoes_conta op  ON op.codopconta = mov.codopconta
        LEFT JOIN formas_pgto f       ON f.idpgto = mov.idpgto
        LEFT JOIN contas_bancarias c  ON c.codconta = mov.codconta
       WHERE mov.idlote = ${lote}
       ORDER BY mov.codmovconta`.execute(db)).rows;
    return rows.map((r) => registroFr3(r, new Set(['codmovconta', 'codconta', 'valor', 'codopconta', 'idlote', 'idpgto', 'codbco'])));
  }

  /**
   * O "Dados do pagamento" da consulta de baixas do a pagar (`MniDadosPagamentoClick`, UConsAPGbx.pas:415): `Relatorios\DadosPagamentoCP.fr3`
   * sobre os conjuntos que a consulta abriu para o lote — DbdTitulos (o `cdsDoctoBX`, GET_APAGARBX do lote; o revertido lê a
   * _REVERTIDAS), DbdRecursos (o movimento bancário), DbdChequesRepassados (CHEQUE_REP × CHEQUE do lote) e DbdChequesProprios
   * (CHQ_PROPRIO do lote com a razão), mais o DbdEmpresa. Na produção (05/10/2026) a CHEQUE_REP tem 0 linhas e nenhum CHQ_PROPRIO tem
   * lote: as duas seções de cheque saem vazias (a CHEQUE_REP nem veio para o destino).
   */
  async dadosPagamento(lote: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    let titulos = (await sql<Record<string, unknown>>`SELECT * FROM get_apagarbx WHERE lote = ${lote} ORDER BY codigo_documentobx`.execute(db)).rows;
    if (!titulos.length) titulos = (await sql<Record<string, unknown>>`SELECT * FROM get_apagarbx_revertidas WHERE lote = ${lote} ORDER BY codigo_documentobx`.execute(db)).rows;
    if (!titulos.length) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });
    const nums = await colunasNumericas(db, ['apagar_bx', 'apagar'], ['valor_pago', 'valor_documento', 'valor_bruto_documento', 'acres_desc', 'juros', 'lote',
      'codigo_fornecedor', 'idempresa', 'codigo_documento', 'codigo_documentobx', 'codigo_operadorbx', 'nr_parcela', 'tx_juros', 'acrescimo_desconto']);
    const proprios = (await sql<Record<string, unknown>>`
      SELECT c.*, p.razao FROM chq_proprio c LEFT JOIN parceiros p ON p.codparceiro = c.codparceiro WHERE c.idlote = ${lote} ORDER BY c.codchqproprio`.execute(db)).rows;
    return {
      titulo: `Dados do pagamento — lote ${lote}`,
      modelo: await modeloFr3(db, 'DadosPagamentoCP.fr3'),
      datasets: {
        DbdTitulos: titulos.map((r) => registroFr3(r, nums)),
        DbdRecursos: await this.recursos(db, lote),
        DbdChequesRepassados: [],
        DbdChequesProprios: proprios.map((r) => registroFr3(r, new Set(['codchqproprio', 'valor', 'nrocheque', 'codconta', 'codparceiro', 'idlote', 'idempresa']))),
        DbdEmpresa: [await empresaParaRelatorio(db, this.emp())],
      },
    };
  }

  /**
   * O "Dados do recebimento" da consulta de baixas do a receber (`MniDadosRecebimentoClick`, UconsRCBbx.pas:586): `DadosRecebimentoCR.fr3`
   * com DbdTitulos (GET_ARECEBERBX do lote, ORDER BY DATA_VENCEU), DbdRecursos, DbdChequesRepassados (os cheques recebidos na baixa —
   * CHEQUE.IDLOTEBXRCB, 10 na produção) e DbdPermutas (PERMUTAS do lote — 0 linhas na produção, a tabela não veio: sai vazia).
   */
  async dadosRecebimento(lote: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    let titulos = (await sql<Record<string, unknown>>`SELECT * FROM get_areceberbx WHERE lote = ${lote} ORDER BY data_venceu`.execute(db)).rows;
    if (!titulos.length) titulos = (await sql<Record<string, unknown>>`SELECT * FROM get_areceberbx_revertidas WHERE lote = ${lote} ORDER BY data_venceu`.execute(db)).rows;
    if (!titulos.length) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });
    const nums = await colunasNumericas(db, ['areceber_bx', 'areceber'], ['valor_pago', 'valor_documento', 'valor_liquido', 'acres_desc', 'juros', 'lote', 'codigo_cliente',
      'idempresa', 'codigo_documento', 'codigo_documentobx', 'codigo_operadorbx', 'juro_calculado', 'tx_juros', 'vr_antecipacao', 'tx_antecipacao']);
    const cheques = (await sql<Record<string, unknown>>`
      SELECT c.codchq, c.nrocheque, c.valor, c.titular, c.dtemissao, c.bompara, c.operador, c.codcx, c.codbco, c.codparceiro, c.nropedido, c.databaixa,
             c.codopbx, c.baixado, c.observacao, c.idempresa, c.liberado, c.qtdechq, c.idlote, c.idlotebxrcb, p.razao, b.banco, b.agencia, c.idpgto,
             f.modalidade, c.consiliado
        FROM cheque c
        LEFT JOIN parceiros p   ON p.codparceiro = c.codparceiro
        LEFT JOIN bancos b      ON b.codbco = c.codbco
        LEFT JOIN formas_pgto f ON f.idpgto = c.idpgto
       WHERE c.idlotebxrcb = ${lote}
       ORDER BY c.codchq`.execute(db)).rows;
    return {
      titulo: `Dados do recebimento — lote ${lote}`,
      modelo: await modeloFr3(db, 'DadosRecebimentoCR.fr3'),
      datasets: {
        DbdTitulos: titulos.map((r) => registroFr3(r, nums)),
        DbdRecursos: await this.recursos(db, lote),
        DbdChequesRepassados: cheques.map((r) => registroFr3(r, new Set(['codchq', 'valor', 'codbco', 'codparceiro', 'idempresa', 'qtdechq', 'idlote', 'idlotebxrcb', 'idpgto']))),
        DbdPermutas: [],
        DbdEmpresa: [await empresaParaRelatorio(db, this.emp())],
      },
    };
  }
}
