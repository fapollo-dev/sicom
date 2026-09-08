import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

export interface Fonte { fonte: string; rotulo: string }
export interface CampoFonte { campo: string; tipo: 'texto' | 'numero' | 'data' | 'booleano'; formato: 'texto' | 'moeda' | 'data' | 'numero' }

export interface ColunaDef {
  campo?: string;
  calculado?: { campo1: string; operacao: '+' | '-' | '*' | '/'; campo2: string };
  titulo?: string;
  largura?: number;
  posicao?: number;
  totalizar?: boolean;
  formato?: 'texto' | 'moeda' | 'data' | 'numero';
}
export interface CondicaoDef { campo: string; operador: string; valor?: unknown }
export interface OrdemDef { campo: string; direcao?: 'asc' | 'desc' }
export interface Definicao {
  titulo?: string;
  paisagem?: boolean;
  agruparPor?: string;
  somenteAgrupamento?: boolean;
  quebraPagina?: boolean;
  colunas: ColunaDef[];
  condicoes?: CondicaoDef[];
  ordem?: OrdemDef[];
}

/** os operadores que o legado oferece na condição (`cbbOperacaoCondicao`). */
const OPERADORES: Record<string, string> = {
  '=': '=', '<>': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=',
  'contem': 'ILIKE', 'comeca': 'ILIKE', 'entre': 'BETWEEN', 'vazio': 'IS NULL', 'preenchido': 'IS NOT NULL',
};

/**
 * CONSTRUTOR DE RELATÓRIOS (`FRMRELATORIO`, `uRelatorio.pas` 3.445 linhas) — corte-1: o CATÁLOGO e o EXECUTOR.
 * Dossiê: `uRelatorio-construtor.md`.
 *
 * A tela é a segunda de relatório mais usada do cliente (1.251 acessos, a última em 02/09/2026) e ele montou
 * **95 relatórios** com ela. O modelo do legado está certo e foi mantido campo a campo; o que muda é em volta.
 *
 * **O catálogo não é uma tabela — é o comentário da view.** No Oracle, `GET_CARTAOBX` tem
 * `COMMENT = ';CARTOES BAIXADOS'`, e é esse rótulo que a tela mostra e que fica gravado no campo `TABELA` de
 * cada definição. São 198 das 417 views que têm rótulo, e essas são as ofertadas. A mig 202 copiou os
 * rótulos do cliente para as 28 que já existem aqui, então o catálogo daqui sai do mesmo lugar: o banco.
 *
 * ⚠️ **um construtor de consulta é superfície de injeção.** Nada que vem da definição entra na SQL sem passar
 * pelo catálogo: a fonte tem de ser uma view com rótulo, e cada campo tem de existir NAQUELA view — os nomes
 * são conferidos contra o `information_schema` e citados com `sql.ref`; os valores viajam como parâmetro.
 */
