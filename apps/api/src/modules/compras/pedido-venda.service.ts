import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ItemPedidoDto {
  codpedidos?: number | null;
  codproduto: number;
  qtde: number;
  vrvenda: number;
  desc_acre_item?: number | null;
  troca?: boolean;
  bonificado?: boolean;
  obs_entrega?: string | null;
}

/**
 * DIGITAÇÃO DE PEDIDOS (`FRMDIGITACAOPEDIDOS`, `uDigitacaoPedidos.pas` 3.271 linhas).
 * Dossiê: `uDigitacaoPedidos.md`. **116 acessos, 9 operadores.**
 *
 * O **pedido de venda** — balcão, televenda, entrega. Não confundir com `PEDIDOCOMPRA`
 * (`FRMPEDIDOCOMPRA`, já migrado): aqui é o que a loja vende.
 *
 * ⚠️ **`pedidos` é 1 linha por ITEM**: o cabeçalho se repete em cada linha e `NROPEDIDO` é o que agrupa.
 * Em produção, 37.080 linhas em 25.784 pedidos.
 *
 * ── A promoção acumulativa, do lado de quem a CONSOME (`AplicaPromocaoAcumulativa:2076`) ────────────────
 * O cadastro dela já estava migrado (`FRMCADPROMOCAOACUMULATIVA`, mig 214); esta é a tela que a **aplica**,
 * e a conta tem uma virada importante:
 *
 * ```
 * total de itens elegíveis = soma das quantidades do pedido para o produto (ou para o GRUPO DE PREÇO)
 *
 * ATACAREJO = 'S' → pacotes  = o total inteiro
 *                   desconto = DESCONTO cheio, por unidade, em TODAS as unidades
 * senão          → pacotes  = trunc(total ÷ QTDE)        (só pacotes COMPLETOS)
 *                   desconto = DESCONTO ÷ QTDE, por unidade
 *                   unidades com desconto = QTDE × pacotes
 * ```
 *
 * A diferença entre os dois modos é grande em dinheiro: "leve 3, ganhe 3,00" no modo normal dá 1,00 por
 * unidade e **só nos trios completos** — quem levou 5 recebe desconto em 3. No atacarejo, dá 3,00 em cada
 * uma das 5.
 *
 * ⚠️ **cancelado, bonificado e troca ficam de fora** da soma e do desconto (`:2118`) — mercadoria que não
 * foi vendida, foi dada ou voltou não conta para atingir o pacote nem recebe abatimento.
 *
 * ⚠️ a promoção vigente é buscada com `IDEMPRESA LIKE '%;N;%'` — a lista de lojas do cadastro (mig 214),
 * que é `varchar` e não inteiro. A mesma comparação, aqui do lado de quem lê.
 */
