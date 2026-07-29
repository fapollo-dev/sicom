import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SpedArquivo, fmtData, fmtNum, soDigitos } from './sped-writer';
import { validarSpedFiscal, type ResultadoValidacao } from './sped-fiscal-validator';

type AnyDB = Kysely<any>;
const nn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
 * BLOCO H (Inventário, fiel a GeraBlocoH Uspedfiscal.pas:1074-1168): H001 sempre (IND_MOV toggle) + por evento de
 * inventário no período (inventario_livro/inventario) H005 (DT_INV|VL_INV=Σ máx(0,qtde×vrcusto)|MOT_INV) + H010 por
 * item (COD_ITEM=idproduto gateado pelo 0200). Fonte: nossas tabelas do épico INVENTÁRIO (mig 090).
 *
 * ADIADO (corte-5+, com procedência): VL_SLD_CREDOR_ANT (carry do saldo credor do período anterior — precisa
 * persistir a apuração/APURACAO_ICMS; hoje 0, superestima a-recolher se houver credor acumulado) · blocos D/G/K/1
 * (K = config-gated OPTANTE_BLOCOK + APURACAO_ESTOQUE_ESCRITURADO vazio no golden; K230+ = produção, ROI~0) ·
 * H020 (só MOT_INV≥02 mudança-de-tributação — lookup DET_ALIQUOTA→CST/ICM) · E111/E113 (ajustes) · E200/E210 (ST)
 * · E300/E310 (DIFAL/FCP) · E500 (IPI) · redução de base (VL_RED_BC do C190 = 0) · multi-estab (C010) · COD_REC das
 * demais UFs · C500 TP_LIGACAO/COD_GRUPO_TENSAO (EMPRESAS.TP_LIGACAO/GRUPOTENSAO ausentes → ''). NOTA: o C170 de
 * saída própria mod-55 é FACULTATIVO no legado (default suprime, ckbC170Saidas); aqui é sempre emitido (reconcilia
 * C100↔C170↔C190) — equivale ao modo "checkbox ligado".
 */
