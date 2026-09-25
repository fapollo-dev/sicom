import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SpedApuracaoPcService } from './sped-apuracao-pc.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * APURAÇÃO PIS/COFINS — a TELA (`FRMAPURACAOPISCOFINS`, `UapuracaoPISCOFINS.pas`).
 * **39 acessos, 2 operadores.** Migration 240.
 *
 * O motor já existia: `sped-apuracao-pc.service` apura o período e popula `apuracao_pc`/`_det` para o bloco M
 * do EFD-Contribuições. Faltava o que a tela do legado faz em volta dele — **listar as apurações realizadas,
 * abrir uma, ver crédito e débito lado a lado com o saldo, e excluir para refazer**.
 *
 * ── O saldo, que é o que o contador procura ───────────────────────────────────────────────────────────
 * O detalhe guarda linhas `C` (crédito de entrada) e `D` (débito de saída). O **saldo é débito − crédito**,
 * separado por tributo — é o valor a recolher do M200/M600. Negativo significa crédito a transportar, e a
 * tela mostra assim em vez de um número com sinal, que é como o contador lê.
 *
 * ⚠️ **excluir é o "reabrir" do legado**: a apuração é idempotente por período (`UNIQUE (idempresa, dataini,
 * datafim)` e delete-then-insert no motor), então refazer é apurar de novo. A exclusão existe para quando o
 * período muda de recorte, não para "corrigir" — e é por isso que ela leva o detalhe junto.
 */
@Injectable()
export class ApuracaoPcConsultaService {
  constructor(private readonly dbp: DatabaseProvider, private readonly motor: SpedApuracaoPcService) {}

  /** as apurações do escopo (a raiz do CNPJ — IDEMPRESA nulo nas do legado — ou a empresa, com a config de seleção) */
  private async filtro(db: AnyDB): Promise<{ cond: ReturnType<typeof sql> }> {
    const { porEmpresa, emp, empresas } = await this.motor.escopo(db);
    // embrulhado: um RawBuilder devolvido por função async seria "awaitado" (o Kysely recusa)
    return { cond: porEmpresa ? sql`a.idempresa = ${emp}` : sql`(a.idempresa IS NULL OR a.idempresa = ANY(${empresas}::int[]))` };
  }