@Injectable()
export class PedidoVendaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** a lista de pedidos do período, com o total de cada um — é o cabeçalho que a tabela não tem. */
  async listar(f: { dataIni: string; dataFim: string; nropedido?: string | null; codparceiro?: number | null; incluirCancelados?: boolean }): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const onde = [
      sql`p.idempresa = ${emp}`,
      sql`p.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
    ];
    if (f.nropedido) onde.push(sql`p.nropedido LIKE ${`%${f.nropedido}%`}`);
    if (f.codparceiro) onde.push(sql`p.codparceiro = ${f.codparceiro}`);
    if (!f.incluirCancelados) onde.push(sql`coalesce(p.cancelado, 'N') = 'N'`);

    return (await sql<Record<string, unknown>>`
      SELECT p.nropedido,
             min(p.dtvenda) AS dtvenda,
             max(p.codparceiro) AS codparceiro,
             max(coalesce(p.cliente, pa.razao)) AS cliente,
             max(p.codvendedor) AS codvendedor,
             count(*)::int AS itens,
             sum(p.qtde) AS qtde_total,
             -- o total do pedido: quantidade × preço, menos o desconto do item e o da promoção acumulativa
             round(sum((p.qtde * p.vrvenda)
                       - coalesce(p.desc_acre_item, 0)
                       - coalesce(p.desc_promo_acumulativa, 0))::numeric, 2) AS total,
             round(sum(coalesce(p.desc_promo_acumulativa, 0))::numeric, 2) AS desconto_promocao,
             max(coalesce(p.entregar, 'N')) AS entregar,
             max(coalesce(p.proc, 'N')) AS proc,
             max(coalesce(p.cancelado, 'N')) AS cancelado
        FROM pedidos p
        LEFT JOIN parceiros pa ON pa.codparceiro = p.codparceiro
       WHERE ${sql.join(onde, sql` AND `)}
       GROUP BY p.nropedido
       ORDER BY min(p.dtvenda) DESC, p.nropedido
       LIMIT 2001
    `.execute(db)).rows;
  }

  async abrir(nropedido: string): Promise<{ itens: Array<Record<string, unknown>>; total: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const itens = (await sql<Record<string, unknown>>`
      SELECT p.codpedidos, p.nroitem, p.codproduto, p.codbarra, p.descricao, p.unidade,
             p.qtde, p.vrvenda, p.vrcusto, coalesce(p.desc_acre_item, 0) AS desc_acre_item,
             coalesce(p.desc_promo_acumulativa, 0) AS desc_promo_acumulativa,
             coalesce(p.qtde_promocao_acumulativa, 0) AS qtde_promocao_acumulativa,
             coalesce(p.cancelado, 'N') AS cancelado,
             coalesce(p.bonificado, 'N') AS bonificado,
             coalesce(p.troca, 'N') AS troca,
             pr.codgrupopreco,
             round(((p.qtde * p.vrvenda) - coalesce(p.desc_acre_item, 0)
                    - coalesce(p.desc_promo_acumulativa, 0))::numeric, 2) AS total_item
        FROM pedidos p
        LEFT JOIN produtos pr ON pr.idproduto = p.codproduto
       WHERE p.idempresa = ${emp} AND p.nropedido = ${nropedido}
       ORDER BY p.nroitem, p.codpedidos
    `.execute(db)).rows;
    if (itens.length === 0) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { nropedido });
    return { itens, total: r2(itens.reduce((s, i) => s + num(i.total_item), 0)) };
  }

  /**
   * APLICAR A PROMOÇÃO ACUMULATIVA no pedido (`AplicaPromocaoAcumulativa:2076`).
   *
   * Zera o que havia antes (o legado chama `RetiraPromocaoAcumulativa` na entrada) e recalcula do começo —
   * senão o desconto se acumularia a cada clique.
   */
  async aplicarPromocaoAcumulativa(nropedido: string): Promise<{
    promocoesAplicadas: number; itensComDesconto: number; descontoTotal: number;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      // 1. zera o que havia — o legado retira antes de aplicar
      await sql`
        UPDATE pedidos SET desc_promo_acumulativa = 0, qtde_promocao_acumulativa = 0
         WHERE idempresa = ${emp} AND nropedido = ${nropedido}
      `.execute(trx);

      // 2. as promoções vigentes desta loja — a lista `;1;2;` do cadastro (mig 214)
      const promos = (await sql<Record<string, unknown>>`
        SELECT pa.idproacumulativa, pa.idproduto, pa.qtde, pa.desconto,
               coalesce(pa.atacarejo, 'N') AS atacarejo, coalesce(pa.codgrupopreco, 0) AS codgrupopreco
          FROM promocao_acumulativa pa
         WHERE coalesce(pa.idempresa, '') LIKE ${`%;${emp};%`}
           AND pa.dtini <= now() AND pa.dtfim >= now()
         ORDER BY pa.idproacumulativa, pa.codgrupopreco
      `.execute(trx)).rows;

      let aplicadas = 0;
      let itensComDesconto = 0;
      let descontoTotal = 0;

      for (const pr of promos) {
        const porGrupo = num(pr.codgrupopreco) > 0;
        // 3. os itens elegíveis: por grupo de preço, ou pelo produto. Cancelado/bonificado/troca ficam fora.
        const elegiveis = (await sql<Record<string, unknown>>`
          SELECT p.codpedidos, p.qtde, p.vrvenda
            FROM pedidos p
            LEFT JOIN produtos prod ON prod.idproduto = p.codproduto
           WHERE p.idempresa = ${emp} AND p.nropedido = ${nropedido}
             AND coalesce(p.cancelado, 'N') = 'N'
             AND coalesce(p.bonificado, 'N') = 'N'
             AND coalesce(p.troca, 'N') = 'N'
             AND ${porGrupo
               ? sql`prod.codgrupopreco = ${num(pr.codgrupopreco)}`
               : sql`p.codproduto = ${num(pr.idproduto)}`}
           ORDER BY p.nroitem, p.codpedidos
        `.execute(trx)).rows;

        const total = elegiveis.reduce((s, i) => s + num(i.qtde), 0);
        const minimo = num(pr.qtde);
        if (total <= 0 || minimo <= 0 || total < minimo) continue;

        // 4. ⚠️ ATACAREJO muda a conta inteira
        const atacarejo = String(pr.atacarejo) === 'S';
        const pacotes = atacarejo ? total : Math.trunc(total / minimo);
        const descontoUnit = atacarejo ? num(pr.desconto) : num(pr.desconto) / minimo;
        // no modo normal só as unidades dos pacotes COMPLETOS recebem
        let aDescontar = atacarejo ? total : minimo * pacotes;
        if (aDescontar <= 0) continue;

        // 5. distribui item a item, na ordem, até acabar a quantidade com direito
        for (const it of elegiveis) {
          if (aDescontar <= 0) break;
          const q = Math.min(num(it.qtde), aDescontar);
          const desc = r2(q * descontoUnit);
          await sql`
            UPDATE pedidos
               SET desc_promo_acumulativa = coalesce(desc_promo_acumulativa, 0) + ${desc},
                   qtde_promocao_acumulativa = coalesce(qtde_promocao_acumulativa, 0) + ${q},
                   dtultimalteracao = now()
             WHERE codpedidos = ${num(it.codpedidos)}
          `.execute(trx);
          aDescontar -= q;
          itensComDesconto += 1;
          descontoTotal += desc;
        }
        aplicadas += 1;
      }

      return { promocoesAplicadas: aplicadas, itensComDesconto, descontoTotal: r2(descontoTotal) };
    });
  }
}
