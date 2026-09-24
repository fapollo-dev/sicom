import { sql } from 'kysely';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { gravarHistorico } from '../../shared/crud/historico';
import { configNaTrx } from '../compras/pedido-heranca';
import { gerarLotesFilhos } from '../precificacao/lote-filho';

type AnyDB = any;
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * O PRODUTO NAS LOJAS (auditoria de esqueletos §4.1, lacunas 1-5). O cadastro do legado edita a linha de preço da
 * LOJA DA SESSÃO (`dmPrincipal.EmpresaCODEMPRESA`) e, a partir dela, mexe nas outras:
 *
 *  - INCLUSÃO (`SetaMulti_Preco(usInserted)`, udmCadProduto.pas:2680-2745; `SetaEstoque`, udmPrincipal.pas): uma
 *    MULTI_PRECO para cada empresa de EMPRESAS — com os valores numéricos da loja da sessão quando SINCRONIZA_PRECO_NF='S'
 *    (senão zero), ATIVO/ATIVO_COMPRA copiados (ou 'N' com ATIVA_PRODUTO_EMPRESA_ATUAL) e PROMOCAO nula —, uma ESTOQUE e
 *    uma ESTOQUE_DEP zeradas. Produção: 1.175 dos 1.179 produtos incluídos em 2026 têm 5 MULTI_PRECO e 5 ESTOQUE.
 *  - ALTERAÇÃO de VRVENDA ou da flag PROMOCAO (UCadProduto.pas:3087-3300), com SINCRONIZA_PRECO_NF='S' (as 5 empresas):
 *    (a) `SetaMulti_Preco(..., ValidaSelecaoEmpresas=True)` CLONA a linha da sessão nas empresas do operador que têm
 *        estoque do produto (`cdsEmpresa`: PERMISSOES × ESTOQUE) — no modo lote, com o VRVENDA já revertido. Produção,
 *        produto 1489 em 24/09 16:45: sessão na 2, a 52 recebe 6,99→5,99 e o custo 4→3,50, a 1 o custo; a 51, sem
 *        permissão do operador, fica de fora;
 *    (b) o LOTE (modo "gerar lote") ou o UPDATE direto (modo on-line) para cada produto do grupo de preço × essas
 *        empresas — mais o lote dos FILHOS (`GeraLoteFilho`) quando o VRVENDA mudou. Lotes 117180-117185: 1489 e o filho
 *        832304 nas empresas 1, 2 e 52.
 *    Sem a sincronização, só a empresa da sessão.
 * O modo vem de HABILITA_GERACAO_LOTE_PRODUTO resolvida com o escopo Módulo (Retaguarda): a empresa 52, só com o override
 * de módulo, gerou lote em 30 das 31 edições de VRVENDA de 2026.
 * ADIADO: a sincronização do atacarejo (MULTI_PRECO_ATACAREJO) e a tela de escolha das diferenças
 * (EXIBIR_TELA_SINCRONICACAO_MULTIPRECO = 'N' no cliente), o `CalcularValorCusto` do clone (os valores já vêm calculados).
 */

/** as colunas da linha de preço que o clone copia (`sqqMulti_PrecoEmpresas`, udmCadProduto.dfm:6081), menos IDEMPRESA,
 *  MARGEML2/MARGEML2V (`DesconsiderarCampos`) e DTULTPRECOALTERADO (o trigger carimba quando o preço muda) */
