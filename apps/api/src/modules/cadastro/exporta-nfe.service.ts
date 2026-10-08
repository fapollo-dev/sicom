import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ExportaNfeDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { zipSync, strToU8 } from 'fflate';

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

  /**
   * a grade de MANUTENÇÃO (btnPesquisarNotasFiscaisClick, uExportaNFe.pas:247-290): as notas marcadas na Pesquisa — o `cdsNota` com
   * `N.CODNF IN (…)`, em ordem de NRONF — recortadas às lojas do operador.
   */
  async notasDaManutencao(codnfs: number[]): Promise<Record<string, unknown>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await todasAsEmpresasDoOperador(db);
    const rows = (await sql<Record<string, unknown>>`
      SELECT n.codnf, n.nronf, n.serie, n.modelo, n.idempresa, to_char(n.dtemissao, 'YYYY-MM-DD') AS dtemissao, n.chavenfe, n.statusnfe, n.totalnf,
             n.codparceiro, p.razao,
             EXISTS (SELECT 1 FROM nfe_xml x WHERE x.codnf = n.codnf AND coalesce(x.simulado, 'N') = 'N') AS tem_xml
        FROM nf n LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
       WHERE n.codnf = ANY(${codnfs}::integer[]) AND n.idempresa = ANY(${lojas}::integer[])
       ORDER BY CASE WHEN n.nronf ~ '^\\s*\\d+\\s*$' THEN trim(n.nronf)::numeric END NULLS LAST, n.nronf, n.codnf
    `.execute(db)).rows;
    return {
      notas: rows.map((r) => ({
        codnf: Number(r.codnf), nronf: r.nronf, serie: r.serie, modelo: r.modelo, idempresa: Number(r.idempresa), dtemissao: r.dtemissao,
        chavenfe: r.chavenfe, statusnfe: r.statusnfe ?? null, totalnf: num(r.totalnf), codparceiro: r.codparceiro == null ? null : Number(r.codparceiro),
        razao: r.razao ?? null, temXml: r.tem_xml === true,
      })),
    };
  }

  /**
   * o "Salvar XML NFe" da manutenção (ManipulaNF(4) → SalvaXMLNFe, udmNF.pas:5057; NFe.pas:4413-4460): TODAS as notas da grade (o 4 não
   * filtra a seleção), cada uma como `<chave>-NFe.xml` (a chave sem o prefixo "NFe"), numa pasta pelo número da nota ("Separado pelo
   * número da nota") ou todas juntas ("Em uma unica pasta"). O legado regera e consulta a SEFAZ antes de gravar; o Apollo entrega o XML
   * autorizado guardado (`nfe_xml`) e lista em NAO_SALVAS.txt a nota que não tem — num zip, que é a pasta do navegador.
   */
  async xmlsDaManutencao(codnfs: number[], separarPorNumero: boolean): Promise<{ nome: string; zip: Uint8Array; salvas: number; semXml: number }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await todasAsEmpresasDoOperador(db);
    const rows = (await sql<{ codnf: number; nronf: string | null; chavenfe: string | null; xml: string | null }>`
      SELECT DISTINCT ON (n.codnf) n.codnf, n.nronf, n.chavenfe, x.xml
        FROM nf n LEFT JOIN nfe_xml x ON x.codnf = n.codnf AND coalesce(x.simulado, 'N') = 'N'
       WHERE n.codnf = ANY(${codnfs}::integer[]) AND n.idempresa = ANY(${lojas}::integer[])
       ORDER BY n.codnf, x.codnfexml DESC NULLS LAST
    `.execute(db)).rows;
    const arquivos: Record<string, Uint8Array> = {};
    const faltam: string[] = [];
    for (const r of rows) {
      const chave = String(r.chavenfe ?? '').trim();
      if (!chave || !r.xml) {
        faltam.push(`NF ${String(r.nronf ?? '').trim()} (código ${r.codnf}): ${!chave ? 'sem chave' : 'sem XML autorizado guardado'}`);
        continue;
      }
      const nome = `${chave.toUpperCase().startsWith('NFE') ? chave.slice(3) : chave}-NFe.xml`;
      arquivos[separarPorNumero ? `${String(r.nronf ?? r.codnf).trim()}/${nome}` : nome] = strToU8(String(r.xml));
    }
    // nenhuma nota com XML: não há o que salvar (um zip só com a lista seria um arquivo vazio)
    if (!Object.keys(arquivos).length) throw new BusinessRuleError('NFE_SEM_XML', { codnfs });
    if (faltam.length) arquivos['NAO_SALVAS.txt'] = strToU8(faltam.join('\r\n') + '\r\n');
    return { nome: `xml-nfe-${rows.length}-notas.zip`, zip: zipSync(arquivos), salvas: rows.length - faltam.length, semXml: faltam.length };
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
