import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';

export interface AliquotaResolvida {
  aliquota: string;
  uf: string;
  icm: number;
  icmEfetivo: number; // já com redução de base; 0 em ST/isento/não-trib
  base: number;
  cst: number; // 00 tributado, 20 redução, 40 isento, 60 ST
  lei: string | null; // fonte legal (do legado)
  descricao: string | null;
}

export interface ReformaResolvida {
  uf: string;
  vigenciaInicio: string;
  ibs: number;
  cbs: number;
  impostoSeletivo: number;
  fonte: string;
}

/**
 * Resolve tributos REUSANDO a regra do legado (DET_ALIQUOTA) e a tabela NOVA da
 * Reforma (tributacao_reforma). A tabela legada já encapsula ST/redução/isenção/CST/LEI —
 * por isso a reusamos em vez de reinventar (princípio "usa legado, desenvolve novo").
 */
@Injectable()
export class TributacaoRepository {
  constructor(private readonly dbp: DatabaseProvider) {}

  /** Regra LEGADA: (aliquota, uf) → ICMS efetivo, CST, redução, LEI. */
  async resolverAtual(aliquota: string, uf: string): Promise<AliquotaResolvida> {
    const r = await this.dbp
      .forTenantRead()
      .selectFrom('det_aliquota')
      .selectAll()
      .where('aliquota', '=', aliquota)
      .where('uf', '=', uf)
      .executeTakeFirst();
    if (!r) throw new BusinessRuleError('ALIQUOTA_NAO_CADASTRADA', { aliquota, uf });
    return {
      aliquota: r.aliquota,
      uf: r.uf,
      icm: Number(r.icm),
      icmEfetivo: Number(r.icm_efetivo),
      base: Number(r.base),
      cst: r.cst,
      lei: r.lei,
      descricao: r.descricao,
    };
  }

  /** Regra LEGADA de ST: MVA/alíquotas por NCM (INDEXADOR_TRIBUTARIO). F2b: +redcom/aliquotaFem/tpFigura. */
  async resolverIndexador(ncm: string): Promise<{
    ncm: string;
    aliquotaDest: number;
    icmFonte: number;
    mva: number;
    reducao: number; // % de redução da alíquota-fonte no crédito (100 = sem)
    redcom: number; // % da BC-ST (REDCOM; 100 = sem redução)
    aliquotaFem: number; // FEM (denominador do MVA ajustado)
    tpFigura: string; // 'S' = fornecedor Simples Nacional (pula MVA ajustado)
  }> {
    const r = await this.dbp
      .forTenantRead()
      .selectFrom('indexador_tributario')
      .selectAll()
      .where('ncm', '=', ncm)
      .executeTakeFirst();
    if (!r) throw new BusinessRuleError('INDEXADOR_NAO_CADASTRADO', { ncm });
    const rr = r as Record<string, unknown>;
    return {
      ncm: r.ncm,
      aliquotaDest: Number(r.aliquota_dest),
      icmFonte: Number(r.icm_fonte),
      mva: Number(r.mva),
      reducao: Number(r.reducao),
      redcom: rr.redcom != null ? Number(rr.redcom) : 100,
      aliquotaFem: rr.aliquota_fem != null ? Number(rr.aliquota_fem) : 0,
      tpFigura: rr.tp_figura != null ? String(rr.tp_figura) : 'N',
    };
  }

