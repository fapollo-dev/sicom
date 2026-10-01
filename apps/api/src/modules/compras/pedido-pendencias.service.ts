import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, registroFr3 } from '../../shared/relatorios/registro-fr3';
import { lojasDoPedido } from './pedido-lojas';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;
const DH = 'YYYY-MM-DD"T"HH24:MI:SS';

/**
 * A Receber do fornecedor NÃO QUITADO, fora dos agrupados, vencido até ontem (`QryPendenciasFornecedor`, udmPedidoCompra.dfm) — de
 * qualquer loja (o legado não filtra a empresa). É a aba "Pendências do fornecedor" e a metade financeira do `VerificaPendencias`.
 */
export async function pendenciasDoFornecedor(db: AnyDB, codparceiro: number): Promise<Linha[]> {
  return (await sql<Linha>`
    SELECT a.codrcb, coalesce(a.duplicata, a.codrcb::varchar(20)) AS duplicata, to_char(a.dtvenda, ${DH}) AS dtvenda,
           to_char(a.dtvenc, ${DH}) AS dtvenc, a.valor, a.codempresa, p.descricao AS centro_custo
      FROM areceber a
      LEFT JOIN plc p ON p.codplc = a.codplc
     WHERE a.codparceiro = ${codparceiro}
       AND a.quitada = 'N'
       AND coalesce(a.agrupado, 'N') = 'N'
       AND a.dtvenc::date <= current_date - 1
     ORDER BY a.dtvenc, a.codrcb`.execute(db)).rows;
}

/**
 * As trocas pendentes do fornecedor (`sqqTrocas` com as colunas por loja do `OpenEmpresas`): os itens de troca não fechados das lojas do
 * pedido (no legado o sub-nível ITENS_TROCA_QTDE com STATUS ≠ 'F' — cópia 1:1 de ITENS_TROCA: aqui `fechado` ≠ 'S', a loja do item) e
 * os pedidos de devolução ao fornecedor de PRODUTO_TROCA 'S' sem nota nem cancelados; uma coluna EMP<n> por loja do pedido, com a
 * quantidade em aberto. Na ordem do produto e da data mais nova.
 */
export async function trocasDoFornecedor(db: AnyDB, codparceiro: number, empresas: number[]): Promise<Linha[]> {
  const lojas = empresas.length ? empresas : [0];
  const colTroca = sql.join(lojas.map((e) => sql`sum(CASE WHEN i.idempresa = ${e} AND coalesce(i.fechado, 'N') <> 'S' THEN coalesce(i.qtde, 0) ELSE 0 END) AS ${sql.ref(`emp${e}`)}`));
  const colDev = sql.join(lojas.map((e) => sql`sum(coalesce((SELECT sum(x.qtd_devolvida) FROM pedido_devolucao_compra_i x
      WHERE x.codpeddevcompra = pd.codpeddevcompra AND x.idproduto = pdi.idproduto AND pd.idempresa = ${e}), 0)) AS ${sql.ref(`emp${e}`)}`));
  return (await sql<Linha>`
    SELECT * FROM (
      SELECT p.idproduto, p.codbarra AS codigobarra, p.descricao, to_char(pq.data::date, ${DH}) AS data, ${colTroca}
        FROM troca pq
        LEFT JOIN itens_troca i ON i.codtroca = pq.codtroca
        LEFT JOIN produtos p    ON p.idproduto = i.idproduto
       WHERE pq.codparceiro = ${codparceiro}
         AND coalesce(i.fechado, 'N') <> 'S' AND i.idempresa = ANY(${lojas}::int[])
       GROUP BY p.idproduto, p.codbarra, p.descricao, pq.data::date
      UNION ALL
      SELECT p.idproduto, p.codbarra AS codigobarra, p.descricao, to_char(pd.data::date, ${DH}) AS data, ${colDev}
        FROM pedido_devolucao_compra pd
        LEFT JOIN pedido_devolucao_compra_i pdi ON pdi.codpeddevcompra = pd.codpeddevcompra
        LEFT JOIN produtos p ON p.idproduto = pdi.idproduto
       WHERE pd.codparceiro = ${codparceiro}
         AND pd.status NOT IN ('NOTA FISCAL EMITIDA', 'NOTA_FISCAL_EMITIDA', 'CANCELADO')
         AND pd.produto_troca = 'S'
         AND coalesce(pd.indr, 'I') <> 'E'
       GROUP BY p.idproduto, p.codbarra, p.descricao, pd.data::date
    ) t
    ORDER BY 1, 4 DESC`.execute(db)).rows;
}

/** o texto do `VerificaPendencias`: "O fornecedor possui pendências financeiras e trocas pendentes." */
export function mensagemPendencias(temPendencias: boolean, temTrocas: boolean): string | null {
  if (!temPendencias && !temTrocas) return null;
  const partes = [temPendencias ? 'pendências financeiras' : '', temTrocas ? 'trocas pendentes' : ''].filter(Boolean);
  return `O fornecedor possui ${partes.join(' e ')}.`;
}

/**
 * AS PENDÊNCIAS E TROCAS DO FORNECEDOR no pedido de compra (as abas `TbsPendenciasFornecedor`/`TbsTrocas` do uPedidoCompra, abertas a
 * cada escolha do fornecedor — `AbrePendenciasFornecedor`/`AbreCdsTroca`) e as impressões delas, mais a "Conferência de Preço" do menu.
 */