  /** as "Apurações Realizadas" da tela (todas do escopo), com o total de cada uma pelo recálculo do pai */
  async listar(): Promise<Array<Record<string, unknown>>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const { cond: f } = await this.filtro(db);
    const cabs = (await sql<Record<string, unknown>>`
      SELECT a.codapuracao_pc, a.dataini, a.datafim, a.idempresa, a.codoperador, a.dtcadastro, coalesce(o.nome, '') AS operador,
             (SELECT count(*) FROM apuracao_pc_det d WHERE d.codapuracao_pc = a.codapuracao_pc)::int AS linhas
        FROM apuracao_pc a LEFT JOIN operadores o ON o.codoperador = a.codoperador
       WHERE ${f}
       ORDER BY a.dataini DESC, a.codapuracao_pc DESC`.execute(db)).rows;
    const out: Array<Record<string, unknown>> = [];
    for (const c of cabs) {
      const t = totaisPeloPai(await this.itens(db, Number(c.codapuracao_pc)));
      out.push({ ...c, credito: r2(t.creditoPis + t.creditoCofins), debito: r2(t.debitoPis + t.debitoCofins) });
    }
    return out;
  }

  private async itens(db: AnyDB, cod: number) {
    return (await sql<Record<string, unknown>>`
      SELECT d.codapuracao_pc_det, d.tipo, d.apuracao, d.tipo_origem, d.id_tipocredito, t.descricao AS descricao_tipocredito, d.id_basecredito, d.descricaobase,
             d.idpiscofins, coalesce(d.descricaopc, p.descricao, '') AS descricao, d.cst_pis,
             d.basecalculo, d.aliqpis, d.valorpis, d.aliqcofins, d.valorcofins, d.basecalculoapura, d.valorpisapura, d.valorcofinsapura
        FROM apuracao_pc_det d
        LEFT JOIN piscofins p ON p.idpiscofins = d.idpiscofins
        LEFT JOIN pc_tipocredito t ON t.id_tipocredito = d.id_tipocredito
       WHERE d.codapuracao_pc = ${cod}
       ORDER BY d.tipo, d.id_tipocredito, d.id_basecredito, d.idpiscofins, d.codapuracao_pc_det`.execute(db)).rows;
  }

  /** uma apuração aberta: o detalhe e os pais (tipo de crédito × alíquota) e o saldo por tributo */
  async obter(cod: number): Promise<Record<string, unknown>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const { cond: f } = await this.filtro(db);
    const cab = (await sql<Record<string, unknown>>`SELECT a.* FROM apuracao_pc a WHERE a.codapuracao_pc = ${cod} AND ${f}`.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('APURACAO_PC_NAO_ENCONTRADA', { cod });
    const itens = await this.itens(db, cod);
    const t = totaisPeloPai(itens);
    return {
      ...cab,
      itens,
      pais: t.pais,
      totais: {
        baseCredito: t.baseCredito, baseDebito: t.baseDebito,
        creditoPis: t.creditoPis, creditoCofins: t.creditoCofins, debitoPis: t.debitoPis, debitoCofins: t.debitoCofins,
        // o M200/M600: a recolher é o que sobra do débito depois do crédito; o resto transporta
        aRecolherPis: r2(Math.max(t.debitoPis - t.creditoPis, 0)),
        aRecolherCofins: r2(Math.max(t.debitoCofins - t.creditoCofins, 0)),
        creditoTransportarPis: r2(Math.max(t.creditoPis - t.debitoPis, 0)),
        creditoTransportarCofins: r2(Math.max(t.creditoCofins - t.debitoCofins, 0)),
      },
    };
  }

  /** o apoio do ajuste manual (os F3 do `UAjustaApuracaoPC`: GET_BASECREDITO, GET_PISCOFINS) e os tipos de crédito da grade pai */
  async apoio(): Promise<Record<string, unknown>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const [tipos, bases, piscofins] = await Promise.all([
      sql`SELECT id_tipocredito, descricao FROM pc_tipocredito ORDER BY id_tipocredito`.execute(db),
      sql`SELECT idbasecredito::int AS idbasecredito, descricao FROM pc_basecredito ORDER BY idbasecredito`.execute(db),
      sql`SELECT idpiscofins, descricao, aliq_pis_ent, aliq_cofins_ent FROM piscofins ORDER BY idpiscofins`.execute(db),
    ]);
    return { tipos: tipos.rows, bases: bases.rows, piscofins: piscofins.rows };
  }

  /**
   * O AJUSTE MANUAL de crédito (`JvDBUltimGrid4KeyDown` Enter, `UapuracaoPISCOFINS.pas:890-960`; `UAjustaApuracaoPC.pas`): na grade pai de
   * Créditos, o tipo de crédito abre o "Ajusta Apuração" — base de crédito, PIS/COFINS (traz a descrição e as alíquotas de ENTRADA) e a
   * base; PIS/COFINS = base × alíquota / 100 (o NUMBER(15,2) arredonda). Grava na hora uma linha CREDITO/ENTRADA no detalhe — igual à
   * calculada. Os `*_APURA` e o CST ficam vazios: o fonte não os grava (dossiê §7.12).
   */
  async ajustarCredito(cod: number, dto: { id_tipocredito: number; id_basecredito: number; idpiscofins: number; basecalculo: number }): Promise<Record<string, unknown>> {
    const db = this.dbp.forTenant() as AnyDB;
    const { cond: f } = await this.filtro(db);
    return db.transaction().execute(async (trx: AnyDB) => {
      const cab = (await sql`SELECT a.codapuracao_pc FROM apuracao_pc a WHERE a.codapuracao_pc = ${cod} AND ${f} FOR UPDATE`.execute(trx)).rows[0];
      if (!cab) throw new BusinessRuleError('APURACAO_PC_NAO_ENCONTRADA', { cod });
      const tipo = (await sql<{ descricao: string }>`SELECT descricao FROM pc_tipocredito WHERE id_tipocredito = ${dto.id_tipocredito}`.execute(trx)).rows[0];
      if (!tipo) throw new BusinessRuleError('APURACAO_PC_TIPOCREDITO_NAO_ENCONTRADO', { id_tipocredito: dto.id_tipocredito }, 'Tipo de Crédito não encontrado!');
      const base = (await sql<{ descricao: string }>`SELECT descricao FROM pc_basecredito WHERE idbasecredito = ${dto.id_basecredito}`.execute(trx)).rows[0];
      if (!base) throw new BusinessRuleError('APURACAO_PC_BASECREDITO_NAO_ENCONTRADA', { id_basecredito: dto.id_basecredito }, 'Base de cédito não encontrada!');
      const pc = (await sql<{ descricao: string; aliq_pis_ent: unknown; aliq_cofins_ent: unknown }>`
        SELECT descricao, aliq_pis_ent, aliq_cofins_ent FROM piscofins WHERE idpiscofins = ${dto.idpiscofins}`.execute(trx)).rows[0];
      if (!pc) throw new BusinessRuleError('APURACAO_PC_PISCOFINS_NAO_ENCONTRADO', { idpiscofins: dto.idpiscofins }, 'Pis e Cofins não encontrado!');
      const b = r2(num(dto.basecalculo));
      const aPis = num(pc.aliq_pis_ent);
      const aCof = num(pc.aliq_cofins_ent);
      const linha = (await sql<Record<string, unknown>>`
        INSERT INTO apuracao_pc_det (codapuracao_pc, tipo, apuracao, tipo_origem, id_tipocredito, id_basecredito, descricaobase, idpiscofins, descricaopc,
                                     basecalculo, aliqpis, valorpis, aliqcofins, valorcofins)
        VALUES (${cod}, 'C', 'CREDITO', 'ENTRADA', ${dto.id_tipocredito}, ${dto.id_basecredito}, ${base.descricao}, ${dto.idpiscofins}, ${pc.descricao},
                ${b}, ${aPis}, ${r2((b * aPis) / 100)}, ${aCof}, ${r2((b * aCof) / 100)})
        RETURNING codapuracao_pc_det, basecalculo, valorpis, valorcofins`.execute(trx)).rows[0];
      return { ...linha, descricao_tipocredito: tipo.descricao };
    });
  }

  /**
   * [DEL] no pai de Créditos (`UapuracaoPISCOFINS.pas:962-980`, "Deseja excluir o registro da apuração?"): sai o pai, os filhos e as linhas
   * do detalhe — as de CRÉDITO daquele tipo de crédito × alíquota PIS. (O fonte localiza cada filho pela 1ª linha que casa tipo/base/PIS-COFINS;
   * como os filhos são as próprias linhas do pai, o efeito é o mesmo.)
   */
  async excluirCredito(cod: number, idTipocredito: number | null, aliqpis: number): Promise<{ linhas: number }> {
    const db = this.dbp.forTenant() as AnyDB;
    const { cond: f } = await this.filtro(db);
    return db.transaction().execute(async (trx: AnyDB) => {
      const cab = (await sql`SELECT a.codapuracao_pc FROM apuracao_pc a WHERE a.codapuracao_pc = ${cod} AND ${f} FOR UPDATE`.execute(trx)).rows[0];
      if (!cab) throw new BusinessRuleError('APURACAO_PC_NAO_ENCONTRADA', { cod });
      const r = await sql`DELETE FROM apuracao_pc_det WHERE codapuracao_pc = ${cod} AND tipo = 'C'
                            AND id_tipocredito IS NOT DISTINCT FROM ${idTipocredito}::int AND round(coalesce(aliqpis, 0)::numeric, 4) = round(${aliqpis}::numeric, 4)`.execute(trx);
      return { linhas: Number(r.numAffectedRows ?? 0) };
    });
  }

  /** a aba CONFIGURAÇÃO (`cdsConfig`): os CFOPs que entram na base do crédito, cada um com a base de crédito (PC_CONFIG — 18 na produção) */
  async listarConfig(): Promise<Array<Record<string, unknown>>> {
    return (await sql<Record<string, unknown>>`
      SELECT c.cfop, c.id_basecredito, b.descricao FROM pc_config c LEFT JOIN pc_basecredito b ON b.idbasecredito = c.id_basecredito
       ORDER BY c.cfop`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  /** incluir na configuração (`btnOkClick`): a base tem de existir ("Código não encontrado!", `edtCodBaseExit`) */
  async incluirConfig(dto: { cfop: string; id_basecredito: number }): Promise<Record<string, unknown>> {
    const db = this.dbp.forTenant() as AnyDB;
    const cfop = String(dto.cfop ?? '').trim();
    if (!cfop) throw new BusinessRuleError('APURACAO_PC_CONFIG_SEM_CFOP', undefined, 'Informe o CFOP.');
    const base = (await sql`SELECT 1 FROM pc_basecredito WHERE idbasecredito = ${dto.id_basecredito}`.execute(db)).rows[0];
    if (!base) throw new BusinessRuleError('APURACAO_PC_BASECREDITO_NAO_ENCONTRADA', { id_basecredito: dto.id_basecredito }, 'Código não encontrado!');
    await sql`INSERT INTO pc_config (cfop, id_basecredito) VALUES (${cfop}, ${dto.id_basecredito})`.execute(db);
    return { cfop, id_basecredito: dto.id_basecredito };
  }

  /** excluir da configuração (o `btnCancelarClick` do legado apaga o registro corrente) */
  async excluirConfig(cfop: string): Promise<{ cfop: string }> {
    const r = await sql`DELETE FROM pc_config WHERE cfop = ${cfop}`.execute(this.dbp.forTenant() as AnyDB);
    if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('APURACAO_PC_CONFIG_NAO_ENCONTRADA', { cfop });
    return { cfop };
  }

  async excluir(cod: number): Promise<{ codapuracao_pc: number }> {
    const db = this.dbp.forTenant() as AnyDB;
    const { cond: f } = await this.filtro(db);
    const r = await sql`DELETE FROM apuracao_pc a WHERE a.codapuracao_pc = ${cod} AND ${f}`.execute(db);
    if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('APURACAO_PC_NAO_ENCONTRADA', { cod });
    return { codapuracao_pc: cod };
  }
}

/**
 * Os pais das grades Créditos e Débitos da tela (`UapuracaoPISCOFINS.pas:1034-1092`): por (tipo de crédito, alíquota PIS), a base somada e o
 * PIS/COFINS RECALCULADOS — round(Σbase × alíq/100, 2) — e não a soma do gravado. É o que a tela mostra, e é o que não herda o defeito
 * da última linha das apurações do legado (a NFC-e 106 com o VALORPIS errado em 18 de 18: somar o gravado dobra o débito na 341).
 */
function totaisPeloPai(itens: Array<Record<string, unknown>>) {
  const pais = new Map<string, { tipo: string; id_tipocredito: unknown; aliqpis: number; aliqcofins: number; base: number; pis: number; cofins: number; linhas: number }>();
  for (const i of itens) {
    const tipo = String(i.tipo ?? '');
    if (tipo !== 'C' && tipo !== 'D') continue;
    const k = `${tipo}|${i.id_tipocredito ?? ''}|${num(i.aliqpis).toFixed(4)}`;
    const p = pais.get(k) ?? { tipo, id_tipocredito: i.id_tipocredito, aliqpis: num(i.aliqpis), aliqcofins: num(i.aliqcofins), base: 0, pis: 0, cofins: 0, linhas: 0 };
    p.base = r2(p.base + num(i.basecalculo));
    p.linhas++;
    pais.set(k, p);
  }
  for (const p of pais.values()) {
    p.pis = r2((p.base * p.aliqpis) / 100);
    p.cofins = r2((p.base * p.aliqcofins) / 100);
  }
  const lista = [...pais.values()];
  const soma = (tipo: string, campo: 'base' | 'pis' | 'cofins') => r2(lista.filter((p) => p.tipo === tipo).reduce((s, p) => s + p[campo], 0));
  return {
    pais: lista,
    baseCredito: soma('C', 'base'), baseDebito: soma('D', 'base'),
    creditoPis: soma('C', 'pis'), creditoCofins: soma('C', 'cofins'), debitoPis: soma('D', 'pis'), debitoCofins: soma('D', 'cofins'),
  };
}
