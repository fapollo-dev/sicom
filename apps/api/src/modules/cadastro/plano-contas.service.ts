import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * PLANO DE CONTAS (uCadPlanoContas) — cadastro em ÁRVORE. Módulo VERTICAL (não o engine flat) porque
 * precisa: derivar `nivel` do código, validar prefixo-do-pai / pai-sintética, e TRAVAS de exclusão
 * (filhos + movimento no DIÁRIO + uso em IIC/PLC/parceiros). Global por schema (sem coluna de empresa;
 * o db-per-tenant já isola). Contrato REST do CadMaster. Regras fiéis a uCadContaContabil.pas.
 */
@Injectable()
export class PlanoContasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  private static readonly PESQUISA = new Set(['codplanocontas', 'codiexpandido', 'codireduzido', 'descricao', 'classe']);

  async list(query: Record<string, string | undefined>): Promise<Record<string, unknown>[]> {
    let q = (this.dbp.forTenantRead() as AnyDB).selectFrom('get_plano_contas').selectAll();
    // situação (rdgAtivo): ativas (status<>'I') / inativas / todas.
    if (query.situacao === 'inativos') q = q.where('status', '=', 'I');
    else if (query.situacao !== 'todos') q = q.where(sql`coalesce(status,'A')`, '<>', 'I');
    const campo = query.campo;
    if (campo && PlanoContasService.PESQUISA.has(campo) && query.valor != null && query.valor !== '') {
      const col = sql.ref(campo);
      const v = query.valor;
      switch (query.operador ?? 'contem') {
        case 'igual': q = q.where(col as any, '=', v); break;
        case 'comeca': q = q.where(sql`upper(${col})`, 'like', `${v.toUpperCase()}%`); break;
        default: q = q.where(sql`upper(${col})`, 'like', `%${v.toUpperCase()}%`); break;
      }
    }
    // ordena pela máscara (a árvore é montada no front por codpai) — teto alto (árvore precisa do conjunto).
    return q.orderBy('codiexpandido', 'asc').limit(Math.min(Number(query.limite) || 2000, 5000)).execute();
  }

  async read(id: number): Promise<Record<string, unknown> | undefined> {
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('get_plano_contas').selectAll().where('codplanocontas', '=', id).executeTakeFirst();
  }

  /** nível derivado da máscara: nº de segmentos separados por ponto (1.1.03.01.0002 → 5). */
  private nivelDe(cod: string): number {
    return String(cod).split('.').filter((s) => s !== '').length;
  }

  /** larguras por nível da máscara (config_plano_contas.mascara CSV → [1,1,2,2,4]); [] se não configurada. */
  private async segmentos(tipo = 'E'): Promise<number[]> {
    const row = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('config_plano_contas').select('mascara').where('tipo', '=', tipo).executeTakeFirst()) as { mascara?: string } | undefined;
    if (!row?.mascara) return [];
    return String(row.mascara).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
  }

  /** máscara do plano (larguras por nível + padrão de exibição '9.9.99.99.9999') — corte-2 (uCadConfPlanoContas). */
  async mascara(tipo = 'E'): Promise<{ tipo: string; segmentos: number[]; mascara: string }> {
    const segs = await this.segmentos(tipo);
    return { tipo, segmentos: segs, mascara: segs.map((w) => '9'.repeat(w)).join('.') };
  }

  /** as 8 colunas de conta-default (For/Cli/Cxa/Bco × sintética/analítica) do config_plano_contas. */
  private static readonly CONTAS_DEFAULT = [
    'codcontasintetica_for', 'codcontaanalitica_for', 'codcontasintetica_cli', 'codcontaanalitica_cli',
    'codcontasintetica_cxa', 'codcontaanalitica_cxa', 'codcontasintetica_bco', 'codcontaanalitica_bco',
  ] as const;

  /**
   * CONTAS DEFAULT (uCadConfPlanoContas, T1.4): as contas contábeis padrão For/Cli/Cxa/Bco que o parceiro SEM
   * conta própria herda no lançamento (via resolverContaContabilParceiro). Devolve os apontadores + `detalhes`
   * (codiexpandido/descrição/classe de cada conta referenciada, p/ exibição).
   */
  async configContasDefault(tipo = 'E'): Promise<{ tipo: string; contas: Record<string, unknown>; detalhes: Record<string, unknown> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const row = (await db
      .selectFrom('config_plano_contas')
      .select([...PlanoContasService.CONTAS_DEFAULT])
      .where('tipo', '=', tipo)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    const contas: Record<string, unknown> = {};
    for (const c of PlanoContasService.CONTAS_DEFAULT) contas[c] = row?.[c] ?? null;
    const ids = [...new Set(Object.values(contas).filter((v): v is number => v != null).map(Number))];
    const detalhes: Record<string, unknown> = {};
    if (ids.length) {
      const rows = (await db
        .selectFrom('plano_contas').select(['codplanocontas', 'codiexpandido', 'descricao', 'classe'])
        .where('codplanocontas', 'in', ids).execute()) as Array<Record<string, unknown>>;
      for (const r of rows) detalhes[String(r.codplanocontas)] = { codiexpandido: r.codiexpandido, descricao: r.descricao, classe: r.classe };
    }
    return { tipo, contas, detalhes };
  }

  /**
   * Grava as contas-default (parcial: só os campos presentes; null limpa). Valida que cada conta informada
   * EXISTE e tem a classe certa — ANALÍTICA ('A', recebe lançamento) p/ codcontaanalitica_*, SINTÉTICA ('T')
   * p/ codcontasintetica_*. Fiel ao uCadConfPlanoContas (valida a conta antes de salvar).
   */
  async atualizarContasDefault(dto: Record<string, number | null | undefined>, tipo = 'E'): Promise<{ tipo: string; contas: Record<string, unknown>; detalhes: Record<string, unknown> }> {
    const db = this.dbp.forTenant() as AnyDB;
    await db.transaction().execute(async (trx: AnyDB) => {
      const set: Record<string, unknown> = {};
      for (const campo of PlanoContasService.CONTAS_DEFAULT) {
        if (!(campo in dto)) continue; // ausente → não toca
        const id = dto[campo];
        if (id == null) { set[campo] = null; continue; } // null → limpa (permitido em qualquer coluna)
        // DIVERGÊNCIA CONSCIENTE: a conta SINTÉTICA default (uTron "mode b": cria conta-filha individualizada
        // por parceiro sob a sintética, e vence a analítica) NÃO é suportada — o resolver-fallback usa só a
        // ANALÍTICA catch-all. Rejeita setar sintética p/ não gravar um config que o lançamento ignoraria
        // silenciosamente (auditoria [MÉDIA]). Isto também torna o both-set (XOR do legado) impossível.
        if (campo.startsWith('codcontasintetica')) {
          throw new BusinessRuleError('CONTA_SINTETICA_DEFAULT_NAO_SUPORTADA', { campo, id });
        }
        const conta = (await trx
          .selectFrom('plano_contas').select(['codplanocontas', 'classe'])
          .where('codplanocontas', '=', id).executeTakeFirst()) as { classe?: string } | undefined;
        if (!conta) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { campo, id });
        if ((conta.classe ?? '') !== 'A') throw new BusinessRuleError('CONTA_DEFAULT_NAO_ANALITICA', { campo, id, classe: conta.classe });
        set[campo] = id;
      }
      if (Object.keys(set).length) await trx.updateTable('config_plano_contas').set(set).where('tipo', '=', tipo).execute();
    });
    return this.configContasDefault(tipo);
  }

  /**
   * PRÓXIMO CÓDIGO sugerido (uDMCadPlanoContas.CodigoMaximoDeConta / BuscaProximoCodigoContaRaiz): o próximo
   * IRMÃO (max do último segmento + 1, zero-preenchido à largura do nível pela máscara). Sob um pai sintético;
   * sem pai → próxima conta RAIZ. Sugestão (o código fica editável); não filtra por TIPO (o tenant é 1 plano).
   *
   * FOLD consciente (não-paridade byte-a-byte, melhor que o legado): o legado só considera os irmãos cuja
   * ÚLTIMA casa cai em 0000–0009 (o SUBSTR do prefixo casa só (NDIG-1) zeros), então após 10 filhos ele
   * repete 0010 e sugere um código DUPLICADO (que o UNIQUE rejeita). Aqui é o MAX de TODOS os irmãos + 1 →
   * nunca sugere duplicado. O nível vem do CÓDIGO do pai (nivelDe), não da coluna `nivel` (evita drift).
   */
  async proximoCodigo(codpai?: number | null, tipo = 'E'): Promise<{ codiexpandido: string; nivel: number; codpai: number | null }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const segs = await this.segmentos(tipo);
    if (codpai == null) {
      const roots = await db.selectFrom('plano_contas').select('codiexpandido').where('codpai', 'is', null).execute();
      let max = 0;
      for (const r of roots as any[]) { const n = parseInt(String(r.codiexpandido), 10); if (Number.isFinite(n)) max = Math.max(max, n); }
      const width = segs[0] ?? 0;
      return { codiexpandido: String(max + 1).padStart(width, '0'), nivel: 1, codpai: null };
    }
    const pai = (await db.selectFrom('plano_contas').select(['codiexpandido', 'classe', 'nivel']).where('codplanocontas', '=', codpai).executeTakeFirst()) as any;
    if (!pai) throw new BusinessRuleError('CONTA_PAI_INEXISTENTE', { codpai });
    if (pai.classe !== 'T') throw new BusinessRuleError('CONTA_PAI_ANALITICA', { codpai });
    const childNivel = this.nivelDe(String(pai.codiexpandido)) + 1; // largura vem do CÓDIGO do pai (não do `nivel` gravado)
    const width = segs[childNivel - 1] ?? 0; // fora da máscara → sem preenchimento (só o número)
    const filhos = await db.selectFrom('plano_contas').select('codiexpandido').where('codpai', '=', codpai).execute();
    let maxSeg = 0;
    for (const f of filhos as any[]) {
      const last = String(f.codiexpandido).split('.').pop() ?? '';
      const n = parseInt(last, 10);
      if (Number.isFinite(n)) maxSeg = Math.max(maxSeg, n);
    }
    const seg = String(maxSeg + 1).padStart(width, '0');
    return { codiexpandido: `${pai.codiexpandido}.${seg}`, nivel: childNivel, codpai };
  }

  /** valida pai (deve existir, ser sintética, e o código ter o prefixo do pai) — uCadContaContabil:511/262. */
  private async validarPai(trx: AnyDB, codiexpandido: string, codpai: number | null | undefined) {
    if (codpai == null) return; // conta raiz
    const pai = await trx
      .selectFrom('plano_contas').select(['codplanocontas', 'codiexpandido', 'classe'])
      .where('codplanocontas', '=', codpai).executeTakeFirst();
    if (!pai) throw new BusinessRuleError('CONTA_PAI_INEXISTENTE', { codpai });
    if (pai.classe !== 'T') throw new BusinessRuleError('CONTA_PAI_ANALITICA', { codpai }); // não inserir filha em analítica
    if (pai.codiexpandido && !String(codiexpandido).startsWith(String(pai.codiexpandido) + '.'))
      throw new BusinessRuleError('CONTA_PREFIXO_INVALIDO', { codiexpandido, pai: pai.codiexpandido });
  }

  private async codigoDuplicado(trx: AnyDB, codiexpandido: string, exceto?: number): Promise<boolean> {
    let q = trx.selectFrom('plano_contas').select('codplanocontas').where('codiexpandido', '=', codiexpandido);
    if (exceto != null) q = q.where('codplanocontas', '<>', exceto);
    return !!(await q.executeTakeFirst());
  }

  private async reduzidoDuplicado(trx: AnyDB, codireduzido: string, exceto?: number): Promise<boolean> {
    let q = trx.selectFrom('plano_contas').select('codplanocontas').where('codireduzido', '=', codireduzido);
    if (exceto != null) q = q.where('codplanocontas', '<>', exceto);
    return !!(await q.executeTakeFirst());
  }

  private async contaTemMovimento(trx: AnyDB, id: number): Promise<boolean> {
    const mov = await trx.selectFrom('diario').select('coddiario')
      .where((eb: any) => eb.or([eb('contadebito', '=', id), eb('contacredito', '=', id)])).executeTakeFirst();
    return !!mov;
  }

  /** rejeita CICLO: sobe a cadeia de ancestrais de `novoPai`; se `id` aparecer, novoPai é descendente de id. */
  private async garantirSemCiclo(trx: AnyDB, id: number, novoPai: number | null) {
    let anc: number | null = novoPai;
    const visto = new Set<number>();
    while (anc != null && !visto.has(anc)) {
      if (anc === id) throw new BusinessRuleError('CONTA_PAI_INVALIDO', { codpai: novoPai });
      visto.add(anc);
      const row = await trx.selectFrom('plano_contas').select('codpai').where('codplanocontas', '=', anc).executeTakeFirst();
      anc = row?.codpai != null ? Number(row.codpai) : null;
    }
  }

  async criar(dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const op = this.op();
    const codiexpandido = String(dto.codiexpandido);
    const codpai = dto.codpai != null ? Number(dto.codpai) : null;
    const id = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      if (await this.codigoDuplicado(trx, codiexpandido)) throw new BusinessRuleError('CONTA_CODIGO_DUPLICADO', { codiexpandido });
      if (dto.codireduzido != null && (await this.reduzidoDuplicado(trx, String(dto.codireduzido))))
        throw new BusinessRuleError('CONTA_REDUZIDO_DUPLICADO', { codireduzido: dto.codireduzido });
      await this.validarPai(trx, codiexpandido, codpai);
      const ins = await trx
        .insertInto('plano_contas')
        .values({
          codiexpandido,
          codireduzido: (dto.codireduzido as string) ?? null,
          descricao: dto.descricao,
          classe: dto.classe, // 'A'/'T'
          natureza: dto.natureza,
          nivel: this.nivelDe(codiexpandido),
          codpai,
          tipo: 'E',
          status: 'A',
          integrado: 'N',
          usultalteracao: op,
          dtultimalteracao: sql`now()`,
          dtcadastro: sql`now()`,
        })
        .returning('codplanocontas')
        .executeTakeFirstOrThrow();
      const novoId = Number((ins as Record<string, unknown>).codplanocontas);
      // codireduzido default = a própria PK (uCadContaContabil:210).
      if (dto.codireduzido == null)
        await trx.updateTable('plano_contas').set({ codireduzido: String(novoId) }).where('codplanocontas', '=', novoId).execute();
      return novoId;
    });
    return this.read(id);
  }

  async atualizar(id: number, dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const op = this.op();
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const atual = await trx
        .selectFrom('plano_contas').select(['codplanocontas', 'codiexpandido', 'classe', 'codpai'])
        .where('codplanocontas', '=', id).forUpdate().executeTakeFirst();
      if (!atual) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codplanocontas: id });
      const d: Record<string, unknown> = {};
      const set = (k: string) => { if (dto[k] !== undefined) d[k] = dto[k]; };
      ['descricao', 'natureza', 'codireduzido', 'classe'].forEach(set);
      const novoCod = dto.codiexpandido !== undefined ? String(dto.codiexpandido) : String(atual.codiexpandido);
      const novoPai = dto.codpai !== undefined ? (dto.codpai != null ? Number(dto.codpai) : null) : (atual.codpai as number | null);
      if (dto.codireduzido != null && (await this.reduzidoDuplicado(trx, String(dto.codireduzido), id)))
        throw new BusinessRuleError('CONTA_REDUZIDO_DUPLICADO', { codireduzido: dto.codireduzido });
      // se mudou código ou pai, revalida (único + pai sintética + prefixo + SEM CICLO) e recalcula nível.
      if (dto.codiexpandido !== undefined || dto.codpai !== undefined) {
        await this.garantirSemCiclo(trx, id, novoPai); // pai==si OU pai==descendente → CONTA_PAI_INVALIDO
        if (await this.codigoDuplicado(trx, novoCod, id)) throw new BusinessRuleError('CONTA_CODIGO_DUPLICADO', { codiexpandido: novoCod });
        await this.validarPai(trx, novoCod, novoPai);
        d.codiexpandido = novoCod;
        d.codpai = novoPai;
        d.nivel = this.nivelDe(novoCod);
      }
      // tornar sintética→analítica com filhos é incoerente (analítica não tem filhos).
      if (dto.classe === 'A' && atual.classe === 'T') {
        const temFilho = await trx.selectFrom('plano_contas').select('codplanocontas').where('codpai', '=', id).executeTakeFirst();
        if (temFilho) throw new BusinessRuleError('CONTA_COM_FILHOS');
      }
      // tornar analítica→sintética uma conta COM MOVIMENTO é incoerente (sintética não recebe lançamento).
      if (dto.classe === 'T' && atual.classe === 'A' && (await this.contaTemMovimento(trx, id)))
        throw new BusinessRuleError('CONTA_COM_MOVIMENTO');
      if (Object.keys(d).length) {
        await trx.updateTable('plano_contas')
          .set({ ...d, usultalteracao: op, dtultimalteracao: sql`now()` })
          .where('codplanocontas', '=', id).execute();
      }
    });
    return this.read(id);
  }

  async excluir(id: number): Promise<void> {
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await trx.selectFrom('plano_contas').select('codplanocontas').where('codplanocontas', '=', id).forUpdate().executeTakeFirst();
      if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codplanocontas: id });
      // TRAVAS de exclusão (uCadPlanoContas ValidaExclusao :211-375): não apagar com filhos ou em uso.
      const filho = await trx.selectFrom('plano_contas').select('codplanocontas').where('codpai', '=', id).executeTakeFirst();
      if (filho) throw new BusinessRuleError('CONTA_COM_FILHOS');
      if (await this.contaTemMovimento(trx, id)) throw new BusinessRuleError('CONTA_COM_MOVIMENTO');
      // travas de USO (uCadPlanoContas ValidaExclusao). SEM .catch — uma trava de exclusão TEM de
      // falhar-fechado (um erro de query não pode virar "sem lock → exclui").
      const iic = await trx.selectFrom('itens_integracao_contabil').select('coditemoperacao').where('codconta_contabil', '=', id).executeTakeFirst();
      if (iic) throw new BusinessRuleError('CONTA_EM_USO');
      const plc = await trx.selectFrom('plc').select('codplc').where('codcontabil', '=', id).executeTakeFirst(); // plc.codcontabil é integer
      if (plc) throw new BusinessRuleError('CONTA_EM_USO');
      // parceiros.codcontabil/_for são VARCHAR — comparar como texto (coerção explícita), senão a query lança.
      const parc = await trx.selectFrom('parceiros').select('codparceiro')
        .where((eb: any) => eb.or([eb('codcontabil', '=', String(id)), eb('codcontabil_for', '=', String(id))])).executeTakeFirst();
      if (parc) throw new BusinessRuleError('CONTA_EM_USO');
      // trava ValidaExclusao #4 (uDMCadPlanoContas): conta usada como DEFAULT no CONFIG_PLANO_CONTAS. No modelo
      // LAZY (T1.4) a única referência da conta catch-all vive aqui — sem esta trava, excluí-la deixaria o
      // config apontando p/ conta inexistente e o próximo lançamento-fallback estouraria a FK do diário.
      const cfg = await trx.selectFrom('config_plano_contas').select('tipo')
        .where((eb: any) => eb.or([
          eb('codcontaanalitica_for', '=', id), eb('codcontasintetica_for', '=', id),
          eb('codcontaanalitica_cli', '=', id), eb('codcontasintetica_cli', '=', id),
          eb('codcontaanalitica_cxa', '=', id), eb('codcontasintetica_cxa', '=', id),
          eb('codcontaanalitica_bco', '=', id), eb('codcontasintetica_bco', '=', id),
        ])).executeTakeFirst();
      if (cfg) throw new BusinessRuleError('CONTA_EM_USO');
      await trx.deleteFrom('plano_contas').where('codplanocontas', '=', id).execute();
    });
  }

  /** inativar (status='I') — alternativa segura à exclusão de conta com histórico (uCadContaContabil status). */
  async inativar(id: number, status: 'A' | 'I'): Promise<Record<string, unknown> | undefined> {
    const op = this.op();
    const r = await (this.dbp.forTenant() as AnyDB)
      .updateTable('plano_contas').set({ status, usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codplanocontas', '=', id).executeTakeFirst();
    if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codplanocontas: id });
    return this.read(id);
  }
}
