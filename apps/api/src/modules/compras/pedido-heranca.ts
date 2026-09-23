import { sql } from 'kysely';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** o que o item herda do catálogo — os campos do item com o valor que o legado copia (mig 307). */
export interface HerancaItem {
  idproduto: number;
  fatorembalagem: number;
  vrcusto: number;
  vrcustob: number;
  vrcusto_anterior: number;
  vlrembalagem: number;
  vlrembalagemb: number;
  vrcustorep: number | null;
  vrcustocsi: number | null;
  vrvenda: number | null;
  markup: number | null;
  pisconfis: number | null;
  ipi: number | null; frete: number | null; seguro: number | null; despacessorio: number | null;
  icmst: number | null; fcp_saida: number | null;
  icme: number | null; creditoicm: number | null; icm_efetivo: number | null; debitoicm: number | null;
  vendaliq: number | null; lucrobrutov: number | null; lucrobrutop: number | null; despopv: number | null;
  lucroliqv: number | null; lucroliqp: number | null; imprend: number | null; contsocial: number | null;
  margeml2v: number | null; margeml2: number | null;
  /** de onde veio o custo — para a tela dizer */
  origem_custo: 'reposicao' | 'custo';
  origem_fator: 'referencia_fornecedor' | 'fator_pedido' | 'fatorcx';
}

const nul = (v: unknown) => (v == null || v === '' ? null : Number(v));

/**
 * A HERANÇA DO ITEM (`CarregarItens`, uPedidoCompra.pas:7241) — o que o legado copia para o item novo, a partir da
 * view de busca `GET_PRODUTOS_PC` (= `MULTI_PRECO` da LOJA LOGADA ⋈ `PRODUTOS`, UF da empresa):
 *
 *  - CUSTO: `CUSTO_REP_PC='S'` → o custo de REPOSIÇÃO; senão o custo (:7284-7294). A tabela do fornecedor
 *    (`CUSTO_TABELA_FORNECEDOR`) vem antes de tudo, mas está desligada no cliente e a tabela não tem destino.
 *  - FATOR: `USAR_FATOR_EMBALAGEM_REFERENCIA_FORNECEDOR='S'` → o da referência do fornecedor (:7302); senão
 *    `PRODUTOS.FATOR_PEDIDOCOMPRA` e, zerado, o `FATORCX` (é o `CASE` da própria view).
 *  - o custo BRUTO e o ANTERIOR = o custo herdado (:7298, :7319); embalagem = custo × fator (:7313-7314).
 *  - PIS/COFINS da EMPRESA (:7322); venda, markup, a composição do custo e a escada de preço do `MULTI_PRECO`
 *    (:7323-7346); ICMS efetivo pela alíquota do produto na UF da empresa (a view junta `DET_ALIQUOTA`).
 *
 * Produto sem preço na loja: sem herança (a view é `FROM MULTI_PRECO` — o produto nem aparece na busca).
 */
