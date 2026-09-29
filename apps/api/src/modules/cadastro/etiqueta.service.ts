import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { hojeNaLoja } from '../../shared/tempo/hoje';
import { ConfigService } from './config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** o valor como o TFloatField guarda (sem o ruído binário de 7,99 × 2) */
const rr = (n: number) => Math.round(n * 1e6) / 1e6;
const str = (v: unknown) => (v == null ? '' : String(v));

/** o registro da lista de impressão — o `cdsImpressao` do Uetiqueta.pas, com os nomes de campo do legado. */
export type Registro = Record<string, string | number | boolean | null>;

/** de onde a linha veio: decide como o preço é calculado de novo na impressão (server-authoritative). */
export type OrigemEtiqueta =
  | { tipo: 'produto'; caminho: 'codbarra' | 'pesquisa' | 'coletor' | 'importacao' | 'cadastro'; fatorEmbalagem?: number }
  | { tipo: 'lote'; codlotepreco: number }
  | { tipo: 'agenda'; codagenda: number; preco: 'status' | 'venda' | 'promocional' }
  | { tipo: 'preco'; fonte: 'precificacao' | 'precos-alterados'; valor: number }
  | { tipo: 'nf'; codnfprod: number };

/** uma linha da tela de etiquetas. O preço impresso por padrão é `valor_venda_promocao`. */
export interface Etiqueta {
  idetiqueta?: number;
  idproduto: number;
  codbarra: string | null;
  descricao: string; // o DESCRICAO do cdsImpressao (o que a grade mostra e o operador pode editar)
  unidade: string | null;
  fator: number;
  qtde: number;
  valor_venda: number; // VALORVENDA
  valor_promocao: number; // VALORPROMOCAO
  valor_venda_promocao: number; // VALORVENDAPROMOCAO
  promocao: string; // 'S'/'N'
  origem: OrigemEtiqueta;
  registro: Registro;
}

export interface ItemImpressao {
  idetiqueta?: number;
  idproduto: number;
  qtde: number;
  modelo?: string;
  descricao?: string; // só quando o operador EDITOU a descrição na grade (imprime como está)
  observacao1?: string;
  observacao2?: string;
  origem?: OrigemEtiqueta;
}

export interface PedidoImpressao {
  itens: ItemImpressao[];
  descricaoPor?: 'produto' | 'grupo'; // o rádio "Descrição etiqueta na impressão"
  observacao1?: string; // as observações gerais (valem para quem não tem a sua na grade)
  observacao2?: string;
  coletor?: boolean; // a lista veio do "Consulta Preço" (FObbetqcoletor): marca a fila do coletor
  listados?: number[]; // todos os produtos da grade (marcados ou não) — o legado marca ETQ_IMPRESSA de todos
}

/** um Imprimir(frxReport) do legado: o modelo e os registros de impressão (cdsPrint/cdsPrint2), já na ordem do papel */
export interface TrabalhoImpressao { modelo: string; zebra: boolean; registros: Registro[] }

const CAMPOS_NUTRI = ['VD_VALORENERGETICO', 'VD_CARBOIDRATO', 'VD_PROTEINA', 'VD_GORDURATOTAL', 'VD_GORDURASATURADA', 'VD_GORDURATRANS', 'VD_FIBRA', 'VD_SODIO',
  'VALORENERGETICO', 'CARBOIDRATO', 'PROTEINA', 'GORDURATOTAL', 'GORDURASATURADA', 'GORDURATRANS', 'FIBRA', 'SODIO'];

/** o registro vazio: os campos que o cdsImpressao cria (cdsImpressaoNewRecord + cdsPrintNewRecord zeram a promo acumulativa) */
function registroVazio(): Registro {
  const r: Registro = {
    IDPRODUTO: 0, CODBARRA: '', DESCRICAO: '', GRUPO_PRECO: '', DESCRICAO_PRODUTO: '', DESCRICAO_RESUMIDA: '', DESCRICAO_BALANCA: '', DESCRICAO_WEB: '',
    UNIDADE: '', VALORVENDA: 0, VALORPROMOCAO: 0, VALORVENDAPROMOCAO: 0, VRVENDA_NOVO: 0, VRVENDA1: 0, VRPROMO: 0, VRCUSTO: 0, QTDE: 1,
    CODREDUZIDO: '', CODDPTO: 0, MEDIA_ORIGINAL: 0, VR_PROMOCAO_ACUMULATIVA: 0, QTDE_PROMOCAO_ACUMULATIVA: 0, ATACAREJO_PROMOCAO_ACUMULATIVA: false,
    UNPORCAO: '', RECEITA: '', DTVALIDADE: null, ATACAREJO_QTD_VALORES: 0,
    VLR_APRESENTACAO: '', VLR_APRESENTACAO_ORI: 0, UNIDADE_APRESENTACAO: '',
  };
  for (const c of CAMPOS_NUTRI) r[c] = 0;
  // MULTI_PRECO_ATACAREJO é MORTA (3 linhas sem DML — conferir-tabelas-fora.py): o preencheAtacarejo não acha nada
  for (let i = 1; i <= 5; i++) { r[`ATACAREJO_QTDE_${i}`] = 0; r[`ATACAREJO_VALOR_${i}`] = 0; r[`ATACAREJO_ECONOMIA_${i}`] = 0; r[`ATACAREJO_MEDIA_${i}`] = 0; }
  return r;
}

const somarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.trunc(dias));
  return d.toISOString().slice(0, 10);
};

/** FloatToStr do Delphi em pt-BR (o DADOS_ETIQUETA do log da produção: "8,99", "0", "6,8286") */
const floatToStr = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15))).replace('.', ','));

/**
 * ETIQUETAS DE PREÇO (FRMETIQUETA — Uetiqueta.pas). Monta a lista de impressão como o `cdsImpressao` do legado, por
 * origem: o código de barras (`edtCodBarraExit`), a pesquisa por ETQ_IMPRESSA (`btnAdicionarRegistroClick`), a fila do
 * coletor (`BitBtn1Click`), os lotes do Ajuste de Preços (`uAjustePrecos.btnEtiquetasClick`) e a agenda de promoção
 * (`uCadAgendaPromocao.ImprimeEtiqueta`) — cada uma com o seu preço, a sua quantidade e a sua descrição. Na impressão o
 * registro é refeito no servidor a partir da origem e vira o registro de impressão (`btnImprimirClick`): a descrição
 * pela regra do legado, uma linha por cópia, na ordem MODELO → CODDPTO;DESCRICAO, com o modelo .fr3 da tabela
 * RELATORIOS. Tenant fail-closed por idempresa.
 */
