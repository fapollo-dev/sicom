import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ExportaNfeDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * EXPORTAÇÃO DE NF-e (`FRMEXPORTANFE`). **15 acessos, 2 operadores.** Dossiê: `uExportaNFe.md`. Migration 259.
 *
 * As notas eletrônicas do período com chave, status SEFAZ e se há XML guardado; e o XML de cada nota, lido de
 * `nfe_xml` (43.185 no cliente). O DANFE em PDF do legado não existe no Apollo — declarado.
 */
@Injectable()
export class ExportaNfeService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: ExportaNfeDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const modelo = f.modelo === 'todos' ? null : Number(f.modelo);
    const status = f.status === 'autorizadas' ? sql`AND n.statusnfe = 'P'` : f.status === 'canceladas' ? sql`AND n.statusnfe = 'C'` : sql``;
    const rows = (await sql<Record<string, unknown>>`
      SELECT n.codnf, n.nronf, n.serie, n.modelo, to_char(n.dtemissao, 'YYYY-MM-DD') AS dtemissao, n.chavenfe, n.statusnfe, n.totalnf,
             n.codparceiro, p.razao,
             EXISTS (SELECT 1 FROM nfe_xml x WHERE x.codnf = n.codnf AND coalesce(x.simulado, 'N') = 'N') AS tem_xml
        FROM nf n LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
       WHERE n.idempresa = ${emp} AND n.tipo = 'S'
         AND n.dtemissao >= ${f.dataIni}::date AND n.dtemissao < ${f.dataFim}::date + 1
         AND (${modelo}::integer IS NULL OR n.modelo::text = ${modelo}::text)
         AND n.chavenfe IS NOT NULL
         ${status}
       ORDER BY n.dtemissao, n.nronf
       LIMIT ${f.limite + 1}
    `.execute(db)).rows;
    const truncado = rows.length > f.limite;
    return {
      notas: (truncado ? rows.slice(0, f.limite) : rows).map((r) => ({
        codnf: Number(r.codnf), nronf: r.nronf, serie: r.serie, modelo: r.modelo, dtemissao: r.dtemissao, chavenfe: r.chavenfe,
        statusnfe: r.statusnfe ?? null, totalnf: num(r.totalnf), codparceiro: r.codparceiro == null ? null : Number(r.codparceiro), razao: r.razao ?? null, temXml: r.tem_xml === true,
      })),
      truncado,
    };
  }

  async xml(codnf: number): Promise<{ codnf: number; chavenfe: string | null; xml: string }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = (await sql<Record<string, unknown>>`
      SELECT x.chavenfe, x.xml FROM nfe_xml x JOIN nf n ON n.codnf = x.codnf
       WHERE x.codnf = ${codnf} AND n.idempresa = ${emp} AND coalesce(x.simulado, 'N') = 'N'
       ORDER BY x.codnfexml DESC LIMIT 1
    `.execute(db)).rows[0];
    if (!r) throw new BusinessRuleError('NFE_SEM_XML', { codnf });
    return { codnf, chavenfe: (r.chavenfe as string) ?? null, xml: String(r.xml ?? '') };
  }
}
