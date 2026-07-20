import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SpedArquivo, fmtData, fmtNum, soDigitos } from './sped-writer';

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
 * SPED EFD-Contribuições (PIS/COFINS) — SCAFFOLD corte-1: motor escritor + BLOCO 0 (identificação/estabelecimentos)
 * + BLOCO 9 (totalizador). O legado escreve via ACBr; aqui construímos ao padrão SPED público. O BLOCO C (documentos)
 * e o BLOCO M (apuração) são o corte-2; a SAÍDA de VAREJO (cupons/ReduçãoZ do PDV) é PDV-DEPENDENTE e ainda não
 * migrada — por isso o arquivo é PARCIAL/não-transmissível (só o envelope + cadastros). Escopo por empresa (tenant).
 */
@Injectable()
export class SpedEfdContribuicoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(dtini: string, dtfim: string): Promise<{ arquivo: string; linhas: number; estabelecimentos: number; documentos: number; parcial: true; aviso: string }> {
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
    this.emitirCadastros(arq, docs);
    arq.fecharBloco('0990', '0');

    // BLOCO C (corte-2b): documentos fiscais de ENTRADA (C001/C010/C100/C170/C990). Só entrada — a saída de
    // varejo (cupons/ReduçãoZ do PDV) não está migrada.
    this.emitirBlocoC(arq, docs, cnpj);

    // BLOCO M (corte-2a): apuração do CRÉDITO de entrada (M100/M105 PIS + M500/M505 COFINS). A consolidação
    // M200/M600 (valor a recolher) depende do DÉBITO de saída (cupons/ReduçãoZ do PDV) → ADIADA.
    const credito = await this.gerarBlocoM(arq, db, emp, dtini, dtfim);

