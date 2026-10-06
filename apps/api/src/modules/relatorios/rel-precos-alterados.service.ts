import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelPrecosAlteradosDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** o histórico guarda o valor como TEXTO, e em pt-BR ('17,90'). */
const numBr = (v: unknown) => (v == null || v === '' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));

/**
 * RELATÓRIO DE PREÇOS ALTERADOS (`FRMRELPRECOSALTERADOS`). **35 acessos, 4 operadores.**
 * Dossiê: `uRelPrecosAlterados.md`. Migration 244.
 *
 * Que preços mudaram no período, **de quanto para quanto** e por quem. Duas origens, como no legado: o preço
 * em vigor (`multi_preco`, por `DTULTPRECOALTERADO`) ou o lote de alteração (`lotepreco`, por `DATALOTE` —
 * 96.863 lotes no cliente, o último de hoje).
 *
 * ── ⚠️ O relatório escondia MAIS DA METADE das alterações ─────────────────────────────────────────────
 * O legado usa **`JOIN HISTORICO_DINAMICO H ON H.CODHISTORICO = M.CODHISTORICO`** — INNER. E
 * `MULTI_PRECO.CODHISTORICO` está preenchido em apenas **87.708 de 203.615** linhas (43%). Medido em
 * agosto/2026 na empresa 1: **594 preços alterados, e o relatório mostrava 266** — **328 alterações (55,2%)
 * simplesmente não apareciam**, por falta do vínculo com o histórico.
 *
 * Aqui o join é LEFT: sem histórico o preço **anterior** fica vazio, mas a alteração aparece. Um relatório de
 * preços alterados que esconde metade das alterações não cumpre o que promete.
 *
 * ── ⚠️ `ROWNUM = 1 ... ORDER BY` no outro dataset ─────────────────────────────────────────────────────
 * O `sqqConsulta` do data module busca o valor anterior com `AND ROWNUM = 1 ORDER BY CODHISTORICO DESC`. No
 * Oracle o `ROWNUM` é aplicado **antes** do `ORDER BY`, então a linha devolvida é arbitrária. Verificado no
 * produto 8242, que tem 9 registros: o legado devolve **17,90** onde o correto é **12,99**. E
 * **11.999 de 15.300** produtos com histórico de preço têm mais de um registro, ou seja, a maioria.
 */
