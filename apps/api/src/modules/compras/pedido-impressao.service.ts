import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';
import { lojasDoPedido } from './pedido-lojas';

type AnyDB = any;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LinhaImpressao {
  idproduto: number;
  codbarra: string | null;
  descricao: string | null;
  unidade: string | null;
  codref: string | null;
  qtde: number;
  qtdtotal: number;
  fatorembalagem: number;
  vrcusto: number;
  vlrembalagem: number;
  total: number;
  bonificacao: number;
  situacao: string | null;
  icm_efetivo: number | null;
}

/**
 * IMPRESSÃO DO PEDIDO DE COMPRA — a projeção dos dois relatórios do legado; o desenho é da tela (camada global de
 * impressão, `imprimirPagina`), aqui só o dado.
 *
 * - `mniImprimirPedidoClick` (uPedidoCompra.pas:2893) → `ped_compra.fr3`: o documento que vai ao fornecedor, uma seção
 *   POR LOJA (GroupHeader por IDEMPRESA com razão, fantasia, endereço, CNPJ, IE e fone da loja — é para onde a
 *   mercadoria vai) e os itens da loja: cód. barra, produto, un., qtde (caixas), vr. unit, total (qtde × embalagem),
 *   fator, qtde total, vr. embalagem, ICMS efetivo da loja (`DET_ALIQUOTA` pela UF dela) e a situação da NF do item.
 * - o "agrupado" (:2818) → `ped_compra_agrupado.fr3`: as mesmas colunas com a quantidade das lojas SOMADA por item.
 *
 * O SQL do legado (`sqqImprime`, udmPedidoCompra.dfm) parte de `PEDIDO_COMPRA_QTDE` — é a quantidade da loja, não a do
 * item. Cabeçalho: fornecedor, e-mail, observação, condição (os prazos CD1..CD8 em "30-60-90", como o script do
 * relatório escreve por cima da descrição), vencimento, comprador (o operador da última alteração) e o desconto padrão
 * do fornecedor. Rodapé: nº de produtos, total da compra e total bonificado (Σ qtde × embalagem × % bonificação).
 *
 * `IMPRIME_ZERADO_PC` ('S' imprime, 'N' omite, 'P' pergunta — o do cliente é 'P') vai junto: as linhas zeradas vêm
 * marcadas e a tela decide.
 */