  /**
   * FIGURA FISCAL (F2c-2 P2) — resolução MULTI-CHAVE do INDEXADOR_TRIBUTARIO (udmNF.dfm:17593 /
   * udmNF.pas:9987-10162): filtra por CODFIGURAFISCAL + TP_CADASTRO + ORIGEM + DESTINO + CODCFOP e,
   * entre as candidatas, aplica o OR-null de CODBARRA/NCM/CODPARCEIRO com DESEMPATE por especificidade
   * (mais específica vence). Devolve os mesmos parâmetros do resolverIndexador + `operacao`/`cst`.
   * Retorna null se não houver figura (o chamador cai no caminho por alíquota/NCM). NÃO substitui o
   * resolverIndexador (caminho NCM do ST F2b, intacto p/ compat).
   */
  async resolverFigura(chave: {
    codfigurafiscal: number;
    tpCadastro: string; // 'F' entrada / 'C' saída
    origem: string;
    destino: string;
    codcfop: number;
    codbarra?: string | null;
    ncm?: string | null;
    codparceiro?: number | null;
  }): Promise<{
    aliquotaDest: number;
    icmFonte: number;
    mva: number;
    reducao: number;
    redcom: number;
    aliquotaFem: number;
    tpFigura: string;
    operacao: string;
    cst: number;
  } | null> {
    const rows = await (this.dbp.forTenantRead() as any)
      .selectFrom('indexador_tributario')
      .selectAll()
      .where('codfigurafiscal', '=', chave.codfigurafiscal)
      .where('tp_cadastro', '=', chave.tpCadastro)
      .where('origem', '=', chave.origem)
      .where('destino', '=', chave.destino)
      .where('codcfop', '=', chave.codcfop)
      .where(sql`coalesce(indr, 'I')`, '<>', 'E')
      .execute();
    // OR-null: mantém a linha cujo campo é NULL (curinga) OU casa exatamente a chave.
    const casa = (rowVal: unknown, chaveVal: unknown) =>
      rowVal == null || String(rowVal) === String(chaveVal ?? '');
    const cands = (rows as Record<string, unknown>[]).filter(
      (r) => casa(r.codbarra, chave.codbarra) && casa(r.ncm, chave.ncm) && casa(r.codparceiro, chave.codparceiro),
    );
    if (!cands.length) return null;
    // desempate por ESPECIFICIDADE (udmNF.pas:10029-10088): CODBARRA > NCM > CODPARCEIRO.
    const esp = (r: Record<string, unknown>) =>
      (r.codbarra != null ? 4 : 0) + (r.ncm != null ? 2 : 0) + (r.codparceiro != null ? 1 : 0);
    cands.sort((a, b) => esp(b) - esp(a));
    const r = cands[0];
    const operacao = r.operacao != null ? String(r.operacao) : 'T';
    return {
      aliquotaDest: Number(r.aliquota_dest),
      icmFonte: Number(r.icm_fonte),
      mva: Number(r.mva),
      reducao: Number(r.reducao),
      redcom: r.redcom != null ? Number(r.redcom) : 100,
      aliquotaFem: r.aliquota_fem != null ? Number(r.aliquota_fem) : 0,
      tpFigura: r.tp_figura != null ? String(r.tp_figura) : 'N',
      operacao,
      cst: TributacaoRepository.cstDaOperacao(operacao),
    };
  }

  /** CST derivado da OPERACAO do indexador (udmNF.pas:10096-10120). */
  static cstDaOperacao(op: string): number {
    const map: Record<string, number> = { T: 0, R: 20, C: 10, F: 60, S: 50, D: 51, I: 40, N: 90, Y: 41, Z: 70 };
    return map[op] ?? 0;
  }

  /** Regra NOVA: Reforma por UF, escolhendo a vigência mais recente <= dataRef. */
  async resolverReforma(uf: string, dataRef: string): Promise<ReformaResolvida> {
    const r = await this.dbp
      .forTenantRead()
      .selectFrom('tributacao_reforma')
      .selectAll()
      .where('uf', '=', uf)
      .where('vigencia_inicio', '<=', dataRef)
      .orderBy('vigencia_inicio', 'desc')
      .executeTakeFirst();
    if (!r) throw new BusinessRuleError('REFORMA_NAO_CADASTRADA', { uf, dataRef });
    return {
      uf: r.uf,
      vigenciaInicio: String(r.vigencia_inicio),
      ibs: Number(r.ibs),
      cbs: Number(r.cbs),
      impostoSeletivo: Number(r.imposto_seletivo),
      fonte: r.fonte,
    };
  }
}
