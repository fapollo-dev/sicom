import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DescontoTituloExecutarDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ENCONTRO DE CONTAS (`FRMDESCONTOTITULO`) — **corte-2: executar e reverter**. Migration 272; o corte-1
 * (a consulta) está na 226. Dossiê: `uDescontoTitulo.md`. **68 acessos, 11 operadores, R$ 254 mil.**
 *
 * A regra foi reconstruída do DADO (a operação 221, de 12/09/2026, ponta a ponta) e reproduz os dois
 * casos que o autor descreveu no comentário do `Gravar` (uDescontoTitulo.pas:886) com uma regra só:
 *
 *   **abate-se o MENOR dos dois valores reais nos dois títulos; o que sobrar de cada um vira título novo.**
 *
 * · os dois títulos originais ficam `quitada='S'` com `cod_desconto_titulo` da operação;
 * · cada título novo leva `codgrupo_desconto_titulo` (e NÃO `cod_desconto_titulo` — é o que o dado mostra,
 *   contra o que o comentário do autor diz);
 * · as duas baixas têm o MESMO valor (o menor) e a obs do legado, com o mesmo `idlote`;
 * · o par de movimentos de conta corrente (crédito no AR, débito no AP) **soma zero** — no cliente são 46
 *   lançamentos com 'desconto de titulo' no histórico, somando exatamente 0.
 *
 * A reversão apaga as baixas, volta os títulos para abertos e apaga os gerados — e, a mais que o legado,
 * **recusa reverter** se um título gerado já tiver baixa própria (o legado apagava o título e deixava a
 * baixa órfã).
 */