const CLONE = [
  'vrvenda', 'vrcustoreal', 'vrcusto', 'markup', 'promocao', 'vrpromo', 'icme', 'frete', 'seguro', 'despacessorio', 'icmst', 'ipi',
  'vrcustofiscal', 'frete2', 'margeml', 'creditoicm', 'creditopiscofins', 'debitoicm', 'debitopiscofins', 'vendaliq', 'lucrobrutov',
  'lucrobrutop', 'despopv', 'lucroliqv', 'lucroliqp', 'imprend', 'contsocial', 'markupfixo', 'ativo_compra', 'ativo', 'bonificacao',
  'margem_comissao', 'atacarejo_ativo', 'vrfcpst', 'vrcustoajuste', 'vrcustorep', 'vrvendasug', 'comissao', 'usa_flex', 'prod_exibe_forca_vendas',
];
/** as numéricas que a inclusão copia (só os campos float/currency do `cdsMultiPreco`) */
const NUMERICAS_INCLUSAO = [
  'vrvenda', 'vrcustoreal', 'vrcusto', 'markup', 'vrpromo', 'icme', 'frete', 'seguro', 'despacessorio', 'icmst', 'ipi', 'vrcustofiscal',
  'frete2', 'margeml', 'margeml2', 'creditoicm', 'creditopiscofins', 'debitoicm', 'debitopiscofins', 'vendaliq', 'lucrobrutov',
  'lucrobrutop', 'despopv', 'lucroliqv', 'lucroliqp', 'imprend', 'contsocial', 'margeml2v', 'markupfixo', 'bonificacao', 'margem_comissao',
  'vrfcpst', 'vrcustoajuste', 'vrcustorep', 'vrvendasug', 'comissao',
];
/** `FCamposHistorico` do SetaMulti_Preco (udmCadProduto.pas:2700-2722) */
const HISTORICO_CLONE = [
  'vrcusto', 'vrcustorep', 'vrvenda', 'atacarejo_ativo', 'ativo', 'ativo_compra', 'bonificacao', 'margem_comissao', 'despacessorio', 'ipi',
  'seguro', 'frete', 'frete2', 'icmst', 'icme', 'vrcustocsi', 'promocao', 'vrpromo', 'markupfixo', 'markup', 'vrfcpst', 'vrcustoajuste', 'vrvendasug',
];

let colunasMultiPreco: Set<string> | null = null;
async function colunasDoMultiPreco(trx: AnyDB): Promise<Set<string>> {
  if (colunasMultiPreco) return colunasMultiPreco;
  const r = (await sql<{ c: string }>`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'multi_preco'`.execute(trx)).rows;
  colunasMultiPreco = new Set(r.map((x) => x.c));
  return colunasMultiPreco;
}

function ctx() {
  const t = currentTenant();
  return { emp: t.empresaId ?? null, op: t.operadorId ?? null };
}

