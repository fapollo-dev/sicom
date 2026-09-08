import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { lancarNoDiario, type RegistroDataSet } from './integracao-contabil.motor';

type AnyDB = Kysely<any>;
type Lado = 'AP' | 'AR';
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** `TTipoOrigemContabil` (`UIntegracaoContabil.pas:17-27`) — a baixa e os três acessórios de cada lado. */
const ORIGEM = {
  AP: { baixa: 15, juros: 53, acrescimo: 54, desconto: 55 },
  AR: { baixa: 16, juros: 56, acrescimo: 57, desconto: 58 },
} as const;

/** as colunas mudam de nome entre os dois lados; o resto do fluxo é o mesmo. */
const MAPA = {
  // ⚠️ o legado chama de IDEMPRESA nas duas tabelas; no destino a de A PAGAR virou `codempresa` (é assim que
  // a carga a traz). O nome muda, a coluna é a mesma.
  AP: { bx: 'apagar_bx', tit: 'apagar', pk: 'codapgbx', fk: 'codapg', emp: 'codempresa',
        contaTitulo: 'codplanocontas_deb_baixa_cp', contaParceiro: 'codcontabil_for' },
  AR: { bx: 'areceber_bx', tit: 'areceber', pk: 'codrcbbx', fk: 'codrcb', emp: 'codempresa',
        contaTitulo: 'codplanocontas_cred_baixa_cr', contaParceiro: 'codcontabil' },
} as const;

interface BaixaDoLote {
  codbx: number;
  coddoc: number;
  valor: number;
  dtpgto: string;
  codparceiro: number | null;
  codplanocontas: number | null;
  acre_desc: number;
  juros: number;
  codplc_acredesc: number;
  codplc_juros: number;
}

interface MovDoLote { codmovconta: number; valor: number; valor_original: number; codplanocontas: number | null; codconta: number }

export interface ResultadoBaixaTron { lotes: number; baixas: number; lancamentos: number; total: number }

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — corte-2: **BAIXAS DE CONTAS A PAGAR (15) e A RECEBER (16)** e os acessórios
 * de cada uma: juros (53/56), acréscimos (54/57) e descontos (55/58).
 * `UIntegracaoContabil.pas`: `TIntegracaoContabilBaixaContasPagar` :1587-1940 ·
 * `TIntegracaoContabilBaixaContasReceber` :3481-3849. Opções 3 e 4 do radio (`uTron.pas:2105-2106`).
 * Motor compartilhado: `integracao-contabil.motor.ts`. Dossiê: `uTron-integracao-contabil.md`.
 *
 * O ciclo é por LOTE de baixa, como no cartão, e o lançamento sai **assimétrico** porque as duas pernas da
 * situação são automáticas: uma linha por BAIXA do lado do parceiro e uma linha por MOVIMENTAÇÃO BANCÁRIA do
 * lado do dinheiro. É exatamente o que o razão do cliente mostra — na origem 15, 42.178 linhas só-débito
 * (as baixas) contra 5.417 só-crédito (as saídas do banco).
 *
 * A reconciliação contra produção fechou em 100% no lado A RECEBER, campo a campo: crédito 18.070/18.070 com
 * valor `VALORPG`, conta `COALESCE(ARECEBER.CODPLANOCONTAS_CRED_BAIXA_CR, PARCEIROS.CODCONTABIL)`, documento
 * `CODRCB` e complemento `CODRCB`; débito 17.618/17.618 com a conta do banco, `ABS(VALOR)` e complemento
 * `IDLOTE`. No A PAGAR o valor bate em 99,8% e o documento em 100% (a conta do parceiro mudou de cadastro em
 * parte da base ao longo de seis anos).
 *
 * ⚠️ **divergência consciente — multi-empresa**: como no corte-1, rodamos na empresa do tenant; o legado varre
 * o banco inteiro e tira o `IDEMPRESA` da própria linha.
 *
 * Convivência com o **auto-disparo** (`baixa-contabil.service`, que contabiliza a baixa feita no app na hora):
 * não há dupla contagem — os dois filtram `CONTABILIZADO = 'N'`. O auto-disparo cobre o que nasce aqui dentro,
 * este caminho cobre o lote e o que veio da carga. No legado só existe este.
 */
