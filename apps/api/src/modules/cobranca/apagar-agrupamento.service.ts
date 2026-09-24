import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { configNaTrx } from '../compras/pedido-heranca';
import { apagarRateioDoGrupo, novoGrupo, rateioUnico, refazerCaixaDoGrupo } from './apagar-caixa';
import { DocumentosContabilService } from './documentos-contabil.service';

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
      const lidos = (await sql<Record<string, unknown>>`SELECT a.codapg, a.codparceiro, a.valor, a.quitada, a.agrupado, n.nronf
          FROM apagar a LEFT JOIN nf n ON n.codnf = a.idnf
         WHERE a.codapg = ANY(${ids}::int[]) AND a.codempresa = ${emp} FOR UPDATE OF a`.execute(trx)).rows;
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
          WHERE codapg = ANY(${ids}::int[]) AND codempresa = ${emp}`.execute(trx);
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
      const r = await sql`UPDATE apagar SET agrupado = 'N', codgrupo_agrupamento_apg = NULL, usultalteracao = ${op}, dtultimalteracao = now()
          WHERE codgrupo_agrupamento_apg = ${g} AND codempresa = ${emp}`.execute(trx);
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
        WHERE a.codgrupo_agrupamento_apg = ${g} AND a.codempresa = ${emp}`.execute(trx);
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
      const m = (await sql<Record<string, unknown>>`SELECT codapg, valor, codgrupo_agrupamento_apg FROM apagar WHERE codapg = ${codMembro} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows[0];
      if (!m || num(m.codgrupo_agrupamento_apg) !== num(c.codgrupo)) throw new BusinessRuleError('TITULO_NAO_PERTENCE_AGRUPAMENTO', { codapg: codMembro });
      await sql`UPDATE apagar SET agrupado = 'N', codgrupo_agrupamento_apg = NULL, usultalteracao = ${op}, dtultimalteracao = now() WHERE codapg = ${codMembro}`.execute(trx);
      const novoValor = r2(num(c.valor) - num(m.valor));
      await sql`UPDATE apagar SET valor = ${novoValor}, usultalteracao = ${op}, dtultimalteracao = now() WHERE codapg = ${codConsolidado}`.execute(trx);
      const restantes = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM apagar WHERE codgrupo_agrupamento_apg = ${num(c.codgrupo)} AND codempresa = ${emp}`.execute(trx)).rows[0].n);
      return { consolidado: codConsolidado, removido: codMembro, novoValor, membrosRestantes: restantes };
    });
  }

  /** os membros do consolidado — pelo CODGRUPO dele */
  async membros(codConsolidado: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`SELECT m.codapg, m.codparceiro, m.valor, m.dtvenc, m.duplicata, m.quitada
        FROM apagar c JOIN apagar m ON m.codgrupo_agrupamento_apg = c.codgrupo AND m.codempresa = c.codempresa
       WHERE c.codapg = ${codConsolidado} AND c.codempresa = ${emp} AND c.agrupamento = 'S'
       ORDER BY m.codapg`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }
}
