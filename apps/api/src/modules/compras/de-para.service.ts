import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { normRef, digEan } from './codref-normalize';
import { parseNfeXml } from './nfe-xml.parser';

type AnyDB = Kysely<any>;

/**
 * DE-PARA de fornecedor (CODREFERENCIA_FOR) — cadastro/manutenção standalone (recebimento corte-5). A tabela é
 * GLOBAL (sem idempresa), mas TODO acesso é ESCOPADO por fornecedor→empresa (decisão de tenant): só de-para de
 * fornecedores da empresa corrente (JOIN parceiros WHERE idempresa=emp). codref normalizado no servidor
 * (normRef — single-source com o match do import). Fornecedor tem de ser FRN='S'. Hard-delete (fiel ao legado).
 */
@Injectable()
export class DeParaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** lista as de-para dos fornecedores DA EMPRESA (opcional filtrar por produto/fornecedor). */
  async listar(filtro: { idproduto?: number; codfor?: number } = {}): Promise<Array<Record<string, unknown>>> {
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('codreferencia_for as c')
      .innerJoin('parceiros as p', 'p.codparceiro', 'c.codfor')
      .select([
        'c.codreferencia_for as codreferencia_for', 'c.idproduto as idproduto', 'c.codfor as codfor',
        'c.codref as codref', 'c.tiporef as tiporef', 'c.fator_embalagem as fator_embalagem',
        'p.razao as razao',
        sql<string>`case c.tiporef when 'P' then 'PLU' when 'E' then 'EAN' end`.as('tiporefd'),
      ])
      .where('p.idempresa', '=', this.emp());
    if (filtro.idproduto != null) q = q.where('c.idproduto', '=', filtro.idproduto);
    if (filtro.codfor != null) q = q.where('c.codfor', '=', filtro.codfor);
    return q.orderBy('c.codfor').orderBy('c.codref').limit(1000).execute();
  }

  /** valida que o fornecedor pertence à empresa E é FRN='S' (SegFornecedor). Retorna o codparceiro. */
  private async assertFornecedor(db: AnyDB, codfor: number): Promise<void> {
    const forn = (await db
      .selectFrom('parceiros')
      .select(['codparceiro', 'frn'])
      .where('codparceiro', '=', codfor)
      .where('idempresa', '=', this.emp())
      .executeTakeFirst()) as { frn?: string } | undefined;
    if (!forn || forn.frn !== 'S') throw new BusinessRuleError('DEPARA_FORNECEDOR_INVALIDO', { codfor });
  }

  /** carrega a linha SÓ se o fornecedor dela é da empresa (escopo cross-tenant). */
  private async carregarNoEscopo(db: AnyDB, id: number): Promise<{ codreferencia_for: number; codfor: number }> {
    const row = (await db
      .selectFrom('codreferencia_for as c')
      .innerJoin('parceiros as p', 'p.codparceiro', 'c.codfor')
      .select(['c.codreferencia_for as codreferencia_for', 'c.codfor as codfor'])
      .where('c.codreferencia_for', '=', id)
      .where('p.idempresa', '=', this.emp())
      .executeTakeFirst()) as { codreferencia_for: number; codfor: number } | undefined;
    if (!row) throw new BusinessRuleError('DEPARA_NAO_ENCONTRADO', { codreferencia_for: id });
    return row;
  }

  async criar(dto: { idproduto: number; codfor: number; codref: string; tiporef?: string; fator_embalagem?: number }): Promise<{ codreferencia_for: number }> {
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertFornecedor(db, dto.codfor);
    const codref = normRef(dto.codref);
    if (!codref) throw new BusinessRuleError('DEPARA_CODREF_INVALIDO', { codref: dto.codref });
    try {
      const ins = (await db
        .insertInto('codreferencia_for')
        .values({ idproduto: dto.idproduto, codfor: dto.codfor, codref, tiporef: dto.tiporef === 'P' ? 'P' : 'E', fator_embalagem: dto.fator_embalagem ?? null, usucadastro: op, usultalteracao: op })
        .returning('codreferencia_for')
        .executeTakeFirstOrThrow()) as { codreferencia_for: number };
      return { codreferencia_for: Number(ins.codreferencia_for) };
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('DEPARA_DUPLICADO', { codfor: dto.codfor, codref });
      if ((e as { code?: string })?.code === '23503') throw new BusinessRuleError('DEPARA_PRODUTO_INVALIDO', { idproduto: dto.idproduto });
      throw e;
    }
  }

  async atualizar(id: number, dto: { codref?: string; tiporef?: string; fator_embalagem?: number }): Promise<{ codreferencia_for: number }> {
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregarNoEscopo(trx, id);
      const set: Record<string, unknown> = { usultalteracao: op, dtultimalteracao: sql`now()` };
      if (dto.codref !== undefined) {
        const codref = normRef(dto.codref);
        if (!codref) throw new BusinessRuleError('DEPARA_CODREF_INVALIDO', { codref: dto.codref });
        set.codref = codref;
      }
      if (dto.tiporef !== undefined) set.tiporef = dto.tiporef === 'P' ? 'P' : 'E';
      if (dto.fator_embalagem !== undefined) set.fator_embalagem = dto.fator_embalagem ?? null;
      try {
        await trx.updateTable('codreferencia_for').set(set).where('codreferencia_for', '=', id).execute();
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('DEPARA_DUPLICADO', { codreferencia_for: id });
        throw e;
      }
      return { codreferencia_for: id };
    });
  }

  async remover(id: number): Promise<void> {
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregarNoEscopo(trx, id);
      await trx.deleteFrom('codreferencia_for').where('codreferencia_for', '=', id).execute(); // hard-delete (fiel ao legado)
    });
  }

  /**
   * BACKFILL (uAtualizaTipoCodReferenciaFor) — re-escaneia os XMLs de NF de ENTRADA já armazenados (nfe_xml) e
   * APRENDE a de-para: p/ cada item que CASA um produto por EAN, grava CODREFERENCIA_FOR do fornecedor da NF —
   * 'E'(cEAN→produto) e 'P'(cProd→produto). Assim futuros imports resolvem também por cProd. Upsert por
   * (codfor, codref) — idempotente. MODO PREVIEW (aplicar=false) conta sem gravar. Escopado à empresa corrente
   * (nf.idempresa). Fiel ao legado (que exige NFE_XML). Só XMLs de NF tipo='E' com fornecedor (codparceiro).
   */
  async backfill(opts: { idproduto?: number; aplicar?: boolean } = {}): Promise<{ notas: number; itensCasados: number; deParaGravadas: number; aplicado: boolean }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;

    // XMLs de NF de entrada da empresa (tipo='E' + fornecedor). Limite defensivo (rotina de manutenção).
    const notas = (await db
      .selectFrom('nfe_xml as x')
      .innerJoin('nf as n', 'n.codnf', 'x.codnf')
      .select(['x.xml as xml', 'n.codparceiro as codparceiro'])
      .where('x.idempresa', '=', emp)
      .where('n.tipo', '=', 'E')
      .where('n.codparceiro', 'is not', null)
      .limit(5000)
      .execute()) as Array<{ xml: string; codparceiro: number }>;

    let itensCasados = 0;
    // acumula os pares (codfor, codref, tiporef, idproduto) a gravar — dedup por (codfor,codref) no fim.
    const pares = new Map<string, { codfor: number; codref: string; tiporef: 'E' | 'P'; idproduto: number }>();

    for (const nota of notas) {
      const codfor = Number(nota.codparceiro);
      let nfe: ReturnType<typeof parseNfeXml>;
      try { nfe = parseNfeXml(nota.xml); } catch { continue; } // XML corrompido → pula (best-effort)
      // casa por EAN em lote (produtos ∪ codauxiliar) — só produtos da empresa corrente NÃO se aplica (produto é global).
      const eans = Array.from(new Set(nfe.itens.map((it) => digEan((it.cEAN ?? '').trim())).filter((e) => e && e.length > 0)));
      const porEan = new Map<string, Set<number>>();
      const add = (cb: unknown, idp: unknown) => { const k = String(cb); const s = porEan.get(k) ?? new Set<number>(); s.add(Number(idp)); porEan.set(k, s); };
      if (eans.length) {
        for (const r of (await db.selectFrom('produtos').select(['codbarra', 'idproduto']).where('codbarra', 'in', eans).execute()) as any[]) add(r.codbarra, r.idproduto);
        for (const r of (await db.selectFrom('codauxiliar').select(['codbarra', 'idproduto']).where('codbarra', 'in', eans).execute()) as any[]) if (r.codbarra != null) add(r.codbarra, r.idproduto);
      }
      for (const it of nfe.itens) {
        const ids = porEan.get(digEan((it.cEAN ?? '').trim()));
        if (!ids || ids.size !== 1) continue; // só casa 1:1 (ambíguo/sem-match não aprende)
        const idproduto = [...ids][0];
        if (opts.idproduto != null && idproduto !== opts.idproduto) continue; // filtro opcional por produto
        itensCasados++;
        const ean = normRef(it.cEAN); const prod = normRef(it.cProd);
        if (ean) pares.set(`${codfor} ${ean}`, { codfor, codref: ean, tiporef: 'E', idproduto });
        if (prod) pares.set(`${codfor} ${prod}`, { codfor, codref: prod, tiporef: 'P', idproduto });
      }
    }

    if (!opts.aplicar) return { notas: notas.length, itensCasados, deParaGravadas: pares.size, aplicado: false };

    let gravadas = 0;
    for (const p of pares.values()) {
      await db
        .insertInto('codreferencia_for')
        .values({ idproduto: p.idproduto, codfor: p.codfor, codref: p.codref, tiporef: p.tiporef, usucadastro: op, usultalteracao: op })
        .onConflict((oc: any) => oc.columns(['codfor', 'codref']).doUpdateSet({ idproduto: p.idproduto, tiporef: p.tiporef, usultalteracao: op, dtultimalteracao: sql`now()` }))
        .execute();
      gravadas++;
    }
    return { notas: notas.length, itensCasados, deParaGravadas: gravadas, aplicado: true };
  }
}
