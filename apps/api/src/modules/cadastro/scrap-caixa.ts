/**
 * O SCRAP NA CAIXA GERENCIAL (`btnGravarClick`, uCadSCRAP.pas:716-760; `CAIXA-escritores.md`): a cada gravação de um
 * scrap com centro de custo, lança na CAIXA a DIFERENÇA entre o valor da perda (Σ quantidade × custo ATUAL do
 * MULTI_PRECO) e o que já foi lançado para o scrap — perda maior → linha negativa "Perca de produtos"; menor → linha
 * positiva "Estorno de perca produtos". A comparação é com a perda SEM arredondar (como o legado), então às vezes sai
 * uma linha de 0,00 (55 de 4.880 em 2026). Produção 2026: 4.880 linhas (R$ −7,3 mi), 235 de 244 scraps, ~20 por
 * scrap (ele é gravado várias vezes no dia); data e vencimento = o dia da gravação, parcela '1', parceiro 0, DINHEIRO,
 * SISTEMA. A exclusão do scrap leva a CAIXA junto (`FK_CAIXA_SCRAP ... ON DELETE CASCADE` no Oracle).
 */
import { sql } from 'kysely';
import { currentTenant } from '../../shared/tenant/tenant-context';

type AnyDB = any;

export async function lancarCaixaDoScrap(trx: AnyDB, codscrap: number, emp: number | null): Promise<void> {
  if (emp == null) return;
  const r = (await sql<{ codplc: number | null; perda: string | null; lancado: string | null }>`
    SELECT s.codplc,
           (SELECT sum(i.qtde * coalesce(m.vrcusto, 0)) FROM scrap_item i
              LEFT JOIN multi_preco m ON m.idproduto = i.idproduto AND m.idempresa = s.idempresa
             WHERE i.codscrap = s.codscrap AND coalesce(i.qtde, 0) <> 0) AS perda,
           (SELECT coalesce(sum(x.valor), 0) FROM caixa x WHERE x.codscrap = s.codscrap) AS lancado
      FROM scrap s WHERE s.codscrap = ${codscrap} AND s.idempresa = ${emp}`.execute(trx)).rows[0];
  if (!r || r.codplc == null || Number(r.codplc) === 0) return;
  const perda = Number(r.perda ?? 0);
  const lancado = Math.abs(Number(r.lancado ?? 0));
  if (lancado === perda) return;
  const [valor, obs] = lancado < perda ? [-(perda - lancado), 'Perca de produtos'] : [lancado - perda, 'Estorno de perca produtos'];
  const v = Math.round((valor + (valor >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
  await trx.insertInto('caixa').values({
    data: sql`current_date`, valor: v, vrtitulo: v, obs, operador: currentTenant().operadorId ?? null, codplc: Number(r.codplc),
    idempresa: emp, tiporecurso: 'DINHEIRO', codconta: null, codparceiro: 0, nrparcela: '1', codgrupo: null,
    dtvenc: sql`current_date`, gerado: 'SISTEMA', codscrap, origem: 'SCRAP',
  }).execute();
}
