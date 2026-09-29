import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { RecebimentoService } from './recebimento.service';
import { SefazDfeService, EVENTOS_MANIFESTO } from './sefaz-dfe.service';
import { ConfigService } from '../cadastro/config.service';
import { hojeNaLoja } from '../../shared/tempo/hoje';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export interface FiltroManifesto {
  dtini?: string; dtfim?: string;
  fornecedor?: string; chave?: string;
  /** CNPJ do emitente (o EdtCNPJFornecedor do legado: `CNPJ_CPF = '…'`) */
  cnpj?: string;
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
    private readonly sefaz: SefazDfeService,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * A GRADE (PesquisarNotasFiscais / "Pesquisar últimas", UManifestoDFe.pas:355): `SELECT * FROM GET_NF_MANIFESTO` da loja —
   * as NF com chave (entrada e saída, cadastradas: processada, status, esteira, obs) MAIS a fila das não cadastradas, dentro
   * da janela de DIAS_RETROATIVOS_FILTRO_MANIFESTO (90) —, ordenada por emissão (mais nova) e razão. Em produção 93% das
   * linhas da loja 1 nos últimos 90 dias são NF já cadastradas (1.316 de 1.408). Filtros do legado: CNPJ do emitente e o
   * FINAL da chave (`CHAVE LIKE '%…'`); a pesquisa avançada acrescenta razão e período. As linhas da fila trazem o
   * `ignorar` e a existência do XML (colunas do Apollo sobre a mesma chave).
   */
  async listar(f: FiltroManifesto) {
    const emp = this.emp();
    await this.reconciliar(emp);
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      SELECT v.numero_nf, v.data_emissao, v.total_nf, v.chave, v.cadastrada, v.codigo, v.cnpj_cpf, v.razao, v.importacao, v.processada, v.tipo,
             v.confirmacao, v.ciencia, v.naorealizada, v.desconhecimento, v.cancelamento, v.outros_eventos, v.status_nfe, v.obs_nf,
             v.processo_atual, v.contingencia, v.cfop, v.serie, v.vincula_ent_dev, v.cod_vincula_ent_dev, v.data_contabil,
             CASE WHEN v.cadastrada = 'NAO' THEN coalesce(q.ignorar_manifesto, 'N') ELSE 'N' END AS ignorada,
             q.ignorar_manifesto_motivo,
             EXISTS (SELECT 1 FROM nfe_xml x WHERE x.chavenfe = v.chave) AS tem_xml
        FROM get_nf_manifesto v
        LEFT JOIN nfe_nao_cadastradas q ON v.cadastrada = 'NAO' AND q.codnfe_naocad = v.codigo
       WHERE v.idempresa = ${emp}
         ${f.dtini ? sql`AND v.data_emissao::date >= ${f.dtini}::date` : sql``}
         ${f.dtfim ? sql`AND v.data_emissao::date <= ${f.dtfim}::date` : sql``}
         ${f.cnpj?.trim() ? sql`AND v.cnpj_cpf = ${f.cnpj.trim()}` : sql``}
         ${f.chave?.trim() ? sql`AND v.chave LIKE ${`%${f.chave.trim()}`}` : sql``}
         ${f.fornecedor?.trim() ? sql`AND upper(v.razao) LIKE ${`%${f.fornecedor.trim().toUpperCase()}%`}` : sql``}
         ${f.canceladas === 'CANCELADAS' ? sql`AND v.cancelamento = 'SIM'` : f.canceladas === 'NAO_CANCELADAS' ? sql`AND v.cancelamento = 'NAO'` : sql``}
         ${f.pendentes ? sql`AND v.cadastrada = 'NAO' AND coalesce(q.ignorar_manifesto, 'N') = 'N'` : sql``}
       ORDER BY v.data_emissao DESC, v.razao, v.chave
       LIMIT 5001`.execute(db)).rows;
    // o LEFT JOIN da view com NFE_REF_DEV_ENT_VINCULO repete a nota que tem dois vínculos de devolução — uma linha só, com as
    // chaves vinculadas juntas (a grade mostra a nota uma vez)
    const unicas = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const k = `${String(r.cadastrada)}|${String(r.codigo)}|${String(r.chave)}`;
      const ja = unicas.get(k);
      if (!ja) { unicas.set(k, { ...r }); continue; }
      if (r.cod_vincula_ent_dev && !String(ja.cod_vincula_ent_dev ?? '').split(', ').includes(String(r.cod_vincula_ent_dev))) {
        ja.cod_vincula_ent_dev = ja.cod_vincula_ent_dev ? `${String(ja.cod_vincula_ent_dev)}, ${String(r.cod_vincula_ent_dev)}` : r.cod_vincula_ent_dev;
      }
    }
    const todas = [...unicas.values()];
    const truncado = todas.length > 5000;
    const linhas = truncado ? todas.slice(0, 5000) : todas;
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        pendentes: linhas.filter((l) => l.cadastrada === 'NAO' && l.ignorada !== 'S').length,
        canceladas: linhas.filter((l) => l.cancelamento === 'SIM').length,
        total: Math.round(linhas.reduce((s, l) => s + num(l.total_nf), 0) * 100) / 100,
      },
      filtro: { ...f, empresa: emp, truncado, max_linhas: 5000 },
    };
  }

  /**
   * A MANIFESTAÇÃO DAS NOTAS MARCADAS (ManifestacaoDestinatario, UManifestoDFe.pas:2087): um evento para cada chave marcada
   * (SELECAO='S'); a nota emitida há mais de 90 dias fica de fora com o aviso do legado; o retorno de cada uma vai para a
   * aba LOG ('A' = enviada, 'E' = erro). A operação não realizada leva UMA justificativa para todas. Com uma única nota,
   * confirmação e ABRIR_NF_APOS_MANIFESTO_CONFIRM='S', a nota já é importada em seguida (fChaveParaImportacao). Erro de
   * configuração (certificado) interrompe o lote — é o mesmo para todas.
   */
  async manifestarLote(chaves: string[], evento: keyof typeof EVENTOS_MANIFESTO, justificativa?: string) {
    const emp = this.emp();
    const lista = Array.from(new Set(chaves.map((c) => String(c ?? '').replace(/\D/g, '')).filter((c) => c.length === 44)));
    if (!lista.length) throw new BusinessRuleError('MANIFESTO_SEM_SELECAO', {}, 'Selecione pelo menos uma nota fiscal para realizar a manifestação.');
    const db = this.dbp.forTenantRead() as AnyDB;
    const emissao = new Map<string, string>();
    for (const r of (await sql<{ chave: string; d: string }>`
      SELECT chavenfe AS chave, min(to_char(dtemissao, 'YYYY-MM-DD')) AS d FROM (
        SELECT chavenfe, dtemissao::date AS dtemissao FROM nfe_nao_cadastradas WHERE idempresa = ${emp} AND chavenfe = ANY(${lista}::text[])
        UNION ALL SELECT chavenfe, dtemissao FROM nf WHERE idempresa = ${emp} AND chavenfe = ANY(${lista}::text[])) t
       GROUP BY chavenfe`.execute(db)).rows) emissao.set(r.chave, r.d);
    const hoje = hojeNaLoja();
    const dias = (d: string) => Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000);
    const log: Array<{ tipo: 'A' | 'E'; chave: string; descricao: string }> = [];
    let enviadas = 0;
    for (const ch of lista) {
      const d = emissao.get(ch);
      if (d && dias(d) > 90) {
        log.push({ tipo: 'E', chave: ch, descricao: 'Não é possível enviar manifestação de destinário para notas enviadas há mais de 90 dias!' });
        continue;
      }
      try {
        const r = await this.sefaz.manifestar(ch, evento, justificativa) as Record<string, unknown>;
        enviadas++;
        log.push({ tipo: 'A', chave: ch, descricao: `Evento enviado com sucesso. Manifestação realizada.${r?.protocolo ? ` Protocolo ${String(r.protocolo)}.` : ''}` });
      } catch (e) {
        const code = String((e as { code?: string }).code ?? '');
        if (code.startsWith('CERTIFICADO') || code === 'JUSTIFICATIVA_OBRIGATORIA' || code === 'EVENTO_INVALIDO') throw e;
        const det = (e as { details?: Record<string, unknown> }).details ?? {};
        log.push({ tipo: 'E', chave: ch, descricao: det.cStat ? `Rejeição ${String(det.cStat)}: ${String(det.xMotivo ?? '')}`.trim() : (e as Error).message || code || 'Erro ao enviar a manifestação.' });
      }
    }
    let importacao: Record<string, unknown> | null = null;
    if (lista.length === 1 && evento === 'CONFIRMACAO' && enviadas === 1
      && String((await this.config.resolver('ABRIR_NF_APOS_MANIFESTO_CONFIRM', { empresaId: emp })) ?? 'N').toUpperCase() === 'S') {
      const fila = (await sql<{ cod: number }>`SELECT codnfe_naocad AS cod FROM nfe_nao_cadastradas WHERE idempresa = ${emp} AND chavenfe = ${lista[0]}
                                                 AND coalesce(nfe_importada_sistema, 'N') = 'N' ORDER BY codnfe_naocad LIMIT 1`.execute(db)).rows[0];
      if (fila) {
        try { importacao = await this.importar(Number(fila.cod)) as Record<string, unknown>; }
        catch (e) { log.push({ tipo: 'E', chave: lista[0], descricao: `Importação: ${(e as Error).message}` }); }
      }
    }
    return { enviadas, log, importacao };
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
   *    da operação para importar a NF-e" —, menos na contingência (IMPORTACAO_MANUAL='S'), que importa com o alerta do
   *    legado (auditoria g1: 3 das 115 importações sem 210200 de 2025-26; as outras 112 são eventos não gravados);
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
    // a regra central: só importa quem CONFIRMOU a operação (210200) — exceto a nota em CONTINGÊNCIA, que o legado importa
    // com alerta (UManifestoDFe.pas:1800-1804). Na fila do manifesto a contingência é `IMPORTACAO_MANUAL='S'`
    // (GET_NF_MANIFESTO: `CASE WHEN COALESCE(IMPORTACAO_MANUAL,'N')='S' THEN 'SIM'`; 1.158 linhas em produção)
    const contingencia = String((fila as Record<string, unknown>).importacao_manual ?? 'N') === 'S';
    let aviso: string | null = null;
    if (contingencia) {
      aviso = 'Nota fiscal classificada como enviada em ambiente de contingência. A importação será permitida mas será necessário o envio das manifestações no futuro.';
    } else {
      const conf = await db.selectFrom('nfe_eventos').select('codnfe_evento')
        .where('chave_acesso', '=', chave).where('tipo_evento', '=', 210200).executeTakeFirst();
      if (!conf) {
        throw new BusinessRuleError('CONFIRMACAO_NECESSARIA', {
          instrucao: 'Realize a confirmação da operação (manifestação 210200) para importar a NF-e.',
        });
      }
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
    return { ja_importada: false, ...r, aviso };
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
