import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { baseProdutoItem } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { nfAggregateConfig } from './nf.aggregate';
import { decomporItemEntrada, type FilhoDoCadastro } from './nf-decomposicao';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

export interface PaiPendente {
  codnfprod: number;
  nroitem: number | null;
  codproduto: number;
  descricao: string | null;
  codbarra: string | null;
  unidade: string | null;
  fatorembal: number;
  /** "Quantidade" (QTDETOTAL = QUANTIDADE × FATOREMBAL) — também o padrão da quantidade em KG */
  qtdetotal: number;
  /** "Valor total original" (TOTALPRODS) — também o padrão do valor total */
  totalprods: number;
  cfop: number | null;
}

export interface EscolhasDecomposicao {
  /** o item-pai que ainda está na nota (o OK do item / o Editar) */
  codnfprod?: number;
  /** ou o GRUPO já decomposto que o Ctrl+D regera (`RecalcularProdutoEmDecomposicao`, uNF.pas:8804-8906): o pai e o NROITEM_DECOMP */
  grupo?: { codprodutopai: number; nroitemDecomp: number | null };
  qtdTotal: number;
  valorTotal: number;
  cfop: number;
}

/**
 * A ENTRADA DECOMPOSTA na nota (`frmItemDecomposicaoNotaFiscal` + `InsereProdutosDaDecomposicao`) — dossiê uNF-decomposicao-entrada.md.
 *  - `pendentes`: `VerificaProdutosComEntradaEmDescomposicao` (uNF.pas:17435-17597), o que o Editar da nota de entrada não processada
 *    percorre: cada item cujo produto tem ENTRADA_DECOMPOSTA='S', com os padrões do diálogo;
 *  - `decompor`: o OK do diálogo ("Confirmar decomposição"): valida como o diálogo (uItemDecomposicaoNotaFiscal.pas:197-229), apaga o pai e
 *    põe os filhos no lugar — pelo GRAVAR da nota, que é quando o legado grava a troca feita em memória: os filhos entram como itens novos
 *    (o indexador, o retrato do produto, os totais e a análise do item saem do mesmo caminho), com a renumeração 1..N do gravar
 *    (uNF.pas:4913-4915: o pai sai e os filhos vão para o fim). Os lotes do pai vão para cada filho.
 * Duas guardas que o fonte não tem (o pai sumia antes do erro): produto sem cadastro de decomposição e filho com valor de venda zero
 * recusam ANTES de mexer na nota.
 */
@Injectable()
export class NfDecomposicaoService {
  constructor(private readonly dbp: DatabaseProvider, private readonly engine: AggregateEngineService) {}

  private emp(): number {
    const emp = currentTenant().empresaId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return emp;
  }

  private async nota(db: AnyDB, codnf: number) {
    const nf = (await db.selectFrom('nf as n').leftJoin('parceiros_end as pe', 'pe.codend', 'n.codparceiro_end')
      .select(['n.codnf', 'n.tipo', 'n.proc', 'n.idempresa', 'n.idsituacao_nf', 'pe.uf as uf_parceiro'])
      .where('n.codnf', '=', codnf).where('n.idempresa', '=', this.emp()).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    return nf;
  }

  async pendentes(codnf: number): Promise<PaiPendente[]> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = await this.nota(db, codnf);
    if (String(nf.tipo) !== 'E' || String(nf.proc ?? '') === 'S') return [];
    const itens = (await sql<Record<string, unknown>>`
      SELECT i.codnfprod, i.nroitem, i.codproduto, i.descricao, p.codbarra, i.unidade, i.fatorembal, i.quantidade, i.vrcusto, i.vrdescprod, i.arredonda, i.cfop
        FROM nf_prod i JOIN produtos p ON p.idproduto = i.codproduto
       WHERE i.codnf = ${codnf} AND p.entrada_decomposta = 'S'
       ORDER BY i.nroitem NULLS LAST, i.codnfprod`.execute(db)).rows;
    return itens.map((i) => {
      const fator = n(i.fatorembal) > 0 ? n(i.fatorembal) : 1;
      return {
        codnfprod: Number(i.codnfprod), nroitem: i.nroitem != null ? Number(i.nroitem) : null, codproduto: Number(i.codproduto),
        descricao: (i.descricao as string | null) ?? null, codbarra: (i.codbarra as string | null) ?? null, unidade: (i.unidade as string | null) ?? null,
        fatorembal: fator, qtdetotal: Math.round(n(i.quantidade) * fator * 1000) / 1000,
        totalprods: baseProdutoItem({ quantidade: i.quantidade, vrcusto: i.vrcusto, vrdescprod: i.vrdescprod, arredonda: i.arredonda } as never),
        cfop: i.cfop != null && String(i.cfop).trim() !== '' ? Number(i.cfop) : null,
      };
    });
  }

