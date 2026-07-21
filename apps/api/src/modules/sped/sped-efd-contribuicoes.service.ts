import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SpedArquivo, fmtData, fmtNum, soDigitos } from './sped-writer';
import { validarSped, type ResultadoValidacao } from './sped-validator';

type AnyDB = Kysely<any>;

/** COD_VER (versão do leiaute) por período — aproximado (o fisco mantém a tabela oficial; refinar por período).
 *  Fiel ao GetVersaoLeiaute do legado (deriva do ano de DT_INI). 2020+ = layout mais recente do EFD-Contribuições. */
function codVersao(dtini: string): string {
  const ano = Number(String(dtini).slice(0, 4)) || 0;
  if (ano <= 2011) return '001';
  if (ano <= 2017) return '003';
  if (ano === 2018) return '004';
  if (ano === 2019) return '005';
  return '006';
}

/**
 * SPED EFD-Contribuições (PIS/COFINS). Motor escritor + BLOCO 0 (identificação/estabelecimentos) + BLOCO C
 * (documentos de ENTRADA C100/C170) + BLOCO M (apuração: crédito de entrada + DÉBITO de saída do PDV / VENDAS,
 * corte-1) + BLOCO 9 (totalizador). O legado escreve via ACBr; aqui ao padrão SPED público. PARCIAL enquanto faltam
 * os DOCUMENTOS de saída no bloco C (C100 mod 65 + C175 da NFC-e = corte-2 do PDV). Escopo por empresa (tenant).
 */
