import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder, type SqlBool } from 'kysely';
import { DatabaseProvider } from '../database/database.provider';
import { BusinessRuleError } from '../errors/app-error';
import { currentTenant } from '../tenant/tenant-context';
import { empresasDoOperador } from '../acesso/empresas-do-operador';
import { condicaoDoUsuario, operacaoDeAbertura, OPERACOES, tipoDoCampo, type Operacao, type TipoCampo } from './pesquisa-sql';
import { TELAS_DA_PESQUISA, type PesquisaTela } from './telas';

type AnyDB = Kysely<any>;

export interface ColunaDaView { campo: string; titulo: string; tipo: TipoCampo }

export interface ParametrosDaPesquisa {
  campo?: string;
  operacao?: string;
  valor?: string;
  valor2?: string;
  /** o rdgAtivo do cadastro (F6): Sim / Não / Todos */
  situacao?: 'ativos' | 'inativos' | 'todos';
  /** a escolha da janela de opções antes da Pesquisa (A pagar / A receber) */
  opcao?: string;
  ordenacao?: string;
  ordemDesc?: boolean;
  pagina?: number;
  porPagina?: number;
  /** o GetMultiEmpresa (as lojas marcadas; vazio = a do login) */
  empresas?: number[];
  /** parâmetros que a tela declara (ex.: o tipo da NF) */
  extras?: Record<string, string>;
  /** só os códigos de retorno do resultado inteiro, na ordem — o `cdsNavegation` do cadastro (uCadMaster.pas:547, 870-883) */
  soCodigos?: boolean;
  /**
   * o filtro obrigatório do LOOKUP (o 7º parâmetro do `TfrmPesquisa.Create` de cada campo — `FRN = 'S'`, `CLASSE = 'A'`…), como
   * igualdades coluna = valor (ou `IN` com vírgula). A coluna tem de existir na view; o valor é tipado pela coluna. Nunca SQL do cliente.
   */
  fixos?: Record<string, string>;
}

/** nada que pareça credencial sai na grade nem na lista de campos (o `empresaParaRelatorio` usa a mesma regra) */
const SEGREDO = /senha|token|certificado|csc|hash|auth|segredo|secret/i;
const TETO_POR_PAGINA = 1000;
/** o resultado inteiro para a navegação do cadastro (o legado carrega a view filtrada toda; a maior de hoje tem ~48 mil linhas) */
const TETO_CODIGOS = 200_000;

