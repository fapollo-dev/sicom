import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DevolucaoVendasBuscaDto, DevolucaoVendasConsultaDto, DevolucaoVendasRegistrarDto, DevolucaoVendasReverterDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
/** o total LÍQUIDO do item (o TOTAL_ITEM do sqqDevolucaoVendas): qtde × preço, menos os descontos de promoção/departamento, mais os acréscimos */
const LIQUIDO = sql`((coalesce(v.qtde, 0) * v.vrvenda) + ((coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)) * -1) + coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0))`;
/** o devolvido do `CalculaDevolucao` (uDevolucaoVendas.pas): o total líquido do item rateado pela quantidade — e o desconto/acréscimo dela */
export function calculaDevolucao(it: Record<string, unknown>, qtdeDevolvido: number) {
  const qtde = num(it.qtde);
  if (!qtde) return { total: 0, descAcre: 0 };
  const desc = num(it.desc_promocao) + num(it.desc_departamento);
  const acre = num(it.desc_acre_medio) + num(it.desc_acre_item);
  const total = Math.round((qtdeDevolvido * (((qtde * num(it.vrvenda)) - desc) + acre) / qtde + Number.EPSILON) * 100) / 100;
  const descAcre = Math.round((qtdeDevolvido * ((desc * -1) + acre) / qtde + Number.EPSILON) * 100) / 100;
  return { total, descAcre };
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * DEVOLUÇÃO DE VENDAS (`FRMDEVOLUCAOVENDAS`). **3.958 acessos, 36 operadores**, último em 17/09/2026.
 * Dossiê: `uDevolucaoVendas.md`. Migration 275.
 *
 * O cliente volta à loja com mercadoria comprada: acha-se o cupom (PDV + número, ou por período), marcam-se
 * os itens e a quantidade, escolhe-se um motivo e registra. Também reverte um registro feito por engano.
 *
 * ── ⚠️ A regra que está num comentário do fonte: o ESTOQUE NÃO VOLTA ──────────────────────────────────
 * `btnEstornarClick` (uDevolucaoVendas.pas:400-403) tem o `UPDATE ESTOQUE ... QTDE + devolvido`
 * **comentado**, com a razão em caixa alta: `//ESTOQUE NÃO DEVE SER ALTERADO SEM PROCESSO FISCAL`. A
 * devolução de venda **registra e marca**; quem devolve o estoque é a NF de devolução. Copiado assim.
 *
 * ── O resto das regras, do fonte ──────────────────────────────────────────────────────────────────────
 * · a marca na venda é `DEVOLUCAO='D'` + `QTDE_DEVOLVIDO` + `TOTAL_ITEM_DEVOLVIDO`; a reversão grava o
 *   literal **`' '`** (espaço), não NULL — e o dado confirma (6 itens com `' '` em 2026);
 * · o registro é único por (venda, produto, empresa, item) — o legado consulta antes de inserir
 *   (`RetornarValores`), e aqui é índice único;
 * · o motivo vem de `motivos_operacao` com `TIPO_OPERACAO='DEVOLUCAO'`;
 * · `GeraSaldoCliente` (crédito ao cliente, gated por `GERA_SALDO_CLIENTE_DEVOLUCAO_VENDA`) fica **fora**:
 *   `CODAPG_DEVOLUCAO_SALDO` tem **0 de 3.658** no cliente — nunca foi usada.
 *
 * No cliente: 3.658 devoluções (250 em 2026, R$ 4.466,96), 3.583 com motivo, em duas empresas.
 */
@Injectable()
export class DevolucaoVendasService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** os itens da venda, com o que já foi devolvido. */
  async buscar(q: DevolucaoVendasBuscaDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cupom = q.nrocupom ?? null;
    const pdv = q.nropdv ?? null;
    const ped = q.nropedido?.trim() || null;
    const ini = q.dataIni ?? null;
    const fim = q.dataFim ?? null;

    const rows = (await sql<Record<string, unknown>>`
      SELECT v.codvendas, v.nroitem, v.nropedido, v.nrocupom, v.nroserie, v.dtvenda, v.codproduto,
             p.descricao, p.codbarra, v.qtde, v.vrvenda, round((${LIQUIDO})::numeric, 2) AS total_item,
             coalesce(v.devolucao, '') AS devolucao, coalesce(v.qtde_devolvido, 0) AS qtde_devolvido,
             coalesce(v.total_item_devolvido, 0) AS total_item_devolvido,
             d.coddevolucaovenda, d.datadevolucao, d.operador AS operador_devolucao,
             d.codmotivoop, mo.descricao AS motivo
        FROM vendas v
        LEFT JOIN produtos p ON p.idproduto = v.codproduto
        -- DEVOLUCAO_VENDAS.CODVENDAS é o CUPOM do legado (vendas.codvendas_legado); o nosso codvendas é o id da linha
        LEFT JOIN devolucao_vendas d ON d.codvendas = coalesce(v.codvendas_legado, v.codvendas) AND d.nroitem = v.nroitem
                                    AND d.codproduto = v.codproduto AND d.idempresa = v.idempresa
        LEFT JOIN motivos_operacao mo ON mo.codmotivoop = d.codmotivoop
       WHERE v.idempresa = ${emp}
         AND coalesce(v.cancelado, 'N') = 'N'
         AND (${cupom}::integer IS NULL OR v.nrocupom = ${cupom}::integer)
         AND (${pdv}::integer IS NULL OR v.nroserie = ${pdv}::text)
         AND (${ped}::text IS NULL OR v.nropedido = ${ped}::text)
         AND (${ini}::date IS NULL OR v.dtvenda >= ${ini}::date)
         AND (${fim}::date IS NULL OR v.dtvenda < ${fim}::date + 1)
       ORDER BY v.dtvenda, v.nrocupom, v.nroitem
       LIMIT ${q.limite}`.execute(db)).rows;

    const itens = rows.map((r) => ({
      codvendas: Number(r.codvendas), nroitem: Number(r.nroitem), nropedido: r.nropedido ?? null,
      nrocupom: r.nrocupom == null ? null : Number(r.nrocupom), nroserie: r.nroserie ?? null, dtvenda: r.dtvenda,
      codproduto: Number(r.codproduto), descricao: r.descricao ?? '', codbarra: r.codbarra ?? null,
      qtde: num(r.qtde), vrvenda: num(r.vrvenda), totalItem: num(r.total_item),
      devolvido: String(r.devolucao).trim() === 'D',
      qtdeDevolvido: num(r.qtde_devolvido), totalItemDevolvido: num(r.total_item_devolvido),
      coddevolucaovenda: r.coddevolucaovenda == null ? null : Number(r.coddevolucaovenda),
      datadevolucao: r.datadevolucao ?? null, operadorDevolucao: r.operador_devolucao ?? null,
      codmotivoop: r.codmotivoop == null ? null : Number(r.codmotivoop), motivo: r.motivo ?? null,
    }));
    return {
      itens, truncado: rows.length >= q.limite,
      totais: {
        itens: itens.length,
        devolvidos: itens.filter((i) => i.devolvido).length,
        valor: r2(itens.reduce((s, i) => s + i.totalItem, 0)),
        valorDevolvido: r2(itens.reduce((s, i) => s + i.totalItemDevolvido, 0)),
      },
    };
  }

  /** os motivos de devolução (o legado filtra `TIPO_OPERACAO='DEVOLUCAO'`). */
  async motivos() {
    const rows = (await sql<Record<string, unknown>>`
      SELECT codmotivoop, descricao FROM motivos_operacao
       WHERE upper(coalesce(tipo_operacao, '')) = 'DEVOLUCAO' AND coalesce(indr, 'I') <> 'E'
       ORDER BY descricao`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((r) => ({ codmotivoop: Number(r.codmotivoop), descricao: r.descricao }));
  }

  async registrar(dto: DevolucaoVendasRegistrarDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      const nome = (await sql<{ nome: unknown }>`SELECT nome FROM operadores WHERE codoperador = ${op}`.execute(trx)).rows[0]?.nome ?? null;
      // EXIGE_MOTIVO_DEVOLUCAO ('S' na produção): sem motivo, "Informe o motivo da devolução."
      if (dto.codmotivoop == null && (await this.config.resolver('EXIGE_MOTIVO_DEVOLUCAO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) === 'S') {
        throw new BusinessRuleError('MOTIVO_DEVOLUCAO_OBRIGATORIO', {}, 'Informe o motivo da devolução.');
      }
      if (dto.codmotivoop != null) {
        // o motivo sai da lista de `TIPO_OPERACAO = 'DEVOLUCAO'` (a seleção do legado só mostra esses)
        const m = (await sql<{ c: unknown }>`SELECT codmotivoop AS c FROM motivos_operacao WHERE codmotivoop = ${dto.codmotivoop}
                                               AND upper(coalesce(tipo_operacao, '')) = 'DEVOLUCAO'`.execute(trx)).rows[0];
        if (!m) throw new BusinessRuleError('MOTIVO_NAO_ENCONTRADO', { codmotivoop: dto.codmotivoop });
      }

      const registrados: Array<Record<string, unknown>> = [];
      for (const it of dto.itens) {
        const v = (await sql<Record<string, unknown>>`
          SELECT codvendas, coalesce(codvendas_legado, codvendas) AS cupom, nroitem, nropedido, nrocupom, qtde, vrvenda, coalesce(devolucao, '') AS devolucao,
                 desc_promocao, desc_departamento, desc_acre_medio, desc_acre_item
            FROM vendas
           WHERE codvendas = ${it.codvendas} AND nroitem = ${it.nroitem} AND codproduto = ${it.codproduto} AND idempresa = ${emp}
             AND coalesce(cancelado, 'N') = 'N'
           FOR UPDATE`.execute(trx)).rows[0];
        if (!v) throw new BusinessRuleError('ITEM_VENDA_NAO_ENCONTRADO', { codvendas: it.codvendas, nroitem: it.nroitem, codproduto: it.codproduto });
        if (String(v.devolucao).trim() === 'D') throw new BusinessRuleError('ITEM_JA_DEVOLVIDO', { codvendas: it.codvendas, nroitem: it.nroitem });
        const qtdeVendida = num(v.qtde);
        if (r3(it.qtdeDevolvido) > r3(qtdeVendida)) {
          throw new BusinessRuleError('QTDE_DEVOLVIDA_EXCEDE', { codvendas: it.codvendas, nroitem: it.nroitem, qtde: qtdeVendida, devolvido: it.qtdeDevolvido });
        }
        // o TOTAL_ITEM_DEVOLVIDO do CalculaDevolucao: o líquido do item (com os descontos e acréscimos) rateado pela quantidade — o que a
        // produção grava (920 de 920 devoluções desde 2025; o qtde × preço erraria as 12 com desconto)
        const total = calculaDevolucao(v, it.qtdeDevolvido).total;

        const d = (await sql<{ coddevolucaovenda: unknown }>`
          INSERT INTO devolucao_vendas (datadevolucao, operador, codvendas, codproduto, idempresa, nroitem, codmotivoop, codoperador)
          VALUES (now(), ${nome}, ${Number(v.cupom)}, ${it.codproduto}, ${emp}, ${it.nroitem}, ${dto.codmotivoop ?? null}, ${op})
          RETURNING coddevolucaovenda`.execute(trx)).rows[0];

        // a marca na venda — e o ESTOQUE NÃO É TOCADO (uDevolucaoVendas.pas:400-403, com a razão no fonte)
        await sql`UPDATE vendas SET devolucao = 'D', qtde_devolvido = ${r3(it.qtdeDevolvido)}, total_item_devolvido = ${total}
                   WHERE codvendas = ${it.codvendas} AND nroitem = ${it.nroitem} AND codproduto = ${it.codproduto} AND idempresa = ${emp}`.execute(trx);

        registrados.push({ coddevolucaovenda: Number(d.coddevolucaovenda), codvendas: it.codvendas, nroitem: it.nroitem, codproduto: it.codproduto, qtdeDevolvido: r3(it.qtdeDevolvido), total });
      }
      return {
        registrados, codmotivoop: dto.codmotivoop ?? null,
        estoqueAlterado: false, // explícito: o legado deixou o UPDATE comentado por processo fiscal
        totais: { itens: registrados.length, valor: r2(registrados.reduce((s, r) => s + num(r.total), 0)) },
      };
    });
  }

  async reverter(dto: DevolucaoVendasReverterDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      const revertidos: Array<Record<string, unknown>> = [];
      for (const it of dto.itens) {
        const d = (await sql<Record<string, unknown>>`
          SELECT coddevolucaovenda FROM devolucao_vendas
           WHERE codvendas = (SELECT coalesce(codvendas_legado, codvendas) FROM vendas WHERE codvendas = ${it.codvendas} AND idempresa = ${emp})
             AND nroitem = ${it.nroitem} AND codproduto = ${it.codproduto} AND idempresa = ${emp}
           FOR UPDATE`.execute(trx)).rows[0];
        if (!d) throw new BusinessRuleError('DEVOLUCAO_NAO_ENCONTRADA', { codvendas: it.codvendas, nroitem: it.nroitem, codproduto: it.codproduto });

        // o legado grava o literal ' ' (espaço), não NULL — e o dado do cliente confirma
        await sql`UPDATE vendas SET devolucao = ' ', qtde_devolvido = 0, total_item_devolvido = 0
                   WHERE codvendas = ${it.codvendas} AND nroitem = ${it.nroitem} AND codproduto = ${it.codproduto} AND idempresa = ${emp}`.execute(trx);
        await sql`DELETE FROM devolucao_vendas WHERE coddevolucaovenda = ${Number(d.coddevolucaovenda)}`.execute(trx);
        revertidos.push({ coddevolucaovenda: Number(d.coddevolucaovenda), codvendas: it.codvendas, nroitem: it.nroitem, codproduto: it.codproduto });
      }
      return { revertidos, totais: { itens: revertidos.length } };
    });
  }

  /** as devoluções registradas no período. */
  async consultar(q: DevolucaoVendasConsultaDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const mot = q.codmotivoop ?? null;
    const rows = (await sql<Record<string, unknown>>`
      SELECT d.coddevolucaovenda, d.datadevolucao, d.operador, coalesce(v.codvendas, d.codvendas) AS codvendas, d.codvendas AS cupom, d.nroitem, d.codproduto,
             p.descricao, d.codmotivoop, mo.descricao AS motivo,
             v.nrocupom, v.nroserie, v.dtvenda, coalesce(v.qtde_devolvido, 0) AS qtde_devolvido,
             coalesce(v.total_item_devolvido, 0) AS total
        FROM devolucao_vendas d
        LEFT JOIN vendas v ON coalesce(v.codvendas_legado, v.codvendas) = d.codvendas AND v.nroitem = d.nroitem AND v.codproduto = d.codproduto AND v.idempresa = d.idempresa
        LEFT JOIN produtos p ON p.idproduto = d.codproduto
        LEFT JOIN motivos_operacao mo ON mo.codmotivoop = d.codmotivoop
       WHERE d.idempresa = ${emp}
         AND d.datadevolucao::date BETWEEN ${q.dataIni}::date AND ${q.dataFim}::date
         AND (${mot}::integer IS NULL OR d.codmotivoop = ${mot}::integer)
       ORDER BY d.datadevolucao DESC, d.coddevolucaovenda DESC
       LIMIT ${q.limite}`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    const itens = rows.map((r) => ({ ...r, coddevolucaovenda: Number(r.coddevolucaovenda), codmotivoop: r.codmotivoop == null ? null : Number(r.codmotivoop), qtdeDevolvido: num(r.qtde_devolvido), total: num(r.total) }));
    return {
      itens, truncado: rows.length >= q.limite,
      totais: {
        devolucoes: itens.length,
        valor: r2(itens.reduce((s, i) => s + i.total, 0)),
        semMotivo: itens.filter((i) => i.codmotivoop == null).length,
      },
    };
  }

  /** as linhas do `sqqDevolucaoVendas` / `sqqItensDevolvidos` (o endereço é o de MENOR código do cliente) */
  private async linhasDaVenda(db: AnyDB, filtro: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
    return (await sql<Record<string, unknown>>`
      SELECT v.codvendas, v.nropedido, v.nrocupom, p.razao AS cliente, ve.razao AS vendedor, to_char(v.dtvenda, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtvenda,
             pr.codbarra, CASE WHEN v.idproduto_filho IS NOT NULL THEN v.descricao ELSE pr.descricao END AS descricao, pr.unidade, v.qtde, v.vrvenda,
             ${LIQUIDO} AS total_item, v.aliquota, v.nroitem, v.codproduto, v.devolucao, v.desc_promocao, v.desc_departamento, v.desc_acre_medio,
             v.desc_acre_item, coalesce(v.qtde_devolvido, 0) AS qtde_devolvido_gravado, v.total_item_devolvido AS total_item_devolvido_gravado,
             e.endereco, e.bairro, e.cidade, e.uf, e.telefone, e.celular, e.fax, e.cnpj_cpf, e.rg_insc, e.cep, e.numero, e.complemento,
             op.nome AS nome_vendedor, mo.descricao AS motivo, to_char(d.datadevolucao, 'YYYY-MM-DD"T"HH24:MI:SS') AS datadevolucao, d.operador
        FROM vendas v
        LEFT JOIN parceiros p   ON p.codparceiro = v.codparceiro
        LEFT JOIN parceiros ve  ON ve.codparceiro = v.codvendedor
        LEFT JOIN produtos pr   ON pr.idproduto = v.codproduto
        LEFT JOIN operadores op ON op.codoperador = v.operador
        LEFT JOIN parceiros_end e ON e.codend = (SELECT min(e2.codend) FROM parceiros_end e2 WHERE e2.codparceiro = v.codparceiro)
        LEFT JOIN devolucao_vendas d ON d.codvendas = coalesce(v.codvendas_legado, v.codvendas) AND d.codproduto = v.codproduto AND d.nroitem = v.nroitem
                                    AND d.idempresa = v.idempresa
        LEFT JOIN motivos_operacao mo ON mo.codmotivoop = d.codmotivoop AND upper(coalesce(mo.tipo_operacao, '')) = 'DEVOLUCAO'
       WHERE v.idempresa = ${this.emp()} AND ${filtro}
       ORDER BY v.nroitem, v.codvendas`.execute(db)).rows;
  }

  /**
   * O EXTRATO da devolução (`ven_DevolucaoVendas.fr3`): impresso ao registrar (TITULO_AUXILIAR "Extrato de devolução de vendas") e na
   * "Pré-visualização" (os itens marcados, antes de registrar). O frxDBDtsDevolucaoVendas são os itens marcados com a quantidade a
   * devolver e o devolvido do `CalculaDevolucao`; USUARIO = o operador; frxDBDtsEmpresa = a empresa do login.
   */
  async extrato(dto: DevolucaoVendasRegistrarDto & { previa?: boolean }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const nums = await colunasNumericas(db, ['vendas'], ['total_item', 'qtde_devolvido', 'total_item_devolvido', 'desc_acre_devolvido', 'desc_acre']);
    const linhas: Array<Record<string, unknown>> = [];
    for (const it of dto.itens) {
      const [v] = await this.linhasDaVenda(db, sql`v.codvendas = ${it.codvendas} AND v.nroitem = ${it.nroitem} AND v.codproduto = ${it.codproduto}`);
      if (!v) throw new BusinessRuleError('ITEM_VENDA_NAO_ENCONTRADO', { codvendas: it.codvendas, nroitem: it.nroitem, codproduto: it.codproduto });
      const { total, descAcre } = calculaDevolucao(v, it.qtdeDevolvido);
      linhas.push(registroFr3({ ...v, qtde_devolvido: it.qtdeDevolvido, total_item_devolvido: total, desc_acre_devolvido: descAcre }, nums));
    }
    const op = currentTenant().operadorId ?? null;
    const usuario = (await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${op}`.execute(db)).rows[0]?.nome ?? '';
    return {
      titulo: 'Extrato de devolução de vendas',
      modelo: await modeloFr3(db, 'ven_DevolucaoVendas.fr3'),
      datasets: { frxDBDtsDevolucaoVendas: linhas, frxDBDtsEmpresa: [await empresaParaRelatorio(db, this.emp())] },
      variaveis: {
        USUARIO: textoVariavel(usuario),
        TITULO_AUXILIAR: textoVariavel(dto.previa ? 'Pré visualização de Extrato de Devolução de vendas.' : 'Extrato de devolução de vendas'),
      },
    };
  }

  /**
   * A REIMPRESSÃO (`AbreDatasetVendas(False, True)`, "Modo normal" / "Modo preenchimento"): o `ven_ItensDevolvidos.fr3` com os itens
   * DEVOLVIDOS do cupom (`sqqItensDevolvidos`: DEVOLUCAO = 'D'; o TOTAL_ITEM_DEVOLVIDO gravado na venda), USUARIO e OCULTARCAMPOS ('S' no
   * modo preenchimento). Sem item devolvido: a mensagem do legado.
   */
  async reimpressao(q: { nrocupom?: number; nropedido?: string; ocultar?: boolean }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    if (q.nrocupom == null && !q.nropedido) throw new BusinessRuleError('CUPOM_PDV_OBRIGATORIO');
    const rows = await this.linhasDaVenda(db, sql`v.devolucao = 'D'
      ${q.nrocupom != null ? sql`AND v.nrocupom = ${q.nrocupom}` : sql``} ${q.nropedido ? sql`AND v.nropedido = ${q.nropedido}` : sql``}`);
    if (!rows.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não foi possível encontrar dados para a pesquisa especificada. Verifique!');
    const nums = await colunasNumericas(db, ['vendas'], ['total_item', 'qtde_devolvido', 'total_item_devolvido', 'desc_acre_devolvido', 'qtde']);
    const linhas = rows.map((v) => {
      const qd = num(v.qtde_devolvido_gravado);
      // o QTDE do sqqItensDevolvidos é a quantidade DEVOLVIDA; o DESC_ACRE_DEVOLVIDO, o desconto/acréscimo rateado
      return registroFr3({ ...v, qtde: qd, qtde_devolvido: qd, total_item_devolvido: v.total_item_devolvido_gravado, desc_acre_devolvido: calculaDevolucao(v, qd).descAcre }, nums);
    });
    const op = currentTenant().operadorId ?? null;
    const usuario = (await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${op}`.execute(db)).rows[0]?.nome ?? '';
    return {
      titulo: 'Itens devolvidos',
      modelo: await modeloFr3(db, 'ven_ItensDevolvidos.fr3'),
      datasets: { frxDBDtsItensReimpressao: linhas, frxDBDtsEmpresa: [await empresaParaRelatorio(db, this.emp())] },
      variaveis: { USUARIO: textoVariavel(usuario), OCULTARCAMPOS: textoVariavel(q.ocultar ? 'S' : 'N') },
    };
  }
}