@Injectable()
export class SpedEfdContribuicoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(dtini: string, dtfim: string): Promise<{ arquivo: string; linhas: number; estabelecimentos: number; documentos: number; parcial: true; aviso: string; validacao: ResultadoValidacao }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const empresa = (await db
      .selectFrom('empresas')
      .select(['razao_social', 'cnpj', 'insc', 'uf', 'idcidade', 'classfiscal'])
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { razao_social?: string; cnpj?: string; insc?: string; uf?: string; idcidade?: number; classfiscal?: string } | undefined;
    if (!empresa) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: emp });

    const cnpj = soDigitos(empresa.cnpj);
    const raiz = cnpj.slice(0, 8);
    const arq = new SpedArquivo();

    // 0000 — identificação: COD_VER|TIPO_ESCRIT(0=original)|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|CNPJ|UF|COD_MUN|SUFRAMA|IND_NAT_PJ(00)|IND_ATIV(1)
    arq.add('0000', [codVersao(dtini), '0', '', '', fmtData(dtini), fmtData(dtfim), empresa.razao_social ?? '', cnpj, empresa.uf ?? '', empresa.idcidade != null ? String(empresa.idcidade) : '', '', '00', '1']);
    // 0001 — abertura do bloco 0 (0=com dados).
    arq.add('0001', ['0']);
    // 0110 — regime de apuração: LR → não-cumulativo (COD_INC_TRIB=1); senão cumulativo (2). (Refinável por config.)
    const naoCumulativo = String(empresa.classfiscal ?? '') === 'LR';
    arq.add('0110', [naoCumulativo ? '1' : '2', naoCumulativo ? '1' : '', naoCumulativo ? '0' : '', '']);
    // 0140 — estabelecimentos que compartilham a RAIZ do CNPJ (fiel ao loop por SubStr(CNPJ,1,x) do legado).
    const estabs = (await db
      .selectFrom('empresas')
      .select(['idempresa', 'razao_social', 'cnpj', 'insc', 'im', 'uf', 'idcidade'])
      .where(sql`substr(coalesce(cnpj,''),1,8)`, '=', raiz)
      .orderBy('idempresa')
      .execute()) as Array<{ idempresa: number; razao_social?: string; cnpj?: string; insc?: string; im?: string; uf?: string; idcidade?: number }>;
    // 0140: COD_EST|NOME|CNPJ|UF|IE|COD_MUN|IM|SUFRAMA (fold auditoria [BAIXA]: IM vinha sempre vazio).
    for (const e of estabs) {
      arq.add('0140', [String(e.idempresa), e.razao_social ?? '', soDigitos(e.cnpj), e.uf ?? '', e.insc ?? '', e.idcidade != null ? String(e.idcidade) : '', e.im ?? '', '']);
    }
    // corte-2b: cadastros (0150 participantes / 0190 unidades / 0200 itens) referenciados pelo bloco C — ANTES do 0990.
    const docs = await this.coletarDocumentosEntrada(db, emp, dtini, dtfim);
    const saida = await this.coletarVendasSaida(db, emp, dtini, dtfim); // corte-2: NFC-e de saída (C100 mod 65 + C175)
    const cupons = saida.cupons;
    this.emitirCadastros(arq, docs);
    arq.fecharBloco('0990', '0');

    // BLOCO C: documentos fiscais de ENTRADA (C100/C170) + SAÍDA NFC-e mod 65 (C100/C175 — corte-2 do PDV).
    this.emitirBlocoC(arq, docs, cupons, cnpj);

    // BLOCO M: apuração de PIS/COFINS — CRÉDITO de entrada (M100/M105/M500/M505) + DÉBITO de saída do PDV
    // (M200/M210/M600/M610, corte-1 VENDAS), com o crédito descontado e o valor a recolher (débito − crédito).
    const temM = await this.gerarBlocoM(arq, db, emp, dtini, dtfim);

    const arquivo = arq.gerar();
    return {
      arquivo,
      linhas: arquivo.trimEnd().split('\r\n').length,
      estabelecimentos: estabs.length,
      documentos: docs.nfs.length + cupons.length,
      parcial: true,
      validacao: validarSped(arquivo), // validação estrutural PVA-style (erros=[] ⇒ estruturalmente válido)
      aviso: `PARCIAL: bloco 0 (cadastros) + bloco C (${docs.nfs.length} entrada + ${cupons.length} NFC-e de saída${saida.truncado ? ' ⚠ TRUNCADO no limite de itens — gere por período menor' : ''}) + bloco M (crédito+débito${temM ? '' : ' — rode POST /fiscal/sped/apuracao-pc'}) + bloco 9. Falta o CAIXA contábil do PDV (CX_VENDAS→DIARIO) → corte-3.`,
    };
  }

  /**
   * BLOCO M — apuração de PIS/COFINS (não-cumulativo, LR), lida de apuracao_pc/_det. CRÉDITO de entrada (TIPO='C')
   * e DÉBITO de saída do PDV (TIPO='D', corte-1 VENDAS). Por imposto: M100/M105 (crédito, com o crédito DESCONTADO
   * contra o débito — fill-first) + M200 (consolidação: contribuição − crédito descontado = a recolher) + M210
   * (débito por alíquota). COFINS espelha (M500/M505/M600/M610). Sem apuração → M001 IND_MOV=1. Retorna true se houve dado.
   */
  private async gerarBlocoM(arq: SpedArquivo, db: AnyDB, emp: number, dtini: string, dtfim: string): Promise<boolean> {
    const cab = (await db.selectFrom('apuracao_pc').select('codapuracao_pc').where('idempresa', '=', emp).where('dataini', '=', dtini).where('datafim', '=', dtfim).executeTakeFirst()) as { codapuracao_pc?: number } | undefined;
    const det = cab
      ? ((await db.selectFrom('apuracao_pc_det').selectAll().where('codapuracao_pc', '=', Number(cab.codapuracao_pc)).orderBy('codapuracao_pc_det').execute()) as Array<Record<string, unknown>>)
      : [];
    const detC = det.filter((d) => d.tipo === 'C');
    const detD = det.filter((d) => d.tipo === 'D');

    arq.add('M001', [det.length ? '0' : '1']); // IND_MOV: 0=com dados / 1=sem
    if (!det.length) {
      arq.fecharBloco('M990', 'M');
      return false;
    }

    // PIS (M100/M105/M200/M205/M210) e COFINS (M500/M505/M600/M605/M610) — mesma mecânica, colunas de valor
    // distintas. COD_REC do M205/M605 = código de receita do legado (UspedPisCofins.pas:1620/1799).
    this.emitirImpostoM(arq, detC, detD, 'aliqpis', 'valorpis', { m100: 'M100', m105: 'M105', m200: 'M200', m205: 'M205', m210: 'M210', codRec: '810902' });
    this.emitirImpostoM(arq, detC, detD, 'aliqcofins', 'valorcofins', { m100: 'M500', m105: 'M505', m200: 'M600', m205: 'M605', m210: 'M610', codRec: '217201' });
    arq.fecharBloco('M990', 'M');
    return true;
  }

  /**
   * Emite o par crédito+débito de UM imposto (PIS ou COFINS). Crédito: M100 por (COD_CRED, alíq) + M105 por CST,
   * com VL_CRED_DESC = crédito usado p/ abater o débito (fill-first) e SLD_CRED = sobra. M200: contribuição do
   * período (débito) − crédito descontado = valor a recolher (não-cumulativo). M210: débito por alíquota.
   */
  private emitirImpostoM(
    arq: SpedArquivo,
    detC: Array<Record<string, unknown>>,
    detD: Array<Record<string, unknown>>,
    aliqCol: 'aliqpis' | 'aliqcofins',
    valCol: 'valorpis' | 'valorcofins',
    reg: { m100: string; m105: string; m200: string; m205: string; m210: string; codRec: string },
  ): void {
    const n2 = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
    const cst2 = (v: unknown) => (v == null ? '' : String(v).padStart(2, '0'));
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const agrupar = (rows: Array<Record<string, unknown>>, chave: (d: Record<string, unknown>) => string) => {
      const m = new Map<string, Record<string, unknown>[]>();
      for (const d of rows) { const k = chave(d); (m.get(k) ?? m.set(k, []).get(k)!).push(d); }
      return m;
    };

    const credTotal = r2(detC.reduce((s, d) => s + n2(d[valCol]), 0));
    const debTotal = r2(detD.reduce((s, d) => s + n2(d[valCol]), 0));
    const descTotal = r2(Math.min(credTotal, debTotal)); // crédito descontado no período (abate o débito)

    // ── CRÉDITO: M100/M105 (fill-first do desconto contra o débito) ──
    let rem = descTotal;
    for (const linhas of agrupar(detC, (d) => `${d.id_tipocredito}|${n2(d[aliqCol]).toFixed(4)}`).values()) {
      const codCred = String(linhas[0].id_tipocredito ?? '101');
      const aliq = n2(linhas[0][aliqCol]);
      const base = r2(linhas.reduce((s, d) => s + n2(d.basecalculo), 0));
      const cred = r2(linhas.reduce((s, d) => s + n2(d[valCol]), 0));
      const desc = r2(Math.min(cred, rem));
      rem = r2(rem - desc);
      const sld = r2(cred - desc);
      // M100: COD_CRED|IND_CRED_ORI|VL_BC|ALIQ|QUANT_BC|ALIQ_QUANT|VL_CRED|VL_AJUS_ACRES|VL_AJUS_REDUC|VL_CRED_DIF|VL_CRED_DISP|IND_DESC_CRED|VL_CRED_DESC|SLD_CRED
      arq.add(reg.m100, [codCred, '01', fmtNum(base), fmtNum(aliq, 4), '', '', fmtNum(cred), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(cred), desc > 0 ? '1' : '0', fmtNum(desc), fmtNum(sld)]);
      for (const d of linhas) {
        // M105: NAT_BC_CRED|CST|VL_BC_TOT|VL_BC_CUM|VL_BC_NC|VL_BC|QUANT_BC_TOT|QUANT_BC|DESC_CRED
        arq.add(reg.m105, [cst2(d.id_basecredito), cst2(d.cst_pis), fmtNum(n2(d.basecalculo)), fmtNum(0), fmtNum(n2(d.basecalculo)), fmtNum(n2(d.basecalculo)), '', '', '']);
      }
    }

    // ── DÉBITO: M200 (consolidação) + M205 (detalhe por COD_REC) + M210 (por alíquota) ──
    const aRecolher = r2(Math.max(0, debTotal - descTotal));
    // M200: VL_TOT_CONT_NC_PER|VL_TOT_CRED_DESC|VL_TOT_CRED_DESC_ANT|VL_TOT_CONT_NC_DEV(=01−02−03)|VL_RET_NC|VL_OUT_DED_NC|VL_CONT_NC_REC(=04−05−06)|VL_TOT_CONT_CUM_PER|VL_RET_CUM|VL_OUT_DED_CUM|VL_CONT_CUM_REC|VL_TOT_CONT_REC
    arq.add(reg.m200, [fmtNum(debTotal), fmtNum(descTotal), fmtNum(0), fmtNum(aRecolher), fmtNum(0), fmtNum(0), fmtNum(aRecolher), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(aRecolher)]);
    // M205/M605: detalhamento da contribuição a recolher por código de receita (PVA exige quando a-recolher>0).
    // NUM_CAMPO='08' (LR/não-cumulativo, UspedPisCofins.pas:1619) | COD_REC | VL_DEBITO.
    if (aRecolher > 0) arq.add(reg.m205, ['08', reg.codRec, fmtNum(aRecolher)]);
    for (const linhas of agrupar(detD, (d) => n2(d[aliqCol]).toFixed(4)).values()) {
      const aliq = n2(linhas[0][aliqCol]);
      const base = r2(linhas.reduce((s, d) => s + n2(d.basecalculo), 0));
      const val = r2(linhas.reduce((s, d) => s + n2(d[valCol]), 0));
      // M210: COD_CONT|VL_REC_BRT|VL_BC_CONT|VL_AJUS_ACRES_BC|VL_AJUS_REDUC_BC|VL_BC_CONT_AJUS|ALIQ|QUANT_BC|ALIQ_QUANT|VL_CONT_APUR|VL_AJUS_ACRES|VL_AJUS_REDUC|VL_CONT_DIFER|VL_CONT_DIFER_ANT|VL_CONT_PER
      arq.add(reg.m210, ['01', fmtNum(base), fmtNum(base), fmtNum(0), fmtNum(0), fmtNum(base), fmtNum(aliq, 4), '', '', fmtNum(val), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(val)]);
    }
  }

  /** coleta os NFs de ENTRADA do período (+ itens) e os cadastros que o bloco C referencia (participantes/itens/unidades). */
  private async coletarDocumentosEntrada(
    db: AnyDB,
    emp: number,
    dtini: string,
    dtfim: string,
  ): Promise<{ nfs: Array<Record<string, unknown> & { itens: Array<Record<string, unknown>> }>; parceiros: Map<number, Record<string, unknown>>; produtos: Map<number, Record<string, unknown>>; unidades: Set<string> }> {
    const nfs = (await db
      .selectFrom('nf')
      .select(['codnf', 'modelo', 'nronf', 'serie', 'chavenfe', 'dtemissao', 'dtcontabil', 'tipoemissao', 'codparceiro', 'totalnf', 'totaldesc', 'totalprod', 'totalfrete', 'totalseguro', 'totalacessorias', 'tipofrete', sql`coalesce(cancelada,'N')`.as('cancelada'), sql`coalesce(statusnfe,'')`.as('statusnfe')])
      .where('idempresa', '=', emp)
      .where('tipo', '=', 'E')
      .where(sql`coalesce(proc,'N')`, '=', 'S')
      // fold auditoria [BAIXA]: cancelados ENTRAM no bloco C como COD_SIT=02 (header-only, fiel ao legado) — não filtra aqui.
      .where(sql`dtcontabil`, '>=', dtini)
      .where(sql`dtcontabil`, '<=', dtfim)
      .where('nronf', 'is not', null)
      .where('nronf', 'not in', ['0', '000000'])
      .orderBy('codnf')
      .limit(5000)
      .execute()) as Array<Record<string, unknown>>;
    const nfIds = nfs.map((n) => Number(n.codnf));
    const itens = nfIds.length
      ? ((await db.selectFrom('nf_prod').select(['codnf', 'nroitem', 'codproduto', 'quantidade', 'vrcusto', 'desconto', 'vrbasecalculo', 'icms', 'vricm', 'vripi', 'cst', 'origem_estoque', 'cfop', 'bcpiscofinse', 'vrpise', 'vrcofinse', 'aliqpise', 'aliqcofinse', 'cstpiscofins']).where('codnf', 'in', nfIds).orderBy('codnf').orderBy('nroitem').execute()) as Array<Record<string, unknown>>)
      : [];
    const itensPorNf = new Map<number, Array<Record<string, unknown>>>();
    for (const it of itens) {
      const k = Number(it.codnf);
      (itensPorNf.get(k) ?? itensPorNf.set(k, []).get(k)!).push(it);
    }
    const parceiroIds = [...new Set(nfs.map((n) => Number(n.codparceiro)).filter(Boolean))];
    const parceiros = new Map<number, Record<string, unknown>>();
    if (parceiroIds.length) {
      const rows = (await db
        .selectFrom('parceiros as p')
        .leftJoin('parceiros_end as pe', (j: any) => j.onRef('pe.codparceiro', '=', 'p.codparceiro').on('pe.endereco_padrao', '=', 'S'))
        .select(['p.codparceiro as codparceiro', 'p.razao as razao', 'pe.cnpj_cpf as cnpj_cpf', 'pe.endereco as endereco', 'pe.bairro as bairro', 'pe.idcidade as idcidade'])
        .where('p.codparceiro', 'in', parceiroIds)
        .execute()) as Array<Record<string, unknown>>;
      for (const r of rows) if (!parceiros.has(Number(r.codparceiro))) parceiros.set(Number(r.codparceiro), r);
    }
    const prodIds = [...new Set(itens.map((i) => Number(i.codproduto)).filter(Boolean))];
    const produtos = new Map<number, Record<string, unknown>>();
    if (prodIds.length) {
      const rows = (await db.selectFrom('produtos').select(['idproduto', 'descricao', 'codbarra', 'unidade', 'ncmsh', 'cest']).where('idproduto', 'in', prodIds).execute()) as Array<Record<string, unknown>>;
      for (const r of rows) produtos.set(Number(r.idproduto), r);
    }
    const unidades = new Set<string>();
    for (const p of produtos.values()) {
      const u = String(p.unidade ?? '').trim();
      if (u) unidades.add(u);
    }
    return { nfs: nfs.map((n) => ({ ...n, itens: itensPorNf.get(Number(n.codnf)) ?? [] })), parceiros, produtos, unidades };
  }

  /**
   * coleta as NFC-e de SAÍDA do período (corte-2), agrupando os itens de VENDAS por cupom (série+cupom+chave).
   * Elegível: venda_nfc='S', chavenfe não-nulo, statusnfe ∈ {P autorizada, C cancelada→COD_SIT 02}. Intervalo
   * SEMIABERTO por data. Cada cupom vira 1 C100 (mod 65); os itens não-cancelados consolidam em C175 por CFOP/CST/alíq.
   */
  private async coletarVendasSaida(db: AnyDB, emp: number, dtini: string, dtfim: string): Promise<{ cupons: Array<{ nroserie: string; nrocupom: string; chavenfe: string; statusnfe: string; dtemissao: string; itens: Array<Record<string, unknown>> }>; truncado: boolean }> {
    const LIMITE_ITENS = 100000; // backstop de memória; se atingido, o retorno sinaliza truncado (sem corte silencioso).
    const d0 = String(dtini).slice(0, 10);
    const dfimNext = new Date(`${String(dtfim).slice(0, 10)}T00:00:00Z`);
    dfimNext.setUTCDate(dfimNext.getUTCDate() + 1);
    const d1 = dfimNext.toISOString().slice(0, 10);
    const rows = (await db
      .selectFrom('vendas')
      .select(['nroserie', 'nrocupom', 'chavenfe', 'statusnfe', sql`to_char(dtvenda,'YYYY-MM-DD')`.as('dtemissao'), 'nroitem', 'cfop', 'codproduto', 'qtde', 'vrvenda', 'cancelado', 'pis_cst', 'pis_bcalculo', 'pis_aliquota', 'pis_valor', 'cofins_cst', 'cofins_bcalculo', 'cofins_aliquota', 'cofins_valor'])
      .where('idempresa', '=', emp)
      .where(sql`coalesce(venda_nfc,'N')`, '=', 'S')
      .where('chavenfe', 'is not', null)
      .where('statusnfe', 'in', ['P', 'C'])
      .where(sql`dtvenda`, '>=', d0)
      .where(sql`dtvenda`, '<', d1)
      .orderBy('nroserie')
      .orderBy('nrocupom')
      .orderBy('nroitem')
      .limit(LIMITE_ITENS)
      .execute()) as Array<Record<string, unknown>>;
    const cupons = new Map<string, { nroserie: string; nrocupom: string; chavenfe: string; statusnfe: string; dtemissao: string; itens: Array<Record<string, unknown>> }>();
    for (const r of rows) {
      const k = `${r.nroserie}|${r.nrocupom}|${r.chavenfe}`;
      let c = cupons.get(k);
      if (!c) {
        c = { nroserie: String(r.nroserie ?? ''), nrocupom: String(r.nrocupom ?? ''), chavenfe: String(r.chavenfe ?? ''), statusnfe: String(r.statusnfe ?? ''), dtemissao: String(r.dtemissao ?? ''), itens: [] };
        cupons.set(k, c);
      }
      c.itens.push(r);
    }
    return { cupons: [...cupons.values()], truncado: rows.length >= LIMITE_ITENS };
  }

  /** emite os cadastros do bloco 0 referenciados pelo bloco C: 0150 (participantes) / 0190 (unidades) / 0200 (itens). */
  private emitirCadastros(arq: SpedArquivo, docs: { parceiros: Map<number, Record<string, unknown>>; produtos: Map<number, Record<string, unknown>>; unidades: Set<string> }): void {
    for (const p of docs.parceiros.values()) {
      const doc = soDigitos(p.cnpj_cpf as string);
      // 0150: COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|ENDERECO|NUM|COMPL|BAIRRO (COD_PART = codparceiro, chave estável)
      arq.add('0150', [String(p.codparceiro), (p.razao as string) ?? '', '01058', doc.length === 14 ? doc : '', doc.length === 11 ? doc : '', '', p.idcidade != null ? String(p.idcidade) : '', '', (p.endereco as string) ?? '', '', '', (p.bairro as string) ?? '']);
    }
    for (const u of docs.unidades) arq.add('0190', [u, u]);
    for (const p of docs.produtos.values()) {
      // 0200: COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|TIPO_ITEM|COD_NCM|EX_IPI|COD_GEN|COD_LST|ALIQ_ICMS|CEST (TIPO_ITEM 00 = merc. p/ revenda)
      arq.add('0200', [String(p.idproduto), (p.descricao as string) ?? '', (p.codbarra as string) ?? '', '', String(p.unidade ?? '').trim(), '00', String(p.ncmsh ?? '').replace(/\D/g, ''), '', '', '', '', (p.cest as string) ?? '']);
    }
  }

  /** emite o BLOCO C: C001/C010 + C100/C170 por NF de ENTRADA + C100/C175 por NFC-e de SAÍDA (corte-2) + C990. */
  private emitirBlocoC(
    arq: SpedArquivo,
    docs: { nfs: Array<Record<string, unknown> & { itens: Array<Record<string, unknown>> }>; produtos: Map<number, Record<string, unknown>> },
    cupons: Array<{ nroserie: string; nrocupom: string; chavenfe: string; statusnfe: string; dtemissao: string; itens: Array<Record<string, unknown>> }>,
    cnpjEstab: string,
  ): void {
    const nn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const cst2 = (v: unknown) => (v == null || String(v).trim() === '' ? '' : String(v).replace(/\D/g, '').padStart(2, '0'));
    const temDocs = docs.nfs.length > 0 || cupons.length > 0;
    // fold auditoria [MÉDIA]: C001 (abertura) é SEMPRE emitido (IND_MOV=1 quando vazio), como o M001; C990 sempre fecha.
    arq.add('C001', [temDocs ? '0' : '1']);
    if (!temDocs) {
      arq.fecharBloco('C990', 'C');
      return;
    }
    arq.add('C010', [cnpjEstab, '1']); // IND_ESCRI=1 (individualizada)
    for (const nf of docs.nfs) {
      const indEmit = String(nf.tipoemissao ?? '0') === '0' ? '0' : '1';
      const codMod = String(nf.modelo ?? '').padStart(2, '0');
      const ser = String(nf.serie ?? '').trim();
      const cancelada = String(nf.cancelada) === 'S' || String(nf.statusnfe) === 'C';
      if (cancelada) {
        // COD_SIT=02: doc cancelado → só o header identificador, sem C170 (fiel ao legado).
        arq.add('C100', ['0', indEmit, '', codMod, '02', ser, String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string), ...Array(19).fill('')]);
        continue;
      }
      const itens = nf.itens;
      const soma = (c: string) => itens.reduce((s, it) => s + nn(it[c]), 0);
      // C100 (28 campos): IND_OPER(0=entrada)|IND_EMIT|COD_PART|COD_MOD|COD_SIT(00)|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO(1)|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
      arq.add('C100', ['0', indEmit, String(nf.codparceiro ?? ''), codMod, '00', ser, String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string), fmtData(nf.dtcontabil as string), fmtNum(nn(nf.totalnf)), '1', fmtNum(nn(nf.totaldesc)), fmtNum(0), fmtNum(nn(nf.totalprod)), String(nf.tipofrete ?? '9'), fmtNum(nn(nf.totalfrete)), fmtNum(nn(nf.totalseguro)), fmtNum(nn(nf.totalacessorias)), fmtNum(soma('vrbasecalculo')), fmtNum(soma('vricm')), fmtNum(0), fmtNum(0), fmtNum(soma('vripi')), fmtNum(soma('vrpise')), fmtNum(soma('vrcofinse')), fmtNum(0), fmtNum(0)]);
      let nro = 0;
      for (const it of itens) {
        const prod = docs.produtos.get(Number(it.codproduto));
        const base = nn(it.bcpiscofinse);
        // fold auditoria [BAIXA]: CST PIS/COFINS nulo → default válido ('50' se há crédito, senão '99') em vez de '00' inválido.
        const cstRaw = String(it.cstpiscofins ?? '').replace(/\D/g, '');
        const cstPc = cstRaw !== '' ? cstRaw.padStart(2, '0') : nn(it.vrpise) > 0 || nn(it.vrcofinse) > 0 ? '50' : '99';
        const cstIcms = String(it.origem_estoque ?? '0').slice(0, 1) + String(nn(it.cst)).padStart(2, '0');
        const cstIpi = String(it.cfop ?? '').charAt(0) < '5' ? '49' : '99'; // entrada (1/2/3xxx) → 49
        // C170 (37 campos): NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|COD_NAT|VL_BC_ICMS|ALIQ_ICMS|VL_ICMS|VL_BC_ICMS_ST|ALIQ_ST|VL_ICMS_ST|IND_APUR|CST_IPI|COD_ENQ|VL_BC_IPI|ALIQ_IPI|VL_IPI|CST_PIS|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|VL_ABAT_NT
        arq.add('C170', [String(++nro), String(it.codproduto ?? ''), String(prod?.descricao ?? ''), fmtNum(nn(it.quantidade), 3), String(prod?.unidade ?? '').trim(), fmtNum(nn(it.vrcusto) * nn(it.quantidade)), fmtNum(nn(it.desconto)), '0', cstIcms, String(it.cfop ?? ''), '', fmtNum(nn(it.vrbasecalculo)), fmtNum(nn(it.icms)), fmtNum(nn(it.vricm)), fmtNum(0), fmtNum(0), fmtNum(0), '0', cstIpi, '', fmtNum(0), fmtNum(0), fmtNum(0), cstPc, fmtNum(base), fmtNum(nn(it.aliqpise), 4), '', '', fmtNum(nn(it.vrpise)), cstPc, fmtNum(base), fmtNum(nn(it.aliqcofinse), 4), '', '', fmtNum(nn(it.vrcofinse)), '', '']);
      }
    }

    // ── SAÍDA: NFC-e mod 65 (corte-2). 1 C100 por cupom (IND_OPER=1, IND_EMIT=0, consumidor final s/ COD_PART);
    // itens não-cancelados consolidam em C175 por (CFOP, CST_PIS, alíq PIS, CST_COFINS, alíq COFINS). Cupom
    // cancelado no SEFAZ (statusnfe='C') → C100 COD_SIT=02 sem C175 (fiel ao GeraRegistroC100Modelo65 do legado).
    for (const cup of cupons) {
      const cancelada = cup.statusnfe === 'C';
      const validos = cup.itens.filter((it) => String(it.cancelado ?? 'N') !== 'S');
      // grupos C175 por (CFOP, CST_PIS, ALIQ_PIS, CST_COFINS, ALIQ_COFINS) — CST NORMALIZADO na chave (evita
      // duplicar '1'/'01'). VL_PIS/COFINS = round(VL_BC × alíq/100) por grupo (fiel ao GeraRegistroC175 do legado,
      // que agrega base×alíq — NÃO soma valores por item), o que também alinha o bloco C com o M210 do débito.
      const grupos = new Map<string, Array<Record<string, unknown>>>();
      for (const it of validos) {
        const k = `${nn(it.cfop)}|${cst2(it.pis_cst)}|${nn(it.pis_aliquota).toFixed(4)}|${cst2(it.cofins_cst)}|${nn(it.cofins_aliquota).toFixed(4)}`;
        (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(it);
      }
      const c175 = [...grupos.values()].map((g) => {
        const bcPis = r2(g.reduce((s, it) => s + nn(it.pis_bcalculo), 0));
        const bcCof = r2(g.reduce((s, it) => s + nn(it.cofins_bcalculo), 0));
        const pisAliq = nn(g[0].pis_aliquota);
        const cofAliq = nn(g[0].cofins_aliquota);
        return {
          cfop: nn(g[0].cfop), pisCst: cst2(g[0].pis_cst), cofCst: cst2(g[0].cofins_cst),
          vlOpr: r2(g.reduce((s, it) => s + nn(it.qtde) * nn(it.vrvenda), 0)),
          bcPis, bcCof, pisAliq, cofAliq, vPis: r2((bcPis * pisAliq) / 100), vCof: r2((bcCof * cofAliq) / 100),
        };
      });
      const vlMerc = r2(c175.reduce((s, g) => s + g.vlOpr, 0));
      const vlPis = r2(c175.reduce((s, g) => s + g.vPis, 0)); // C100 = Σ dos C175 (coerência C100↔C175 que o PVA cobra)
      const vlCofins = r2(c175.reduce((s, g) => s + g.vCof, 0));
      const dt = fmtData(cup.dtemissao);
      // C100 (28 campos): IND_OPER(1=saída)|IND_EMIT(0=própria)|COD_PART|COD_MOD(65)|COD_SIT|SER|NUM_DOC|CHV|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT(9)|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
      arq.add('C100', ['1', '0', '', '65', cancelada ? '02' : '00', cup.nroserie, cup.nrocupom, cup.chavenfe, dt, dt, fmtNum(cancelada ? 0 : vlMerc), '0', fmtNum(0), fmtNum(0), fmtNum(cancelada ? 0 : vlMerc), '9', fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(cancelada ? 0 : vlPis), fmtNum(cancelada ? 0 : vlCofins), fmtNum(0), fmtNum(0)]);
      if (cancelada) continue; // documento cancelado: só o header, sem C175
      for (const g of c175) {
        // C175: CFOP|VL_OPR|VL_DESC|CST_PIS|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|INFO_COMPL
        arq.add('C175', [String(g.cfop), fmtNum(g.vlOpr), fmtNum(0), g.pisCst, fmtNum(g.bcPis), fmtNum(g.pisAliq, 4), '', '', fmtNum(g.vPis), g.cofCst, fmtNum(g.bcCof), fmtNum(g.cofAliq, 4), '', '', fmtNum(g.vCof), '', '']);
      }
    }
    arq.fecharBloco('C990', 'C');
  }
}
