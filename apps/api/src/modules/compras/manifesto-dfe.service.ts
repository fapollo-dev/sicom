import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export interface FiltroManifesto {
  dtini?: string; dtfim?: string;
  fornecedor?: string; chave?: string;
  /** TTipoFiltro do legado: TODOS | CANCELADAS | NAO_CANCELADAS (cancelada = tem evento 110111 do emitente) */
  canceladas?: 'TODOS' | 'CANCELADAS' | 'NAO_CANCELADAS';
  /** só as pendentes (não importadas e não ignoradas) — o trabalho do dia do operador */
  pendentes?: boolean;
}

/**
 * MANIFESTO DO DFe (FRMMANIFESTODFE) — corte 1: o domínio LOCAL da 2ª tela mais usada do sistema.
 * Procedência: UManifestoDFe.pas (3.187 ln) + uDMManifestoDFe.pas + view Oracle GET_NF_MANIFESTO.
 *
 * O que ESTE corte cobre (nada aqui fala com a SEFAZ):
 *  · a FILA das NF-e emitidas contra a empresa (nfe_nao_cadastradas, 20.581 no golden) com os flags de
 *    manifestação POR CHAVE — a view do legado deriva CONFIRMACAO/CIENCIA/DESCONHECIMENTO/OP_NAO_REALIZADA
 *    por EXISTS em NFE_EVENTOS (210200/210210/210220/210240); reproduzido com agregação por chave;
 *  · CANCELADA = existe evento 110111 (cancelamento DO EMITENTE) — é o TTipoFiltro da tela e a cor vermelha
 *    da grade (regra de negócio, lição 26);
 *  · o histórico de eventos da chave (manifestação + emitente + fisco);
 *  · IGNORAR com MOTIVO obrigatório (grava operador; reversível);
 *  · o XML completo p/ exportar/encaminhar à importação de NF-e já existente (mig 062).
 *
 * O corte 2 (SEFAZ: distribuição DFe + transmissão dos eventos com certificado A1) fica fora por decisão —
 * os eventos exibidos aqui são os JÁ AUTORIZADOS que o cutover carrega e os que o corte 2 vier a registrar.
 */