@Injectable()
export class RelPrecosAlteradosService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelPrecosAlteradosDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; subiram: number; caíram: number; semAnterior: number; variacaoMedia: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const produto = f.produto ? `%${f.produto.toUpperCase()}%` : null;
    const promo = f.promocao === 'PROMOCAO' ? sql`AND m.promocao = 'S'`
      : f.promocao === 'NORMAL' ? sql`AND coalesce(m.promocao, 'N') = 'N'` : sql``;

    const linhas = f.origem === 'LOTE'
      ? (await sql<Record<string, unknown>>`
          SELECT l.idproduto AS codproduto, p.codbarra, p.descricao,
                 fa.descricao AS dpto, l.datalote AS data, l.vrvenda AS valor,
                 coalesce(l.promocao, 'N') AS promocao, l.vrpromo,
                 o.nome AS usuario, l.codoperador,
                 -- o anterior do lote é o custo/preço guardado nele; sem histórico não se inventa
                 h.valor_anterior AS valor_ant, l.origem, l.processado
            FROM lote_preco l
            LEFT JOIN produtos p       ON p.idproduto = l.idproduto
            LEFT JOIN familias_prod fa ON fa.codfamilia = p.coddpto
            LEFT JOIN operadores o     ON o.codoperador = l.codoperador
            LEFT JOIN multi_preco m    ON m.idproduto = l.idproduto AND m.idempresa = l.codempresa
            LEFT JOIN historico_dinamico h ON h.codhistorico = m.codhistorico
           WHERE l.codempresa = ${emp}
             AND l.datalote::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
             AND (${f.coddpto ?? null}::int IS NULL OR p.coddpto = ${f.coddpto ?? null}::int)
             AND (${produto}::text IS NULL
                  OR upper(coalesce(p.descricao, '')) LIKE ${produto}::text
                  OR coalesce(p.codbarra, '') LIKE ${produto}::text)
             AND (${f.semGrupoPreco} = 'N' OR coalesce(p.codgrupopreco, 0) = 0)
           ORDER BY fa.descricao, p.descricao
           LIMIT ${f.limite}
        `.execute(db)).rows
      : (await sql<Record<string, unknown>>`
          SELECT m.idproduto AS codproduto, p.codbarra, p.descricao,
                 fa.descricao AS dpto, m.dtultprecoalterado AS data,
                 CASE WHEN m.promocao = 'S' THEN m.vrpromo ELSE m.vrvenda END AS valor,
                 coalesce(m.promocao, 'N') AS promocao, m.vrpromo,
                 o.nome AS usuario, h.codoperador,
                 h.valor_anterior AS valor_ant, NULL::text AS origem, NULL::text AS processado
            FROM multi_preco m
            LEFT JOIN produtos p       ON p.idproduto = m.idproduto
            LEFT JOIN familias_prod fa ON fa.codfamilia = p.coddpto
            -- ⚠️ no legado este JOIN é INNER, e "codhistorico" só existe em 43% das linhas: 328 de 594
            -- alterações de agosto/2026 sumiam do relatório
            LEFT JOIN historico_dinamico h ON h.codhistorico = m.codhistorico
            LEFT JOIN operadores o     ON o.codoperador = h.codoperador
           WHERE m.idempresa = ${emp}
             AND m.dtultprecoalterado::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
             ${promo}
             AND (${f.coddpto ?? null}::int IS NULL OR p.coddpto = ${f.coddpto ?? null}::int)
             AND (${produto}::text IS NULL
                  OR upper(coalesce(p.descricao, '')) LIKE ${produto}::text
                  OR coalesce(p.codbarra, '') LIKE ${produto}::text)
             AND (${f.semGrupoPreco} = 'N' OR coalesce(p.codgrupopreco, 0) = 0)
           ORDER BY fa.descricao, p.descricao
           LIMIT ${f.limite}
        `.execute(db)).rows;

    let subiram = 0; let cairam = 0; let semAnterior = 0; let somaVar = 0; let comVar = 0;
    const saida = linhas.map((l) => {
      const atual = num(l.valor);
      const ant = numBr(l.valor_ant);
      if (ant == null) semAnterior += 1;
      else if (atual > ant) subiram += 1;
      else if (atual < ant) cairam += 1;
      const variacao = ant != null && ant !== 0 ? r2((atual / ant - 1) * 100) : null;
      if (variacao != null) { somaVar += variacao; comVar += 1; }
      return { ...l, valor_anterior: ant, variacao_perc: variacao, diferenca: ant == null ? null : r2(atual - ant) };
    });

    return {
      linhas: saida,
      totais: {
        itens: saida.length, subiram, caíram: cairam, semAnterior,
        variacaoMedia: comVar ? r2(somaVar / comVar) : 0,
      },
    };
  }

  /**
   * O Imprimir (`btnImprimirClick`) das origens Produtos e Lote de preço — o `cdsConsulta` no `frxDBDatasetPrecosAlterados` e a empresa
   * no `frxDBDataset1`, com OPERADOR_RELATORIO (o operador logado) e PERIODO ("dd/mm/aaaa à dd/mm/aaaa"):
   *  - Produtos: MULTI_PRECO por DTULTPRECOALTERADO nas lojas marcadas, o filtro de promoção (S, ou N/nulo) e o departamento;
   *  - Lote de preço: LOTEPRECO por DATALOTE, só o lote que ainda é o corrente da MULTI_PRECO (`JOIN MULTI_PRECO … CODLOTEPRECO`); o
   *    legado zera o filtro aqui (`Filtro := ''`): sem promoção e SEM departamento;
   *  - o histórico (VALOR_ANT e o operador) é LEFT, como a consulta deste serviço (o INNER do legado escondia 55% das alterações);
   *  - agrupamento por empresa → `Rel_PrecosAlterados.fr3` (FANTASIA, DPTO, DESCRIÇÃO); por departamento → `Rel_PrecosAlteradosPorProduto.fr3`
   *    (DPTO, DESCRIÇÃO, FANTASIA) — no lote, o legado troca a FANTASIA pela razão social da loja e não define relatório nenhum (o
   *    LoadFromFile da pasta falha): 422; loja em colunas (só Produtos) → `Rel_PrecosAlteradosPorEmpresa.fr3` com o `cdsEmpresasEmColunas`
   *    (`TRelatorioEmpresasEmColuna`: uma linha por código de barras na ordem da descrição, VALOR_EMPRESA1..10 com '##,###,#0.00' ou '-',
   *    e EMPRESA1..N "Empresa X" só na 1ª linha).
   * A origem "Lote de preço detalhado" chama a procedure POE_REL_PRECOS_ALTERADOS (338 linhas, com `ROWNUM = 1` dentro do ON da NF) —
   * fica de fora até a saída dela ser medida na produção.
   */
  async impressao(f: RelPrecosAlteradosDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    // o dmPrincipal.OperadorNOMEOPERADOR: o nome do operador logado
    const operadorNome = String((await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${currentTenant().operadorId ?? 0}`.execute(db)).rows[0]?.nome ?? '');
    const pedidas = f.empresas ? f.empresas.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : [];
    const emps = pedidas.length ? await empresasDoOperador(db, pedidas) : [emp];
    if (f.origem === 'LOTE' && f.agrupamento === 'DEPARTAMENTO') {
      throw new BusinessRuleError('PRECOS_ALTERADOS_SEM_RELATORIO', {}, 'O agrupamento por departamento não tem relatório na origem Lote de preço.');
    }
    if (f.origem === 'LOTE' && f.agrupamento === 'COLUNAS') {
      throw new BusinessRuleError('PRECOS_ALTERADOS_SEM_RELATORIO', {}, 'A loja em colunas só existe na origem Produtos.');
    }
    const ordem = f.agrupamento === 'DEPARTAMENTO' ? sql`dpto NULLS FIRST, descricao, fantasia` : f.agrupamento === 'COLUNAS' ? sql`descricao` : sql`fantasia NULLS FIRST, dpto NULLS FIRST, descricao`;
    const promo = f.promocao === 'PROMOCAO' ? sql`AND m.promocao = 'S'` : f.promocao === 'NORMAL' ? sql`AND (m.promocao = 'N' OR m.promocao IS NULL)` : sql``;
    const linhas = f.origem === 'LOTE'
      ? (await sql<Record<string, unknown>>`
          SELECT * FROM (
            SELECT e.idempresa AS codempresa, e.fantasia, fa.descricao AS dpto, p.descricao, p.codbarra, m.datalote AS data, o.codoperador AS codusualt,
                   m.vrvenda AS valor, 'N'::text AS promocao, o.nome AS usuario, h.valor_anterior AS valor_ant
              FROM lote_preco m
              LEFT JOIN produtos p       ON p.idproduto = m.idproduto
              LEFT JOIN familias_prod fa ON fa.codfamilia = p.coddpto
              LEFT JOIN empresas e       ON e.idempresa = m.codempresa
              JOIN multi_preco mu        ON mu.idproduto = m.idproduto AND mu.idempresa = m.codempresa AND mu.codlotepreco = m.codlotepreco
              LEFT JOIN historico_dinamico h ON h.codhistorico = mu.codhistorico
              LEFT JOIN operadores o     ON o.codoperador = h.codoperador
             WHERE m.datalote::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
               AND m.codempresa = ANY(${emps})) x
           ORDER BY ${ordem}
           LIMIT 20001`.execute(db)).rows
      : (await sql<Record<string, unknown>>`
          SELECT * FROM (
            SELECT e.idempresa AS codempresa, e.fantasia, fa.descricao AS dpto, p.descricao, p.codbarra,
                   CASE m.promocao WHEN 'S' THEN m.vrpromo ELSE m.vrvenda END AS valor, m.promocao,
                   m.dtultprecoalterado AS data, o.nome AS usuario, o.codoperador AS codusualt, h.valor_anterior AS valor_ant
              FROM multi_preco m
              LEFT JOIN produtos p       ON p.idproduto = m.idproduto
              LEFT JOIN familias_prod fa ON fa.codfamilia = p.coddpto
              LEFT JOIN empresas e       ON e.idempresa = m.idempresa
              LEFT JOIN historico_dinamico h ON h.codhistorico = m.codhistorico
              LEFT JOIN operadores o     ON o.codoperador = h.codoperador
             WHERE m.dtultprecoalterado::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
               ${promo}
               AND (${f.coddpto ?? null}::int IS NULL OR p.coddpto = ${f.coddpto ?? null}::int)
               AND m.idempresa = ANY(${emps})) x
           ORDER BY ${ordem}
           LIMIT 20001`.execute(db)).rows;
    if (!linhas.length) throw new BusinessRuleError('PRECOS_ALTERADOS_SEM_DADOS', {}, 'Não foram encontrados registros para gerar o relatório.');
    const br = (x: string) => x.split('-').reverse().join('/');
    const nums = new Set(['codempresa', 'valor', 'codusualt']);
    const datasets: Record<string, unknown[]> = {
      frxDBDatasetPrecosAlterados: linhas.map((l) => registroFr3(l, nums)),
      frxDBDataset1: [await empresaParaRelatorio(db, emp)],
    };
    let arquivo = f.agrupamento === 'DEPARTAMENTO' ? 'Rel_PrecosAlteradosPorProduto.fr3' : 'Rel_PrecosAlterados.fr3';
    if (f.agrupamento === 'COLUNAS') {
      arquivo = 'Rel_PrecosAlteradosPorEmpresa.fr3';
      // o Mapeia: as lojas marcadas que existem, em ordem de código, viram as colunas 1..N
      const ids = (await sql<{ idempresa: number }>`SELECT idempresa FROM empresas WHERE idempresa = ANY(${emps}) ORDER BY idempresa`.execute(db)).rows.map((r) => Number(r.idempresa));
      const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const colunas: Array<Record<string, unknown>> = [];
      linhas.forEach((l, k) => {
        let r = colunas.find((x) => x.CODBARRA === (l.codbarra ?? ''));
        if (!r) { r = { DESCRICAO: l.descricao ?? '', CODBARRA: l.codbarra ?? '', DPTO: l.dpto ?? '' }; colunas.push(r); }
        const idx = ids.indexOf(Number(l.codempresa));
        if (idx < 0) throw new BusinessRuleError('PRECOS_ALTERADOS_EMPRESA', { codempresa: l.codempresa }, `Índice da empresa ${l.codempresa} não encontrado.`);
        r[`VALOR_EMPRESA${idx + 1}`] = fmt(num(l.valor));
        if (k === 0) ids.forEach((id, i) => { r![`EMPRESA${i + 1}`] = `Empresa ${id}`; });
      });
      for (const r of colunas) for (let i = 1; i <= 10; i++) if (r[`VALOR_EMPRESA${i}`] == null || r[`VALOR_EMPRESA${i}`] === '') r[`VALOR_EMPRESA${i}`] = '-';
      datasets.frxEmpresasEmColunas = colunas;
    }
    return {
      titulo: 'Preços alterados',
      modelo: await modeloFr3(db, arquivo),
      datasets,
      variaveis: { OPERADOR_RELATORIO: textoVariavel(operadorNome), PERIODO: textoVariavel(`${br(f.dataIni)} à ${br(f.dataFim)}`) },
    };
  }
}
