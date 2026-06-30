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
 * NF — Fase 4: FATURAMENTO (geração de títulos financeiros). Efeito de DINHEIRO.
 *
 * A NF gera N parcelas como títulos em ARECEBER (saída) / APAGAR (entrada), vinculados por
 * `idnf = codnf`, numa ÚNICA transação atômica (no legado os títulos eram criados FORA da
 * transação do estoque — não-atômico; aqui staging+título nascem juntos ou nada nasce).
 *
 * Invariante que protege o dinheiro: **Σ parcelas == base, ao centavo** — rateio em CENTAVOS
 * com a sobra na ÚLTIMA parcela. (A fórmula exata de BuildParcelas vive em FuncoesApollo.pas,
 * ausente do checkout; a colocação da sobra e o formato de duplicata modelo 01 ficam pendentes
 * de golden — não é risco de valor, a soma fecha.)
 *
 * Modalidade: TIPO='E' → APAGAR; 'S' → ARECEBER. Base (corte 1) = TOTALNF. Idempotente
 * (flag nf.faturada + CAS + checagem por idnf). Estorno bloqueado se houver título quitado.
 *
 * Adiado (F4b/F5, dossiê §10): CAIXA/CX_APAGAR, gate automático por CFOP, retenções/funrural/
 * acordo, deduções da base, NF_FORMA_PAGAMENTO, agrupamento, contábil/DIARIO.
 */
@Injectable()
export class NfFaturamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async faturar(
    codnf: number,
    p: { numParcelas: number; primeiroVencimento: string; intervaloDias: number },
  ): Promise<{ codnf: number; tabela: 'areceber' | 'apagar'; parcelas: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    if (!(p.numParcelas >= 1 && p.numParcelas <= 200)) throw new BusinessRuleError('NUM_PARCELAS_INVALIDO');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'nronf', 'cancelada', 'faturada', 'contabilizado', 'codparceiro', 'totalnf', 'dtemissao', 'dtcontabil'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA', { codnf });
      if (nf.faturada === 'S') throw new BusinessRuleError('NF_JA_FATURADA', { codnf });

      const tabela: 'areceber' | 'apagar' = nf.tipo === 'E' ? 'apagar' : 'areceber';

      // idempotência extra (defesa em profundidade): já existe título desta NF?
      const ja = await trx
        .selectFrom(tabela)
        .select('idnf')
        .where('idnf', '=', codnf)
        .where('codempresa', '=', emp)
        .executeTakeFirst();
      if (ja) throw new BusinessRuleError('NF_JA_FATURADA', { codnf });

      const totalCents = Math.round(num(nf.totalnf) * 100); // base em CENTAVOS
      if (totalCents <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });

      // txjuros do título: taxa PADRÃO DA EMPRESA (`empresas.txjuropadrao` = EmpresaTXJUROPADRAO,
      // udmCadAReceber.pas:214) — F4b corrigido (antes era proxy em parceiros.txjuro). Não afeta o
      // VALOR das parcelas; só a taxa de juro gravada no título (alimenta o Lote de Cobrança).
      const empFin = await trx
        .selectFrom('empresas')
        .select('txjuropadrao')
        .where('idempresa', '=', emp)
        .executeTakeFirst();
      const txjuros = num(empFin?.txjuropadrao);

      // rateio: base por parcela + sobra na ÚLTIMA → Σ == totalCents exatamente.
      const baseCents = Math.floor(totalCents / p.numParcelas);
      const resto = totalCents - baseCents * p.numParcelas;
      // data-base em UTC (evita escorregar 1 dia em fusos negativos): parse + setUTCDate.
      const venc0 = new Date(`${p.primeiroVencimento}T00:00:00Z`);
      // ARECEBER usa DTCONTABIL; APAGAR usa a data de compra (=emissão) — paridade legado.
      const dtdoc = nf.tipo === 'E' ? nf.dtemissao : nf.dtcontabil;

      for (let i = 0; i < p.numParcelas; i++) {
        const cents = baseCents + (i === p.numParcelas - 1 ? resto : 0);
        const dt = new Date(venc0);
        dt.setUTCDate(dt.getUTCDate() + i * p.intervaloDias);
        await trx
          .insertInto(tabela)
          .values({
            codparceiro: nf.codparceiro,
            codempresa: emp, // ATENÇÃO: areceber/apagar usam codempresa (= tenant.empresaId), não idempresa
            idnf: codnf,
            dtvenda: dtdoc,
            dtvenc: dt.toISOString().slice(0, 10),
            // formato da duplicata confirmado no golden: "<NRONF> - NNN/NNN" (referencia NRONF, não
            // CODNF). NRODUP = TOTAL de parcelas (paridade legado: AQtdPar). nronf pode faltar em
            // rascunho → fallback p/ codnf.
            duplicata: `${nf.nronf ?? codnf} - ${String(i + 1).padStart(3, '0')}/${String(p.numParcelas).padStart(3, '0')}`,
            nrodup: p.numParcelas,
            valor: cents / 100,
            txjuros,
            quitada: 'N',
            consiliado: 'N',
          })
          .execute();
      }

      const r = await trx
        .updateTable('nf')
        .set({ faturada: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where('faturada', '=', 'N')
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_JA_FATURADA', { codnf });

      return { codnf, tabela, parcelas: p.numParcelas };
    });
  }

  async estornarFaturamento(codnf: number): Promise<void> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');

    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'faturada', 'contabilizado'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.faturada !== 'S') throw new BusinessRuleError('NF_NAO_FATURADA', { codnf });
      // estorno bloqueado se já contabilizada (uNF.pas:8951 — espelha a guarda do reverter).
      if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA', { codnf });

      const tabela = nf.tipo === 'E' ? 'apagar' : 'areceber';

      // trava: não estornar se algum título já foi quitado (espelha VerificaExisteBaixas; corte 1).
      const quit = await trx
        .selectFrom(tabela)
        .select('idnf')
        .where('idnf', '=', codnf)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'S')
        .executeTakeFirst();
      if (quit) throw new BusinessRuleError('TITULO_QUITADO', { codnf });

      await trx.deleteFrom(tabela).where('idnf', '=', codnf).where('codempresa', '=', emp).execute();

      const r = await trx
        .updateTable('nf')
        .set({ faturada: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where('faturada', '=', 'S')
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_NAO_FATURADA', { codnf });
    });
  }
}