@Injectable()
export class ManifestoDfeService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: FiltroManifesto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    // flags de evento por chave — o EXISTS da view, materializado numa agregação (1 passada em NFE_EVENTOS)
    const ev = db.selectFrom('nfe_eventos')
      .select([
        'chave_acesso',
        sql`max(case when tipo_evento = 210200 then 1 else 0 end)`.as('confirmacao'),
        sql`max(case when tipo_evento = 210210 then 1 else 0 end)`.as('ciencia'),
        sql`max(case when tipo_evento = 210220 then 1 else 0 end)`.as('desconhecimento'),
        sql`max(case when tipo_evento = 210240 then 1 else 0 end)`.as('op_nao_realizada'),
        sql`max(case when tipo_evento = 110111 then 1 else 0 end)`.as('cancelada'),
      ])
      .groupBy('chave_acesso');

    let q = db.selectFrom('nfe_nao_cadastradas as n')
      .leftJoin(ev.as('e'), 'e.chave_acesso', 'n.chavenfe')
      .select([
        'n.codnfe_naocad', 'n.chavenfe', 'n.cnpj', 'n.razao', 'n.dtemissao', 'n.totalnf',
        'n.situacao', 'n.modelo', 'n.nronf', 'n.protocolo',
        sql`coalesce(n.nfe_importada_sistema,'N')`.as('importada'),
        sql`coalesce(n.ignorar_manifesto,'N')`.as('ignorada'),
        'n.ignorar_manifesto_motivo',
        sql`coalesce(e.confirmacao,0)`.as('confirmacao'),
        sql`coalesce(e.ciencia,0)`.as('ciencia'),
        sql`coalesce(e.desconhecimento,0)`.as('desconhecimento'),
        sql`coalesce(e.op_nao_realizada,0)`.as('op_nao_realizada'),
        sql`coalesce(e.cancelada,0)`.as('cancelada'),
        // tem XML completo? (habilita exportar/importar)
        sql`exists (select 1 from nfe_xml x where x.chavenfe = n.chavenfe)`.as('tem_xml'),
      ])
      .where('n.idempresa', '=', emp);
    if (f.dtini) q = q.where('n.dtemissao', '>=', sql`${f.dtini}::timestamptz`);
    if (f.dtfim) q = q.where('n.dtemissao', '<', sql`(${f.dtfim}::date + 1)`);
    if (f.fornecedor) q = q.where(sql<boolean>`upper(n.razao) like ${`%${f.fornecedor.toUpperCase()}%`}`);
    if (f.chave) q = q.where('n.chavenfe', '=', f.chave.trim());
    if (f.canceladas === 'CANCELADAS') q = q.where(sql<boolean>`coalesce(e.cancelada,0) = 1`);
    if (f.canceladas === 'NAO_CANCELADAS') q = q.where(sql<boolean>`coalesce(e.cancelada,0) = 0`);
    if (f.pendentes) q = q.where(sql<boolean>`coalesce(n.nfe_importada_sistema,'N') = 'N' and coalesce(n.ignorar_manifesto,'N') = 'N'`);

    const rows = (await q.orderBy(sql`n.dtemissao desc`).orderBy('n.codnfe_naocad').limit(2001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 2000;
    const linhas = truncado ? rows.slice(0, 2000) : rows;
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        pendentes: linhas.filter((l) => l.importada === 'N' && l.ignorada === 'N').length,
        canceladas: linhas.filter((l) => Number(l.cancelada) === 1).length,
        total: Math.round(linhas.reduce((s, l) => s + num(l.totalnf), 0) * 100) / 100,
      },
      filtro: { ...f, empresa: emp, truncado, max_linhas: 2000 },
    };
  }

  /** histórico completo de eventos da chave (manifestação + emitente + fisco), mais novo primeiro. */
  async eventos(chave: string) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const linhas = await db.selectFrom('nfe_eventos')
      .select(['codnfe_evento', 'tipo_evento', 'seq_evento', 'descricao_evento', 'data_evento',
        'protocolo_autorizacao', 'data_autorizacao', 'mensagem_autorizacao', 'just_op_nao_realizada', 'codoperador'])
      .where('chave_acesso', '=', chave.trim())
      .orderBy(sql`data_evento desc nulls last`).orderBy(sql`codnfe_evento desc`)
      .limit(200).execute();
    return { linhas };
  }

  /** IGNORAR (tira da fila) — o MOTIVO é obrigatório na tela do legado; grava o operador; reversível. */
  async ignorar(cod: number, motivo: string | null, reverter: boolean) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    if (!reverter && !motivo?.trim()) throw new BusinessRuleError('MOTIVO_OBRIGATORIO');
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx) => {
      const nf = await trx.selectFrom('nfe_nao_cadastradas')
        .select(['codnfe_naocad', 'nfe_importada_sistema'])
        .where('codnfe_naocad', '=', cod).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NFE_NAO_ENCONTRADA');
      // ignorar uma nota JÁ importada não faz sentido (a fila do legado esconde importadas do fluxo)
      if (!reverter && nf.nfe_importada_sistema === 'S') throw new BusinessRuleError('NFE_JA_IMPORTADA');
      await trx.updateTable('nfe_nao_cadastradas')
        .set(reverter
          ? { ignorar_manifesto: 'N', ignorar_manifesto_motivo: null }
          : { ignorar_manifesto: 'S', ignorar_manifesto_motivo: motivo!.trim().slice(0, 255), codoperador: op })
        .where('codnfe_naocad', '=', cod).where('idempresa', '=', emp)
        .execute();
      return { ok: true, codnfe_naocad: cod, ignorada: !reverter };
    });
  }

  /** o XML completo da chave (p/ exportar ou encaminhar à importação de NF-e — mig 062). */
  async xml(chave: string) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const row = await db.selectFrom('nfe_xml')
      .select(['codnfexml', 'chavenfe', 'xml', 'modelo', 'dtcadastro'])
      .where('chavenfe', '=', chave.trim())
      .orderBy(sql`codnfexml desc`).executeTakeFirst();
    if (!row) throw new BusinessRuleError('XML_NAO_ENCONTRADO');
    return row;
  }
}
