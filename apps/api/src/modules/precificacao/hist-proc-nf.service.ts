import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { HistProcNfConsultaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const n0 = (v: unknown) => (v == null ? null : Number(v));
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * HISTÓRICO DE PROCESSAMENTO DA NF — a auditoria de por que o custo do produto mudou. Migration 291.
 * Dossiê `uHistoricoProcessamentoNF.md`.
 *
 * O kardex responde **quanto** entrou e saiu. Esta consulta responde o que mais ninguém responde: **por que
 * o custo e o preço mudaram** — em que nota, em que data, de quanto para quanto.
 *
 * ⚠️ Cada evento grava DUAS linhas: `PRODUTO` é o ANTES e `PROCESSAMENTO` é o DEPOIS. O serviço devolve o
 * par já casado e a variação calculada, porque ler só um dos dois dá metade da história — e foi assim em
 * **531.650 pares**, dos quais 191.695 mudaram o custo e 20.330 mudaram o preço de venda.
 */
@Injectable()
export class HistProcNfService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** os degraus da escada que a tela mostra lado a lado, na ordem em que o legado os calcula */
  private static readonly DEGRAUS = [
    'vrcusto', 'vrcustoreal', 'vrcustorep', 'vrcustofiscal', 'vrcustocsi', 'pmz',
    'markup', 'vrvenda', 'vrvendasug', 'margeml', 'margeml2v', 'vendaliq', 'lucroliqv',
  ] as const;

  async consultar(q: HistProcNfConsultaDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    // ⚠️ o par casado em UMA consulta: `PROCESSAMENTO` (o depois) à esquerda, com o `PRODUTO` (o antes)
    // do mesmo item ao lado. Casar em memória exigiria trazer o dobro de linhas e ordenar por conta.
    const rows = (await sql<Record<string, unknown>>`
        SELECT d.codhistprocnf, d.codnf, d.codnfprod, d.codproduto, d.dthistorico, d.usuhistorico,
               d.codparceiro, d.unidade,
               d.existealteracaocusto, d.alteracustodeco, d.alteracustoesto, d.alteracustocfop,
               d.existealteracaovenda, d.alteravendaonline, d.alteravendalote,
               d.vrcusto, d.vrcustoreal, d.vrcustorep, d.vrcustofiscal, d.vrcustocsi, d.pmz,
               d.markup, d.vrvenda, d.vrvendasug, d.margeml, d.margeml2v, d.vendaliq, d.lucroliqv,
               a.vrcusto AS ant_vrcusto, a.vrcustoreal AS ant_vrcustoreal,
               a.vrcustorep AS ant_vrcustorep, a.vrcustofiscal AS ant_vrcustofiscal,
               a.vrcustocsi AS ant_vrcustocsi, a.pmz AS ant_pmz,
               a.markup AS ant_markup, a.vrvenda AS ant_vrvenda, a.vrvendasug AS ant_vrvendasug,
               a.margeml AS ant_margeml, a.margeml2v AS ant_margeml2v,
               a.vendaliq AS ant_vendaliq, a.lucroliqv AS ant_lucroliqv,
               p.descricao AS produto, f.nronf, f.serie, pa.razao AS fornecedor
          FROM historico_processamento_nf d
          -- o ANTES do mesmo item; LEFT porque ~2.000 linhas do legado estão sem o par
          LEFT JOIN historico_processamento_nf a
                 ON a.codnfprod = d.codnfprod AND a.codproduto = d.codproduto
                AND a.historico = 'PRODUTO'
          LEFT JOIN produtos  p  ON p.idproduto  = d.codproduto
          LEFT JOIN nf        f  ON f.codnf      = d.codnf
          LEFT JOIN parceiros pa ON pa.codparceiro = d.codparceiro AND pa.idempresa = ${emp}
         WHERE d.historico = 'PROCESSAMENTO'
           AND (${q.codproduto ?? 0}::int = 0 OR d.codproduto = ${q.codproduto ?? 0})
           AND (${q.codnf ?? 0}::int = 0 OR d.codnf = ${q.codnf ?? 0})
           AND (${q.data_ini ?? ''}::text = '' OR d.dthistorico >= ${q.data_ini ?? null}::date)
           AND (${q.data_fim ?? ''}::text = '' OR d.dthistorico < (${q.data_fim ?? null}::date + 1))
           AND (NOT ${q.so_alterou_custo}::boolean OR d.existealteracaocusto = 'S')
         ORDER BY d.dthistorico DESC, d.codhistprocnf DESC
         LIMIT ${q.limite}`.execute(db)).rows;

    const linhas = rows.map((r) => {
      // a variação de cada degrau — é o que a auditoria procura, e calculá-la aqui evita que cada
      // consumidor refaça a subtração e erre o sinal
      const escada = HistProcNfService.DEGRAUS.map((k) => {
        const antes = n0(r[`ant_${k}`]);
        const depois = n0(r[k]);
        const mudou = antes != null && depois != null && r2(antes) !== r2(depois);
        return {
          campo: k, antes, depois, mudou,
          variacao: mudou ? r2(num(depois) - num(antes)) : 0,
          variacao_pct: mudou && num(antes) !== 0
            ? r2(((num(depois) / num(antes)) - 1) * 100) : null,
        };
      });
      return {
        codhistprocnf: Number(r.codhistprocnf), dthistorico: r.dthistorico,
        codnf: n0(r.codnf), nronf: r.nronf ?? null, serie: r.serie ?? null,
        codproduto: Number(r.codproduto), produto: r.produto ?? null,
        fornecedor: r.fornecedor ?? null, unidade: r.unidade ?? null,
        usuhistorico: n0(r.usuhistorico),
        // o que o processamento alterou, do jeito que o legado registrou
        alterou_custo: r.existealteracaocusto === 'S',
        alterou_venda: r.existealteracaovenda === 'S',
        por_decomposicao: r.alteracustodeco === 'S',
        por_estoque: r.alteracustoesto === 'S',
        por_cfop: r.alteracustocfop === 'S',
        venda_online: r.alteravendaonline === 'S',
        venda_lote: r.alteravendalote === 'S',
        // o par tem de existir: sem o ANTES não há variação, e a linha diz isso em vez de mostrar zero
        tem_par: r.ant_vrcusto !== undefined && r.ant_vrcusto !== null,
        escada,
      };
    });

    return {
      itens: linhas,
      total: linhas.length,
      // o resumo que a tela mostra no topo: quantos eventos de fato mexeram em quê
      resumo: {
        eventos: linhas.length,
        alteraram_custo: linhas.filter((l) => l.alterou_custo).length,
        alteraram_venda: linhas.filter((l) => l.alterou_venda).length,
        sem_par: linhas.filter((l) => !l.tem_par).length,
      },
    };
  }
}