@Injectable()
export class RelatorioConstrutorService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * As fontes do catálogo: as views cujo COMENTÁRIO carrega o rótulo. É a mesma regra do `SetaViews` do
   * legado — sem rótulo, a view não é ofertada.
   */
  async fontes(): Promise<Fonte[]> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.relname AS fonte, obj_description(c.oid, 'pg_class') AS rotulo
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'v' AND n.nspname = 'public'
         AND obj_description(c.oid, 'pg_class') IS NOT NULL
       ORDER BY 2
    `.execute(db)).rows;
    return rows.map((r) => ({ fonte: String(r.fonte), rotulo: String(r.rotulo) }));
  }

  /** os campos de uma fonte, com o formato sugerido — é o que o construtor lista para escolher. */
  async campos(fonte: string): Promise<CampoFonte[]> {
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.assertFonte(db, fonte);
    return this.camposDa(db, fonte);
  }

  private async camposDa(db: AnyDB, fonte: string): Promise<CampoFonte[]> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${fonte}
       ORDER BY ordinal_position
    `.execute(db)).rows;
    return rows.map((r) => {
      const dt = String(r.data_type);
      const tipo: CampoFonte['tipo'] = /int|numeric|double|real/.test(dt) ? 'numero'
        : /date|timestamp/.test(dt) ? 'data'
        : /bool/.test(dt) ? 'booleano' : 'texto';
      // moeda é um palpite pelo nome — o cliente troca no construtor, como troca o título.
      const nome = String(r.column_name);
      const formato: CampoFonte['formato'] = tipo === 'data' ? 'data'
        : tipo === 'numero' && /valor|total|preco|custo|saldo|vr|liquido/.test(nome) ? 'moeda'
        : tipo === 'numero' ? 'numero' : 'texto';
      return { campo: nome, tipo, formato };
    });
  }

  /** a fonte TEM de estar no catálogo — é o que impede um nome arbitrário de virar tabela na consulta. */
  private async assertFonte(db: AnyDB, fonte: string): Promise<void> {
    const ok = (await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'v' AND n.nspname = 'public' AND c.relname = ${fonte}
         AND obj_description(c.oid, 'pg_class') IS NOT NULL
    `.execute(db)).rows[0]?.n;
    if (!Number(ok)) throw new BusinessRuleError('FONTE_NAO_CATALOGADA', { fonte });
  }

  // ── as definições salvas ─────────────────────────────────────────────────────────────────────────────────

  async listar(): Promise<Array<{ codrelatoriodef: number; nome: string; fonte: string; rotulo: string | null; origem: string }>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      SELECT d.codrelatoriodef, d.nome, d.fonte, d.origem,
             obj_description(('public.' || d.fonte)::regclass, 'pg_class') AS rotulo
        FROM relatorio_definicao d
       WHERE d.idempresa = ${emp}
       ORDER BY upper(d.nome)
    `.execute(db)).rows;
    return rows.map((r) => ({
      codrelatoriodef: Number(r.codrelatoriodef), nome: String(r.nome), fonte: String(r.fonte),
      rotulo: r.rotulo == null ? null : String(r.rotulo), origem: String(r.origem),
    }));
  }

  async obter(cod: number): Promise<{ codrelatoriodef: number; nome: string; fonte: string; definicao: Definicao }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await db.selectFrom('relatorio_definicao').selectAll()
      .where('codrelatoriodef', '=', cod).where('idempresa', '=', emp).executeTakeFirst();
    if (!r) throw new BusinessRuleError('RELATORIO_NAO_ENCONTRADO', { cod });
    return { codrelatoriodef: cod, nome: String(r.nome), fonte: String(r.fonte), definicao: r.definicao as Definicao };
  }

  /** grava e guarda a versão anterior — é o histórico que o XML do legado não tem. */
  async salvar(dto: { codrelatoriodef?: number | null; nome: string; fonte: string; definicao: Definicao }): Promise<{ codrelatoriodef: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertFonte(db, dto.fonte);
    await this.validarDefinicao(db, dto.fonte, dto.definicao);

    return db.transaction().execute(async (trx: AnyDB) => {
      if (dto.codrelatoriodef) {
        const atual = await trx.selectFrom('relatorio_definicao').select(['definicao'])
          .where('codrelatoriodef', '=', dto.codrelatoriodef).where('idempresa', '=', emp).executeTakeFirst();
        if (!atual) throw new BusinessRuleError('RELATORIO_NAO_ENCONTRADO', { cod: dto.codrelatoriodef });
        await trx.insertInto('relatorio_definicao_hist')
          .values({ codrelatoriodef: dto.codrelatoriodef, definicao: atual.definicao, codoperador: op }).execute();
        await trx.updateTable('relatorio_definicao')
          .set({ nome: dto.nome, fonte: dto.fonte, definicao: JSON.stringify(dto.definicao), usultalteracao: op, dtultimalteracao: sql`now()` })
          .where('codrelatoriodef', '=', dto.codrelatoriodef).where('idempresa', '=', emp).execute();
        return { codrelatoriodef: dto.codrelatoriodef };
      }
      const novo = await trx.insertInto('relatorio_definicao')
        .values({ idempresa: emp, nome: dto.nome, fonte: dto.fonte, definicao: JSON.stringify(dto.definicao), origem: 'APOLLO', usucadastro: op })
        .returning('codrelatoriodef').executeTakeFirstOrThrow();
      return { codrelatoriodef: Number((novo as { codrelatoriodef: number }).codrelatoriodef) };
    });
  }

  async remover(cod: number): Promise<void> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const r = await db.deleteFrom('relatorio_definicao')
      .where('codrelatoriodef', '=', cod).where('idempresa', '=', emp).execute();
    if (!Number(r[0]?.numDeletedRows ?? 0)) throw new BusinessRuleError('RELATORIO_NAO_ENCONTRADO', { cod });
  }

  // ── o executor ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Roda o relatório. Devolve as colunas (com título e formato, como o cliente definiu), as linhas e os
   * totais das colunas marcadas para totalizar — que é o rodapé do relatório do legado.
   *
   * `filtros` são os do usuário na hora de rodar (o período, tipicamente) e somam-se às condições salvas.
   */
  async executar(p: { codrelatoriodef?: number | null; fonte?: string; definicao?: Definicao; filtros?: CondicaoDef[]; limite?: number }): Promise<{
    titulo: string; fonte: string; colunas: Array<{ chave: string; titulo: string; formato: string; largura?: number }>;
    linhas: Array<Record<string, unknown>>; totais: Record<string, number>; truncado: boolean;
  }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    let fonte = p.fonte ?? '';
    let def = p.definicao as Definicao | undefined;
    let titulo = def?.titulo ?? '';
    if (p.codrelatoriodef) {
      const r = await this.obter(p.codrelatoriodef);
      fonte = r.fonte; def = r.definicao; titulo = r.definicao?.titulo || r.nome;
    }
    if (!def || !Array.isArray(def.colunas) || !def.colunas.length) throw new BusinessRuleError('RELATORIO_SEM_COLUNAS');
    await this.assertFonte(db, fonte);
    const campos = await this.validarDefinicao(db, fonte, def, p.filtros);
    const tipoDe = new Map(campos.map((c) => [c.campo, c]));

    // 1) as colunas, na ordem que o cliente definiu (`POSICAO`).
    const cols = [...def.colunas].sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0));
    const selects = cols.map((c, i) => {
      const chave = `c${i}`;
      // a divisão protege o denominador com NULLIF (dividir por zero derrubaria o relatório inteiro); as
      // outras três operam direto sobre o COALESCE, que é como o legado soma campo nulo.
      const a = sql`coalesce(${sql.ref(c.calculado?.campo1 ?? '')}, 0)`;
      const b = c.calculado?.operacao === '/'
        ? sql`nullif(coalesce(${sql.ref(c.calculado.campo2)}, 0), 0)`
        : sql`coalesce(${sql.ref(c.calculado?.campo2 ?? '')}, 0)`;
      const expr = c.calculado
        ? sql`(${a} ${sql.raw(c.calculado.operacao)} ${b})`
        : sql`${sql.ref(c.campo as string)}`;
      return sql`${expr} AS ${sql.ref(chave)}`;
    });

    // 2) as condições salvas + os filtros de execução.
    const where = [...(def.condicoes ?? []), ...(p.filtros ?? [])].map((c) => this.condicao(c));

    // 3) a ordenação.
    const ordem = (def.ordem ?? []).map((o) => sql`${sql.ref(o.campo)} ${sql.raw(String(o.direcao).toLowerCase() === 'desc' ? 'DESC' : 'ASC')}`);

    const limite = Math.min(Math.max(Number(p.limite ?? 5000), 1), 20000);
    const linhas = (await sql<Record<string, unknown>>`
      SELECT ${sql.join(selects, sql`, `)}
        FROM ${sql.table(fonte)}
       ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
       ${ordem.length ? sql`ORDER BY ${sql.join(ordem, sql`, `)}` : sql``}
       LIMIT ${limite + 1}
    `.execute(db)).rows;
    const truncado = linhas.length > limite;
    if (truncado) linhas.length = limite;

    // 4) os totais do rodapé — somados sobre o que foi lido, que é o que o relatório mostra.
    const totais: Record<string, number> = {};
    cols.forEach((c, i) => {
      if (!c.totalizar) return;
      const chave = `c${i}`;
      totais[chave] = Math.round(linhas.reduce((s, l) => s + Number(l[chave] ?? 0), 0) * 100) / 100;
    });

    return {
      titulo: titulo || fonte,
      fonte,
      colunas: cols.map((c, i) => ({
        chave: `c${i}`,
        titulo: c.titulo || c.campo || 'Calculado',
        formato: c.formato ?? (c.calculado ? 'numero' : tipoDe.get(c.campo as string)?.formato ?? 'texto'),
        largura: c.largura,
      })),
      linhas, totais, truncado,
    };
  }

  /** uma condição vira SQL com o VALOR sempre parametrizado. */
  private condicao(c: CondicaoDef) {
    const op = OPERADORES[String(c.operador)];
    if (!op) throw new BusinessRuleError('OPERADOR_INVALIDO', { operador: c.operador });
    const campo = sql.ref(c.campo);
    if (op === 'IS NULL') return sql`${campo} IS NULL`;
    if (op === 'IS NOT NULL') return sql`${campo} IS NOT NULL`;
    if (op === 'BETWEEN') {
      const v = Array.isArray(c.valor) ? c.valor : [];
      if (v.length !== 2) throw new BusinessRuleError('CONDICAO_ENTRE_EXIGE_DOIS_VALORES', { campo: c.campo });
      return sql`${campo} BETWEEN ${v[0]} AND ${v[1]}`;
    }
    if (op === 'ILIKE') {
      const alvo = String(c.operador) === 'comeca' ? `${String(c.valor)}%` : `%${String(c.valor)}%`;
      return sql`${campo}::text ILIKE ${alvo}`;
    }
    return sql`${campo} ${sql.raw(op)} ${c.valor}`;
  }

  /**
   * Toda referência a campo é conferida contra os campos REAIS da fonte, antes de qualquer SQL ser montada.
   * É o que fecha a superfície de injeção: um `campo` que não está nesta lista não chega ao `sql.ref`.
   */
  private async validarDefinicao(db: AnyDB, fonte: string, def: Definicao, filtros?: CondicaoDef[]): Promise<CampoFonte[]> {
    const campos = await this.camposDa(db, fonte);
    const validos = new Set(campos.map((c) => c.campo));
    const exige = (nome: unknown, onde: string) => {
      if (typeof nome !== 'string' || !validos.has(nome)) throw new BusinessRuleError('CAMPO_NAO_EXISTE_NA_FONTE', { campo: nome, fonte, onde });
    };
    for (const c of def.colunas ?? []) {
      if (c.calculado) {
        exige(c.calculado.campo1, 'coluna calculada');
        exige(c.calculado.campo2, 'coluna calculada');
        if (!['+', '-', '*', '/'].includes(c.calculado.operacao)) throw new BusinessRuleError('OPERACAO_INVALIDA', { operacao: c.calculado.operacao });
      } else exige(c.campo, 'coluna');
    }
    for (const c of [...(def.condicoes ?? []), ...(filtros ?? [])]) exige(c.campo, 'condição');
    for (const o of def.ordem ?? []) exige(o.campo, 'ordenação');
    if (def.agruparPor) exige(def.agruparPor, 'agrupamento');
    return campos;
  }

  /** CSV com separador `;` e vírgula decimal — o que o Excel em pt-BR abre sem perguntar nada. */
  async csv(p: { codrelatoriodef?: number | null; fonte?: string; definicao?: Definicao; filtros?: CondicaoDef[] }): Promise<{ nome: string; conteudo: string }> {
    const r = await this.executar({ ...p, limite: 20000 });
    const esc = (v: unknown) => {
      const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const linhas = [r.colunas.map((c) => esc(c.titulo)).join(';')];
    for (const l of r.linhas) linhas.push(r.colunas.map((c) => esc(l[c.chave])).join(';'));
    if (Object.keys(r.totais).length) {
      linhas.push(r.colunas.map((c) => (r.totais[c.chave] != null ? esc(r.totais[c.chave]) : '')).join(';'));
    }
    return { nome: `${r.titulo.replace(/[^\wÀ-ÿ ()-]/g, '_')}.csv`, conteudo: `﻿${linhas.join('\r\n')}\r\n` };
  }
}
