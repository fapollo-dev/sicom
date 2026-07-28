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
 * SPED FISCAL (EFD ICMS/IPI) — obrigação mensal DISTINTA do EFD-Contribuições. CORTE-1: bloco 0 (0000 layout
 * ICMS/IPI + 0005 + cadastros 0150/0190/0200) + bloco C (documentos de ENTRADA C100/C170 + C190 analítico por
 * CST/CFOP/alíquota) + bloco E (E100/E110 apuração ICMS) + bloco 9. Reusa o motor SpedArquivo. Escopo por empresa.
 *
 * DECISÃO ARQUITETURAL (procedência): o legado LÊ o E110 de uma tabela pré-calculada APURACAO_ICMS (processo de
 * apuração separado). O monorepo NÃO tem esse processo/tabela → o corte-1 DERIVA a apuração das somas do C190
 * (crédito = Σ VL_ICMS das entradas; débito = 0 enquanto não há SAÍDA — PDV off / sem NF-e de saída), gerando
 * SALDO CREDOR a transportar. Fiel à estrutura; a apuração com débito de saída + ajustes = corte-2 (quando a
 * saída existir) OU o port do processo APURACAO_ICMS.
 *
 * ADIADO (corte-2+, com procedência): SAÍDA (C190 débito + E110 VL_TOT_DEBITOS) · blocos D/G/H/K/1 · E111/E113
 * (ajustes) · E116 (a recolher — só quando há débito) · E200/E210 (ST) · E300/E310 (DIFAL/FCP) · E500 (IPI) ·
 * C176/C195/C197 (SN) · redução de base (VL_RED_BC do C190 = 0 no corte-1) · multi-estab (C010).
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
    this.emitirCadastros(arq, docs);
    arq.fecharBloco('0990', '0');

    // BLOCO C — documentos de ENTRADA
    const creditoIcms = this.emitirBlocoC(arq, docs);

    // BLOCO E — apuração ICMS (corte-1: crédito das entradas; débito 0 → saldo credor a transportar).
    // fold [BAIXA]: emite E110 sempre que HÁ documentos no bloco C (mesmo crédito 0) — evita "movimento no C,
    // bloco E sem dados" que o PVA sinaliza. IND_MOV=1 (sem dados) só quando não há nenhuma entrada.
    const temApuracao = docs.nfs.length > 0;
    arq.add('E001', [temApuracao ? '0' : '1']);
    if (temApuracao) {
      arq.add('E100', [fmtData(dtini), fmtData(dtfim)]);
      const debito = 0; // sem SAÍDA no corte-1
      const saldoApurado = r2(Math.max(0, debito - creditoIcms)); // ICMS a recolher (0 aqui)
      const saldoCredor = r2(Math.max(0, creditoIcms - debito)); // saldo credor a transportar
      // E110 (14): VL_TOT_DEBITOS|VL_AJ_DEBITOS|VL_TOT_AJ_DEBITOS|VL_ESTORNOS_CRED|VL_TOT_CREDITOS|VL_AJ_CREDITOS|
      //            VL_TOT_AJ_CREDITOS|VL_ESTORNOS_DEB|VL_SLD_CREDOR_ANT|VL_SLD_APURADO|VL_TOT_DED|VL_ICMS_RECOLHER|
      //            VL_SLD_CREDOR_TRANSPORTAR|DEB_ESP
      arq.add('E110', [fmtNum(debito), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(creditoIcms), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(saldoApurado), fmtNum(0), fmtNum(saldoApurado), fmtNum(saldoCredor), fmtNum(0)]);
    }
    arq.fecharBloco('E990', 'E');

    const arquivo = arq.gerar();
    return {
      arquivo,
      linhas: arquivo.trimEnd().split('\r\n').length,
      documentos: docs.nfs.length,
      parcial: true,
      validacao: validarSpedFiscal(arquivo),
      aviso: `PARCIAL (corte-1): bloco 0 + bloco C (${docs.nfs.length} entrada, C100/C170/C190) + bloco E (E110 apuração ICMS — crédito ${fmtNum(creditoIcms)}; DÉBITO de saída = corte-2) + bloco 9. Sem blocos D/G/H/K/1, sem ST/DIFAL/IPI.`,
    };
  }

  /** entradas do período (nf tipo='E', proc='S') + itens + cadastros (parceiros/produtos/unidades). */
  private async coletarEntrada(db: AnyDB, emp: number, dtini: string, dtfim: string) {
    const nfs = (await db
      .selectFrom('nf')
      .select(['codnf', 'modelo', 'nronf', 'serie', 'chavenfe', 'dtemissao', 'dtcontabil', 'tipoemissao', 'codparceiro', 'totalnf', 'totaldesc', 'totalprod', 'totalfrete', 'totalseguro', 'totalacessorias', 'tipofrete', sql`coalesce(cancelada,'N')`.as('cancelada'), sql`coalesce(statusnfe,'')`.as('statusnfe')])
      .where('idempresa', '=', emp)
      .where('tipo', '=', 'E')
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

  /** BLOCO C: C001 + por NF de ENTRADA C100/C170 + C190 (analítico por CST_ICMS+CFOP+ALIQ_ICMS) + C990.
   *  Retorna o crédito de ICMS acumulado (Σ VL_ICMS dos C190) p/ alimentar o E110. */
  private emitirBlocoC(arq: SpedArquivo, docs: { nfs: Array<Record<string, any> & { itens: Array<Record<string, any>> }>; produtos: Map<number, Record<string, any>> }): number {
    const temDocs = docs.nfs.length > 0;
    arq.add('C001', [temDocs ? '0' : '1']);
    let creditoIcms = 0;
    if (!temDocs) { arq.fecharBloco('C990', 'C'); return 0; }
    for (const nf of docs.nfs) {
      const indEmit = String(nf.tipoemissao ?? '0') === '0' ? '0' : '1';
      const codMod = String(nf.modelo ?? '') === '90' ? '1B' : String(nf.modelo ?? '').padStart(2, '0');
      const ser = String(nf.serie ?? '').trim();
      const st = String(nf.statusnfe ?? '');
      // fold auditoria [ALTA]: doc cancelado(02)/denegado(04)/inutilizado(05) → só o header identificador, SEM
      // C170/C190 e SEM crédito de ICMS (fiel ao legado; evita crédito fantasma no E110).
      const codSit = String(nf.cancelada) === 'S' || st === 'C' ? '02' : st === 'D' ? '04' : st === 'I' ? '05' : '00';
      if (codSit !== '00') {
        arq.add('C100', ['0', indEmit, '', codMod, codSit, ser, String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string), ...Array(19).fill('')]);
        continue;
      }
      const itens = nf.itens;
      const soma = (c: string) => itens.reduce((s, it) => s + nn(it[c]), 0);
      // C100 (28): IND_OPER(0=entrada)|IND_EMIT|COD_PART|COD_MOD|COD_SIT(00)|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
      arq.add('C100', ['0', indEmit, String(nf.codparceiro ?? ''), codMod, '00', ser, String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string), fmtData(nf.dtcontabil as string), fmtNum(nn(nf.totalnf)), '1', fmtNum(nn(nf.totaldesc)), fmtNum(0), fmtNum(nn(nf.totalprod)), String(nf.tipofrete ?? '9'), fmtNum(nn(nf.totalfrete)), fmtNum(nn(nf.totalseguro)), fmtNum(nn(nf.totalacessorias)), fmtNum(soma('vrbasecalculo')), fmtNum(soma('vricm')), fmtNum(0), fmtNum(0), fmtNum(soma('vripi')), fmtNum(soma('vrpise')), fmtNum(soma('vrcofinse')), fmtNum(0), fmtNum(0)]);
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
        creditoIcms = r2(creditoIcms + g.vlIcms); // ENTRADA → crédito de ICMS
      }
    }
    arq.fecharBloco('C990', 'C');
    return creditoIcms;
  }
}
