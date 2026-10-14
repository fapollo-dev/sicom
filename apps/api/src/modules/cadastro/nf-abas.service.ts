/**
 * As abas da NF que só olham (ou guardam) o que se liga à nota — a auditoria controle a controle do uNF.dfm (14/10/2026):
 *  - "Formas de pagamento" (Financeiro): a NF_FORMA_PAGAMENTO — a importada traz as do XML (RecebimentoService); o operador inclui e
 *    exclui pela sub-aba (btnAdicionarFormaPgto/btnGravarFormaPgto/btnExcluirFormaPgto, uNF.pas:3232/5365/4324);
 *  - "Pedidos": o pedido de compra da nota (cdsComView, udmNF.dfm:18219 — aqui pelo CODPEDCOMP da nota, o vínculo vivo; o PEDIDO_NF do
 *    legado só tem scrap) e os pedidos de venda do PEDIDO_NF tipo 'P' (qryPedidos, udmNF.dfm:7277 — 1 em 2022);
 *  - "Devoluções da Compra": os pedidos de devolução feitos a partir desta entrada (sqqPedidosDevCompra, udmNF.dfm:17907);
 *  - "Carta Correção": as CC-e da chave (NFE_EVENTOS 110110 — a NF_CARTA_CORRECAO do legado tem 3 linhas, a última de 2023).
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { NfFormaPagamentoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';

type AnyDB = any;
type Linha = Record<string, unknown>;
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

@Injectable()
export class NfAbasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  /** a nota, nas lojas do operador (como as demais rotas da NF) */
  private async nota(db: AnyDB, codnf: number): Promise<Linha> {
    const lojas = await empresasDoOperador(db, null);
    const nf = (await db.selectFrom('nf').select(['codnf', 'idempresa', 'tipo', 'totalnf', 'chavenfe', 'codpedcomp', 'proc', 'contabilizado', 'cancelada', 'statusnfe'])
      .where('codnf', '=', codnf).where('idempresa', 'in', lojas.length ? lojas : [-1]).executeTakeFirst()) as Linha | undefined;
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    return nf;
  }

  /** as travas do btnEditar (uNF.pas:3905): a forma só entra/sai com a nota editável */
  private travas(nf: Linha): void {
    if (nf.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA');
    if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA');
    if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA');
    if (nf.statusnfe === 'P' || nf.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA');
  }

  async formasPagamento(codnf: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = await this.nota(db, codnf);
    const linhas = (await sql`
      SELECT fp.codnforpgto, fp.idpgto, f.modalidade, f.destino, fp.vrpgto, fp.vrtroco, fp.integrado, fp.codoperadoras, o.operadora, fp.numero_aut,
             fp.codoperador, fp.dtcadastro
        FROM nf_forma_pagamento fp
        LEFT JOIN formas_pgto f ON f.idpgto = fp.idpgto
        LEFT JOIN operadoras o ON o.codoperadoras = fp.codoperadoras
       WHERE fp.codnf = ${codnf}
       ORDER BY fp.codnforpgto`.execute(db)).rows as Linha[];
    // a Pesquisa GET_FORMAS_PGTO da loja da nota (btnFormaPagtoClick) e a GET_OPERADORAS ativas (btnOperadoraClick)
    const formas = (await db.selectFrom('formas_pgto').select(['idpgto', 'modalidade', 'destino']).where('idempresa', '=', Number(nf.idempresa))
      .where((eb: any) => eb.or([eb('inativo', 'is', null), eb('inativo', '<>', 'S')])).orderBy('modalidade').execute()) as Linha[];
    const operadoras = (await db.selectFrom('operadoras').select(['codoperadoras', 'operadora']).where('ativo', '=', 'S').orderBy('operadora').execute()) as Linha[];
    const totalPago = linhas.reduce((s, l) => s + num(l.vrpgto), 0);
    return { codnf, totalnf: num(nf.totalnf), totalPago: Math.round(totalPago * 100) / 100, linhas, formas, operadoras };
  }

  async adicionarFormaPagamento(codnf: number, dto: NfFormaPagamentoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await this.nota(trx, codnf);
      this.travas(nf);
      if (!(num(dto.idpgto) > 0)) throw new BusinessRuleError('NF_FORMA_PGTO_OBRIGATORIA');
      const forma = (await trx.selectFrom('formas_pgto').select(['idpgto', 'destino']).where('idpgto', '=', Number(dto.idpgto))
        .where('idempresa', '=', Number(nf.idempresa)).executeTakeFirst()) as Linha | undefined;
      if (!forma) throw new BusinessRuleError('NF_FORMA_PGTO_INEXISTENTE');
      const destino = String(forma.destino ?? '').trim().toUpperCase();
      // a operadora: obrigatória no TEF/CRT; só se informa no POS/TEF/CRT (LiberarCamposOperadora, uNF.pas:17770)
      const comOperadora = ['POS', 'TEF', 'CRT'].includes(destino);
      if ((destino === 'TEF' || destino === 'CRT') && !(num(dto.codoperadoras) > 0)) throw new BusinessRuleError('NF_FORMA_PGTO_OPERADORA');
      if (num(dto.vrpgto) === 0) throw new BusinessRuleError('NF_FORMA_PGTO_VALOR');
      if (dto.integrado !== 'S' && dto.integrado !== 'N') throw new BusinessRuleError('NF_FORMA_PGTO_INTEGRACAO');
      if (dto.integrado === 'S' && !String(dto.numero_aut ?? '').trim()) throw new BusinessRuleError('NF_FORMA_PGTO_AUTORIZACAO');
      const r = (await trx.insertInto('nf_forma_pagamento').values({
        codnf, idempresa: Number(nf.idempresa), idpgto: Number(dto.idpgto), vrpgto: num(dto.vrpgto), vrtroco: num(dto.vrtroco), integrado: dto.integrado,
        codoperadoras: comOperadora && num(dto.codoperadoras) > 0 ? Number(dto.codoperadoras) : null,
        numero_aut: String(dto.numero_aut ?? '').trim() || null, codoperador: currentTenant().operadorId ?? null, dtcadastro: sql`now()`,
      }).returning('codnforpgto').executeTakeFirst()) as { codnforpgto: number };
      return { codnforpgto: Number(r.codnforpgto) };
    });
  }

  async excluirFormaPagamento(codnf: number, codnforpgto: number) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await this.nota(trx, codnf);
      this.travas(nf);
      const r = await trx.deleteFrom('nf_forma_pagamento').where('codnf', '=', codnf).where('codnforpgto', '=', codnforpgto).executeTakeFirst();
      if (!Number(r?.numDeletedRows ?? 0)) throw new BusinessRuleError('NF_FORMA_PGTO_NAO_ENCONTRADA');
      return { codnforpgto };
    });
  }

  async pedidos(codnf: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = await this.nota(db, codnf);
    const compra = num(nf.codpedcomp) > 0 ? (await sql`
      SELECT p.codpedcomp, p.data::date AS data, c.razao AS titular, p.obs,
             round(sum(coalesce(q.qtde, 0) * coalesce(i.vrvenda, 0))::numeric, 2) AS total_bruto,
             round(sum(coalesce(q.qtde, 0) * coalesce(i.vendaliq, 0))::numeric, 2) AS total_pedido
        FROM pedidocompra p
        JOIN pedidocompra_i i ON i.codpedcomp = p.codpedcomp
        JOIN parceiros c ON c.codparceiro = p.codparceiro
        LEFT JOIN pedido_compra_qtde q ON q.codpedcompi = i.codpedcompi AND q.idempresa = ${Number(nf.idempresa)}
       WHERE p.codpedcomp = ${Number(nf.codpedcomp)}
       GROUP BY p.codpedcomp, p.data::date, c.razao, p.obs`.execute(db)).rows : [];
    const venda = (await sql`
      SELECT pn.codpedido, d.nropedido, d.idempresa,
             round((sum((coalesce(d.vrvenda, 0) - coalesce(d.desc_acre_item, 0)) * coalesce(d.qtde, 0)) - avg(coalesce(d.desc_acre, 0)))::numeric, 2) AS total_pedido,
             round(sum(coalesce(d.desc_acre_item, 0) * coalesce(d.qtde, 0) + coalesce(d.desc_acre, 0))::numeric, 2) AS desconto,
             round(sum(coalesce(d.vrvenda, 0) * coalesce(d.qtde, 0))::numeric, 2) AS total_bruto,
             min(d.dtvenda)::date AS dtvenda, max(d.codvendedor) AS codvendedor, max(c.razao) AS titular, max(v.razao) AS vendedor, max(d.obs) AS obs
        FROM pedido_nf pn
        LEFT JOIN pedidos d ON d.codpedidos = pn.codpedido
        LEFT JOIN parceiros c ON c.codparceiro = d.codparceiro
        LEFT JOIN parceiros v ON v.codparceiro = d.codvendedor
       WHERE pn.codnf = ${codnf} AND pn.tipo = 'P'
       GROUP BY pn.codpedido, d.nropedido, d.idempresa
       ORDER BY pn.codpedido`.execute(db)).rows;
    return { codnf, compra, venda };
  }

  async devolucoesCompra(codnf: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.nota(db, codnf);
    const linhas = (await sql`
      SELECT p.codpeddevcompra AS cod_pedido_dev_compra, p.data::date AS data_pedido, p.status, p.codnf_emitida AS cod_nota_fiscal_emitida,
             n.nronf, n.chavenfe, n.dtemissao::date AS dtemissao
        FROM pedido_devolucao_compra p
        JOIN pedido_devolucao_compra_i i ON i.codpeddevcompra = p.codpeddevcompra
        LEFT JOIN nf n ON n.codnf = p.codnf_emitida
       WHERE i.codnf = ${codnf} AND p.status <> 'CANCELADO' AND coalesce(p.indr, 'I') <> 'E'
       GROUP BY p.codpeddevcompra, p.data::date, p.status, p.codnf_emitida, n.nronf, n.chavenfe, n.dtemissao::date
       ORDER BY p.codpeddevcompra DESC`.execute(db)).rows;
    return { codnf, linhas };
  }

  async cartasCorrecao(codnf: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = await this.nota(db, codnf);
    const chave = String(nf.chavenfe ?? '').trim();
    const linhas = chave ? (await db.selectFrom('nfe_eventos')
      .select(['codnfe_evento', 'seq_evento', 'protocolo_autorizacao', 'data_evento', 'data_autorizacao', 'mensagem_autorizacao', 'correcao'])
      .where('chave_acesso', '=', chave).where('tipo_evento', '=', 110110).orderBy('seq_evento').execute()) as Linha[] : [];
    return { codnf, chavenfe: chave || null, linhas };
  }
}