@Injectable()
export class EtiquetaService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  private async ativoPelaMultiPreco(emp: number): Promise<boolean> {
    return String((await this.config.resolver('ATIVO_PELA_MULTIPRECO', { empresaId: emp })) ?? 'N').toUpperCase() === 'S';
  }

  private async ramoAtividade(db: AnyDB, emp: number): Promise<string> {
    const r = (await sql<{ ramo: string | null }>`SELECT ramoatividade AS ramo FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0];
    return str(r?.ramo).trim();
  }

  /** as linhas cruas dos produtos (GetSQLProduto + o GET_PRODUTOS da pesquisa + o GetInformacoesAdicionais). */
  private async linhasDeProdutos(db: AnyDB, emp: number, ids: number[]): Promise<Map<number, Record<string, unknown>>> {
    const out = new Map<number, Record<string, unknown>>();
    if (!ids.length) return out;
    const rows = (await sql<Record<string, unknown>>`
      SELECT p.idproduto, p.codbarra, p.descricao, gp.descricao AS grupo_preco, mp.vrvenda, mp.vrpromo, mp.promocao, mp.vrcusto,
             coalesce(p.ativo, 'S') AS ativo, coalesce(mp.ativo, 'S') AS ativom, p.quantidade, p.prod_qtde_etiquetas, p.idproduto_pai, p.fator_filho,
             p.unidade, p.descricao_resumida, p.descricao_balanca, p.descricao_web, p.coddpto, p.validade,
             p.vd_valorenergetico, p.vd_carboidrato, p.vd_proteina, p.vd_gorduratotal, p.vd_gordurasaturada, p.vd_gorduratrans, p.vd_fibra, p.vd_sodio,
             p.valorenergetico, p.carboidrato, p.proteina, p.gorduratotal, p.gordurasaturada, p.gorduratrans, p.fibra, p.sodio,
             p.unidade_apresentacao, p.conteudo_embalagem, p.apresentacao_etiqueta
        FROM produtos p
        LEFT JOIN multi_preco mp ON mp.idproduto = p.idproduto AND mp.idempresa = ${emp}
        LEFT JOIN familias_prod gp ON gp.codfamilia = p.codgrupopreco
       WHERE p.idproduto = ANY(${ids}::int[])`.execute(db)).rows;
    for (const r of rows) out.set(Number(r.idproduto), r);
    return out;
  }

  /** SetPromocaoAcumulativa (Uetiqueta.pas:2397): a promoção vigente do produto, se a loja está na lista IDEMPRESA (';'). */
  private async promocoesAcumulativas(db: AnyDB, emp: number, ids: number[]): Promise<Map<number, { qtde: number; desconto: number; atacarejo: boolean }>> {
    const out = new Map<number, { qtde: number; desconto: number; atacarejo: boolean }>();
    if (!ids.length) return out;
    const rows = (await sql<Record<string, unknown>>`
      SELECT DISTINCT ON (idproduto) idproduto, qtde, desconto, idempresa, atacarejo FROM promocao_acumulativa
       WHERE idproduto = ANY(${ids}::int[]) AND current_date BETWEEN dtini::date AND dtfim::date
       ORDER BY idproduto, idproacumulativa`.execute(db)).rows;
    for (const r of rows) {
      // o legado olha só o 1º registro da consulta e exige a loja na lista (StrInList … ';' <> -1)
      if (!str(r.idempresa).split(';').map((s) => s.trim()).includes(String(emp))) continue;
      out.set(Number(r.idproduto), { qtde: num(r.qtde), desconto: num(r.desconto), atacarejo: str(r.atacarejo) === 'S' });
    }
    return out;
  }

  /** o fator do produto filho (IDPRODUTO_PAI > 0 → FATOR_FILHO, senão 1) — o mesmo iif em todos os caminhos do legado */
  private fatorFilho(r: Record<string, unknown>): number {
    return num(r.idproduto_pai) > 0 ? (num(r.fator_filho) > 0 ? num(r.fator_filho) : 1) : 1;
  }

  /** os campos de apresentação (preço por KG/LT) que o binário novo põe na etiqueta: GET_ETIQUETA_CONS_PROD.VLR_APRESENTACAO */
  private apresentacao(reg: Registro, r: Record<string, unknown>): void {
    const un = str(r.unidade_apresentacao).trim();
    if (!un) return;
    const ori = Math.round(((r.apresentacao_etiqueta == null ? 1 : num(r.apresentacao_etiqueta)) * num(reg.VALORVENDA)) / (r.conteudo_embalagem == null || num(r.conteudo_embalagem) === 0 ? 1 : num(r.conteudo_embalagem)) * 10000) / 10000;
    const [ip, dp] = r2(ori).toFixed(2).split('.');
    reg.VLR_APRESENTACAO_ORI = ori;
    reg.VLR_APRESENTACAO = `R$ ${ip === '0' ? '' : ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dp}`;
    reg.UNIDADE_APRESENTACAO = `Valor do ${un}`;
  }

  /**
   * O registro de um produto pelos caminhos do código de barras, da pesquisa e do coletor — as três fórmulas são as mesmas
   * no legado (edtCodBarraExit :1784, btnAdicionarRegistroClick :700, BitBtn1Click :579): VALORVENDA = VRVENDA × fator;
   * com PROMOCAO='S' (e ramo ≠ 'O'), VALORVENDAPROMOCAO = VRVENDA1 = VRPROMO × fator; VRPROMO/VALORPROMOCAO = VRPROMO × fator
   * ou 0. O que muda por caminho: a quantidade (PROD_QTDE_ETIQUETAS no código de barras e na pesquisa, 1 no coletor), a
   * descrição (o código de barras põe só a descrição; pesquisa e coletor, descrição + ' ' + unidade), o GRUPO_PRECO (o
   * coletor não preenche), o CODDPTO (o código de barras não lê) e a MEDIA_ORIGINAL (o coletor não calcula).
   */
  private registroDoProduto(r: Record<string, unknown>, origem: Extract<OrigemEtiqueta, { tipo: 'produto' }>, ramo: string, hoje: string,
    pa?: { qtde: number; desconto: number; atacarejo: boolean }): Registro {
    const reg = registroVazio();
    const fator = origem.fatorEmbalagem != null && origem.fatorEmbalagem > 0 ? origem.fatorEmbalagem : this.fatorFilho(r);
    const vrvenda = num(r.vrvenda);
    const vrpromo = num(r.vrpromo);
    // fold [MÉDIA] da 1ª auditoria: PROMOCAO='S' sem VRPROMO > 0 não é promoção (o legado imprimiria R$ 0,00). Produção:
    // 0 linhas de MULTI_PRECO nesse estado (29/09/2026) — o resultado é o mesmo do legado em todo dado vivo.
    const promo = str(r.promocao) === 'S' && vrpromo > 0;
    const caminho = origem.caminho;
    if (caminho === 'importacao') {
      // btnImportClick (:982): só VRVENDA_NOVO, VRVENDA1 e o CODDPTO; os campos "novos" (VALOR*) e o VRPROMO ficam zerados, sem
      // fator nem informações adicionais, quantidade 1. A promoção acumulativa é lida do dataset errado (cdsProdutos_Temp,
      // vazio neste caminho) dentro de um try/except — nunca entra.
      reg.IDPRODUTO = Number(r.idproduto);
      reg.CODBARRA = str(r.codbarra);
      reg.DESCRICAO = str(r.descricao);
      reg.GRUPO_PRECO = str(r.grupo_preco);
      reg.DESCRICAO_PRODUTO = str(r.descricao);
      reg.DESCRICAO_RESUMIDA = str(r.descricao_resumida);
      reg.DESCRICAO_BALANCA = str(r.descricao_balanca);
      reg.DESCRICAO_WEB = str(r.descricao_web);
      reg.UNIDADE = str(r.unidade);
      reg.VRVENDA_NOVO = rr(vrvenda);
      reg.CODDPTO = Math.trunc(num(r.coddpto));
      reg.VRVENDA1 = rr(promo && ramo !== 'O' ? vrpromo : vrvenda);
      reg.QTDE = 1;
      return reg;
    }
    reg.IDPRODUTO = Number(r.idproduto);
    reg.CODBARRA = str(r.codbarra);
    reg.DESCRICAO = caminho === 'codbarra' || caminho === 'cadastro' ? str(r.descricao) : `${str(r.descricao)} ${str(r.unidade)}`;
    reg.GRUPO_PRECO = caminho === 'coletor' ? '' : str(r.grupo_preco);
    reg.DESCRICAO_PRODUTO = str(r.descricao);
    reg.DESCRICAO_RESUMIDA = str(r.descricao_resumida);
    reg.DESCRICAO_BALANCA = str(r.descricao_balanca);
    reg.DESCRICAO_WEB = str(r.descricao_web);
    reg.UNIDADE = str(r.unidade);
    reg.VALORVENDA = rr(vrvenda * fator);
    reg.VALORVENDAPROMOCAO = rr((promo && ramo !== 'O' ? vrpromo : vrvenda) * fator);
    reg.VALORPROMOCAO = promo ? rr(vrpromo * fator) : 0;
    reg.VRVENDA_NOVO = rr(vrvenda * fator);
    reg.VRVENDA1 = reg.VALORVENDAPROMOCAO;
    reg.VRPROMO = promo ? rr(vrpromo * fator) : 0;
    reg.VRCUSTO = caminho === 'codbarra' ? 0 : rr(num(r.vrcusto) * fator);
    reg.QTDE = caminho === 'coletor' ? 1 : num(r.prod_qtde_etiquetas) > 0 ? Math.trunc(num(r.prod_qtde_etiquetas)) : 1;
    reg.CODDPTO = caminho === 'codbarra' || caminho === 'cadastro' ? 0 : Math.trunc(num(r.coddpto));
    // GetInformacoesAdicionais (:2159): a tabela nutricional do produto, porção em 'g', validade = hoje + VALIDADE dias
    // (o "Imprime etiqueta" do cadastro de produto não chama — ImprimeEtiqueta1Click, UCadProduto.pas:6800)
    if (caminho !== 'cadastro') {
      for (const c of CAMPOS_NUTRI) reg[c] = num(r[c.toLowerCase()]);
      reg.UNPORCAO = 'g';
      reg.RECEITA = ''; // RECEITAS: 0 linhas na produção
      reg.DTVALIDADE = somarDias(hoje, num(r.validade));
    }
    if (pa) {
      reg.VR_PROMOCAO_ACUMULATIVA = rr(num(reg.VRVENDA1) - pa.desconto);
      reg.QTDE_PROMOCAO_ACUMULATIVA = pa.qtde;
      reg.ATACAREJO_PROMOCAO_ACUMULATIVA = pa.atacarejo;
    }
    // (VRVENDA1 × fator) / QUANTIDADE — o legado multiplica pelo fator de novo (VRVENDA1 já tem o fator); cópia fiel
    reg.MEDIA_ORIGINAL = caminho !== 'coletor' && caminho !== 'cadastro' && num(r.quantidade) > 0 ? rr((num(reg.VRVENDA1) * fator) / num(r.quantidade)) : 0;
    this.apresentacao(reg, r);
    return reg;
  }

  private paraEtiqueta(reg: Registro, origem: OrigemEtiqueta, fator: number, idetiqueta?: number): Etiqueta {
    const promo = num(reg.VALORPROMOCAO) > 0 && num(reg.VALORVENDAPROMOCAO) === num(reg.VALORPROMOCAO);
    return {
      idetiqueta,
      idproduto: Number(reg.IDPRODUTO),
      codbarra: str(reg.CODBARRA) || null,
      descricao: str(reg.DESCRICAO).trim(),
      unidade: str(reg.UNIDADE) || null,
      fator,
      qtde: Math.max(1, Math.trunc(num(reg.QTDE))),
      valor_venda: r2(num(reg.VALORVENDA)),
      valor_promocao: r2(num(reg.VALORPROMOCAO)),
      valor_venda_promocao: r2(num(reg.VALORVENDAPROMOCAO)),
      promocao: promo ? 'S' : 'N',
      origem,
      registro: reg,
    };
  }

  /** as etiquetas dos produtos, alinhadas com os pedidos (produto que não existe → undefined na posição dele) */
  private async etiquetasDeProdutos(db: AnyDB, emp: number, pedidos: Array<{ idproduto: number; origem: Extract<OrigemEtiqueta, { tipo: 'produto' }>; idetiqueta?: number }>): Promise<Array<Etiqueta | undefined>> {
    const ids = Array.from(new Set(pedidos.map((p) => p.idproduto)));
    const [linhas, pas, ramo] = await Promise.all([this.linhasDeProdutos(db, emp, ids), this.promocoesAcumulativas(db, emp, ids), this.ramoAtividade(db, emp)]);
    const hoje = hojeNaLoja();
    return pedidos.map((p) => {
      const r = linhas.get(p.idproduto);
      if (!r) return undefined;
      const reg = this.registroDoProduto(r, p.origem, ramo, hoje, pas.get(p.idproduto));
      const fator = p.origem.fatorEmbalagem != null && p.origem.fatorEmbalagem > 0 ? p.origem.fatorEmbalagem : this.fatorFilho(r);
      return this.paraEtiqueta(reg, p.origem, fator, p.idetiqueta);
    });
  }

  private static existentes(xs: Array<Etiqueta | undefined>): Etiqueta[] {
    return xs.filter((x): x is Etiqueta => x != null);
  }

  /**
   * A fila do coletor ("Consulta Preço", BitBtn1Click :579): as consultas IMPRESSA='N' da loja em GET_ETIQUETA_CONS_PROD,
   * uma linha por código de barras (o legado não repete o CODBARRA na lista), quantidade 1, e só produto ativo com o rádio
   * "Buscar somente produtos ativos" em Sim (o padrão).
   */
  async fila(f: { ativos?: boolean } = {}): Promise<Etiqueta[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const somenteAtivos = f.ativos !== false;
    const ativoMp = somenteAtivos ? await this.ativoPelaMultiPreco(emp) : false;
    const rows = (await sql<{ idetiqueta: number; idproduto: number; codbarra: string | null }>`
      SELECT e.idetiqueta, e.idproduto, p.codbarra
        FROM etiqueta_cons_prod e
        JOIN produtos p ON p.idproduto = e.idproduto
        LEFT JOIN multi_preco mp ON mp.idproduto = e.idproduto AND mp.idempresa = e.idempresa
       WHERE e.idempresa = ${emp} AND coalesce(e.impressa, 'N') = 'N'
         ${somenteAtivos ? (ativoMp ? sql`AND coalesce(mp.ativo, 'S') = 'S'` : sql`AND coalesce(p.ativo, 'S') = 'S'`) : sql``}
       ORDER BY e.data_consulta, e.idetiqueta
       LIMIT 5000`.execute(db)).rows;
    const vistos = new Set<string>();
    const pedidos: Array<{ idproduto: number; origem: Extract<OrigemEtiqueta, { tipo: 'produto' }>; idetiqueta?: number }> = [];
    for (const r of rows) {
      const cb = str(r.codbarra) || `#${r.idproduto}`;
      if (vistos.has(cb)) continue;
      vistos.add(cb);
      pedidos.push({ idproduto: Number(r.idproduto), origem: { tipo: 'produto', caminho: 'coletor' }, idetiqueta: Number(r.idetiqueta) });
    }
    return EtiquetaService.existentes(await this.etiquetasDeProdutos(db, emp, pedidos));
  }

  /**
   * A PESQUISA POR ETQ_IMPRESSA (`btnAdicionarRegistroClick`, Uetiqueta.pas:700-735, o rádio "Já impressas / Não impressas /
   * Todas"): os produtos da loja pelo flag do preço — 'N' é a gôndola com PREÇO ALTERADO e etiqueta velha (o trigger do
   * MULTI_PRECO zera o flag a cada troca de preço). "Somente ativos" segue o GET_PRODUTOS.ATIVO (ATIVO_PELA_MULTIPRECO).
   */
  async pesquisar(f: { situacao?: 'N' | 'S' | 'T'; busca?: string; limite?: number; ativos?: boolean }): Promise<Array<Etiqueta & { etq_impressa: string | null; dtultprecoalterado: unknown }>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const situacao = f.situacao ?? 'N';
    const busca = (f.busca ?? '').trim().toUpperCase();
    const somenteAtivos = f.ativos !== false;
    const ativoMp = somenteAtivos ? await this.ativoPelaMultiPreco(emp) : false;
    const rows = (await sql<{ idproduto: number; etq_impressa: string | null; dtultprecoalterado: unknown }>`
      SELECT p.idproduto, mp.etq_impressa, mp.dtultprecoalterado
        FROM produtos p
        JOIN multi_preco mp ON mp.idproduto = p.idproduto AND mp.idempresa = ${emp}
       WHERE TRUE
         ${somenteAtivos ? (ativoMp ? sql`AND coalesce(mp.ativo, 'S') = 'S'` : sql`AND coalesce(p.ativo, 'S') = 'S'`) : sql``}
         ${situacao !== 'T' ? sql`AND coalesce(mp.etq_impressa, 'N') = ${situacao}` : sql``}
         ${busca ? sql`AND (upper(p.descricao) LIKE ${`%${busca}%`} OR p.codbarra = ${busca} OR EXISTS (SELECT 1 FROM codauxiliar a WHERE a.idproduto = p.idproduto AND a.codauxiliar = ${busca}))` : sql``}
       ORDER BY mp.dtultprecoalterado DESC NULLS LAST, p.descricao
       LIMIT ${Math.min(f.limite ?? 500, 2000)}`.execute(db)).rows;
    const ets = EtiquetaService.existentes(await this.etiquetasDeProdutos(db, emp, rows.map((r) => ({ idproduto: Number(r.idproduto), origem: { tipo: 'produto' as const, caminho: 'pesquisa' as const } }))));
    const extra = new Map(rows.map((r) => [Number(r.idproduto), r]));
    return ets.map((e) => ({ ...e, etq_impressa: extra.get(e.idproduto)?.etq_impressa ?? null, dtultprecoalterado: extra.get(e.idproduto)?.dtultprecoalterado ?? null }));
  }

  /**
   * AS ETIQUETAS DOS LOTES DO AJUSTE DE PREÇOS (`btnEtiquetasClick`, uAjustePrecos.pas:109-330): os produtos dos lotes
   * marcados, EXPANDIDOS pelo grupo de preço (os irmãos saem juntos), com o PREÇO DO LOTE (LOTEPRECO.VRVENDA × fator do
   * produto — o lote ainda nem precisa estar processado) e sem promoção; um código de barras uma vez só, com o preço do
   * último lote que o trouxe (o ListaProdutos troca o valor quando outro lote do mesmo produto tem preço diferente).
   * Com "sem promoção", o lote em promoção fica de fora. Produção: 469 das 789 execuções do ajuste imprimiram etiqueta.
   */
  async dosLotes(codlotes: number[], semPromocao = false): Promise<Etiqueta[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return this.etiquetasDosLotes(db, emp, codlotes, semPromocao);
  }

  private async etiquetasDosLotes(db: AnyDB, emp: number, codlotes: number[], semPromocao: boolean): Promise<Etiqueta[]> {
    const ids = Array.from(new Set(codlotes.map(Number).filter((x) => Number.isInteger(x) && x > 0)));
    if (!ids.length) return [];
    const lotes = (await sql<{ codlotepreco: number; idproduto: number; vrvenda: unknown; promocao: string | null; g: number | null }>`
      SELECT l.codlotepreco, l.idproduto, l.vrvenda, l.promocao, p.codgrupopreco AS g FROM lote_preco l JOIN produtos p ON p.idproduto = l.idproduto
       WHERE l.codlotepreco = ANY(${ids}::int[]) AND l.codempresa = ${emp} ORDER BY l.codlotepreco`.execute(db)).rows;
    // produto → { lote que manda no preço }, na ordem em que entraram
    const ordem: number[] = [];
    const doLote = new Map<number, { codlotepreco: number; vrvenda: number }>();
    for (const l of lotes) {
      if (semPromocao && str(l.promocao) === 'S') continue;
      const alvos = l.g != null && Number(l.g) > 0
        ? (await sql<{ p: number }>`SELECT idproduto AS p FROM produtos WHERE codgrupopreco = ${Number(l.g)} ORDER BY idproduto`.execute(db)).rows.map((r) => Number(r.p))
        : [Number(l.idproduto)];
      for (const a of alvos) {
        if (!doLote.has(a)) ordem.push(a);
        doLote.set(a, { codlotepreco: Number(l.codlotepreco), vrvenda: num(l.vrvenda) });
      }
    }
    if (!ordem.length) return [];
    const linhas = await this.linhasDeProdutos(db, emp, ordem);
    const porCodbarra = new Map<string, Etiqueta>();
    for (const pid of ordem) {
      const r = linhas.get(pid);
      if (!r) continue;
      const l = doLote.get(pid)!;
      const fator = this.fatorFilho(r);
      const reg = registroVazio();
      reg.IDPRODUTO = pid;
      reg.CODBARRA = str(r.codbarra);
      reg.DESCRICAO = str(r.descricao);
      reg.DESCRICAO_PRODUTO = str(r.descricao);
      reg.DESCRICAO_RESUMIDA = str(r.descricao_resumida);
      reg.DESCRICAO_WEB = str(r.descricao_web);
      reg.DESCRICAO_BALANCA = str(r.descricao_balanca);
      reg.GRUPO_PRECO = str(r.grupo_preco); // o FormShow preenche o grupo de quem já está na lista
      reg.UNIDADE = ''; // o ajuste não preenche a unidade do cdsImpressao
      reg.VRVENDA1 = rr(l.vrvenda * fator);
      reg.VRVENDA_NOVO = reg.VRVENDA1;
      reg.VALORVENDAPROMOCAO = reg.VRVENDA1;
      reg.VALORVENDA = reg.VRVENDA1;
      reg.QTDE = num(r.prod_qtde_etiquetas) > 0 ? Math.trunc(num(r.prod_qtde_etiquetas)) : 1;
      const cb = str(r.codbarra) || `#${pid}`;
      porCodbarra.set(cb, this.paraEtiqueta(reg, { tipo: 'lote', codlotepreco: l.codlotepreco }, fator));
    }
    return [...porCodbarra.values()];
  }

  /**
   * AS ETIQUETAS DA AGENDA DE PROMOÇÃO (`ImprimeEtiqueta`, uCadAgendaPromocao.pas:2302): os itens ATIVOS da agenda com preço
   * na loja, uma etiqueta por código de barras (qtde 1). VRVENDA1/VALORVENDA = o preço de venda do item; VALORPROMOCAO = o
   * promocional; VRPROMO/VALORVENDAPROMOCAO = conforme o botão: `status` (o clique direto) = venda se a agenda está FECHADA
   * (cbbStatus índice 2 = 'J'), senão o promocional; `venda` / `promocional` = os itens do menu. Item MESTRE de grupo de
   * preço (ATUALIZACAO_GRUPO = 'M', o GRUPOPRECOSEL) com grupo > 0 expande para os itens da agenda do mesmo grupo
   * (`sqqProdGrupoPreco`), e sem nenhum cai no próprio item.
   */
  async daAgenda(codagenda: number, preco: 'status' | 'venda' | 'promocional'): Promise<Etiqueta[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return this.etiquetasDaAgenda(db, emp, codagenda, preco);
  }

  private async etiquetasDaAgenda(db: AnyDB, emp: number, codagenda: number, preco: 'status' | 'venda' | 'promocional'): Promise<Etiqueta[]> {
    const ag = (await db.selectFrom('agenda_promocao').select(['flagpromocao']).where('codagenda', '=', codagenda)
      .where(sql`coalesce(indr, 'I')`, '<>', 'E').executeTakeFirst()) as { flagpromocao: string | null } | undefined;
    if (!ag) throw new BusinessRuleError('AGENDA_NAO_ENCONTRADA', { codagenda });
    const fechada = str(ag.flagpromocao) === 'J';
    const itens = (await db.selectFrom('agenda_promocao_itens as x')
      .leftJoin('produtos as z', 'z.idproduto', 'x.idproduto')
      .innerJoin('multi_preco as m', (j: any) => j.onRef('m.idproduto', '=', 'x.idproduto').on('m.idempresa', '=', emp))
      .leftJoin('familias_prod as d', (j: any) => j.onRef('d.codfamilia', '=', 'z.coddpto').on('d.tipo', '=', 'D'))
      .select(['x.idproduto', 'x.atualizacao_grupo', 'z.codgrupopreco', 'z.codbarra', 'z.descricao', 'z.unidade', 'z.descricao_resumida', 'z.descricao_balanca', 'z.descricao_web', 'x.vlrpromocao',
        sql`coalesce(x.vrvenda, m.vrvenda)`.as('vrvenda')])
      .where('x.codagenda', '=', codagenda).where('x.ativo', '=', 'S')
      .orderBy(sql`d.descricao`).orderBy('z.descricao')
      .execute()) as Array<Record<string, unknown>>;
    const ativoMp = await this.ativoPelaMultiPreco(emp);
    const out: Etiqueta[] = [];
    const vistos = new Set<string>();
    const pos = (r: Record<string, unknown>) => {
      const cb = str(r.codbarra) || `#${r.idproduto}`;
      if (vistos.has(cb)) return;
      vistos.add(cb);
      const venda = num(r.vrvenda);
      const promo = num(r.vlrpromocao);
      const usaVenda = preco === 'venda' || (preco === 'status' && fechada);
      const reg = registroVazio();
      reg.IDPRODUTO = Number(r.idproduto);
      reg.CODBARRA = str(r.codbarra);
      reg.DESCRICAO = str(r.descricao);
      reg.DESCRICAO_PRODUTO = str(r.descricao);
      reg.DESCRICAO_RESUMIDA = str(r.descricao_resumida);
      reg.DESCRICAO_BALANCA = str(r.descricao_balanca);
      reg.DESCRICAO_WEB = str(r.descricao_web);
      reg.GRUPO_PRECO = str(r.grupo_preco);
      reg.UNIDADE = str(r.unidade);
      reg.VRVENDA1 = venda;
      reg.VRVENDA_NOVO = venda;
      reg.VALORVENDA = venda;
      reg.VALORPROMOCAO = promo;
      reg.VRPROMO = usaVenda ? venda : promo;
      reg.VALORVENDAPROMOCAO = usaVenda ? venda : promo;
      reg.QTDE = 1;
      const e = this.paraEtiqueta(reg, { tipo: 'agenda', codagenda, preco }, 1);
      e.promocao = usaVenda ? 'N' : 'S';
      out.push(e);
    };
    for (const it of itens) {
      const g = Number(it.codgrupopreco ?? 0);
      if (g > 0 && str(it.atualizacao_grupo) === 'M') {
        const grupo = (await sql<Record<string, unknown>>`
          SELECT DISTINCT x.idproduto, z.codbarra, z.descricao, z.unidade, z.descricao_resumida, z.descricao_balanca, z.descricao_web, m.vrvenda, x.vlrpromocao, f.descricao AS grupo_preco
            FROM agenda_promocao_itens x
            LEFT JOIN produtos z ON z.idproduto = x.idproduto
            JOIN multi_preco m ON m.idproduto = x.idproduto AND m.idempresa = ${emp}
            JOIN familias_prod f ON f.codfamilia = z.codgrupopreco AND f.tipo = 'P'
           WHERE z.codgrupopreco = ${g} AND x.codagenda = ${codagenda}
             AND ${ativoMp ? sql`coalesce(m.ativo, 'S') = 'S'` : sql`coalesce(z.ativo, 'S') = 'S'`}`.execute(db)).rows;
        if (grupo.length) { for (const r of grupo) pos(r); continue; }
      }
      pos(it);
    }
    // o FormShow preenche o GRUPO_PRECO de quem já está na lista (produtos → FAMILIAS_PROD pelo CODGRUPOPRECO)
    const semGrupo = out.filter((e) => !e.registro.GRUPO_PRECO).map((e) => e.idproduto);
    if (semGrupo.length) {
      const gs = (await sql<{ idproduto: number; g: string | null }>`SELECT p.idproduto, gp.descricao AS g FROM produtos p JOIN familias_prod gp ON gp.codfamilia = p.codgrupopreco WHERE p.idproduto = ANY(${semGrupo}::int[])`.execute(db)).rows;
      const m = new Map(gs.map((x) => [Number(x.idproduto), str(x.g)]));
      for (const e of out) if (!e.registro.GRUPO_PRECO && m.get(e.idproduto)) e.registro.GRUPO_PRECO = m.get(e.idproduto)!;
    }
    return out;
  }

  /**
   * O CÓDIGO DE BARRAS (`edtCodBarraExit`, :1784): acha o produto pelo código dele ou pelo código auxiliar
   * (CODAUXILIAR.CODAUXILIAR — a coluna CODBARRA do auxiliar é o código do próprio produto em 1.147 de 1.147 linhas da
   * produção); pelo auxiliar, o preço sai × FATOREMB (GetFatorEmbalagem :2433). Com "somente ativos" (o padrão), produto
   * inativo não entra: "Produto não está ativo!".
   */
  async buscarProduto(idproduto?: number, codbarra?: string, ativos = true): Promise<Etiqueta> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let pid = idproduto ?? null;
    let fatorAux: number | undefined;
    if (pid == null && codbarra) {
      const cb = codbarra.trim();
      const p = (await db.selectFrom('produtos').select('idproduto').where('codbarra', '=', cb).executeTakeFirst()) as { idproduto?: number } | undefined;
      if (p) pid = Number(p.idproduto);
      if (pid == null) {
        const ca = (await db.selectFrom('codauxiliar').select(['idproduto', 'fatoremb']).where('codauxiliar', '=', cb).executeTakeFirst()) as { idproduto?: number; fatoremb?: unknown } | undefined;
        if (ca) {
          pid = Number(ca.idproduto);
          fatorAux = num(ca.fatoremb) > 0 ? num(ca.fatoremb) : undefined;
        }
      }
    }
    if (pid == null) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { codbarra }, 'Produto não cadastrado.');
    if (ativos) {
      const linha = (await this.linhasDeProdutos(db, emp, [pid])).get(pid);
      if (linha) {
        const ativo = (await this.ativoPelaMultiPreco(emp)) ? str(linha.ativom) : str(linha.ativo);
        if (ativo.toUpperCase() === 'N') throw new BusinessRuleError('PRODUTO_INATIVO_ETIQUETA', { idproduto: pid }, 'Produto não está ativo!');
      }
    }
    const [et] = await this.etiquetasDeProdutos(db, emp, [{ idproduto: pid, origem: { tipo: 'produto', caminho: 'codbarra', fatorEmbalagem: fatorAux } }]);
    if (!et) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: pid }, 'Produto não cadastrado.');
    return et;
  }

  /**
   * IMPORTAR ARQUIVO (`btnImportClick`, :982): cada linha do .txt é "CODBARRA/QTDE/VALOR" — o legado lê a quantidade e o
   * valor e não usa nenhum dos dois (a linha entra com quantidade 1 e o preço do cadastro). O código é procurado no produto
   * e, não achando, no código auxiliar (segCodAux → o produto dono); o que não existe volta na lista de não encontrados
   * (o legado avisa um por um: "Produto não encontrado, CODBARRA=…").
   */
  async importar(codigos: string[]): Promise<{ etiquetas: Etiqueta[]; naoEncontrados: string[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const lista = codigos.map((c) => String(c ?? '')).filter((c) => c !== '').slice(0, 5000);
    if (!lista.length) return { etiquetas: [], naoEncontrados: [] };
    const porCodigo = new Map<string, number>();
    for (const r of (await sql<{ codbarra: string; idproduto: number }>`SELECT codbarra, min(idproduto) AS idproduto FROM produtos WHERE codbarra = ANY(${lista}::text[]) GROUP BY codbarra`.execute(db)).rows) porCodigo.set(r.codbarra, Number(r.idproduto));
    const faltam = lista.filter((c) => !porCodigo.has(c));
    if (faltam.length) {
      for (const r of (await sql<{ codauxiliar: string; idproduto: number }>`SELECT codauxiliar, min(idproduto) AS idproduto FROM codauxiliar WHERE codauxiliar = ANY(${faltam}::text[]) GROUP BY codauxiliar`.execute(db)).rows) porCodigo.set(r.codauxiliar, Number(r.idproduto));
    }
    const naoEncontrados = lista.filter((c) => !porCodigo.has(c));
    const pedidos = lista.filter((c) => porCodigo.has(c)).map((c) => ({ idproduto: porCodigo.get(c)!, origem: { tipo: 'produto' as const, caminho: 'importacao' as const } }));
    return { etiquetas: EtiquetaService.existentes(await this.etiquetasDeProdutos(db, emp, pedidos)), naoEncontrados };
  }

  /** o GRUPO_PRECO que o FormShow (:1994) preenche para quem já está na lista quando a tela abre */
  private static comGrupo(reg: Registro, r: Record<string, unknown>): Registro {
    reg.GRUPO_PRECO = str(r.grupo_preco);
    return reg;
  }

  /**
   * O preço que a tela de origem mostra (Precificação NF líquida `btnEtiquetasClick:296` — PRECO_VENDA; bruta `:206` — a VENDA
   * SUG. editada; Relatório de preços alterados `btneti` — o VALOR da linha): VRVENDA1 = VRVENDA_NOVO = VALORVENDA =
   * VALORVENDAPROMOCAO = o preço, quantidade 1, só DESCRICAO (sem DESCRICAO_PRODUTO nem UNIDADE — a etiqueta sai com a
   * descrição pura). É o valor que está na tela, ainda sem lote processado: o legado imprime o que o operador vê.
   */
  private registroDePreco(r: Record<string, unknown>, valor: number): Registro {
    const reg = EtiquetaService.comGrupo(registroVazio(), r);
    reg.IDPRODUTO = Number(r.idproduto);
    reg.CODBARRA = str(r.codbarra);
    reg.DESCRICAO = str(r.descricao);
    reg.VRVENDA1 = rr(valor);
    reg.VRVENDA_NOVO = reg.VRVENDA1;
    reg.VALORVENDA = reg.VRVENDA1;
    reg.VALORVENDAPROMOCAO = reg.VRVENDA1;
    reg.QTDE = 1;
    return reg;
  }

  /** as linhas da NF para o "Imprimir etiquetas" (uNF.pas:14646): código do produto, descrição e VRVENDA do ITEM, quantidade do item */
  private async linhasDaNf(db: AnyDB, emp: number, filtro: { codnf?: number; codnfprods?: number[] }): Promise<Array<Record<string, unknown>>> {
    return (await sql<Record<string, unknown>>`
      SELECT i.codnfprod, i.codnf, i.codproduto AS idproduto, i.descricao, i.vrvenda, i.quantidade, p.codbarra, gp.descricao AS grupo_preco
        FROM nf_prod i
        JOIN nf n ON n.codnf = i.codnf AND n.idempresa = ${emp}
        LEFT JOIN produtos p ON p.idproduto = i.codproduto
        LEFT JOIN familias_prod gp ON gp.codfamilia = p.codgrupopreco
       WHERE ${filtro.codnf != null ? sql`i.codnf = ${filtro.codnf}` : sql`i.codnfprod = ANY(${filtro.codnfprods ?? []}::int[])`}
       ORDER BY i.nroitem, i.codnfprod`.execute(db)).rows;
  }

  private registroDaNf(r: Record<string, unknown>): Registro {
    const reg = EtiquetaService.comGrupo(registroVazio(), r);
    reg.IDPRODUTO = Number(r.idproduto ?? 0);
    reg.CODBARRA = str(r.codbarra);
    reg.DESCRICAO = str(r.descricao);
    reg.VRVENDA1 = rr(num(r.vrvenda));
    reg.VRVENDA_NOVO = reg.VRVENDA1;
    reg.VALORVENDAPROMOCAO = reg.VRVENDA1;
    reg.VALORVENDA = reg.VRVENDA1;
    // cdsItensNotaQUANTIDADE.AsInteger: o TFloatField arredonda (Round do Delphi, meio para o par)
    const q = num(r.quantidade);
    const piso = Math.floor(q);
    reg.QTDE = q - piso === 0.5 ? (piso % 2 === 0 ? piso : piso + 1) : Math.round(q);
    return reg;
  }

  /**
   * AS OUTRAS TELAS QUE ABREM AS ETIQUETAS com a lista pronta: o cadastro de produto ("Imprime etiqueta"), a Precificação
   * NF líquida e bruta ("Etiquetas"), o Relatório de preços alterados ("Etiquetas") e a NF ("Imprimir etiquetas"). A linha
   * entra marcada; itens repetidos (o mesmo produto em duas linhas da NF, duas alterações do mesmo preço) entram repetidos,
   * como no cdsImpressao do legado.
   */
  async deItens(dto: { fonte: 'cadastro' | 'precificacao' | 'precos-alterados' | 'nf'; codnf?: number; itens?: Array<{ idproduto: number; valor?: number }> }): Promise<Etiqueta[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (dto.fonte === 'nf') {
      if (!dto.codnf) return [];
      return (await this.linhasDaNf(db, emp, { codnf: Number(dto.codnf) }))
        .map((r) => this.paraEtiqueta(this.registroDaNf(r), { tipo: 'nf', codnfprod: Number(r.codnfprod) }, 1));
    }
    const itens = (dto.itens ?? []).filter((i) => Number.isInteger(Number(i.idproduto)) && Number(i.idproduto) > 0).slice(0, 5000);
    if (dto.fonte === 'cadastro') {
      return EtiquetaService.existentes(await this.etiquetasDeProdutos(db, emp, itens.map((i) => ({ idproduto: Number(i.idproduto), origem: { tipo: 'produto' as const, caminho: 'cadastro' as const } }))));
    }
    const linhas = await this.linhasDeProdutos(db, emp, itens.map((i) => Number(i.idproduto)));
    const out: Etiqueta[] = [];
    for (const i of itens) {
      const r = linhas.get(Number(i.idproduto));
      if (!r) continue;
      const valor = num(i.valor);
      out.push(this.paraEtiqueta(this.registroDePreco(r, valor), { tipo: 'preco', fonte: dto.fonte, valor }, 1));
    }
    return out;
  }

  /** enfileira um produto p/ etiqueta (IMPRESSA='N'). Por id ou por codbarra (resolve). */
  async adicionar(dto: { idproduto?: number; codbarra?: string }): Promise<{ idetiqueta: number; etiqueta: Etiqueta }> {
    const emp = this.emp();
    const op = this.op();
    const et = await this.buscarProduto(dto.idproduto, dto.codbarra, false); // valida existência + computa
    const ins = (await (this.dbp.forTenant() as AnyDB)
      .insertInto('etiqueta_cons_prod')
      .values({ idproduto: et.idproduto, idempresa: emp, operador: op, impressa: 'N', data_consulta: sql`now()` })
      .returning('idetiqueta')
      .executeTakeFirstOrThrow()) as { idetiqueta: number };
    return { idetiqueta: Number(ins.idetiqueta), etiqueta: { ...et, idetiqueta: Number(ins.idetiqueta) } };
  }

  /** remove um item da fila (não impresso). */
  async remover(idetiqueta: number): Promise<{ idetiqueta: number; removido: boolean }> {
    const emp = this.emp();
    const res = await (this.dbp.forTenant() as AnyDB).deleteFrom('etiqueta_cons_prod').where('idetiqueta', '=', idetiqueta).where('idempresa', '=', emp).executeTakeFirst();
    return { idetiqueta, removido: Number((res as any)?.numDeletedRows ?? 0) > 0 };
  }

  // ─── modelos (.fr3 na tabela RELATORIOS) ───

  /** o nome do modelo como o CarregaRelatorio (udmPrincipal.pas) tira do arquivo: o que fica entre o 1º '-' e o 1º '.' */
  private static nomeDoArquivo(arquivo: string): string {
    const depois = arquivo.slice(arquivo.indexOf('-') + 1);
    const ponto = depois.indexOf('.');
    return (ponto < 0 ? depois : depois.slice(0, ponto)).trim();
  }

  private async arquivosDeModelo(db: AnyDB): Promise<Array<{ nome: string; arquivo: string; tipo: string; codrelatorio: number }>> {
    // FindFirst('Relatorios\ETI$*.fr3') no legado; o binário novo guarda os arquivos na RELATORIOS (PERSONALIZADO do
    // cliente antes do DEFAULT da Apollo quando os dois têm o mesmo nome)
    const rows = (await sql<{ codrelatorio: number; nome_relatorio: string; tipo: string | null }>`
      SELECT codrelatorio, nome_relatorio, tipo FROM relatorios
       WHERE lower(nome_relatorio) LIKE 'eti$%' AND lower(nome_relatorio) LIKE '%.fr3' AND coalesce(indr, 'I') <> 'E'
       ORDER BY CASE WHEN upper(tipo) = 'PERSONALIZADO' THEN 0 ELSE 1 END, codrelatorio DESC`.execute(db)).rows;
    const vistos = new Map<string, { nome: string; arquivo: string; tipo: string; codrelatorio: number }>();
    for (const r of rows) {
      const nome = EtiquetaService.nomeDoArquivo(r.nome_relatorio);
      if (!nome || vistos.has(nome)) continue;
      vistos.set(nome, { nome, arquivo: r.nome_relatorio, tipo: str(r.tipo), codrelatorio: Number(r.codrelatorio) });
    }
    // a ordem do FindFirst no NTFS: alfabética sem caixa
    return [...vistos.values()].sort((a, b) => a.arquivo.toUpperCase().localeCompare(b.arquivo.toUpperCase()));
  }

  /** a lista de modelos do combo "Modelo da etiqueta" */
  async modelos(): Promise<Array<{ nome: string; tipo: string }>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await this.arquivosDeModelo(db)).map((m) => ({ nome: m.nome, tipo: m.tipo }));
  }

  private async xmlDosModelos(db: AnyDB, nomes: string[]): Promise<Record<string, string>> {
    const todos = await this.arquivosDeModelo(db);
    const out: Record<string, string> = {};
    for (const nome of nomes) {
      const m = todos.find((x) => x.nome === nome);
      if (!m) throw new BusinessRuleError('MODELO_ETIQUETA_NAO_ENCONTRADO', { modelo: nome }, `O modelo de etiqueta "${nome}" não existe.`);
      const r = (await sql<{ arquivo: string | null }>`SELECT arquivo FROM relatorios WHERE codrelatorio = ${m.codrelatorio}`.execute(db)).rows[0];
      const bruto = str(r?.arquivo).trim();
      // a RELATORIOS guarda o .fr3 em base64 (o CLOB do binário novo); arquivo que já é XML passa direto
      out[nome] = bruto.startsWith('<') ? bruto : Buffer.from(bruto, 'base64').toString('utf8').replace(/^﻿/, '');
    }
    return out;
  }

  // ─── impressão ───

  /** refaz, no servidor, o registro de cada item a partir da origem dele (o cliente não dita preço). */
  private async registrosDosItens(db: AnyDB, emp: number, itens: ItemImpressao[]): Promise<Map<ItemImpressao, Etiqueta>> {
    const out = new Map<ItemImpressao, Etiqueta>();
    const produtos = itens.filter((i) => !i.origem || i.origem.tipo === 'produto');
    const ets = await this.etiquetasDeProdutos(db, emp, produtos.map((i) => ({
      idproduto: Number(i.idproduto),
      origem: i.origem?.tipo === 'produto' ? i.origem : { tipo: 'produto' as const, caminho: 'codbarra' as const },
    })));
    produtos.forEach((i, k) => { const e = ets[k]; if (e) out.set(i, e); });
    const lotes = itens.filter((i) => i.origem?.tipo === 'lote');
    if (lotes.length) {
      const cods = lotes.map((i) => (i.origem as Extract<OrigemEtiqueta, { tipo: 'lote' }>).codlotepreco);
      const doLote = await this.etiquetasDosLotes(db, emp, cods, false);
      for (const i of lotes) { const e = doLote.find((x) => x.idproduto === Number(i.idproduto)); if (e) out.set(i, e); }
    }
    const precos = itens.filter((i) => i.origem?.tipo === 'preco');
    if (precos.length) {
      const linhas = await this.linhasDeProdutos(db, emp, precos.map((i) => Number(i.idproduto)));
      for (const i of precos) {
        const o = i.origem as Extract<OrigemEtiqueta, { tipo: 'preco' }>;
        const r = linhas.get(Number(i.idproduto));
        if (r) out.set(i, this.paraEtiqueta(this.registroDePreco(r, num(o.valor)), o, 1));
      }
    }
    const nfs = itens.filter((i) => i.origem?.tipo === 'nf');
    if (nfs.length) {
      const linhas = await this.linhasDaNf(db, emp, { codnfprods: nfs.map((i) => (i.origem as Extract<OrigemEtiqueta, { tipo: 'nf' }>).codnfprod) });
      for (const i of nfs) {
        const o = i.origem as Extract<OrigemEtiqueta, { tipo: 'nf' }>;
        const r = linhas.find((x) => Number(x.codnfprod) === o.codnfprod);
        if (r) out.set(i, this.paraEtiqueta(this.registroDaNf(r), o, 1));
      }
    }
    const agendas = new Map<string, ItemImpressao[]>();
    for (const i of itens.filter((x) => x.origem?.tipo === 'agenda')) {
      const o = i.origem as Extract<OrigemEtiqueta, { tipo: 'agenda' }>;
      const k = `${o.codagenda}|${o.preco}`;
      agendas.set(k, [...(agendas.get(k) ?? []), i]);
    }
    for (const [k, lista] of agendas) {
      const [cod, preco] = k.split('|');
      const daAg = await this.etiquetasDaAgenda(db, emp, Number(cod), preco as 'status' | 'venda' | 'promocional');
      for (const i of lista) { const e = daAg.find((x) => x.idproduto === Number(i.idproduto)); if (e) out.set(i, e); }
    }
    return out;
  }

  /** TIPO/DIV do PreencherTipoEtiqueta (:2332): modelo com 'zebra' no nome imprime pelo cdsPrint, DIV = o 1º dígito 1..5 do nome */
  private static zebra(modelo: string): { zebra: boolean; div: number } {
    if (!modelo.includes('zebra')) return { zebra: false, div: 1 };
    for (const d of ['1', '2', '3', '4', '5']) if (modelo.includes(d)) return { zebra: true, div: Number(d) };
    return { zebra: true, div: 1 };
  }

  /**
   * A descrição impressa (btnImprimirClick :1170/:1240): a editada na grade sai como está; senão o grupo de preço (rádio
   * "Grupo de preço" e o produto tem grupo) ou DESCRICAO_PRODUTO (vazia → DESCRICAO) + ' ' + UNIDADE — no modelo não-zebra
   * só quando a descrição ainda não termina com a unidade. Produção: 1.321 de 1.321 descrições do log seguem essa regra.
   */
  private static descricaoImpressa(reg: Registro, editada: string | undefined, porGrupo: boolean, zebra: boolean): string {
    if (editada != null && editada.trim() !== '') return editada;
    if (porGrupo && str(reg.GRUPO_PRECO) !== '') return str(reg.GRUPO_PRECO);
    const base = str(reg.DESCRICAO_PRODUTO) === '' ? str(reg.DESCRICAO) : str(reg.DESCRICAO_PRODUTO);
    const un = str(reg.UNIDADE);
    if (zebra) return `${base} ${un}`;
    let d = base;
    if (un.trim() !== '' && !d.trim().endsWith(un.trim())) d = `${d.trim()} ${un.trim()}`;
    return d;
  }

  /**
   * IMPRIMIR (btnImprimirClick :1120): exige o modelo; refaz cada registro da origem; monta os registros de impressão — uma
   * linha por cópia; modelo "zebra" pelo cdsPrint (QTDE = ⌈qtde/DIV⌉, um trabalho por registro), os demais pelo cdsPrint2
   * (QTDE 1, VRPROMO = VRPROMO > 0 ? VRPROMO : VRVENDA1, DTPRODUCAO = hoje), agrupados por modelo e ordenados por
   * CODDPTO;DESCRICAO; grava o LOG_IMPRESSAO_ETIQUETA como o binário novo (uma linha por cópia, com o DADOS_ETIQUETA);
   * marca a fila do coletor (só quando a lista veio do "Consulta Preço") e o MULTI_PRECO.ETQ_IMPRESSA de TODOS os produtos
   * da grade — o legado varre o cdsImpressao inteiro depois de tirar o filtro de IMPRIMIR (MarcarImpressaEtqProduto :458).
   * Devolve os trabalhos e o .fr3 de cada modelo para o navegador desenhar.
   */
  async imprimir(dto: PedidoImpressao): Promise<{ etiquetas: Etiqueta[]; total_etiquetas: number; trabalhos: TrabalhoImpressao[]; modelos: Record<string, string> }> {
    const emp = this.emp();
    const op = this.op();
    const semModelo = dto.itens.find((i) => !str(i.modelo).trim());
    if (semModelo) throw new BusinessRuleError('MODELO_ETIQUETA_OBRIGATORIO', {}, 'Necessário informar o modelo da etiqueta.');
    const dbLeitura = this.dbp.forTenantRead() as AnyDB;
    const nomes = Array.from(new Set(dto.itens.map((i) => str(i.modelo).trim())));
    const modelos = await this.xmlDosModelos(dbLeitura, nomes);
    const regs = await this.registrosDosItens(dbLeitura, emp, dto.itens);
    const porGrupo = dto.descricaoPor === 'grupo';
    const hoje = hojeNaLoja();
    const obsGeral1 = str(dto.observacao1);
    const obsGeral2 = str(dto.observacao2);

    const etiquetas: Etiqueta[] = [];
    const zebras: Registro[] = [];
    const normais: Registro[] = [];
    // o cdsImpressao filtrado por IMPRIMIR e indexado por MODELOEITQUETA
    const itens = [...dto.itens].sort((a, b) => str(a.modelo).localeCompare(str(b.modelo)));
    for (const it of itens) {
      const et = regs.get(it);
      if (!et) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: it.idproduto });
      const modelo = str(it.modelo).trim();
      const qtde = Math.max(1, Math.trunc(num(it.qtde)));
      const { zebra, div } = EtiquetaService.zebra(modelo);
      const reg = et.registro;
      const obs1 = str(it.observacao1).trim() !== '' ? str(it.observacao1).trim() : obsGeral1;
      const obs2 = str(it.observacao2).trim() !== '' ? str(it.observacao2).trim() : obsGeral2;
      const descricao = EtiquetaService.descricaoImpressa(reg, it.descricao, porGrupo, zebra);
      etiquetas.push({ ...et, idetiqueta: it.idetiqueta, qtde, descricao });
      const base: Registro = {
        CODBARRA: reg.CODBARRA, DESCRICAO: descricao, MODELO: modelo,
        VALORVENDA: reg.VALORVENDA, VALORPROMOCAO: reg.VALORPROMOCAO, VALORVENDAPROMOCAO: reg.VALORVENDAPROMOCAO,
        VRVENDA1: reg.VRVENDA1, VRVENDA: reg.VRVENDA_NOVO, CODREDUZIDO: reg.CODREDUZIDO, UNIDADE: reg.UNIDADE,
        VR_PROMOCAO_ACUMULATIVA: reg.VR_PROMOCAO_ACUMULATIVA, QTDE_PROMOCAO_ACUMULATIVA: reg.QTDE_PROMOCAO_ACUMULATIVA,
        ATACAREJO_PROMOCAO_ACUMULATIVA: reg.ATACAREJO_PROMOCAO_ACUMULATIVA, CODDPTO: reg.CODDPTO,
        DESCRICAO_PRODUTO: reg.DESCRICAO_PRODUTO, DESCRICAO_RESUMIDA: reg.DESCRICAO_RESUMIDA, DESCRICAO_BALANCA: reg.DESCRICAO_BALANCA, DESCRICAO_WEB: reg.DESCRICAO_WEB,
        OBSERVACAO1: obs1, OBSERVACAO2: obs2,
        VLR_APRESENTACAO: reg.VLR_APRESENTACAO, VLR_APRESENTACAO_ORI: reg.VLR_APRESENTACAO_ORI, UNIDADE_APRESENTACAO: reg.UNIDADE_APRESENTACAO,
        IDPRODUTO: reg.IDPRODUTO,
      };
      for (let c = 0; c < qtde; c++) {
        if (zebra) {
          zebras.push({ ...base, VRPROMO: reg.VRPROMO, QTDE: Math.ceil(qtde / div) });
        } else {
          const r: Registro = { ...base, QTDE: 1, VRPROMO: num(reg.VRPROMO) > 0 ? reg.VRPROMO : reg.VRVENDA1, DTPRODUCAO: hoje, DTVALIDADE: reg.DTVALIDADE,
            UNPORCAO: reg.UNPORCAO, RECEITA: reg.RECEITA, MEDIA_ORIGINAL: reg.MEDIA_ORIGINAL, ATACAREJO_QTD_VALORES: reg.ATACAREJO_QTD_VALORES };
          for (const k of CAMPOS_NUTRI) r[k] = reg[k];
          for (let i = 1; i <= 5; i++) for (const p of ['QTDE', 'VALOR', 'ECONOMIA', 'MEDIA']) r[`ATACAREJO_${p}_${i}`] = reg[`ATACAREJO_${p}_${i}`];
          normais.push(r);
        }
      }
    }
    // cdsPrint2.IndexFieldNames 'MODELO;CODBARRA' → por modelo, filtrado e ordenado 'CODDPTO;DESCRICAO' (:1417-1436)
    const trabalhos: TrabalhoImpressao[] = zebras.map((r) => ({ modelo: str(r.MODELO), zebra: true, registros: [r] }));
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const nomesNormais = Array.from(new Set(normais.map((r) => str(r.MODELO)))).sort(cmp);
    for (const m of nomesNormais) {
      const registros = normais.filter((r) => str(r.MODELO) === m)
        .sort((a, b) => num(a.CODDPTO) - num(b.CODDPTO) || cmp(str(a.DESCRICAO), str(b.DESCRICAO)) || cmp(str(a.CODBARRA), str(b.CODBARRA)));
      trabalhos.push({ modelo: m, zebra: false, registros });
    }

    const listados = Array.from(new Set([...(dto.listados ?? []).map(Number), ...dto.itens.map((i) => Number(i.idproduto))].filter((x) => Number.isInteger(x) && x > 0)));
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const linhasLog = trabalhos.flatMap((t) => t.registros).map((r) => ({
        idempresa: emp, codoperador: op, datahora_impressao: sql`now()`, codbarra: str(r.CODBARRA) || null,
        valor_impressao: r2(num(r.VRPROMO) > 0 ? num(r.VRPROMO) : num(r.VRVENDA1)), modelo_etiqueta: str(r.MODELO), descricao_etiqueta: str(r.DESCRICAO).slice(0, 500),
        qtde_impressa: 1, valor_venda: r2(num(r.VALORVENDA)), valor_promocao: r2(num(r.VALORPROMOCAO)), valor_venda_promocao: r2(num(r.VALORVENDAPROMOCAO)),
        valor_apresentacao: str(r.UNIDADE_APRESENTACAO) ? r2(num(r.VLR_APRESENTACAO_ORI)) : null, unidade: str(r.UNIDADE) || null,
        codreduzido: str(r.CODREDUZIDO) || null, dados_etiqueta: EtiquetaService.dadosEtiqueta(r),
      }));
      for (let i = 0; i < linhasLog.length; i += 500) await trx.insertInto('log_impressao_etiqueta').values(linhasLog.slice(i, i + 500)).execute();
      if (dto.coletor && listados.length) {
        await trx.updateTable('etiqueta_cons_prod').set({ impressa: 'S' })
          .where('idproduto', 'in', listados).where(sql`coalesce(impressa, 'N')`, '=', 'N').where('idempresa', '=', emp).execute();
      }
      if (listados.length) await trx.updateTable('multi_preco').set({ etq_impressa: 'S' }).where('idproduto', 'in', listados).where('idempresa', '=', emp).execute();
    });
    const total = trabalhos.reduce((s, t) => s + t.registros.length, 0);
    return { etiquetas, total_etiquetas: total, trabalhos, modelos };
  }

  /** o DADOS_ETIQUETA que o binário novo grava no log (1.322 linhas de jul-set/2026): "CAMPO=valor; …" */
  private static dadosEtiqueta(r: Registro): string {
    const n = (v: unknown) => floatToStr(num(v));
    const partes = [`CODBARRA=${str(r.CODBARRA)}`, `DESCRICAO=${str(r.DESCRICAO)}`, `QTDE=${n(r.QTDE)}`, `MODELO=${str(r.MODELO)}`,
      `VALORVENDA=${n(r.VALORVENDA)}`, `VALORPROMOCAO=${n(r.VALORPROMOCAO)}`, `VALORVENDAPROMOCAO=${n(r.VALORVENDAPROMOCAO)}`,
      `VRVENDA=${n(r.VRVENDA)}`, `VRVENDA1=${n(r.VRVENDA1)}`, `VRPROMO=${n(r.VRPROMO)}`];
    if (str(r.UNIDADE_APRESENTACAO)) partes.push(`VLR_APRESENTACAO=${str(r.VLR_APRESENTACAO)}`, `VLR_APRESENTACAO_ORI=${n(r.VLR_APRESENTACAO_ORI)}`);
    partes.push(`UNIDADE=${str(r.UNIDADE)}`);
    if (str(r.UNIDADE_APRESENTACAO)) partes.push(`UNIDADE_APRESENTACAO=${str(r.UNIDADE_APRESENTACAO)}`);
    return partes.join('; ').slice(0, 4000);
  }
}
