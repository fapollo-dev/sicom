import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder, type SqlBool } from 'kysely';
import { DatabaseProvider } from '../database/database.provider';
import { BusinessRuleError } from '../errors/app-error';
import { currentTenant } from '../tenant/tenant-context';
import { empresasDoOperador } from '../acesso/empresas-do-operador';
import { opcaoConcedida } from '../acesso/acesso.service';
import { ForbiddenActionError } from '../errors/app-error';
import { condicaoDoUsuario, operacaoDeAbertura, OPERACOES, tipoDoCampo, type Operacao, type TipoCampo } from './pesquisa-sql';
import { TELAS_DA_PESQUISA, type PesquisaTela } from './telas';
import { corDaLinha } from './cores';
import { escreverStatus, lerStatus, TEXTO_OPERACAO, type StatusDaPesquisa } from './status-tela';
import { RelatorioConstrutorService, relacaoDaFonte } from '../../modules/relatorios/relatorio-construtor.service';

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
  /** o complemento da janela de opções (o "Com/Sem centro de custo" do A pagar) */
  complemento?: string;
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
  /** o totalizador: a soma desta coluna numérica no resultado inteiro (o `cbbCamposSoma` + `edtTotal`) */
  soma?: string;
  /**
   * o filtro obrigatório do LOOKUP (o 7º parâmetro do `TfrmPesquisa.Create` de cada campo — `FRN = 'S'`, `CLASSE = 'ANALITICA'`…), como
   * igualdades coluna = valor (ou `IN` com vírgula). A coluna tem de existir na view; o valor é tipado pela coluna. Nunca SQL do cliente.
   */
  fixos?: Record<string, string>;
}

