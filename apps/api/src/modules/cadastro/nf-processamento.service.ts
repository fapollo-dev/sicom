import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * NF — Fase 3: PROCESSAMENTO (movimento de estoque). A fase mais perigosa.
 *
 * No legado o flip NF.PROC 'N'->'S' dispara a trigger Oracle ESTOQUE_NOTAS, que move o saldo
 * (entrada soma, saída baixa). Aqui o movimento é feito EM CÓDIGO, numa ÚNICA transação atômica
 * (estoque + kardex + flip de PROC) — ganho sobre a trigger, cujo financeiro nem era atômico.
 *
 * Regra verbatim do legado (caso comum loja — dossiê uNF.md §6):
 *  - gatilho: PROC 'N'->'S' (processar) / 'S'->'N' (reverter), COALESCE(ALTERAESTOQUEREVERSAO,'S')='S'
 *  - QTDEX = QUANTIDADE * FATOREMBAL; entrada (+QTDEX) / saída (−QTDEX); estorno = inverso
 *  - UPDATE ESTOQUE SET QTDE = QTDE + QTDEX WHERE IDPRODUTO=x AND IDEMPRESA=emp (loja)
 *  - guardas: GERAQTDE (produto) + GERAESTOQUE + MOVIMENTA_ESTOQUE (item) = 'S'
 *
 * Segurança: o banco legado NÃO impede negativo e a validação de cabeçalho está comentada —
 * aqui BLOQUEAMOS negativo por padrão (postura conservadora). Incremento SEMPRE relativo
 * (`qtde = qtde + delta`, nunca absoluto) + `.forUpdate()` → à prova de corrida. CAS no flip
 * (`WHERE proc=<esperado>`) → idempotente (processar/reverter 2x não duplica).
 *
 * Adiado (F3b+, dossiê §10): ORIGEM 'D'/'P'/'X' (depósito/produção/almox), local/congelado,
 * composição/decomposição (kit), autorização de negativo por senha, conferência, e os efeitos
 * financeiro (F4)/contábil (F5). O corte 1 move SÓ a loja (ESTOQUE.QTDE), sem gatear por
 * ORIGEM_ESTOQUE (cujo uso fiscal/balde foi conflado na F1 — limpeza em F3b).
 */
@Injectable()
export class NfProcessamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  processar(codnf: number): Promise<void> {
    return this.mover(codnf, 'processar');
  }
  reverter(codnf: number): Promise<void> {
    return this.mover(codnf, 'reverter');
  }

  private async mover(codnf: number, modo: 'processar' | 'reverter'): Promise<void> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN'); // fail-closed (saldo é por empresa)

    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // lê e TRAVA o header (escopo empresa). Bloqueios de estado por modo.
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'proc', 'cancelada', 'statusnfe'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });

      if (modo === 'processar') {
        if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
        if (nf.proc === 'S') throw new BusinessRuleError('NF_JA_PROCESSADA', { codnf });
      } else {
        if (nf.proc !== 'S') throw new BusinessRuleError('NF_NAO_PROCESSADA', { codnf });
        // reverter bloqueado se já enviada à SEFAZ (uNF.pas:8945) — 'T' (terceiros importada) libera.
        if (nf.statusnfe && nf.statusnfe !== 'T') throw new BusinessRuleError('NF_ENVIADA', { codnf });
      }

      // sentido: entrada soma / saída baixa; estorno = inverso.
      const base = nf.tipo === 'E' ? 1 : -1;
      const sinal = modo === 'processar' ? base : -base;

      const itens = await trx
        .selectFrom('nf_prod as i')
        .innerJoin('produtos as p', 'p.idproduto', 'i.codproduto')
        .select([
          'i.codproduto as codproduto',
          'i.quantidade as quantidade',
          'i.fatorembal as fatorembal',
          'i.geraestoque as geraestoque',
          'i.movimenta_estoque as movimenta_estoque',
          'p.geraqtde as geraqtde',
        ])
        .where('i.codnf', '=', codnf)
        .execute();

      for (const it of itens as Record<string, unknown>[]) {
        // guardas: produto e item precisam gerar/movimentar estoque.
        if (it.geraqtde !== 'S' || it.geraestoque !== 'S' || it.movimenta_estoque !== 'S') continue;
        const qtdex = num(it.quantidade) * (num(it.fatorembal) || 1); // qtde efetiva
        if (qtdex === 0) continue;
        const delta = sinal * qtdex;
        const cod = Number(it.codproduto);

        // saldo atual TRAVADO (linha pode não existir → 0).
        const ant = await trx
          .selectFrom('estoque')
          .select('qtde')
          .where('idproduto', '=', cod)
          .where('idempresa', '=', emp)
          .forUpdate()
          .executeTakeFirst();
        const saldoAnt = num(ant?.qtde);
        const saldoNovo = Math.round((saldoAnt + delta) * 1000) / 1000;

        // bloqueio conservador de negativo (banco não impede; legado tinha validação comentada).
        if (saldoNovo < 0) {
          throw new BusinessRuleError('NF_ESTOQUE_NEGATIVO', { idproduto: cod, saldo: saldoAnt, qtde: qtdex });
        }

        // upsert RELATIVO (resolve linha ausente + concorrência) — nunca grava saldo absoluto.
        await trx
          .insertInto('estoque')
          .values({ idproduto: cod, idempresa: emp, qtde: delta, minimo: 0, maximo: 0 })
          .onConflict((oc: AnyDB) =>
            oc.columns(['idproduto', 'idempresa']).doUpdateSet({ qtde: sql`estoque.qtde + ${delta}` }),
          )
          .execute();

        // kardex (mesma transação).
        const estorno = modo === 'reverter';
        const historico = estorno
          ? `ESTORNO DE ESTOQUE; REF. A REVERSAO DA NOTA COD: ${codnf}`
          : `${nf.tipo === 'E' ? 'ENTRADA' : 'SAIDA'} DE ESTOQUE; REF. NOTA COD: ${codnf}`;
        await trx
          .insertInto('historico_prod')
          .values({
            idproduto: cod,
            idempresa: emp,
            tipo: nf.tipo,
            qtde: Math.abs(qtdex),
            saldo_anterior: saldoAnt,
            saldo_novo: saldoNovo,
            origem: estorno ? 'NF-REV' : 'NF',
            codnf,
            historico,
            codoperador: op,
          })
          .execute();
      }

      // flip de estado com compare-and-set (anti-corrida/replay).
      const novoProc = modo === 'processar' ? 'S' : 'N';
      const procEsperado = modo === 'processar' ? 'N' : 'S';
      const r = await trx
        .updateTable('nf')
        .set({
          proc: novoProc,
          dtprocessamento: modo === 'processar' ? sql`now()` : null,
          usultalteracao: op,
          dtultimalteracao: sql`now()`,
        })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where('proc', '=', procEsperado)
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) {
        throw new BusinessRuleError(modo === 'processar' ? 'NF_JA_PROCESSADA' : 'NF_NAO_PROCESSADA', { codnf });
      }
    });
  }
}