@Injectable()
export class PedidoPendenciasService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** as lojas do pedido (o EMPRESAS digitado na tela); vazio = a do login */
  private lojas(empresas: string | undefined): number[] {
    return lojasDoPedido(empresas ?? '', this.emp());
  }

  /**
   * As duas abas e o aviso do `VerificaPendencias`: com AVISA_PENDENCIAS_FORNECEDOR = 'S' (a produção) a tela mostra a mensagem ao
   * escolher o fornecedor e ao editar; com 'B' o gravar bloqueia (o agregado); com 'N', nada.
   */
  async consultar(codparceiro: number, empresas?: string) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = this.lojas(empresas);
    const [pendencias, trocas] = await Promise.all([pendenciasDoFornecedor(db, codparceiro), trocasDoFornecedor(db, codparceiro, lojas)]);
    const aviso = String((await this.config.resolver('AVISA_PENDENCIAS_FORNECEDOR', { empresaId: this.emp(), operadorId: currentTenant().operadorId ?? null })) ?? 'N').trim().toUpperCase();
    // a razão vai no aviso do item ("Existem trocas em aberto para o fornecedor <razão>")
    const razao = (await sql<{ razao: string | null }>`SELECT razao FROM parceiros WHERE codparceiro = ${codparceiro}`.execute(db)).rows[0]?.razao ?? null;
    return { pendencias, trocas, empresas: lojas, aviso, razao, mensagem: mensagemPendencias(pendencias.length > 0, trocas.length > 0) };
  }

  /**
   * O "Imprimir" das abas (`MniImprimirPendenciasFornecedorClick`/`MniImprimirTrocasClick`): o PedCompraPendenciasFornecedor.fr3 /
   * PedCompraTrocas.fr3 com a grade (FDBPendenciasFornecedor / FDBTrocas) e o cabeçalho da tela (FDBPedidoCompra = o cdsPrincipal, que
   * pode ainda não estar gravado: número, emissão e vencimento vêm da tela; a razão do fornecedor, do cadastro). Grade vazia: a mensagem.
   */
  async impressao(tipo: 'pendencias' | 'trocas', codparceiro: number, cab: { codpedcomp?: number | null; data?: string | null; dt_vencimento?: string | null; empresas?: string }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const pend = tipo === 'pendencias';
    const linhas = pend ? await pendenciasDoFornecedor(db, codparceiro) : await trocasDoFornecedor(db, codparceiro, this.lojas(cab.empresas));
    if (!linhas.length) {
      throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', { tipo }, pend ? 'Não foram encontradas pendências para o fornecedor.' : 'Nenhuma troca foi encontrada.');
    }
    const razao = (await sql<{ razao: string | null }>`SELECT razao FROM parceiros WHERE codparceiro = ${codparceiro}`.execute(db)).rows[0]?.razao ?? null;
    const dia = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(0, 10)}T00:00:00` : null);
    const pedido = registroFr3({ codpedcomp: cab.codpedcomp ?? null, data: dia(cab.data), dt_vencimento: dia(cab.dt_vencimento), razao, codparceiro });
    const nums = await colunasNumericas(db, ['areceber'], pend ? [] : Object.keys(linhas[0]).filter((k) => /^emp\d+$/.test(k)));
    return {
      titulo: pend ? 'Pendências do fornecedor' : 'Trocas pendentes',
      modelo: await modeloFr3(db, pend ? 'PedCompraPendenciasFornecedor.fr3' : 'PedCompraTrocas.fr3'),
      datasets: { [pend ? 'FDBPendenciasFornecedor' : 'FDBTrocas']: linhas.map((l) => registroFr3(l, nums)), FDBPedidoCompra: [pedido] },
    };
  }

  /**
   * "Imprimir Conferência de Preço" (`ImprimirConfernciadePreo1Click`): o conf - conferencia de preco pedcomp.fr3 com os itens do pedido
   * (frxDBDataset2 = cdsPedidoCompra_I, na ordem da descrição: código de barras, descrição e o preço de venda do item) e o cabeçalho
   * (frxDBDataset3 = cdsPedidoCompra). O legado só faz `ShowReport`: imprime mesmo sem item.
   */
  async conferenciaPreco(codpedcomp: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const cab = (await sql<Linha>`
      SELECT p.codpedcomp, to_char(p.data, ${DH}) AS data, to_char(p.dt_vencimento, ${DH}) AS dt_vencimento, p.codparceiro, f.razao, p.empresas
        FROM pedidocompra p
        LEFT JOIN parceiros f ON f.codparceiro = p.codparceiro
       WHERE p.codpedcomp = ${codpedcomp} AND coalesce(p.indr, 'I') <> 'E'
         AND (p.idempresa = ${emp} OR ${String(emp)} = ANY(string_to_array(replace(coalesce(p.empresas, ''), ' ', ''), ',')))`.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
    const itens = (await sql<Linha>`
      SELECT i.codpedcompi, i.idproduto, p.codbarra, p.descricao, i.vrvenda, i.vrcusto, i.vlrembalagem, i.qtde
        FROM pedidocompra_i i
        LEFT JOIN produtos p ON p.idproduto = i.idproduto
       WHERE i.codpedcomp = ${codpedcomp}
       ORDER BY p.descricao, i.codpedcompi`.execute(db)).rows;
    const nums = await colunasNumericas(db, ['pedidocompra_i', 'pedidocompra']);
    return {
      titulo: `Conferência de preço do pedido ${codpedcomp}`,
      modelo: await modeloFr3(db, 'conf - conferencia de preco pedcomp.fr3'),
      datasets: { frxDBDataset2: itens.map((r) => registroFr3(r, nums)), frxDBDataset3: [registroFr3(cab, nums)] },
    };
  }
}