export async function herdarDoCatalogo(
  db: AnyDB,
  opts: { emp: number; idproduto: number; codparceiro?: number | null; custoRep: boolean; fatorRefFornecedor: boolean },
): Promise<HerancaItem | null> {
  const r = (await sql<Record<string, unknown>>`
      SELECT mp.vrcusto, mp.vrcustorep, mp.vrcustocsi, mp.vrvenda, mp.markup, mp.ipi, mp.frete, mp.seguro,
             mp.despacessorio, mp.icmst, mp.fcp_saida, mp.icme, mp.creditoicm, mp.debitoicm, mp.vendaliq,
             mp.lucrobrutov, mp.lucrobrutop, mp.despopv, mp.lucroliqv, mp.lucroliqp, mp.imprend, mp.contsocial,
             mp.margeml2v, mp.margeml2,
             pr.fatorcx, pr.fator_pedidocompra, e.pisconfis, dt.icm_efetivo
        FROM multi_preco mp
        JOIN produtos pr ON pr.idproduto = mp.idproduto
        JOIN empresas e ON e.idempresa = mp.idempresa
        LEFT JOIN det_aliquota dt ON dt.aliquota = pr.aliquota AND dt.uf = e.uf
       WHERE mp.idproduto = ${opts.idproduto} AND mp.idempresa = ${opts.emp}`.execute(db)).rows[0];
  if (!r) return null;

  const custo = opts.custoRep ? (num(r.vrcustorep) || num(r.vrcusto)) : num(r.vrcusto);
  let fator = 0;
  let origemFator: HerancaItem['origem_fator'] = 'fatorcx';
  if (opts.fatorRefFornecedor && opts.codparceiro) {
    const f = (await sql<{ f: unknown }>`
        SELECT max(fator_embalagem) AS f FROM codreferencia_for
         WHERE idproduto = ${opts.idproduto} AND codfor = ${opts.codparceiro}`.execute(db)).rows[0];
    if (num(f?.f) > 0) { fator = num(f?.f); origemFator = 'referencia_fornecedor'; }
  }
  if (!fator && num(r.fator_pedidocompra) > 0) { fator = num(r.fator_pedidocompra); origemFator = 'fator_pedido'; }
  if (!fator) fator = num(r.fatorcx) > 0 ? num(r.fatorcx) : 1;

  const emb = r4(custo * fator);
  return {
    idproduto: opts.idproduto,
    fatorembalagem: fator,
    vrcusto: r4(custo),
    vrcustob: r4(custo),
    vrcusto_anterior: r4(custo),
    vlrembalagem: emb,
    vlrembalagemb: r2(emb),
    vrcustorep: nul(r.vrcustorep), vrcustocsi: nul(r.vrcustocsi),
    vrvenda: nul(r.vrvenda), markup: nul(r.markup),
    pisconfis: nul(r.pisconfis),
    ipi: nul(r.ipi), frete: nul(r.frete), seguro: nul(r.seguro), despacessorio: nul(r.despacessorio),
    icmst: nul(r.icmst), fcp_saida: nul(r.fcp_saida),
    icme: nul(r.icme), creditoicm: nul(r.creditoicm), icm_efetivo: nul(r.icm_efetivo), debitoicm: nul(r.debitoicm),
    vendaliq: nul(r.vendaliq), lucrobrutov: nul(r.lucrobrutov), lucrobrutop: nul(r.lucrobrutop), despopv: nul(r.despopv),
    lucroliqv: nul(r.lucroliqv), lucroliqp: nul(r.lucroliqp), imprend: nul(r.imprend), contsocial: nul(r.contsocial),
    margeml2v: nul(r.margeml2v), margeml2: nul(r.margeml2),
    origem_custo: opts.custoRep && num(r.vrcustorep) ? 'reposicao' : 'custo',
    origem_fator: origemFator,
  };
}

/**
 * a configuração com a MESMA precedência do `ConfigService` (usuário > empresa > módulo > global, só nos escopos
 * permitidos da chave), mas lida na transação — o agregado é configuração estática, sem injeção de dependência.
 */
export async function configNaTrx(db: AnyDB, codigo: string, ctx: { empresaId?: number | null; operadorId?: number | null; modulo?: string }): Promise<string | null> {
  const cfg = (await sql<{ id: number; valor: unknown; permitidos: unknown }>`
      SELECT id, valor, config_especificas_permitidas AS permitidos FROM configuracoes WHERE codigo = ${codigo} LIMIT 1`
    .execute(db)).rows[0];
  if (!cfg) return null;
  const permitidos = String(cfg.permitidos ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  // Usuario > Empresa > Modulo (o `ValorConfiguracao` do legado resolve no módulo em execução — o Retaguarda)
  for (const [tipo, chave] of [['Usuario', ctx.operadorId], ['Empresa', ctx.empresaId], ['Modulo', ctx.modulo]] as const) {
    if (chave == null || !permitidos.includes(tipo)) continue;
    const ov = (await sql<{ valor: unknown }>`
        SELECT valor FROM configuracoes_especificas WHERE id = ${cfg.id} AND tipo = ${tipo} AND chave = ${String(chave)} LIMIT 1`
      .execute(db)).rows[0];
    if (ov?.valor != null) return String(ov.valor);
  }
  return cfg.valor != null ? String(cfg.valor) : null;
}
