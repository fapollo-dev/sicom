import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { resolverContaContabilParceiro } from '../shared/conta-parceiro';

type AnyDB = Kysely<any>;
type Origem = 'AR' | 'AP';

// CODORIGEM da baixa no DIÁRIO (UIntegracaoContabil): A Receber = 16, A Pagar = 15 (Oracle: 13.893/19.832
// linhas, 100% CODOPERACAO 2009/2004). NF=12 e caixa-fechamento=17 são disjuntos (fronteira limpa).
const CODORIGEM: Record<Origem, number> = { AR: 16, AP: 15 };
// Situação contábil da baixa (CONFIG_BAIXA_RCB=2009 / CONFIG_BAIXA_APG=2004, confirmadas no Oracle).
const SITUACAO: Record<Origem, number> = { AR: 2009, AP: 2004 };

/**
 * AR/AP corte-3b — CONTÁBIL da BAIXA/pagamento. Molde de `caixa-contabil.service`/`nf-contabilizacao`:
 * lança 1 partida BALANCEADA no DIÁRIO por baixa, gate EMPRESAS.INTEGRACAO='AUTOMATICA', período aberto,
 * idempotente (areceber_bx/apagar_bx.contabilizado) e reversível (DELETE por CODORIGEM/IDORIGEM=codbx).
 *
 * A IIC das situações 2009/2004 tem os DOIS lados TIPO='A' no legado (perna de dinheiro por RECURSO +
 * perna do parceiro). A perna "de dinheiro" (TIPO='F' na 055) é a conta 183 CAIXA CENTRAL por padrão
 * (recurso DINHEIRO); **corte-2 (recurso BANCO)** passa `contaMoney` = conta contábil do banco
 * (contas_bancarias.codlanccontabil) e ela SUBSTITUI a 183 nessa perna (mesma situação 2009/2004, D banco /
 * C cliente no AR, D fornecedor / C banco no AP). A outra perna resolve pelo parceiro (AR→cliente CODCONTABIL /
 * AP→fornecedor CODCONTABIL_FOR). Divergência CONSCIENTE do legado single-legged-agregado: aqui é partida-por-baixa.
 *
 * ADIADO: baixa por CHEQUE/CARTÃO (situações/tabelas CHEQUE/CARTAO/893 ausentes); linhas separadas de
 * JUROS/DESCONTO (874/878/879… — provado INÓCUO: o legado credita o valorpg cheio ao cliente). Ver recon.
 */
