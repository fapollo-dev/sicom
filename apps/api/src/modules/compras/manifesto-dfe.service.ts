import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { RecebimentoService } from './recebimento.service';
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
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly recebimento: RecebimentoService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: FiltroManifesto) {
    const emp = this.emp();
    await this.reconciliar(emp);
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

  /**
   * RECONCILIAÇÃO do flag NFE_IMPORTADA_SISTEMA com a existência da NF (os dois UPDATEs do legado,
   * UManifestoDFe.pas:446-464): 'S' quando existe NF com a chave na empresa, e DE VOLTA a 'N' quando a NF
   * foi excluída — "voltam para o manifesto", sem apagar a linha da fila. Roda a cada listagem, como lá.
   */
  private async reconciliar(emp: number) {
    const db = this.dbp.forTenant() as AnyDB;
    await sql`update nfe_nao_cadastradas set nfe_importada_sistema = 'S'
      where chavenfe in (select nf.chavenfe from nf where nf.idempresa = ${emp} and nf.chavenfe is not null)
        and idempresa = ${emp} and coalesce(nfe_importada_sistema,'N') = 'N'`.execute(db);
    await sql`update nfe_nao_cadastradas set nfe_importada_sistema = 'N'
      where chavenfe not in (select nf.chavenfe from nf where nf.idempresa = ${emp} and nf.chavenfe is not null)
        and idempresa = ${emp} and coalesce(nfe_importada_sistema,'N') = 'S'`.execute(db);
  }

  /**
   * IMPORTAR a NF-e da fila para o sistema — a ponte para o import de XML já existente (mig 062).
   * Regras do legado (ImportarNFEParaSistema):
   *  · exige a CONFIRMAÇÃO DA OPERAÇÃO (evento 210200 na chave) antes de importar — "Realize a confirmação
   *    da operação para importar a NF-e" (o ramo de contingência do legado alerta e permite; a fila da
   *    distribuição não carrega tipoemissao, então aqui vale a regra principal);
   *  · sem XML completo → orientar a aguardar a liberação da SEFAZ (ou sincronizar);
   *  · se JÁ EXISTE NF com a chave na empresa → não duplica: devolve o vínculo (a tela oferece visualizar)
   *    e reconcilia o flag.
   */
  async importar(cod: number) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const fila = await db.selectFrom('nfe_nao_cadastradas').selectAll()
      .where('codnfe_naocad', '=', cod).where('idempresa', '=', emp).executeTakeFirst();
    if (!fila) throw new BusinessRuleError('NFE_NAO_ENCONTRADA');
    const chave = String(fila.chavenfe);
    // já existe NF com a chave? (o legado oferece visualizar em vez de duplicar)
    const nfExistente = await db.selectFrom('nf').select(['codnf'])
      .where('idempresa', '=', emp).where('chavenfe', '=', chave).executeTakeFirst();
    if (nfExistente) {
      await db.updateTable('nfe_nao_cadastradas').set({ nfe_importada_sistema: 'S' })
        .where('codnfe_naocad', '=', cod).execute();
      return { ja_importada: true, codnf: nfExistente.codnf };
    }
    // a regra central: só importa quem CONFIRMOU a operação (210200)
    const conf = await db.selectFrom('nfe_eventos').select('codnfe_evento')
      .where('chave_acesso', '=', chave).where('tipo_evento', '=', 210200).executeTakeFirst();
    if (!conf) {
      throw new BusinessRuleError('CONFIRMACAO_NECESSARIA', {
        instrucao: 'Realize a confirmação da operação (manifestação 210200) para importar a NF-e.',
      });
    }
    const x = await db.selectFrom('nfe_xml').select(['xml'])
      .where('chavenfe', '=', chave).orderBy(sql`codnfexml desc`).executeTakeFirst();
    if (!x?.xml) {
      throw new BusinessRuleError('XML_NAO_DISPONIVEL', {
        instrucao: 'O download desta NF-e ainda não foi liberado pela SEFAZ. Sincronize novamente ou aguarde a liberação.',
      });
    }
    // entrega ao import existente (o mesmo caminho do XML do fornecedor)
    const r = await this.recebimento.importarXml({ xml: String(x.xml) });
    // vínculo de volta na fila (o legado reconcilia pelo par de UPDATEs; aqui marcamos direto também)
    await db.updateTable('nfe_nao_cadastradas')
      .set({ nfe_importada_sistema: 'S', nronf: String((r as Record<string, unknown>).nronf ?? '').slice(0, 9) || null })
      .where('codnfe_naocad', '=', cod).execute();
    return { ja_importada: false, ...r };
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