    const arquivo = arq.gerar();
    return {
      arquivo,
      linhas: arquivo.trimEnd().split('\r\n').length,
      estabelecimentos: estabs.length,
      documentos: docs.nfs.length,
      parcial: true,
      aviso: `PARCIAL: bloco 0 (cadastros) + bloco C (${docs.nfs.length} documentos de ENTRADA) + bloco M (crédito${credito ? '' : ' — rode POST /fiscal/sped/apuracao-pc'}) + bloco 9. Falta a SAÍDA de varejo (cupons/ReduçãoZ do PDV, não migrado) → docs de saída + DÉBITO/consolidação M200/M600.`,
    };
  }

  /**
   * BLOCO M — apuração do CRÉDITO de PIS/COFINS de entrada, lido de apuracao_pc/_det (rode a apuração antes).
   * M001 (abertura) → por alíquota: M100 (PIS: COD_CRED, BC, alíq, crédito) + M105 (detalhe por CST) ; M500/M505
   * (COFINS, espelho) → M990. Sem apuração no período → M001 IND_MOV=1 (bloco vazio). Retorna true se houve crédito.
   */
  private async gerarBlocoM(arq: SpedArquivo, db: AnyDB, emp: number, dtini: string, dtfim: string): Promise<boolean> {
    const cab = (await db.selectFrom('apuracao_pc').select('codapuracao_pc').where('idempresa', '=', emp).where('dataini', '=', dtini).where('datafim', '=', dtfim).executeTakeFirst()) as { codapuracao_pc?: number } | undefined;
    const det = cab
      ? ((await db.selectFrom('apuracao_pc_det').selectAll().where('codapuracao_pc', '=', Number(cab.codapuracao_pc)).where('tipo', '=', 'C').orderBy('codapuracao_pc_det').execute()) as Array<Record<string, unknown>>)
      : [];

    arq.add('M001', [det.length ? '0' : '1']); // IND_MOV: 0=com dados / 1=sem
    if (!det.length) {
      arq.fecharBloco('M990', 'M');
      return false;
    }

    const n2 = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
    const cst2 = (v: unknown) => (v == null ? '' : String(v).padStart(2, '0'));

    // ── PIS: M100 por alíquota (COD_CRED fixo '101' neste corte), M105 detalhe por CST ──
    const grupar = (chaveAliq: 'aliqpis' | 'aliqcofins') => {
      const m = new Map<string, Record<string, unknown>[]>();
      for (const d of det) {
        const k = `${d.id_tipocredito}|${Number(n2(d[chaveAliq])).toFixed(4)}`;
        (m.get(k) ?? m.set(k, []).get(k)!).push(d);
      }
      return m;
    };
    for (const linhas of grupar('aliqpis').values()) {
      const codCred = String(linhas[0].id_tipocredito ?? '101');
      const aliq = n2(linhas[0].aliqpis);
      const base = linhas.reduce((s, d) => s + n2(d.basecalculo), 0);
      const cred = linhas.reduce((s, d) => s + n2(d.valorpis), 0);
      // M100: COD_CRED|IND_CRED_ORI|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_CRED|VL_AJUS_ACRES|VL_AJUS_REDUC|VL_CRED_DIF|VL_CRED_DISP|IND_DESC_CRED|VL_CRED_DESC|SLD_CRED
      // fold auditoria [MÉDIA]: sem débito no período (M200 adiado — depende do PDV), o crédito NÃO é descontado →
      // VL_CRED_DESC=0 e SLD_CRED=VL_CRED_DISP (saldo credor a transportar). (Quando o débito entrar, o offset é recalculado.)
      arq.add('M100', [codCred, '01', fmtNum(base), fmtNum(aliq, 4), '', '', fmtNum(cred), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(cred), '0', fmtNum(0), fmtNum(cred)]);
      for (const d of linhas) {
        // M105: NAT_BC_CRED|CST_PIS|VL_BC_PIS_TOT|VL_BC_PIS_CUM|VL_BC_PIS_NC|VL_BC_PIS|QUANT_BC_PIS_TOT|QUANT_BC_PIS|DESC_CRED
        arq.add('M105', [cst2(d.id_basecredito), cst2(d.cst_pis), fmtNum(n2(d.basecalculo)), fmtNum(0), fmtNum(n2(d.basecalculo)), fmtNum(n2(d.basecalculo)), '', '', '']);
      }
    }
    // ── COFINS: M500/M505 (espelho) ──
    for (const linhas of grupar('aliqcofins').values()) {
      const codCred = String(linhas[0].id_tipocredito ?? '101');
      const aliq = n2(linhas[0].aliqcofins);
      const base = linhas.reduce((s, d) => s + n2(d.basecalculo), 0);
      const cred = linhas.reduce((s, d) => s + n2(d.valorcofins), 0);
      arq.add('M500', [codCred, '01', fmtNum(base), fmtNum(aliq, 4), '', '', fmtNum(cred), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(cred), '0', fmtNum(0), fmtNum(cred)]);
      for (const d of linhas) {
        arq.add('M505', [cst2(d.id_basecredito), cst2(d.cst_pis), fmtNum(n2(d.basecalculo)), fmtNum(0), fmtNum(n2(d.basecalculo)), fmtNum(n2(d.basecalculo)), '', '', '']);
      }
    }
    arq.fecharBloco('M990', 'M');
    return true;
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

  /** emite o BLOCO C: C001/C010 (por estab — aqui a empresa do tenant) + C100/C170 por NF de entrada + C990. */
  private emitirBlocoC(arq: SpedArquivo, docs: { nfs: Array<Record<string, unknown> & { itens: Array<Record<string, unknown>> }>; produtos: Map<number, Record<string, unknown>> }, cnpjEstab: string): void {
    const nn = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
    // fold auditoria [MÉDIA]: C001 (abertura) é SEMPRE emitido (IND_MOV=1 quando vazio), como o M001; C990 sempre fecha.
    arq.add('C001', [docs.nfs.length ? '0' : '1']);
    if (!docs.nfs.length) {
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
    arq.fecharBloco('C990', 'C');
  }
}
