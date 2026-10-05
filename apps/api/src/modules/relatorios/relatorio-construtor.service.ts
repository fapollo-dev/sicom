import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { FUSO_LOJA } from '../../shared/tempo/hoje';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3 } from '../../shared/relatorios/registro-fr3';
import { montarRelatorioGeral, type ColunaFr3, type TipoCampoFr3 } from './relatorio-geral-fr3';
import { condicaoPesquisa } from '../../shared/relatorios/condicao-pesquisa';

type AnyDB = Kysely<any>;

export interface Fonte { fonte: string; rotulo: string }

/**
 * A relação que o construtor LÊ para uma fonte do catálogo. Algumas fontes servem também a uma tela (`get_apagar`, `get_nf`)
 * e têm as colunas da tela, não as do legado; a versão integral do legado vive ao lado como `rel_<fonte>` (mig 389), sem
 * COMMENT — fora do catálogo. Quando ela existe, os campos e a consulta saem dela; o rótulo e o nome gravado continuam os da
 * fonte. O nome devolvido vem do próprio banco, nunca do pedido.
 */
export async function relacaoDaFonte(db: Kysely<any>, fonte: string): Promise<string> {
  const rel = `rel_${fonte}`;
  const r = (await sql<{ relname: string }>`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'v' AND n.nspname = 'public' AND c.relname = ${rel}
  `.execute(db)).rows[0];
  return r ? r.relname : fonte;
}
export interface CampoFonte { campo: string; tipo: 'texto' | 'numero' | 'data' | 'booleano'; formato: 'texto' | 'moeda' | 'data' | 'numero' }

export interface ColunaDef {
  campo?: string;
  calculado?: { campo1: string; operacao: '+' | '-' | '*' | '/'; campo2: string; condicao?: string };
  titulo?: string;
  largura?: number;
  /** o TAMANHO_MAX do legado: a largura é o maior dado da coluna (ou o título), recalculada a cada execução */
  larguraAuto?: boolean;
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
  /** os campos do grupo, na ordem (cdsAgrupar); `agruparPor` é o formato antigo, de um campo */
  agrupar?: string[];
  somenteAgrupamento?: boolean;
  quebraPagina?: boolean;
  colunas: ColunaDef[];
  condicoes?: CondicaoDef[];
  ordem?: OrdemDef[];
}

/** os operadores que o legado oferece na condição (`cbbOperacaoCondicao`). */

/** o valor como o cabeçalho do grupo mostra: data dd/mm/aaaa, o resto como texto (nulo = vazio) */
const valorTexto = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('pt-BR', { timeZone: FUSO_LOJA });
  return String(v);
};

/** um grupo do relatório: o título (os valores do agrupamento), as linhas dele (índices em `linhas`) e os subtotais */
export interface GrupoRelatorio { titulo: string; de: number; ate: number; subtotais: Record<string, number> }

