import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, dataBr, empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;

export const ABAS_HISTORICO = ['vendas', 'pedidos', 'pedido-compra', 'entradas', 'saidas', 'estoque', 'fornecedores', 'promocao', 'inventario-rotativo'] as const;
export type AbaHistorico = (typeof ABAS_HISTORICO)[number];
export interface FiltroHistorico { dtini?: string; dtfim?: string; empresas?: number[] }

/** a data/hora como o dataset do Delphi a entrega (o fuso da sessão é o da loja): o motor do .fr3 lê 'AAAA-MM-DDTHH:MM:SS' como TDateTime */
const DH = 'YYYY-MM-DD"T"HH24:MI:SS';
const soma = (linhas: Linha[], campo: string) => Math.round(linhas.reduce((s, l) => s + Number(l[campo] ?? 0), 0) * 1000) / 1000;
const SEM_INFORMACOES = 'Não existe informações para serem impressas. Verifique !!!';

/** o layout de cada aba que imprime (o `frxReport.LoadFromFile` do botão) e o nome do dataset que ele lê */
const IMPRESSOES: Partial<Record<AbaHistorico, { arquivo: string; dataset: string; titulo: string }>> = {
  vendas: { arquivo: 'Rel_HistoricoVendasPedidos.fr3', dataset: 'frxDBDtsVendas', titulo: 'Histórico de vendas' },
  pedidos: { arquivo: 'Rel_HistoricoVendasPedidos.fr3', dataset: 'frxDBDtsVendas', titulo: 'Histórico de pedidos' },
  entradas: { arquivo: 'Rel_HistoricoEntradas.fr3', dataset: 'frxDBDtsEntradas', titulo: 'Histórico de entradas' },
  saidas: { arquivo: 'Rel_HistoricoSaidas.fr3', dataset: 'frxDBDtsSaidas', titulo: 'Histórico de saídas' },
  estoque: { arquivo: 'Rel_FichaKardex.fr3', dataset: 'frxDBDtsHistoricoProd', titulo: 'Ficha kardex' },
  'inventario-rotativo': { arquivo: 'Rel_Cad_Prod_Hist_InvRotResumido.fr3', dataset: 'frxDBPadrao', titulo: 'Inventário rotativo do produto' },
};

/**
 * HISTÓRICO DAS MOVIMENTAÇÕES do cadastro de produto (aba `TbsHistoricoMovimentacoes` do UCadProduto; Tag 20 = consulta liberada fora da
 * edição, botões com Tag 5 = sem permissão de controle: vale o acesso à tela). Cada sub-aba é a consulta do legado com o período e as lojas
 * dela, e o "Imprimir" carrega o layout .fr3 do cliente com o mesmo dataset.
 *  - Vendas/Pedidos (`btnConsClick`): VENDAS ou PEDIDOS (tipo 'P'); na VENDAS o produto também casa pelo filho; o total do pedido soma o
 *    desconto/acréscimo do item; lojas do `GetMultiEmpresa`.
 *  - Pedido de compra (`sqqPedCompra`): uma linha por loja do rateio (PEDIDO_COMPRA_QTDE com qtde) e por nota de entrada do pedido.
 *  - Notas de entrada/saída (`ssqlHistoricoEntradas`/`sqqNF_Saida`): pela data CONTÁBIL, só as não canceladas.
 *  - Estoque — kardex (`sqqHistorico`, no SQL do binário novo — V$SQL da produção, 01/10/2026): o histórico ganha o documento de origem
 *    (NFC-e/NF-e com série) e as colunas CODNF/NRONF; UMA loja (`GetMultiEmpresa(False)`: o diálogo de loja única).
 *  - Fornecedores (`BtnBuscarFornecedoresClick`): a última entrada (fora as devoluções) de cada fornecedor no período.
 *  - Promoção (`QryHistPromo`): as agendas do produto que começam e terminam dentro do período (sem filtro de loja).
 *  - Inventário rotativo (`QryHistInvRot`): a diferença de quantidade de cada lote fechado no período, na loja do login.
 */
