import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';
import { LiberacaoService } from '../auth/liberacao.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** divergência detectada no cruzamento NF×pedido. */
export interface Divergencia {
  idproduto: number;
  descricao: string | null;
  // PRECO = custo fora da tolerância; INE_PEDIDO = item da NF fora do pedido; QUANTIDADE = recebido a MAIS (saldo < 0)
  tipo: 'PRECO' | 'INE_PEDIDO' | 'QUANTIDADE';
  custoPedido: number;
  custoNf: number;
  saldo?: number; // só na QUANTIDADE (negativo = recebeu a mais que o pedido)
}

/** linha de saldo por produto do pedido (qtd pedida − Σ recebida nas NFs vinculadas). */
export interface SaldoItem {
  idproduto: number;
  descricao: string | null;
  qtdPedido: number;
  qtdRecebida: number;
  saldo: number; // pode ser negativo (recebeu a MAIS = divergência, tratada na Análise/corte-2)
}

/**
 * ANÁLISE PEDIDO × NF — corte-1: SALDO do pedido de compra recebido em VÁRIAS NFs (1:N). Fiel à query de saldo do
 * legado (udmNF.dfm:17495, FDqSaldoPedidoCompra) adaptada ao modelo single-empresa do monorepo (a 078 achatou o
 * neto PEDIDO_COMPRA_QTDE em pedidocompra_i.qtdtotal):
 *
 *   qtd_pedido(produto)   = Σ pedidocompra_i.qtdtotal do produto no pedido
 *   qtd_recebida(produto) = Σ (nf_prod.quantidade × nf_prod.fatorembal) das NFs vinculadas (nf.codpedcomp),
 *                           correlacionadas POR PRODUTO (nf_prod.codproduto = pedidocompra_i.idproduto)
 *   saldo                 = qtd_pedido − qtd_recebida
 *
 * Correlação por PRODUTO (decisão de tenant, fiel ao legado — NF_PROD não tem CODPEDCOMPI). Conta TODAS as NFs
 * vinculadas não-estornadas; o filtro por status de liberação (STATUS_PEDCOMP) entra no corte-2 (Análise). Tenant
 * `idempresa` fail-closed. READ-ONLY.
 */
