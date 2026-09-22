import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { normalizaTipoAliquota } from '@apollo/shared';
import type { NfIbsCbsCalculoDto, NfIbsCbsConsultaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

const num = (v: unknown) => (v == null ? 0 : Number(v));
/**
 * ⚠️ `TIPO_ALIQUOTA` decide se o item é calculável, e o valor tem ACENTO ("Padrão", "Sem alíquota"). Uma
 * comparação literal quebraria em silêncio se a carga corrompesse o encoding — e o efeito seria pesado: com
 * "Padrão" não casando, TODO item viraria tratamento próprio e nenhuma nota calcularia. Por isso a
 * comparação é por PREFIXO SEM DIACRÍTICO, que sobrevive tanto a "Padrao" quanto a "Padr?o".
 * (Não é hipótese: a mesma armadilha derrubou uma consulta desta auditoria contra o Oracle,
 * onde `tipo_aliquota <> 'Padrão'` casou com tudo.)
 */
const semAcento = normalizaTipoAliquota;  // a MESMA do shared que valida o schema: uma verdade só
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;

/**
 * REFORMA TRIBUTÁRIA IBS/CBS — corte-2: os grupos na NOTA. Migration 279. Dossiê `uCadIBSCBS.md` §9.
 *
 * FOLD DECLARADO — imposto seletivo: o legado **não o implementa**. Nem `NF_PROD_IBSCBS` nem `NF_IBSCBS`
 * têm qualquer coluna de IS (conferido no dicionário do Oracle); `CSTIS`/`CCLASSTRIBIS` só existem na
 * staging `INTEGRACAO_IBSCBS`, que tem 0 linhas. O nosso parâmetro (`tributacao_reforma.imposto_seletivo`)
 * está semeado em 0 para 2026 e 2033. Não há leiaute nem dado para migrar — é frente nova, e não pequena:
 * o cliente tem **3.276 produtos classificados com NCM de bebida (cap. 22) ou fumo (cap. 24)**, que são
 * justamente as categorias do IS.
 *
 * ⚠️ A regra central, medida em 97.005 itens de produção: o valor sai da alíquota **efetiva**, e a efetiva
 * se DERIVA da redução (`cheia × (1 − predaliq/100)`) em vez de ser lida da coluna que o legado grava.
 * Derivando acerta 96.966 no IBS (99,96%) e 89.277 na CBS; lendo `PALIQEFET_CBS`, só 56.129 — a coluna fica
 * em 0 em 46.677 itens cuja redução é 0. E quem usar a alíquota CHEIA cobra **R$ 103.951,14 a mais** nos
 * 31.633 itens com redução (23× no IBS e na CBS).
 */
@Injectable()
export class NfIbsCbsService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp() { return currentTenant().empresaId; }

  /**
   * A alíquota efetiva. É UMA função para os três tributos de propósito: o erro que ela evita é aplicar a
   * redução a um e esquecer do outro, e a redução de IBS e a de CBS são independentes (mig 278).
   */
  private efetiva(cheia: number, reducaoPct: number) {
    return r4(cheia * (1 - reducaoPct / 100));
  }

  /**
   * Recalcula os grupos da nota a partir da classificação de cada produto, e grava item e cabeçalho.
   *
   * O que vier do XML do fornecedor é preservado nas colunas `_ORI` — sem esse par não há conferência, e
   * no cliente **36.278 itens têm base diferente da que o fornecedor mandou** (R$ 4,9 milhões).
   */
  async calcular(d: NfIbsCbsCalculoDto) {
    const empresaId = this.emp();
    // ⚠️ TUDO NUMA TRANSAÇÃO SÓ. São N gravações de item mais a do cabeçalho, e o cabeçalho afirma uma
    // identidade sobre os itens (`vibs = vibsuf + vibsmun`, exata em 10.012/10.012 notas do cliente).
    // Gravar fora de transação deixaria, numa falha no meio do laço, metade dos itens novos e o cabeçalho
    // velho — ou seja, um total que não corresponde a nenhuma versão dos itens. É o mesmo defeito que eu
    // apontei no legado da precificação por NF bruta (mig 273: `Commit` dentro do laço), e aqui seria pior,
    // porque é documento fiscal.
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (db: AnyDB) => {

    const nf = (await sql<{ codnf: number; uf: string | null; data_ref: string | null }>`
        SELECT f.codnf, coalesce(e.uf, pe.uf) AS uf,
               -- como TEXTO: o driver devolveria um Date, e String(date).slice(0,10) da "Tue Mar 10"
               -- em vez de "2026-03-10", o que o Postgres recusa com 22007 no ::date seguinte
               to_char(coalesce(f.dtemissao, f.dtcontabil), 'YYYY-MM-DD') AS data_ref
          FROM nf f
          LEFT JOIN empresas e ON e.idempresa = f.idempresa
          -- a UF que decide o IBS e a do ESTABELECIMENTO (e ele que recolhe); o endereco do parceiro
          -- entra so como reserva, e a tabela de parceiros nao guarda UF: ela mora no endereco.
          LEFT JOIN parceiros_end pe ON pe.codparceiro = f.codparceiro AND coalesce(pe.endereco_padrao, 'S') = 'S'
         WHERE f.codnf = ${d.codnf} AND f.idempresa = ${empresaId}
         LIMIT 1`.execute(db)).rows[0];
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf: d.codnf });

    // a alíquota vigente: o parâmetro com vigência (mig 007) manda, e `ibs_uf` entra só como reserva
    // ⚠️ A ALÍQUOTA VALE NA DATA DA NOTA, NÃO HOJE. A reforma sobe por degraus: 0,1% de IBS + 0,9% de CBS
    // na fase-teste de 2026 e **26,5% no regime pleno de 2033** (17,7 + 8,8, o que a mig 007 já semeia).
    // Buscar por `current_date` faria o recálculo de uma nota de 2026 feito em 2033 aplicar 26,5× a
    // alíquota certa — e recalcular nota antiga é rotina de conferência fiscal, não exceção.
    const dataRef = String(nf.data_ref ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const aliq = (await sql<{ ibs: number | null; cbs: number | null; ibs_tab: number | null }>`
        SELECT (SELECT r.ibs FROM tributacao_reforma r
                 WHERE r.uf = ${nf.uf ?? ''} AND r.vigencia_inicio <= ${dataRef}::date
                 ORDER BY r.vigencia_inicio DESC LIMIT 1) AS ibs,
               (SELECT r.cbs FROM tributacao_reforma r
                 WHERE r.uf = ${nf.uf ?? ''} AND r.vigencia_inicio <= ${dataRef}::date
                 ORDER BY r.vigencia_inicio DESC LIMIT 1) AS cbs,
               (SELECT u.valor_ibs_uf FROM ibs_uf u WHERE u.uf = ${nf.uf ?? ''}) AS ibs_tab`
      .execute(db)).rows[0];
    const pIbsUf = num(aliq?.ibs ?? aliq?.ibs_tab);
    const pCbs = num(aliq?.cbs);
    if (pIbsUf === 0 && pCbs === 0)
      throw new BusinessRuleError('ALIQUOTA_REFORMA_AUSENTE', { uf: nf.uf, codnf: d.codnf });

    // cada item com a classificação do seu produto (a redução mora nela, e são DUAS)
    const itens = (await sql<Record<string, unknown>>`
        SELECT i.codnfprod, i.codproduto, i.total_produto_nota, i.quantidade, i.vrcusto, i.desconto,
               i.vricm, i.vrpise, i.vrcofinse, i.ncm, i.quantidade AS qtd_is,
               (SELECT s2.aliquota FROM imposto_seletivo_ncm s2
                 WHERE i.ncm LIKE s2.ncm || '%' AND s2.vigencia_inicio <= ${dataRef}::date
                 ORDER BY length(s2.ncm) DESC, s2.vigencia_inicio DESC LIMIT 1) AS is_aliquota,
               (SELECT s2.valor_por_unidade FROM imposto_seletivo_ncm s2
                 WHERE i.ncm LIKE s2.ncm || '%' AND s2.vigencia_inicio <= ${dataRef}::date
                 ORDER BY length(s2.ncm) DESC, s2.vigencia_inicio DESC LIMIT 1) AS is_unitario,
               t.class_trib, t.cst, t.pred_ibs, t.pred_cbs, t.tipo_aliquota, t.ind_redutor_bc,
               s.ind_gibscbs, s.ind_gibscbsmono,
               (SELECT n.codcclass_trib_ncm FROM cclass_trib_ncm n
                 WHERE n.cclass_trib = t.class_trib AND n.codigo_ncm = i.ncm LIMIT 1) AS codcclass_trib_ncm,
               g.cst AS cst_atual, g.cclasstrib AS cclass_atual, g.vbc AS vbc_atual,
               g.cst_ori, g.cclasstrib_ori, g.vbc_ori
          FROM nf_prod i
          LEFT JOIN produtos p ON p.idproduto = i.codproduto
          LEFT JOIN class_trib t ON t.codclass_trib = p.codclass_trib AND coalesce(t.indr, 'I') <> 'E'
          LEFT JOIN cst_ibs_cbs s ON s.cst = t.cst
          LEFT JOIN nf_prod_ibscbs g ON g.codnfprod = i.codnfprod
         WHERE i.codnf = ${d.codnf}
         ORDER BY i.nroitem`.execute(db)).rows;
    if (!itens.length) throw new BusinessRuleError('NF_SEM_ITENS', { codnf: d.codnf });

    const semClasse = itens.filter((i) => i.class_trib == null).length;
    if (semClasse > 0 && !d.permitir_sem_classificacao)
      throw new BusinessRuleError('PRODUTO_SEM_CLASSIFICACAO', { codnf: d.codnf, itens: semClasse });

    // ⚠️ A TRAVA DA MIG 280: nem toda classificação se calcula pela alíquota da UF, e os dois
    // indicadores discordam entre si — só a CONJUNÇÃO fecha (56 das 132 classificações do cliente).
    // `IND_GIBSCBS = 1` não garante alíquota percentual (510 diferimento, 550 suspensão, 830 exclusão de
    // base e 220 fixa têm o grupo e não têm alíquota); e `TIPO_ALIQUOTA = 'Padrão'` não garante fórmula
    // simples (210 e 222 trazem redutor de BASE além da redução de alíquota).
    const tratamentoDe = (i: Record<string, unknown>): 'calculado' | 'nao_tributado' | 'monofasico' | 'proprio' => {
      if (i.class_trib == null) return 'calculado';           // sem classificação: integral (ver acima)
      if (Number(i.ind_gibscbsmono ?? 0) === 1) return 'monofasico';
      const tipo = semAcento(i.tipo_aliquota);
      const temGrupo = Number(i.ind_gibscbs ?? 0) === 1;
      const redutorBase = String(i.ind_redutor_bc ?? 'N') === 'S';
      if (tipo.startsWith('padr') && temGrupo && !redutorBase) return 'calculado';
      // grupo ausente e sem alíquota = isenção (400), imunidade (410), transferência de crédito (800),
      // regime específico (820): ZERO, e zero DECLARADO — o cliente tem 17 produtos imunes circulando.
      if (!temGrupo && tipo.startsWith('sem al')) return 'nao_tributado';
      return 'proprio';
    };
    const proprios = itens
      .map((i) => ({ i, t: tratamentoDe(i) }))
      .filter((x) => x.t === 'proprio');
    if (proprios.length)
      // inventar número onde não se sabe calcular é pior do que parar
      throw new BusinessRuleError('CLASSIFICACAO_EXIGE_TRATAMENTO_PROPRIO', {
        codnf: d.codnf,
        itens: proprios.map((x) => ({
          codnfprod: Number(x.i.codnfprod), cclasstrib: x.i.class_trib,
          cst: x.i.cst, tipo_aliquota: x.i.tipo_aliquota,
          motivo: String(x.i.ind_redutor_bc ?? 'N') === 'S' ? 'redutor de base de cálculo'
                  : `alíquota ${semAcento(x.i.tipo_aliquota) || 'indefinida'}`,
        })),
      });

    const tot = { vbc: 0, ibsuf: 0, ibsmun: 0, cbs: 0, vis: 0 };
    const linhas: Array<Record<string, unknown>> = [];

    for (const i of itens) {
      // ⚠️ A BASE NÃO É O VALOR CHEIO: o imposto não entra na base do imposto. A LC 214/2025 (art. 12,
      // § 2º) exclui da base do IBS e da CBS o montante do ICMS, do ISS, do PIS e da COFINS — e o dado do
      // cliente confirma com precisão: `valor do produto − ICMS − PIS − COFINS` reproduz a `VBC` do
      // legado em **86.201 dos 87.815 itens (98,2%)**, contra 54.016 (61,5%) do valor cheio que eu usava
      // antes. O erro era inflar a base em **R$ 806.350,38** e cobrar a mais: R$ 8.063,50 na fase-teste
      // de 1% e **R$ 213.682,85** no regime pleno de 26,5%.
      // O "valor do produto" é o total da nota quando existe; em 20.058 itens ele vem zerado e o legado
      // usa quantidade × custo (acerta 19.511 desses 20.058 com a mesma subtração).
      const valorProduto = num(i.total_produto_nota) || num(i.quantidade) * num(i.vrcusto);
      const tributosNaBase = num(i.vricm) + num(i.vrpise) + num(i.vrcofinse);
      // ⚠️ O IMPOSTO SELETIVO INTEGRA A BASE — é a EXCEÇÃO à regra de cima (mig 282). ICMS, ISS, PIS e
      // COFINS saem da base (art. 12, §2º); o IS **entra** (art. 12, §1º). Logo ele é apurado ANTES e
      // somado, nunca calculado depois sobre a base já fechada — inverter subtributa o IBS/CBS em toda
      // linha que tiver IS. A LC prevê as duas formas, ad valorem e por unidade, e as duas somam.
      const isAliq = num(i.is_aliquota);
      const isUnit = num(i.is_unitario);
      const liquido = Math.max(0, valorProduto - tributosNaBase);
      const vis = r2((liquido * isAliq) / 100 + num(i.qtd_is) * isUnit);
      const vbc = r2(liquido + vis);
      // ⚠️ DECISÃO EXPLÍCITA, não efeito de `null` virando 0: item cujo produto não tem classificação é
      // tributado INTEGRAL (redução 0). É o conservador — paga o imposto cheio em vez de zerar o que não
      // se sabe — e é o que o legado faz, onde a CST padrão é 000 (tributação integral). Zerar seria
      // sonegar em silêncio. O caminho normal recusa a nota antes de chegar aqui
      // (422 PRODUTO_SEM_CLASSIFICACAO); isto só roda com `permitir_sem_classificacao`, e a resposta
      // devolve quantos itens saíram assim para que o cheio fique declarado.
      const semClassificacao = i.class_trib == null;
      const tratamento = tratamentoDe(i);
      // imunidade, isenção e monofasia não pagam AQUI: a alíquota é zero e o motivo fica gravado
      const tributa = tratamento === 'calculado';
      const redIbs = semClassificacao ? 0 : num(i.pred_ibs);
      const redCbs = semClassificacao ? 0 : num(i.pred_cbs);
      const efIbsUf = tributa ? this.efetiva(pIbsUf, redIbs) : 0;
      const efCbs = tributa ? this.efetiva(pCbs, redCbs) : 0;
      const vibsuf = r2((vbc * efIbsUf) / 100);
      const vcbs = r2((vbc * efCbs) / 100);
      const cheiaIbsUf = tributa ? pIbsUf : 0;
      const cheiaCbs = tributa ? pCbs : 0;
      // IBS municipal: a fase-teste de 2026 não cobra (zerado nas 10.012 notas do cliente)
      const pIbsMun = 0, efIbsMun = 0, vibsmun = 0;

      // ⚠️ O par `_ORI` é PROCEDÊNCIA: é o que veio no XML do fornecedor (ou na carga do legado), e só isso.
      // A versão anterior caía para o valor ATUAL quando a origem estava vazia — ou seja, carimbava o
      // resultado do nosso primeiro cálculo como se fosse o que o fornecedor mandou. Isso inventa uma
      // procedência e destrói a conferência: a partir daí a nota "nunca diverge", porque o original passa
      // a ser a nossa própria conta. Aqui só se PRESERVA o que já existe; criar é trabalho de quem recebe
      // o documento, não de quem recalcula.
      const cstOri = i.cst_ori ?? null;
      const cclassOri = i.cclasstrib_ori ?? null;
      const vbcOri = i.vbc_ori ?? null;

      await sql`
        INSERT INTO nf_prod_ibscbs (codnfprod, codnf, idempresa, codproduto, cst, cclasstrib, vbc,
                                    pibsuf, predaliq_ibsuf, paliqefet_ibsuf, vibsuf,
                                    pibsmun, predaliq_ibsmun, paliqefet_ibsmun, vibsmun,
                                    pcbs, predaliq_cbs, paliqefet_cbs, vcbs,
                                    codcclass_trib_ncm, cst_ori, cclasstrib_ori, vbc_ori, tratamento,
                                    vis, pis_seletivo)
        VALUES (${i.codnfprod}, ${d.codnf}, ${empresaId}, ${i.codproduto}, ${i.cst ?? null},
                ${i.class_trib ?? null}, ${vbc},
                ${cheiaIbsUf}, ${redIbs}, ${efIbsUf}, ${vibsuf},
                ${pIbsMun}, ${0}, ${efIbsMun}, ${vibsmun},
                ${cheiaCbs}, ${redCbs}, ${efCbs}, ${vcbs},
                ${i.codcclass_trib_ncm ?? null}, ${cstOri}, ${cclassOri}, ${vbcOri}, ${tratamento},
                ${vis}, ${isAliq})
        ON CONFLICT (codnfprod) DO UPDATE SET
          -- codnf/codproduto também: o item pode ter trocado de produto entre um cálculo e outro, e um
          -- grupo apontando o produto errado passaria despercebido (os valores seriam recalculados certos)
          codnf = excluded.codnf, idempresa = excluded.idempresa, codproduto = excluded.codproduto,
          cst = excluded.cst, cclasstrib = excluded.cclasstrib, vbc = excluded.vbc,
          pibsuf = excluded.pibsuf, predaliq_ibsuf = excluded.predaliq_ibsuf,
          paliqefet_ibsuf = excluded.paliqefet_ibsuf, vibsuf = excluded.vibsuf,
          pcbs = excluded.pcbs, predaliq_cbs = excluded.predaliq_cbs,
          paliqefet_cbs = excluded.paliqefet_cbs, vcbs = excluded.vcbs,
          codcclass_trib_ncm = excluded.codcclass_trib_ncm,
          tratamento = excluded.tratamento,
          vis = excluded.vis, pis_seletivo = excluded.pis_seletivo
          -- as colunas _ori NAO entram neste SET de proposito: recalcular nao reescreve a procedencia
          `.execute(db);

      tot.vbc = r2(tot.vbc + vbc);
      tot.ibsuf = r2(tot.ibsuf + vibsuf);
      tot.ibsmun = r2(tot.ibsmun + vibsmun);
      tot.cbs = r2(tot.cbs + vcbs);
      tot.vis = r2(tot.vis + vis);
      linhas.push({
        codnfprod: Number(i.codnfprod), codproduto: Number(i.codproduto),
        cst: i.cst ?? null, cclasstrib: i.class_trib ?? null, vbc,
        valor_produto: r2(valorProduto), tributos_excluidos: r2(tributosNaBase),
        vis, pis_seletivo: isAliq,
        pibsuf: cheiaIbsUf, predaliq_ibsuf: redIbs, paliqefet_ibsuf: efIbsUf, vibsuf,
        pcbs: cheiaCbs, predaliq_cbs: redCbs, paliqefet_cbs: efCbs, vcbs,
        sem_classificacao: semClassificacao, tratamento,
      });
    }

    // `VIBS = VIBSUF + VIBSMUN` — exato em 10.012 de 10.012 notas do cliente
    const vibs = r2(tot.ibsuf + tot.ibsmun);
    await sql`
      INSERT INTO nf_ibscbs (codnf, idempresa, vbcibscbs, vibsuf, vibsmun, vibs, vcbs, vis)
      VALUES (${d.codnf}, ${empresaId}, ${tot.vbc}, ${tot.ibsuf}, ${tot.ibsmun}, ${vibs}, ${tot.cbs},
              ${tot.vis})
      ON CONFLICT (codnf) DO UPDATE SET
        vbcibscbs = excluded.vbcibscbs, vibsuf = excluded.vibsuf, vibsmun = excluded.vibsmun,
        vibs = excluded.vibs, vcbs = excluded.vcbs, vis = excluded.vis`.execute(db);

    return {
      codnf: d.codnf, uf: nf.uf, data_referencia: dataRef, aliquota: { ibsuf: pIbsUf, cbs: pCbs },
      totais: { vbcibscbs: tot.vbc, vibsuf: tot.ibsuf, vibsmun: tot.ibsmun, vibs, vcbs: tot.cbs, vis: tot.vis },
      itens: linhas, sem_classificacao: semClasse,
      // o que NÃO foi tributado e por quê — para que o zero apareça na conferência em vez de sumir
      tratamentos: linhas.reduce<Record<string, number>>((acc, l) => {
        const k = String(l.tratamento);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    };
    });
  }

  /**
   * Os grupos de uma nota, com o par de conferência lado a lado. `so_divergentes` traz só o que a
   * conferência mudou em relação ao XML do fornecedor — no cliente são 36.278 itens (R$ 4,9 milhões de
   * base) e 9.530 reclassificações de CST, das quais 7.753 de 000 para 200.
   */
  async consultar(q: NfIbsCbsConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresaId = this.emp();
    const cab = (await sql<Record<string, unknown>>`
        SELECT h.* FROM nf_ibscbs h WHERE h.codnf = ${q.codnf} AND h.idempresa = ${empresaId}`
      .execute(db)).rows[0];
    const itens = (await sql<Record<string, unknown>>`
        SELECT g.*, p.nroitem, p.descricao, t.nome_class_trib
          FROM nf_prod_ibscbs g
          LEFT JOIN nf_prod p ON p.codnfprod = g.codnfprod
          -- SEM filtrar estornadas: isto é HISTÓRICO. Se a classificação foi estornada depois de a nota
          -- ser calculada, o nome ainda tem de aparecer — esconder deixaria a nota antiga sem descrição.
          LEFT JOIN class_trib t ON t.class_trib = g.cclasstrib
         WHERE g.codnf = ${q.codnf} AND g.idempresa = ${empresaId}
           AND (NOT ${q.so_divergentes}::boolean
                OR (g.cst_ori IS NOT NULL
                    AND (g.cst_ori IS DISTINCT FROM g.cst
                         OR g.cclasstrib_ori IS DISTINCT FROM g.cclasstrib
                         OR g.vbc_ori IS DISTINCT FROM g.vbc)))
         ORDER BY p.nroitem, g.codnfprod`.execute(db)).rows;

    const n = (v: unknown) => (v == null ? null : Number(v));
    return {
      cabecalho: cab == null ? null : {
        codnf: Number(cab.codnf), vbcibscbs: num(cab.vbcibscbs), vibsuf: num(cab.vibsuf),
        vibsmun: num(cab.vibsmun), vibs: num(cab.vibs), vcbs: num(cab.vcbs),
        vdif: num(cab.vdif), vdevtrib: num(cab.vdevtrib), vcredpres: num(cab.vcredpres),
        vcredprescondsus: num(cab.vcredprescondsus),
        // a identidade que o cliente cumpre em 10.012/10.012 — se quebrar aqui, o cabeçalho está podre
        ibs_fecha: r2(num(cab.vibsuf) + num(cab.vibsmun)) === r2(num(cab.vibs)),
      },
      itens: itens.map((g) => ({
        codnfprod: Number(g.codnfprod), nroitem: n(g.nroitem), descricao: g.descricao ?? null,
        codproduto: Number(g.codproduto), cst: g.cst ?? null, cclasstrib: g.cclasstrib ?? null,
        nome_class_trib: g.nome_class_trib ?? null,
        vbc: num(g.vbc), pibsuf: n(g.pibsuf), predaliq_ibsuf: n(g.predaliq_ibsuf),
        paliqefet_ibsuf: n(g.paliqefet_ibsuf), vibsuf: num(g.vibsuf),
        pcbs: n(g.pcbs), predaliq_cbs: n(g.predaliq_cbs), paliqefet_cbs: n(g.paliqefet_cbs),
        vcbs: num(g.vcbs), vis: num(g.vis), pis_seletivo: num(g.pis_seletivo),
        tratamento: g.tratamento ?? 'calculado',
        cst_ori: g.cst_ori ?? null, cclasstrib_ori: g.cclasstrib_ori ?? null, vbc_ori: n(g.vbc_ori),
        divergencias: [
          g.cst_ori != null && g.cst_ori !== g.cst ? 'cst' : null,
          g.cclasstrib_ori != null && g.cclasstrib_ori !== g.cclasstrib ? 'cclasstrib' : null,
          g.vbc_ori != null && r2(num(g.vbc_ori)) !== r2(num(g.vbc)) ? 'vbc' : null,
        ].filter((x): x is string => x != null),
      })),
    };
  }
}
