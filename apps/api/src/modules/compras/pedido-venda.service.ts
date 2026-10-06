import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from './pedido-heranca';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3 } from '../../shared/relatorios/registro-fr3';

/** o TOTAL do item no `sqqPedidos` (uRDMDigitacaoPedidos.dfm): ROUND(QTDE × FATOREMB × (VRVENDA + DESC_ACRE_ITEM) × 100) / 100 − promoção */
const TOTAL_ITEM = sql`(round((p.qtde * coalesce(p.fatoremb, 1) * (coalesce(p.vrvenda, 0) + coalesce(p.desc_acre_item, 0)))::numeric, 2)
                        - coalesce(p.desc_promo_acumulativa, 0))`;

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
             -- o total do pedido: o TOTAL do sqqPedidos somado (o SUBTOTAL = SUM(TOTAL) do cdsPedidos) — por item,
             -- ROUND(QTDE × FATOREMB × (VRVENDA + DESC_ACRE_ITEM), 2) − DESC_PROMO_ACUMULATIVA (o acréscimo/desconto é POR UNIDADE)
             round(sum(${TOTAL_ITEM}), 2) AS total,
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
             ${TOTAL_ITEM} AS total_item
        FROM pedidos p
        LEFT JOIN produtos pr ON pr.idproduto = p.codproduto
       WHERE p.idempresa = ${emp} AND p.nropedido = ${nropedido}
       ORDER BY p.nroitem, p.codpedidos
    `.execute(db)).rows;
    if (itens.length === 0) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { nropedido });
    return { itens, total: r2(itens.reduce((s, i) => s + num(i.total_item), 0)) };
  }

  /**
   * IMPRIMIR o pedido (`btnImprimirClick`, uDigitacaoPedidos.pas:1248; o mesmo no fim da digitação, uDigitacaoPedidosFormasPagto.pas:296).
   * O layout é de `Config\`: com `DIGITACAO_PEDIDOS_IMPRIMIR_FOLHA_A4` (a configuração que o binário novo migrou do XML da estação; 'N'
   * na produção) `PedidoRetaguardaA4.fr3`, ou `PedidoRetaguardaA4_Transferencia.fr3` no pedido de TRANSFERÊNCIA (TIPO 'T'); senão o de
   * bobina `PedidoRetaguarda.fr3`. O dataset é o `sqqPedidoRetaguarda` (os itens não cancelados, por descrição; VRUNITARIO = VRVENDA +
   * DESC_ACRE_ITEM) — e o NOME_OPERADOR que o layout de transferência lê (o binário novo; o SQL de 2020 não tem) vem do OPERADOR do pedido,
   * a única coluna de operador da tabela. Variáveis: EMPRESA ("razão cidade - UF"), EMPRESA2 ("endereço bairro CNPJ:… IE:…"), FATURAMENTO
   * vazio (a impressão da tela) e TOTALPEDIDO = TOTALPRODUTOS = o SUBTOTAL do pedido. Sem itens: "Não existe informações para serem
   * impressas. Verifique !!!".
   */
  async impressao(nropedido: string) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      SELECT p.codpedidos, p.nropedido, p.codbarra, p.desc_acre_item, (coalesce(p.vrvenda, 0) + coalesce(p.desc_acre_item, 0)) AS vrunitario,
             p.qtde, p.descricao, p.unidade, p.aliquota, p.dtvenda, p.codvendedor, p.codparceiro AS codcliente, pr.peso, p.desc_acre, p.obs,
             p.referencia, p.cliente, c.fantasia, e.uf, e.endereco, e.numero, e.cidade, e.telefone, e.cnpj_cpf, e.rg_insc, e.bairro, e.celular,
             e.cep, v.razao AS vendedor, p.obs_entrega, p.tipo, p.vrcusto, p.vrvenda, coalesce(p.desc_promo_acumulativa, 0) AS desc_promo_acumulativa,
             p.fatoremb, o.nome AS nome_operador
        FROM pedidos p
        LEFT JOIN parceiros c ON c.codparceiro = p.codparceiro
        LEFT JOIN parceiros_end e ON e.codend = p.codparceiro_end
        LEFT JOIN parceiros v ON v.codparceiro = p.codvendedor
        LEFT JOIN produtos pr ON pr.idproduto = p.codproduto
        LEFT JOIN operadores o ON o.codoperador = p.operador
       WHERE p.nropedido = ${nropedido} AND p.idempresa = ${emp} AND coalesce(p.cancelado, 'N') = 'N'
       ORDER BY p.descricao`.execute(db)).rows;
    if (!rows.length) throw new BusinessRuleError('PEDIDO_SEM_ITENS', { nropedido }, 'Não existe informações para serem impressas. Verifique !!!');
    // o SUBTOTAL: SUM(TOTAL) do cdsPedidos (o sqqPedidos traz todas as linhas do pedido)
    const sub = (await sql<{ s: string | null }>`
      SELECT sum(${TOTAL_ITEM}) AS s FROM pedidos p WHERE p.nropedido = ${nropedido} AND p.idempresa = ${emp}`.execute(db)).rows[0];
    const subtotal = Number(sub?.s ?? 0);
    const a4 = ['S', 'SIM'].includes(String((await configNaTrx(db, 'DIGITACAO_PEDIDOS_IMPRIMIR_FOLHA_A4',
      { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'N').toUpperCase());
    const arquivo = !a4 ? 'PedidoRetaguarda.fr3' : String(rows[0].tipo ?? '') === 'T' ? 'PedidoRetaguardaA4_Transferencia.fr3' : 'PedidoRetaguardaA4.fr3';
    const e = (await sql<Record<string, unknown>>`SELECT razao_social, cidade, uf, endereco, bairro, cnpj, insc FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const q = (t: string) => `'${t.replace(/'/g, "''")}'`;
    const nums = new Set(['codpedidos', 'desc_acre_item', 'vrunitario', 'qtde', 'codvendedor', 'codcliente', 'peso', 'desc_acre', 'vrcusto', 'vrvenda', 'desc_promo_acumulativa', 'fatoremb']);
    return {
      titulo: `Pedido ${nropedido}`,
      modelo: await modeloFr3(db, arquivo, { pasta: 'Config' }),
      datasets: { frxDBDataset1: rows.map((r) => registroFr3(r, nums)) },
      variaveis: {
        EMPRESA: q(` ${String(e.razao_social ?? '')} ${String(e.cidade ?? '')} - ${String(e.uf ?? '')} `),
        EMPRESA2: q(` ${String(e.endereco ?? '')} ${String(e.bairro ?? '')} CNPJ:${String(e.cnpj ?? '')} IE:${String(e.insc ?? '')} `),
        FATURAMENTO: "''",
        // o legado passa o SUBTOTAL como texto; aqui vai o número, para o %2.2n do layout formatar
        TOTALPEDIDO: String(subtotal), TOTALPRODUTOS: String(subtotal),
      },
    };
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