@Injectable()
export class BaixaTronContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** `TIntegracaoContabil.PeriodoFechado` (:282) — o mesmo gate do corte-1. */
  private async assertPeriodoAberto(db: AnyDB, dataFim: string): Promise<void> {
    const cfg = (await db.selectFrom('config_integracao_contabil').select('chaveamento_periodo').executeTakeFirst()) as
      { chaveamento_periodo: unknown } | undefined;
    if (!cfg) throw new BusinessRuleError('CONFIG_INTEGRACAO_NAO_DEFINIDA');
    const chav = cfg.chaveamento_periodo == null ? null : String(cfg.chaveamento_periodo).slice(0, 10);
    if (chav && dataFim <= chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: chav });
  }

  /**
   * Os lotes a integrar (`GetSQLApagarBXLotes` :1616 · `GetSQLReceberBXLotes` :3519): não contabilizada,
   * `VALORPG > 0`, `INDR = 'I'` (a baixa não estornada) e o título **sem desconto de duplicata**
   * (`COD_DESCONTO_TITULO IS NULL`), que tem contabilização própria.
   *
   * ⚠️ o filtro do desconto de duplicata é do LOTE, não da baixa: quem seleciona as baixas
   * (`GetSQLApagarBX` :1606) só olha contabilizado/valor/INDR e pega **todas** as do lote qualificado. Ou seja,
   * um título descontado que divida lote com um título normal ENTRA no lançamento. Copiamos o código como
   * está e a contagem daqui usa a mesma regra, para a prévia não prometer diferente do que vai ser gravado.
   * O caso nunca ocorreu no cliente: **zero lotes mistos** (e nenhuma das 18 baixas AP / 25 AR de título
   * descontado chegou ao razão).
   */
  async lotesPendentes(lado: Lado, p: { dataIni: string; dataFim: string; idlote?: number | null }): Promise<Array<{ idlote: number; baixas: number; total: number }>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const m = MAPA[lado];
    const rows = (await sql<Record<string, unknown>>`
      WITH elegiveis AS (   -- os LOTES (aqui vale o filtro do desconto de duplicata)
        SELECT b.idlote
          FROM ${sql.table(m.bx)} b
          JOIN ${sql.table(m.tit)} t ON t.${sql.ref(m.fk)} = b.${sql.ref(m.fk)}
         WHERE coalesce(b.contabilizado,'N') = 'N'
           AND b.valorpg > 0
           AND coalesce(b.indr,'I') = 'I'
           AND t.cod_desconto_titulo IS NULL
           AND t.${sql.ref(m.emp)} = ${emp}
           AND b.idlote IS NOT NULL
           AND ((${p.idlote ?? null}::int IS NOT NULL AND b.idlote = ${p.idlote ?? null}::int)
             OR (${p.idlote ?? null}::int IS NULL AND b.dtpgto::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
         GROUP BY b.idlote
      )
      SELECT b.idlote, count(*)::int AS baixas, sum(b.valorpg) AS total  -- as BAIXAS do lote (aqui não vale)
        FROM ${sql.table(m.bx)} b
        JOIN ${sql.table(m.tit)} t ON t.${sql.ref(m.fk)} = b.${sql.ref(m.fk)}
       WHERE b.idlote IN (SELECT idlote FROM elegiveis)
         AND coalesce(b.contabilizado,'N') = 'N'
         AND b.valorpg > 0
         AND coalesce(b.indr,'I') = 'I'
         AND t.${sql.ref(m.emp)} = ${emp}
       GROUP BY b.idlote
       ORDER BY b.idlote
    `.execute(db)).rows;
    return rows.map((r) => ({ idlote: Number(r.idlote), baixas: Number(r.baixas), total: r2(num(r.total)) }));
  }

  /** INTEGRAR um dos lados, lote a lote, numa transação só. */
  async integrar(lado: Lado, p: { dataIni: string; dataFim: string; idlote?: number | null }): Promise<ResultadoBaixaTron> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodoAberto(db, p.dataFim);
    const lotes = await this.lotesPendentes(lado, p);
    if (!lotes.length) return { lotes: 0, baixas: 0, lancamentos: 0, total: 0 };

    const cfg = (await db.selectFrom('config_integracao_contabil').selectAll().executeTakeFirstOrThrow()) as Record<string, number | null>;
    const sitBaixa = lado === 'AP' ? cfg.config_baixa_apg : cfg.config_baixa_rcb;
    if (sitBaixa == null) throw new BusinessRuleError('SITUACAO_NAO_CONFIGURADA', { qual: lado === 'AP' ? 'config_baixa_apg' : 'config_baixa_rcb' });

    return db.transaction().execute(async (trx: AnyDB) => {
      let baixas = 0;
      let lancamentos = 0;
      let total = 0;
      for (const { idlote } of lotes) {
        const itens = await this.baixasDoLote(trx, lado, emp, idlote);
        const mov = await this.movimentacaoDoLote(trx, emp, idlote);
        if (!itens.length || !mov.length) throw new BusinessRuleError('BAIXA_LOTE_SEM_REGISTROS', { lado, idlote });

        // o parceiro é obrigatório em toda baixa do lote (`:1754`), e a checagem é ANTES de lançar qualquer coisa.
        const semParceiro = itens.find((i) => i.codparceiro == null);
        if (semParceiro) throw new BusinessRuleError('BAIXA_SEM_PARCEIRO', { lado, documento: semParceiro.coddoc });

        const valorLote = r2(itens.reduce((s, i) => s + i.valor, 0));
        const ref = itens[itens.length - 1]; // o cursor do legado para no último registro do laço da soma

        // dataset do PARCEIRO: uma linha por baixa. dataset do DINHEIRO: uma por movimentação bancária.
        const dsParceiro: RegistroDataSet[] = itens.map((i) => ({
          codplanocontas: i.codplanocontas, valor: i.valor, idorigem: i.codbx,
          documento: String(i.coddoc), complemento: String(i.coddoc), descricao: `o parceiro ${i.codparceiro ?? 0}`,
        }));
        // ⚠️ a movimentação NÃO traz coluna COMPLEMENTO — por isso essas linhas ficam com o do parâmetro (o
        // IDLOTE), e é o que o razão mostra: 5.411/5.411 no AP e 17.618/17.618 no AR.
        const dsDinheiro: RegistroDataSet[] = mov.map((mv) => ({
          codplanocontas: mv.codplanocontas, valor: mv.valor, idorigem: mv.codmovconta,
          documento: String(mv.codmovconta), descricao: `a conta ${mv.codconta}`,
        }));
        // TROCO (só no A RECEBER, `:3620-3647`): a movimentação NEGATIVA do lote é apensada ao dataset do
        // crédito como uma linha do BANCO, e sai do dataset do débito. Regra copiada; **zero ocorrências** no
        // cliente (nenhuma movimentação negativa em lote de `ARECEBER_BX`).
        if (lado === 'AR') {
          for (const t of mov.filter((mv) => mv.valor_original < 0)) {
            dsParceiro.push({ codplanocontas: t.codplanocontas, valor: t.valor, idorigem: t.codmovconta,
              documento: String(t.codmovconta), complemento: String(t.codmovconta), descricao: `a conta ${t.codconta}` });
          }
        }
        const dsDinheiroPos = lado === 'AR' ? dsDinheiro.filter((_, i) => mov[i].valor_original > 0) : dsDinheiro;
        if (!dsDinheiroPos.length) throw new BusinessRuleError('BAIXA_LOTE_SEM_REGISTROS', { lado, idlote });

        await lancarNoDiario(trx, {
          emp,
          codorigem: ORIGEM[lado].baixa,
          situacao: sitBaixa,
          data: ref.dtpgto,
          valor: valorLote,
          idorigem: ref.codbx,
          documento: String(ref.coddoc),
          complemento: String(idlote),
          // AP: sai dinheiro ⇒ crédito é o banco, débito é o fornecedor. AR: entra ⇒ o inverso.
          dataSetC: lado === 'AP' ? dsDinheiroPos : dsParceiro,
          dataSetD: lado === 'AP' ? dsParceiro : dsDinheiroPos,
          desclote: `Baixa ${lado} — lote ${idlote}`,
        });
        lancamentos += 1;
        total = r2(total + valorLote);

        for (const it of itens) lancamentos += await this.acessorios(trx, lado, emp, it, cfg);

        await trx.updateTable(MAPA[lado].bx).set({ contabilizado: 'S' })
          .where(MAPA[lado].pk, 'in', itens.map((i) => i.codbx)).execute();
        await trx.updateTable('mov_contas_bancarias').set({ contabilizado: 'S' })
          .where('codmovconta', 'in', mov.map((mv) => mv.codmovconta)).where('idempresa', '=', emp).execute();
        baixas += itens.length;
      }
      return { lotes: lotes.length, baixas, lancamentos, total };
    });
  }

  /**
   * JUROS (`:1809` / `:3710`) e ACRÉSCIMO/DESCONTO (`:1849` / `:3753`), um lançamento por baixa que os tenha.
   * O sinal de `ACRE_DESC` escolhe entre acréscimo (> 0) e desconto (< 0) — **e troca os datasets de lado**,
   * que é como o legado inverte a partida. O centro de custo é gate: zero derruba a integração.
   */
  private async acessorios(trx: AnyDB, lado: Lado, emp: number, it: BaixaDoLote, cfg: Record<string, number | null>): Promise<number> {
    let n = 0;
    const parceiro: RegistroDataSet = { codplanocontas: it.codplanocontas, valor: 0, descricao: `o parceiro ${it.codparceiro ?? 0}` };

    if (it.juros > 0) {
      const sit = lado === 'AP' ? cfg.config_juros_pagos : cfg.config_juros_recebidos;
      // AP: DataSetC = parceiro, DataSetD = centro de custo. AR: o inverso (`:1840` × `:3744`).
      await this.lancarAcessorio(trx, lado, emp, it, {
        codorigem: ORIGEM[lado].juros, situacao: sit, qual: lado === 'AP' ? 'config_juros_pagos' : 'config_juros_recebidos',
        valor: it.juros, codplc: it.codplc_juros, erro: 'CENTRO_CUSTO_JUROS_NAO_INFORMADO',
        parceiroNo: lado === 'AP' ? 'C' : 'D', parceiro,
      });
      n += 1;
    }

    if (it.acre_desc !== 0) {
      const acrescimo = it.acre_desc > 0;
      const sit = lado === 'AP'
        ? (acrescimo ? cfg.config_acrescimos_pagos : cfg.config_descontos_recebidos)
        : (acrescimo ? cfg.config_acrescimos_recebidos : cfg.config_descontos_concedidos);
      const qual = lado === 'AP'
        ? (acrescimo ? 'config_acrescimos_pagos' : 'config_descontos_recebidos')
        : (acrescimo ? 'config_acrescimos_recebidos' : 'config_descontos_concedidos');
      // AP acréscimo → parceiro no CRÉDITO; AP desconto → parceiro no DÉBITO (`:1884` × `:1892`).
      // AR acréscimo → parceiro no DÉBITO; AR desconto → parceiro no CRÉDITO (`:3789` × `:3795`).
      const parceiroNo: 'D' | 'C' = lado === 'AP' ? (acrescimo ? 'C' : 'D') : (acrescimo ? 'D' : 'C');
      await this.lancarAcessorio(trx, lado, emp, it, {
        codorigem: acrescimo ? ORIGEM[lado].acrescimo : ORIGEM[lado].desconto,
        situacao: sit, qual, valor: Math.abs(it.acre_desc), codplc: it.codplc_acredesc,
        erro: 'CENTRO_CUSTO_ACREDESC_NAO_INFORMADO', parceiroNo, parceiro,
      });
      n += 1;
    }
    return n;
  }

  private async lancarAcessorio(
    trx: AnyDB, lado: Lado, emp: number, it: BaixaDoLote,
    a: { codorigem: number; situacao: number | null; qual: string; valor: number; codplc: number; erro: string; parceiroNo: 'D' | 'C'; parceiro: RegistroDataSet },
  ): Promise<void> {
    if (a.situacao == null) throw new BusinessRuleError('SITUACAO_NAO_CONFIGURADA', { qual: a.qual });
    // `QryPlcForn.IsEmpty` (:1817/:1857): o parceiro precisa ter conta contábil.
    if (it.codplanocontas == null) throw new BusinessRuleError('CONTA_PARCEIRO_NAO_DEFINIDA', { codparceiro: it.codparceiro, documento: it.coddoc });
    if (!a.codplc) throw new BusinessRuleError(a.erro, { lado, documento: it.coddoc });
    const plc = (await trx
      .selectFrom('plc as p')
      .leftJoin('plano_contas as pc', 'pc.codplanocontas', 'p.codcontabil')
      .select(['pc.codplanocontas as codplanocontas', 'p.descricao as descricao'])
      .where('p.codplc', '=', a.codplc)
      .executeTakeFirst()) as { codplanocontas: number | null; descricao: string | null } | undefined;

    const dsParceiro: RegistroDataSet[] = [{ ...a.parceiro, valor: a.valor }];
    const dsCentro: RegistroDataSet[] = [{ codplanocontas: plc?.codplanocontas ?? null, valor: a.valor, descricao: `o centro de custo ${plc?.descricao ?? a.codplc}` }];
    await lancarNoDiario(trx, {
      emp, codorigem: a.codorigem, situacao: a.situacao, data: it.dtpgto, valor: a.valor,
      idorigem: it.codbx, documento: String(it.coddoc), complemento: String(it.coddoc),
      dataSetD: a.parceiroNo === 'D' ? dsParceiro : dsCentro,
      dataSetC: a.parceiroNo === 'C' ? dsParceiro : dsCentro,
      desclote: `${a.codorigem === ORIGEM[lado].juros ? 'Juros' : 'Acréscimo/desconto'} ${lado} ${it.coddoc}`,
    });
  }

  /** `GetSQLApagarBX` :1587 · `GetSQLReceberBX` :3481. */
  private async baixasDoLote(trx: AnyDB, lado: Lado, emp: number, idlote: number): Promise<BaixaDoLote[]> {
    const m = MAPA[lado];
    const rows = (await sql<Record<string, unknown>>`
      SELECT b.${sql.ref(m.pk)} AS codbx, b.${sql.ref(m.fk)} AS coddoc, b.valorpg AS valor,
             to_char(b.dtpgto, 'YYYY-MM-DD') AS dtpgto, p.codparceiro,
             coalesce(t.${sql.ref(m.contaTitulo)}, p.${sql.ref(m.contaParceiro)}::int) AS codplanocontas,
             coalesce(b.acre_desc,0) AS acre_desc, coalesce(b.juros,0) AS juros,
             coalesce(b.codplc_acredesc,0) AS codplc_acredesc, coalesce(b.codplc_juros,0) AS codplc_juros
        FROM ${sql.table(m.bx)} b
        JOIN ${sql.table(m.tit)} t ON t.${sql.ref(m.fk)} = b.${sql.ref(m.fk)}
        LEFT JOIN parceiros p ON p.codparceiro = t.codparceiro
       WHERE b.idlote = ${idlote}
         AND coalesce(b.contabilizado,'N') = 'N'
         AND b.valorpg > 0
         AND coalesce(b.indr,'I') = 'I'
         AND t.${sql.ref(m.emp)} = ${emp}
       ORDER BY b.${sql.ref(m.fk)}
    `.execute(trx)).rows;
    return rows.map((r) => ({
      codbx: Number(r.codbx), coddoc: Number(r.coddoc), valor: r2(num(r.valor)), dtpgto: String(r.dtpgto),
      codparceiro: r.codparceiro == null ? null : Number(r.codparceiro),
      codplanocontas: r.codplanocontas == null ? null : Number(r.codplanocontas),
      acre_desc: r2(num(r.acre_desc)), juros: r2(num(r.juros)),
      codplc_acredesc: Number(r.codplc_acredesc), codplc_juros: Number(r.codplc_juros),
    }));
  }

  /**
   * `GetSQLMovimentacaoCP` :1645 (A PAGAR) e `GetSQLMovimentacao` :1960 (A RECEBER). O A PAGAR não injeta
   * filtro de sinal — a saída do banco é negativa e entra como `ABS`; o A RECEBER separa o troco pelo sinal.
   * O filtro de "devolução de cheque" só existe no `GetSQLMovimentacao`; pega 1 linha no banco inteiro.
   */
  private async movimentacaoDoLote(trx: AnyDB, emp: number, idlote: number): Promise<MovDoLote[]> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, abs(m.valor) AS valor, m.valor AS valor_original,
             cb.codlanccontabil AS codplanocontas, m.codconta
        FROM mov_contas_bancarias m
        JOIN contas_bancarias cb ON cb.codconta = m.codconta
       WHERE m.idlote = ${idlote}
         AND coalesce(m.contabilizado,'N') = 'N'
         AND m.idempresa = ${emp}
         AND NOT (upper(coalesce(m.historico,'.')) LIKE '%DEVOLUÇÃO DE CHEQUE%')
       ORDER BY m.codmovconta
    `.execute(trx)).rows;
    return rows.map((r) => ({
      codmovconta: Number(r.codmovconta), valor: r2(num(r.valor)), valor_original: num(r.valor_original),
      codplanocontas: r.codplanocontas == null ? null : Number(r.codplanocontas), codconta: Number(r.codconta),
    }));
  }

  /**
   * ESTORNAR (`:1440` AP · `:3346` AR). Pela tela (`Codigo = 0`) é o mesmo bloco por período do corte-1:
   * `DELETE FROM DIARIO WHERE CODORIGEM IN (15,53,54,55)` — ou `(16,56,57,58)` — `AND TRUNC(DATALAN) BETWEEN…`
   * (`:3456`), mais o retorno de `CONTABILIZADO` a nulo na baixa e na movimentação do lote.
   */
  async estornar(lado: Lado, p: { dataIni: string; dataFim: string; idlote?: number | null }): Promise<{ lotes: number; baixas: number; linhas: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodoAberto(db, p.dataFim);
    const m = MAPA[lado];
    const o = ORIGEM[lado];
    const origens = [o.baixa, o.juros, o.acrescimo, o.desconto];

    return db.transaction().execute(async (trx: AnyDB) => {
      const alvo = (await sql<Record<string, unknown>>`
        SELECT b.${sql.ref(m.pk)} AS codbx, b.idlote
          FROM ${sql.table(m.bx)} b
          JOIN ${sql.table(m.tit)} t ON t.${sql.ref(m.fk)} = b.${sql.ref(m.fk)}
         WHERE coalesce(b.contabilizado,'N') = 'S'
           AND t.${sql.ref(m.emp)} = ${emp}
           AND b.idlote IS NOT NULL
           AND b.${sql.ref(m.pk)} IN (
                 SELECT d.idorigem FROM diario d
                  WHERE d.codorigem = ANY(${origens}) AND d.codempresa = ${emp}
                    AND (${p.idlote ?? null}::int IS NOT NULL
                          OR d.datalan BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
           AND (${p.idlote ?? null}::int IS NULL OR b.idlote = ${p.idlote ?? null}::int)
      `.execute(trx)).rows;
      if (!alvo.length) return { lotes: 0, baixas: 0, linhas: 0 };

      const ids = alvo.map((r) => Number(r.codbx));
      const lotes = Array.from(new Set(alvo.map((r) => Number(r.idlote))));

      let linhas = 0;
      if (p.idlote != null) {
        const movIds = (await trx.selectFrom('mov_contas_bancarias').select('codmovconta')
          .where('idlote', '=', p.idlote).where('idempresa', '=', emp).execute()) as Array<{ codmovconta: number }>;
        const del = await trx.deleteFrom('diario')
          .where('codorigem', 'in', origens).where('codempresa', '=', emp)
          .where('idorigem', 'in', ids.concat(movIds.map((x) => Number(x.codmovconta)))).execute();
        linhas = Number(del[0]?.numDeletedRows ?? 0);
      } else {
        const del = await trx.deleteFrom('diario')
          .where('codorigem', 'in', origens).where('codempresa', '=', emp)
          .where('datalan', '>=', sql`${p.dataIni}::date`).where('datalan', '<=', sql`${p.dataFim}::date`).execute();
        linhas = Number(del[0]?.numDeletedRows ?? 0);
      }
      await sql`DELETE FROM lote_contabil l WHERE l.codorigem = ANY(${origens}) AND l.codempresa = ${emp}
                  AND NOT EXISTS (SELECT 1 FROM diario d WHERE d.codlote = l.codlotecontabil)`.execute(trx);

      await trx.updateTable(m.bx).set({ contabilizado: null }).where(m.pk, 'in', ids).execute();
      await trx.updateTable('mov_contas_bancarias').set({ contabilizado: null })
        .where('idlote', 'in', lotes).where('idempresa', '=', emp).execute();
      return { lotes: lotes.length, baixas: ids.length, linhas };
    });
  }
}