@Injectable()
export class AnalisePedidoNfService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
    private readonly liberacao: LiberacaoService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** garante que o pedido existe no tenant (fail-closed) e devolve seus metadados básicos. */
  private async carregarPedido(db: AnyDB, codpedcomp: number, emp: number): Promise<{ codpedcomp: number; fechado?: string; codparceiro?: number }> {
    const p = (await db
      .selectFrom('pedidocompra')
      .select(['codpedcomp', 'fechado', 'codparceiro'])
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codpedcomp: number; fechado?: string; codparceiro?: number } | undefined;
    if (!p) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
    return p;
  }

  /** saldo por produto do pedido. Lança PEDIDO_NAO_ENCONTRADO se fora do tenant. */
  async saldo(codpedcomp: number): Promise<{ codpedcomp: number; itens: SaldoItem[]; saldoTotal: number; totalmenteRecebido: boolean }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.carregarPedido(db, codpedcomp, emp);

    // qtd pedida por produto (Σ qtdtotal) + qtd recebida (subquery correlacionada por produto sobre as NFs
    // vinculadas não-estornadas). fatorembal default 1 (a NF de entrada usa fatorembal=1 pois quantidade já é
    // a qtde em unidades — mesma convenção do gerarNf/import). SQL raw (uma query): o vínculo NF↔pedido é por
    // PRODUTO (nf_prod.codproduto = pedidocompra_i.idproduto), fiel ao legado (udmNF.dfm:17495).
    const rows = (
      await sql<{ idproduto: number; descricao: string | null; qtd_pedido: unknown; qtd_recebida: unknown }>`
        select i.idproduto as idproduto,
               o.descricao as descricao,
               sum(coalesce(i.qtdtotal, i.fatorembalagem, 0)) as qtd_pedido,
               coalesce((
                 select sum(np.quantidade * coalesce(np.fatorembal, 1))
                 from nf_prod np
                 join nf n on n.codnf = np.codnf
                 where n.codpedcomp = ${codpedcomp} and n.idempresa = ${emp}
                   and coalesce(n.cancelada, 'N') <> 'S' and coalesce(n.statusnfe, '') <> 'C'
                   and np.codproduto = i.idproduto
               ), 0) as qtd_recebida
        from pedidocompra_i i
        left join produtos o on o.idproduto = i.idproduto
        where i.codpedcomp = ${codpedcomp}
        group by i.idproduto, o.descricao
        order by i.idproduto
      `.execute(db)
    ).rows;

    const itens: SaldoItem[] = rows.map((r) => {
      const qtdPedido = r3(num(r.qtd_pedido));
      const qtdRecebida = r3(num(r.qtd_recebida));
      return { idproduto: Number(r.idproduto), descricao: r.descricao ?? null, qtdPedido, qtdRecebida, saldo: r3(qtdPedido - qtdRecebida) };
    });
    const saldoTotal = r3(itens.reduce((s, it) => s + it.saldo, 0));
    // totalmente recebido = nenhum item com saldo > 0 (saldo ≤ 0 em todos; negativo = recebeu a mais).
    const totalmenteRecebido = itens.length > 0 && itens.every((it) => it.saldo <= 0);
    return { codpedcomp, itens, saldoTotal, totalmenteRecebido };
  }

  /** carrega a NF vinculada a um pedido (fail-closed no tenant); exige codpedcomp; recusa NF cancelada/rejeitada
   *  (fold auditoria — consistente com o saldo, que já exclui cancelada='S'/statusnfe='C'). */
  private async carregarNfVinculada(db: AnyDB, codnf: number, emp: number): Promise<{ codnf: number; codpedcomp: number }> {
    const nf = (await db
      .selectFrom('nf')
      .select(['codnf', 'codpedcomp', 'cancelada', 'statusnfe'])
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { codnf: number; codpedcomp?: number | null; cancelada?: string | null; statusnfe?: string | null } | undefined;
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    if ((nf.cancelada ?? 'N') === 'S' || (nf.statusnfe ?? '') === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
    if (nf.codpedcomp == null) throw new BusinessRuleError('NF_SEM_PEDIDO', { codnf });
    return { codnf, codpedcomp: Number(nf.codpedcomp) };
  }

  /**
   * DIVERGÊNCIAS do cruzamento NF×pedido (fiel a UanalisaPedComp_NF.Analisar). Por PRODUTO: (a) PRECO — custo unitário
   * da NF fora da faixa do custo do pedido; a faixa é montada em torno do valor da NF (fiel ao legado:
   * `custoPed < NF−NF·var OR custoPed > NF+NF·var` ⇒ `|custoPed−NF|/NF > var`), VARIACAO_CUSTO_PEDIDO_NF% (0 =
   * qualquer diferença); (b) INE_PEDIDO — item da NF fora do pedido; (c) QUANTIDADE — recebeu a MAIS que o pedido
   * (saldo < 0; fecha a promessa do corte-1 de tratar over-receipt como divergência aqui). Comparação SEMPRE por
   * UNIDADE (a NF de entrada é unit-based, fatorembal=1) — VERIFICA_VR_UN_OU_EMBALAGEM é lido mas 'E' equivale ao
   * unitário (divergência CONSCIENTE — a NF não é pack-based). Deduplicado por produto (fiel ao cdsDiv.Locate).
   */
  async divergencias(codnf: number): Promise<{ codnf: number; codpedcomp: number; divergencias: Divergencia[]; temDivergencia: boolean }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenantRead() as AnyDB;
    const { codpedcomp } = await this.carregarNfVinculada(db, codnf, emp);

    const variacao = num(await this.config.resolver('VARIACAO_CUSTO_PEDIDO_NF', { empresaId: emp, operadorId: op })) / 100; // fração

    // custo unitário da NF por produto (dedup: 1ª linha do produto em ordem estável por nroitem).
    const itensNf = (await db
      .selectFrom('nf_prod')
      .select(['codproduto', 'vrcusto'])
      .where('codnf', '=', codnf)
      .orderBy('nroitem')
      .execute()) as Array<{ codproduto: number; vrcusto: unknown }>;
    const custoNfMap = new Map<number, number>();
    for (const it of itensNf) if (!custoNfMap.has(Number(it.codproduto))) custoNfMap.set(Number(it.codproduto), r2(num(it.vrcusto)));

    // custo unitário do pedido por produto (1ª linha do produto em ordem ESTÁVEL por codpedcompi — determinístico).
    const pedRows = (await db
      .selectFrom('pedidocompra_i as i')
      .leftJoin('produtos as o', 'o.idproduto', 'i.idproduto')
      .select(['i.idproduto as idproduto', 'o.descricao as descricao', 'i.vrcusto as vrcusto'])
      .where('i.codpedcomp', '=', codpedcomp)
      .orderBy('i.codpedcompi')
      .execute()) as Array<{ idproduto: number; descricao: string | null; vrcusto: unknown }>;
    const custoPedido = new Map<number, { custo: number; descricao: string | null }>();
    for (const p of pedRows) if (!custoPedido.has(Number(p.idproduto))) custoPedido.set(Number(p.idproduto), { custo: num(p.vrcusto), descricao: p.descricao ?? null });

    const divergencias: Divergencia[] = [];
    for (const [pid, custoNf] of custoNfMap) {
      const ped = custoPedido.get(pid);
      if (!ped) {
        divergencias.push({ idproduto: pid, descricao: null, tipo: 'INE_PEDIDO', custoPedido: 0, custoNf });
        continue;
      }
      const custoPed = r2(ped.custo);
      // faixa em torno do valor da NF (denominador = custoNf, fiel ao legado); custoNf=0 → diverge se custoPed≠0.
      const base = custoNf !== 0 ? Math.abs(custoPed - custoNf) / custoNf : (custoPed !== 0 ? 1 : 0);
      if (base > variacao + 1e-9) {
        divergencias.push({ idproduto: pid, descricao: ped.descricao, tipo: 'PRECO', custoPedido: custoPed, custoNf });
      }
    }

    // QUANTIDADE (fold auditoria): over-receipt = saldo < 0 em algum produto → divergência (o corte-1 delegou isto
    // ao corte-2). Cobre o caminho do import (que não capa quantidade por saldo). Uma divergência por produto excedido.
    const { itens: saldoItens } = await this.saldo(codpedcomp);
    for (const s of saldoItens) {
      if (s.saldo < -1e-6) divergencias.push({ idproduto: s.idproduto, descricao: s.descricao, tipo: 'QUANTIDADE', custoPedido: 0, custoNf: 0, saldo: s.saldo });
    }
    return { codnf, codpedcomp, divergencias, temDivergencia: divergencias.length > 0 };
  }

  /**
   * LIBERA a conferência de uma NF vinculada (fiel a UanalisaPedComp_NF.btnLiberarPedidoClick). Sem divergência →
   * 'LIBERADO SEM DIVERGENCIA' (o próprio operador). Com divergência → exige um SUPERVISOR (login+senha) que esteja
   * em USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA (reusa o E8 ChamaLiberacaoLogin + LOG_LIBERACOES) → 'LIBERADO COM
   * DIVERGENCIA' (grava o supervisor em codoperador_liberacao). Sem override → 422 (precisa do supervisor).
   */
  async liberar(codnf: number, override?: { login?: string; senha?: string }): Promise<{ codnf: number; status: string; temDivergencia: boolean; divergencias: Divergencia[] }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const { divergencias, temDivergencia } = await this.divergencias(codnf);

    let status: string;
    let codoperadorLiberacao: number | null;
    if (!temDivergencia) {
      status = 'LIBERADO SEM DIVERGENCIA';
      codoperadorLiberacao = op;
    } else {
      if (!override?.login || !override?.senha) throw new BusinessRuleError('LIBERACAO_SUPERVISOR_REQUERIDA', { codnf });
      const r = await this.liberacao.validar({
        codigo: 'USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA',
        login: override.login,
        senha: override.senha,
        liberacao: `Liberação da conferência do pedido de compra (NF ${codnf}) com divergência.`,
      });
      if (!r.liberado) throw new BusinessRuleError('LIBERACAO_NEGADA', { codnf });
      status = 'LIBERADO COM DIVERGENCIA';
      codoperadorLiberacao = r.codOperador ?? null;
    }

    await (this.dbp.forTenant() as AnyDB)
      .updateTable('nf')
      .set({ status_pedcomp: status, codoperador_liberacao: codoperadorLiberacao })
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .execute();
    return { codnf, status, temDivergencia, divergencias };
  }
}