@Injectable()
export class ProdutoHistoricoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private periodo(f: FiltroHistorico): { ini: string; fim: string } {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!f.dtini || !f.dtfim || !iso.test(f.dtini) || !iso.test(f.dtfim)) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    return { ini: f.dtini, fim: f.dtfim };
  }

  async consultar(idproduto: number, aba: AbaHistorico, f: FiltroHistorico): Promise<{ linhas: Linha[]; totais: Record<string, number>; empresas: number[] }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const p = this.periodo(f);
    switch (aba) {
      case 'vendas':
      case 'pedidos': {
        const empresas = await empresasDoOperador(db, f.empresas);
        const linhas = await this.vendas(db, idproduto, aba, p, empresas);
        return { linhas, totais: { total_qtde: soma(linhas, 'qtde') }, empresas };
      }
      case 'pedido-compra': {
        const empresas = await empresasDoOperador(db, f.empresas);
        const linhas = await this.pedidoCompra(db, idproduto, p, empresas);
        return { linhas, totais: { total_qtde: soma(linhas, 'qtde') }, empresas };
      }
      case 'entradas':
      case 'saidas': {
        const empresas = await empresasDoOperador(db, f.empresas);
        const linhas = await this.notas(db, idproduto, aba === 'entradas' ? 'E' : 'S', p, empresas);
        return {
          linhas,
          totais: { total_qtde: soma(linhas, 'qtdembal'), total_qtde_processada: soma(linhas, 'qtdprocessada'), total_qtde_nao_processada: soma(linhas, 'qtdnaoprocessada') },
          empresas,
        };
      }
      case 'estoque': {
        // o diálogo de UMA loja (GetMultiEmpresa(False, '', True)): a primeira marcada; nenhuma = a do login
        const empresas = (await empresasDoOperador(db, f.empresas)).slice(0, 1);
        return { linhas: await this.kardex(db, idproduto, p, empresas[0]), totais: {}, empresas };
      }
      case 'fornecedores': {
        const empresas = await empresasDoOperador(db, f.empresas);
        return { linhas: await this.fornecedores(db, idproduto, p, empresas), totais: {}, empresas };
      }
      case 'promocao':
        return { linhas: await this.promocao(db, idproduto, p), totais: {}, empresas: [] };
      case 'inventario-rotativo': {
        const emp = this.emp();
        return { linhas: await this.inventarioRotativo(db, idproduto, p, emp), totais: {}, empresas: [emp] };
      }
      default:
        throw new BusinessRuleError('HISTORICO_ABA_DESCONHECIDA', { aba });
    }
  }

  /**
   * O "Imprimir" da sub-aba: o layout do cliente com o dataset da consulta. Sem linha, a mensagem do legado. As variáveis são as do botão
   * (o período como o `QuotedStr(edt.Text)`; a Empresa é a do login, sem aspas). A ficha kardex leva também a empresa do login
   * (frxDBDtsEmpresa = `dmPrincipal.Empresa`); o logotipo (`images\logorel.jpg` da estação) não está no banco.
   */
  async impressao(idproduto: number, aba: AbaHistorico, f: FiltroHistorico) {
    const imp = IMPRESSOES[aba];
    if (!imp) throw new BusinessRuleError('HISTORICO_SEM_IMPRESSAO', { aba });
    const { linhas } = await this.consultar(idproduto, aba, f);
    if (!linhas.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', { aba }, SEM_INFORMACOES);
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const nums = await colunasNumericas(db, ['vendas', 'pedidos', 'nf', 'nf_prod', 'historico_prod', 'inventario_rotativo'],
      ['total', 'qtdembal', 'qtdprocessada', 'qtdnaoprocessada', 'entrada', 'saida', 'qtde_atual', 'diferenca_qtd', 'codnf']);
    const variaveis: Record<string, string> = { DtInicial: textoVariavel(dataBr(f.dtini)), DtFinal: textoVariavel(dataBr(f.dtfim)) };
    if (aba !== 'estoque') variaveis.Empresa = String(emp);
    const datasets: Record<string, Linha[]> = { [imp.dataset]: linhas.map((l) => registroFr3(l, nums)) };
    if (aba === 'estoque') datasets.frxDBDtsEmpresa = [await empresaParaRelatorio(db, emp)];
    return { titulo: imp.titulo, modelo: await modeloFr3(db, imp.arquivo), datasets, variaveis };
  }

  /**
   * "Imprimir" da composição (`btnImprimirComposicaoClick`): o Rel_ComposicaoProduto.fr3 com os itens do kit (`sqqComposicao`: o item com
   * a chave de composição do produto, na ordem da descrição) e o código de barras e a descrição do produto nos memos do cabeçalho.
   */
  async impressaoComposicao(idproduto: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const prod = (await sql<Linha>`SELECT codbarra, descricao FROM produtos WHERE idproduto = ${idproduto}`.execute(db)).rows[0];
    if (!prod) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto });
    const itens = (await sql<Linha>`
      SELECT c.codcomp, c.idproduto, c.qtde, c.valor, c.idproduto_01, p.codbarra, p.descricao, c.chavecomposicao
        FROM composicao c
        JOIN produtos p     ON p.idproduto = c.idproduto_01
        JOIN produtos pcomp ON pcomp.idproduto = c.idproduto AND pcomp.chavecomposicao IS NOT DISTINCT FROM c.chavecomposicao
       WHERE c.idproduto = ${idproduto}
       ORDER BY p.descricao`.execute(db)).rows;
    const nums = await colunasNumericas(db, ['composicao']);
    return {
      titulo: `Composição do produto ${idproduto}`,
      modelo: await modeloFr3(db, 'Rel_ComposicaoProduto.fr3'),
      datasets: { frxDBDComposicao: itens.map((r) => registroFr3(r, nums)) },
      textos: { memoCodBarra: String(prod.codbarra ?? ''), memoDescricao: String(prod.descricao ?? '') },
    };
  }

  private async vendas(db: AnyDB, id: number, aba: 'vendas' | 'pedidos', p: { ini: string; fim: string }, empresas: number[]): Promise<Linha[]> {
    const venda = aba === 'vendas';
    const tabela = sql.table(venda ? 'vendas' : 'pedidos');
    return (await sql<Linha>`
      SELECT to_char(v.dtvenda, ${DH}) AS dtvenda, v.nropedido, v.vrvenda, v.idempresa, v.qtde,
             v.qtde * ${venda ? sql`v.vrvenda` : sql`(v.vrvenda + v.desc_acre_item)`} AS total,
             v.promocao, p.razao, ve.razao AS razao_1, ${venda ? sql`v.nrocupom::varchar(20)` : sql`''::varchar(20)`} AS nrocupom,
             prod.descricao, prod.codbarra
        FROM ${tabela} v
        LEFT JOIN parceiros p    ON p.codparceiro = v.codparceiro
        LEFT JOIN parceiros ve   ON ve.codparceiro = v.codvendedor
        LEFT JOIN produtos prod  ON prod.idproduto = v.codproduto
       WHERE v.dtvenda >= ${p.ini}::date AND v.dtvenda < ${p.fim}::date + 1
         AND ${venda ? sql`(v.codproduto = ${id} OR v.idproduto_filho = ${id})` : sql`v.codproduto = ${id} AND v.tipo = 'P'`}
         AND coalesce(v.cancelado, 'N') = 'N'
         AND v.idempresa = ANY(${empresas}::int[])
       ORDER BY v.dtvenda, v.nropedido`.execute(db)).rows;
  }

  /**
   * As lojas pelo texto EMPRESAS do pedido. O fonte (mai/2020) compara `REPLACE(EMPRESAS,' ','') LIKE '%,<loja>,%'`, e a produção grava
   * '1' e '1, 2' (13.085 de 13.085 pedidos, 01/10/2026): sem vírgula nas pontas o LIKE só casa a loja do MEIO da lista e a aba volta vazia
   * para quase todo pedido. Aqui a lista ganha as vírgulas das pontas — a intenção do LIKE (o pedido que inclui uma das lojas marcadas).
   */
  private async pedidoCompra(db: AnyDB, id: number, p: { ini: string; fim: string }, empresas: number[]): Promise<Linha[]> {
    const padroes = empresas.map((e) => `%,${e},%`);
    return (await sql<Linha>`
      SELECT pc.codpedcomp, pc.empresas, nf.nronf, to_char(pc.data, ${DH}) AS data, q.idempresa, q.qtde, i.vlrembalagem,
             (q.qtde * i.vlrembalagem)::numeric(13,2) AS total, c.razao,
             CASE WHEN pc.fechado = 'S' THEN 'FECHADO' ELSE 'ABERTO' END AS proc, i.idproduto
        FROM pedidocompra pc
        JOIN parceiros c        ON c.codparceiro = pc.codparceiro
        JOIN pedidocompra_i i   ON i.codpedcomp = pc.codpedcomp
        LEFT JOIN pedido_compra_qtde q ON q.codpedcompi = i.codpedcompi AND q.qtde > 0
        LEFT JOIN pedido_nf n   ON pc.codpedcomp = n.codpedido AND n.tipo = 'P'
        LEFT JOIN nf nf         ON nf.codnf = n.codnf AND nf.tipo = 'E'
       WHERE i.idproduto = ${id}
         AND pc.data >= ${p.ini}::date AND pc.data < ${p.fim}::date + 1
         AND (',' || replace(coalesce(pc.empresas, ''), ' ', '') || ',') LIKE ANY(${padroes}::text[])
       ORDER BY pc.data::date, q.idempresa`.execute(db)).rows;
  }

  private async notas(db: AnyDB, id: number, tipo: 'E' | 'S', p: { ini: string; fim: string }, empresas: number[]): Promise<Linha[]> {
    return (await sql<Linha>`
      SELECT a.codnf, to_char(a.dtemissao, ${DH}) AS dtemissao, a.nronf, a.idempresa, b.quantidade, b.vrcusto, b.quantidade * b.vrcusto AS total,
             c.razao, CASE WHEN a.proc = 'S' THEN 'PROCESSADA' ELSE 'NÃO PROCESSADA' END AS proc,
             CASE WHEN a.proc = 'S' THEN b.quantidade * b.fatorembal ELSE 0 END AS qtdprocessada,
             CASE WHEN a.proc = 'S' THEN 0 ELSE b.quantidade * b.fatorembal END AS qtdnaoprocessada,
             b.quantidade * b.fatorembal AS qtdembal, p.codbarra, p.descricao
        FROM nf a
        JOIN nf_prod b    ON b.codnf = a.codnf
        JOIN parceiros c  ON c.codparceiro = a.codparceiro
        JOIN produtos p   ON p.idproduto = b.codproduto
       WHERE a.tipo = ${tipo} AND b.codproduto = ${id}
         AND a.dtcontabil BETWEEN ${p.ini}::date AND ${p.fim}::date
         AND a.cancelada = 'N'
         AND a.idempresa = ANY(${empresas}::int[])
       ORDER BY a.dtemissao, a.codnf`.execute(db)).rows;
  }

  /**
   * O kardex do binário novo. O movimento assinado é saldo novo − saldo anterior (a carga guarda o QTDE_ALTER do legado assim; os
   * movimentos do Apollo gravam a quantidade positiva com o tipo do documento — na reversão o tipo não diz o sentido). O documento:
   *  - ORIGEM_DOCUMENTO 'VENDAS' → o cupom (NFC-e e série) pelo CODVENDAS do legado; 'NF' → a NF-e; 'PEDIDOS' → o documento do pedido;
   *  - sem origem e com CODNF → a NF-e ('NF-E'/'SERIE' em maiúsculas, como no SQL da produção). As notas processadas pelo Apollo gravam a
   *    origem 'NF' com o CODNF e sem ID_ORIGEM_DOCUMENTO: caem neste ramo, como as do legado (que não têm origem) — as origens só valem com
   *    o ID do documento.
   */
  private async kardex(db: AnyDB, id: number, p: { ini: string; fim: string }, emp: number): Promise<Linha[]> {
    return (await sql<Linha>`
      SELECT h.idproduto, to_char(h.data, ${DH}) AS data,
             CASE WHEN h.saldo_novo - h.saldo_anterior > 0 THEN h.saldo_novo - h.saldo_anterior ELSE 0 END AS entrada,
             CASE WHEN h.saldo_novo - h.saldo_anterior < 0 THEN h.saldo_novo - h.saldo_anterior ELSE 0 END AS saida,
             h.saldo_novo AS qtde_atual,
             CASE WHEN r.tipo = 'NF' AND n.codnf IS NOT NULL THEN concat(h.historico, ' NF-e ', n.nronf, '--Serie ', n.serie)
                  WHEN r.tipo = 'NFCOD' AND n.codnf IS NOT NULL THEN concat(h.historico, ' NF-E ', n.nronf, '--SERIE ', n.serie)
                  WHEN r.tipo = 'VENDAS' AND v.codvendas IS NOT NULL THEN concat(h.historico, ' NFC-e ', v.nrocupom, '--Serie ', v.nroserie)
                  ELSE h.historico END AS historico,
             pi.codbarra, pi.descricao, pi.unidade, h.idempresa,
             CASE WHEN r.tipo IN ('NF', 'NFCOD') THEN n.codnf WHEN r.tipo = 'VENDAS' THEN v.codvendas ELSE 0 END AS codnf,
             CASE WHEN r.tipo IN ('NF', 'NFCOD') AND n.codnf IS NOT NULL THEN concat(' NF ', n.nronf)
                  WHEN r.tipo = 'VENDAS' AND v.codvendas IS NOT NULL THEN concat(' CUPOM ', v.nrocupom) ELSE '' END AS nronf,
             h.id_origem_documento, h.origem, h.codmov
        FROM historico_prod h
        LEFT JOIN produtos pi ON pi.idproduto = h.idproduto
        LEFT JOIN LATERAL (SELECT pd.origem_documento, pd.id_origem_documento FROM pedidos pd
                            WHERE h.origem = 'PEDIDOS' AND pd.codpedidos = h.id_origem_documento LIMIT 1) ped ON true
        CROSS JOIN LATERAL (SELECT
             CASE WHEN h.origem = 'PEDIDOS' AND h.id_origem_documento IS NOT NULL THEN ped.origem_documento
                  WHEN h.origem IN ('VENDAS', 'NF') AND h.id_origem_documento IS NOT NULL THEN h.origem
                  WHEN coalesce(h.codnf, 0) > 0 AND h.id_origem_documento IS NULL THEN 'NFCOD' END AS tipo,
             CASE WHEN h.origem = 'PEDIDOS' THEN ped.id_origem_documento
                  WHEN h.id_origem_documento IS NOT NULL THEN h.id_origem_documento ELSE h.codnf END AS doc) r
        LEFT JOIN LATERAL (SELECT nf.codnf, nf.nronf, nf.serie FROM nf WHERE r.tipo IN ('NF', 'NFCOD') AND nf.codnf = r.doc LIMIT 1) n ON true
        LEFT JOIN LATERAL (SELECT vd.codvendas_legado AS codvendas, vd.nrocupom, vd.nroserie FROM vendas vd
                            WHERE r.tipo = 'VENDAS' AND vd.codvendas_legado = r.doc LIMIT 1) v ON true
       WHERE h.idproduto = ${id}
         AND h.data >= ${p.ini}::date AND h.data < ${p.fim}::date + 1
         AND h.idempresa = ${emp}
       ORDER BY h.data, h.codmov`.execute(db)).rows;
  }

  private async fornecedores(db: AnyDB, id: number, p: { ini: string; fim: string }, empresas: number[]): Promise<Linha[]> {
    return (await sql<Linha>`
      SELECT DISTINCT n.codparceiro, par.fantasia, n.idempresa, to_char(n.dtemissao, ${DH}) AS dtemissao
        FROM nf n
        JOIN (SELECT max(n2.codnf) AS codnf
                FROM nf n2
                JOIN nf_prod np2 ON np2.codnf = n2.codnf
                JOIN (SELECT n1.codparceiro, max(n1.dtemissao) AS dtemissao
                        FROM nf n1
                        JOIN nf_prod np ON np.codnf = n1.codnf
                       WHERE n1.tipo = 'E' AND n1.dtemissao BETWEEN ${p.ini}::date AND ${p.fim}::date
                         AND np.codproduto = ${id} AND n1.idempresa = ANY(${empresas}::int[]) AND coalesce(n1.finalidade, '1') <> '4'
                       GROUP BY n1.codparceiro) ndata ON ndata.codparceiro = n2.codparceiro AND ndata.dtemissao = n2.dtemissao
               WHERE n2.tipo = 'E' AND np2.codproduto = ${id} AND n2.idempresa = ANY(${empresas}::int[]) AND coalesce(n2.finalidade, '1') <> '4'
               GROUP BY n2.codparceiro) nfor ON nfor.codnf = n.codnf
        JOIN parceiros par ON par.codparceiro = n.codparceiro
       ORDER BY par.fantasia, n.codparceiro`.execute(db)).rows;
  }

  private async promocao(db: AnyDB, id: number, p: { ini: string; fim: string }): Promise<Linha[]> {
    return (await sql<Linha>`
      SELECT p.idproduto, p.codbarra, p.descricao, a.nomepromo AS promocao, to_char(a.dtiniciopromocao, ${DH}) AS dtiniciopromocao,
             to_char(a.dtfimpromocao, ${DH}) AS dtfimpromocao, i.vlrpromocao, i.empresas, coalesce(i.vrvenda, 0) AS vrvenda
        FROM agenda_promocao_itens i
        LEFT JOIN agenda_promocao a ON a.codagenda = i.codagenda
        LEFT JOIN produtos p        ON p.idproduto = i.idproduto
       WHERE i.idproduto = ${id}
         AND a.dtiniciopromocao::date >= ${p.ini}::date
         AND a.dtfimpromocao::date <= ${p.fim}::date
       ORDER BY a.dtiniciopromocao, a.codagenda`.execute(db)).rows;
  }

  /**
   * `QryHistInvRot` (resumido — "somente a última operação"): os lotes FECHADOS no período na loja do login; por lote, a coleta somada
   * desde a última substituição menos a quantidade anterior da primeira, no último registro do produto (destino LOJA ou DEPÓSITO).
   */
  private async inventarioRotativo(db: AnyDB, id: number, p: { ini: string; fim: string }, emp: number): Promise<Linha[]> {
    return (await sql<Linha>`
      WITH temp_lote AS (
        SELECT i.lote FROM inventario_rotativo i
         WHERE i.data >= ${p.ini}::date AND i.data < ${p.fim}::date + 1 AND i.idempresa = ${emp} AND i.operacao = 'FECHADO')
      SELECT t.lote, sum(t.qtd_coletada - t.qtd_anterior) AS diferenca_qtd, to_char(i.data::date, 'YYYY-MM-DD"T"00:00:00') AS data,
             t.idproduto, p.codbarra, p.descricao
        FROM (SELECT i.*,
                     (SELECT sum(x.qtd_coletada) FROM inventario_rotativo x
                       WHERE x.idproduto = i.idproduto AND x.codinv_rotativo >= col.col_codinv_rotativo AND x.idempresa = ${emp} AND x.lote = i.lote) AS qtd_coletada,
                     (SELECT x.qtd_anterior FROM inventario_rotativo x WHERE x.codinv_rotativo = ant.ant_codinv_rotativo) AS qtd_anterior
                FROM (SELECT i.idempresa, i.idproduto, min(i.codinv_rotativo) AS codinv_rotativo_ini, max(i.codinv_rotativo) AS codinv_rotativo_fin, i.lote
                        FROM inventario_rotativo i
                       WHERE i.idempresa = ${emp}
                         AND EXISTS (SELECT 1 FROM temp_lote t WHERE t.lote = i.lote)
                         AND i.idproduto = ${id} AND i.operacao <> 'FECHADO'
                       GROUP BY i.lote, i.idproduto, i.idempresa) i
                LEFT JOIN (SELECT coalesce(lote, 0) AS lote, idproduto, idempresa, max(codinv_rotativo) AS col_codinv_rotativo
                             FROM inventario_rotativo WHERE operacao = 'SUBSTITUIR' AND idempresa = ${emp}
                            GROUP BY inventario_rotativo.lote, idproduto, idempresa) col
                       ON col.lote = i.lote AND col.idproduto = i.idproduto AND col.idempresa = i.idempresa
                LEFT JOIN (SELECT coalesce(lote, 0) AS lote, idproduto, idempresa, min(codinv_rotativo) AS ant_codinv_rotativo
                             FROM inventario_rotativo WHERE operacao = 'SUBSTITUIR' AND idempresa = ${emp}
                            GROUP BY inventario_rotativo.lote, idproduto, idempresa) ant
                       ON ant.lote = i.lote AND ant.idproduto = i.idproduto AND ant.idempresa = i.idempresa) t
        JOIN inventario_rotativo i ON t.codinv_rotativo_fin = i.codinv_rotativo
        LEFT JOIN produtos p ON p.idproduto = i.idproduto
       WHERE i.destino IN ('LOJA', 'DEPOSITO')
       GROUP BY t.lote, t.idproduto, p.codbarra, p.descricao, t.idempresa, t.qtd_coletada, t.qtd_anterior, i.qtd_atual, i.codinv_rotativo,
                i.data, i.destino, i.operador, i.operacao
       ORDER BY t.lote`.execute(db)).rows;
  }
}