  async decompor(codnf: number, e: EscolhasDecomposicao): Promise<void> {
    // as validações do OK do diálogo, na ordem dele
    const cfop = Math.trunc(n(e.cfop));
    if (!(cfop > 0)) throw new BusinessRuleError('NF_DECOMPOSICAO_SEM_CFOP');
    const db = this.dbp.forTenant() as AnyDB;
    const existeCfop = await db.selectFrom('cfop').select('codcfop').where('codcfop', '=', String(cfop)).executeTakeFirst();
    if (!existeCfop) throw new BusinessRuleError('NF_DECOMPOSICAO_CFOP_NAO_CADASTRADO', { cfop });
    if (!(n(e.qtdTotal) > 0)) throw new BusinessRuleError('NF_DECOMPOSICAO_SEM_QUANTIDADE');
    if (!(n(e.valorTotal) > 0)) throw new BusinessRuleError('NF_DECOMPOSICAO_SEM_VALOR');

    const nf = await this.nota(db, codnf);
    if (String(nf.tipo) !== 'E') throw new BusinessRuleError('NF_DECOMPOSICAO_SO_ENTRADA', { codnf });
    if (String(nf.proc ?? '') === 'S') throw new BusinessRuleError('NF_PROCESSADA', { codnf });
    const emp = Number(nf.idempresa);
    const itensDb = (await db.selectFrom('nf_prod').selectAll().where('codnf', '=', codnf).orderBy('nroitem').orderBy('codnfprod').execute()) as Array<Record<string, unknown>>;
    // o pai: o item que está na nota, ou o virtual do grupo (a linha PRODPAIDECO da grade: o produto-pai, a descrição do pai, o NROITEM_DECOMP,
    // o CFOP_ORIGINAL do 1º filho e o ST somado dos filhos — o que o Ctrl+D passa ao diálogo e à InsereProdutosDaDecomposicao)
    let pai: Record<string, unknown>;
    let saem: Array<Record<string, unknown>>;
    if (e.grupo) {
      const g = e.grupo;
      saem = itensDb.filter((i) => Number(i.codprodutopai_decomposicao) === Number(g.codprodutopai)
        && (g.nroitemDecomp == null ? i.nroitem_decomp == null : Number(i.nroitem_decomp) === Number(g.nroitemDecomp)));
      if (!saem.length) throw new BusinessRuleError('NF_ITEM_NAO_ENCONTRADO', { codnf, grupo: g });
      const soma = (k: string) => Math.round(saem.reduce((t, i) => t + n(i[k]), 0) * 100) / 100;
      pai = {
        codproduto: Number(g.codprodutopai), descricao: saem[0].descricao_prodpai_decomp ?? null, nroitem: g.nroitemDecomp, cfop_original: saem[0].cfop_original ?? null,
        vrbasest: soma('vrbasest'), vricmst: soma('vricmst'),
      };
    } else {
      const achado = itensDb.find((i) => Number(i.codnfprod) === Number(e.codnfprod));
      if (!achado) throw new BusinessRuleError('NF_ITEM_NAO_ENCONTRADO', { codnf, codnfprod: e.codnfprod });
      pai = achado;
      saem = [achado];
    }
    const prodPai = (await db.selectFrom('produtos').select(['entrada_decomposta', 'calculo_valor_custo_decomp', 'atualiza_multipreco_decomp'])
      .where('idproduto', '=', Number(pai.codproduto)).executeTakeFirst()) as Record<string, unknown> | undefined;
    // o OK do item e o Editar só abrem o diálogo para produto que entra decomposto (`ProdutoEntraDecomposto`); o Ctrl+D regera o que já está
    if (!e.grupo && String(prodPai?.entrada_decomposta ?? '') !== 'S') throw new BusinessRuleError('NF_ITEM_SEM_ENTRADA_DECOMPOSTA', { codproduto: Number(pai.codproduto) });

    // o cadastro da decomposição (PERCENTUAL > 0, na ordem da descrição) com o VRVENDA da loja e a alíquota do filho (na indústria, a da
    // multi-preço — `ConsultaAliquota`)
    const empresa = (await db.selectFrom('empresas').select(['segmento']).where('idempresa', '=', emp).executeTakeFirst()) as { segmento?: string | null } | undefined;
    const industria = String(empresa?.segmento ?? '').trim().toUpperCase() === 'INDUSTRIA';
    const cadastro = (await sql<Record<string, unknown>>`
      SELECT d.idproduto_01, d.percentual, p.descricao, p.codbarra, p.unidade, p.ncmsh, p.aliquota, p.percentual_perdas,
             mp.vrvenda, mp.aliquota AS aliquota_mp
        FROM decomposicao d JOIN produtos p ON p.idproduto = d.idproduto_01
        LEFT JOIN multi_preco mp ON mp.idproduto = d.idproduto_01 AND mp.idempresa = ${emp}
       WHERE d.idproduto = ${Number(pai.codproduto)} AND d.percentual > 0`.execute(db)).rows;
    if (!cadastro.length) throw new BusinessRuleError('NF_DECOMPOSICAO_SEM_CADASTRO', { codproduto: Number(pai.codproduto) });
    const aliquotaDe = (c: Record<string, unknown>) => String((industria ? c.aliquota_mp : c.aliquota) ?? '').trim() || null;
    const filhos: FilhoDoCadastro[] = cadastro.map((c) => ({
      idproduto: Number(c.idproduto_01), descricao: String(c.descricao ?? ''), codbarra: (c.codbarra as string | null) ?? null, percentual: n(c.percentual),
      vrvenda: n(c.vrvenda), percentualPerdas: c.percentual_perdas != null ? n(c.percentual_perdas) : null, aliquota: aliquotaDe(c),
    }));
    const decompostos = decomporItemEntrada({
      qtdTotal: n(e.qtdTotal), valorTotal: n(e.valorTotal), calculoCusto: prodPai?.calculo_valor_custo_decomp as string | null, cfop,
      baseSt: n(pai.vrbasest), icmsSt: n(pai.vricmst), filhos,
    });

    // o fiscal de cada filho sem indexador: DET_ALIQUOTA da alíquota do filho na UF do fornecedor (ICMS = ICME = ICM, CST, BCR = BASE)
    const porId = new Map(cadastro.map((c) => [Number(c.idproduto_01), c]));
    const aliquotas = [...new Set(filhos.map((f) => f.aliquota).filter((a): a is string => !!a))];
    const det = aliquotas.length
      ? ((await db.selectFrom('det_aliquota').select(['aliquota', 'icm', 'base', 'cst']).where('aliquota', 'in', aliquotas)
        .where('uf', '=', String(nf.uf_parceiro ?? '').trim().toUpperCase()).execute()) as Array<Record<string, unknown>>)
      : [];
    const detDe = new Map(det.map((d) => [String(d.aliquota), d]));
    const atualiza = String(prodPai?.atualiza_multipreco_decomp ?? '') === 'S' ? 'S' : 'N';

    const colunas = nfAggregateConfig.detalhes[0].colunas;
    const doBanco = (i: Record<string, unknown>) => Object.fromEntries(colunas.filter((c) => i[c] !== undefined).map((c) => [c, i[c]]));
    const ficam = itensDb.filter((i) => !saem.includes(i)).map(doBanco);
    const novos = decompostos.map((f) => {
      const c = porId.get(f.idproduto)!;
      const d = detDe.get(String(aliquotaDe(c) ?? ''));
      return {
        codproduto: f.idproduto, descricao: String(c.descricao ?? '').slice(0, 120), codprodnota: (c.codbarra as string | null) ?? null,
        quantidade: f.quantidade, fatorembal: 1, unidade: (c.unidade as string | null) ?? null, geraestoque: 'S', movimenta_estoque: 'S', origem_estoque: 'E',
        vrvenda: f.vrvenda, vrcusto: f.vrcusto, desconto: 0, vrdescprod: 0, bonificacao: 0, cfop: String(cfop), ncm: (c.ncmsh as string | null) ?? null,
        aliquota: aliquotaDe(c), icms: n(d?.icm), icme: n(d?.icm), cst: d?.cst != null ? Number(d.cst) : undefined, bcr: n(d?.base),
        vrbasecalculo: 0, vricm: 0, vrbasest: f.vrbasest, vricmst: f.vricmst, streal: f.vricmst, vrbase_stexterno: f.vrbasest,
        ipi: 0, vripi: 0, frete: 0, seguro: 0, depsacess: 0, arredonda: f.arredonda,
        decomposicao: 'N', codprodutopai_decomposicao: Number(pai.codproduto), item_perda_total: f.item_perda_total, atualiza_multipreco_decomp: atualiza,
        descricao_prodpai_decomp: pai.descricao ?? null, nroitem_decomp: pai.nroitem != null ? Number(pai.nroitem) : null, cfop_original: pai.cfop_original ?? null,
        decomposto: true, _novo: true,
      } as Record<string, unknown>;
    });
    // os lotes do pai em cada filho (udmNF.pas:10658-10668), com a fabricação do lote — o fonte copiava a validade na fabricação. No Ctrl+D o
    // fonte recolhe, a cada filho apagado, só os lotes dele (o array recomeça): valem os do último filho que tinha lote (uNF.pas:8866-8881)
    let lotesDoPai: Array<Record<string, unknown>> = [];
    for (const i of saem) {
      const l = (await db.selectFrom('nf_prod_lote').selectAll().where('codnfprod', '=', Number(i.codnfprod)).orderBy('codnfprodlote').execute()) as Array<Record<string, unknown>>;
      if (l.length) lotesDoPai = l;
    }
    for (const it of novos) {
      it._lotesNovos = lotesDoPai.map(({ codnfprodlote: _pk, codnfprod: _item, ...l }) => ({ ...l, idproduto: it.codproduto, idempresa: emp }));
    }
    const itens: Array<Record<string, unknown>> = [...ficam, ...novos].map((it, ix) => ({ ...it, nroitem: ix + 1 }));
    // NF.QTDE = Σ quantidade dos itens depois da troca (637 de 644 notas com filhos em 2026)
    const qtde = Math.round(itens.reduce((s, it) => s + n(it.quantidade), 0) * 1000) / 1000;
    await this.engine.updateAggregate(nfAggregateConfig, codnf, { itens, qtde, _origemServico: true, _removidosPelaDecomposicao: saem.map((i) => Number(i.codnfprod)) });
  }
}
