import { Injectable } from '@nestjs/common';
import { cst3, icmsDoItem, gruposC190 } from './sped-c-legado';
import { sql, type Kysely } from 'kysely';
import { hojeNaLoja } from '../../shared/tempo/hoje';
import { alteracoesParaSped } from './sped-alteracoes';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SpedArquivo, fmtData, fmtNum, soDigitos } from './sped-writer';
import { validarSpedFiscal, type ResultadoValidacao } from './sped-fiscal-validator';

type AnyDB = Kysely<any>;
const nn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** COD_VER do EFD ICMS/IPI por período (AnoToVersao do legado — DIFERENTE do EFD-Contribuições). 2020→'014';
 *  o legado para em 2020 (bug p/ períodos atuais) — estendemos a sequência oficial (2021='015'…). */
function codVersaoFiscal(dtini: string): string {
  const ano = Number(String(dtini).slice(0, 4)) || 0;
  // Fiel ao AnoToVersao do legado (que PARA em 2020='014'). NÃO extrapolar por ano (as versões oficiais NÃO
  // incrementam anualmente) — p/ ≥2020 devolvemos o último valor conhecido '014' e DOCUMENTAMOS que o COD_VER
  // de períodos atuais precisa da tabela oficial (Ato COTEPE) antes da entrega real. Mesmo padrão do EFD-Contribuições.
  const tab: Record<number, string> = {
    2011: '004', 2012: '006', 2013: '007', 2014: '008', 2015: '009',
    2016: '010', 2017: '011', 2018: '012', 2019: '013',
  };
  return tab[ano] ?? (ano >= 2020 ? '014' : '004');
}

/**
 * SPED FISCAL (EFD ICMS/IPI) — obrigação mensal DISTINTA do EFD-Contribuições. CORTE-2 (saída fiscal): bloco 0
 * (0000 layout ICMS/IPI + 0005 + cadastros 0150/0190/0200) + bloco C (documentos de ENTRADA E SAÍDA mod-55,
 * C100/C170/C190 por IND_OPER) + bloco E (E100/E110 apuração ICMS: débito de saída − crédito de entrada) + 9.
 *
 * DECISÃO ARQUITETURAL (procedência): o legado LÊ o E110 de uma tabela pré-calculada APURACAO_ICMS (processo de
 * apuração separado). O monorepo NÃO tem esse processo/tabela → DERIVA a apuração das somas do C190: crédito =
 * Σ VL_ICMS das ENTRADAS, débito = Σ VL_ICMS das SAÍDAS. saldoApurado = max(0, débito − crédito) (a recolher);
 * saldoCredor = max(0, crédito − débito) (a transportar). Fiel à estrutura; o port do processo APURACAO_ICMS
 * (com ajustes E111/estornos) seria o refino.
 *
 * E116 (obrigação a recolher) emitido quando há ICMS a recolher — COD_REC por UF (MG/GO; demais UFs precisam
 * da tabela completa Ato COTEPE).
 *
 * BLOCO C RESÍDUOS (fiel a GeraNFEnergia, Uspedfiscal.pas:4040): documentos de ENERGIA elétrica (mod 06), GÁS
 * canalizado (28) e ÁGUA (29) vão em C500 (header) + C590 (analítico ICMS por CST/CFOP/ALIQ) — NÃO em C100/C170
 * (mod 06/28/29 são inválidos no C100). O ICMS de energia NÃO é folded no E110 (a apuração é derivada do C190 dos
 * docs regulares; no varejo o crédito de energia é restrito e o legado lê de APURACAO_ICMS à parte). Os demais
 * registros C residuais foram CONFIRMADOS mortos neste ERP e NÃO são emitidos (cópia fiel): C176 (código presente
 * mas o handler do chkGerarC176 desabilita permanentemente — Uspedfiscal.pas:4189-4196; +sem coluna de ressarci-
 * mento), C195/C197 (entrada-only, gated por EMPRESAS.COD_AJUS_*>0; NF_AJUSTES/CODIGO_AJUSTE = 0 linhas no golden),
 * C800/C850/C860 (SAT-CF-e mod 59 — sem código no legado; MG não usa SAT).
 *
 * BLOCO H (Inventário, fiel a GeraBlocoH Uspedfiscal.pas:1058-1170): H001 sempre; com a opção da tela ("Gerar H001 (Inventário)" +
 * a data da FOLHA + o motivo + a correção tributária) o H005, um H010 por item (COD_CTA da conta do produto) e, com MOT_INV ≥ 02, o
 * H020 (CST/ICM da DET_ALIQUOTA na UF). Sem a opção, IND_MOV 1.
 *
 * ESTRUTURA DE BLOCOS COMPLETA: 0/C/D/E/G/H/K/1/9 — todos com opener obrigatório. G/K/1 saem só com o opener
 * (IND_MOV=1 sem-dados). Bloco B (ISS) é OMITIDO (só p/ informante obrigado ao EFD-ISS municipal; N/A p/ este
 * informante de ICMS/IPI). BLOCO D como o `GeraBlocoD` (Uspedfiscal.pas:516-672): D100/D190 do frete (modelos 7/8/9/10/11/26/27/57)
 * e D500/D590 da telecomunicação (21/22). O ICMS do bloco D, como o da energia, fica fora do E110 derivado. O bloco C traz também as
 * NFC-e (das vendas) e as numerações inutilizadas (GeraNFC / GeraNFInutilizadas).
 *
 * ADIADO (corte-5+, com procedência): VL_SLD_CREDOR_ANT (carry do saldo credor do período anterior — precisa
 * persistir a apuração/APURACAO_ICMS; hoje 0, superestima a-recolher se houver credor acumulado) · CONTEÚDO dos
 * blocos G (CIAP) / K (produção/estoque — config-gated OPTANTE_BLOCOK + APURACAO_ESTOQUE_ESCRITURADO vazio no
 * golden; K230+ = produção, ROI~0) / 1 (outras info) ·
 * E111/E113 (ajustes) · E200/E210 (ST)
 * · E300/E310 (DIFAL/FCP) · E500 (IPI) · redução de base (VL_RED_BC do C190 = 0) · multi-estab (C010) · COD_REC das
 * demais UFs · C500 TP_LIGACAO/COD_GRUPO_TENSAO (EMPRESAS.TP_LIGACAO/GRUPOTENSAO ausentes → ''). O C170 NÃO sai na NF-e 55
 * de emissão própria, entrada ou saída (ckbC170Saidas desmarcada, Uspedfiscal.pas:2707) e as regras do item/C190 são as do legado
 * (`sped-c-legado.ts`: CST de 3 dígitos, ICMS zerado por CFOP/CST/alíquota, VL_OPR, VL_RED_BC, QTD × fator, PIS/COFINS do cadastro).
 */
/** uma NFC-e montada das vendas para o EFD ICMS-IPI */
interface NfceSped {
  serie: string; nronf: string; chavenfe: string; dtemissao: string; cancelada: boolean;
  totalProd: number; totalDesc: number; totalAcre: number; bc: number; icms: number;
  c190: Array<{ cst: string; cfop: string; aliq: number; vlOpr: number; bc: number; icms: number; bcSt: number; icmsSt: number }>;
}

export interface OpcaoInventario { data: string; motivo?: number; correcao?: boolean }
/**
 * as opções da tela do SPED Fiscal que o gerador conhece (Uspedfiscal.dfm; ausente = o padrão do .dfm): "Finalidade do Arquivo", "Gerar
 * com os registros de" (Entradas/Saídas), "Codigo Produto" (EAN/PLU), o "C113 / 114", "Somar em Outras despesas" (ICMS ST, FCP ST, IPI) e
 * as "Outras opções de geração" do bloco C, além do Bloco H
 */
export interface OpcoesSpedFiscal {
  inventario?: OpcaoInventario;
  c113c114?: boolean;
  finalidade?: 0 | 1;
  entradas?: boolean;
  saidas?: boolean;
  codigoProduto?: 'ean' | 'plu';
  somarIcmsStOutras?: boolean;
  somarFcpStOutras?: boolean;
  somarIpiOutras?: boolean;
  zerado5929C170?: boolean;
  zerado5929Documento?: boolean;
  cst49?: boolean;
  c170Proprias?: boolean;
  gerarIcmsSt?: boolean;
  destacarIpiStItem?: boolean;
  c140?: boolean;
  c140TodosModelos?: boolean;
  c191?: boolean;
}
type OpcoesC = Required<Omit<OpcoesSpedFiscal, 'inventario'>>;
const opcoesPadrao = (o: OpcoesSpedFiscal): OpcoesC => ({
  c113c114: o.c113c114 !== false, finalidade: o.finalidade === 1 ? 1 : 0, entradas: o.entradas !== false, saidas: o.saidas !== false,
  codigoProduto: o.codigoProduto === 'ean' ? 'ean' : 'plu', somarIcmsStOutras: !!o.somarIcmsStOutras, somarFcpStOutras: !!o.somarFcpStOutras,
  somarIpiOutras: !!o.somarIpiOutras, zerado5929C170: !!o.zerado5929C170, zerado5929Documento: !!o.zerado5929Documento, cst49: !!o.cst49,
  c170Proprias: !!o.c170Proprias, gerarIcmsSt: !!o.gerarIcmsSt, destacarIpiStItem: !!o.destacarIpiStItem, c140: !!o.c140,
  c140TodosModelos: !!o.c140TodosModelos, c191: !!o.c191,
});

/** o COD_INF do 0450/C110: os 6 últimos caracteres do CODNF com zeros à esquerda (`Get6UltimosCaracteres(FormatFloat('000000', …))`) */
const codInf = (codnf: unknown) => String(Math.trunc(Number(codnf) || 0)).padStart(6, '0').slice(-6);
/** o texto livre do SPED: sem as quebras CR+LF e sem o pipe, aparado e cortado em 105 (`Copy(….Replace(#13#10,'').Replace('|','').Trim, 1, 105)`) */
const txtSped = (v: unknown) => String(v ?? '').replace(/\r\n/g, '').replace(/\|/g, '').trim().slice(0, 105);
/** um número como o Oracle/Delphi o converte em texto na sessão pt-BR: vírgula decimal, sem zeros à direita e sem o zero antes da vírgula */
const numTexto = (v: unknown) => {
  const n = Number(v) || 0;
  const t = String(Math.round(n * 100) / 100).replace('.', ',');
  return t.replace(/^(-?)0,/, '$1,');
};