/** "RAZAO_SOCIAL" → "Razao social": o título da coluna no legado é o nome capitalizado (uPesquisa.pas:1651-1661) */
function tituloDaColuna(campo: string): string {
  const s = campo.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A PESQUISA DO LEGADO NO SERVIDOR (`frmPesquisa`, uPesquisa.pas `OpenDataset` :2009-2400) — dossiê
 * docs/04-screen-dossier/dossiers/retaguarda/uPesquisa.md, corte A:
 *   select <colunas da view> from <view>
 *    where [INDR <> 'E'] and [ativo = S/N] and <filtros obrigatórios da tela> and (<campo> <operação> <valor>)
 * Sem o teto silencioso de 200 linhas: a grade pagina sobre o TOTAL (o legado traz a view inteira, sem limite e sem ORDER BY; aqui a
 * ordem existe só para a paginação ser estável). A tela (view, coluna de ativo, obrigatórios, abertura) vem de `TELAS_DA_PESQUISA`.
 */
@Injectable()
export class PesquisaService {
  /** as colunas de cada view (o schema é o mesmo em todos os bancos de tenant) */
  private readonly cache = new Map<string, ColunaDaView[]>();

  constructor(private readonly dbp: DatabaseProvider) {}

  tela(recurso: string): PesquisaTela {
    const t = TELAS_DA_PESQUISA[recurso];
    if (!t) throw new BusinessRuleError('PESQUISA_DESCONHECIDA', { recurso });
    return t;
  }

  async colunas(view: string): Promise<ColunaDaView[]> {
    const c = this.cache.get(view);
    if (c) return c;
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await db
      .selectFrom('information_schema.columns' as any)
      .select(['column_name', 'data_type'])
      .where('table_schema', '=', 'public')
      .where('table_name', '=', view)
      .orderBy('column_name')
      .execute()) as Array<{ column_name: string; data_type: string }>;
    if (!rows.length) throw new BusinessRuleError('PESQUISA_DESCONHECIDA', { view });
    const cols = rows
      .filter((r) => !SEGREDO.test(r.column_name))
      .map((r) => ({ campo: r.column_name, titulo: tituloDaColuna(r.column_name), tipo: tipoDoCampo(r.data_type) }));
    this.cache.set(view, cols);
    return cols;
  }

  /** o que a tela precisa para abrir: os campos em ordem alfabética, as operações por tipo, a abertura e as opções */
  async meta(recurso: string) {
    const t = this.tela(recurso);
    const cols = (await this.colunas(t.view)).filter((c) => c.campo !== 'indr');
    const campo = t.abertura?.campo && cols.some((c) => c.campo === t.abertura!.campo) ? t.abertura.campo : cols[0].campo;
    const tipo = cols.find((c) => c.campo === campo)!.tipo;
    return {
      recurso,
      titulo: t.titulo,
      form: t.form,
      colunas: cols,
      operacoes: OPERACOES,
      abertura: {
        campo,
        operacao: t.abertura?.operacao ?? operacaoDeAbertura(tipo),
        valor: t.abertura?.valor ?? null,
        ordenacao: t.abertura?.ordenacao ?? null,
        ordemDesc: !!t.abertura?.ordemDesc,
      },
      opcoes: t.opcoes ?? [],
      situacao: !!t.campoAtivo,
      retorno: t.retorno,
      obrigatorio: t.descricaoObrigatorios ?? null,
    };
  }

  async pesquisar(recurso: string, p: ParametrosDaPesquisa) {
    const t = this.tela(recurso);
    const cols = await this.colunas(t.view);
    const porNome = new Map(cols.map((c) => [c.campo, c]));
    const db = this.dbp.forTenantRead() as AnyDB;
    const conds: RawBuilder<SqlBool>[] = [];

    // excluído nunca aparece (o cadastro soma COALESCE(INDR,'I')='I' quando a view expõe INDR — uCadMaster.pas:540-544)
    if (porNome.has('indr')) conds.push(sql<SqlBool>`coalesce(${sql.ref('indr')}, 'I') = 'I'`);

    // a situação do cadastro (rdgAtivo, uCadMaster.pas:524-538): ATIVO/ATIVADO = 'S' · = 'N' · todos
    if (t.campoAtivo && porNome.has(t.campoAtivo.coluna)) {
      const s = p.situacao ?? 'ativos';
      if (s !== 'todos') conds.push(sql<SqlBool>`${sql.ref(t.campoAtivo.coluna)} = ${s === 'ativos' ? t.campoAtivo.sim : t.campoAtivo.nao}`);
    }

    // os filtros obrigatórios da tela (FObrigatoriosPesquisa / o filtro do Create — lojas do operador, aberto/quitado, tipo da NF…)
    if (t.opcoes?.length && p.opcao && !t.opcoes.some((o) => o.id === p.opcao)) throw new BusinessRuleError('PESQUISA_OPCAO_INVALIDA', { opcao: p.opcao });
    const opcao = p.opcao ?? t.opcoes?.find((o) => o.padrao)?.id;
    if (t.obrigatorios) {
      const tenant = currentTenant();
      const ctx = {
        empresa: tenant.empresaId ?? null,
        operador: tenant.operadorId ?? null,
        lojas: () => empresasDoOperador(db, p.empresas),
        opcao,
        extras: p.extras ?? {},
      };
      conds.push(...(await t.obrigatorios(ctx)));
    }

    // os filtros fixos do lookup
    for (const [coluna, valor] of Object.entries(p.fixos ?? {})) {
      const col = porNome.get(coluna);
      if (!col) throw new BusinessRuleError('PESQUISA_CAMPO_INVALIDO', { campo: coluna });
      try {
        const c = condicaoDoUsuario(col.campo, col.tipo, valor.includes(',') ? 'contido' : 'igual', valor);
        if (c) conds.push(c);
      } catch {
        throw new BusinessRuleError('PESQUISA_NUMERO_INVALIDO', { campo: coluna, valor });
      }
    }

    // o campo + operação + valor do operador
    if (p.campo) {
      const col = porNome.get(p.campo);
      if (!col) throw new BusinessRuleError('PESQUISA_CAMPO_INVALIDO', { campo: p.campo });
      const op = (p.operacao ?? operacaoDeAbertura(col.tipo)) as Operacao;
      let c: RawBuilder<SqlBool> | null;
      try {
        c = condicaoDoUsuario(col.campo, col.tipo, op, p.valor, p.valor2);
      } catch (e) {
        const m = (e as Error).message;
        throw new BusinessRuleError(m === 'OPERACAO_INVALIDA' ? 'PESQUISA_OPERACAO_INVALIDA' : m === 'DATA_INVALIDA' ? 'PESQUISA_DATA_INVALIDA' : 'PESQUISA_NUMERO_INVALIDO', { campo: p.campo, valor: p.valor });
      }
      // o código de barras acha também pelo código auxiliar (a consulta auxiliar do legado, só com valor)
      if (c && t.alternativa?.campo === col.campo && p.valor?.trim()) c = sql<SqlBool>`(${c} or ${t.alternativa.condicao(p.valor)})`;
      if (c) conds.push(c);
    }

    const visiveis = cols.filter((c) => c.campo !== 'indr').map((c) => c.campo);
    let q = db.selectFrom(t.view).select(visiveis.map((c) => sql.ref(c).as(c)));
    for (const c of conds) q = q.where(c);

    const total = Number(((await q.clearSelect().select(sql<string>`count(*)`.as('n')).executeTakeFirst()) as { n: string } | undefined)?.n ?? 0);

    // a ordem: a pedida (coluna da view), a de abertura da tela, e a coluna de retorno para a página ser estável
    const ordem = p.ordenacao && porNome.has(p.ordenacao) ? p.ordenacao : t.abertura?.ordenacao && porNome.has(t.abertura.ordenacao) ? t.abertura.ordenacao : null;
    const desc = p.ordenacao ? !!p.ordemDesc : !!t.abertura?.ordemDesc;
    if (ordem) q = q.orderBy(sql.ref(ordem), desc ? 'desc' : 'asc');
    if (porNome.has(t.retorno) && ordem !== t.retorno) q = q.orderBy(sql.ref(t.retorno), 'asc');

    if (p.soCodigos) {
      const codigos = (await q.clearSelect().select(sql.ref(t.retorno).as('c')).limit(TETO_CODIGOS).execute()).map((r: any) => r.c);
      return { codigos, total };
    }

    const porPagina = Math.min(Math.max(1, p.porPagina ?? 100), TETO_POR_PAGINA);
    const pagina = Math.max(0, p.pagina ?? 0);
    const linhas = await q.limit(porPagina).offset(pagina * porPagina).execute();
    return { linhas, total, pagina, porPagina };
  }
}