async function sincronizaPrecoNf(trx: AnyDB, emp: number): Promise<boolean> {
  const e = (await sql<{ s: string | null }>`SELECT sincroniza_preco_nf AS s FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
  return String(e?.s ?? '') === 'S';
}

/** o que o validar do UPDATE descobriu sobre a linha da sessão — o aposGravar o usa depois da gravação */
interface PrecoDaSessao {
  emp: number;
  vendaMudou: boolean;
  flagMudou: boolean;
  novoVenda: number;
  marcarPromo: boolean;
  valorPromo: number;
  markup: number;
  lote: boolean;
}
const CHAVE = '__precoDaSessao';

/**
 * No VALIDAR do update (dentro da transação, antes do delete+insert do detalhe): compara a linha da LOJA DA SESSÃO com o
 * banco. `ValorVendaAlterado` = VRVENDA mudou; `vAlterouFlagPromocao` = a flag PROMOCAO mudou (só o VRPROMO não conta,
 * :3087-3094). No modo lote, REVERTE no dto o que mudou (:3097-3115) — a linha grava com o preço antigo e o novo espera o
 * processamento do lote.
 */
export async function prepararPrecoDaSessao(dto: Record<string, unknown>, id: number, trx: AnyDB): Promise<void> {
  const { emp, op } = ctx();
  const precos = Array.isArray(dto.precos) ? (dto.precos as Array<Record<string, unknown>>) : null;
  if (emp == null || !precos) return;
  const linha = precos.find((p) => Number(p.idempresa) === emp);
  if (!linha) return;
  const atual = (await trx.selectFrom('multi_preco').select(['vrvenda', 'vrpromo', 'promocao'])
    .where('idproduto', '=', id).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!atual) return; // linha nova de preço: é inclusão, não alteração
  const novoVenda = n(linha.vrvenda);
  const vendaMudou = novoVenda !== n(atual.vrvenda);
  const flagMudou = String(linha.promocao ?? '') !== String(atual.promocao ?? '');
  if (!vendaMudou && !flagMudou) return;
  const lote = String((await configNaTrx(trx, 'HABILITA_GERACAO_LOTE_PRODUTO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N') === 'S';
  const info: PrecoDaSessao = {
    emp, vendaMudou, flagMudou, novoVenda, marcarPromo: String(linha.promocao ?? '') === 'S', valorPromo: n(linha.vrpromo), markup: n(linha.markup), lote,
  };
  if (lote) {
    if (vendaMudou) linha.vrvenda = atual.vrvenda;
    if (flagMudou) { linha.promocao = atual.promocao; linha.vrpromo = atual.vrpromo; }
  }
  Object.defineProperty(dto, CHAVE, { value: info, enumerable: false, configurable: true });
}

/** as empresas do `cdsEmpresa` (udmCadProduto.dfm:5227): as do operador em PERMISSOES que têm ESTOQUE do produto */
async function empresasDoOperador(trx: AnyDB, op: number | null, idproduto: number): Promise<number[]> {
  if (op == null) return [];
  const r = (await sql<{ e: number }>`
    SELECT DISTINCT p.codempresa AS e FROM permissoes p
      JOIN estoque s ON s.idempresa = p.codempresa AND s.idproduto = ${idproduto}
     WHERE p.codoperador = ${op}
     ORDER BY 1`.execute(trx)).rows;
  return r.map((x) => Number(x.e));
}

/** depois do UPDATE: o clone nas lojas do operador e o lote/update do grupo de preço (UCadProduto.pas:3132-3300) */
export async function sincronizarPrecoNasLojas(trx: AnyDB, id: number, dto: Record<string, unknown>): Promise<void> {
  const info = (dto as Record<string, unknown>)[CHAVE] as PrecoDaSessao | undefined;
  if (!info) return;
  const { op } = ctx();
  const emp = info.emp;
  const sincroniza = await sincronizaPrecoNf(trx, emp);
  const empresas = sincroniza ? await empresasDoOperador(trx, op, id) : [emp];
  const cols = await colunasDoMultiPreco(trx);

  // (a) o clone da linha da sessão (`SetaMulti_Preco(IDProduto, State, nil, emp, True)`, :3137)
  if (sincroniza) {
    const origem = (await trx.selectFrom('multi_preco').selectAll().where('idproduto', '=', id).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (origem) {
      const ativaSoAtual = String((await configNaTrx(trx, 'ATIVA_PRODUTO_EMPRESA_ATUAL', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N') === 'S';
      const campos = CLONE.filter((c) => cols.has(c))
        .filter((c) => !(c === 'markup' && n(origem.markup) === 0))
        .filter((c) => !(ativaSoAtual && (c === 'ativo' || c === 'ativo_compra')));
      for (const e of empresas) {
        if (e === emp) continue;
        const antes = (await trx.selectFrom('multi_preco').selectAll().where('idproduto', '=', id).where('idempresa', '=', e).executeTakeFirst()) as Record<string, unknown> | undefined;
        if (!antes) continue;
        const set = Object.fromEntries(campos.map((c) => [c, origem[c] ?? null]));
        await trx.updateTable('multi_preco').set(set).where('idproduto', '=', id).where('idempresa', '=', e).execute();
        const depois = Object.fromEntries(HISTORICO_CLONE.filter((c) => c in set).map((c) => [c, set[c]]));
        await gravarHistorico(trx, { tabela: 'multi_preco', pk: 'idproduto', origem: null as unknown as string }, id, op, e, antes, depois, 'Precificação do Custo');
      }
    }
  }

  // (b) o grupo de preço × as empresas (:3160-3250)
  const prod = (await sql<{ g: number | null }>`SELECT codgrupopreco AS g FROM produtos WHERE idproduto = ${id}`.execute(trx)).rows[0];
  const grupo = n(prod?.g);
  const zeroNaoAtualiza = String((await configNaTrx(trx, 'ATUALIZAR_GRUPOPRECO_PRODUTO_VRVENDA_ZERO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'S') === 'N';
  let alvos: Array<{ idempresa: number; idproduto: number; pai: number }>;
  if (grupo > 0 && !(info.novoVenda === 0 && zeroNaoAtualiza)) {
    alvos = (await sql<{ idempresa: number; idproduto: number; pai: number | null }>`
      SELECT m.idempresa, p.idproduto, p.idproduto_pai AS pai FROM produtos p JOIN multi_preco m ON m.idproduto = p.idproduto
       WHERE p.codgrupopreco = ${grupo} AND m.idempresa = ANY(${empresas}::int[]) ORDER BY p.idproduto, m.idempresa`.execute(trx)).rows
      .map((r) => ({ idempresa: Number(r.idempresa), idproduto: Number(r.idproduto), pai: n(r.pai) }));
  } else {
    const exibeTela = String((await configNaTrx(trx, 'EXIBIR_TELA_SINCRONICACAO_MULTIPRECO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N') === 'S';
    alvos = exibeTela ? [] : (await sql<{ idempresa: number; idproduto: number; pai: number | null }>`
      SELECT m.idempresa, p.idproduto, p.idproduto_pai AS pai FROM produtos p JOIN multi_preco m ON m.idproduto = p.idproduto
       WHERE p.idproduto = ${id} AND m.idempresa = ANY(${empresas}::int[]) ORDER BY m.idempresa`.execute(trx)).rows
      .map((r) => ({ idempresa: Number(r.idempresa), idproduto: Number(r.idproduto), pai: n(r.pai) }));
  }
  if (info.lote) {
    const nomeOp = (await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined;
    const obs = `REFERENTE AO AJUSTE NO CADASTRO DO PRODUTO REALIZADO PELO OPERADOR: ${op ?? ''}-${(nomeOp?.nome ?? '').trim()}`.slice(0, 300);
    for (const a of alvos) {
      // `NovoLotePreco` (:7993): MARKUP só quando > 0; ALTEROUPROMOCAO/PROMOCAO/VRPROMO da flag
      await trx.insertInto('lote_preco').values({
        idproduto: a.idproduto, codempresa: a.idempresa, vrvenda: info.novoVenda,
        ...(info.markup > 0 ? { markup: info.markup } : {}),
        promocao: info.marcarPromo ? 'S' : 'N', vrpromo: info.valorPromo, alteroupromocao: info.flagMudou ? 'S' : 'N',
        datalote: sql`now()`, obs, origem: 'P', codoperador: op, processado: 'N',
      }).execute();
      // o lote dos FILHOS do produto sem pai, quando o VRVENDA mudou (`GeraLoteFilho`, :3256)
      if (a.pai === 0 && info.vendaMudou) await gerarLotesFilhos(trx, a.idproduto, a.idempresa, info.novoVenda, null);
    }
  } else {
    // modo on-line: o UPDATE de cada linha do grupo × empresas (cdsMultiPreco_Alteracao, :3262-3290) + HISTORICO_DINAMICO
    for (const a of alvos) {
      const linhaAntes = (await trx.selectFrom('multi_preco').select(['vrvenda', 'promocao', 'vrpromo']).where('idproduto', '=', a.idproduto).where('idempresa', '=', a.idempresa).executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!linhaAntes) continue;
      // numeric do pg vem como '13.9000': compara como número, senão o histórico registra "13.9000 → 13.9"
      const antes = { vrvenda: linhaAntes.vrvenda == null ? null : n(linhaAntes.vrvenda), promocao: linhaAntes.promocao, vrpromo: linhaAntes.vrpromo == null ? null : n(linhaAntes.vrpromo) };
      const set: Record<string, unknown> = {};
      if (info.vendaMudou) set.vrvenda = info.novoVenda;
      if (info.flagMudou) { set.promocao = info.marcarPromo ? 'S' : 'N'; set.vrpromo = info.valorPromo; }
      if (a.idproduto === id && a.idempresa === emp) {
        // a linha da própria sessão já gravou pelo delete+insert — que não dispara o trigger do preço: a etiqueta volta a
        // "reimprimir" e a data da última alteração é carimbada aqui (lacuna 5 da auditoria)
        await trx.updateTable('multi_preco').set({ etq_impressa: 'N', dtultprecoalterado: sql`now()` }).where('idproduto', '=', id).where('idempresa', '=', emp).execute();
      } else {
        await trx.updateTable('multi_preco').set(set).where('idproduto', '=', a.idproduto).where('idempresa', '=', a.idempresa).execute();
      }
      await gravarHistorico(trx, { tabela: 'multi_preco', pk: 'idproduto', origem: null as unknown as string }, a.idproduto, op, a.idempresa, antes, set, 'Cadastro de produtos');
    }
  }
}

/** depois do CREATE: a MULTI_PRECO, a ESTOQUE e a ESTOQUE_DEP de cada empresa (udmCadProduto.pas:2745; udmPrincipal `SetaEstoque`) */
export async function incluirNasLojas(trx: AnyDB, id: number): Promise<void> {
  const { emp, op } = ctx();
  if (emp == null) return;
  const empresas = (await sql<{ e: number }>`SELECT idempresa AS e FROM empresas ORDER BY idempresa`.execute(trx)).rows.map((r) => Number(r.e));
  const origem = (await trx.selectFrom('multi_preco').selectAll().where('idproduto', '=', id).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (origem) {
    const cols = await colunasDoMultiPreco(trx);
    const sincroniza = await sincronizaPrecoNf(trx, emp);
    const ativaSoAtual = String((await configNaTrx(trx, 'ATIVA_PRODUTO_EMPRESA_ATUAL', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N') === 'S';
    const numericas = NUMERICAS_INCLUSAO.filter((c) => cols.has(c));
    for (const e of empresas) {
      if (e === emp) continue;
      const existe = await trx.selectFrom('multi_preco').select('idproduto').where('idproduto', '=', id).where('idempresa', '=', e).executeTakeFirst();
      if (existe) continue;
      const linha: Record<string, unknown> = { idproduto: id, idempresa: e };
      for (const c of numericas) linha[c] = sincroniza ? origem[c] ?? 0 : 0;
      linha.ativo = ativaSoAtual ? 'N' : origem.ativo ?? null;
      linha.ativo_compra = ativaSoAtual ? 'N' : origem.ativo_compra ?? null;
      if (cols.has('usa_flex')) linha.usa_flex = origem.usa_flex ?? null;
      linha.promocao = null;
      await trx.insertInto('multi_preco').values(linha).execute();
    }
  }
  // ESTOQUE das outras empresas (a da sessão veio do formulário) e ESTOQUE_DEP de todas — zeradas
  await sql`INSERT INTO estoque (idproduto, idempresa, qtde, minimo, maximo)
            SELECT ${id}, e.idempresa, 0, 0, 0 FROM empresas e
             WHERE NOT EXISTS (SELECT 1 FROM estoque s WHERE s.idproduto = ${id} AND s.idempresa = e.idempresa)`.execute(trx);
  await sql`INSERT INTO estoque_dep (idproduto, idempresa, qtde, minimo, maximo)
            SELECT ${id}, e.idempresa, 0, 0, 0 FROM empresas e
             WHERE NOT EXISTS (SELECT 1 FROM estoque_dep d WHERE d.idproduto = ${id} AND d.idempresa = e.idempresa)`.execute(trx);
}