@Injectable()
export class PedidoImpressaoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async impressao(codpedcomp: number, agrupado: boolean) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const cab = (await sql<Record<string, unknown>>`
        SELECT p.codpedcomp, p.idempresa, p.empresas, p.obs, p.cd1, p.cd2, p.cd3, p.cd4, p.cd5, p.cd6, p.cd7, p.cd8,
               to_char(p.data::date, 'YYYY-MM-DD') AS data,
               to_char(p.dt_vencimento::date, 'YYYY-MM-DD') AS dt_vencimento,
               f.codparceiro, f.razao AS fornecedor, f.email, f.descpadrao,
               co.descricao AS condicao, o.nome AS comprador
          FROM pedidocompra p
          LEFT JOIN parceiros f ON f.codparceiro = p.codparceiro AND f.idempresa = p.idempresa
          LEFT JOIN condicoes_pagto co ON co.codconpagto = p.codconpagto
          LEFT JOIN operadores o ON o.codoperador = p.usultalteracao
         WHERE p.codpedcomp = ${codpedcomp}
           AND coalesce(p.indr, 'I') <> 'E'
           AND (p.idempresa = ${emp} OR ${String(emp)} = ANY(string_to_array(replace(coalesce(p.empresas, ''), ' ', ''), ',')))`
      .execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
    const lojasPed = lojasDoPedido(cab.empresas, cab.idempresa as number);

    const rows = (await sql<Record<string, unknown>>`
        SELECT pq.idempresa, pe.idproduto, po.codbarra, po.descricao, po.unidade,
               pq.qtde, pq.qtdtotal, pe.fatorembalagem, pe.vrcusto, pe.vlrembalagem, pe.bonificacao,
               sit.descricao AS situacao, d.icm_efetivo,
               e.razao_social, e.fantasia, e.endereco, e.cnpj, e.insc, e.fone1,
               (SELECT c.codref FROM codreferencia_for c
                 WHERE c.idproduto = pe.idproduto AND c.codfor = ${Number(cab.codparceiro ?? 0)}
                 ORDER BY coalesce(c.tiporef, 'E') DESC, c.codreferencia_for LIMIT 1) AS codref
          FROM pedidocompra_i pe
          JOIN pedido_compra_qtde pq ON pq.codpedcompi = pe.codpedcompi
          LEFT JOIN produtos po ON po.idproduto = pe.idproduto
          LEFT JOIN empresas e ON e.idempresa = pq.idempresa
          LEFT JOIN situacao_nf sit ON sit.idsituacao_nf = pe.idsituacao_nf
          LEFT JOIN det_aliquota d ON d.aliquota = po.aliquota AND d.uf = e.uf
         WHERE pe.codpedcomp = ${codpedcomp}
         ORDER BY pq.idempresa, po.descricao, pe.idproduto`.execute(db)).rows;

    const linha = (r: Record<string, unknown>): LinhaImpressao => ({
      idproduto: Number(r.idproduto),
      codbarra: (r.codbarra as string | null) ?? null,
      descricao: (r.descricao as string | null) ?? null,
      unidade: (r.unidade as string | null) ?? null,
      codref: (r.codref as string | null) ?? null,
      qtde: num(r.qtde),
      qtdtotal: num(r.qtdtotal),
      fatorembalagem: num(r.fatorembalagem),
      vrcusto: num(r.vrcusto),
      vlrembalagem: num(r.vlrembalagem),
      total: r2(num(r.qtde) * num(r.vlrembalagem)),
      bonificacao: num(r.bonificacao),
      situacao: (r.situacao as string | null)?.trim() || null,
      icm_efetivo: r.icm_efetivo == null ? null : num(r.icm_efetivo),
    });

    // o agrupado imprime as lojas do pedido (o CSV; `GetMultiEmpresa` quando vazio) e soma a quantidade por item
    const doPedido = agrupado ? rows.filter((r) => lojasPed.includes(Number(r.idempresa))) : rows;
    const lojas: Array<Record<string, unknown> & { itens: LinhaImpressao[] }> = [];
    if (!agrupado) {
      for (const r of doPedido) {
        let l = lojas.find((x) => x.idempresa === Number(r.idempresa));
        if (!l) {
          l = { idempresa: Number(r.idempresa), razao_social: r.razao_social, fantasia: r.fantasia, endereco: r.endereco,
            cnpj: r.cnpj, insc: r.insc, fone1: r.fone1, itens: [] };
          lojas.push(l);
        }
        l.itens.push(linha(r));
      }
    }
    const itensAgrupados: LinhaImpressao[] = [];
    if (agrupado) {
      for (const r of doPedido) {
        const l = linha(r);
        const ja = itensAgrupados.find((x) => x.idproduto === l.idproduto && x.vlrembalagem === l.vlrembalagem && x.situacao === l.situacao);
        if (ja) {
          ja.qtde = r2(ja.qtde + l.qtde);
          ja.qtdtotal = r2(ja.qtdtotal + l.qtdtotal);
          ja.total = r2(ja.qtde * ja.vlrembalagem);
        } else itensAgrupados.push({ ...l, icm_efetivo: l.icm_efetivo });
      }
      itensAgrupados.sort((a, b) => String(a.descricao ?? '').localeCompare(String(b.descricao ?? '')) || a.idproduto - b.idproduto);
    }

    const todas = agrupado ? itensAgrupados : lojas.flatMap((l) => l.itens);
    const prazos = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'].map((c) => num(cab[c])).filter((d) => d > 0);
    const imprimeZerado = String((await this.config.resolver('IMPRIME_ZERADO_PC', { empresaId: emp })) ?? 'S').trim().toUpperCase() || 'S';

    return {
      cabecalho: {
        codpedcomp: Number(cab.codpedcomp),
        data: cab.data,
        codparceiro: cab.codparceiro == null ? null : Number(cab.codparceiro),
        fornecedor: cab.fornecedor ?? null,
        email: cab.email ?? null,
        obs: cab.obs ?? null,
        // o script do relatório troca a descrição da condição pelos prazos ("30-60-90"); sem prazos, fica a descrição
        cond_pagto: prazos.length ? prazos.join('-') : ((cab.condicao as string | null) ?? null),
        dt_vencimento: cab.dt_vencimento ?? null,
        comprador: cab.comprador ?? null,
        descpadrao: cab.descpadrao == null ? null : num(cab.descpadrao),
      },
      agrupado,
      lojas,
      itens: itensAgrupados,
      imprime_zerado: imprimeZerado,
      tem_zerados: todas.some((i) => i.qtdtotal <= 0),
      totais: {
        produtos: todas.length,
        compra: r2(todas.reduce((s, i) => s + i.total, 0)),
        bonificado: r2(todas.reduce((s, i) => s + (i.total * i.bonificacao) / 100, 0)),
      },
    };
  }
}
