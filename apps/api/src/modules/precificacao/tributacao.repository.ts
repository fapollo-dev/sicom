import { Injectable } from '@nestjs/common';
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