@Injectable()
export class BaixaContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private static readonly BX = { AR: { tabela: 'areceber_bx', pk: 'codrcbbx' }, AP: { tabela: 'apagar_bx', pk: 'codapgbx' } } as const;

  /** período contábil FECHADO barra a contabilização (mesma regra da NF/caixa). Fail-open. */
  private async assertPeriodoAberto(trx: AnyDB, emp: number, data: unknown): Promise<void> {
    if (data == null) return;
    const fechado = await trx
      .selectFrom('periodo_contabil').select('competencia_contabil')
      .where('codempresa', '=', emp).where('status', '=', 'S').where('bloq_nf', '=', 'S')
      .where('data_inicio', '<=', data).where('data_fim', '>=', data)
      .executeTakeFirst();
    if (fechado) throw new BusinessRuleError('PERIODO_FECHADO', { data });
  }

  /**
   * Contabiliza a baixa DENTRO da transação da própria baixa (auto-disparo). Lança BusinessRuleError
   * quando inelegível (não-AUTOMATICA / período fechado / conta ausente) — o chamador engole (best-effort),
   * como `tentarContabilizar` da NF. TODAS as validações/resoluções ocorrem ANTES de qualquer INSERT
   * (se lançar, nada foi gravado → engolir é seguro).
   */
  async contabilizarNoTrx(
    trx: AnyDB,
    emp: number,
    p: { origem: Origem; codbx: number; codparceiro: number | null; valor: number; data: unknown; op: number | null; contaMoney?: number | null },
  ): Promise<void> {
    // gate: só integra quando a empresa é AUTOMATICA (EMPRESAS.INTEGRACAO).
    const empc = await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst();
    if ((empc as any)?.integracao !== 'AUTOMATICA') throw new BusinessRuleError('INTEGRACAO_NAO_AUTOMATICA');
    await this.assertPeriodoAberto(trx, emp, p.data);

    const situacao = SITUACAO[p.origem];
    const iic = await trx
      .selectFrom('itens_integracao_contabil')
      .select(['natureza', 'tipo', 'codconta_contabil', 'codhistorico'])
      .where('codoperacao', '=', situacao)
      .execute();
    const dRow = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'D');
    const cRow = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'C');
    if (!dRow || !cRow) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
    // corte-1 exige EXATAMENTE 1 perna FIXA (a de dinheiro = 183, recurso DINHEIRO); a outra é 'A' (parceiro).
    // Guarda contra o cenário legado 'A'/'A' recurso-driven (perna de dinheiro por banco/cartão): se a IIC for
    // reimportada com os dois lados 'A' (o ON CONFLICT do 055 viraria no-op), NÃO produzir D=cliente/C=cliente.
    if ([dRow, cRow].filter((x) => x.tipo === 'F').length !== 1) throw new BusinessRuleError('CONTA_AUTOMATICA_NAO_SUPORTADA', { situacao });

    // conta do parceiro (perna TIPO='A'): AR→cliente CODCONTABIL / AP→fornecedor CODCONTABIL_FOR.
    const contaParceiro = await this.resolverContaParceiro(trx, p.origem, p.codparceiro, situacao);
    // perna de dinheiro (TIPO='F'): 183 (DINHEIRO) OU a conta do banco (recurso BANCO, contaMoney).
    const contaMoney = p.contaMoney ?? null;
    const contadebito = this.resolverLeg(dRow, contaParceiro, contaMoney, situacao);
    const contacredito = this.resolverLeg(cRow, contaParceiro, contaMoney, situacao);
    const valor = Math.round(Math.abs(p.valor) * 100) / 100;

    const lote = await trx
      .insertInto('lote_contabil')
      .values({ desclote: `${p.origem} baixa ${p.codbx}`, datalote: p.data, codorigem: CODORIGEM[p.origem], codempresa: emp })
      .returning('codlotecontabil').executeTakeFirstOrThrow();
    await trx
      .insertInto('diario')
      .values({
        datalan: p.data, contadebito, contacredito, valor,
        codorigem: CODORIGEM[p.origem], idorigem: p.codbx, codoperacao: situacao, codempresa: emp,
        codhist: (dRow.codhistorico as number) ?? null,
        complemento: p.origem === 'AR' ? 'Recebimento de título' : 'Pagamento de título',
        codlote: Number((lote as any).codlotecontabil),
      })
      .execute();

    const bx = BaixaContabilService.BX[p.origem];
    await trx.updateTable(bx.tabela).set({ contabilizado: 'S' }).where(bx.pk, '=', p.codbx).execute();
  }

  /** perna: TIPO='F' → conta de dinheiro (contaMoney do recurso BANCO, senão a fixa 183 da IIC);
   * TIPO='A' → conta do parceiro. */
  private resolverLeg(row: Record<string, unknown>, contaParceiro: number | null, contaMoney: number | null, situacao: number): number {
    if (row.tipo === 'F') {
      if (contaMoney != null) return contaMoney; // recurso BANCO: substitui a 183 pela conta contábil do banco
      if (row.codconta_contabil == null) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
      return Number(row.codconta_contabil);
    }
    if (contaParceiro == null) throw new BusinessRuleError('CONTA_PARCEIRO_NAO_DEFINIDA', { situacao });
    return contaParceiro;
  }

  private async resolverContaParceiro(trx: AnyDB, origem: Origem, codparceiro: number | null, _situacao: number): Promise<number | null> {
    // T1.4: conta própria do parceiro OU a analítica DEFAULT do CONFIG_PLANO_CONTAS (fallback). null → resolverLeg
    // lança CONTA_PARCEIRO_NAO_DEFINIDA (só quando NEM própria NEM default existem). AR=cliente(CLI) / AP=fornecedor(FOR).
    return resolverContaContabilParceiro(trx, codparceiro, origem === 'AR' ? 'CLI' : 'FOR');
  }

  /**
   * Estorno do DIÁRIO da baixa DENTRO da transação do estorno da baixa. DELETE por (CODORIGEM, IDORIGEM=codbx)
   * + lotes órfãos + zera *_bx.contabilizado. Idempotente (no-op se a baixa não foi contabilizada).
   */
  async estornarNoTrx(trx: AnyDB, emp: number, origem: Origem, codbx: number, op: number | null): Promise<void> {
    const codorigem = CODORIGEM[origem];
    const lotes = await trx
      .selectFrom('diario').select('codlote').distinct()
      .where('codorigem', '=', codorigem).where('idorigem', '=', codbx).where('codempresa', '=', emp)
      .execute();
    await trx.deleteFrom('diario').where('codorigem', '=', codorigem).where('idorigem', '=', codbx).where('codempresa', '=', emp).execute();
    const ids = (lotes as Record<string, unknown>[]).map((l) => Number(l.codlote)).filter((n) => Number.isFinite(n));
    if (ids.length) await trx.deleteFrom('lote_contabil').where('codlotecontabil', 'in', ids).execute();
    const bx = BaixaContabilService.BX[origem];
    await trx.updateTable(bx.tabela).set({ contabilizado: null }).where(bx.pk, '=', codbx).execute();
    void op; // auditoria do estorno fica no próprio *_bx (INDR/data_operacao) do chamador
  }
}
