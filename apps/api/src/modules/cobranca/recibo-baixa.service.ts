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
}