/** os campos do grupo de uma definição (o formato novo, `agrupar`, ou o antigo, `agruparPor`) */
export const camposDoGrupo = (def: Definicao): string[] =>
  def.agrupar?.length ? def.agrupar : def.agruparPor ? [def.agruparPor] : [];

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
 * são conferidos contra o `information_schema` e citados com `sql.id` (um identificador inteiro — o legado tem coluna com ponto e com
 * espaço no nome, `"X.TXMULTA"`, `"COD_DESCONTO_TITULO "`, que o `sql.ref` partiria); os valores viajam como parâmetro.
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
    return this.camposDa(db, await relacaoDaFonte(db, fonte));
  }

  /** `relacao`: o que `relacaoDaFonte` devolveu para a fonte. */
  private async camposDa(db: AnyDB, relacao: string): Promise<CampoFonte[]> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${relacao}
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
    await this.validarDefinicao(db, dto.fonte, await relacaoDaFonte(db, dto.fonte), dto.definicao);

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
    titulo: string; fonte: string; paisagem: boolean;
    colunas: Array<{ chave: string; titulo: string; formato: string; largura?: number }>;
    linhas: Array<Record<string, unknown>>; totais: Record<string, number>; truncado: boolean;
    grupos?: GrupoRelatorio[]; somenteAgrupamento: boolean; quebraPagina: boolean;
  }> {
    const { interno: _i, ...r } = await this.rodar(p);
    return r;
  }

  /** a consulta do relatório (o `ProcessaSQL`) com o que a impressão precisa a mais: as colunas inteiras, os campos do grupo nas linhas */
  private async rodar(p: { codrelatoriodef?: number | null; fonte?: string; definicao?: Definicao; filtros?: CondicaoDef[]; limite?: number }) {
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
    const relacao = await relacaoDaFonte(db, fonte);
    const campos = await this.validarDefinicao(db, fonte, relacao, def, p.filtros);
    const tipoDe = new Map(campos.map((c) => [c.campo, c]));

    // 1) as colunas, na ordem que o cliente definiu (`POSICAO`).
    const cols = [...def.colunas].sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0));
    const selects = cols.map((c, i) => {
      const chave = `c${i}`;
      // a divisão protege o denominador com NULLIF (dividir por zero derrubaria o relatório inteiro); as
      // outras três operam direto sobre o COALESCE, que é como o legado soma campo nulo.
      const a = sql`coalesce(${sql.id(c.calculado?.campo1 ?? '')}, 0)`;
      const b = c.calculado?.operacao === '/'
        ? sql`nullif(coalesce(${sql.id(c.calculado.campo2)}, 0), 0)`
        : sql`coalesce(${sql.id(c.calculado?.campo2 ?? '')}, 0)`;
      const conta = sql`(${a} ${sql.raw(c.calculado?.operacao ?? '+')} ${b})`;
      // o CONDICAO do legado: `CASE WHEN coalesce(<condicao>, 0) = 0 THEN 0 ELSE <fórmula> END` (ProcessaSQL)
      const expr = c.calculado
        ? (c.calculado.condicao ? sql`CASE WHEN coalesce(${sql.id(c.calculado.condicao)}, 0) = 0 THEN 0 ELSE ${conta} END` : conta)
        : sql`${sql.id(c.campo as string)}`;
      return sql`${expr} AS ${sql.id(chave)}`;
    });
    // os campos do grupo vão junto, escondidos (g0, g1…): é o valor que abre e fecha cada grupo
    const grupo = camposDoGrupo(def);
    // `ValidarAgrupamentoComOrdenacao` (uRelatorio.pas:3414): agrupar exige a ordenação preenchida
    if (grupo.length && !(def.ordem ?? []).length) {
      throw new BusinessRuleError('AGRUPAMENTO_SEM_ORDENACAO', undefined,
        'Para realizar o agrupamento do relatório é necessário que preencha a ordenação.');
    }
    grupo.forEach((g, i) => selects.push(sql`${sql.id(g)} AS ${sql.id(`g${i}`)}`));

    // 2) as condições salvas + os filtros de execução.
    const where = [...(def.condicoes ?? []), ...(p.filtros ?? [])].map((c) => this.condicao(c, tipoDe.get(c.campo)?.tipo));

    // 3) a ordenação.
    const ordem = (def.ordem ?? []).map((o) => sql`${sql.id(o.campo)} ${sql.raw(String(o.direcao).toLowerCase() === 'desc' ? 'DESC' : 'ASC')}`);

    const limite = Math.min(Math.max(Number(p.limite ?? 5000), 1), 20000);
    const linhas = (await sql<Record<string, unknown>>`
      SELECT ${sql.join(selects, sql`, `)}
        FROM ${sql.table(relacao)}
       ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
       ${ordem.length ? sql`ORDER BY ${sql.join(ordem, sql`, `)}` : sql``}
       LIMIT ${limite + 1}
    `.execute(db)).rows;
    const truncado = linhas.length > limite;
    if (truncado) linhas.length = limite;

    // 4) os totais do rodapé — somados sobre o que foi lido, que é o que o relatório mostra.
    const somar = (de: number, ate: number): Record<string, number> => {
      const out: Record<string, number> = {};
      cols.forEach((c, i) => {
        if (!c.totalizar) return;
        const chave = `c${i}`;
        let t = 0;
        for (let k = de; k <= ate; k++) t += Number(linhas[k][chave] ?? 0);
        out[chave] = Math.round(t * 100) / 100;
      });
      return out;
    };
    const totais = linhas.length ? somar(0, linhas.length - 1) : somar(0, -1);

    // 5) os GRUPOS (MontaRelatorio): o FastReport abre um grupo a cada troca do valor (a concatenação dos campos do grupo) — é por
    // SEQUÊNCIA, então o valor que volta depois abre outro grupo (a ordenação é que junta; o legado só exige que ela exista). O
    // cabeçalho mostra os valores separados por espaço; o rodapé, o SUM das colunas que totalizam.
    let grupos: GrupoRelatorio[] | undefined;
    if (grupo.length) {
      grupos = [];
      const chaveDe = (l: Record<string, unknown>) => grupo.map((_, i) => valorTexto(l[`g${i}`])).join('\u0001');
      let de = 0;
      for (let k = 1; k <= linhas.length; k++) {
        if (k === linhas.length || chaveDe(linhas[k]) !== chaveDe(linhas[de])) {
          grupos.push({ titulo: grupo.map((_, i) => valorTexto(linhas[de][`g${i}`])).join(' '), de, ate: k - 1, subtotais: somar(de, k - 1) });
          de = k;
        }
      }
    }
    // as linhas da grade sem os campos do grupo; a impressão fica com eles (é a Condition do GroupHeader)
    const linhasComGrupo = linhas.map((l) => ({ ...l }));
    if (grupo.length) for (const l of linhas) grupo.forEach((_, i) => { delete l[`g${i}`]; });

    // a coluna do grupo não sai no detalhe: vai no cabeçalho dele (o legado compara com o ÚLTIMO campo do grupo — é onde o cursor do
    // cdsAgrupar para depois do laço)
    const escondida = grupo.length ? grupo[grupo.length - 1] : null;
    return {
      titulo: titulo || fonte,
      fonte,
      paisagem: !!def.paisagem,   // o `IMPRIMIR_EM_PAISAGEM` do legado — a tela usa na hora de imprimir
      colunas: cols
        .map((c, i) => ({
          chave: `c${i}`,
          titulo: c.titulo || c.campo || 'Calculado',
          formato: c.formato ?? (c.calculado ? 'numero' : tipoDe.get(c.campo as string)?.formato ?? 'texto'),
          largura: c.largura,
          campo: c.campo,
        }))
        .filter((c) => !(escondida && c.campo === escondida))
        .map(({ campo: _c, ...resto }) => resto),
      linhas, totais, truncado,
      grupos,
      somenteAgrupamento: !!def.somenteAgrupamento && !!grupos,
      quebraPagina: !!def.quebraPagina && !!grupos,
      interno: { def, cols, grupo, relacao, tipoDe, linhasComGrupo, filtros: p.filtros ?? [] },
    };
  }

  /** a condição do construtor: a semântica do `GetParametroWhere` do legado (`shared/relatorios/condicao-pesquisa.ts`) */
  private condicao(c: CondicaoDef, tipo?: CampoFonte['tipo']) {
    return condicaoPesquisa(c, tipo);
  }

  /**
   * Toda referência a campo é conferida contra os campos REAIS da fonte, antes de qualquer SQL ser montada.
   * É o que fecha a superfície de injeção: um `campo` que não está nesta lista não chega ao `sql.id`.
   */
  private async validarDefinicao(db: AnyDB, fonte: string, relacao: string, def: Definicao, filtros?: CondicaoDef[]): Promise<CampoFonte[]> {
    const campos = await this.camposDa(db, relacao);
    const validos = new Set(campos.map((c) => c.campo));
    const exige = (nome: unknown, onde: string) => {
      if (typeof nome !== 'string' || !validos.has(nome)) throw new BusinessRuleError('CAMPO_NAO_EXISTE_NA_FONTE', { campo: nome, fonte, onde });
    };
    for (const c of def.colunas ?? []) {
      if (c.calculado) {
        exige(c.calculado.campo1, 'coluna calculada');
        exige(c.calculado.campo2, 'coluna calculada');
        if (c.calculado.condicao) exige(c.calculado.condicao, 'condição da coluna calculada');
        if (!['+', '-', '*', '/'].includes(c.calculado.operacao)) throw new BusinessRuleError('OPERACAO_INVALIDA', { operacao: c.calculado.operacao });
      } else exige(c.campo, 'coluna');
    }
    for (const c of [...(def.condicoes ?? []), ...(filtros ?? [])]) exige(c.campo, 'condição');
    for (const o of def.ordem ?? []) exige(o.campo, 'ordenação');
    for (const g of camposDoGrupo(def)) exige(g, 'agrupamento');
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

  /**
   * A IMPRESSÃO (`btnImprimirClick` → `MontaRelatorio`, uRelatorio.pas:1603): o modelo `Config\RelatorioGeral_SemGrupo.fr3`
   * (sem agrupamento), `_ComGrupo.fr3` ou `_ComSalto.fr3` (com quebra de página por grupo) com os objetos de cada coluna montados como o
   * legado monta (`relatorio-geral-fr3.ts`). A largura é o TAMANHO efetivo do `ProcessaSQL`: o salvo (TAMANHO_LIMITE) ou, no
   * "tamanho máximo" (TAMANHO_MAX), o maior entre o título e o maior dado da coluna (data: no mínimo 10). Sem dados: "Dados não
   * encontrados com os configurações atuais, Verifique".
   */
  async impressao(p: { codrelatoriodef?: number | null; fonte?: string; definicao?: Definicao; filtros?: CondicaoDef[] }) {
    const r = await this.rodar({ ...p, limite: 20000 });
    const { def, cols, grupo, relacao, tipoDe, linhasComGrupo, filtros } = r.interno;
    if (!linhasComGrupo.length) throw new BusinessRuleError('RELATORIO_SEM_DADOS', {}, 'Dados não encontrados com os configurações atuais, Verifique');
    const db = this.dbp.forTenantRead() as AnyDB;
    const info = new Map(((await sql<{ column_name: string; data_type: string; tam: number | null }>`
      SELECT column_name, data_type, character_maximum_length AS tam FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${relacao}`.execute(db)).rows).map((x) => [x.column_name, x]));
    // o DataType do campo no cdsDados: inteiro e decimal alinham à direita (o decimal com %2.2n), a data sai dd/mm/aaaa
    const tipoDoCampo = (campo: string | undefined): TipoCampoFr3 => {
      const dt = info.get(campo ?? '')?.data_type ?? '';
      if (/^(integer|smallint|bigint)$/.test(dt)) return 'inteiro';
      if (/numeric|double|real/.test(dt)) return 'decimal';
      if (/date|timestamp/.test(dt)) return 'data';
      return 'texto';
    };
    const texto = (v: unknown) => (v == null ? '' : v instanceof Date ? 'dd/mm/aaaa' : String(v));
    const colunas: ColunaFr3[] = cols.map((c, i) => {
      const tipo: TipoCampoFr3 = c.calculado ? 'decimal' : tipoDoCampo(c.campo);
      const titulo = c.titulo || c.campo || 'Calculado';
      let tamanho = Number(c.largura ?? 0);
      if (c.larguraAuto || !tamanho) {
        tamanho = tipo === 'data' ? Math.max(10, titulo.length)
          : Math.max(titulo.length, ...linhasComGrupo.map((l) => texto(l[`c${i}`]).length));
      }
      return { campo: `C${i}`, origem: c.campo ?? `__calc${i}`, titulo, tamanho, tipo, totalizar: !!c.totalizar };
    });
    const ordemGrupo = grupo.map((g, i) => ({ campo: `G${i}`, origem: g, tipo: tipoDoCampo(g) }));
    // as condições do relatório (cdsWhere): "Campo: valor, …" — o nome com a primeira letra maiúscula e o resto minúsculo, o 1º "_"
    // vira espaço com a letra seguinte maiúscula; o valor como o frame mostra (data dd/mm/aaaa, "entre" com " à ")
    const nomeCampo = (cmp: string) => {
      const u = cmp.indexOf('_');
      if (u < 0) return cmp.charAt(0).toUpperCase() + cmp.slice(1).toLowerCase();
      return `${cmp.charAt(0).toUpperCase()}${cmp.slice(1, u).toLowerCase()} ${cmp.charAt(u + 1).toUpperCase()}${cmp.slice(u + 2).toLowerCase()}`;
    };
    const mostrar = (cmp: string, v: unknown): string => {
      const um = (x: unknown) => {
        const t = String(x ?? '');
        if (tipoDe.get(cmp)?.tipo === 'data' && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10).split('-').reverse().join('/');
        if (tipoDe.get(cmp)?.tipo === 'numero' && t !== '' && Number.isFinite(Number(t))) return String(Number(t)).replace('.', ',');
        return t;
      };
      return Array.isArray(v) ? v.map(um).join(' à ') : um(v);
    };
    const textoWhere = [...(def.condicoes ?? []), ...filtros].map((c) => `${nomeCampo(c.campo)}: ${mostrar(c.campo, c.valor)}`).join(', ');
    const arquivo = !grupo.length ? 'RelatorioGeral_SemGrupo.fr3' : def.quebraPagina ? 'RelatorioGeral_ComSalto.fr3' : 'RelatorioGeral_ComGrupo.fr3';
    const emp = (await sql<Record<string, unknown>>`
      SELECT fantasia, endereco, bairro, cidade, uf, cnpj FROM empresas WHERE idempresa = ${this.emp()}`.execute(db)).rows[0] ?? {};
    const s = (k: string) => String(emp[k] ?? '');
    const modelo = montarRelatorioGeral(await modeloFr3(db, arquivo, { pasta: 'Config' }), {
      titulo: def.titulo ?? '', paisagem: !!def.paisagem, quebraPagina: !!def.quebraPagina, somenteAgrupamento: !!def.somenteAgrupamento,
      colunas, grupo: ordemGrupo, tamanhoCampoGrupo: grupo.length ? Number(info.get(grupo[grupo.length - 1])?.tam ?? 0) : 0,
      textoWhere, empresa: { fantasia: s('fantasia'), logradouro: `${s('endereco')} - ${s('bairro')} - ${s('cidade')} - ${s('uf')} - ${s('cnpj')}` },
      totalRegistros: linhasComGrupo.length,
    });
    const numericos = new Set(colunas.filter((c) => c.tipo === 'inteiro' || c.tipo === 'decimal').map((c) => c.campo));
    const dados = linhasComGrupo.map((l) => {
      const o: Record<string, unknown> = {};
      colunas.forEach((c, i) => { const v = l[`c${i}`]; o[c.campo] = numericos.has(c.campo) && v != null && v !== '' ? Number(v) : v; });
      ordemGrupo.forEach((g, i) => { o[g.campo] = l[`g${i}`]; });
      return registroFr3(o);
    });
    return { titulo: r.titulo, modelo, datasets: { frxDBDatasetDados: dados, frxDBDataset1: [registroFr3({ fantasia: s('fantasia'), endereco: s('endereco'), bairro: s('bairro'), cidade: s('cidade'), uf: s('uf'), cnpj: s('cnpj') })] } };
  }
}
