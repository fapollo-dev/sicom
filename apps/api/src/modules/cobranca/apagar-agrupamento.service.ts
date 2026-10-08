import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { configNaTrx } from '../compras/pedido-heranca';
import { apagarRateioDoGrupo, novoGrupo, rateioUnico, refazerCaixaDoGrupo } from './apagar-caixa';
import { DocumentosContabilService } from './documentos-contabil.service';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const milhar = (v: unknown) => String(Math.round(num(v))).padStart(3, '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export interface AgruparApagarInput {
  codapgs: number[];
  codparceiro?: number;
  dtvenc?: string;
  obs?: string;
  codplc?: number;
  /** as parcelas do consolidado (o agrupamento também reparcela: 5 de 78 grupos em 2026) — sem elas, uma com o total */
  parcelas?: Array<{ valor: number; dtvenc: string }>;
}

/**
 * AGRUPAMENTO DE CONTAS A PAGAR (`uAgrupaContasAPagar` + o gravar do `uAPagar` com `AgrupaAPagar`; dossiê `uAgrupaContas.md`).
 * O MODELO DO LEGADO: o consolidado (uma ou mais parcelas) é AGRUPAMENTO='S', ORIGEM nula, um CODGRUPO novo; os membros
 * ficam AGRUPADO='S' com CODGRUPO_AGRUPAMENTO_APG = esse CODGRUPO (o DRE do caixa e o contábil do convênio leem assim).
 * Total = Σ valor dos membros; com fornecedores diversos (33 de 78 grupos em 2026), o título vai para o parceiro informado.
 * TIPODOC 'BOLETO', juros `EMPRESAS.TX_JURO_APAGAR`, OBS "Referente Agrupamento" + as notas / os códigos. Com centro de
 * custo, o rateio e a CAIXA do grupo (18 de 78 grupos); os membros mantêm os seus. A baixa do consolidado NÃO quita os
 * membros (0 de 186 no dado — ao contrário do A Receber).
 */