@Injectable()
export class SpedEfdIcmsIpiService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(dtini: string, dtfim: string, opcoes: OpcoesSpedFiscal = {}): Promise<{ arquivo: string; nomeArquivo: string; linhas: number; documentos: number; parcial: boolean; validacao: ResultadoValidacao; aviso: string }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = opcoesPadrao(opcoes);
    // "Gerar com os registros de": as notas de entrada e/ou de saída (Uspedfiscal.pas:2333, 561, 623, 3478, 4055); as NFC-e só com Saídas (:3218)
    const tipos = [...(op.entradas ? ['E'] : []), ...(op.saidas ? ['S'] : [])];

    const empresa = (await db
      .selectFrom('empresas')
      .select(['razao_social', 'fantasia', 'cnpj', 'insc', 'im', 'endereco', 'numero', 'bairro', 'uf', 'cep', 'fone1', 'fone2', 'idcidade'])
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as Record<string, any> | undefined;
    if (!empresa) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: emp });

    const cnpj = soDigitos(empresa.cnpj);
    const ie = String(empresa.insc ?? '').replace(/ISENTO/gi, '');
    const arq = new SpedArquivo();

    // 0000 (layout EFD ICMS/IPI, 14 campos): COD_VER|COD_FIN(0)|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA|IND_PERFIL|IND_ATIV
    // IND_PERFIL='A' e IND_ATIV='1'(outros) default — o legado lê de EMPRESA.PERFILSPED/INDICE_ATIV (ausentes no
    // monorepo → default documentado; refinável por config/coluna).
    // COD_FIN pela "Finalidade do Arquivo" (0 original, 1 retificação — Uspedfiscal.pas:1631)
    arq.add('0000', [codVersaoFiscal(dtini), String(op.finalidade), fmtData(dtini), fmtData(dtfim), empresa.razao_social ?? '', cnpj, '', empresa.uf ?? '', ie, empresa.idcidade != null ? String(empresa.idcidade) : '', empresa.im ?? '', '', 'A', '1']);
    arq.add('0001', ['0']);
    // 0005 (9 campos): FANTASIA|CEP|ENDERECO|NUM|COMPL|BAIRRO|FONE|FAX|EMAIL
    arq.add('0005', [empresa.fantasia ?? empresa.razao_social ?? '', soDigitos(empresa.cep), empresa.endereco ?? '', empresa.numero ?? 'S/N', '', empresa.bairro ?? '', soDigitos(empresa.fone1), soDigitos(empresa.fone2), '']);
    // 0100 (13 campos) — o contabilista da empresa (Uspedfiscal.pas:1661, `SELECT * FROM CONTABILISTA WHERE CODEMPRESA`): CPF, CNPJ,
    // CEP, FONE e FAX sem pontuação; sem contabilista cadastrado o legado gera o registro vazio (o dataset vazio devolve '')
    const ct = (await sql<Record<string, unknown>>`SELECT * FROM contabilista WHERE codempresa = ${emp} LIMIT 1`.execute(db)).rows[0] ?? {};
    const txt = (v: unknown) => (v == null ? '' : String(v));
    arq.add('0100', [txt(ct.nome), soDigitos(ct.cpf as string), txt(ct.crc), soDigitos(ct.cnpj as string), soDigitos(ct.cep as string), txt(ct.endereco),
      txt(ct.num), txt(ct.complemento), txt(ct.bairro), soDigitos(ct.fone as string), soDigitos(ct.fax as string), txt(ct.email), ct.cod_mun != null ? String(ct.cod_mun) : '']);

    const docs = await this.coletarEntrada(db, emp, dtini, dtfim, tipos);
    // o BLOCO D (GeraBlocoD, Uspedfiscal.pas:516-672): as notas de frete (D100/D190) — os participantes delas entram no 0150
    const frete = await this.coletarFrete(db, emp, dtini, dtfim, docs.parceiros, [7, 8, 9, 10, 11, 26, 27, 57], false, tipos);
    // e as de telecomunicação 21/22 (sqqNFtelecomunicacao: processadas, sem o filtro de CFOP do C100) — D500/D590
    const telecom = await this.coletarFrete(db, emp, dtini, dtfim, docs.parceiros, [21, 22], true, tipos);
    const inventario = await this.coletarInventario(db, emp, opcoes.inventario, String(empresa.uf ?? ''));
    // 0450/C110 (as observações das notas) e o C113 (os documentos referenciados — "C113 / 114", marcado por padrão)
    const informacoes = await this.coletarInformacoes(db, emp, dtini, dtfim, tipos);
    const referenciados = op.c113c114 ? await this.coletarReferenciados(db, docs) : new Map<number, Array<Record<string, any>>>();
    const faturamento = op.c140 ? await this.coletarFaturamento(db, docs) : new Map<number, Array<Record<string, any>>>();
    // Bloco H (inventário) referencia COD_ITEM no 0200 → mescla os produtos do inventário no cadastro (fiel: o
    // legado gateia o H010 pela pertinência ao 0200; aqui garantimos que o 0200 cobre o inventário — reporta a
    // contagem COMPLETA e mantém integridade referencial, em vez de dropar itens sem movimento do período).
    const invProdIds = [...new Set((inventario?.itens ?? []).map((i) => Number(i.idproduto)).filter(Boolean))].filter((id) => !docs.produtos.has(id));
    if (invProdIds.length) {
      const rows = (await db.selectFrom('produtos').select(['idproduto', 'descricao', 'codbarra', 'unidade', 'ncmsh', 'cest', 'aliquota']).where('idproduto', 'in', invProdIds).execute()) as Array<Record<string, any>>;
      for (const r of rows) { docs.produtos.set(Number(r.idproduto), r); const u = String(r.unidade ?? '').trim(); if (u) docs.unidades.add(u); }
    }
    // 0175/0205 — as alterações de cadastro do participante e do item (TB_SPEED_AUX; Uspedfiscal.pas:1548-1600, :1725-1750)
    const alt0175 = await alteracoesParaSped(db, '0175', [...docs.parceiros.keys()], dtini, dtfim);
    const alt0205 = await alteracoesParaSped(db, '0205', [...docs.produtos.keys()], dtini, dtfim);
    this.emitirCadastros(arq, docs, { alt0175, alt0205, dtini, dtfim }, op.codigoProduto);
    // 0450 (2): COD_INF|TXT — uma por nota com observação (cdsObsNF_Reg0450)
    for (const i of informacoes.values()) arq.add('0450', [codInf(i.codnf), txtSped(i.txt0450)]);
    arq.fecharBloco('0990', '0');
    // o SPED marca como informadas as alterações que leu (REG_INFORMADO 'S'); regerar o mesmo período as traz de novo
    const lidas = [...alt0175, ...alt0205].filter((r) => r.reg_informado === 'N').map((r) => Number(r.cod_speed_aux));
    if (lidas.length) await sql`UPDATE tb_speed_aux SET reg_informado = 'S' WHERE cod_speed_aux = ANY(${lidas}::bigint[])`.execute(this.dbp.forTenant() as AnyDB);

    // BLOCO C — documentos de ENTRADA (crédito) + SAÍDA (débito), as numerações INUTILIZADAS e as NFC-e (GeraNFInutilizadas / GeraNF /
    // GeraNFC, Uspedfiscal.pas:4118-4120)
    const inutilizadas = await this.coletarInutilizadas(db, emp, dtini, dtfim);
    const nfce = op.saidas ? await this.coletarNfce(db, emp, dtini, dtfim) : [];
    const { creditoIcms, debitoIcms } = this.emitirBlocoC(arq, docs, inutilizadas, nfce, dtini, informacoes, referenciados, op, faturamento);

    // BLOCO D — frete (D100/D190) e telecomunicação (D500/D590), como o GeraBlocoD
    this.emitirBlocoD(arq, frete, telecom, empresa.idcidade);

    // BLOCO E — apuração ICMS. O legado NÃO deriva o E110 do bloco C: ele **lê a APURAÇÃO gravada** do período
    // (uRelRegistros_ES/uDMRelRegistros_ES — migs 164/165, o processo que produz o livro de Entradas e Saídas).
    // Corte-2 do épico: quando existe apuração para EXATAMENTE este período, o E110 sai dela — com os ajustes
    // manuais (outros créditos/débitos, estornos, deduções) e o **saldo credor anterior**, que a derivação do
    // bloco C nunca teve. Sem apuração gravada, mantém a derivação (débito de saída − crédito de entrada) e o
    // aviso registra isso.
    const apur = (await db
      .selectFrom('apuracao_icms')
      .select(['codapuracaoicms', 'saldoant', 'creditoentrada', 'outroscreditos', 'estornodebitos', 'debitosaida',
               'outrosdebitos', 'estornocreditos', 'saldocredorseguinte', 'saldodevedor', 'deducoes', 'arecolher'])
      .where('idempresa', '=', emp)
      .where('dataini', '=', String(dtini).slice(0, 10))
      .where('datafin', '=', String(dtfim).slice(0, 10))
      .executeTakeFirst()) as Record<string, unknown> | undefined;

    // o aviso do retorno diz DE ONDE veio o E110 — é a diferença entre "apuração de verdade" e derivação do bloco C
    const origemE110 = apur
      ? `da APURAÇÃO ${Number(apur.codapuracaoicms)} gravada do período (com ajustes, estornos, saldo credor anterior e deduções)`
      : `derivado do bloco C (débito ${fmtNum(debitoIcms)} − crédito ${fmtNum(creditoIcms)}) — sem apuração gravada para o período`;
    const temApuracao = docs.nfs.length > 0 || nfce.length > 0 || apur != null;
    arq.add('E001', [temApuracao ? '0' : '1']);
    if (temApuracao) {
      arq.add('E100', [fmtData(dtini), fmtData(dtfim)]);
      const n = (v: unknown) => r2(Number(v ?? 0) || 0);
      // da apuração gravada (fiel ao legado) ou, sem ela, da derivação do bloco C
      const debTot = apur ? n(apur.debitosaida) : debitoIcms;
      const creTot = apur ? n(apur.creditoentrada) : creditoIcms;
      const ajDeb = apur ? n(apur.outrosdebitos) : 0;
      const estCred = apur ? n(apur.estornocreditos) : 0;
      const ajCred = apur ? n(apur.outroscreditos) : 0;
      const estDeb = apur ? n(apur.estornodebitos) : 0;
      const saldoAnt = apur ? n(apur.saldoant) : 0;
      const deducoes = apur ? n(apur.deducoes) : 0;
      const saldoApurado = apur ? n(apur.saldodevedor) : r2(Math.max(0, debitoIcms - creditoIcms));
      const saldoCredor = apur ? n(apur.saldocredorseguinte) : r2(Math.max(0, creditoIcms - debitoIcms));
      const aRecolher = apur ? n(apur.arecolher) : saldoApurado;
      if (apur) {
        // E110 (14) com os campos que só a apuração tem: ajustes, estornos, saldo credor anterior e deduções.
        // ⚠️ o ajuste vai em **VL_AJ_DEBITOS/VL_AJ_CREDITOS** (campos 03/06) e os campos 04/07
        // (`VL_TOT_AJ_*`, "provenientes de documento fiscal") ficam ZERO — nós não temos ajuste vindo de
        // documento. Repetir o valor nos dois somava o ajuste DUAS VEZES: o nosso próprio validador pegou
        // (`VL_SLD_APURADO 9 ≠ max(0, débitos−créditos) 7`).
        arq.add('E110', [fmtNum(debTot), fmtNum(ajDeb), fmtNum(0), fmtNum(estCred), fmtNum(creTot), fmtNum(ajCred),
                         fmtNum(0), fmtNum(estDeb), fmtNum(saldoAnt), fmtNum(saldoApurado), fmtNum(deducoes),
                         fmtNum(aRecolher), fmtNum(saldoCredor), fmtNum(0)]);
      }
      if (!apur) {
      // E110 (14): VL_TOT_DEBITOS|VL_AJ_DEBITOS|VL_TOT_AJ_DEBITOS|VL_ESTORNOS_CRED|VL_TOT_CREDITOS|VL_AJ_CREDITOS|
      //            VL_TOT_AJ_CREDITOS|VL_ESTORNOS_DEB|VL_SLD_CREDOR_ANT|VL_SLD_APURADO|VL_TOT_DED|VL_ICMS_RECOLHER|
      //            VL_SLD_CREDOR_TRANSPORTAR|DEB_ESP
        arq.add('E110', [fmtNum(debitoIcms), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(creditoIcms), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(saldoApurado), fmtNum(0), fmtNum(saldoApurado), fmtNum(saldoCredor), fmtNum(0)]);
      }
      // E116 — obrigação do ICMS a recolher (fold auditoria ALTA: o PVA rejeita E110 com VL_ICMS_RECOLHER>0 sem
      // E116; supermercado tem débito>crédito quase todo mês → sem isto o arquivo não é entregável). COD_REC por
      // UF (MG='1206'/GO='108', fiel a Uspedfiscal.pas:797-807; demais UFs = '' até termos a tabela completa).
      // DT_VCTO = DT_INI + 45 dias (fiel ao legado); MES_REF = mmYYYY do período.
      if (aRecolher > 0) {
        const codRecUf: Record<string, string> = { MG: '1206', GO: '108' };
        const codRec = codRecUf[String(empresa.uf ?? '')] ?? '';
        const dv = new Date(`${String(dtini).slice(0, 10)}T00:00:00Z`);
        dv.setUTCDate(dv.getUTCDate() + 45);
        const mesRef = `${String(dtini).slice(5, 7)}${String(dtini).slice(0, 4)}`;
        // E116 (9): COD_OR|VL_OR|DT_VCTO|COD_REC|NUM_PROC|IND_PROC|PROC|TXT_COMPL|MES_REF
        arq.add('E116', ['000', fmtNum(aRecolher), fmtData(dv.toISOString().slice(0, 10)), codRec, '', '', '', '', mesRef]);
      }
    }
    arq.fecharBloco('E990', 'E');

    // BLOCO G — CIAP (crédito de ICMS do ativo permanente): sem dados — opener obrigatório.
    arq.add('G001', ['1']);
    arq.fecharBloco('G990', 'G');

    // BLOCO H — Inventário (ordem 0→C→D→E→G→H→K→1→9). H001 sempre (IND_MOV toggle); H005/H010 por evento de
    // inventário com data no período.
    this.emitirBlocoH(arq, inventario, docs, op.codigoProduto);

    // BLOCO K — controle da produção e do estoque: sem dados (ADIADO — config-gated OPTANTE_BLOCOK + fonte vazia) —
    // opener obrigatório.
    arq.add('K001', ['1']);
    arq.fecharBloco('K990', 'K');

    // BLOCO 1 — outras informações: sem dados — opener obrigatório.
    arq.add('1001', ['1']);
    arq.fecharBloco('1990', '1');

    const arquivo = arq.gerar();
    // o nome do ConfigGeracaoArquivoSPED (Uspedfiscal.pas:1468): 'SPED_' + CNPJ sem pontuação + '_' + a data de hoje (ddmmaaaa) + '.txt'
    const [aa, mm, dd] = hojeNaLoja().split('-');
    return {
      arquivo,
      nomeArquivo: `SPED_${cnpj}_${dd}${mm}${aa}.txt`,
      linhas: arquivo.trimEnd().split('\r\n').length,
      documentos: docs.nfs.length,
      parcial: true,
      validacao: validarSpedFiscal(arquivo),
      aviso: `PARCIAL (corte-4): bloco 0 + bloco C (${docs.nfs.length} docs; C100/C170/C190 por IND_OPER + ${nfce.length} NFC-e (C100 65 + C190) + ${inutilizadas.length} faixa(s) inutilizada(s) + C500/C590 energia/gás/água mod 06/28/29) + bloco E (E110 ${origemE110}; E116 quando há a recolher) + bloco D (${frete.length} frete D100/D190 + ${telecom.length} telecom D500/D590) + bloco H (${inventario ? `inventário de ${inventario.data}, ${inventario.itens.length} item(ns)` : 'sem inventário'}; H005/H010/H020) + blocos G/K/1 (só opener, sem dados) + bloco 9. Estrutura de blocos completa. Sem ST/DIFAL/IPI; conteúdo de G/K/1 não migrado. C176/C195/C197/C800 confirmados mortos (cópia fiel).`,
    };
  }

  /**
   * documentos do período (nf tipo IN E/S, proc='S') + itens + cadastros (parceiros/produtos/unidades). A seleção do legado (adqNF,
   * UdmSpedFiscal.dfm:2604-2685): fora os modelos 02/03/07/08/57 (o 07/08 é do bloco D) e a NF-e 55 sem chave que não é inutilizada;
   * a nota entra se ao menos um ITEM tem CFOP que gera SPED (o JOIN é pelo item, não pelo cabeçalho).
   */
  private async coletarEntrada(db: AnyDB, emp: number, dtini: string, dtfim: string, tipos: string[] = ['E', 'S']) {
    const nfs = (await db
      .selectFrom('nf')
      .leftJoin('parceiros as px', 'px.codparceiro', 'nf.codparceiro')
      .select(['nf.codnf', 'nf.tipo', 'nf.modelo', 'nf.nronf', 'nf.serie', 'nf.chavenfe', 'nf.dtemissao', 'nf.dtcontabil', 'nf.tipoemissao', 'nf.codparceiro', 'nf.codparceiro_end',
        'nf.cfop', 'nf.totalnf', 'nf.totaldesc', 'nf.totaldescfinal', 'nf.totalprod', 'nf.totalfrete', 'nf.totalseguro', 'nf.totalacessorias', 'nf.totalipi', 'nf.tipofrete', 'nf.stexterno',
        'nf.obs', 'nf.totalicm_st', 'nf.total_fcp_valor_st',
        'px.classfiscal as classfiscal_parceiro', sql`coalesce(nf.cancelada,'N')`.as('cancelada'), sql`coalesce(nf.statusnfe,'')`.as('statusnfe')])
      .where('nf.idempresa', '=', emp)
      .where('nf.tipo', 'in', tipos.length ? tipos : ['-']) // as Entradas e/ou as Saídas da tela (as duas por padrão)
      .where('nf.proc', '=', 'S')
      .where('nf.dtcontabil', '>=', dtini)
      .where('nf.dtcontabil', '<=', dtfim)
      .where('nf.nronf', 'is not', null)
      .where('nf.nronf', 'not in', ['0', '000000'])
      .where(sql<boolean>`coalesce(nf.modelo, 0) not in (2, 3, 7, 8, 57)`)
      .where(sql<boolean>`not (coalesce(nf.modelo, 0) = 55 and nf.chavenfe is null and coalesce(nf.statusnfe, 'P') <> 'I')`)
      // o CFOP que não gera SPED: a nota fica se algum item gera (UdmSpedFiscal.dfm:2658; mig 301) — energia/gás/água (C500) não depende
      .where(sql<boolean>`(coalesce(nf.modelo, 0) in (6, 28, 29) or exists (select 1 from nf_prod np join cfop c on c.codcfop::text = np.cfop::text
                 and coalesce(c.nao_gera_sped,'N') = 'N' where np.codnf = nf.codnf))`)
      .orderBy('nf.codnf')
      .limit(5000)
      .execute()) as Array<Record<string, any>>;
    const nfIds = nfs.map((n) => Number(n.codnf));
    const itens = nfIds.length
      ? ((await db.selectFrom('nf_prod as np')
          .leftJoin('cfop as c', (j: any) => j.on(sql`c.codcfop::text`, '=', sql`np.cfop::text`))
          .leftJoin('produtos as p', 'p.idproduto', 'np.codproduto')
          .leftJoin('piscofins as pc', 'pc.idpiscofins', 'p.idpiscofins')
          .select(['np.codnf', 'np.nroitem', 'np.codproduto', 'np.quantidade', 'np.fatorembal', 'np.vrcusto', 'np.desconto', 'np.vrdescprod', 'np.vrbasecalculo', 'np.icms',
            'np.icme', 'np.vricm', 'np.vripi', 'np.ipi', 'np.cst', 'np.origem_estoque', 'np.cfop', 'np.aliquota', 'np.bcr', 'np.depsacess', 'np.frete', 'np.vricmst',
            'np.fcp_valor_st', 'np.fcp_valor_st_ret', 'np.vfcpufdest', 'np.descricao', 'np.bcpiscofinse', 'np.vrpise', 'np.vrcofinse', 'np.aliqpise', 'np.aliqcofinse', 'np.cstpiscofins',
            'c.proc_cupom', sql`coalesce(c.nao_gera_sped,'N')`.as('nao_gera_sped'),
            'pc.cst_pis_ent', 'pc.cst_pis_sai', 'pc.cst_cofins_ent', 'pc.cst_cofins_sai', 'pc.aliq_pis_ent', 'pc.aliq_cofins_ent'])
          .where('np.codnf', 'in', nfIds)
          .orderBy('np.codnf').orderBy('np.nroitem').execute()) as Array<Record<string, any>>)
      : [];
    for (const it of itens) it.gera_sped = String(it.nao_gera_sped ?? 'N').toUpperCase() === 'S' ? 'N' : 'S';
    const porNf = new Map<number, Array<Record<string, any>>>();
    for (const it of itens) (porNf.get(Number(it.codnf)) ?? porNf.set(Number(it.codnf), []).get(Number(it.codnf))!).push(it);
    // o 0150 pelo endereço DA NOTA (sqqParceiros: `E.CODEND = NFAUXSPED.CODPARCEIRO_END`) — o endereço padrão está vazio em 329 de 332
    // endereços da produção, e o 0150 saía sem CNPJ/CPF e sem município
    const parceiroIds = [...new Set(nfs.map((n) => Number(n.codparceiro)).filter(Boolean))];
    const endDaNota = new Map<number, number>();
    for (const n of nfs) if (n.codparceiro != null && n.codparceiro_end != null && !endDaNota.has(Number(n.codparceiro))) endDaNota.set(Number(n.codparceiro), Number(n.codparceiro_end));
    const parceiros = new Map<number, Record<string, any>>();
    if (parceiroIds.length) {
      const rows = (await db
        .selectFrom('parceiros as p')
        .leftJoin('parceiros_end as pe', 'pe.codparceiro', 'p.codparceiro')
        .select(['p.codparceiro as codparceiro', 'p.razao as razao', 'pe.codend as codend', 'pe.cnpj_cpf as cnpj_cpf', 'pe.endereco as endereco', 'pe.bairro as bairro', 'pe.idcidade as idcidade'])
        .where('p.codparceiro', 'in', parceiroIds)
        .orderBy('pe.codend')
        .execute()) as Array<Record<string, any>>;
      for (const r of rows) {
        const cod = Number(r.codparceiro);
        const daNota = endDaNota.get(cod);
        if (!parceiros.has(cod) || (daNota != null && Number(r.codend) === daNota)) parceiros.set(cod, r);
      }
    }
    const prodIds = [...new Set(itens.map((i) => Number(i.codproduto)).filter(Boolean))];
    const produtos = new Map<number, Record<string, any>>();
    if (prodIds.length) {
      const rows = (await db.selectFrom('produtos').select(['idproduto', 'descricao', 'codbarra', 'unidade', 'ncmsh', 'cest', 'aliquota']).where('idproduto', 'in', prodIds).execute()) as Array<Record<string, any>>;
      for (const r of rows) produtos.set(Number(r.idproduto), r);
    }
    const unidades = new Set<string>();
    for (const p of produtos.values()) { const u = String(p.unidade ?? '').trim(); if (u) unidades.add(u); }
    return { nfs: nfs.map((n) => ({ ...n, itens: porNf.get(Number(n.codnf)) ?? [] })), parceiros, produtos, unidades };
  }

  /**
   * As notas com observação (o 0450 e o C110 — `sqqObsNF_Reg0450`, UdmSpedFiscal.dfm:4134): a nota do período da loja com endereço (a
   * NFAUXSPED) e CFOP que gera SPED, processada, não cancelada, não denegada, não inutilizada, com OBS (nem vazia, nem um espaço, nem
   * começando por quebra de linha), dos modelos do C100 (55 com chave; os demais fora de 2/3/6/7/8/21/22/28/29/57). O texto do 0450:
   * a entrada com ICMS-ST de terceiro vira "VALOR DE ST: … LANCADO EM OUTRAS"; a OBS em branco do 5929/6929, "NF REFERENTE A CUPOM";
   * as outras, a OBS. Produção set/2026: 462 notas na loja 1, 308 na loja 2.
   */
  private async coletarInformacoes(db: AnyDB, emp: number, dtini: string, dtfim: string, tipos: string[] = ['E', 'S']): Promise<Map<number, Record<string, any>>> {
    const rows = (await sql<Record<string, any>>`
        SELECT n.codnf, n.obs, n.totalicm_st, n.tipo, n.stexterno, n.cfop
          FROM nf n
          JOIN parceiros_end pe ON pe.codend = n.codparceiro_end
          JOIN cfop c ON c.codcfop = n.cfop AND coalesce(c.nao_gera_sped, 'N') = 'N'
         WHERE n.idempresa = ${emp} AND n.dtcontabil BETWEEN ${dtini}::date AND ${dtfim}::date
           AND n.obs IS NOT NULL AND n.obs <> ' ' AND n.obs NOT LIKE chr(13) || '%'
           AND ((n.modelo = 55 AND n.chavenfe IS NOT NULL AND coalesce(n.statusnfe, 'P') <> 'I') OR (n.modelo = 55 AND n.statusnfe = 'I')
                OR n.modelo NOT IN (22, 21, 6, 2, 8, 7, 28, 29, 3, 57, 55))
           AND n.proc = 'S' AND coalesce(n.statusnfe, 'Null') <> 'D' AND n.cancelada = 'N' AND n.nronf NOT IN ('000000')
           AND coalesce(n.statusnfe, 'P') <> 'I'
           AND n.tipo = ANY(${tipos.length ? tipos : ['-']}::text[])
         ORDER BY n.codnf`.execute(db)).rows;
    for (const r of rows) {
      r.txt0450 = (Number(r.totalicm_st) || 0) > 0 && String(r.tipo) === 'E' && String(r.stexterno ?? 'N') === 'N'
        ? `VALOR DE ST: ${numTexto(r.totalicm_st)} LANCADO EM OUTRAS`
        : String(r.obs ?? '').trim() === '' && ['5929', '6929'].includes(String(r.cfop ?? '')) ? 'NF REFERENTE A CUPOM' : String(r.obs ?? '').trim();
    }
    return new Map(rows.map((r) => [Number(r.codnf), r]));
  }

  /**
   * Os documentos referenciados das notas do período (o C113 — `sqqRegistroC113`, UdmSpedFiscal.dfm:7877-7967): a NOTA referenciada
   * (NF_REFERENCIA.CODNF_REF, fora o modelo 65) com o tipo, a emissão, o modelo, a série, o número, a data e a chave dela; e a NFC-e
   * referenciada (o modelo 65 — a NFC do legado, aqui pela venda carimbada com o CODNFC dela), saída de emissão própria com o participante
   * da nota. O participante da nota referenciada entra no 0150 (o C113 aponta para ele). Produção 2026: 774 notas e 619 NFC-e
   * referenciadas; set/2026, 55 notas com observação e referência na loja 1.
   */
  private async coletarReferenciados(db: AnyDB, docs: { nfs: Array<Record<string, any>>; parceiros: Map<number, Record<string, any>> }): Promise<Map<number, Array<Record<string, any>>>> {
    const ids = docs.nfs.map((n) => Number(n.codnf));
    if (!ids.length) return new Map();
    const rows = (await sql<Record<string, any>>`
        SELECT r.codnf, n.tipo, n.tipoemissao::text AS tipoemissao, n.modelo::text AS modelo, n.serie, n.nronf, n.dtemissao::text AS dtemissao,
               n.codparceiro, n.codparceiro_end, n.chavenfe, 1 AS parte, r.codnfreferencia
          FROM nf_referencia r JOIN nf n ON n.codnf = r.codnf_ref
         WHERE r.codnf = ANY(${ids}::int[]) AND coalesce(r.modelo, n.modelo) <> 65
        UNION ALL
        SELECT r.codnf, 'S', '0', '65', v.nroserie::text, v.nrocupom::text, (v.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date::text,
               n.codparceiro, n.codparceiro_end, v.chavenfe, 2, r.codnfreferencia
          FROM nf_referencia r
          JOIN nf n ON n.codnf = r.codnf
          JOIN LATERAL (SELECT x.nroserie, x.nrocupom, x.dtvenda, x.chavenfe FROM vendas x WHERE x.codnfc = r.codnf_ref ORDER BY x.codvendas LIMIT 1) v ON true
         WHERE r.codnf = ANY(${ids}::int[]) AND coalesce(r.modelo, n.modelo) = 65
         ORDER BY 1, 11, 12`.execute(db)).rows;
    const out = new Map<number, Array<Record<string, any>>>();
    for (const r of rows) out.set(Number(r.codnf), [...(out.get(Number(r.codnf)) ?? []), r]);
    // o participante da nota referenciada no 0150, pelo endereço DA NOTA (como o 0150 das notas do período)
    const faltam = new Map<number, number | null>();
    for (const r of rows) {
      const cod = Number(r.codparceiro);
      if (cod && !docs.parceiros.has(cod) && !faltam.has(cod)) faltam.set(cod, r.codparceiro_end != null ? Number(r.codparceiro_end) : null);
    }
    if (faltam.size) {
      const ps = (await db.selectFrom('parceiros as p').leftJoin('parceiros_end as pe', 'pe.codparceiro', 'p.codparceiro')
        .select(['p.codparceiro as codparceiro', 'p.razao as razao', 'pe.codend as codend', 'pe.cnpj_cpf as cnpj_cpf', 'pe.endereco as endereco', 'pe.bairro as bairro', 'pe.idcidade as idcidade'])
        .where('p.codparceiro', 'in', [...faltam.keys()]).orderBy('pe.codend').execute()) as Array<Record<string, any>>;
      for (const p of ps) {
        const cod = Number(p.codparceiro);
        const daNota = faltam.get(cod);
        if (!docs.parceiros.has(cod) || (daNota != null && Number(p.codend) === daNota)) docs.parceiros.set(cod, p);
      }
    }
    return out;
  }

  /**
   * O faturamento das notas do período (`adqFaturamento`, UdmSpedFiscal.dfm:3852): FATURAMENTO da nota, ordenado pela fatura, com o tipo do
   * título pelo TIPODOC do a receber dela (DUPLICATA 00, CHEQUE 01, PROMISSORIA 02, RECIBO 03, senão 99). O LEFT JOIN do legado com o
   * ARECEBER repete a parcela quando a nota tem mais de um título — aqui o tipo vem do primeiro título e a parcela sai uma vez; e a nota
   * sem faturamento fica sem C140 (o legado o escrevia com o título vazio, que o PVA recusa). Produção: 47.685 parcelas.
   */
  private async coletarFaturamento(db: AnyDB, docs: { nfs: Array<Record<string, any>> }): Promise<Map<number, Array<Record<string, any>>>> {
    const ids = docs.nfs.map((n) => Number(n.codnf));
    if (!ids.length) return new Map();
    const rows = (await sql<Record<string, any>>`
        SELECT f.idnf, f.nrofatura AS num_parc, f.valor AS valor_parc, f.totalparcelasfatura AS qtd_parc, f.data::text AS data_venc,
               (SELECT CASE r.tipodoc WHEN 'DUPLICATA' THEN '00' WHEN 'CHEQUE' THEN '01' WHEN 'PROMISSORIA' THEN '02' WHEN 'RECIBO' THEN '03' ELSE '99' END
                  FROM areceber r WHERE r.idnf = f.idnf ORDER BY r.codrcb LIMIT 1) AS ind_tit,
               (SELECT r.tipodoc FROM areceber r WHERE r.idnf = f.idnf ORDER BY r.codrcb LIMIT 1) AS desc_tit
          FROM faturamento f
         WHERE f.idnf = ANY(${ids}::int[])
         ORDER BY f.idnf, f.nrofatura`.execute(db)).rows;
    const out = new Map<number, Array<Record<string, any>>>();
    for (const r of rows) out.set(Number(r.idnf), [...(out.get(Number(r.idnf)) ?? []), r]);
    return out;
  }

  /**
   * O inventário do BLOCO H como a tela do legado o escolhe (GeraBlocoH, Uspedfiscal.pas:1058-1170; sqqInventarioCons,
   * UdmSpedFiscal.dfm:6505): só com "Gerar H001 (Inventário)" marcado, os itens da loja com a DATA DO ITEM (INVENTARIO.DATAINVENTARIO —
   * o carimbo da folha; o livro 242 da produção tem 31/12/2025 e os itens 03/03/2026) igual à "Data Inventário"; com "Correção
   * Tributária", só os de TIPO 'T'. A conta (COD_CTA) é a do plano de contas do produto (CODEXPINTEIRO). Com MOT_INV ≥ 02 vai o H020:
   * o CST e o ICM da alíquota do item na UF da loja (DET_ALIQUOTA — GetInfoH020). Antes o Apollo pegava sozinho todo inventário cujo LIVRO
   * caía no período: o de 31/12 saía na EFD de dezembro, e não na de fevereiro, onde o operador o informa.
   */
  private async coletarInventario(db: AnyDB, emp: number, op: OpcaoInventario | undefined, uf: string) {
    if (!op) return null;
    const rows = (await sql<Record<string, any>>`
        SELECT i.codinvent, i.idproduto, i.codbarra, i.descricao, i.unidade, i.qtde, i.vrcusto, i.vrvenda, i.tipo, i.aliquota,
               (i.datainventario AT TIME ZONE 'America/Sao_Paulo')::date::text AS datainventario, c.codexpinteiro,
               d.cst AS cst_h020, d.icm AS icm_h020
          FROM inventario i
          JOIN produtos p ON p.idproduto = i.idproduto
          LEFT JOIN plano_contas c ON c.codplanocontas = p.codplanocontas
          LEFT JOIN det_aliquota d ON d.aliquota = i.aliquota AND d.uf = ${uf}
         WHERE i.idempresa = ${emp} AND (i.datainventario AT TIME ZONE 'America/Sao_Paulo')::date = ${op.data}::date
           ${op.correcao ? sql`AND i.tipo = 'T'` : sql``}
           AND i.qtde > 0
         ORDER BY i.idproduto, i.codinvent`.execute(db)).rows;
    // o mesmo produto em duas folhas da mesma data (o ETL do golden salvou inventários em duplicata): fica a folha mais recente
    const porProduto = new Map<number, Record<string, any>>();
    for (const r of rows) porProduto.set(Number(r.idproduto), r);
    return { ...op, itens: [...porProduto.values()] };
  }

  /** BLOCO H — Inventário (GeraBlocoH, Uspedfiscal.pas:1058-1170). H001 IND_MOV pela opção da tela ("Gerar H001 (Inventário)"); com ela, o
   *  H005 (DT_INV = a data do inventário, VL_INV = Σ VL_ITEM, MOT_INV da tela) e um H010 por item que está no 0200 (COD_ITEM | UNID |
   *  QTD | VL_UNIT | VL_ITEM = máx(0, qtde × custo) | IND_PROP 0 | COD_PART '' | TXT_COMPL '' | COD_CTA = CODEXPINTEIRO | VL_ITEM_IR) e,
   *  com MOT_INV ≥ 02, o H020 (CST_ICMS | BC_ICMS = VL_ITEM | VL_ICMS = VL_ITEM × ICM / 100). Item sem saldo fica de fora (QTD ≤ 0). */
  private emitirBlocoH(arq: SpedArquivo, inventario: (OpcaoInventario & { itens: Array<Record<string, any>> }) | null, docs: { produtos: Map<number, Record<string, any>> },
    codigoProduto: 'ean' | 'plu' = 'plu'): void {
    arq.add('H001', [inventario ? '0' : '1']); // IND_MOV
    if (inventario) {
      const linhas = inventario.itens.filter((it) => docs.produtos.has(Number(it.idproduto))).map((it) => {
        const q = nn(it.qtde);
        const vu = nn(it.vrcusto);
        const total = r2(Math.max(0, q * vu)); // VL_ITEM = qtde×vrcusto, piso 0 (fiel: CASE WHEN <0 THEN 0)
        return { it, q, vu, total };
      });
      const vlInv = r2(linhas.reduce((s, l) => s + l.total, 0));
      const motivo = Number(inventario.motivo ?? 1);
      // H005 (3): DT_INV|VL_INV|MOT_INV
      arq.add('H005', [fmtData(inventario.data), fmtNum(vlInv), String(motivo).padStart(2, '0')]);
      for (const { it, q, vu, total } of linhas) {
        // H010 (10): COD_ITEM|UNID|QTD|VL_UNIT|VL_ITEM|IND_PROP|COD_PART|TXT_COMPL|COD_CTA|VL_ITEM_IR
        arq.add('H010', [codigoProduto === 'ean' ? String(it.codbarra ?? '').trim() : String(it.idproduto), String(it.unidade ?? '').trim(), fmtNum(q, 3), fmtNum(vu, 2), fmtNum(total), '0', '', '', String(it.codexpinteiro ?? ''), fmtNum(total)]);
        if (motivo >= 2) {
          // H020 (3): CST_ICMS|BC_ICMS|VL_ICMS — o CST de DET_ALIQUOTA em 3 dígitos
          const cst = it.cst_h020 == null ? '' : String(it.cst_h020).padStart(3, '0');
          arq.add('H020', [cst, fmtNum(total), fmtNum(r2((total * nn(it.icm_h020)) / 100))]);
        }
      }
    }
    arq.fecharBloco('H990', 'H');
  }

  /** 0150 (participantes) / 0190 (unidades) / 0200 (itens) — COD_PART=codparceiro / COD_ITEM=idproduto (consistente com o bloco C). */
  private emitirCadastros(
    arq: SpedArquivo, docs: { parceiros: Map<number, Record<string, any>>; produtos: Map<number, Record<string, any>>; unidades: Set<string> },
    alt: { alt0175: Array<Record<string, unknown>>; alt0205: Array<Record<string, unknown>>; dtini: string; dtfim: string } = { alt0175: [], alt0205: [], dtini: '', dtfim: '' },
    codigoProduto: 'ean' | 'plu' = 'plu',
  ): void {
    // DT_FIM fora do período vira o penúltimo dia dele (`GetDtFim0205`); DT_INI não passa do DT_FIM (`GetDtIni0205`)
    const dtFimSped = (d: string) => {
      if (d >= alt.dtini.slice(0, 10) && d <= alt.dtfim.slice(0, 10)) return d;
      const f = new Date(`${alt.dtfim.slice(0, 10)}T00:00:00Z`);
      f.setUTCDate(f.getUTCDate() - 1);
      return f.toISOString().slice(0, 10);
    };
    const porCodigo = (rows: Array<Record<string, unknown>>) => {
      const m = new Map<number, Array<Record<string, unknown>>>();
      for (const r of rows) m.set(Number(r.codigo_registro), [...(m.get(Number(r.codigo_registro)) ?? []), r]);
      return m;
    };
    const a0175 = porCodigo(alt.alt0175);
    const a0205 = porCodigo(alt.alt0205);
    const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\|/g, ' ');
    for (const p of docs.parceiros.values()) {
      const doc = soDigitos(p.cnpj_cpf as string);
      // 0150 (12): COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|ENDERECO|NUM|COMPL|BAIRRO
      arq.add('0150', [String(p.codparceiro), String(p.razao ?? '').trim(), '1058', doc.length === 14 ? doc : '', doc.length === 11 ? doc : '', '', p.idcidade != null ? String(p.idcidade) : '', '', String(p.endereco ?? '').trim().slice(0, 60), '', '', String(p.bairro ?? '').trim()]);
      // 0175 (3): DT_ALT|NR_CAMPO|CONT_ANT — o CNPJ anterior vazio não é informado
      for (const r of a0175.get(Number(p.codparceiro)) ?? []) {
        if (r.campo === '05' && String(r.vl_anterior ?? '') === '') continue;
        arq.add('0175', [fmtData(dtFimSped(String(r.dt_fim))), String(r.campo), semAcento(String(r.vl_anterior ?? ''))]);
      }
    }
    for (const u of docs.unidades) arq.add('0190', [u, u]); // UNID|DESCR
    for (const p of docs.produtos.values()) {
      const ncm = String(p.ncmsh ?? '').replace(/\D/g, '');
      // 0200 (12): COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|TIPO_ITEM(00)|COD_NCM|EX_IPI|COD_GEN|COD_LST|ALIQ_ICMS|CEST
      // COD_ITEM pelo "Codigo Produto" da tela: PLU (o código interno — o padrão) ou EAN (o código de barras) — Uspedfiscal.pas:1922
      arq.add('0200', [codigoProduto === 'ean' ? String(p.codbarra ?? '').trim() : String(p.idproduto), String(p.descricao ?? '').trim(), String(p.codbarra ?? '').trim(), '', String(p.unidade ?? '').trim(), '00', ncm ? ncm.padStart(8, '0') : '', '', ncm.slice(0, 2), '', '', String(p.cest ?? '').trim()]);
      // 0205 (4): DESCR_ANT_ITEM|DT_INI|DT_FIM|COD_ANT_ITEM — primeiro as descrições, depois os códigos; períodos
      // sobrepostos do mesmo campo são pulados (`InsereRegistro0205`: o DT_INI tem de passar do DT_FIM anterior)
      const rows = a0205.get(Number(p.idproduto)) ?? [];
      for (const campo of ['DESCRICAO', 'CODBARRA']) {
        let ultFim = '';
        for (const r of rows.filter((x) => x.campo === campo)) {
          const fim = dtFimSped(String(r.dt_fim));
          let ini = String(r.dt_ini) >= fim ? fim : String(r.dt_ini);
          if (ini === ultFim && ini < fim) {
            const d = new Date(`${ini}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + 1);
            ini = d.toISOString().slice(0, 10);
          }
          if (ultFim && ini <= ultFim) continue;
          const anterior = String(r.vl_anterior ?? '').trim();
          arq.add('0205', campo === 'DESCRICAO' ? [anterior.slice(0, 105), fmtData(ini), fmtData(fim), ''] : ['', fmtData(ini), fmtData(fim), anterior]);
          ultFim = fim;
        }
      }
    }
  }

  /** BLOCO C: C001 + por NF de ENTRADA/SAÍDA C100/C170 + C190 (analítico por CST_ICMS+CFOP+ALIQ_ICMS) + C990.
   *  IND_OPER por sentido (0=entrada/1=saída). Retorna o ICMS de ENTRADA (crédito) e de SAÍDA (débito) p/ o E110. */
  private emitirBlocoC(arq: SpedArquivo, docs: { nfs: Array<Record<string, any> & { itens: Array<Record<string, any>> }>; produtos: Map<number, Record<string, any>> },
    inutilizadas: Array<Record<string, any>> = [], nfce: NfceSped[] = [], dtini = '', informacoes: Map<number, Record<string, any>> = new Map(),
    referenciados: Map<number, Array<Record<string, any>>> = new Map(), op: OpcoesC = opcoesPadrao({}),
    faturamento: Map<number, Array<Record<string, any>>> = new Map()): { creditoIcms: number; debitoIcms: number } {
    const temDocs = docs.nfs.length > 0 || inutilizadas.length > 0 || nfce.length > 0;
    arq.add('C001', [temDocs ? '0' : '1']);
    let creditoIcms = 0;
    let debitoIcms = 0;
    if (!temDocs) { arq.fecharBloco('C990', 'C'); return { creditoIcms: 0, debitoIcms: 0 }; }
    // as numerações INUTILIZADAS (GeraNFInutilizadas, Uspedfiscal.pas:2236-2303): um C100 por número da faixa, saída de emissão própria,
    // modelo 65 (NFCE) ou 55, COD_SIT 05 e só o cabeçalho
    for (const f of inutilizadas) {
      const codMod = String(f.tiponf ?? '').trim().toUpperCase() === 'NFCE' ? '65' : '55';
      const ser = String(f.serie ?? '').trim().padStart(3, '0');
      for (let num = Number(f.numeracao_ini); num <= Number(f.numeracao_fim); num++) {
        arq.add('C100', ['1', '0', '', codMod, '05', ser, String(num), '', ...Array(20).fill('')]);
      }
    }
    const ENERGIA = new Set([6, 28, 29]); // mod 06 energia / 28 gás / 29 água → C500/C590 (não C100)
    // mod 21/22 (telecom): o legado os leva ao D500/D590 (GeraBlocoD, Uspedfiscal.pas:516-672), que ainda não está convertido — ficam
    // fora do bloco C (COD_MOD 21/22 não é do C100)
    const BLOCO_D = new Set([21, 22]);
    for (const nf of docs.nfs) {
      if (ENERGIA.has(Number(nf.modelo))) continue; // energia/gás/água emitidos no laço C500 abaixo
      if (BLOCO_D.has(Number(nf.modelo))) continue; // telecom mod 21/22: é do bloco D (D500/D590), não do C100
      const saida = String(nf.tipo) === 'S';
      const indOper = saida ? '1' : '0'; // IND_OPER: 0=entrada / 1=saída
      const indEmit = String(nf.tipoemissao ?? '0') === '0' ? '0' : '1';
      const codMod = String(nf.modelo ?? '') === '90' ? '1B' : String(nf.modelo ?? '').padStart(2, '0');
      const ser = String(nf.serie ?? '').trim();
      const st = String(nf.statusnfe ?? '');
      // fold auditoria [ALTA]: doc cancelado(02)/denegado(04)/inutilizado(05) → só o header identificador, SEM
      // C170/C190 e SEM ICMS (fiel ao legado; evita crédito/débito fantasma no E110).
      // COD_SIT (GetCodSit, Uspedfiscal.pas:2149-2170): cancelada 02, denegada 04, inutilizada 05 e a série 890-899 (NF avulsa) 08
      const serieN = Number(ser);
      const codSit = String(nf.cancelada) === 'S' || st === 'C' ? '02' : st === 'D' ? '04' : st === 'I' ? '05' : serieN >= 890 && serieN <= 899 ? '08' : '00';
      if (codSit === '02' || codSit === '04' || codSit === '05') {
        // cancelado/denegado/inutilizado: só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e CHV_NFE (Guia Prático; o legado
        // força IND_EMIT 0, pas:2348); a inutilizada não tem chave (pas:2354)
        const chv = codSit === '05' ? '' : ((nf.chavenfe as string) ?? '');
        arq.add('C100', [indOper, '0', '', codMod, codSit, ser.padStart(3, '0'), String(nf.nronf ?? ''), chv, ...Array(20).fill('')]);
        continue;
      }
      const itens = nf.itens;
      const simples = String(nf.tipo) === 'E' && String(nf.classfiscal_parceiro ?? '').trim().toUpperCase() === 'SN';
      const stExterno = String(nf.stexterno ?? '').toUpperCase() === 'S';
      const geram = itens.filter((it) => it.gera_sped !== 'N');
      // o ICMS do cabeçalho = Σ dos itens já zerados; 0 se o 1º item é x929 ou a entrada é de fornecedor do Simples (pas:2383-2402)
      const primeiro929 = String(itens[0]?.cfop ?? '').slice(1, 4) === '929';
      const icmsItens = itens.map((it) => icmsDoItem(it, false));
      const bcC100 = primeiro929 || simples ? 0 : r2(icmsItens.reduce((a, x) => a + x.bc, 0));
      const vlC100 = primeiro929 || simples ? 0 : r2(icmsItens.reduce((a, x) => a + x.vl, 0));
      // IND_PGTO: 'Outros' (2) nos CFOPs de bonificação/remessa do cabeçalho, senão 'A prazo' (1) — pas:2421-2427
      const indPgto = ['1910', '2910', '5929', '6929'].includes(String(nf.cfop ?? '')) ? '2' : '1';
      const vlMerc = r2(geram.reduce((a, it) => a + r2(nn(it.vrcusto) * nn(it.quantidade)), 0));
      // VL_PIS/VL_COFINS: Σ (custo − desconto%) × a alíquota de ENTRADA do cadastro, em qualquer tipo (UdmSpedFiscal.dfm:2636-2646)
      const pisCofins = (campo: 'aliq_pis_ent' | 'aliq_cofins_ent') => r2(itens.reduce((a, it) => {
        const bruto = nn(it.quantidade) * nn(it.vrcusto);
        return a + r2(((bruto - (bruto * nn(it.desconto)) / 100) * nn(it[campo])) / 100);
      }, 0));
      const tipofrete = String(nf.tipofrete ?? '').trim();
      const entradaNf = String(nf.tipo) === 'E';
      // "Gerar C170 com IPI e ICMS-ST no total do item" (só entrada): a ST e o IPI vão para o valor da mercadoria e saem dos campos deles
      const destacar = op.destacarIpiStItem && entradaNf;
      // VL_OUT_DA = as despesas acessórias + o que a tela manda "Somar em Outras despesas" (Uspedfiscal.pas:2431-2445)
      const outrasDesp = r2(nn(nf.totalacessorias) + (op.somarIpiOutras ? nn(nf.totalipi) : 0) + (op.somarIcmsStOutras ? nn(nf.totalicm_st) : 0)
        + (op.somarFcpStOutras ? nn(nf.total_fcp_valor_st) : 0));
      const vlIcmsStC100 = destacar ? 0 : op.gerarIcmsSt ? nn(nf.totalicm_st) : 0;
      const vlIpiC100 = destacar || op.somarIpiOutras ? 0 : nn(nf.totalipi);
      if (op.zerado5929Documento && String(nf.cfop ?? '').slice(1, 4) === '929') {
        // "Gerar 5929 Zerado C190" com o CFOP x929 no cabeçalho: o C100 sai todo zerado, sem frete (Uspedfiscal.pas:2447-2480)
        arq.add('C100', [indOper, indEmit, String(nf.codparceiro ?? ''), codMod, codSit, ser.padStart(3, '0'), String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string), fmtData(nf.dtcontabil as string),
          fmtNum(0), indPgto, fmtNum(0), fmtNum(0), fmtNum(0), '9', fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0)]);
      } else {
        // C100 (28): IND_OPER(0=entrada)|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
        arq.add('C100', [indOper, indEmit, String(nf.codparceiro ?? ''), codMod, codSit, ser.padStart(3, '0'), String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string), fmtData(nf.dtcontabil as string),
          fmtNum(nn(nf.totalnf)), indPgto, fmtNum(r2(nn(nf.totaldesc) + Math.abs(nn(nf.totaldescfinal)))), fmtNum(0), fmtNum(destacar ? r2(vlMerc + nn(nf.totalicm_st) + nn(nf.totalipi)) : vlMerc),
          ['0', '1', '2', '3', '4', '9'].includes(tipofrete) ? tipofrete : '9', fmtNum(nn(nf.totalfrete)), fmtNum(nn(nf.totalseguro)), fmtNum(outrasDesp),
          fmtNum(bcC100), fmtNum(vlC100), fmtNum(0), fmtNum(vlIcmsStC100), fmtNum(vlIpiC100), fmtNum(pisCofins('aliq_pis_ent')), fmtNum(pisCofins('aliq_cofins_ent')), fmtNum(0), fmtNum(0)]);
      }
      // C110 (a nota com observação — `cdsObsNF_Reg0450.Locate`, Uspedfiscal.pas:2553-2567): COD_INF e o texto da observação da nota; o
      // "ST LANCADO" vira o valor da ST "LANCADO EM ICMS RETIDO POR ST" (a opção de somar a ST em outras despesas vem desmarcada). Os
      // documentos referenciados (C113) são filhos dele: sem observação, não há C113
      const info = informacoes.get(Number(nf.codnf));
      if (info) {
        const obs = String(nf.obs ?? '').trim();
        // o valor pelo `AsString` do Delphi (vírgula, sem zeros à direita, com o zero antes da vírgula)
        const st = String(Math.round((Number(nf.totalicm_st) || 0) * 100) / 100).replace('.', ',');
        const txt = obs.includes('ST LANCADO') ? `VALOR DE ST: ${st} LANCADO EM ${op.somarIcmsStOutras ? 'OUTRAS DESPESAS' : 'ICMS RETIDO POR ST'}` : obs;
        // C110 (2): COD_INF|TXT_COMPL
        arq.add('C110', [codInf(nf.codnf), txtSped(txt)]);
        for (const r of referenciados.get(Number(nf.codnf)) ?? []) {
          const mod = String(r.modelo ?? '');
          // C113 (9): IND_OPER|IND_EMIT|COD_PART|COD_MOD|SER|SUB|NUM_DOC|DT_DOC|CHV_DOCe — a série em 4 com zeros à esquerda, SUB '000'
          arq.add('C113', [String(r.tipo) === 'E' ? '0' : '1', String(r.tipoemissao) === '0' ? '0' : '1', r.codparceiro != null ? String(r.codparceiro) : '',
            mod === '90' ? '1B' : mod.padStart(2, '0'), String(r.serie ?? '').trim().padStart(4, '0'), '000', String(r.nronf ?? ''),
            r.dtemissao ? fmtData(String(r.dtemissao)) : '', String(r.chavenfe ?? '')]);
        }
      }
      // C140/C141 (o faturamento — "C140", desmarcado; :2667-2697): só o modelo 1, ou todos com "Gerar todos modelos de nota C140"; o título
      // é a nota (NUM_TIT = o número, VL_TIT = o total), o tipo pelo TIPODOC do a receber da nota e uma parcela por fatura
      const fat = faturamento.get(Number(nf.codnf)) ?? [];
      if (op.c140 && fat.length && (Number(nf.modelo) === 1 || op.c140TodosModelos)) {
        const indTit = String(fat[0].ind_tit ?? '99');
        // C140 (6): IND_EMIT|IND_TIT|DESC_TIT|NUM_TIT|QTD_PARC|VL_TIT
        arq.add('C140', [indEmit, indTit, indTit === '99' ? String(fat[0].desc_tit ?? '').trim() || 'OUTROS' : '', String(nf.nronf ?? ''), String(Math.trunc(nn(fat[0].qtd_parc))), fmtNum(nn(nf.totalnf))]);
        // C141 (3): NUM_PARC|DT_VCTO|VL_PARC
        for (const f of fat) arq.add('C141', [String(f.num_parc ?? ''), f.data_venc ? fmtData(String(f.data_venc)) : '', fmtNum(nn(f.valor_parc))]);
      }
      // C170: não sai na NF-e 55 de EMISSÃO PRÓPRIA, entrada ou saída (a opção "Gerar C170 notas de emissão própria" vem desmarcada,
      // Uspedfiscal.pas:2707-2709)
      const comC170 = op.c170Proprias || !(String(nf.modelo ?? '') === '55' && String(nf.tipoemissao ?? '0') === '0');
      if (comC170) {
        let nro = 0;
        const entrada = String(nf.tipo) === 'E';
        for (const it of itens) {
          const prod = docs.produtos.get(Number(it.codproduto));
          // "Gerar 5929 Zerado C170": o item x929 sem base, alíquota e ICMS (Uspedfiscal.pas:2711-2717)
          const icms = op.zerado5929C170 && String(it.cfop ?? '').slice(1, 4) === '929' ? { bc: 0, aliq: 0, vl: 0 } : icmsDoItem(it, simples);
          const vlItemBase = r2(nn(it.vrcusto) * nn(it.quantidade));
          const ipiItem = r2((vlItemBase * nn(it.ipi)) / 100);
          // com o destaque, a ST e o IPI do item entram no valor dele (VRCUSTO + VRICMST + IPI%, :2778)
          const vlItem = destacar ? r2(vlItemBase + nn(it.vricmst) + ipiItem) : vlItemBase;
          // PIS/COFINS pelo PISCOFINS do produto (dfm:2985-2991): entrada — CST de entrada (98 sem cadastro), base = valor − desconto,
          // alíquota de entrada; saída — CST de saída (04 sem cadastro) e o resto 0 (pas:2733-2745)
          const cstPis = String(Math.trunc(nn(entrada ? it.cst_pis_ent ?? 98 : it.cst_pis_sai ?? 4))).padStart(2, '0');
          const cstCofins = String(Math.trunc(nn(entrada ? it.cst_cofins_ent ?? 98 : it.cst_cofins_sai ?? 4))).padStart(2, '0');
          const basePc = entrada ? r2(vlItemBase - nn(it.vrdescprod)) : 0;
          const aliqPis = entrada ? nn(it.aliq_pis_ent) : 0;
          const aliqCofins = entrada ? nn(it.aliq_cofins_ent) : 0;
          // C170 (37): NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|COD_NAT|VL_BC_ICMS|ALIQ_ICMS|VL_ICMS|VL_BC_ICMS_ST|ALIQ_ST|VL_ICMS_ST|IND_APUR|CST_IPI|COD_ENQ|VL_BC_IPI|ALIQ_IPI|VL_IPI|CST_PIS|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|VL_ABAT_NT
          // QTD na unidade do produto (QUANTIDADE × FATOREMBAL, dfm:2910); a descrição é a da nota (dfm:2909); CST_IPI vazio (pas:2798);
          // VL_IPI = valor × IPI% (pas:2810)
          // COD_ITEM pelo "Codigo Produto"; CST 049 fixo com "Gerar CST 049" (:2789); VL_ICMS_ST com "Gerar ICMS ST" (:2814); VL_IPI 0 com o IPI
          // somado em outras despesas ou destacado no item (:2803-2812)
          arq.add('C170', [String(++nro), op.codigoProduto === 'ean' ? String(prod?.codbarra ?? '').trim() : String(it.codproduto ?? ''), String(it.descricao ?? prod?.descricao ?? '').trim(), fmtNum(r3(nn(it.quantidade) * (nn(it.fatorembal) || 1)), 3),
            String(prod?.unidade ?? '').trim(), fmtNum(vlItem), fmtNum(nn(it.vrdescprod)), '0', op.cst49 ? '049' : cst3(it.cst), String(it.cfop ?? ''), '', fmtNum(icms.bc), fmtNum(icms.aliq), fmtNum(icms.vl),
            fmtNum(0), fmtNum(0), fmtNum(destacar || !op.gerarIcmsSt ? 0 : nn(it.vricmst)), '0', '', '', fmtNum(0), fmtNum(0), fmtNum(destacar || op.somarIpiOutras ? 0 : ipiItem),
            cstPis, fmtNum(basePc), fmtNum(aliqPis, 4), '', '', fmtNum(r2((basePc * aliqPis) / 100)),
            cstCofins, fmtNum(basePc), fmtNum(aliqCofins, 4), '', '', fmtNum(r2((basePc * aliqCofins) / 100)), '', fmtNum(0)]);
        }
      }
      for (const g of gruposC190(itens, stExterno, simples)) {
        // "Gerar 5929 Zerado C190": o grupo x929 com VL_OPR 0 (:3118-3121); VL_ICMS_ST com "Gerar ICMS ST"; VL_IPI 0 com o IPI somado em outras
        // despesas; com o destaque no item (entrada), os dois 0 (:3166-3175)
        const x929 = g.cfop.slice(1, 4) === '929';
        // C190 (11): CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|COD_OBS
        arq.add('C190', [g.cst, g.cfop, fmtNum(g.aliq, 2), fmtNum(op.zerado5929Documento && x929 ? 0 : g.vlOpr), fmtNum(g.bc), fmtNum(g.vl), fmtNum(0),
          fmtNum(destacar || !op.gerarIcmsSt ? 0 : g.vlIcmsSt), fmtNum(g.vlRedBc), fmtNum(destacar || op.somarIpiOutras ? 0 : g.vlIpi), '']);
        // C191 (3) com "C191" (:3181-3189): VL_FCP_OP|VL_FCP_ST|VL_FCP_RET do grupo — o FCP da operação é o da UF de destino (VFCPUFDEST)
        if (op.c191) arq.add('C191', [fmtNum(g.fcpOp), fmtNum(g.fcpSt), fmtNum(g.fcpRet)]);
        if (saida) debitoIcms = r2(debitoIcms + g.vl); // SAÍDA → débito de ICMS
        else creditoIcms = r2(creditoIcms + g.vl); // ENTRADA → crédito de ICMS
      }
    }
    // as NFC-e (GeraNFC, Uspedfiscal.pas:3212-3460): C100 modelo 65 sem participante (chkGerarNFCParticipante desmarcado), sem C170
    // (CkbGerarItensNFCe desmarcado) e o C190 por CST/CFOP/alíquota das vendas; a cancelada, só o cabeçalho com a chave
    for (const c of nfce) {
      const ser = String(c.serie ?? '').trim().padStart(3, '0');
      if (c.cancelada) {
        arq.add('C100', ['1', '0', '', '65', '02', ser, c.nronf, c.chavenfe, ...Array(20).fill('')]);
        continue;
      }
      const dt = fmtData(c.dtemissao);
      // C100 (28): IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
      // VL_DOC = produtos − descontos + acréscimos (= NFC.TOTALNF em 1.338 de 1.338); IND_PGTO 1 (NFC.IND_PGTO nunca é nulo); VL_OUT_DA =
      // os acréscimos (= NFC.TOTALVROUTROS, 868 de 868)
      arq.add('C100', ['1', '0', '', '65', '00', ser, c.nronf, c.chavenfe, dt, dt, fmtNum(r2(c.totalProd - c.totalDesc + c.totalAcre)), '1', fmtNum(c.totalDesc), fmtNum(0),
        fmtNum(c.totalProd), '9', fmtNum(0), fmtNum(0), fmtNum(c.totalAcre), fmtNum(c.bc), fmtNum(c.icms), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0)]);
      for (const g of c.c190) {
        // C190 (11): CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|COD_OBS
        arq.add('C190', [g.cst, g.cfop, fmtNum(g.aliq, 2), fmtNum(g.vlOpr), fmtNum(g.bc), fmtNum(g.icms), fmtNum(g.bcSt), fmtNum(g.icmsSt), fmtNum(0), fmtNum(0), '']);
        debitoIcms = r2(debitoIcms + g.icms);
      }
    }
    // C500/C590 — energia elétrica (06) / gás (28) / água (29): documento de utility em registro próprio (fiel a
    // GeraNFEnergia, Uspedfiscal.pas:4040). IND_EMIT sempre terceiros ('1', edTerceiros); COD_CONS='01' só p/ energia
    // elétrica (mod 06 — classe de consumo é conceito de energia; gás/água → ''); TP_LIGACAO/COD_GRUPO_TENSAO ''
    // (config ausente). O ICMS NÃO entra no E110 (apuração derivada do C190 dos docs regulares — ver docstring).
    for (const nf of docs.nfs) {
      if (!ENERGIA.has(Number(nf.modelo))) continue;
      const codMod = String(nf.modelo).padStart(2, '0'); // 06/28/29
      const ser = String(nf.serie ?? '').trim();
      const st = String(nf.statusnfe ?? '');
      // DESVIO consciente do legado (que hardcoda regular): computamos COD_SIT p/ NÃO emitir doc cancelado/denegado
      // como regular com ICMS cheio (fantasma) — espelha o header-only do C100 neste mesmo arquivo. ('I'/inutilizada
      // N/A: energia é doc de TERCEIROS, não numeração própria.)
      const codSit = String(nf.cancelada) === 'S' || st === 'C' ? '02' : st === 'D' ? '04' : '00';
      const codCons = codMod === '06' ? '01' : ''; // classe de consumo só p/ energia elétrica
      const regular = codSit === '00';
      const itens = nf.itens;
      const soma = (c: string) => itens.reduce((s, it) => s + nn(it[c]), 0);
      const bcIcms = regular ? soma('vrbasecalculo') : 0;
      const vlIcms = regular ? soma('vricm') : 0;
      // C500 (26): IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|COD_CONS|NUM_DOC|DT_DOC|DT_E_S|VL_DOC|VL_DESC|
      //            VL_FORN|VL_SERV_NT|VL_TERC|VL_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|COD_INF|VL_PIS|
      //            VL_COFINS|TP_LIGACAO|COD_GRUPO_TENSAO
      arq.add('C500', ['0', '1', String(nf.codparceiro ?? ''), codMod, codSit, ser, '', codCons, String(nf.nronf ?? ''), fmtData(nf.dtemissao as string), fmtData(nf.dtcontabil as string), fmtNum(nn(nf.totalnf)), fmtNum(nn(nf.totaldesc)), fmtNum(nn(nf.totalprod)), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(bcIcms), fmtNum(vlIcms), fmtNum(0), fmtNum(0), '', fmtNum(regular ? soma('vrpise') : 0), fmtNum(regular ? soma('vrcofinse') : 0), '', '']);
      if (!regular) continue; // cancelado/denegado → só o header C500, sem C590 (evita ICMS fantasma)
      const grupos = new Map<string, { cstIcms: string; cfop: string; aliq: number; vlOpr: number; bcIcms: number; vlIcms: number }>();
      for (const it of itens) {
        const cstIcms = cst3(it.cst);
        const aliqIt = nn(it.icms);
        const vlItem = r2(nn(it.vrcusto) * nn(it.quantidade));
        const k = `${cstIcms}|${it.cfop}|${aliqIt.toFixed(2)}`;
        const g = grupos.get(k) ?? { cstIcms, cfop: String(it.cfop ?? ''), aliq: aliqIt, vlOpr: 0, bcIcms: 0, vlIcms: 0 };
        g.vlOpr = r2(g.vlOpr + vlItem);
        g.bcIcms = r2(g.bcIcms + nn(it.vrbasecalculo));
        g.vlIcms = r2(g.vlIcms + nn(it.vricm));
        grupos.set(k, g);
      }
      // fold auditoria [MÉDIA]: um C500 regular EXIGE ≥1 C590 (o PVA rejeita C500 órfão). Se o doc de energia veio
      // sem itens (ETL header-only), sintetiza um C590 do cabeçalho (CFOP da NF + ICMS somado, que será 0).
      if (grupos.size === 0) grupos.set('hdr', { cstIcms: '000', cfop: String(nf.cfop ?? ''), aliq: 0, vlOpr: r2(nn(nf.totalprod)), bcIcms, vlIcms });
      for (const g of grupos.values()) {
        // C590 (10): CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|COD_OBS
        arq.add('C590', [g.cstIcms, g.cfop, fmtNum(g.aliq, 2), fmtNum(g.vlOpr), fmtNum(g.bcIcms), fmtNum(g.vlIcms), fmtNum(0), fmtNum(0), fmtNum(0), '']);
      }
    }
    arq.fecharBloco('C990', 'C');
    return { creditoIcms, debitoIcms };
  }

  /** NFE_INUTILIZADA do período (cdsNF_Inutilizada: TRUNC(DATA) no período, a empresa) */
  private async coletarInutilizadas(db: AnyDB, emp: number, dtini: string, dtfim: string): Promise<Array<Record<string, any>>> {
    return (await db.selectFrom('nfe_inutilizada').select(['tiponf', 'serie', 'numeracao_ini', 'numeracao_fim'])
      .where('codempresa', '=', emp)
      .where(sql`cast(data at time zone 'America/Sao_Paulo' as date)`, '>=', String(dtini).slice(0, 10))
      .where(sql`cast(data at time zone 'America/Sao_Paulo' as date)`, '<=', String(dtfim).slice(0, 10))
      .orderBy('codinutilizacao').execute()) as Array<Record<string, any>>;
  }

  /**
   * as NFC-e do período a partir das VENDAS (a NFC, do PDV, não migra — a chave e o status vêm para a venda na carga): QryNFC/adqC190NFC
   * (UdmSpedFiscal.dfm:8528-8900) — autorizadas ('P', e a contingência 'G' com CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL) e as canceladas
   * ('C'); NUM_DOC = o cupom (= NFC.NRONF em 100%); por cupom os totais (produto pelo IAT: arredonda 'A', senão trunca), os descontos e os
   * acréscimos, e o C190 por CST/CFOP/alíquota das vendas não canceladas
   */
  private async coletarNfce(db: AnyDB, emp: number, dtini: string, dtfim: string): Promise<NfceSped[]> {
    const cfg = (await sql<{ valor: string | null }>`
      SELECT coalesce((SELECT e.valor FROM configuracoes_especificas e WHERE e.id = c.id LIMIT 1), c.valor) AS valor
        FROM configuracoes c WHERE c.codigo = 'CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL' LIMIT 1`.execute(db)).rows[0];
    const status = ['P', 'C', ...(String(cfg?.valor ?? '').trim().toUpperCase() === 'S' ? ['G'] : [])];
    const rows = (await db.selectFrom('vendas')
      .select(['nroserie', 'nrocupom', 'chavenfe', 'statusnfe', sql`to_char(dtvenda at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`.as('dtemissao'), 'iat', 'qtde', 'vrvenda',
        'desc_promocao', 'desc_departamento', 'desc_acre_medio', 'desc_acre_item', 'icms_base_calculo', 'icms_valor', 'icms_valor_base_calculo_st', 'icms_valor_st', 'icms_cst',
        'icms_aliquota', 'cfop', 'cancelado'])
      .where('idempresa', '=', emp)
      .where(sql`coalesce(venda_nfc,'N')`, '=', 'S')
      .where('chavenfe', 'is not', null)
      .where('statusnfe', 'in', status)
      .where(sql`cast(dtvenda at time zone 'America/Sao_Paulo' as date)`, '>=', String(dtini).slice(0, 10))
      .where(sql`cast(dtvenda at time zone 'America/Sao_Paulo' as date)`, '<=', String(dtfim).slice(0, 10))
      .orderBy('nroserie').orderBy('nrocupom').orderBy('nroitem')
      .execute()) as Array<Record<string, any>>;
    const nn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
    const porCupom = new Map<string, NfceSped & { grupos: Map<string, NfceSped['c190'][number]> }>();
    for (const v of rows) {
      const k = `${v.nroserie}|${v.nrocupom}|${v.chavenfe}`;
      let c = porCupom.get(k);
      if (!c) {
        c = { serie: String(v.nroserie ?? ''), nronf: String(v.nrocupom ?? ''), chavenfe: String(v.chavenfe ?? ''), dtemissao: String(v.dtemissao ?? ''),
          cancelada: String(v.statusnfe ?? '') === 'C', totalProd: 0, totalDesc: 0, totalAcre: 0, bc: 0, icms: 0, c190: [], grupos: new Map() };
        porCupom.set(k, c);
      }
      if (String(v.cancelado ?? 'N') === 'S') continue; // o item cancelado fica fora dos totais e do C190
      const bruto = nn(v.qtde) * nn(v.vrvenda);
      const total = String(v.iat ?? '') === 'A' ? r2(bruto) : Math.trunc(bruto * 100 + 1e-9) / 100;
      const neg = (x: unknown) => (nn(x) < 0 ? -nn(x) : 0);
      const pos = (x: unknown) => (nn(x) > 0 ? nn(x) : 0);
      const desc = nn(v.desc_promocao) + nn(v.desc_departamento) + neg(v.desc_acre_medio) + neg(v.desc_acre_item);
      const acre = pos(v.desc_acre_medio) + pos(v.desc_acre_item);
      c.totalProd = r2(c.totalProd + total);
      c.totalDesc = r2(c.totalDesc + desc);
      c.totalAcre = r2(c.totalAcre + acre);
      c.bc = r2(c.bc + r2(nn(v.icms_base_calculo)));
      c.icms = r2(c.icms + r2(nn(v.icms_valor)));
      const cst = String(Math.trunc(nn(v.icms_cst))).padStart(3, '0');
      const gk = `${cst}|${v.cfop}|${nn(v.icms_aliquota)}`;
      const g = c.grupos.get(gk) ?? { cst, cfop: String(v.cfop ?? ''), aliq: nn(v.icms_aliquota), vlOpr: 0, bc: 0, icms: 0, bcSt: 0, icmsSt: 0 };
      g.vlOpr = r2(g.vlOpr + total + acre - desc);
      g.bc = r2(g.bc + nn(v.icms_base_calculo));
      g.icms = r2(g.icms + nn(v.icms_valor));
      g.bcSt = r2(g.bcSt + nn(v.icms_valor_base_calculo_st));
      g.icmsSt = r2(g.icmsSt + nn(v.icms_valor_st));
      c.grupos.set(gk, g);
    }
    return [...porCupom.values()].map(({ grupos, ...c }) => ({ ...c, c190: [...grupos.values()] }));
  }


  /**
   * as notas do bloco D: FRETE (sqqNFfrete, UdmSpedFiscal.dfm:6751-6773 — modelos 7/8/9/10/11/26/27/57 no período contábil, número diferente
   * de 000000, sem filtro de processada nem de cancelada) e TELECOMUNICAÇÃO (sqqNFtelecomunicacao, :5268 — 21/22 processadas), com os itens
   * (o analítico) e o endereço da nota
   */
  private async coletarFrete(db: AnyDB, emp: number, dtini: string, dtfim: string, parceiros: Map<number, Record<string, any>>, modelos: number[], soProcessadas: boolean,
    tipos: string[] = ['E', 'S']):
    Promise<Array<Record<string, any> & { itens: Array<Record<string, any>> }>> {
    let q = db.selectFrom('nf').leftJoin('parceiros_end as pe', 'pe.codend', 'nf.codparceiro_end')
      .select(['nf.codnf', 'nf.tipo', 'nf.modelo', 'nf.nronf', 'nf.serie', 'nf.chavenfe', 'nf.dtemissao', 'nf.dtcontabil', 'nf.codparceiro', 'nf.codparceiro_end', 'nf.totalnf',
        'nf.totaldesc', 'nf.totalprod', 'nf.totalacessorias', 'nf.totalbaseicm', 'nf.totalicm', 'nf.tipofrete', 'pe.idcidade'])
      .where('nf.idempresa', '=', emp)
      .where(sql`coalesce(nf.modelo, 0)`, 'in', modelos)
      .where('nf.tipo', 'in', tipos.length ? tipos : ['-'])
      .where('nf.dtcontabil', '>=', dtini)
      .where('nf.dtcontabil', '<=', dtfim);
    // o frete não filtra o número nem a processada além do 000000; a telecomunicação só a processada
    q = soProcessadas ? q.where('nf.proc', '=', 'S') : q.where(sql<boolean>`coalesce(nf.nronf, '') <> '000000'`);
    const nfs = (await q.orderBy('nf.tipo').orderBy('nf.modelo').orderBy('nf.dtemissao').orderBy('nf.nronf').execute()) as Array<Record<string, any>>;
    const ids = nfs.map((n) => Number(n.codnf));
    const itens = ids.length
      ? ((await db.selectFrom('nf_prod as np').leftJoin('cfop as c', (j: any) => j.on(sql`c.codcfop::text`, '=', sql`np.cfop::text`))
        .select(['np.codnf', 'np.cst', 'np.cfop', 'np.vrcusto', 'np.desconto', 'np.quantidade', 'np.depsacess', 'np.frete', 'np.ipi', 'np.vricmst', 'np.bcr', 'np.aliquota',
          'np.icme', 'np.vricm', 'np.vrbasecalculo', 'c.proc_cupom'])
        .where('np.codnf', 'in', ids).orderBy('np.codnf').orderBy('np.nroitem').execute()) as Array<Record<string, any>>)
      : [];
    const porNf = new Map<number, Array<Record<string, any>>>();
    for (const it of itens) (porNf.get(Number(it.codnf)) ?? porNf.set(Number(it.codnf), []).get(Number(it.codnf))!).push(it);
    const faltam = [...new Set(nfs.map((n) => Number(n.codparceiro)).filter((c) => c && !parceiros.has(c)))];
    if (faltam.length) {
      const endDaNota = new Map<number, number>();
      for (const n of nfs) if (n.codparceiro != null && n.codparceiro_end != null && !endDaNota.has(Number(n.codparceiro))) endDaNota.set(Number(n.codparceiro), Number(n.codparceiro_end));
      const rows = (await db.selectFrom('parceiros as p').leftJoin('parceiros_end as pe', 'pe.codparceiro', 'p.codparceiro')
        .select(['p.codparceiro as codparceiro', 'p.razao as razao', 'pe.codend as codend', 'pe.cnpj_cpf as cnpj_cpf', 'pe.endereco as endereco', 'pe.bairro as bairro', 'pe.idcidade as idcidade'])
        .where('p.codparceiro', 'in', faltam).orderBy('pe.codend').execute()) as Array<Record<string, any>>;
      for (const r of rows) {
        const cod = Number(r.codparceiro);
        const daNota = endDaNota.get(cod);
        if (!parceiros.has(cod) || (daNota != null && Number(r.codend) === daNota)) parceiros.set(cod, r);
      }
    }
    return nfs.map((n) => ({ ...n, itens: porNf.get(Number(n.codnf)) ?? [] }));
  }

  /**
   * o analítico do frete/telecom (sqqAnaliticoFrete / sqqNFAnaliticoTel): por CST/CFOP/alíquota, o valor da operação (produto − desconto%
   * + despesas + frete% + IPI% + ST), e o ICMS/base só na alíquota tributada ('T…') fora do PROC_CUPOM, do x401/x403/x933/x556 e do
   * x101/x102 com CST 40/90
   */
  private analiticoD(itens: Array<Record<string, any>>): Array<{ cst: string; cfop: string; aliq: number; vlOpr: number; bc: number; icms: number }> {
    const nn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
    const grupos = new Map<string, { cst: string; cfop: string; aliq: number; vlOpr: number; bc: number; icms: number }>();
    for (const it of itens) {
      const sub = String(it.cfop ?? '').slice(1, 4);
      const tributa = String(it.proc_cupom ?? '') !== 'S' && !['401', '403', '933', '556'].includes(sub)
        && !(['102', '101'].includes(sub) && [40, 90].includes(Math.trunc(nn(it.cst)))) && String(it.aliquota ?? '').trim().toUpperCase().startsWith('T');
      const aliq = tributa ? r2(nn(it.icme)) : 0;
      const base = r2((nn(it.vrcusto) - (nn(it.vrcusto) * nn(it.desconto)) / 100) * nn(it.quantidade));
      const valor = base + nn(it.depsacess) + r2((nn(it.frete) * base) / 100) + r2((nn(it.ipi) * base) / 100) + r2(nn(it.vricmst));
      const cst = cst3(it.cst);
      const k = `${cst}|${it.cfop}|${aliq}`;
      const g = grupos.get(k) ?? { cst, cfop: String(it.cfop ?? ''), aliq, vlOpr: 0, bc: 0, icms: 0 };
      g.vlOpr = r2(g.vlOpr + valor);
      if (tributa) { g.bc = r2(g.bc + nn(it.vrbasecalculo)); g.icms = r2(g.icms + nn(it.vricm)); }
      grupos.set(k, g);
    }
    return [...grupos.values()];
  }

  /**
   * BLOCO D (GeraBlocoD, Uspedfiscal.pas:516-672) — D100 por nota de frete (sempre entrada de terceiros no legado, COD_SIT 00, série com 3
   * dígitos, SUB 000, a chave do CT-e, VL_DOC = VL_SERV = o total, base/ICMS do cabeçalho quando o analítico tem, os municípios pela direção)
   * com o D190 por CST/CFOP/alíquota; D500 por nota de telecomunicação 21/22 (assinante comercial/industrial, base e ICMS 0) com UM D590 —
   * o legado não percorre o analítico, grava o primeiro grupo. O VL_RED_BC do legado é a MÉDIA do BCR (um percentual no campo de valor):
   * aqui o D190 leva a regra do C190 (CST 20/70: operação − base) e o D590, 0 — decisão documentada no dossiê
   */
  private emitirBlocoD(arq: SpedArquivo, frete: Array<Record<string, any> & { itens: Array<Record<string, any>> }>, telecom: Array<Record<string, any> & { itens: Array<Record<string, any>> }>,
    idcidadeEmpresa: unknown): void {
    const nn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
    arq.add('D001', [frete.length || telecom.length ? '0' : '1']);
    for (const nf of frete) {
      const grupos = this.analiticoD(nf.itens);
      const bcAnal = grupos.reduce((a, g) => a + g.bc, 0);
      const icmsAnal = grupos.reduce((a, g) => a + g.icms, 0);
      const entrada = String(nf.tipo) === 'E';
      const munNota = nf.idcidade != null ? String(nf.idcidade) : '';
      const munEmp = idcidadeEmpresa != null ? String(idcidadeEmpresa) : '';
      const tf = nf.tipofrete == null || String(nf.tipofrete).trim() === '' ? '' : [0, 1, 2, 3, 4, 9].includes(nn(nf.tipofrete)) ? String(nn(nf.tipofrete)) : '';
      // D100 (24): IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC|CHV_CTE|DT_DOC|DT_A_P|TP_CT-e|CHV_CTE_REF|VL_DOC|VL_DESC|IND_FRT|VL_SERV|VL_BC_ICMS|VL_ICMS|VL_NT|COD_INF|COD_CTA|COD_MUN_ORIG|COD_MUN_DEST
      arq.add('D100', ['0', '1', String(nf.codparceiro ?? ''), String(nf.modelo ?? '').padStart(2, '0'), '00', String(nf.serie ?? '').trim().padStart(3, '0'), '000', String(nf.nronf ?? ''),
        String(nf.chavenfe ?? '').trim(), fmtData(nf.dtemissao as string), fmtData(nf.dtcontabil as string), '', '', fmtNum(nn(nf.totalnf)), fmtNum(0), tf, fmtNum(nn(nf.totalnf)),
        fmtNum(bcAnal > 0 ? nn(nf.totalbaseicm) : 0), fmtNum(icmsAnal > 0 ? nn(nf.totalicm) : 0), fmtNum(0), '', '', entrada ? munNota : munEmp, entrada ? munEmp : munNota]);
      for (const g of grupos) {
        const vlRedBc = ['020', '070'].includes(g.cst) ? r2(Math.max(0, g.vlOpr - g.bc)) : 0;
        // D190 (8): CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_RED_BC|COD_OBS
        arq.add('D190', [g.cst, g.cfop, fmtNum(g.aliq, 2), fmtNum(g.vlOpr), fmtNum(g.bc), fmtNum(g.icms), fmtNum(vlRedBc), '']);
      }
    }
    for (const nf of telecom) {
      // D500 (23): IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC|DT_DOC|DT_A_P|VL_DOC|VL_DESC|VL_SERV|VL_SERV_NT|VL_TERC|VL_DA|VL_BC_ICMS|VL_ICMS|COD_INF|VL_PIS|VL_COFINS|COD_CTA|TP_ASSINANTE
      arq.add('D500', ['0', '1', String(nf.codparceiro ?? ''), String(nf.modelo ?? ''), '00', String(nf.serie ?? '').trim(), '', String(nf.nronf ?? ''), fmtData(nf.dtemissao as string),
        fmtData(nf.dtcontabil as string), fmtNum(nn(nf.totalnf)), fmtNum(nn(nf.totaldesc)), fmtNum(nn(nf.totalprod)), fmtNum(0), fmtNum(0), fmtNum(nn(nf.totalacessorias)),
        fmtNum(0), fmtNum(0), '', fmtNum(0), fmtNum(0), '', '1']);
      const g = this.analiticoD(nf.itens)[0];
      // D590 (10): CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_UF|VL_ICMS_UF|VL_RED_BC|COD_OBS
      if (g) arq.add('D590', [g.cst, g.cfop, fmtNum(g.aliq, 2), fmtNum(g.vlOpr), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), '']);
    }
    arq.fecharBloco('D990', 'D');
  }

}