@Injectable()
export class SpedEfdIcmsIpiService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(dtini: string, dtfim: string): Promise<{ arquivo: string; linhas: number; documentos: number; parcial: boolean; validacao: ResultadoValidacao; aviso: string }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const empresa = (await db
      .selectFrom('empresas')
      .select(['razao_social', 'fantasia', 'cnpj', 'insc', 'im', 'endereco', 'numero', 'bairro', 'uf', 'cep', 'fone1', 'idcidade'])
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as Record<string, any> | undefined;
    if (!empresa) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: emp });

    const cnpj = soDigitos(empresa.cnpj);
    const ie = String(empresa.insc ?? '').replace(/ISENTO/gi, '');
    const arq = new SpedArquivo();

    // 0000 (layout EFD ICMS/IPI, 14 campos): COD_VER|COD_FIN(0)|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA|IND_PERFIL|IND_ATIV
    // IND_PERFIL='A' e IND_ATIV='1'(outros) default — o legado lê de EMPRESA.PERFILSPED/INDICE_ATIV (ausentes no
    // monorepo → default documentado; refinável por config/coluna).
    arq.add('0000', [codVersaoFiscal(dtini), '0', fmtData(dtini), fmtData(dtfim), empresa.razao_social ?? '', cnpj, '', empresa.uf ?? '', ie, empresa.idcidade != null ? String(empresa.idcidade) : '', empresa.im ?? '', '', 'A', '1']);
    arq.add('0001', ['0']);
    // 0005 (9 campos): FANTASIA|CEP|ENDERECO|NUM|COMPL|BAIRRO|FONE|FAX|EMAIL
    arq.add('0005', [empresa.fantasia ?? empresa.razao_social ?? '', soDigitos(empresa.cep), empresa.endereco ?? '', empresa.numero ?? 'S/N', '', empresa.bairro ?? '', soDigitos(empresa.fone1), '', '']);

    const docs = await this.coletarEntrada(db, emp, dtini, dtfim);
    const inventario = await this.coletarInventario(db, emp, dtini, dtfim);
    // Bloco H (inventário) referencia COD_ITEM no 0200 → mescla os produtos do inventário no cadastro (fiel: o
    // legado gateia o H010 pela pertinência ao 0200; aqui garantimos que o 0200 cobre o inventário — reporta a
    // contagem COMPLETA e mantém integridade referencial, em vez de dropar itens sem movimento do período).
    const invProdIds = [...new Set(inventario.itens.map((i) => Number(i.idproduto)).filter(Boolean))].filter((id) => !docs.produtos.has(id));
    if (invProdIds.length) {
      const rows = (await db.selectFrom('produtos').select(['idproduto', 'descricao', 'codbarra', 'unidade', 'ncmsh', 'cest', 'aliquota']).where('idproduto', 'in', invProdIds).execute()) as Array<Record<string, any>>;
      for (const r of rows) { docs.produtos.set(Number(r.idproduto), r); const u = String(r.unidade ?? '').trim(); if (u) docs.unidades.add(u); }
    }
    this.emitirCadastros(arq, docs);
    arq.fecharBloco('0990', '0');

    // BLOCO C — documentos de ENTRADA (crédito) + SAÍDA (débito)
    const { creditoIcms, debitoIcms } = this.emitirBlocoC(arq, docs);

    // BLOCO E — apuração ICMS (corte-2): débito de SAÍDA − crédito de ENTRADA. Se débito>crédito → ICMS a
    // recolher; senão → saldo credor a transportar. E110 emitido sempre que há documento no bloco C.
    const temApuracao = docs.nfs.length > 0;
    arq.add('E001', [temApuracao ? '0' : '1']);
    if (temApuracao) {
      arq.add('E100', [fmtData(dtini), fmtData(dtfim)]);
      const saldoApurado = r2(Math.max(0, debitoIcms - creditoIcms)); // ICMS a recolher
      const saldoCredor = r2(Math.max(0, creditoIcms - debitoIcms)); // saldo credor a transportar
      // E110 (14): VL_TOT_DEBITOS|VL_AJ_DEBITOS|VL_TOT_AJ_DEBITOS|VL_ESTORNOS_CRED|VL_TOT_CREDITOS|VL_AJ_CREDITOS|
      //            VL_TOT_AJ_CREDITOS|VL_ESTORNOS_DEB|VL_SLD_CREDOR_ANT|VL_SLD_APURADO|VL_TOT_DED|VL_ICMS_RECOLHER|
      //            VL_SLD_CREDOR_TRANSPORTAR|DEB_ESP
      arq.add('E110', [fmtNum(debitoIcms), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(creditoIcms), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(saldoApurado), fmtNum(0), fmtNum(saldoApurado), fmtNum(saldoCredor), fmtNum(0)]);
      // E116 — obrigação do ICMS a recolher (fold auditoria ALTA: o PVA rejeita E110 com VL_ICMS_RECOLHER>0 sem
      // E116; supermercado tem débito>crédito quase todo mês → sem isto o arquivo não é entregável). COD_REC por
      // UF (MG='1206'/GO='108', fiel a Uspedfiscal.pas:797-807; demais UFs = '' até termos a tabela completa).
      // DT_VCTO = DT_INI + 45 dias (fiel ao legado); MES_REF = mmYYYY do período.
      if (saldoApurado > 0) {
        const codRecUf: Record<string, string> = { MG: '1206', GO: '108' };
        const codRec = codRecUf[String(empresa.uf ?? '')] ?? '';
        const dv = new Date(`${String(dtini).slice(0, 10)}T00:00:00Z`);
        dv.setUTCDate(dv.getUTCDate() + 45);
        const mesRef = `${String(dtini).slice(5, 7)}${String(dtini).slice(0, 4)}`;
        // E116 (9): COD_OR|VL_OR|DT_VCTO|COD_REC|NUM_PROC|IND_PROC|PROC|TXT_COMPL|MES_REF
        arq.add('E116', ['000', fmtNum(saldoApurado), fmtData(dv.toISOString().slice(0, 10)), codRec, '', '', '', '', mesRef]);
      }
    }
    arq.fecharBloco('E990', 'E');

    // BLOCO H — Inventário (ordem 0→C→D→E→G→H→K→1→9; D/G/K/1 ausentes = adiado). H001 sempre (IND_MOV toggle);
    // H005/H010 por evento de inventário com data no período.
    this.emitirBlocoH(arq, inventario, docs);

    const arquivo = arq.gerar();
    return {
      arquivo,
      linhas: arquivo.trimEnd().split('\r\n').length,
      documentos: docs.nfs.length,
      parcial: true,
      validacao: validarSpedFiscal(arquivo),
      aviso: `PARCIAL (corte-4): bloco 0 + bloco C (${docs.nfs.length} docs; C100/C170/C190 mod-55 por IND_OPER + C500/C590 energia/gás/água mod 06/28/29) + bloco E (E110 apuração ICMS: débito ${fmtNum(debitoIcms)} − crédito ${fmtNum(creditoIcms)}; E116 quando há a recolher) + bloco H (${inventario.livros.length} inventário(s); H005/H010) + bloco 9. Sem blocos D/G/K/1, sem ST/DIFAL/IPI. C176/C195/C197/C800 confirmados mortos (cópia fiel).`,
    };
  }

  /** documentos do período (nf tipo IN E/S, proc='S') + itens + cadastros (parceiros/produtos/unidades). */
  private async coletarEntrada(db: AnyDB, emp: number, dtini: string, dtfim: string) {
    const nfs = (await db
      .selectFrom('nf')
      .select(['codnf', 'tipo', 'modelo', 'nronf', 'serie', 'chavenfe', 'dtemissao', 'dtcontabil', 'tipoemissao', 'codparceiro', 'cfop', 'totalnf', 'totaldesc', 'totalprod', 'totalfrete', 'totalseguro', 'totalacessorias', 'tipofrete', sql`coalesce(cancelada,'N')`.as('cancelada'), sql`coalesce(statusnfe,'')`.as('statusnfe')])
      .where('idempresa', '=', emp)
      .where('tipo', 'in', ['E', 'S']) // corte-2: ENTRADA (crédito) + SAÍDA (débito) — destrava a apuração ICMS
      .where('proc', '=', 'S')
      .where('dtcontabil', '>=', dtini)
      .where('dtcontabil', '<=', dtfim)
      .where('nronf', 'is not', null)
      .where('nronf', 'not in', ['0', '000000'])
      .orderBy('codnf')
      .limit(5000)
      .execute()) as Array<Record<string, any>>;
    const nfIds = nfs.map((n) => Number(n.codnf));
    const itens = nfIds.length
      ? ((await db.selectFrom('nf_prod').select(['codnf', 'nroitem', 'codproduto', 'quantidade', 'vrcusto', 'desconto', 'vrbasecalculo', 'icms', 'vricm', 'vripi', 'cst', 'origem_estoque', 'cfop', 'bcpiscofinse', 'vrpise', 'vrcofinse', 'aliqpise', 'aliqcofinse', 'cstpiscofins']).where('codnf', 'in', nfIds).orderBy('codnf').orderBy('nroitem').execute()) as Array<Record<string, any>>)
      : [];
    const porNf = new Map<number, Array<Record<string, any>>>();
    for (const it of itens) (porNf.get(Number(it.codnf)) ?? porNf.set(Number(it.codnf), []).get(Number(it.codnf))!).push(it);
    const parceiroIds = [...new Set(nfs.map((n) => Number(n.codparceiro)).filter(Boolean))];
    const parceiros = new Map<number, Record<string, any>>();
    if (parceiroIds.length) {
      const rows = (await db
        .selectFrom('parceiros as p')
        .leftJoin('parceiros_end as pe', (j: any) => j.onRef('pe.codparceiro', '=', 'p.codparceiro').on('pe.endereco_padrao', '=', 'S'))
        .select(['p.codparceiro as codparceiro', 'p.razao as razao', 'pe.cnpj_cpf as cnpj_cpf', 'pe.endereco as endereco', 'pe.bairro as bairro', 'pe.idcidade as idcidade'])
        .where('p.codparceiro', 'in', parceiroIds)
        .execute()) as Array<Record<string, any>>;
      for (const r of rows) if (!parceiros.has(Number(r.codparceiro))) parceiros.set(Number(r.codparceiro), r);
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

  /** Inventário do período (bloco H): cabeçalhos inventario_livro (DTINVENTARIO no período, não soft-deletado) +
   *  itens inventario. Fonte fiel: INVENTARIO/INVENTARIO_LIVRO (sqqInventarioCons, UdmSpedFiscal.dfm). */
  private async coletarInventario(db: AnyDB, emp: number, dtini: string, dtfim: string) {
    const todos = (await db
      .selectFrom('inventario_livro')
      .select(['codinvent', 'dtinventario', 'tipoinventario', 'descricao'])
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E') // soft-delete
      .where('dtinventario', '>=', dtini)
      .where('dtinventario', '<=', dtfim)
      .orderBy('codinvent')
      .execute()) as Array<Record<string, any>>;
    // fold auditoria [ALTA]: o ETL pode ter salvo o MESMO inventário N vezes (mesma DATA+TIPO, codinvent distinto —
    // visto no golden: 3 cópias idênticas do inventário 2026-05-07). Sem dedup, o bloco H triplica (H005/H010 e
    // VL_INV inflados). Mantém só o MAIS RECENTE (MAX codinvent) por (data, tipo) — o `indr` não salva (dups vêm 'I').
    const porChave = new Map<string, Record<string, any>>();
    for (const l of todos) porChave.set(`${String(l.dtinventario)}|${l.tipoinventario ?? ''}`, l); // asc → último = maior codinvent
    const livros = [...porChave.values()];
    const ids = livros.map((l) => Number(l.codinvent));
    const itens = ids.length
      ? ((await db.selectFrom('inventario').select(['codinvent', 'idproduto', 'codbarra', 'descricao', 'unidade', 'qtde', 'vrcusto', 'vrvenda', 'tipo', 'aliquota'])
          .where('codinvent', 'in', ids).where('idempresa', '=', emp)
          .where('qtde', '>', 0) // fold auditoria [BAIXA]: só itens COM saldo (dropa dump-de-catálogo qtde=0; item sem estoque não tem valor no inventário)
          .orderBy('codinvent').orderBy('idproduto').execute()) as Array<Record<string, any>>)
      : [];
    const porLivro = new Map<number, Array<Record<string, any>>>();
    for (const it of itens) (porLivro.get(Number(it.codinvent)) ?? porLivro.set(Number(it.codinvent), []).get(Number(it.codinvent))!).push(it);
    return { livros, itens, porLivro };
  }

  /** BLOCO H — Inventário (fiel a GeraBlocoH, Uspedfiscal.pas:1074-1168). H001 sempre (IND_MOV 0=com dados / 1=sem);
   *  por evento: H005 (DT_INV|VL_INV=Σ máx(0,qtde×vrcusto)|MOT_INV) + H010 por item. Gateado pela pertinência ao
   *  0200 (COD_ITEM tem de existir no cadastro — integridade referencial do PVA). IND_PROP='0' (próprio, tipo='P').
   *  VL_INV = Σ VL_ITEM do MESMO conjunto filtrado (reconcilia com o PVA). VL_UNIT em 2 casas (0/79190 linhas do
   *  golden têm vrcusto >2 casas → sem perda; emitir na precisão de vrcusto é refino de cutover se surgir dado).
   *  ADIADO: H020 (só p/ MOT_INV≥02 mudança-de-tributação — precisa o lookup DET_ALIQUOTA→CST/ICM; golden é MOT_INV=01);
   *  TXT_COMPL (cdsOperacoesICMS TIPO='H1', config ausente) e COD_CTA (plano_contas via produto) → ''; certificação
   *  campo-a-campo do H005/H010 depende do .txt real do PVA (caveat de cutover, comum a todo o SPED). */
  private emitirBlocoH(arq: SpedArquivo, inventario: { livros: Array<Record<string, any>>; itens: Array<Record<string, any>>; porLivro: Map<number, Array<Record<string, any>>> }, docs: { produtos: Map<number, Record<string, any>> }): void {
    const has = (id: unknown) => docs.produtos.has(Number(id));
    const temInv = inventario.itens.some((i) => has(i.idproduto));
    arq.add('H001', [temInv ? '0' : '1']); // IND_MOV
    for (const livro of inventario.livros) {
      const itens = (inventario.porLivro.get(Number(livro.codinvent)) ?? []).filter((it) => has(it.idproduto));
      if (!itens.length) continue;
      // MOT_INV: tipoinventario (1..5) → 01..05; default '01' (final do período).
      const mot = Number(livro.tipoinventario);
      const motInv = String(mot >= 1 && mot <= 5 ? mot : 1).padStart(2, '0');
      const linhas = itens.map((it) => {
        const q = nn(it.qtde);
        const vu = nn(it.vrcusto);
        const total = r2(Math.max(0, q * vu)); // VL_ITEM = qtde×vrcusto, piso 0 (fiel: CASE WHEN <0 THEN 0)
        return { it, q, vu, total };
      });
      const vlInv = r2(linhas.reduce((s, l) => s + l.total, 0));
      // H005 (3): DT_INV|VL_INV|MOT_INV
      arq.add('H005', [fmtData(livro.dtinventario as string), fmtNum(vlInv), motInv]);
      for (const { it, q, vu, total } of linhas) {
        // H010 (10): COD_ITEM|UNID|QTD|VL_UNIT|VL_ITEM|IND_PROP|COD_PART|TXT_COMPL|COD_CTA|VL_ITEM_IR
        arq.add('H010', [String(it.idproduto), String(it.unidade ?? '').trim(), fmtNum(q, 3), fmtNum(vu, 2), fmtNum(total), '0', '', '', '', fmtNum(total)]);
      }
    }
    arq.fecharBloco('H990', 'H');
  }

  /** 0150 (participantes) / 0190 (unidades) / 0200 (itens) — COD_PART=codparceiro / COD_ITEM=idproduto (consistente com o bloco C). */
  private emitirCadastros(arq: SpedArquivo, docs: { parceiros: Map<number, Record<string, any>>; produtos: Map<number, Record<string, any>>; unidades: Set<string> }): void {
    for (const p of docs.parceiros.values()) {
      const doc = soDigitos(p.cnpj_cpf as string);
      // 0150 (12): COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|ENDERECO|NUM|COMPL|BAIRRO
      arq.add('0150', [String(p.codparceiro), String(p.razao ?? '').trim(), '1058', doc.length === 14 ? doc : '', doc.length === 11 ? doc : '', '', p.idcidade != null ? String(p.idcidade) : '', '', String(p.endereco ?? '').trim().slice(0, 60), '', '', String(p.bairro ?? '').trim()]);
    }
    for (const u of docs.unidades) arq.add('0190', [u, u]); // UNID|DESCR
    for (const p of docs.produtos.values()) {
      const ncm = String(p.ncmsh ?? '').replace(/\D/g, '');
      // 0200 (12): COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|TIPO_ITEM(00)|COD_NCM|EX_IPI|COD_GEN|COD_LST|ALIQ_ICMS|CEST
      arq.add('0200', [String(p.idproduto), String(p.descricao ?? '').trim(), String(p.codbarra ?? '').trim(), '', String(p.unidade ?? '').trim(), '00', ncm ? ncm.padStart(8, '0') : '', '', ncm.slice(0, 2), '', '', String(p.cest ?? '').trim()]);
    }
  }

  /** BLOCO C: C001 + por NF de ENTRADA/SAÍDA C100/C170 + C190 (analítico por CST_ICMS+CFOP+ALIQ_ICMS) + C990.
   *  IND_OPER por sentido (0=entrada/1=saída). Retorna o ICMS de ENTRADA (crédito) e de SAÍDA (débito) p/ o E110. */
  private emitirBlocoC(arq: SpedArquivo, docs: { nfs: Array<Record<string, any> & { itens: Array<Record<string, any>> }>; produtos: Map<number, Record<string, any>> }): { creditoIcms: number; debitoIcms: number } {
    const temDocs = docs.nfs.length > 0;
    arq.add('C001', [temDocs ? '0' : '1']);
    let creditoIcms = 0;
    let debitoIcms = 0;
    if (!temDocs) { arq.fecharBloco('C990', 'C'); return { creditoIcms: 0, debitoIcms: 0 }; }
    const ENERGIA = new Set([6, 28, 29]); // mod 06 energia / 28 gás / 29 água → C500/C590 (não C100)
    const BLOCO_D = new Set([21, 22]); // mod 21/22 (comunicação/telecom) → bloco D (D500) — ADIADO; inválidos em C100
    for (const nf of docs.nfs) {
      if (ENERGIA.has(Number(nf.modelo))) continue; // energia/gás/água emitidos no laço C500 abaixo
      if (BLOCO_D.has(Number(nf.modelo))) continue; // fold auditoria [BAIXA]: telecom não vai em C100 (bloco D adiado)
      const saida = String(nf.tipo) === 'S';
      const indOper = saida ? '1' : '0'; // IND_OPER: 0=entrada / 1=saída
      const indEmit = String(nf.tipoemissao ?? '0') === '0' ? '0' : '1';
      const codMod = String(nf.modelo ?? '') === '90' ? '1B' : String(nf.modelo ?? '').padStart(2, '0');
      const ser = String(nf.serie ?? '').trim();
      const st = String(nf.statusnfe ?? '');
      // fold auditoria [ALTA]: doc cancelado(02)/denegado(04)/inutilizado(05) → só o header identificador, SEM
      // C170/C190 e SEM ICMS (fiel ao legado; evita crédito/débito fantasma no E110).
      const codSit = String(nf.cancelada) === 'S' || st === 'C' ? '02' : st === 'D' ? '04' : st === 'I' ? '05' : '00';
      if (codSit !== '00') {
        // inutilizada (05) não tem chave (fiel a Uspedfiscal.pas:2354); cancelada/denegada mantêm CHV_NFE.
        const chv = codSit === '05' ? '' : ((nf.chavenfe as string) ?? '');
        arq.add('C100', [indOper, indEmit, '', codMod, codSit, ser, String(nf.nronf ?? ''), chv, fmtData(nf.dtemissao as string), ...Array(19).fill('')]);
        continue;
      }
      const itens = nf.itens;
      const soma = (c: string) => itens.reduce((s, it) => s + nn(it[c]), 0);
      // C100 (28): IND_OPER(0=entrada)|IND_EMIT|COD_PART|COD_MOD|COD_SIT(00)|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
      arq.add('C100', [indOper, indEmit, String(nf.codparceiro ?? ''), codMod, '00', ser, String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string), fmtData(nf.dtcontabil as string), fmtNum(nn(nf.totalnf)), '1', fmtNum(nn(nf.totaldesc)), fmtNum(0), fmtNum(nn(nf.totalprod)), String(nf.tipofrete ?? '9'), fmtNum(nn(nf.totalfrete)), fmtNum(nn(nf.totalseguro)), fmtNum(nn(nf.totalacessorias)), fmtNum(soma('vrbasecalculo')), fmtNum(soma('vricm')), fmtNum(0), fmtNum(0), fmtNum(soma('vripi')), fmtNum(soma('vrpise')), fmtNum(soma('vrcofinse')), fmtNum(0), fmtNum(0)]);
      let nro = 0;
      // grupos C190 por (CST_ICMS, CFOP, ALIQ_ICMS)
      const grupos = new Map<string, { cstIcms: string; cfop: string; aliq: number; vlOpr: number; bcIcms: number; vlIcms: number; vlIpi: number }>();
      for (const it of itens) {
        const prod = docs.produtos.get(Number(it.codproduto));
        const base = nn(it.bcpiscofinse);
        const cstRaw = String(it.cstpiscofins ?? '').replace(/\D/g, '');
        const cstPc = cstRaw !== '' ? cstRaw.padStart(2, '0') : nn(it.vrpise) > 0 || nn(it.vrcofinse) > 0 ? '50' : '99';
        // fold [BAIXA]: origem_estoque '' (não só null) → '0' (CST_ICMS = 1 origem + 2 CST = 3 dígitos).
        const cstIcms = (String(it.origem_estoque || '0')).slice(0, 1) + String(nn(it.cst)).padStart(2, '0');
        const cstIpi = String(it.cfop ?? '').charAt(0) < '5' ? '49' : '99';
        const vlItem = r2(nn(it.vrcusto) * nn(it.quantidade));
        // fold [MÉDIA]: CFOP *929* (bonificação/brinde) NÃO gera crédito de ICMS — zera BC/valor (fiel ao legado
        // Uspedfiscal.pas:2383). Copy(CFOP,2,3)='929'.
        const cfop929 = String(it.cfop ?? '').slice(1, 4) === '929';
        const bcIcmsIt = cfop929 ? 0 : nn(it.vrbasecalculo);
        const vlIcmsIt = cfop929 ? 0 : nn(it.vricm);
        const aliqIcmsIt = cfop929 ? 0 : nn(it.icms);
        // C170 (37): ...ICMS/IPI... (mesmo layout do C170 já auditado no EFD-Contribuições; ICMS gated por CFOP 929)
        arq.add('C170', [String(++nro), String(it.codproduto ?? ''), String(prod?.descricao ?? ''), fmtNum(nn(it.quantidade), 3), String(prod?.unidade ?? '').trim(), fmtNum(vlItem), fmtNum(nn(it.desconto)), '0', cstIcms, String(it.cfop ?? ''), '', fmtNum(bcIcmsIt), fmtNum(aliqIcmsIt), fmtNum(vlIcmsIt), fmtNum(0), fmtNum(0), fmtNum(0), '0', cstIpi, '', fmtNum(0), fmtNum(0), fmtNum(nn(it.vripi)), cstPc, fmtNum(base), fmtNum(nn(it.aliqpise), 4), '', '', fmtNum(nn(it.vrpise)), cstPc, fmtNum(base), fmtNum(nn(it.aliqcofinse), 4), '', '', fmtNum(nn(it.vrcofinse)), '', '']);
        const k = `${cstIcms}|${it.cfop}|${aliqIcmsIt.toFixed(2)}`;
        const g = grupos.get(k) ?? { cstIcms, cfop: String(it.cfop ?? ''), aliq: aliqIcmsIt, vlOpr: 0, bcIcms: 0, vlIcms: 0, vlIpi: 0 };
        g.vlOpr = r2(g.vlOpr + vlItem);
        g.bcIcms = r2(g.bcIcms + bcIcmsIt);
        g.vlIcms = r2(g.vlIcms + vlIcmsIt);
        g.vlIpi = r2(g.vlIpi + nn(it.vripi));
        grupos.set(k, g);
      }
      for (const g of grupos.values()) {
        // C190 (11): CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|COD_OBS
        arq.add('C190', [g.cstIcms, g.cfop, fmtNum(g.aliq, 2), fmtNum(g.vlOpr), fmtNum(g.bcIcms), fmtNum(g.vlIcms), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(g.vlIpi), '']);
        if (saida) debitoIcms = r2(debitoIcms + g.vlIcms); // SAÍDA → débito de ICMS
        else creditoIcms = r2(creditoIcms + g.vlIcms); // ENTRADA → crédito de ICMS
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
        const cstIcms = String(it.origem_estoque || '0').slice(0, 1) + String(nn(it.cst)).padStart(2, '0');
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
}
