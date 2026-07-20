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

  async gerar(dtini: string, dtfim: string): Promise<{ arquivo: string; linhas: number; estabelecimentos: number; parcial: true; aviso: string }> {
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
    arq.fecharBloco('0990', '0');

    // BLOCO M (corte-2a): apuração do CRÉDITO de entrada (M100/M105 PIS + M500/M505 COFINS). A consolidação
    // M200/M600 (valor a recolher) depende do DÉBITO de saída (cupons/ReduçãoZ do PDV) → ADIADA.
    const credito = await this.gerarBlocoM(arq, db, emp, dtini, dtfim);

    const arquivo = arq.gerar();
    return {
      arquivo,
      linhas: arquivo.trimEnd().split('\r\n').length,
      estabelecimentos: estabs.length,
      parcial: true,
      aviso: `PARCIAL: bloco 0 (cadastros) + bloco M (crédito de entrada${credito ? '' : ' — SEM apuração no período; rode POST /fiscal/sped/apuracao-pc'}) + bloco 9. Falta o bloco C (documentos) e o DÉBITO de saída (cupons/ReduçãoZ do PDV, não migrado) → consolidação M200/M600.`,
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
}
