import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, dataLocal, empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';
import { totalNfLegado } from './nf-total';
import { configNaTrx } from '../compras/pedido-heranca';
import { arred, calcValorCusto, custoDoItemNaEntrada, type EmpresaCusto } from './nf-custo-item';

type AnyDB = Kysely<any>;
type Registro = Record<string, unknown>;

/**
 * AS IMPRESSÕES DA NF (o menu da tela, `uNF.pas:13541-13635`) — o legado carrega o .fr3 do cliente e imprime com os datasets da
 * tela: `dbdNota` (cdsNota), `dbdItensNota` (cdsItensNota, com os campos que o CalcValorNota calcula na abertura) e `dbeEmpresa`
 * (a empresa logada); duas têm consulta própria (`aqqICMSTRecolher`, `sqqRelPedDevCompra`) e a lista de conferência usa as três
 * consultas do `TfrmConferenciaNota.ImprimeListadeConferencia`. Aqui o servidor monta os mesmos datasets e devolve o modelo da
 * RELATORIOS (PERSONALIZADO antes do DEFAULT); o navegador desenha (`shared/fr3`). Dossiê: `uNF-impressoes.md`.
 */
export const RELATORIOS_NF = {
  /** "Imprimir conferencia de preço simplificada" (:13584) — itens por DESCRICAO; também o botão da grade do Manifesto (UManifestoDFe.pas:823) */
  'conferencia-preco-simples': { arquivo: 'conf - conferencia de preco simples nf.fr3', titulo: 'Conferência de preço' },
  /** "Imprimir conferencia de preço completa" (:13576) */
  'conferencia-preco': { arquivo: 'conf - conferencia de preco nf.fr3', titulo: 'Conferência de preço' },
  /** "Imprimir conferencia de Impostos" (:13541) */
  'conferencia-impostos': { arquivo: 'conf - conferencia de impostos nf.fr3', titulo: 'Conferência de impostos' },
  /** "Imprimir conferência ICMS ST Recolher" (:13593) */
  'conferencia-icms-st': { arquivo: 'conf - conferencia de icms st recolher.fr3', titulo: 'ICMS ST a recolher' },
  /** "Imprimir conferencia de Devolução de Compra" (:13549) */
  'conferencia-devolucao-compra': { arquivo: 'conf - conferencia de pedido devolucao compra.fr3', titulo: 'Conferência de devoluções de compra' },
  /** "Imprimir Lista de Conferência" (:13631) */
  'lista-conferencia': { arquivo: 'Rel_ListaConferenciaNF.fr3', titulo: 'Lista para conferência' },
  /** "Imprimir nota" (Ctrl+I, `mniImprimirNotaClick` :14711): `Config\uRptNF<CODEMPRESA>.fr3`, senão `uRptNF.fr3`, com a variável FATURAMENTO */
  nota: { arquivo: 'uRptNF.fr3', titulo: 'Nota fiscal' },
  /** "Espelho da nota" (Ctrl+N, `mniEspelhoNotaClick` :14616): `Config\uRptEspelhoNF.fr3` */
  espelho: { arquivo: 'uRptEspelhoNF.fr3', titulo: 'Espelho da nota fiscal' },
  /**
   * "Imprimir DANFE" (menu NF-e, `ImprimirDANFE1Click` :13615, e o botão "Imprimir" do rodapé, `btnImprimirNFeClick` :5529): o
   * `CriaNFE` carrega `Config\uRptNFE<CODEMPRESA>.fr3`, senão `uRptNFE.fr3` (udmNF.pas:6017 — RelNFE é sempre 'PERSONALIZADO'), e põe
   * o faturamento com a modalidade no `MemoFaturamento` (menos na devolução); o `TNFe.ImprimirNFE` só imprime com chave e NRONF ≠ 000000.
   */
  danfe: { arquivo: 'uRptNFE.fr3', titulo: 'DANFE' },
} as const;
export type RelatorioNf = keyof typeof RELATORIOS_NF;

