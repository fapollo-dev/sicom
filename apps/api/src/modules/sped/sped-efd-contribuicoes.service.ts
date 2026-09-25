import { pisCofinsDoItemC170, baseCofinsC170, icmsDoItemC170, pisCofinsDoCabecalho, indFreteC100, type PisCofinsCadastro } from './sped-pc-legado';
import { cst3 } from './sped-c-legado';
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

    // 0000 — identificação: COD_VER|TIPO_ESCRIT(0=original)|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|CNPJ|UF|COD_MUN|SUFRAMA|IND_NAT_PJ(00)|IND_ATIV
    // IND_ATIV='2' (Atividade de comércio) — fiel ao indAtivComercio do legado (supermercado = comércio; fold cutover ALTA).
    arq.add('0000', [codVersao(dtini), '0', '', '', fmtData(dtini), fmtData(dtfim), empresa.razao_social ?? '', cnpj, empresa.uf ?? '', empresa.idcidade != null ? String(empresa.idcidade) : '', '', '00', '2']);
    // 0001 — abertura do bloco 0 (0=com dados).
    arq.add('0001', ['0']);
    // 0110 — regime: LR → não-cumulativo (COD_INC_TRIB=1, apropriação direta, COD_TIPO_CONT=1 alíquota básica);
    // senão cumulativo (COD_INC_TRIB=2 + IND_REG_CUM=1 caixa). fold cutover ALTA: COD_TIPO_CONT era '0' (fora do
    // domínio {1,2} → PVA rejeita) e IND_REG_CUM era vazio no cumulativo (obrigatório p/ COD_INC_TRIB=2).
    // 0110: COD_INC_TRIB|IND_APRO_CRED|COD_TIPO_CONT|IND_REG_CUM (APRO_CRED/TIPO_CONT exigidos só p/ COD_INC_TRIB∈{1,3}).
    const naoCumulativo = String(empresa.classfiscal ?? '') === 'LR';
    arq.add('0110', naoCumulativo ? ['1', '1', '1', ''] : ['2', '', '', '1']);
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
    // a apuração do período EXATO (`UdmSpedPisCofins.dfm:6204-6206`): a do escopo da raiz do CNPJ tem IDEMPRESA nulo (as 18 do legado); se
    // houver mais de uma, vale a primeira
    const cab = (await db.selectFrom('apuracao_pc').select('codapuracao_pc').where((eb: any) => eb.or([eb('idempresa', '=', emp), eb('idempresa', 'is', null)]))
      .where('dataini', '=', dtini).where('datafim', '=', dtfim).orderBy('codapuracao_pc').executeTakeFirst()) as { codapuracao_pc?: number } | undefined;
    const det = cab
      ? ((await db.selectFrom('apuracao_pc_det').selectAll().where('codapuracao_pc', '=', Number(cab.codapuracao_pc)).orderBy('codapuracao_pc_det').execute()) as Array<Record<string, unknown>>)
      : [];
    const detC = det.filter((d) => d.tipo === 'C');
    const detD = det.filter((d) => d.tipo === 'D');
    const detI = det.filter((d) => d.tipo === 'I'); // receita NÃO-tributada (isenta/alíq-zero/monofásica) → M400/M800

    arq.add('M001', [det.length ? '0' : '1']); // IND_MOV: 0=com dados / 1=sem
    if (!det.length) {
      arq.fecharBloco('M990', 'M');
      return false;
    }

    // COD_CTA do M400/M410/M800/M810 (corte-2): CONFIGURACOES_SPED da empresa aponta PLANO_CONTAS e a emissão usa
    // o CODIEXPANDIDO (QryConfiguracoesSPED: LEFT JOIN PLANO_CONTAS PM4xx ON PM4xx.CODPLANOCONTAS=C.CODPLC_Mxxx_PC).
    // Sem config → vazio (o AsString de campo nulo no legado também emite '').
    const cta = ((await db
      .selectFrom('configuracoes_sped as cs')
      .leftJoin('plano_contas as p400', 'p400.codplanocontas', 'cs.codplc_m400_pc')
      .leftJoin('plano_contas as p410', 'p410.codplanocontas', 'cs.codplc_m410_pc')
      .leftJoin('plano_contas as p800', 'p800.codplanocontas', 'cs.codplc_m800_pc')
      .leftJoin('plano_contas as p810', 'p810.codplanocontas', 'cs.codplc_m810_pc')
      .select(['p400.codiexpandido as m400', 'p410.codiexpandido as m410', 'p800.codiexpandido as m800', 'p810.codiexpandido as m810'])
      .where('cs.idempresa', '=', emp)
      .executeTakeFirst()) ?? {}) as { m400?: string | null; m410?: string | null; m800?: string | null; m810?: string | null };

    // PIS (M100/M105/M200/M205/M210) e COFINS (M500/M505/M600/M605/M610) — mesma mecânica, colunas de valor
    // distintas. COD_REC do M205/M605 = código de receita do legado (UspedPisCofins.pas:1620/1799). A receita
    // não-tributada sai em M400/M410 (PIS, após a apuração PIS) e M800/M810 (COFINS, após a apuração COFINS), na
    // ordem do leiaute (…M210, M400, M410, M500…M610, M800, M810).
    this.emitirImpostoM(arq, detC, detD, 'aliqpis', 'valorpis', { m100: 'M100', m105: 'M105', m200: 'M200', m205: 'M205', m210: 'M210', codRec: '810902' });
    this.emitirReceitaNaoTributada(arq, detI, { m400: 'M400', m410: 'M410' }, { m400: cta.m400 ?? '', m410: cta.m410 ?? '' });
    this.emitirImpostoM(arq, detC, detD, 'aliqcofins', 'valorcofins', { m100: 'M500', m105: 'M505', m200: 'M600', m205: 'M605', m210: 'M610', codRec: '217201' });
    this.emitirReceitaNaoTributada(arq, detI, { m400: 'M800', m410: 'M810' }, { m400: cta.m800 ?? '', m410: cta.m810 ?? '' });
    arq.fecharBloco('M990', 'M');
    return true;
  }

  /**
   * M400/M410 (PIS) ou M800/M810 (COFINS): receita SEM débito (isenta/alíq-zero/monofásica/suspensa). Fiel a
   * GeraRegistroM400/M800 (UspedPisCofins.pas:1626/1892): SÓ os CSTs 04/06/08/09 são emitidos — o 05 está
   * COMENTADO no fonte (:1646) e o 07 nunca entrou; a apuração ainda captura {04..09} (camada de dado), mas a
   * emissão copia o legado. O COFINS é ESPELHO do PIS: GeraRegistroM800 recebe os MESMOS totais FValorCSTxRegM400
   * e o dataset é filtrado por CST_PIS_SAI (:1636-1639) — por isso os dois lados agrupam por CST_PIS.
   * Detalhe (corte-2, GeraRegistroM410:1667 / GeraRegistroM810:1909): CST 08/09 → UM filho NAT_REC='999' com o
   * total do CST; CST 04/06 → um filho POR NATUREZA (id_basecreditoisento resolvido na apuração via
   * PC_TIPOCREDITOISENTO), NAT_REC = pad-esquerda 3 dígitos (ConcatenaLeft). Natureza nula em CST 04/06 vira
   * '000' como o AsString do legado — o validador ACUSA (o PVA rejeitaria; é misconfig de PC_TIPOCREDITOISENTO).
   * Guardado por total>0 (o legado sai se pTotalCST=0). COD_CTA = CODIEXPANDIDO das contas de CONFIGURACOES_SPED.
   */
  private emitirReceitaNaoTributada(
    arq: SpedArquivo,
    detI: Array<Record<string, unknown>>,
    reg: { m400: string; m410: string },
    codCta: { m400: string; m410: string },
  ): void {
    const n2 = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    for (const cst of [4, 6, 8, 9]) {
      // total do CST (GetTotaisCSTM400:2309 soma TOTAL por CST_PIS_SAI) e detalhe por natureza no mesmo passo.
      const porNatureza = new Map<string, number>();
      let total = 0;
      for (const d of detI) {
        if ((d.cst_pis != null ? Number(d.cst_pis) : null) !== cst) continue;
        const v = n2(d.basecalculo);
        total = r2(total + v);
        const nat = d.id_basecreditoisento;
        const chave = nat == null ? '' : String(nat);
        porNatureza.set(chave, r2((porNatureza.get(chave) ?? 0) + v));
      }
      if (total === 0) continue; // fiel: if pTotalCST = 0 then exit (zero EXATO — total negativo EMITE, fold auditoria)
      const cst2 = String(cst).padStart(2, '0'); // GetCSTPis/GetCSTCofins: 2 dígitos
      arq.add(reg.m400, [cst2, fmtNum(total), codCta.m400, '']); // M400/M800: CST | VL_TOT_REC | COD_CTA | DESC_COMPL
      if (cst === 8 || cst === 9) {
        arq.add(reg.m410, ['999', fmtNum(total), codCta.m410, '']); // ramo 8/9: um único filho 999 com o total
      } else {
        // ramo 4/6: um filho por natureza, na ordem da chave (o GROUP BY do legado não ordena; determinizamos).
        // TODA linha do dataset vira M410, inclusive grupo 0/negativo (o while do legado não filtra — fold auditoria).
        for (const [nat, vl] of Array.from(porNatureza.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
          arq.add(reg.m410, [nat.padStart(3, '0'), fmtNum(vl), codCta.m410, '']); // M410/M810: NAT_REC | VL_REC | COD_CTA | DESC_COMPL
        }
      }
    }
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
      // fold cutover ALTA: IND_CRED_ORI é domínio {0,1} (0=operações próprias) — era '01' (fora do domínio → PVA rejeita).
      arq.add(reg.m100, [codCred, '0', fmtNum(base), fmtNum(aliq, 4), '', '', fmtNum(cred), fmtNum(0), fmtNum(0), fmtNum(0), fmtNum(cred), desc > 0 ? '1' : '0', fmtNum(desc), fmtNum(sld)]);
      for (const d of linhas) {
        // M105: NAT_BC_CRED|CST|VL_BC_TOT|VL_BC_CUM|VL_BC_NC|VL_BC|QUANT_BC_TOT|QUANT_BC|DESC_CRED
        // fold cutover MÉDIA: CST é OBRIGATÓRIO no M105/M505; cst_pis nulo (apuracao_pc_det não tem cst_cofins)
        // → default '50' (crédito vinculado a receita tributada MI) em vez de vazio (que o PVA rejeita).
        const cstCred = cst2(d.cst_pis) || '50';
        arq.add(reg.m105, [cst2(d.id_basecredito), cstCred, fmtNum(n2(d.basecalculo)), fmtNum(0), fmtNum(n2(d.basecalculo)), fmtNum(n2(d.basecalculo)), '', '', '']);
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

  /**
   * as NOTAS do bloco C como o `FDqNF` do legado (UdmSpedPisCofins.dfm:1758-1990): entrada e saída de qualquer modelo fora de
   * 22/21/6/2/57/7/8/3 (e da NFC-e, que vem das vendas no C175), processadas, com número, no período contábil, e com algum item fora de
   * 5929/6929 (o `ckbGera5929` desmarcado); os itens com o PISCOFINS (do item, senão do produto), o CFOP (PROC_CUPOM, a conta contábil) e
   * o produto; os participantes pelo endereço DA NOTA (sqqParceiros), com COD_PART = o CNPJ/CPF.
   */
  private async coletarDocumentosEntrada(
    db: AnyDB,
    emp: number,
    dtini: string,
    dtfim: string,
  ): Promise<{ nfs: Array<Record<string, unknown> & { itens: Array<Record<string, unknown>> }>; parceiros: Map<string, Record<string, unknown>>; produtos: Map<number, Record<string, unknown>>; unidades: Set<string>; pcConfig: Set<number>; abaterIcms: boolean }> {
    const nfs = (await db
      .selectFrom('nf as n')
      .leftJoin('parceiros as pa', 'pa.codparceiro', 'n.codparceiro')
      .leftJoin('parceiros_end as pe', 'pe.codend', 'n.codparceiro_end')
      .select(['n.codnf', 'n.tipo', 'n.modelo', 'n.nronf', 'n.serie', 'n.chavenfe', 'n.dtemissao', 'n.dtcontabil', 'n.tipoemissao', 'n.codparceiro', 'n.codparceiro_end',
        'n.totalnf', 'n.totaldesc', 'n.totaldescfinal', 'n.totalprod', 'n.totalfrete', 'n.totalseguro', 'n.totalacessorias', 'n.totalipi', 'n.tipofrete', 'n.fisco_emit_cnpj',
        'n.cfop', 'pa.tipofj', 'pe.cnpj_cpf', sql`coalesce(n.cancelada,'N')`.as('cancelada'), sql`coalesce(n.statusnfe,'')`.as('statusnfe')])
      .where('n.idempresa', '=', emp)
      .where(sql`coalesce(n.modelo, 0)`, 'not in', [22, 21, 6, 2, 57, 7, 8, 3, 65])
      .where(sql`coalesce(n.proc,'N')`, '=', 'S')
      // cancelados ENTRAM como COD_SIT=02 (só o cabeçalho), como o legado
      .where(sql`n.dtcontabil`, '>=', dtini)
      .where(sql`n.dtcontabil`, '<=', dtfim)
      .where('n.nronf', 'is not', null)
      .where('n.nronf', 'not in', ['0', '000000'])
      .where(sql<boolean>`EXISTS (SELECT 1 FROM nf_prod x WHERE x.codnf = n.codnf AND coalesce(x.cfop::text, '') NOT IN ('5929', '6929'))`)
      .orderBy('n.tipo').orderBy('n.modelo').orderBy('n.dtemissao').orderBy('n.nronf')
      .limit(5000)
      .execute()) as Array<Record<string, unknown>>;
    // a nota sem o endereço do parceiro usa o primeiro endereço dele (o mesmo recurso do 0150 do ICMS-IPI) — no C100 e no 0150
    const semEnd = [...new Set(nfs.filter((n) => n.codparceiro_end == null && n.codparceiro != null).map((n) => Number(n.codparceiro)))];
    if (semEnd.length) {
      const primeiros = (await db.selectFrom('parceiros_end').select(['codparceiro', sql<number>`min(codend)`.as('codend')]).where('codparceiro', 'in', semEnd).groupBy('codparceiro').execute()) as
        Array<{ codparceiro: number; codend: number }>;
      const cnpjs = primeiros.length
        ? new Map(((await db.selectFrom('parceiros_end').select(['codend', 'cnpj_cpf']).where('codend', 'in', primeiros.map((r) => Number(r.codend))).execute()) as Array<{ codend: number; cnpj_cpf: unknown }>).map((r) => [Number(r.codend), r.cnpj_cpf]))
        : new Map<number, unknown>();
      const porParceiro = new Map(primeiros.map((r) => [Number(r.codparceiro), Number(r.codend)]));
      for (const n of nfs) {
        if (n.codparceiro_end != null) continue;
        const e = porParceiro.get(Number(n.codparceiro));
        if (e != null) Object.assign(n, { codparceiro_end: e, cnpj_cpf: cnpjs.get(e) ?? null });
      }
    }
    const nfIds = nfs.map((n) => Number(n.codnf));
    const decomposicao = await this.configComEspecifica(db, 'CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL', false);
    const itens = nfIds.length
      ? ((await db.selectFrom('nf_prod as np')
        .leftJoin('produtos as p', 'p.idproduto', 'np.codproduto')
        .leftJoin('piscofins as cpc', (j: any) => j.on('cpc.idpiscofins', '=', sql`coalesce(np.idpiscofins, p.idpiscofins)`))
        .leftJoin('cfop as c', (j: any) => j.on(sql`c.codcfop::text`, '=', sql`np.cfop::text`))
        .leftJoin('plano_contas as plc', 'plc.codplanocontas', 'c.codplanocontas')
        .select(['np.codnf', 'np.nroitem', 'np.codproduto', 'np.descricao', 'np.quantidade', 'np.vrcusto', 'np.vrdescprod', 'np.desconto', 'np.vrbasecalculo', 'np.icms', 'np.icme',
          'np.vricm', 'np.vripi', 'np.cst', 'np.cfop', 'np.aliquota', 'np.depsacess', 'np.seguro', 'np.frete', 'np.ipi', 'np.vroutrasdesp', 'np.vricmst', 'p.decomposicao',
          'cpc.aliq_pis_ent', 'cpc.aliq_pis_sai', 'cpc.aliq_cofins_ent', 'cpc.aliq_cofins_sai', 'cpc.cst_pis_ent', 'cpc.cst_pis_sai', 'cpc.cst_cofins_ent', 'cpc.cst_cofins_sai',
          'c.proc_cupom', 'plc.codiexpandido'])
        .where('np.codnf', 'in', nfIds).orderBy('np.codnf').orderBy('np.nroitem').execute()) as Array<Record<string, unknown>>)
      : [];
    const itensPorNf = new Map<number, Array<Record<string, unknown>>>();
    for (const it of itens) {
      // CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL ≠ 'N': o produto que entra decomposto sai do C170 (FLG_PRODUTO_DECOMPOSTO 'R')
      if (decomposicao !== 'N' && String(it.decomposicao ?? '') === 'S') continue;
      const k = Number(it.codnf);
      (itensPorNf.get(k) ?? itensPorNf.set(k, []).get(k)!).push(it);
    }
    // o 0150 (sqqParceiros): quem está nas notas não canceladas, cliente/fornecedor/transportadora, com o endereço da nota
    const parceiros = new Map<string, Record<string, unknown>>();
    const ends = [...new Set(nfs.filter((n) => String(n.cancelada) !== 'S' && ![5929, 6929].includes(Number(n.cfop))).map((n) => Number(n.codparceiro_end)).filter(Boolean))];
    if (ends.length) {
      const rows = (await db.selectFrom('parceiros_end as pe').innerJoin('parceiros as p', 'p.codparceiro', 'pe.codparceiro')
        .select(['p.codparceiro', 'p.razao', 'p.tipofj', 'pe.codend', 'pe.cnpj_cpf', 'pe.rg_insc', 'pe.endereco', 'pe.bairro', 'pe.idcidade'])
        .where('pe.codend', 'in', ends)
        .where((eb: any) => eb.or([eb('p.cli', '=', 'S'), eb('p.frn', '=', 'S'), eb('p.tra', '=', 'S')]))
        .orderBy('pe.codend').execute()) as Array<Record<string, unknown>>;
      for (const r of rows) {
        const cod = String(r.cnpj_cpf ?? '').trim();
        if (String(r.razao ?? '').trim().toUpperCase() === 'AO CONSUMIDOR' || parceiros.has(cod)) continue;
        parceiros.set(cod, r);
      }
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
    const pcConfig = new Set(((await db.selectFrom('pc_config').select('cfop').execute()) as Array<{ cfop: unknown }>).map((r) => Number(r.cfop)).filter(Number.isFinite));
    const abaterIcms = (await this.configComEspecifica(db, 'ABATER_ICMS_BASE_CALCULO_PIS_COFINS', true)) === 'S';
    return { nfs: nfs.map((n) => ({ ...n, itens: itensPorNf.get(Number(n.codnf)) ?? [] })), parceiros, produtos, unidades, pcConfig, abaterIcms };
  }

  /**
   * as views GET_CONFIG_* do legado: COALESCE(específica, global) — `soSim`: só a específica 'S' conta (GET_CONFIG_ABATER_ICMS_PC);
   * senão qualquer específica (GET_CONFIG_DECOMPOSICAO)
   */
  private async configComEspecifica(db: AnyDB, codigo: string, soSim: boolean): Promise<string> {
    const r = (await sql<{ valor: string | null }>`
      SELECT coalesce((SELECT e.valor FROM configuracoes_especificas e WHERE e.id = c.id ${soSim ? sql`AND e.valor = 'S'` : sql``} LIMIT 1), c.valor) AS valor
        FROM configuracoes c WHERE c.codigo = ${codigo} LIMIT 1`.execute(db)).rows[0];
    return String(r?.valor ?? '').trim().toUpperCase();
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
  private emitirCadastros(arq: SpedArquivo, docs: { parceiros: Map<string, Record<string, unknown>>; produtos: Map<number, Record<string, unknown>>; unidades: Set<string> }): void {
    for (const [codPart, p] of docs.parceiros) {
      const doc = soDigitos(p.cnpj_cpf as string);
      const juridica = String(p.tipofj ?? '').trim().toUpperCase() === 'J';
      const fisica = String(p.tipofj ?? '').trim().toUpperCase() === 'F';
      // 0150 (UspedPisCofins.pas:478-492): COD_PART = o CNPJ/CPF do endereço da nota; CNPJ para 'J', CPF para os outros; IE fora da 'F'
      arq.add('0150', [codPart, String(p.razao ?? ''), '1058', juridica ? doc : '', juridica ? '' : doc, fisica ? '' : soDigitos(p.rg_insc as string),
        p.idcidade != null ? String(p.idcidade) : '', '', String(p.endereco ?? '').slice(0, 60).trim(), '', '', String(p.bairro ?? '')]);
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
    docs: { nfs: Array<Record<string, unknown> & { itens: Array<Record<string, unknown>> }>; produtos: Map<number, Record<string, unknown>>; pcConfig: Set<number>; abaterIcms: boolean },
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
      const tipoNota = String(nf.tipo);
      const indOper = tipoNota === 'E' ? '0' : '1';
      const indEmit = String(nf.tipoemissao ?? '0').trim() === '0' ? '0' : '1';
      // COD_MOD: modelo 90 → '1B' (fiel ao legado; '90' não é COD_MOD da tabela 4.1.1)
      const codMod = String(nf.modelo ?? '') === '90' ? '1B' : String(nf.modelo ?? '').padStart(2, '0');
      const ser = String(nf.serie ?? '').trim().padStart(3, '0'); // ConcatenaLeft(trim(SERIE), 3, '0')
      const cancelada = String(nf.cancelada) === 'S' || String(nf.statusnfe) === 'C';
      if (cancelada) {
        // COD_SIT=02: só o cabeçalho identificador, sem C170 (GeraRegistroC100OutrosModelosCanceladas)
        arq.add('C100', [indOper, indEmit, '', codMod, '02', ser, String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', ...Array(20).fill('')]);
        continue;
      }
      const itens = nf.itens;
      const pc = (it: Record<string, unknown>) => it as PisCofinsCadastro;
      // o C100 (GeraRegistroC100OutrosModelosAutorizadas, pas:882-916): o PIS/COFINS é a conta do cabeçalho; base/ICMS = Σ do C170 (o 1º
      // item x929 zera); COD_SIT 08 com o 1º item x929 ou nota avulsa (FISCO_EMIT_CNPJ); VL_DESC = desconto + |desconto final|
      const primeiro = itens[0];
      const x929 = String(primeiro?.cfop ?? '').includes('929');
      const icmsItens = itens.map((it) => icmsDoItemC170(it, String(it.proc_cupom ?? '') === 'S'));
      const cab = pisCofinsDoCabecalho(itens.map((it) => ({ it, pc: pc(it) })), tipoNota, String(nf.tipoemissao ?? ''), nf.tipofj, docs.pcConfig, docs.abaterIcms);
      const vlMerc = r2(itens.filter((it) => !['5929', '6929'].includes(String(it.cfop ?? ''))).reduce((a, it) => a + r2(nn(it.vrcusto) * nn(it.quantidade)), 0));
      const codSit = x929 || String(nf.fisco_emit_cnpj ?? '').trim() !== '' ? '08' : '00';
      // C100 (28 campos): IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO(1)|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST
      arq.add('C100', [indOper, indEmit, String(nf.cnpj_cpf ?? '').trim(), codMod, codSit, ser, String(nf.nronf ?? ''), (nf.chavenfe as string) ?? '', fmtData(nf.dtemissao as string),
        fmtData(nf.dtcontabil as string), fmtNum(nn(nf.totalnf)), '1', fmtNum(nn(nf.totaldesc) + Math.abs(nn(nf.totaldescfinal))), fmtNum(0), fmtNum(vlMerc), indFreteC100(nf.tipofrete),
        fmtNum(nn(nf.totalfrete)), fmtNum(nn(nf.totalseguro)), fmtNum(nn(nf.totalacessorias)), fmtNum(x929 ? 0 : r2(icmsItens.reduce((a, i) => a + i.bc, 0))),
        fmtNum(x929 ? 0 : r2(icmsItens.reduce((a, i) => a + i.valor, 0))), fmtNum(0), fmtNum(0), fmtNum(nn(nf.totalipi)), fmtNum(cab.pis), fmtNum(cab.cofins), fmtNum(0), fmtNum(0)]);
      let nro = 0;
      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        const prod = docs.produtos.get(Number(it.codproduto));
        const cfop = Number(it.cfop);
        const t = pisCofinsDoItemC170(cfop, tipoNota, nf.tipofj, pc(it), docs.pcConfig);
        const base = baseCofinsC170(it, tipoNota, docs.abaterIcms, nn(it.aliq_cofins_sai));
        const cst = String(Math.trunc(t.cst)).padStart(2, '0'); // um CST só (o de COFINS) nos dois campos, como o legado (pas:946/973)
        const ic = icmsItens[i];
        const cstIpi = String(it.cfop ?? '').charAt(0) < '5' ? '49' : '99';
        // C170 (37 campos): NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|COD_NAT|VL_BC_ICMS|ALIQ_ICMS|VL_ICMS|VL_BC_ICMS_ST|ALIQ_ST|VL_ICMS_ST|IND_APUR|CST_IPI|COD_ENQ|VL_BC_IPI|ALIQ_IPI|VL_IPI|CST_PIS|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|VL_ABAT_NT
        // VL_DESC: o legado manda o DESCONTO em % (pas:956 — bug: NF 159457 com 54,93 no lugar de R$ 6.689,76); aqui o valor do desconto
        arq.add('C170', [String(++nro), String(it.codproduto ?? ''), String(it.descricao ?? '').trim(), fmtNum(nn(it.quantidade), 3), String(prod?.unidade ?? '').trim(),
          fmtNum(r2(nn(it.quantidade) * nn(it.vrcusto))), fmtNum(nn(it.vrdescprod)), '0', cst3(it.cst), String(it.cfop ?? ''), '', fmtNum(ic.bc), fmtNum(ic.aliq), fmtNum(ic.valor),
          fmtNum(0), fmtNum(0), fmtNum(0), '0', cstIpi, '', fmtNum(0), fmtNum(0), fmtNum(0),
          cst, fmtNum(t.aliqPis === 0 ? 0 : base), fmtNum(t.aliqPis, 4), '', '', fmtNum(r2((base * t.aliqPis) / 100)),
          cst, fmtNum(t.aliqCofins === 0 ? 0 : base), fmtNum(t.aliqCofins, 4), '', '', fmtNum(r2((base * t.aliqCofins) / 100)), String(it.codiexpandido ?? ''), '']);
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