@Injectable()
export class ApagarAgrupamentoService {
  constructor(private readonly dbp: DatabaseProvider, private readonly contabil: DocumentosContabilService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async tz(db: AnyDB, emp: number): Promise<string> {
    return (await configNaTrx(db, 'FUSO_HORARIO_ACESSO', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'America/Sao_Paulo';
  }

  private async consolidado(trx: AnyDB, emp: number, codapg: number): Promise<Record<string, unknown>> {
    const c = (await sql<Record<string, unknown>>`SELECT a.*, p.razao FROM apagar a LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        WHERE a.codapg = ${codapg} AND a.codempresa = ${emp} FOR UPDATE OF a`.execute(trx)).rows[0];
    if (!c) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg });
    if (c.agrupamento !== 'S' || !num(c.codgrupo)) throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codapg });
    return c;
  }

  async agrupar(dto: AgruparApagarInput): Promise<{ codgrupo: number; consolidado: number; parcelas: number[]; membros: number; total: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ids = [...new Set((dto.codapgs ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) throw new BusinessRuleError('AGRUPAMENTO_SEM_DOCUMENTOS');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // os títulos de QUALQUER loja do operador: a GET_APAGAR_AGRUPAR do legado não filtra loja (desde 2025, 51 dos 864 títulos
      // agrupados eram de outra loja que não a do consolidado)
      const lojas = await todasAsEmpresasDoOperador(trx);
      const lidos = (await sql<Record<string, unknown>>`SELECT a.codapg, a.codparceiro, a.valor, a.quitada, a.agrupado, n.nronf
          FROM apagar a LEFT JOIN nf n ON n.codnf = a.idnf
         WHERE a.codapg = ANY(${ids}::int[]) AND a.codempresa = ANY(${lojas}::int[]) FOR UPDATE OF a`.execute(trx)).rows;
      if (lidos.length !== ids.length) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO');
      const membros = ids.map((id) => lidos.find((m) => num(m.codapg) === id) as Record<string, unknown>);
      for (const m of membros) {
        if (m.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codapg: m.codapg });
        if (m.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codapg: m.codapg });
      }
      const fornecedores = new Set(membros.map((m) => num(m.codparceiro)));
      const codparceiro = num(dto.codparceiro) || (fornecedores.size === 1 ? [...fornecedores][0] : 0);
      if (!codparceiro) throw new BusinessRuleError('AGRUPAMENTO_INFORME_FORNECEDOR');
      if (!(await sql`SELECT 1 FROM parceiros WHERE codparceiro = ${codparceiro}`.execute(trx)).rows.length) throw new BusinessRuleError('PARCEIRO_NAO_ENCONTRADO', { codparceiro });
      const total = r2(membros.reduce((s, m) => s + num(m.valor), 0));

      // a OBS do legado: a do usuário, "Referente Agrupamento" e as notas fiscais / os códigos das contas sem nota
      const notas = [...new Set(membros.filter((m) => m.nronf != null && String(m.nronf) !== '').map((m) => String(m.nronf)))];
      const codigos = [...new Set(membros.filter((m) => m.nronf == null || String(m.nronf) === '').map((m) => String(num(m.codapg))))];
      const ref = [notas.length ? `Notas fiscais: ${notas.join(', ')}` : '', codigos.length ? `Códigos das contas: ${codigos.join(', ')}` : ''].filter(Boolean).join('\r\n');
      const obs = `${dto.obs && dto.obs.trim() ? `${dto.obs}\r\n` : ''}Referente Agrupamento\r\n${ref}`.slice(0, 1000);

      const tz = await this.tz(trx, emp);
      const hoje = (await sql<{ d: string }>`SELECT to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d`.execute(trx)).rows[0].d;
      const parcelas = dto.parcelas?.length ? dto.parcelas : [{ valor: total, dtvenc: dto.dtvenc ?? hoje }];
      for (const p of parcelas) {
        if (!(num(p.valor) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.dtvenc ?? ''))) throw new BusinessRuleError('AGRUPAMENTO_PARCELA_INVALIDA');
      }
      await assertPeriodoNaoFechado(trx, emp, hoje, 'bloq_apg');
      const empresa = (await sql<{ tx_juro_apagar: unknown }>`SELECT tx_juro_apagar FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
      const dia = (d: string) => sql`((${d}::date)::timestamp AT TIME ZONE ${tz})`;
      const codgrupo = await novoGrupo(trx);
      const gerados: number[] = [];
      for (let i = 0; i < parcelas.length; i++) {
        const p = parcelas[i];
        const t = (await sql<{ codapg: number }>`
          INSERT INTO apagar (codempresa, codparceiro, valor, txjuros, dtvenda, dtcompra, dtvenc, tipodoc, nrodup, nrparcela, agrupamento, agrupado,
                              quitada, codgrupo, obs, gerado, gfat, consiliado, cadastrado_manualmente, codoperador, usultalteracao, dtultimalteracao, dtcadastro,
                              desconto, vendor, convenio, operacao_convenio_funcionario, codplc)
          VALUES (${emp}, ${codparceiro}, ${r2(num(p.valor))}, ${num(empresa?.tx_juro_apagar)}, ${dia(hoje)}, ${hoje}::date, ${dia(p.dtvenc)}, 'BOLETO',
                  ${parcelas.length}, ${`${i + 1}/${parcelas.length}`}, 'S', 'N', 'N', ${codgrupo}, ${obs}, 'OPERADOR', 'N', 'S', 'S', ${op}, ${op}, now(), now(),
                  0, 0, 'N', 'D', ${num(dto.codplc) || null})
          RETURNING codapg`.execute(trx)).rows[0];
        await sql`UPDATE apagar SET duplicata = ${String(t.codapg)} WHERE codapg = ${t.codapg}`.execute(trx);
        gerados.push(num(t.codapg));
      }
      await sql`UPDATE apagar SET agrupado = 'S', codgrupo_agrupamento_apg = ${codgrupo}, data_agrupamento = now(), usultalteracao = ${op}, dtultimalteracao = now()
          WHERE codapg = ANY(${ids}::int[]) AND codempresa = ANY(${lojas}::int[])`.execute(trx);
      // com centro de custo, o rateio do documento e a CAIXA do grupo (o Gravar da tela de contas a pagar)
      if (num(dto.codplc) > 0) {
        await rateioUnico(trx, { codapg: gerados[0], codgrupo, codcc: num(dto.codplc), valor: r2(parcelas.reduce((s, p) => s + num(p.valor), 0)) });
        await refazerCaixaDoGrupo(trx, codgrupo, op);
      }
      return { codgrupo, consolidado: gerados[0], parcelas: gerados, membros: ids.length, total };
    });
  }

  /**
   * REVERTER (`btnReverterAgrupamentoClick` do uAPagar; RBAC FRMAPAGAR.BTNREVERTERAGRUPAMENTO): recusa com desconto de título ou
   * parcela quitada; os membros voltam e o documento inteiro sai (com o rateio e a CAIXA dele), com o histórico de exclusão.
   * Integridade que o legado não verificava: o pagamento ativo (a exclusão levaria a baixa).
   */
  async reverter(codConsolidado: number): Promise<{ revertido: true; consolidado: number; membros: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.consolidado(trx, emp, codConsolidado);
      const g = num(c.codgrupo);
      const parcelas = (await sql<Record<string, unknown>>`SELECT codapg, quitada, cod_desconto_titulo, codcxagrupamentocr, contabilizado_agrupamento FROM apagar
          WHERE codgrupo = ${g} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows;
      if (parcelas.some((p) => num(p.cod_desconto_titulo) > 0)) throw new BusinessRuleError('AGRUPAMENTO_DESCONTO_TITULO');
      const cxConvenio = parcelas.map((p) => num(p.codcxagrupamentocr)).find((n) => n > 0);
      if (cxConvenio) return this.reverterConvenio(trx, emp, op, codConsolidado, g, cxConvenio, parcelas.some((p) => p.contabilizado_agrupamento === 'S'));
      if (parcelas.some((p) => p.quitada === 'S')) throw new BusinessRuleError('AGRUPAMENTO_PARCELAS_QUITADAS');
      const codigos = parcelas.map((p) => num(p.codapg));
      if ((await sql`SELECT 1 FROM apagar_bx WHERE codapg = ANY(${codigos}::int[]) AND coalesce(indr, 'I') = 'I' LIMIT 1`.execute(trx)).rows.length) {
        throw new BusinessRuleError('AGRUPAMENTO_BAIXADO', { codapg: codConsolidado });
      }
      // os membros são do GRUPO, de qualquer loja; o consolidado já foi conferido na loja do login
      const r = await sql`UPDATE apagar SET agrupado = 'N', codgrupo_agrupamento_apg = NULL, usultalteracao = ${op}, dtultimalteracao = now()
          WHERE codgrupo_agrupamento_apg = ${g}`.execute(trx);
      await apagarRateioDoGrupo(trx, g);
      await sql`DELETE FROM apagar WHERE codgrupo = ${g} AND codempresa = ${emp}`.execute(trx);
      await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
          VALUES (${String(codConsolidado)}, 'APAGAR', ${`EXCLUSAO DO REGISTRO  REVERSÃO DE AGRUPAMENTO CLIENTE: ${num(c.codparceiro)}-${c.razao ?? ''}, DOCUMENTO: ${c.duplicata ?? ''}, VALOR: ${milhar(c.valor)}`.slice(0, 600)},
                  current_date, ${op}, ${emp})`.execute(trx);
      return { revertido: true as const, consolidado: codConsolidado, membros: Number(r.numAffectedRows ?? 0) };
    });
  }

  /**
   * REVERTER O CONVÊNIO DO MESMO CNPJ (`frmAPagar.btnReverterAgrupamento` com o grid de RCB; dossiê §2.5): contabilizado, só com a
   * integração automática — aí estorna o razão do grupo (origem 65) —, senão "Não é permitido reverter este agrupamento pois já foi
   * contabilizado."; os títulos a receber saem do grupo; a CAIXA do CODCXAGRUPAMENTOCR e o A Pagar do grupo são apagados.
   * ⚠️ Divergência inferida: o fonte de 2020 não volta QUITADA para 'N' (não a punha como 'S'); o binário novo quita os membros ao
   * agrupar, então aqui a reversão devolve 'N' aos que não têm baixa — senão ficariam pagos sem baixa nenhuma.
   */
  private async reverterConvenio(trx: AnyDB, emp: number, op: number | null, codapg: number, g: number, codcx: number, contabilizado: boolean) {
    if (contabilizado) {
      const integracao = String((await sql<{ i: string | null }>`SELECT integracao AS i FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0]?.i ?? '').toUpperCase();
      if (integracao !== 'AUTOMATICA') throw new BusinessRuleError('AGRUPAMENTO_CONTABILIZADO');
      await this.contabil.estornarConvenioNaTrx(trx, g);
    }
    const r = await sql`UPDATE areceber a SET agrupado = 'N', codgrupo_agrupamento_apg = NULL, data_agrupamento = NULL,
                            quitada = CASE WHEN EXISTS (SELECT 1 FROM areceber_bx b WHERE b.codrcb = a.codrcb AND coalesce(b.indr, 'I') = 'I') THEN a.quitada ELSE 'N' END,
                            usultalteracao = ${op}, dtultimalteracao = now()
        WHERE a.codgrupo_agrupamento_apg = ${g}`.execute(trx); // os títulos a receber do convênio, de qualquer loja (como no agrupar)
    if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('AGRUPAMENTO_CONVENIO_SEM_TITULOS');
    await sql`DELETE FROM caixa WHERE codcx = ${codcx}`.execute(trx);
    await sql`DELETE FROM apagar WHERE codgrupo = ${g} AND codempresa = ${emp}`.execute(trx);
    return { revertido: true as const, consolidado: codapg, membros: Number(r.numAffectedRows ?? 0) };
  }

  /** remove UM membro do grupo (recurso do Apollo — o legado não o tem no A Pagar): libera o título e abate o valor da parcela */
  async removerTitulo(codConsolidado: number, codMembro: number): Promise<{ consolidado: number; removido: number; novoValor: number; membrosRestantes: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.consolidado(trx, emp, codConsolidado);
      if (c.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codapg: codConsolidado });
      const m = (await sql<Record<string, unknown>>`SELECT codapg, valor, codgrupo_agrupamento_apg FROM apagar WHERE codapg = ${codMembro} FOR UPDATE`.execute(trx)).rows[0];
      if (!m || num(m.codgrupo_agrupamento_apg) !== num(c.codgrupo)) throw new BusinessRuleError('TITULO_NAO_PERTENCE_AGRUPAMENTO', { codapg: codMembro });
      await sql`UPDATE apagar SET agrupado = 'N', codgrupo_agrupamento_apg = NULL, usultalteracao = ${op}, dtultimalteracao = now() WHERE codapg = ${codMembro}`.execute(trx);
      const novoValor = r2(num(c.valor) - num(m.valor));
      await sql`UPDATE apagar SET valor = ${novoValor}, usultalteracao = ${op}, dtultimalteracao = now() WHERE codapg = ${codConsolidado}`.execute(trx);
      const restantes = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM apagar WHERE codgrupo_agrupamento_apg = ${num(c.codgrupo)}`.execute(trx)).rows[0].n);
      return { consolidado: codConsolidado, removido: codMembro, novoValor, membrosRestantes: restantes };
    });
  }

  /**
   * os dados das impressões do agrupamento do A Pagar (`frmAPagar`): o consolidado (DbdApagar) e os documentos agrupados
   * (DbdAgrupamento) — "AgrupamentoCP.fr3" (analítico) / "AgrupamentoCPAgrupado.fr3" (por parceiro); no convênio do mesmo CNPJ
   * (CODCXAGRUPAMENTOCR) os documentos são os A RECEBER do grupo ("AgrupamentoCPCR*.fr3", "EXTRATO DE CONVÊNIO").
   */
  async relatorio(codConsolidado: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const tz = String((await configNaTrx(db, 'FUSO_HORARIO_ACESSO', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'America/Sao_Paulo');
    const c = (await sql<Record<string, unknown>>`SELECT a.codapg, a.codgrupo, a.valor, a.codcxagrupamentocr, p.razao,
        to_char(a.dtcompra AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtcompra, to_char(a.dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc
        FROM apagar a LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
       WHERE a.codapg = ${codConsolidado} AND a.codempresa = ${emp} AND a.agrupamento = 'S'`.execute(db)).rows[0];
    if (!c) throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codapg: codConsolidado });
    const g = num(c.codgrupo);
    const convenio = num(c.codcxagrupamentocr) > 0;
    const docs = convenio
      ? (await sql<Record<string, unknown>>`SELECT r.codrcb AS codigo, r.duplicata, r.codparceiro, p.razao, to_char(r.dtvenda AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS emissao,
            to_char(r.dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc, r.valor
            FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro WHERE r.codgrupo_agrupamento_apg = ${g} ORDER BY p.razao, r.codrcb`.execute(db)).rows
      : (await sql<Record<string, unknown>>`SELECT m.codapg AS codigo, m.duplicata, m.codparceiro, p.razao, to_char(m.dtcompra AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS emissao,
            to_char(m.dtvenc AT TIME ZONE ${tz}, 'DD/MM/YYYY') AS dtvenc, m.valor
            FROM apagar m LEFT JOIN parceiros p ON p.codparceiro = m.codparceiro WHERE m.codgrupo_agrupamento_apg = ${g} ORDER BY p.razao, m.codapg`.execute(db)).rows;
    const empresa = (await sql<Record<string, unknown>>`SELECT razao_social FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    return {
      convenio, empresa: { razao: empresa.razao_social ?? null },
      consolidado: { codapg: num(c.codapg), parceiro: c.razao ?? null, dtcompra: c.dtcompra, dtvenc: c.dtvenc, valor: num(c.valor) },
      documentos: docs.map((d) => ({ ...d, valor: num(d.valor) })),
    };
  }

  /**
   * As impressões do agrupamento no layout do cliente (`BtnImprimirClick`, uAPagar.pas:2460): o `QryAgrupamento` no DbdAgrupamento —
   * os A Pagar do grupo (`SELECT A.*, P.RAZAO … ORDER BY P.RAZAO, A.DTCOMPRA, A.CODAPG`, AgrupamentoCP.fr3) ou somados por parceiro
   * (AgrupamentoCPAgrupado.fr3); no convênio (os A Receber do grupo na grade) os A RECEBER (`… ORDER BY P.RAZAO, A.DTVENDA, A.DTVENC`,
   * AgrupamentoCPCR.fr3 / …CPCRAgrupado.fr3 com SUM(TOTAL)). DbdApagar = o título consolidado da tela com a razão da empresa. Sem linha:
   * "Não foram encontrados dados para imprimir.".
   */
  async impressao(codConsolidado: number, agrupado: boolean) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cons = (await sql<Record<string, unknown>>`SELECT a.*, p.razao, e.razao_social AS razaosocial FROM apagar a
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro LEFT JOIN empresas e ON e.idempresa = a.codempresa
       WHERE a.codapg = ${codConsolidado} AND a.codempresa = ${emp} AND a.agrupamento = 'S'`.execute(db)).rows[0];
    if (!cons) throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codapg: codConsolidado });
    const g = num(cons.codgrupo);
    const convenio = num(cons.codcxagrupamentocr) > 0;
    const rows = convenio
      ? (agrupado
        ? (await sql<Record<string, unknown>>`SELECT p.razao, a.codparceiro, sum(a.valor) AS valor, sum(a.total) AS total FROM areceber a JOIN parceiros p ON p.codparceiro = a.codparceiro
            WHERE a.codgrupo_agrupamento_apg = ${g} GROUP BY p.razao, a.codparceiro ORDER BY p.razao`.execute(db)).rows
        : (await sql<Record<string, unknown>>`SELECT a.*, p.razao FROM areceber a JOIN parceiros p ON p.codparceiro = a.codparceiro
            WHERE a.codgrupo_agrupamento_apg = ${g} ORDER BY p.razao, a.dtvenda, a.dtvenc`.execute(db)).rows)
      : (agrupado
        ? (await sql<Record<string, unknown>>`SELECT p.razao, a.codparceiro, sum(a.valor) AS valor FROM apagar a JOIN parceiros p ON p.codparceiro = a.codparceiro
            WHERE a.codgrupo_agrupamento_apg = ${g} GROUP BY p.razao, a.codparceiro ORDER BY p.razao`.execute(db)).rows
        : (await sql<Record<string, unknown>>`SELECT a.*, p.razao FROM apagar a JOIN parceiros p ON p.codparceiro = a.codparceiro
            WHERE a.codgrupo_agrupamento_apg = ${g} ORDER BY p.razao, a.dtcompra, a.codapg`.execute(db)).rows);
    if (!rows.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não foram encontrados dados para imprimir.');
    const nums = await colunasNumericas(db, ['apagar', 'areceber'], ['valor', 'total']);
    const arquivo = convenio ? (agrupado ? 'AgrupamentoCPCRAgrupado.fr3' : 'AgrupamentoCPCR.fr3') : (agrupado ? 'AgrupamentoCPAgrupado.fr3' : 'AgrupamentoCP.fr3');
    return {
      titulo: `Agrupamento ${codConsolidado}`,
      modelo: await modeloFr3(db, arquivo),
      datasets: { DbdAgrupamento: rows.map((r) => registroFr3(r, nums)), DbdApagar: [registroFr3(cons, nums)] },
    };
  }

  /** os membros do consolidado — pelo CODGRUPO dele */
  async membros(codConsolidado: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`SELECT m.codapg, m.codparceiro, m.valor, m.dtvenc, m.duplicata, m.quitada
        FROM apagar c JOIN apagar m ON m.codgrupo_agrupamento_apg = c.codgrupo
       WHERE c.codapg = ${codConsolidado} AND c.codempresa = ${emp} AND c.agrupamento = 'S'
       ORDER BY m.codapg`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }
}