/** as variáveis do relatório (`frxReport.Variables[...]`) e o texto posto em objetos antes de imprimir (`FindObject('X').Text`) */
export interface ImpressaoNf { relatorio: RelatorioNf; titulo: string; modelo: string; datasets: Record<string, Registro[]>; variaveis?: Record<string, string>; textos?: Record<string, string> }

/** os relatórios do layout da nota (os datasets da tela inteira: nota, itens, empresa e o do gado) */
const LAYOUT_DA_NOTA: readonly RelatorioNf[] = ['nota', 'espelho', 'danfe'];

/**
 * `SetaFAturamento` (uNF.pas:15709): as parcelas da FATURAMENTO da nota numa linha de texto — "dd/mm/aaaa DUP: xxx      valor | " —,
 * quebrando depois da 5ª, da 9ª e da 13ª; com a modalidade (o DANFE), cada parcela começa por "A VISTA:" (vence na emissão) ou pela
 * MODALIDADE. A duplicata segue o modelo da empresa (1: " DUP: <dup> "; 2: "<dup> "). Sem parcela: ".".
 */
export function textoFaturamento(parcelas: Array<{ data: string; duplicata?: string | null; valor: number; modalidade?: string | null }>, dtemissao: string,
  modeloDuplicata: number, comModalidade: boolean): string {
  if (!parcelas.length) return '.\n';
  const linhas: string[] = [];
  let texto = '';
  parcelas.forEach((p, incr) => {
    if (comModalidade) texto += `${p.data === dtemissao ? 'A VISTA' : String(p.modalidade ?? '')}:       `;
    const dup = p.duplicata ? (modeloDuplicata === 1 ? ` DUP: ${p.duplicata} ` : modeloDuplicata === 2 ? `${p.duplicata} ` : '') : '';
    const [a, m, d] = p.data.split('-');
    // ConcatenaLeft(FormatFloat('0.00', valor), 10, ' '): o valor com vírgula, alinhado à direita em 10 posições
    texto += `${d}/${m}/${a}${dup}${arred(p.valor, 2).toFixed(2).replace('.', ',').padStart(10, ' ')} | `;
    if (incr === 4 || incr === 8 || incr === 12) { linhas.push(texto); texto = ''; }
  });
  if (texto) linhas.push(texto);
  return linhas.map((l) => `${l}\n`).join('');
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
/** `TruncarArredondar(x, 'T', 2)` */
const trunca = (x: number, casas = 2): number => {
  const m = 10 ** casas;
  return (Math.floor(Math.abs(x) * m + 1e-9) / m) * (x < 0 ? -1 : 1);
};
const sub = (cfop: unknown) => String(cfop ?? '').slice(1, 4);
const d2 = (x: number) => String(x).padStart(2, '0');
const maiusculas = registroFr3;
const numericas = colunasNumericas;

@Injectable()
export class NfImpressaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async imprimir(codnf: number, relatorio: RelatorioNf, opcoes: { rodape?: boolean } = {}): Promise<ImpressaoNf> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const def = RELATORIOS_NF[relatorio];
    const nota = await this.nota(db, codnf, emp);
    // `LinhaComandosNfeLiberada` (uNF.pas:17831): os comandos do rodapé NF-e não valem para a entrada de emissão de terceiros — a
    // "LIBERA COMANDOS NFE" mora no ConfigDB.xml da estação e o padrão (sem a chave) é 'NÃO'
    if (opcoes.rodape && String(nota.tipo ?? '') === 'E' && n(nota.tipoemissao) === 1)
      throw new BusinessRuleError('NFE_COMANDOS_NAO_LIBERADOS', { codnf }, 'Comandos não liberados para nota fiscal eletrônica de entrada de emissão de terceiros.');
    const datasets: Record<string, Registro[]> = {};
    if (LAYOUT_DA_NOTA.includes(relatorio)) return this.layoutDaNota(db, relatorio, nota, emp);
    if (relatorio === 'lista-conferencia') Object.assign(datasets, await this.listaConferencia(db, codnf, nota));
    else {
      datasets.dbdNota = [maiusculas(nota, await numericas(db, ['nf']))];
      datasets.dbeEmpresa = [await this.empresa(db, emp)];
      if (relatorio === 'conferencia-icms-st') {
        const linhas = await this.icmsStRecolher(db, codnf);
        // "Não existem registros a serem exibidos." (uNF.pas:13606)
        if (!linhas.length) throw new BusinessRuleError('NF_IMPRESSAO_SEM_REGISTROS', { relatorio }, 'Não existem registros a serem exibidos.');
        datasets.frxDBDatasetICMSRecolher = linhas;
      } else if (relatorio === 'conferencia-devolucao-compra') {
        // o pedido de devolução da nota (uNF.pas:13553-13571)
        if (!(n(nota.cod_ped_dev_compra) > 0)) throw new BusinessRuleError('NF_SEM_PEDIDO_DEVOLUCAO', { codnf }, 'Nota Fiscal sem pedido de devolução associado.');
        const linhas = await this.pedidoDevolucaoCompra(db, n(nota.cod_ped_dev_compra));
        if (!linhas.length) throw new BusinessRuleError('NF_IMPRESSAO_SEM_REGISTROS', { relatorio }, 'Sem registro a serem exibidos.');
        datasets.frxDBRelPedDevCompra = linhas;
      }
      if (['conferencia-preco-simples', 'conferencia-preco', 'conferencia-impostos', 'conferencia-devolucao-compra'].includes(relatorio)) {
        const itens = await this.itens(db, nota, emp);
        // a simplificada ordena por DESCRICAO (`cdsItensNota.IndexFieldNames := 'DESCRICAO'`, :13587); as outras seguem a ordem do dataset
        if (relatorio === 'conferencia-preco-simples') itens.sort((a, b) => String(a.DESCRICAO ?? '').localeCompare(String(b.DESCRICAO ?? ''), 'pt-BR'));
        datasets.dbdItensNota = itens;
      }
    }
    return { relatorio, titulo: def.titulo, modelo: await modeloFr3(db, def.arquivo), datasets };
  }

  /**
   * A nota impressa (uRptNF), o espelho (uRptEspelhoNF) e o DANFE (uRptNFE): a nota com o TOTALNOTA calculado (cdsNotaCalcFields) e a
   * HORASAIDA, os itens com o TOTALDESCONTOS (a agregada SUM(VRDESCPROD) do cdsItensNota), a empresa inteira e o dataset do gado
   * (NF_ANIMAL — vazia na produção). O modelo da loja (`uRptNF<CODEMPRESA>.fr3`) vence o geral.
   */
  private async layoutDaNota(db: AnyDB, relatorio: RelatorioNf, nota: Registro, emp: number): Promise<ImpressaoNf> {
    if (relatorio === 'danfe' && (!String(nota.chavenfe ?? '').trim() || String(nota.nronf ?? '') === '000000'))
      throw new BusinessRuleError('NF_SEM_CHAVE_NFE', { codnf: nota.codnf }, 'A nota não tem chave de NF-e para imprimir o DANFE.');
    const numsNf = await numericas(db, ['nf'], ['totalnota']);
    const totalnota = totalNfLegado({ totalprod: n(nota.totalprod), totaldesc: n(nota.totaldesc), totalipi: n(nota.totalipi), totalicm_st: n(nota.totalicm_st) }, (k) => nota[k]);
    const horasaida = nota.dthorasaida instanceof Date ? `${d2(nota.dthorasaida.getHours())}:${d2(nota.dthorasaida.getMinutes())}` : null;
    const itens = await this.itens(db, nota, emp);
    const totalDescontos = arred(itens.reduce((s, it) => s + n(it.VRDESCPROD), 0), 2);
    const faturamento = relatorio === 'espelho' ? '' : await this.faturamento(db, nota, emp, relatorio === 'danfe');
    const def = RELATORIOS_NF[relatorio];
    const base = def.arquivo.replace(/\.fr3$/i, '');
    const modelo = relatorio === 'espelho' ? await modeloFr3(db, def.arquivo)
      : await modeloFr3(db, `${base}${emp}.fr3`).catch(() => modeloFr3(db, def.arquivo));
    const devolucao = String(nota.devolucao ?? '').toUpperCase() === 'S';
    return {
      relatorio,
      titulo: `${def.titulo} ${String(nota.nronf ?? '')}`.trim(),
      modelo,
      datasets: {
        dbdNota: [maiusculas({ ...nota, totalnota, horasaida }, numsNf)],
        dbdItensNota: itens.map((it) => ({ ...it, TOTALDESCONTOS: totalDescontos })),
        dbeEmpresa: [await empresaParaRelatorio(db, emp)],
        frxDBDatasetAnimal: [],
      },
      ...(relatorio === 'nota' ? { variaveis: { FATURAMENTO: `'${faturamento.replace(/'/g, "''")}'` } } : {}),
      ...(relatorio === 'danfe' && !devolucao ? { textos: { MemoFaturamento: faturamento } } : {}),
    };
  }

  /** as parcelas da FATURAMENTO da nota no texto do `SetaFAturamento`, pelo modelo de duplicata da empresa */
  private async faturamento(db: AnyDB, nota: Registro, emp: number, comModalidade: boolean): Promise<string> {
    const parcelas = (await sql<{ data: string; duplicata: string | null; valor: string | number; modalidade: string | null }>`
      SELECT to_char(data, 'YYYY-MM-DD') AS data, duplicata, valor, modalidade FROM faturamento WHERE idnf = ${n(nota.codnf)} ORDER BY codfaturamento`.execute(db)).rows;
    const modelo = n((await sql<{ modelo_duplicata: unknown }>`SELECT modelo_duplicata FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0]?.modelo_duplicata);
    const dtemissao = nota.dtemissao instanceof Date ? dataLocal(nota.dtemissao).slice(0, 10) : String(nota.dtemissao ?? '').slice(0, 10);
    return textoFaturamento(parcelas.map((p) => ({ ...p, valor: n(p.valor) })), dtemissao, modelo || 1, comModalidade);
  }


  /** a nota como o `qryNota` (udmNF.dfm:7): a NF com o titular, a transportadora e o CFOP */
  private async nota(db: AnyDB, codnf: number, emp: number): Promise<Registro> {
    const r = (await sql<Registro>`
      SELECT n.*,
             p.razao AS titular_razao, p.classificacao AS titular_classificacao, p.fantasia AS titular_fantasia, p.tipofj AS titular_tipo,
             e.codend AS titular_cod_end, e.endereco AS titular_logradouro, e.bairro AS titular_bairro, e.cidade AS titular_cidade,
             e.uf AS titular_uf, e.cep AS titular_cep, e.cnpj_cpf AS titular_cnpj, e.rg_insc AS titular_rg_insc, e.telefone AS titular_fone,
             t.razao AS transportadora_razao, f.codend AS transp_cod_end, f.endereco AS transp_logradouro, f.bairro AS transp_bairro,
             f.cidade AS transp_cidade, f.uf AS transp_uf, f.cep AS transp_cep, f.cnpj_cpf AS transp_cnpj, f.rg_insc AS transp_rg_insc,
             f.telefone AS transp_fone,
             o.descricao AS desccfop, o.tipo AS tipocfop, o.proc_qtde, o.devolucao, o.preco_custo,
             sn.descricao AS descsit
        FROM nf n
        LEFT JOIN parceiros p      ON p.codparceiro = n.codparceiro
        LEFT JOIN parceiros_end e  ON e.codend = n.codparceiro_end
        LEFT JOIN parceiros t      ON t.codparceiro = n.codtransp
        LEFT JOIN parceiros_end f  ON f.codend = n.codtransp_end
        LEFT JOIN cfop o           ON trim(o.codcfop::text) = trim(n.cfop::text)
        LEFT JOIN situacao_nf sn   ON sn.idsituacao_nf = n.idsituacao_nf
       WHERE n.codnf = ${codnf} AND n.idempresa = ${emp}`.execute(db)).rows[0];
    if (!r) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    return r;
  }

  /** `dmPrincipal.Empresa` — a empresa logada, sem as senhas, tokens e certificados */
  private async empresa(db: AnyDB, emp: number): Promise<Registro> {
    const r = (await sql<Registro>`
      SELECT idempresa AS codempresa, razao_social AS razaosocial, fantasia, cnpj, insc, uf, cidade, endereco, bairro, cep, fone1 AS fone,
             classfiscal, alqsimplesnac, numeitensnota
        FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    return maiusculas(r, new Set(['codempresa', 'alqsimplesnac', 'numeitensnota']));
  }

  /**
   * Os itens como o cdsItensNota do binário novo (o `qryItensNota` que a produção executa, capturado do V$SQL em 30/09/2026): o item
   * com o produto, o CFOP, a situação, o estoque da loja e do depósito, o ESTOQUE total (GET_ESTOQUE_TOTAL) e o custo do cadastro; mais
   * os campos internos que o `CalcValorNota` (udmNF.pas:3928) calcula na abertura e as conferências imprimem — o custo líquido
   * (TEMPVRCUSTO), o custo final (VRCUSTOFINALC), o desconto unitário (VRDESCONTO), o IPI (VRIPI) e o total dos produtos.
   */
  private async itens(db: AnyDB, nota: Registro, emp: number): Promise<Registro[]> {
    const codnf = n(nota.codnf);
    const linhas = (await sql<Registro>`
      SELECT np.*,
             p.codbarra, p.peso, p.especificacao, p.ncmsh, p.taraembalagem, p.codigo_anp, p.codfigurafiscal, p.mva AS mva_prod,
             p.aliquota AS aliquotaproduto, p.fci,
             c.descricao AS desccfop, c.aliquota AS aliquota_cfop, coalesce(c.proc_qtde, 'N') AS proc_qtde,
             coalesce(c.proc_transf, 'N') AS proc_transf, coalesce(c.altera_custo_nf, 'N') AS altera_custo_nf,
             c.nao_atualiza_forn_prod, coalesce(c.abater_cfop, 'N') AS abater_cfop,
             nf.statusnfe, nf.proc, nf.nf_importacao_nfe, nf.codparceiro,
             sn.descricao AS descsit,
             CAST(coalesce(e.qtde, 0) AS numeric(15,3)) AS qtde_estoque_loja,
             CAST(coalesce(ed.qtde, 0) AS numeric(15,3)) AS qtde_estoque_deposito,
             (SELECT et.total FROM get_estoque_total et WHERE et.idproduto = p.idproduto AND et.idempresa = nf.idempresa LIMIT 1) AS estoque,
             mp.vrcusto AS vrcustocadastro,
             coalesce(d.fp_despesa_operacional, emp.despoperacional) AS fp_despesa_operacional,
             pc.descricao AS dspiscofins, pc.cst_pis_ent, pc.cst_pis_sai, pc.cst_cofins_ent, pc.cst_cofins_sai, pc.aliq_pis_sai, pc.aliq_cofins_sai
        FROM nf_prod np
        JOIN nf                  ON nf.codnf = np.codnf
        LEFT JOIN produtos p     ON p.idproduto = np.codproduto
        LEFT JOIN situacao_nf sn ON sn.idsituacao_nf = np.idsituacao_nf
        LEFT JOIN cfop c         ON trim(c.codcfop::text) = trim(np.cfop::text)
        LEFT JOIN estoque e      ON e.idproduto = np.codproduto AND e.idempresa = nf.idempresa
        LEFT JOIN estoque_dep ed ON ed.idproduto = np.codproduto AND ed.idempresa = nf.idempresa
        LEFT JOIN multi_preco mp ON mp.idproduto = np.codproduto AND mp.idempresa = nf.idempresa
        LEFT JOIN piscofins pc   ON pc.idpiscofins = np.idpiscofins
        LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto
        LEFT JOIN empresas emp   ON emp.idempresa = nf.idempresa
       WHERE np.codnf = ${codnf}
       ORDER BY np.codnfprod`.execute(db)).rows;
    const empresa = ((await sql<Registro>`SELECT classfiscal, despfederativas, despoperacional, alqsimplesnac, imprenda, contsocial, uf
      FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {}) as EmpresaCusto;
    const aproveitamento = String((await configNaTrx(db, 'APROVEITAMENTO_CREDITO_ICMSST_NF', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'N')
      .toUpperCase() === 'S';
    const umItem = String(nota.nf_importacao_nfe ?? '') === 'S' && linhas.length === 1 ? n(nota.totalprod) : null;
    const nums = await numericas(db, ['nf_prod'], ['peso', 'taraembalagem', 'mva_prod', 'codfigurafiscal', 'aliquota_cfop', 'qtde_estoque_loja', 'qtde_estoque_deposito', 'estoque',
      'vrcustocadastro', 'fp_despesa_operacional', 'aliq_pis_sai', 'aliq_cofins_sai', 'codparceiro']);
    return linhas.map((it) => {
      const num = Object.fromEntries(Object.entries(it).map(([k, v]) => [k, typeof v === 'string' && nums.has(k) && v !== '' ? Number(v) : v]));
      return maiusculas({ ...num, ...camposCalculadosDoItem(num, nota, empresa, { aproveitamento, umItem }) }, nums);
    });
  }

  /** `aqqICMSTRecolher` (udmNF.dfm): os itens com indexador de MVA, a base e o ST calculados e o que falta recolher */
  private async icmsStRecolher(db: AnyDB, codnf: number): Promise<Registro[]> {
    const r = (await sql<Registro>`
      SELECT n.nronf, n.dtemissao::date AS dtemissao, n.dtcontabil::date AS dtcontabil, n.dtprocessamento::date AS dtprocessamento,
             ep.cnpj AS cnpj_destinatario, ep.razao_social AS razao_destinatario, ep.uf AS uf_destinatario,
             e.cnpj_cpf AS cnpj_remetente, pa.razao AS razao_remetente, e.uf AS uf_remetente,
             p.codbarra, np.descricao, np.ncm, np.quantidade, np.quantidade * np.vrcusto AS valor,
             i.mva, i.icm_fonte AS aliq_credito, i.aliquota_reduzida_lei_3166 AS aliq_lei3166, i.aliquota_dest AS aliq_interna,
             CASE WHEN coalesce(np.vrbasecalculo, 0) = 0 THEN np.vrbasecalculoicm_calc ELSE np.vrbasecalculo END AS icms_operacao_bc,
             CASE WHEN coalesce(np.vricm, 0) = 0 THEN np.vricm_calc ELSE np.vricm END AS icms_operacao_valor,
             np.vrbase_stexterno AS icms_st_bc, np.streal AS icms_st_valor, np.vricms_stexterno AS icms_st_recolher,
             coalesce(np.mva_ajustado, 0) AS mva_ajustado, coalesce(n.icms_st_pago_fonte, 0) AS icms_st_pago_fonte,
             coalesce(n.icms_st_apagar, 0) AS icms_st_apagar
        FROM nf_prod np
        JOIN nf n                         ON n.codnf = np.codnf
        LEFT JOIN parceiros pa            ON pa.codparceiro = n.codparceiro
        LEFT JOIN parceiros_end e         ON e.codend = n.codparceiro_end
        LEFT JOIN empresas ep             ON ep.idempresa = n.idempresa
        LEFT JOIN produtos p              ON p.idproduto = np.codproduto
        LEFT JOIN indexador_tributario i  ON i.codindexadortributario = np.indexadortrib
       WHERE n.codnf = ${codnf} AND coalesce(i.mva, 0) > 0
       ORDER BY np.codnfprod`.execute(db)).rows;
    const nums = new Set(['quantidade', 'valor', 'mva', 'aliq_credito', 'aliq_lei3166', 'aliq_interna', 'icms_operacao_bc', 'icms_operacao_valor', 'icms_st_bc',
      'icms_st_valor', 'icms_st_recolher', 'mva_ajustado', 'icms_st_pago_fonte', 'icms_st_apagar']);
    return r.map((x) => maiusculas(x, nums));
  }

  /** `sqqRelPedDevCompra` (udmNF.dfm): os itens do pedido de devolução com a nota de entrada de cada um */
  private async pedidoDevolucaoCompra(db: AnyDB, codpeddevcompra: number): Promise<Registro[]> {
    const r = (await sql<Registro>`
      SELECT n.nronf, n.dtemissao::date AS dtemissao, n.chavenfe, i.nroitem, p.codbarra, i.descricao_produto,
             i.qtd_nota_fiscal * coalesce(i.fatorembalagem, 1) AS qtd_nota_fiscal, i.total_produto_nota, i.qtd_devolvida, i.total_produto_devolvido
        FROM pedido_devolucao_compra_i i
        LEFT JOIN nf n       ON n.codnf = i.codnf
        LEFT JOIN produtos p ON p.idproduto = i.idproduto
       WHERE i.codpeddevcompra = ${codpeddevcompra}
       ORDER BY n.nronf, i.nroitem`.execute(db)).rows;
    const nums = new Set(['nroitem', 'qtd_nota_fiscal', 'total_produto_nota', 'qtd_devolvida', 'total_produto_devolvido']);
    return r.map((x) => maiusculas(x, nums));
  }

  /**
   * A lista de conferência (`ImprimeListadeConferencia`, uConferenciaNota.pas:993): a Nota e a Empresa pelas consultas da unit; os
   * Itens, chamada pela NF, são os da grade da tela (`dsItensNotaGrid`) — código de barras, descrição e quantidade, na ordem do item.
   */
  private async listaConferencia(db: AnyDB, codnf: number, nota: Registro): Promise<Record<string, Registro[]>> {
    const nf = (await sql<Registro>`
      SELECT nf.nronf, nf.codparceiro, nf.idempresa, nf.chavenfe, p.razao, p.fantasia
        FROM nf JOIN parceiros p ON nf.codparceiro = p.codparceiro WHERE nf.codnf = ${codnf}`.execute(db)).rows;
    const empresa = (await sql<Registro>`SELECT idempresa AS codempresa, razao_social AS razaosocial, fantasia FROM empresas
      WHERE idempresa = ${n(nota.idempresa)}`.execute(db)).rows;
    const itens = (await sql<Registro>`
      SELECT np.nroitem, p.codbarra, np.descricao, np.quantidade, np.unidade
        FROM nf_prod np LEFT JOIN produtos p ON p.idproduto = np.codproduto
       WHERE np.codnf = ${codnf} ORDER BY np.nroitem, np.codnfprod`.execute(db)).rows;
    return { Nota: nf.map((x) => maiusculas(x)), Empresa: empresa.map((x) => maiusculas(x)), Itens: itens.map((x) => maiusculas(x, new Set(['nroitem', 'quantidade']))) };
  }
}

/**
 * Os campos internos do cdsItensNota que as impressões usam, como o `CalcValorNota` (udmNF.pas:3928) os calcula ao abrir a nota:
 * ramo de ENTRADA (:3973-4265) e de SAÍDA (:4267-4495), cada um terminando no `CalcValorCusto`.
 */
export function camposCalculadosDoItem(it: Registro, nota: Registro, empresa: EmpresaCusto, ctx: { aproveitamento: boolean; umItem: number | null }): Registro {
  const fator = n(it.fatorembal) || 1;
  const arredonda = String(it.arredonda ?? 'S').toUpperCase() !== 'N';
  const round2 = (x: number) => (arredonda ? arred(x, 2) : trunca(x, 2));
  const cfopNota = nota.cfop;
  const x929 = sub(cfopNota) === '929';
  if (String(nota.tipo ?? '') === 'E') {
    const c = custoDoItemNaEntrada(it, empresa, { cfopNota, aproveitamentoCreditoIcmsSt: ctx.aproveitamento, totalProdNotaUmItem: ctx.umItem, totalFreteNota: n(nota.totalfrete) });
    let vrtotalprodutos = round2(n(it.quantidade) * n(it.vrcusto));
    // o desconto unitário: com o total dos produtos batendo com o da nota (até 0,02), o % vem do desconto da nota (:4150-4162)
    let porcDesconto = n(it.desconto);
    if (Math.abs(vrtotalprodutos - n(nota.totalprod)) <= 0.02) {
      if (n(nota.totaldesc) > 0 && n(nota.totalprod) > 0) porcDesconto = (n(nota.totaldesc) / n(nota.totalprod)) * 100;
      if (porcDesconto === 0) porcDesconto = n(it.desconto);
    }
    const vrdesconto = ((n(it.vrcusto) / fator) * porcDesconto) / 100;
    if (ctx.umItem != null && Math.abs(vrtotalprodutos - ctx.umItem) <= 0.02) vrtotalprodutos = ctx.umItem;
    return {
      tempfatorembal: fator, qtdetotal: c.qtdetotal, vrcustofinal: c.vrcustofinal, vrcustofinalc: c.vrcustofinalc, totalprods: c.totalprods,
      vrtotalprodutos, vrdesconto, vrfrete: c.vrfrete, vrseguro: c.vrseguro, vripi: c.vripi, tempvrcusto: c.tempvrcusto,
      tempvrcustorep: c.tempvrcustorep, tempvrcustocsi: c.tempvrcustocsi, temppmz: c.temppmz,
    };
  }
  // SAÍDA
  const qtdetotal = x929 ? n(it.quantidade) : n(it.quantidade) * fator;
  let vrcustofinal = 0;
  let vrcustofinalc = 0;
  if (x929) {
    if (qtdetotal > 0) {
      vrcustofinal = (n(it.vrcustoreal) * qtdetotal - n(it.vrdescprod)) / qtdetotal;
      vrcustofinalc = (n(it.vrcusto) * qtdetotal - n(it.vrdescprod)) / qtdetotal;
    }
  } else {
    vrcustofinal = (n(it.vrcustoreal) - (n(it.vrcustoreal) * n(it.desconto)) / 100) / fator;
    vrcustofinalc = (n(it.vrcusto) - (n(it.vrcusto) * n(it.desconto)) / 100) / fator;
  }
  const totalprods = round2(qtdetotal * vrcustofinalc);
  const unit = n(it.vrcusto) / fator;
  let vrtotalprodutos: number;
  const devolucao = String(nota.devolucao ?? '').toUpperCase() === 'S';
  if (String(nota.preco_custo ?? '') === 'S' || x929) {
    // CodigoCFOPDeDevolucao da saída arredonda; o x929 com ARREDONDA também; o resto não arredonda (RetornaSemArredondar)
    vrtotalprodutos = qtdetotal > 0 ? (devolucao ? round2(qtdetotal * unit) : x929 && arredonda ? arred(qtdetotal * unit, 2) : qtdetotal * unit) : 0;
  } else vrtotalprodutos = round2(qtdetotal * unit);
  const pct = (p: unknown) => (totalprods * n(p)) / 100;
  const vrfrete = pct(it.frete);
  const vrseguro = pct(it.seguro);
  const despextrap = pct(it.despextra);
  const vripi = arred(pct(it.ipi), 2);
  const vripiDev = arred(pct(it.ipi_devolucao), 2);
  let vrdesconto = 0;
  if (x929) {
    let porc = 0;
    if (n(it.vrdescprod) > 0 && qtdetotal > 0 && n(it.vrcusto) > 0) porc = arred((n(it.vrdescprod) / (n(it.vrcusto) * qtdetotal)) * 100, 4);
    if (porc > 0) vrdesconto = (unit * porc) / 100;
  } else if (n(it.desconto) > 0) vrdesconto = (unit * n(it.desconto)) / 100;
  // o ICME efetivo da saída e as zeragens sem o aproveitamento do crédito de ST (:4460-4492)
  let tempicmeefetivo = arred((n(it.icme) * n(it.bcr)) / 100, 2);
  const cst = Math.trunc(n(it.cst));
  if (!ctx.aproveitamento && (['401', '403', '933', '556'].includes(sub(it.cfop)) || (['102', '101'].includes(sub(it.cfop)) && (cst === 40 || cst === 90)))) tempicmeefetivo = 0;
  const custo = calcValorCusto(it, empresa, {}, { qtdetotal, vrcustofinal, vrfrete, vrseguro, vripi, vripiDev, despextrap, tempicmeefetivo });
  return {
    tempfatorembal: fator, qtdetotal, vrcustofinal, vrcustofinalc, totalprods, vrtotalprodutos, vrdesconto, vrfrete, vrseguro, vripi,
    tempvrcusto: custo.tempvrcusto, tempvrcustorep: custo.tempvrcustorep, tempvrcustocsi: custo.tempvrcustocsi, temppmz: custo.temppmz,
  };
}