/** a escolha da janela de opções (a opção e o complemento) — no A pagar ela decide a relação */
export interface Escolha { opcao?: string; complemento?: string }

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

  constructor(private readonly dbp: DatabaseProvider, private readonly construtor: RelatorioConstrutorService) {}

  /**
   * a relação que se lê (a versão integral do legado, quando há) e as ocultas dela — no A pagar, a da opção e do complemento escolhidos
   * (sem escolha, os padrões da janela); opção ou complemento fora da lista da tela = 422
   */
  private leitura(t: PesquisaTela, escolha: Escolha = {}): { relacao: string; ocultas: string[]; opcao?: string; viewLegado: string } {
    if (t.opcoes?.length && escolha.opcao && !t.opcoes.some((o) => o.id === escolha.opcao)) throw new BusinessRuleError('PESQUISA_OPCAO_INVALIDA', { opcao: escolha.opcao });
    if (escolha.complemento && !t.complemento?.some((o) => o.id === escolha.complemento)) throw new BusinessRuleError('PESQUISA_OPCAO_INVALIDA', { complemento: escolha.complemento });
    const opcao = escolha.opcao ?? t.opcoes?.find((o) => o.padrao)?.id;
    const r = t.relacaoPorOpcao?.(opcao, escolha.complemento ?? t.complemento?.find((o) => o.padrao)?.id);
    // a view que o legado abriu (o `FView`): a chave do status da tela e das memórias locais (F4, última pesquisa)
    if (r) return { relacao: r.relacao, ocultas: r.ocultas ?? [], opcao, viewLegado: r.viewLegado };
    return { relacao: t.relacao ?? t.view, ocultas: t.ocultas ?? [], opcao, viewLegado: (t.viewLegado ?? t.view).toUpperCase() };
  }
  /** as colunas que aparecem na combo e na grade (sem INDR nem as ocultas do Apollo) */
  private async colunasVisiveis(t: PesquisaTela, escolha?: Escolha): Promise<ColunaDaView[]> {
    const { relacao, ocultas } = this.leitura(t, escolha);
    const fora = new Set(['indr', ...ocultas]);
    return (await this.colunas(relacao)).filter((c) => !fora.has(c.campo));
  }

  tela(recurso: string): PesquisaTela {
    const t = TELAS_DA_PESQUISA[recurso];
    if (!t) throw new BusinessRuleError('PESQUISA_DESCONHECIDA', { recurso });
    return t;
  }

  /** a permissão do botão que abre a pesquisa (`requer`), como o gate de rota (`SEM_PERMISSAO`) */
  private async exigir(t: PesquisaTela): Promise<void> {
    if (!t.requer) return;
    if (!(await opcaoConcedida(this.dbp.forTenantRead() as AnyDB, t.requer.form, t.requer.opcao))) {
      throw new ForbiddenActionError('SEM_PERMISSAO', { form: t.requer.form, opcao: t.requer.opcao, operador: currentTenant().operadorId });
    }
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

  /**
   * o que a tela precisa para abrir: os campos em ordem alfabética, as operações por tipo, a abertura e as opções — os campos e a abertura
   * da relação da opção e do complemento escolhidos (o A pagar troca de view; sem escolha, a padrão da janela)
   */
  async meta(recurso: string, escolha?: Escolha) {
    const t = this.tela(recurso);
    await this.exigir(t);
    const cols = await this.colunasVisiveis(t, escolha);
    const { viewLegado } = this.leitura(t, escolha);
    const campo = t.abertura?.campo && cols.some((c) => c.campo === t.abertura!.campo) ? t.abertura.campo : cols[0].campo;
    const tipo = cols.find((c) => c.campo === campo)!.tipo;
    return {
      recurso,
      titulo: t.titulo,
      form: t.form,
      // a view aberta (o FView do legado) — a chave do F4 e da última pesquisa na estação
      view: viewLegado,
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
      complemento: t.complemento ?? [],
      situacao: !!t.campoAtivo,
      retorno: t.retorno,
      obrigatorio: t.descricaoObrigatorios ?? null,
      // a legenda das cores (a grade à parte do legado) — só as regras cuja coluna a view do destino tem
      legenda: (t.cores ?? []).filter((r) => cols.some((c) => c.campo === r.coluna)).map((r) => ({ cor: r.cor, legenda: r.legenda })),
      // os atalhos de detalhe (F8-F12 na pesquisa de produto) e o rótulo do legado
      detalhes: (t.detalhes ?? []).map((d) => ({ tecla: d.tecla, titulo: d.titulo })),
      rotuloDetalhes: t.rotuloDetalhes ?? null,
      // o &Etiquetas (o resultado inteiro às etiquetas de preço)
      etiqueta: t.etiqueta ?? null,
      // o totalizador: as colunas numéricas, em ordem alfabética (a 1ª abre somada, como o ItemIndex 0 do legado)
      totalizador: t.totalizador ? cols.filter((c) => c.tipo === 'numero').map((c) => c.campo) : null,
    };
  }

  /**
   * o WHERE da Pesquisa: excluído nunca, a situação do cadastro, os filtros obrigatórios da tela, os fixos do lookup e o campo + operação +
   * valor do operador — o mesmo para a grade, a navegação, o marcar todos e o &Imprimir
   */
  private async condicoes(t: PesquisaTela, porNome: Map<string, ColunaDaView>, p: ParametrosDaPesquisa, opcao: string | undefined, db: AnyDB) {
    const conds: RawBuilder<SqlBool>[] = [];
    // excluído nunca aparece (o cadastro soma COALESCE(INDR,'I')='I' quando a view expõe INDR — uCadMaster.pas:540-544)
    if (porNome.has('indr')) conds.push(sql<SqlBool>`coalesce(${sql.ref('indr')}, 'I') = 'I'`);

    // a situação do cadastro (rdgAtivo, uCadMaster.pas:524-538): ATIVO/ATIVADO = 'S' · = 'N' · todos
    if (t.campoAtivo && porNome.has(t.campoAtivo.coluna)) {
      const s = p.situacao ?? 'ativos';
      if (s !== 'todos') conds.push(sql<SqlBool>`${sql.ref(t.campoAtivo.coluna)} = ${s === 'ativos' ? t.campoAtivo.sim : t.campoAtivo.nao}`);
    }

    // os filtros obrigatórios da tela (FObrigatoriosPesquisa / o filtro do Create — lojas do operador, aberto/quitado, tipo da NF…)
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

    // os filtros fixos do lookup; `a|b` = a coluna a OU a coluna b com o valor (o `(CLI = 'S' OR FRN = 'S')` do cliente do A receber)
    for (const [chave, valor] of Object.entries(p.fixos ?? {})) {
      const alternativas: RawBuilder<SqlBool>[] = [];
      for (const coluna of chave.split('|')) {
        const col = porNome.get(coluna);
        if (!col) throw new BusinessRuleError('PESQUISA_CAMPO_INVALIDO', { campo: coluna });
        try {
          const c = condicaoDoUsuario(col.campo, col.tipo, valor.includes(',') ? 'contido' : 'igual', valor);
          if (c) alternativas.push(c);
        } catch {
          throw new BusinessRuleError('PESQUISA_NUMERO_INVALIDO', { campo: coluna, valor });
        }
      }
      if (alternativas.length) conds.push(alternativas.length === 1 ? alternativas[0] : sql<SqlBool>`(${sql.join(alternativas, sql` or `)})`);
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
    return conds;
  }

  async pesquisar(recurso: string, p: ParametrosDaPesquisa) {
    const t = this.tela(recurso);
    await this.exigir(t);
    const { relacao, opcao } = this.leitura(t, { opcao: p.opcao, complemento: p.complemento });
    const cols = await this.colunas(relacao);
    const porNome = new Map(cols.map((c) => [c.campo, c]));
    const db = this.dbp.forTenantRead() as AnyDB;
    const conds = await this.condicoes(t, porNome, p, opcao, db);

    const visiveis = cols.filter((c) => c.campo !== 'indr').map((c) => c.campo);
    let q = db.selectFrom(relacao).select(visiveis.map((c) => sql.ref(c).as(c)));
    for (const c of conds) q = q.where(c);

    const somar = !!p.soma && porNome.get(p.soma)?.tipo === 'numero';
    const agregado = (await q.clearSelect()
      .select(sql<string>`count(*)`.as('n'))
      .$if(somar, (x) => x.select(sql<string>`coalesce(sum(${sql.ref(p.soma ?? '')}), 0)`.as('s')))
      .executeTakeFirst()) as { n: string; s?: string } | undefined;
    const total = Number(agregado?.n ?? 0);
    const soma = somar && agregado?.s != null ? Number(agregado.s) : undefined;

    // a ordem: a pedida (coluna da view), a de abertura da tela, e a coluna de retorno para a página ser estável
    const ordem = p.ordenacao && porNome.has(p.ordenacao) ? p.ordenacao : t.abertura?.ordenacao && porNome.has(t.abertura.ordenacao) ? t.abertura.ordenacao : null;
    const desc = p.ordenacao ? !!p.ordemDesc : !!t.abertura?.ordemDesc;
    if (ordem) q = q.orderBy(sql.ref(ordem), desc ? 'desc' : 'asc');
    if (porNome.has(t.retorno) && ordem !== t.retorno) q = q.orderBy(sql.ref(t.retorno), 'asc');
    for (const c of t.desempate ?? []) if (porNome.has(c) && c !== ordem) q = q.orderBy(sql.ref(c), 'asc');

    if (p.soCodigos) {
      const codigos = (await q.clearSelect().select(sql.ref(t.retorno).as('c')).limit(TETO_CODIGOS).execute()).map((r: any) => r.c);
      return { codigos, total };
    }

    const porPagina = Math.min(Math.max(1, p.porPagina ?? 100), TETO_POR_PAGINA);
    const pagina = Math.max(0, p.pagina ?? 0);
    const linhas = (await q.limit(porPagina).offset(pagina * porPagina).execute()) as Array<Record<string, unknown>>;
    // a posição da linha no resultado (`_linha`): a identidade da linha na grade — o código repete quando a view do legado multiplica
    // (uma linha por endereço do parceiro, por loja do pedido, por baixa do título)
    linhas.forEach((l, i) => { l._linha = pagina * porPagina + i; });
    // a cor de cada linha: a 1ª regra que casa (GetColor)
    const regras = (t.cores ?? []).filter((r) => porNome.has(r.coluna));
    if (regras.length) for (const l of linhas) l._cor = corDaLinha(regras, l);
    return { linhas, total, pagina, porPagina, ...(soma != null ? { soma } : {}) };
  }

  /**
   * "Configurações de impressão salvas" (`cbbRelatorios`): os relatórios do construtor salvos para a VIEW ABERTA — no legado, os arquivos
   * `<aplicação>\Report\<VIEW>_<nome>` da estação (`PercorreOrigem`, uComunPesquisaRel.pas:581-614; uPesquisa.pas:1689-1694); aqui a
   * RELATORIO_DEFINICAO da loja com a fonte = a view
   */
  async relatorios(recurso: string, escolha?: Escolha): Promise<Array<{ codrelatoriodef: number; nome: string }>> {
    const { viewLegado } = this.leitura(this.tela(recurso), escolha);
    return (await this.construtor.listar())
      .filter((r) => r.fonte.toLowerCase() === viewLegado.toLowerCase())
      .map((r) => ({ codrelatoriodef: r.codrelatoriodef, nome: r.nome }));
  }

  /**
   * &Imprimir (uPesquisa.pas:570-665): o relatório salvo da view com o `FiltroDefualt` = o filtro obrigatório + o da pesquisa (o
   * `cdsFiltros` que o `SetaRelatorio` leva) + `CAMPO_RETORNO IN (<marcados>)`. Com mais de 2.000 marcados o legado desmarca e imprime
   * o resultado inteiro — o mesmo conjunto do filtro. O filtro vai como `<retorno> IN (SELECT <retorno> FROM <a relação da pesquisa>
   * WHERE …)`: montado aqui, nunca uma lista do navegador (o resultado chega a dezenas de milhares de códigos).
   */
  async imprimir(recurso: string, p: ParametrosDaPesquisa & { codrelatoriodef: number; marcados?: Array<string | number> }) {
    const t = this.tela(recurso);
    await this.exigir(t);
    const { relacao, opcao, viewLegado } = this.leitura(t, { opcao: p.opcao, complemento: p.complemento });
    const rel = await this.construtor.obter(p.codrelatoriodef);
    if (rel.fonte.toLowerCase() !== viewLegado.toLowerCase()) {
      throw new BusinessRuleError('PESQUISA_RELATORIO_DE_OUTRA_VIEW', { relatorio: rel.fonte, view: viewLegado });
    }
    const db = this.dbp.forTenantRead() as AnyDB;
    const cols = await this.colunas(relacao);
    const porNome = new Map(cols.map((c) => [c.campo, c]));
    const ret = porNome.get(t.retorno);
    // o código de retorno tem de existir na relação do relatório (a mesma view; a versão integral, quando há)
    const colsRel = await this.colunas(await relacaoDaFonte(db, rel.fonte));
    if (!ret || !colsRel.some((c) => c.campo === t.retorno)) throw new BusinessRuleError('CAMPO_NAO_EXISTE_NA_FONTE', { campo: t.retorno, fonte: rel.fonte });

    const conds = await this.condicoes(t, porNome, p, opcao, db);
    let sub = db.selectFrom(relacao).select(sql.ref(t.retorno).as('c'));
    for (const c of conds) sub = sub.where(c);
    let restricao = sql<SqlBool>`${sql.ref(t.retorno)} in (${sub})`;

    // os marcados (até 2.000): o IN deles, com o tipo do código de retorno
    const marcados = (p.marcados ?? []).map((m) => String(m).trim()).filter((m) => m !== '');
    const usarMarcados = marcados.length > 0 && marcados.length <= 2000;
    if (usarMarcados) {
      const valores = ret.tipo === 'numero' ? marcados.map(Number) : marcados;
      if (ret.tipo === 'numero' && valores.some((v) => !Number.isFinite(v as number))) throw new BusinessRuleError('PESQUISA_NUMERO_INVALIDO', { marcados: p.marcados });
      restricao = sql<SqlBool>`${restricao} and ${sql.ref(t.retorno)} in (${sql.join(valores)})`;
    }

    // o texto no cabeçalho do relatório, ao lado das condições salvas
    const col = p.campo ? porNome.get(p.campo) : undefined;
    const op = col ? ((p.operacao ?? operacaoDeAbertura(col.tipo)) as Operacao) : undefined;
    const valor = [p.valor, op === 'entre' ? p.valor2 : undefined].filter((v) => v != null && v !== '').join(' e ');
    const texto = [
      col && op ? `Pesquisa: ${col.titulo} ${TEXTO_OPERACAO[op]}${valor ? ` ${valor}` : ''}` : null,
      usarMarcados ? `${marcados.length} marcado${marcados.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
    return this.construtor.impressao({ codrelatoriodef: p.codrelatoriodef, restricao: { sql: restricao, texto: texto || undefined } });
  }

  /** o detalhe da linha (a tecla do `cdsDetalhes`): a consulta com o código de retorno dela */
  async detalhe(recurso: string, tecla: string, codigo: number) {
    const t = this.tela(recurso);
    const d = (t.detalhes ?? []).find((x) => x.tecla === tecla);
    if (!d) throw new BusinessRuleError('PESQUISA_DETALHE_DESCONHECIDO', { recurso, tecla });
    if (!d.consulta) return { titulo: d.titulo, linhas: [], indisponivel: d.indisponivel ?? null };
    if (!Number.isFinite(codigo)) throw new BusinessRuleError('PESQUISA_NUMERO_INVALIDO', { codigo });
    const linhas = (await d.consulta(codigo).execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return { titulo: d.titulo, linhas, indisponivel: null };
  }

  /**
   * a chave do status da tela no legado: 'frmPesquisa' aberta pelo formulário do cadastro (FORMULARIO_PAI), na view (VIEW_PESQ), com o
   * retorno no código do cadastro (RETORNO1_PESQ = edtCodigo — uCadMaster.pas:547). O lookup de campo tem outro controle de retorno
   * por tela e ainda não guarda status.
   */
  private chaveDoStatus(recurso: string, escolha?: Escolha) {
    const t = this.tela(recurso);
    if (recurso.startsWith('lookup/')) throw new BusinessRuleError('PESQUISA_STATUS_SEM_CHAVE', { recurso });
    const op = currentTenant().operadorId ?? null;
    if (op == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return { t, op, pai: t.form, view: this.leitura(t, escolha).viewLegado, retorno: 'edtCodigo' };
  }

  private filtroDoStatus(k: { op: number; pai: string; view: string; retorno: string }) {
    return sql<SqlBool>`idoperador = ${k.op} and upper(formulario) = 'FRMPESQUISA' and upper(formulario_pai) = upper(${k.pai})
      and upper(view_pesq) = ${k.view} and upper(coalesce(retorno1_pesq, '')) = upper(${k.retorno})`;
  }

  /** RecuperarStatus (uMaster.pas:597; BuscaConfigNoBd do operador): o campo, a operação e o valor com que a Pesquisa reabre */
  async lerStatus(recurso: string, escolha?: Escolha): Promise<StatusDaPesquisa | null> {
    const k = this.chaveDoStatus(recurso, escolha);
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = (await db.selectFrom('config_status_tela').select('configuracao').where(this.filtroDoStatus(k))
      .orderBy('dtultimalteracao', 'desc').limit(1).executeTakeFirst()) as { configuracao: string | null } | undefined;
    if (!r?.configuracao) return null;
    return lerStatus(r.configuracao, await this.colunasVisiveis(k.t, escolha));
  }

  /** Ctrl+Shift+S (GravaConfigNoBd): grava ou troca o status desta chave */
  async salvarStatus(recurso: string, s: StatusDaPesquisa, escolha?: Escolha): Promise<void> {
    const k = this.chaveDoStatus(recurso, escolha);
    const cols = await this.colunasVisiveis(k.t, escolha);
    if (!cols.some((c) => c.campo === s.campo)) throw new BusinessRuleError('PESQUISA_CAMPO_INVALIDO', { campo: s.campo });
    const json = escreverStatus(s, cols);
    const db = this.dbp.forTenant() as AnyDB;
    await db.transaction().execute(async (trx) => {
      const atual = (await trx.selectFrom('config_status_tela').select('codconfigtela').where(this.filtroDoStatus(k)).limit(1).executeTakeFirst()) as
        { codconfigtela: number } | undefined;
      if (atual) {
        await trx.updateTable('config_status_tela').set({ configuracao: json, usultalteracao: k.op, dtultimalteracao: sql`now()` })
          .where('codconfigtela', '=', atual.codconfigtela).execute();
      } else {
        await trx.insertInto('config_status_tela').values({
          codconfigtela: sql`nextval('id_codconfigtela')`, idoperador: k.op, formulario: 'frmPesquisa', formulario_pai: k.pai, view_pesq: k.view,
          retorno1_pesq: k.retorno, configuracao: json, usultalteracao: k.op, dtultimalteracao: sql`now()`,
        }).execute();
      }
    });
  }

  /** Ctrl+Shift+D (ApagaConfigNoBd): apaga o status DESTA chave — o legado apaga a 1ª linha 'frmPesquisa' do operador, de qualquer
   *  tela (o filtro dele só tem operador e formulário); aqui fica a da Pesquisa aberta */
  async apagarStatus(recurso: string, escolha?: Escolha): Promise<void> {
    const k = this.chaveDoStatus(recurso, escolha);
    await (this.dbp.forTenant() as AnyDB).deleteFrom('config_status_tela').where(this.filtroDoStatus(k)).execute();
  }
}