@Injectable()
export class DescontoTituloExecService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async executar(dto: DescontoTituloExecutarDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const rcb = (await sql<Record<string, unknown>>`
        SELECT codrcb, codparceiro, valor, coalesce(quitada, 'N') AS quitada, dtvenda, dtvenc, txjuros, codbco, idpgto, codvendedor, codcobrador
          FROM areceber WHERE codrcb = ${dto.codrcb} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows[0];
      if (!rcb) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb: dto.codrcb });
      const apg = (await sql<Record<string, unknown>>`
        SELECT codapg, codparceiro, valor, coalesce(quitada, 'N') AS quitada, dtcompra, dtvenc, txjuros, codbco, idpgto, tipodoc
          FROM apagar WHERE codapg = ${dto.codapg} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows[0];
      if (!apg) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: dto.codapg });

      if (rcb.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: dto.codrcb });
      if (apg.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codapg: dto.codapg });
      if (Number(rcb.codparceiro) !== Number(apg.codparceiro)) {
        throw new BusinessRuleError('PARCEIROS_DIFERENTES', { codparceiroRcb: Number(rcb.codparceiro), codparceiroApg: Number(apg.codparceiro) });
      }

      const valorRcb = r2(num(rcb.valor));
      const valorApg = r2(num(apg.valor));
      const realRcb = r2(dto.valorRealRcb ?? valorRcb);
      const realApg = r2(dto.valorRealApg ?? valorApg);
      if (realRcb > valorRcb) throw new BusinessRuleError('VALOR_REAL_EXCEDE', { codrcb: dto.codrcb, valor: valorRcb, valorReal: realRcb });
      if (realApg > valorApg) throw new BusinessRuleError('VALOR_REAL_EXCEDE', { codapg: dto.codapg, valor: valorApg, valorReal: realApg });

      const abate = r2(Math.min(realRcb, realApg));
      if (abate <= 0) throw new BusinessRuleError('VALOR_REAL_INVALIDO', { realRcb, realApg });

      const cod = Number((await sql<{ n: unknown }>`SELECT nextval('seq_desconto_titulo') AS n`.execute(trx)).rows[0]?.n);
      const lote = Number((await sql<{ n: unknown }>`SELECT nextval('seq_idlote_desconto_titulo') AS n`.execute(trx)).rows[0]?.n);

      // ── as duas baixas, pelo MESMO valor (o menor), com a obs do legado ─────────────────────────────
      await sql`INSERT INTO areceber_bx (codrcb, codempresa, valorpg, juros, multa, acre_desc, dtpgto, codopbx, data_operacao, indr, idlote, obs)
                VALUES (${dto.codrcb}, ${emp}, ${abate}, 0, 0, 0, current_date, ${op}, now(), 'I', ${lote},
                        ${`DOCUMENTO BAIXADO VIA DESCONTO TITULO Nº: ${dto.codapg} APG |LOTE:${lote}`})`.execute(trx);
      await sql`INSERT INTO apagar_bx (codapg, codempresa, valorpg, juros, multa, acre_desc, dtpgto, codopbx, data_operacao, indr, idlote, obs)
                VALUES (${dto.codapg}, ${emp}, ${abate}, 0, 0, 0, current_date, ${op}, now(), 'I', ${lote},
                        ${`DOCUMENTO BAIXADO VIA DESCONTO TITULO Nº: ${dto.codrcb} |LOTE:${lote}`})`.execute(trx);

      await sql`UPDATE areceber SET quitada = 'S', dtpgto = current_date, cod_desconto_titulo = ${cod},
                       usultalteracao = ${op}, dtultimalteracao = now()
                 WHERE codrcb = ${dto.codrcb} AND codempresa = ${emp}`.execute(trx);
      await sql`UPDATE apagar SET quitada = 'S', dtpgto = current_date, cod_desconto_titulo = ${cod},
                       usultalteracao = ${op}, dtultimalteracao = now()
                 WHERE codapg = ${dto.codapg} AND codempresa = ${emp}`.execute(trx);

      // ── o que sobrou de cada título vira título novo, marcado com o GRUPO da operação ───────────────
      const gerados: Array<Record<string, unknown>> = [];
      const sobraRcb = r2(valorRcb - abate);
      if (sobraRcb > 0) {
        const g = (await sql<{ codrcb: unknown }>`
          INSERT INTO areceber (codparceiro, codempresa, valor, dtvenda, dtvenc, txjuros, tipodoc, origem, gerado, quitada, agrupado,
                                codbco, idpgto, codvendedor, codcobrador, codgrupo_desconto_titulo, obs, usultalteracao, dtultimalteracao, dtcadastro)
          VALUES (${rcb.codparceiro}, ${emp}, ${sobraRcb}, ${rcb.dtvenda}, ${rcb.dtvenc}, ${rcb.txjuros ?? null}, 'DUPLICATA', 'D', 'SISTEMA', 'N', 'N',
                  ${rcb.codbco ?? null}, ${rcb.idpgto ?? null}, ${rcb.codvendedor ?? null}, ${rcb.codcobrador ?? null}, ${cod},
                  ${`Documento gerado do desconto de titulo nº ${cod} (restante do RCB ${dto.codrcb}).`}, ${op}, now(), now())
          RETURNING codrcb`.execute(trx)).rows[0];
        gerados.push({ tipo: 'AR', codigo: Number(g.codrcb), valor: sobraRcb });
      }
      const sobraApg = r2(valorApg - abate);
      if (sobraApg > 0) {
        const g = (await sql<{ codapg: unknown }>`
          INSERT INTO apagar (codparceiro, codempresa, valor, dtcompra, dtvenc, txjuros, tipodoc, origem, gerado, quitada, agrupado,
                              codbco, idpgto, codgrupo_desconto_titulo, obs, usultalteracao, dtultimalteracao, dtcadastro)
          VALUES (${apg.codparceiro}, ${emp}, ${sobraApg}, ${apg.dtcompra}, ${apg.dtvenc}, ${apg.txjuros ?? null}, ${apg.tipodoc ?? 'DUPLICATA'}, 'D', 'SISTEMA', 'N', 'N',
                  ${apg.codbco ?? null}, ${apg.idpgto ?? null}, ${cod},
                  ${`Documento gerado do desconto de titulo nº ${cod} (restante do APG ${dto.codapg}).`}, ${op}, now(), now())
          RETURNING codapg`.execute(trx)).rows[0];
        gerados.push({ tipo: 'AP', codigo: Number(g.codapg), valor: sobraApg });
      }

      // ── o par de movimentos da conta corrente: crédito no AR, débito no AP — soma zero ──────────────
      if (dto.codconta != null) {
        const hist = `${dto.obs ? `${dto.obs} - ` : ''}Baixa de contas a receber via desconto de titulo nº ${dto.codrcb}`;
        await sql`INSERT INTO mov_contas_bancarias (codconta, idempresa, valor, tipomovimento, historico, codoperador, origem, idorigem, dtcadastro)
                  VALUES (${dto.codconta}, ${emp}, ${abate}, 'C', ${hist}, ${op}, 'DESC TIT', ${cod}, now())`.execute(trx);
        await sql`INSERT INTO mov_contas_bancarias (codconta, idempresa, valor, tipomovimento, historico, codoperador, origem, idorigem, dtcadastro)
                  VALUES (${dto.codconta}, ${emp}, ${abate}, 'D', ${`${dto.obs ? `${dto.obs} - ` : ''}Baixa de contas a pagar via desconto de titulo nº ${dto.codapg}`}, ${op}, 'DESC TIT', ${cod}, now())`.execute(trx);
      }

      return {
        operacao: cod, idlote: lote, codparceiro: Number(rcb.codparceiro),
        abatido: abate,
        receber: { codrcb: dto.codrcb, valor: valorRcb, valorReal: realRcb, baixado: abate, sobra: sobraRcb },
        pagar: { codapg: dto.codapg, valor: valorApg, valorReal: realApg, baixado: abate, sobra: sobraApg },
        gerados,
        contaCorrente: dto.codconta == null ? null : { codconta: dto.codconta, credito: abate, debito: abate, liquido: 0 },
      };
    });
  }

  async reverter(operacao: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const orig = {
        rcb: (await sql<Record<string, unknown>>`SELECT codrcb FROM areceber WHERE cod_desconto_titulo = ${operacao} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows,
        apg: (await sql<Record<string, unknown>>`SELECT codapg FROM apagar WHERE cod_desconto_titulo = ${operacao} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows,
      };
      const ger = {
        rcb: (await sql<Record<string, unknown>>`SELECT codrcb, coalesce(quitada, 'N') AS quitada FROM areceber WHERE codgrupo_desconto_titulo = ${operacao} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows,
        apg: (await sql<Record<string, unknown>>`SELECT codapg, coalesce(quitada, 'N') AS quitada FROM apagar WHERE codgrupo_desconto_titulo = ${operacao} AND codempresa = ${emp} FOR UPDATE`.execute(trx)).rows,
      };
      if (orig.rcb.length === 0 && orig.apg.length === 0 && ger.rcb.length === 0 && ger.apg.length === 0) {
        throw new BusinessRuleError('OPERACAO_NAO_ENCONTRADA', { operacao });
      }

      // o legado apagava o título gerado e deixava a baixa dele órfã — aqui a reversão é recusada
      for (const g of ger.rcb) {
        const bx = (await sql<{ n: unknown }>`SELECT count(*) AS n FROM areceber_bx WHERE codrcb = ${Number(g.codrcb)}`.execute(trx)).rows[0];
        if (Number(bx?.n ?? 0) > 0 || g.quitada === 'S') throw new BusinessRuleError('TITULO_GERADO_COM_MOVIMENTO', { operacao, codrcb: Number(g.codrcb) });
      }
      for (const g of ger.apg) {
        const bx = (await sql<{ n: unknown }>`SELECT count(*) AS n FROM apagar_bx WHERE codapg = ${Number(g.codapg)}`.execute(trx)).rows[0];
        if (Number(bx?.n ?? 0) > 0 || g.quitada === 'S') throw new BusinessRuleError('TITULO_GERADO_COM_MOVIMENTO', { operacao, codapg: Number(g.codapg) });
      }

      let baixasRcb = 0;
      let baixasApg = 0;
      for (const t of orig.rcb) {
        const d = await sql<{ codrcbbx: unknown }>`DELETE FROM areceber_bx WHERE codrcb = ${Number(t.codrcb)} AND codempresa = ${emp} RETURNING codrcbbx`.execute(trx);
        baixasRcb += d.rows.length;
        await sql`UPDATE areceber SET quitada = 'N', dtpgto = NULL, cod_desconto_titulo = NULL, usultalteracao = ${op}, dtultimalteracao = now()
                   WHERE codrcb = ${Number(t.codrcb)} AND codempresa = ${emp}`.execute(trx);
      }
      for (const t of orig.apg) {
        const d = await sql<{ codapgbx: unknown }>`DELETE FROM apagar_bx WHERE codapg = ${Number(t.codapg)} AND codempresa = ${emp} RETURNING codapgbx`.execute(trx);
        baixasApg += d.rows.length;
        await sql`UPDATE apagar SET quitada = 'N', dtpgto = NULL, cod_desconto_titulo = NULL, usultalteracao = ${op}, dtultimalteracao = now()
                   WHERE codapg = ${Number(t.codapg)} AND codempresa = ${emp}`.execute(trx);
      }
      for (const g of ger.rcb) await sql`DELETE FROM areceber WHERE codrcb = ${Number(g.codrcb)} AND codempresa = ${emp}`.execute(trx);
      for (const g of ger.apg) await sql`DELETE FROM apagar WHERE codapg = ${Number(g.codapg)} AND codempresa = ${emp}`.execute(trx);

      const movs = await sql<{ codmovconta: unknown }>`
        DELETE FROM mov_contas_bancarias WHERE idempresa = ${emp} AND origem = 'DESC TIT' AND idorigem = ${operacao} RETURNING codmovconta`.execute(trx);

      return {
        operacao,
        reabertos: { receber: orig.rcb.map((t) => Number(t.codrcb)), pagar: orig.apg.map((t) => Number(t.codapg)) },
        apagados: { receber: ger.rcb.map((g) => Number(g.codrcb)), pagar: ger.apg.map((g) => Number(g.codapg)) },
        baixasRemovidas: { receber: baixasRcb, pagar: baixasApg },
        movimentosRemovidos: movs.rows.length,
      };
    });
  }
}
