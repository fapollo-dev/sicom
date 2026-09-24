import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { LancamentoCaixaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';
import { assertCentroCustoDaSituacao } from '../shared/situacao-restricoes';
import { DocumentosContabilService } from './documentos-contabil.service';
import { novoLote } from './baixa-caixa';
import { novoGrupo } from './apagar-caixa';
import { gravarLogDaLinha, type CampoLog } from '../../shared/log/registro-log';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
const FUSO = 'America/Sao_Paulo';
const CODORIGEM_CAIXA = 64;

/**
 * LANÇAMENTO DE CAIXA — `FRMMOVCAIXA` (`uMovCaixa`, menu F06; spec reconstruída na produção em 24/09/2026). O movimento
 * manual da CAIXA gerencial: 569 inclusões em 2026, 5.022 acessos. O fonte de 2020 é bem diferente do binário que roda;
 * aqui vale o dado:
 *  - a linha de CAIXA (CADASTRADO_MANUALMENTE 'S', DINHEIRO, o LOTE do ID_IDLOTE, a situação F06, o sinal pelo tipo do
 *    centro de custo — despesa negativa, receita positiva, ORIGEM 'APAGAR'/'DIN', CONTABILIZADO 'N');
 *  - a movimentação bancária do lote (conta escolhida, o mesmo valor com sinal, D/C pelo tipo, liberada na data);
 *  - a DESPESA gera o título A Pagar já QUITADO (APAGAR + rateio CX_APAGAR + APAGAR_BX), desde 29/11/2022;
 *  - a contabilização (origem 64) com a integração AUTOMÁTICA, pelo motor de documentos; editar/excluir estorna antes;
 *  - editar e excluir só o que foi digitado aqui; excluir leva a movimentação e o título.
 * Defeitos do legado não copiados: exclusão com `IDLOTE = 0` (apagaria 65.807 movimentações), efeitos antes da permissão
 * e fora de transação, estorno contábil ao só CLICAR em editar, o sinal que só valia ao sair do campo, a edição que
 * deixava o título negativo com tipo DINHEIRO.
 */
/** a LOG "Movimentação de caixa" (CAIXA, chave CODCX — 2.411 linhas em 2025-26): os campos do dataset do uMovCaixa, na ordem da produção */
const CAIXA_CAMPOS_LOG: readonly CampoLog[] = [
  'codcx', 'data', 'valor', 'obs', 'operador', 'codplc', 'idlote', 'idempresa', 'tiporecurso', 'codconta', 'codparceiro', 'contabilizado',
  'idsituacao_nf', 'neutra', 'cadastrado_manualmente', 'idorigem', 'origem',
];
const logCaixa = async (trx: any, acao: 'Inseriu' | 'Alterou' | 'Excluiu', codcx: number, antes: Record<string, unknown> | null, depois: Record<string, unknown>) =>
  gravarLogDaLinha(trx, { acao, formulario: 'Movimentação de caixa', tabela: 'CAIXA', chave: 'CODCX', valor: codcx, campos: CAIXA_CAMPOS_LOG, antes, depois });
const linhaCaixa = async (trx: any, codcx: number) => ((await sql<Record<string, unknown>>`SELECT * FROM caixa WHERE codcx = ${codcx}`.execute(trx)).rows[0] ?? {});

@Injectable()
export class LancamentoCaixaService {
  constructor(private readonly dbp: DatabaseProvider, private readonly docs: DocumentosContabilService) {}

  private emp(): number {
    const e = currentTenant().empresaId;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private cfg(db: AnyDB, codigo: string, emp: number) {
    return configNaTrx(db, codigo, { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  }

  /** a pesquisa (`GET_CAIXA` com CADASTRADO_MANUALMENTE='S'; o legado não filtra a empresa) */
  async list(q: { dataIni?: string; dataFim?: string; texto?: string }): Promise<Array<Record<string, unknown>>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const texto = q.texto?.trim() ? `%${q.texto.trim().toUpperCase()}%` : null;
    return (await sql<Record<string, unknown>>`
      SELECT c.codcx, to_char(c.data AT TIME ZONE ${FUSO}, 'YYYY-MM-DD') AS data, c.valor, c.idlote, c.tiporecurso, c.obs, c.idempresa,
             c.idsituacao_nf, s.descricao AS situacao, c.neutra, c.codparceiro, p.razao, c.codplc, pl.desccodplc, pl.descricao AS plc,
             c.codconta, cb.titular, cb.nroconta, c.origem, c.idorigem, c.contabilizado, o.nome AS operador
        FROM caixa c
        LEFT JOIN situacao_nf s ON s.idsituacao_nf = c.idsituacao_nf
        LEFT JOIN parceiros p ON p.codparceiro = c.codparceiro
        LEFT JOIN plc pl ON pl.codplc = c.codplc
        LEFT JOIN contas_bancarias cb ON cb.codconta = c.codconta
        LEFT JOIN operadores o ON o.codoperador = c.operador
       WHERE c.cadastrado_manualmente = 'S'
         ${q.dataIni ? sql`AND c.data >= (${q.dataIni}::date::timestamp AT TIME ZONE ${FUSO})` : sql``}
         ${q.dataFim ? sql`AND c.data < ((${q.dataFim}::date + 1)::timestamp AT TIME ZONE ${FUSO})` : sql``}
         ${texto ? sql`AND (upper(coalesce(c.obs, '')) LIKE ${texto} OR upper(coalesce(p.razao, '')) LIKE ${texto})` : sql``}
       ORDER BY c.codcx DESC
       LIMIT 500`.execute(db)).rows;
  }

  async read(codcx: number): Promise<Record<string, unknown> | undefined> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.codcx, to_char(c.data AT TIME ZONE ${FUSO}, 'YYYY-MM-DD') AS data, c.valor, c.idlote, c.obs, c.idempresa, c.idsituacao_nf,
             c.neutra, c.codparceiro, c.codplc, c.codconta, c.origem, c.idorigem, c.contabilizado, c.cadastrado_manualmente, pl.tpconta
        FROM caixa c LEFT JOIN plc pl ON pl.codplc = c.codplc WHERE c.codcx = ${codcx}`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows[0];
  }

  /** o período contábil chaveado (`TIntegracaoContabil.PeriodoFechado`; CHAVEAMENTO_PERIODO nulo na produção) */
  private async assertPeriodo(db: AnyDB, data: string): Promise<void> {
    const cfg = (await sql<{ chav: string | null }>`SELECT to_char(chaveamento_periodo, 'YYYY-MM-DD') AS chav FROM config_integracao_contabil LIMIT 1`.execute(db)).rows[0];
    if (cfg?.chav && data <= cfg.chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: cfg.chav });
  }

  /** a situação do documento (INFORMA_SITUACAO_DOC_LANC_CAIXA): obrigatória; com uma F06 só, entra sozinha */
  private async situacao(db: AnyDB, emp: number, informada: number | undefined): Promise<number | null> {
    if (String((await this.cfg(db, 'INFORMA_SITUACAO_DOC_LANC_CAIXA', emp)) ?? 'N') !== 'S') return informada ?? null;
    if (informada) return informada;
    const f06 = (await sql<{ id: number }>`SELECT idsituacao_nf AS id FROM situacao_nf WHERE upper(coalesce(tipo_operacao, '')) = 'F06' AND coalesce(ativo, 'S') = 'S'`.execute(db)).rows;
    if (!f06.length) throw new BusinessRuleError('LANCAMENTO_CAIXA_SEM_SITUACAO');
    if (f06.length === 1) return Number(f06[0].id);
    throw new BusinessRuleError('LANCAMENTO_CAIXA_SITUACAO_OBRIGATORIA');
  }

  /** as validações do Gravar (`btnGravarClick :271`, a restrição da situação `edtCodPLCExit :522`) e o sinal */
  private async preparar(db: AnyDB, emp: number, dto: LancamentoCaixaDto) {
    const plc = (await sql<{ tpconta: number | null }>`SELECT tpconta FROM plc WHERE codplc = ${dto.codplc}`.execute(db)).rows[0];
    if (!plc) throw new BusinessRuleError('LANCAMENTO_CAIXA_PLC_INVALIDO', { codplc: dto.codplc });
    const conta = (await sql<{ idempresa: number | null; codbco: number | null }>`SELECT idempresa, codbco FROM contas_bancarias WHERE codconta = ${dto.codconta}`.execute(db)).rows[0];
    if (!conta) throw new BusinessRuleError('LANCAMENTO_CAIXA_CONTA_INVALIDA', { codconta: dto.codconta });
    await this.assertPeriodo(db, dto.data);
    const idsituacao = await this.situacao(db, emp, dto.idsituacao_nf);
    await assertCentroCustoDaSituacao(db, idsituacao, dto.codplc);
    const despesa = num(plc.tpconta) === 1;
    if (!despesa && dto.valor > 0 && String((await this.cfg(db, 'BLOQUEIA_RECEITAS_LANCAMENTO_CAIXA', emp)) ?? 'N') === 'S') {
      throw new BusinessRuleError('LANCAMENTO_CAIXA_RECEITA_BLOQUEADA');
    }
    const valor = r2(despesa ? -Math.abs(dto.valor) : Math.abs(dto.valor));
    // a empresa da linha: a da conta bancária (a produção grava assim em 98% desde 2025)
    const idempresa = num(conta.idempresa) || emp;
    return { despesa, valor, idsituacao, idempresa, codbco: num(conta.codbco) || null };
  }

  /** a data do movimento com a hora da gravação (o legado guarda a hora do início da inclusão) */
  private dataComHora(data: string) {
    return sql`((${data}::date + (now() AT TIME ZONE ${FUSO})::time)::timestamp AT TIME ZONE ${FUSO})`;
  }
  private dataSo(data: string) {
    return sql`((${data}::date)::timestamp AT TIME ZONE ${FUSO})`;
  }

  /** o título A Pagar já quitado da despesa (binário novo, desde 29/11/2022) */
  private async gravarTitulo(trx: AnyDB, p: { codcx: number; idlote: number; data: string; valor: number; dto: LancamentoCaixaDto; idsituacao: number | null; idempresa: number; codbco: number | null; op: number | null }): Promise<number> {
    const codgrupo = await novoGrupo(trx);
    const obsTitulo = `Documento gerado através do LANCAMENTO DE CAIXA  TITULO Nº: ${p.codcx}`;
    const apg = (await sql<{ codapg: number }>`
      INSERT INTO apagar (codparceiro, codoperador, dtcompra, dtvenc, dtpgto, valor, obs, codempresa, quitada, nrodup, nrparcela, dtcadastro,
                          operacao_convenio_funcionario, convenio, tipodoc, txjuros, desconto, vendor, gerado, geradocartaoproprio,
                          codgrupo, idsituacao_nf, codbco, codplc, agrupado, consiliado)
      VALUES (${p.dto.codparceiro}, ${p.op}, ${p.data}::date, ${this.dataSo(p.data)}, ${this.dataSo(p.data)}, ${Math.abs(p.valor)}, ${obsTitulo}, ${p.idempresa},
              'S', 1, '1/1', now(), 'D', 'N', 'BOLETO', 0, 0, 0, 'SISTEMA', 'N', ${codgrupo}, ${p.idsituacao}, ${p.codbco}, ${p.dto.codplc}, 'N', 'S')
      RETURNING codapg`.execute(trx)).rows[0];
    const codapg = Number(apg.codapg);
    await sql`UPDATE apagar SET duplicata = ${String(codapg)} WHERE codapg = ${codapg}`.execute(trx);
    await sql`INSERT INTO cx_apagar (codapg, codcc, valor, codgrupo, tipo, idsituacao_nf, dtultimalteracao)
              VALUES (${codapg}, ${p.dto.codplc}, ${p.valor}, ${codgrupo}, 'V', ${p.idsituacao}, now())`.execute(trx);
    const obsBx = `DOCUMENTO BAIXADO VIA LANCAMENTO DE CAIXA TITULO Nº: ${p.codcx}, TITULO Nº: ${codapg} |LOTE:${p.idlote} | ${String(p.dto.obs ?? '').toUpperCase()}`.trim();
    await trx.insertInto('apagar_bx').values({
      codapg, codempresa: p.idempresa, valorpg: Math.abs(p.valor), juros: 0, multa: 0, acre_desc: 0, dtpgto: this.dataSo(p.data), codopbx: p.op,
      data_operacao: sql`now()`, indr: 'I', obs: obsBx.slice(0, 500), idlote: p.idlote, codplc_acredesc: 0, codplc_juros: 0,
    }).execute();
    return codapg;
  }

  /** apaga o título quitado do lançamento (a exclusão do binário novo leva APAGAR, APAGAR_BX e CX_APAGAR) */
  private async apagarTitulo(trx: AnyDB, codapg: number | null | undefined): Promise<void> {
    if (!codapg) return;
    const g = (await sql<{ codgrupo: number | null }>`SELECT codgrupo FROM apagar WHERE codapg = ${codapg}`.execute(trx)).rows[0];
    await sql`DELETE FROM apagar_bx WHERE codapg = ${codapg}`.execute(trx);
    if (g?.codgrupo != null) await sql`DELETE FROM cx_apagar WHERE codgrupo = ${g.codgrupo}`.execute(trx);
    await sql`DELETE FROM cx_apagar WHERE codapg = ${codapg}`.execute(trx);
    await sql`DELETE FROM apagar WHERE codapg = ${codapg}`.execute(trx);
  }

  /** integra o lote na contabilidade (origem 64) com a integração AUTOMÁTICA — best-effort, como o legado */
  private async integrar(idlote: number, data: string): Promise<void> {
    const emp = this.emp();
    const e = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (String(e?.integracao ?? '') !== 'AUTOMATICA') return;
    try {
      await this.docs.integrar('CAIXA', { dataIni: data, dataFim: data, codigo: idlote });
    } catch {
      // IntegraMovimentoCaixa engole o erro (uMovCaixa.pas:804-814); a linha fica CONTABILIZADO 'N' para o TRON
    }
  }

  /** `VerificaContabilizado` (:920-951): contabilizado sem integração automática (ou sem lote) não se mexe; senão estorna */
  private async verificarContabilizado(trx: AnyDB, c: Record<string, unknown>, emp: number, acao: 'editar' | 'excluir'): Promise<void> {
    if (String(c.contabilizado ?? '') !== 'S') return;
    const e = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
    if (String(e?.integracao ?? '') !== 'AUTOMATICA' || !num(c.idlote)) throw new BusinessRuleError('LANCAMENTO_CAIXA_CONTABILIZADO', { acao });
    // o estorno do documento (Estornar, UIntegracaoContabil.pas:2471): o DIÁRIO da origem 64 deste CODCX e as marcas
    const lotes = (await sql<{ codlote: number }>`SELECT DISTINCT codlote FROM diario WHERE codorigem = ${CODORIGEM_CAIXA} AND idorigem = ${num(c.codcx)} AND codempresa = ${num(c.idempresa)}`.execute(trx)).rows;
    await sql`DELETE FROM diario WHERE codorigem = ${CODORIGEM_CAIXA} AND idorigem = ${num(c.codcx)} AND codempresa = ${num(c.idempresa)}`.execute(trx);
    for (const l of lotes) {
      if (l.codlote != null) await sql`DELETE FROM lote_contabil WHERE codlotecontabil = ${l.codlote} AND NOT EXISTS (SELECT 1 FROM diario d WHERE d.codlote = ${l.codlote})`.execute(trx);
    }
    await sql`UPDATE caixa SET contabilizado = NULL WHERE codcx = ${num(c.codcx)}`.execute(trx);
    await sql`UPDATE mov_contas_bancarias SET contabilizado = NULL WHERE idlote = ${num(c.idlote)}`.execute(trx);
  }

  async criar(dto: LancamentoCaixaDto): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const r = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const p = await this.preparar(trx, emp, dto);
      const idlote = await novoLote(trx);
      const obs = dto.obs ? dto.obs.toUpperCase() : null;
      const cx = (await trx.insertInto('caixa').values({
        data: this.dataComHora(dto.data), valor: p.valor, obs, operador: op, codplc: dto.codplc, idlote, idempresa: p.idempresa,
        tiporecurso: 'DINHEIRO', codconta: dto.codconta, codparceiro: dto.codparceiro, contabilizado: 'N', idsituacao_nf: p.idsituacao,
        neutra: dto.neutra ?? 'N', cadastrado_manualmente: 'S', origem: p.despesa ? 'APAGAR' : 'DIN',
        usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
      }).returning('codcx').executeTakeFirstOrThrow()) as { codcx: number };
      const codcx = Number(cx.codcx);
      // a movimentação bancária do lote (UpdateMovBancaria, udmMovCaixa.pas:332-394)
      await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa: p.idempresa, valor: p.valor, dtemissao: this.dataComHora(dto.data), codopconta: 0,
        tipomovimento: p.despesa ? 'D' : 'C', liberado: 'S', dtliberacao: this.dataSo(dto.data), historico: obs, idlote, idpgto: 1,
      }).execute();
      if (p.despesa) {
        const codapg = await this.gravarTitulo(trx, { codcx, idlote, data: dto.data, valor: p.valor, dto, idsituacao: p.idsituacao, idempresa: p.idempresa, codbco: p.codbco, op });
        await sql`UPDATE caixa SET idorigem = ${codapg} WHERE codcx = ${codcx}`.execute(trx);
      }
      await logCaixa(trx, 'Inseriu', codcx, null, await linhaCaixa(trx, codcx));
      return { codcx, idlote };
    });
    await this.integrar(r.idlote, dto.data);
    return this.read(r.codcx);
  }

  private async travar(trx: AnyDB, codcx: number, acao: 'editar' | 'excluir') {
    const c = (await sql<Record<string, unknown>>`SELECT * FROM caixa WHERE codcx = ${codcx} FOR UPDATE`.execute(trx)).rows[0];
    if (!c) throw new BusinessRuleError('LANCAMENTO_CAIXA_NAO_ENCONTRADO', { codcx });
    if (String(c.cadastrado_manualmente ?? '') !== 'S') throw new BusinessRuleError('LANCAMENTO_CAIXA_DE_OUTRA_OPERACAO', { acao });
    const data = (await sql<{ d: string }>`SELECT to_char(${c.data}::timestamptz AT TIME ZONE ${FUSO}, 'YYYY-MM-DD') AS d`.execute(trx)).rows[0]?.d;
    if (data) await this.assertPeriodo(trx, data);
    return c;
  }

  async atualizar(codcx: number, dto: LancamentoCaixaDto): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const r = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.travar(trx, codcx, 'editar');
      await this.verificarContabilizado(trx, c, emp, 'editar');
      const p = await this.preparar(trx, emp, dto);
      const obs = dto.obs ? dto.obs.toUpperCase() : null;
      await trx.updateTable('caixa').set({
        data: this.dataComHora(dto.data), valor: p.valor, obs, codplc: dto.codplc, codconta: dto.codconta, codparceiro: dto.codparceiro,
        idsituacao_nf: p.idsituacao, neutra: dto.neutra ?? c.neutra ?? 'N', idempresa: p.idempresa, origem: p.despesa ? 'APAGAR' : 'DIN',
        contabilizado: 'N', usultalteracao: op, dtultimalteracao: sql`now()`,
      }).where('codcx', '=', codcx).execute();
      const idlote = num(c.idlote);
      if (idlote > 0) {
        await trx.updateTable('mov_contas_bancarias').set({
          codconta: dto.codconta, idempresa: p.idempresa, valor: p.valor, dtemissao: this.dataComHora(dto.data),
          tipomovimento: p.despesa ? 'D' : 'C', dtliberacao: this.dataSo(dto.data), historico: obs,
        }).where('idlote', '=', idlote).execute();
      }
      // o título quitado segue o lançamento (sem os defeitos da edição do legado: valor positivo, BOLETO, a data nova)
      await this.apagarTitulo(trx, num(c.idorigem) || null);
      let codapg: number | null = null;
      if (p.despesa) codapg = await this.gravarTitulo(trx, { codcx, idlote, data: dto.data, valor: p.valor, dto, idsituacao: p.idsituacao, idempresa: p.idempresa, codbco: p.codbco, op });
      await sql`UPDATE caixa SET idorigem = ${codapg} WHERE codcx = ${codcx}`.execute(trx);
      await logCaixa(trx, 'Alterou', codcx, c, await linhaCaixa(trx, codcx));
      return { idlote };
    });
    if (r.idlote) await this.integrar(r.idlote, dto.data);
    return this.read(codcx);
  }

  async excluir(codcx: number): Promise<void> {
    const emp = this.emp();
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.travar(trx, codcx, 'excluir');
      await this.verificarContabilizado(trx, c, emp, 'excluir');
      const idlote = num(c.idlote);
      await sql`DELETE FROM caixa WHERE codcx = ${codcx}`.execute(trx);
      await logCaixa(trx, 'Excluiu', codcx, c, {});
      // o lote leva a movimentação (e o cheque/cheque próprio, ramos mortos) — só com lote: o legado apagava IDLOTE = 0
      if (idlote > 0) {
        await sql`DELETE FROM mov_contas_bancarias WHERE idlote = ${idlote}`.execute(trx);
        await sql`DELETE FROM chq_proprio WHERE idlote = ${idlote}`.execute(trx);
        await sql`DELETE FROM cheque WHERE idlote = ${idlote}`.execute(trx);
      }
      if (String(c.origem ?? '') === 'APAGAR') await this.apagarTitulo(trx, num(c.idorigem) || null);
    });
  }
}
