import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// CODORIGEM da conferência do PDV no DIÁRIO. GOLDEN = 17 (SALDO_OPERADOR), MAS o monorepo já ocupa 17 com o
// caixa_sessao (adaptação retaguarda) E com o líquido do PDV (2010) — e a SOBRA (2019) é COMPARTILHADA com o
// caixa_sessao, então reusar 17 faria o reabrir do caixa_sessao apagar a divergência do PDV (idorigem em
// espaços distintos, mas 2019 casa). Divergência CONSCIENTE: usa 18 (livre) → estorno por (18, idsaldoop)
// sem colisão; situações 2018/2019 + contas/hist fiéis ao golden.
const CODORIGEM_CONFERENCIA = 18;
const SIT_SOBRA = 2019; // D 183 CAIXA CENTRAL / C 541 SOBRA DE CAIXA (hist 84)
const SIT_QUEBRA = 2018; // D 541 SOBRA DE CAIXA / C 200 VENDAS TRANSITORIAS (hist 85) — quebra-sem-título

/**
 * CAIXA × CX_VENDAS — CONFERÊNCIA do FECHAMENTO do PDV (uFinalizaFechamento, SALDO_OPERADOR). Para um CODGRUPO
 * (turno) o operador informa o valor REAL contado na gaveta; o serviço calcula o ESPERADO = Σ DINHEIRO
 * (valor − troco) do CX_VENDAS do grupo e a diferenca = real − esperado + devolução (uFinalizaFechamento:903).
 * <0 = QUEBRA, >0 = SOBRA. Grava 1 SALDO_OPERADOR e:
 *  - QUEBRA + gerarTitulo → gera título A Receber (origem 'Q') contra o operador (785) e NÃO lança divergência
 *    (o contábil vem do A Receber);
 *  - senão, lança a divergência no DIÁRIO (SOBRA 2019 / QUEBRA 2018), gated por INTEGRACAO='AUTOMATICA' +
 *    período aberto (não-automática → grava o SALDO sem contábil). Estorno reverte tudo. Idempotente por grupo.
 */
@Injectable()
export class CaixaConferenciaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** true se a `data` cai num período contábil FECHADO (status='S' + bloq_nf). Fail-open (sem período → aberto). */
  private async periodoFechado(trx: AnyDB, emp: number, data: unknown): Promise<boolean> {
    if (data == null) return false;
    const p = await trx
      .selectFrom('periodo_contabil').select('competencia_contabil')
      .where('codempresa', '=', emp).where('status', '=', 'S').where('bloq_nf', '=', 'S')
      .where('data_inicio', '<=', sql`cast(${data} as date)`).where('data_fim', '>=', sql`cast(${data} as date)`)
      .executeTakeFirst();
    return !!p;
  }

  /** as contas D/C de uma situação (IIC TIPO='F'). */
  private async iicDC(trx: AnyDB, situacao: number): Promise<{ d: number; c: number; hist: number | null }> {
    const rows = (await trx
      .selectFrom('itens_integracao_contabil').select(['natureza', 'codconta_contabil', 'codhistorico'])
      .where('codoperacao', '=', situacao).execute()) as Array<{ natureza: string; codconta_contabil: number | null; codhistorico: number | null }>;
    const d = rows.find((r) => r.natureza === 'D');
    const c = rows.find((r) => r.natureza === 'C');
    if (!d?.codconta_contabil || !c?.codconta_contabil) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
    return { d: Number(d.codconta_contabil), c: Number(c.codconta_contabil), hist: (d.codhistorico as number) ?? null };
  }

  /**
   * Confere o fechamento do PDV do CODGRUPO. `valorReal` = contado na gaveta; `devolucao` opcional; `gerarTitulo`
   * (default false) cobra a quebra do operador via A Receber.
   */
  async conferir(
    codgrupo: number,
    dto: { valorReal: number; devolucao?: number; gerarTitulo?: boolean },
  ): Promise<{ idsaldoop: number; codgrupo: number; esperado: number; valorReal: number; devolucao: number; diferenca: number; classificacao: 'OK' | 'QUEBRA' | 'SOBRA'; codrcb: number | null; contabilizado: 'S' | null; situacao: number | null }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // 1) 1 conferência ativa por grupo.
      const jaExiste = await trx
        .selectFrom('saldo_operador').select('idsaldoop')
        .where('idempresa', '=', emp).where('codgrupo', '=', codgrupo).where(sql`coalesce(excluido,'N')`, '<>', 'S')
        .executeTakeFirst();
      if (jaExiste) throw new BusinessRuleError('CONFERENCIA_JA_REALIZADA', { codgrupo });

      // 2) metadados do grupo + ESPERADO (Σ DINHEIRO valor−troco). LOCK das linhas do grupo.
      await trx.selectFrom('cx_vendas').select('codcxvendas').where('idempresa', '=', emp).where('codgrupo', '=', codgrupo).forUpdate().execute();
      const meta = (await trx
        .selectFrom('cx_vendas')
        .select([
          sql<number>`count(*)`.as('n'),
          sql<number>`min(codoperadora)`.as('codoperador'),
          sql<number>`min(nropdv)`.as('codpdv'),
          sql<string>`to_char(max(data),'YYYY-MM-DD')`.as('datafech'),
        ])
        .where('idempresa', '=', emp).where('codgrupo', '=', codgrupo)
        .executeTakeFirst()) as { n: number; codoperador: number | null; codpdv: number | null; datafech: string | null };
      if (!meta || Number(meta.n) === 0) throw new BusinessRuleError('GRUPO_SEM_MOVIMENTO', { codgrupo });

      // ESPERADO da gaveta (fiel a sqqFechaVendas): Σ DINHEIRO (valor − troco − venda_balcao − sangrias + suprimentos).
      // A netagem de sangria/suprimento/venda_balcao evita a QUEBRA-fantasma quando há retirada de caixa no turno.
      const espRow = (await trx
        .selectFrom('cx_vendas')
        .select(sql<number>`coalesce(sum(coalesce(valor,0) - coalesce(troco,0) - coalesce(venda_balcao,0) - coalesce(sangrias,0) + coalesce(suprimentos,0)),0)`.as('esp'))
        .where('idempresa', '=', emp).where('codgrupo', '=', codgrupo).where(sql`upper(operacao)`, '=', 'DINHEIRO')
        .executeTakeFirst()) as { esp: number };
      const esperado = r2(num(espRow.esp));
      const valorReal = r2(num(dto.valorReal));
      const devolucao = r2(num(dto.devolucao ?? 0));
      const diferenca = r2(valorReal - esperado + devolucao);
      const classificacao: 'OK' | 'QUEBRA' | 'SOBRA' = diferenca < 0 ? 'QUEBRA' : diferenca > 0 ? 'SOBRA' : 'OK';

      // 3) QUEBRA + gerarTitulo → título A Receber contra o parceiro do operador (785, origem 'Q').
      let codrcb: number | null = null;
      let gera = 'N';
      if (classificacao === 'QUEBRA' && (dto.gerarTitulo ?? false)) {
        const oper = await trx.selectFrom('operadores').select('codparceiro').where('codoperador', '=', meta.codoperador).executeTakeFirst();
        const codparceiro = (oper as any)?.codparceiro ?? null;
        if (codparceiro == null) throw new BusinessRuleError('OPERADOR_SEM_PARCEIRO', { codoperador: meta.codoperador });
        const arIns = await trx
          .insertInto('areceber')
          .values({
            codempresa: emp, codparceiro, valor: r2(Math.abs(diferenca)), nrodup: 1,
            dtvenda: meta.datafech, dtvenc: meta.datafech, // data do fechamento (fiel a GeraReceber), não a de hoje
            origem: 'Q', quitada: 'N', agrupado: 'N', consiliado: 'S',
            obs: `Originado do lançamento de quebra de caixa do operador ${meta.codoperador}, fechamento PDV grupo ${codgrupo}.`,
            usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
          })
          .returning('codrcb').executeTakeFirstOrThrow();
        codrcb = Number((arIns as any).codrcb);
        await trx.updateTable('areceber').set({ duplicata: String(codrcb) }).where('codrcb', '=', codrcb).execute();
        gera = 'S';
      }

      // 4) grava o SALDO_OPERADOR.
      const sIns = await trx
        .insertInto('saldo_operador')
        .values({
          idempresa: emp, codgrupo, codoperador: meta.codoperador, codpdv: meta.codpdv, datafechamento: meta.datafech,
          valor_esperado: esperado, valor_real: valorReal, devolucao, saldo: diferenca, gera_saldo: gera, codrcb,
          contabilizado: null, usucadastro: op,
        })
        .returning('idsaldoop').executeTakeFirstOrThrow();
      const idsaldoop = Number((sIns as any).idsaldoop);

      // 5) CONTÁBIL da divergência (só se dif≠0 e SEM título — quebra-com-título delega ao A Receber). Gate
      // INTEGRACAO='AUTOMATICA' + período aberto; senão grava o SALDO sem contábil (contabilizado=null).
      let situacao: number | null = null;
      let contabilizado: 'S' | null = null;
      if (diferenca !== 0 && codrcb == null) {
        const empc = await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst();
        // período FECHADO → grava só o SALDO (contabilizado=null), NÃO aborta a conferência (fiel às linhas
        // CONTABILIZADO=null do golden; não fura a trava de período pois nada vai ao DIÁRIO).
        if ((empc as any)?.integracao === 'AUTOMATICA' && !(await this.periodoFechado(trx, emp, meta.datafech))) {
          situacao = diferenca > 0 ? SIT_SOBRA : SIT_QUEBRA;
          const { d, c, hist } = await this.iicDC(trx, situacao);
          const lote = await trx
            .insertInto('lote_contabil')
            .values({ desclote: `Conferência PDV grupo ${codgrupo}`, datalote: meta.datafech, codorigem: CODORIGEM_CONFERENCIA, codempresa: emp })
            .returning('codlotecontabil').executeTakeFirstOrThrow();
          await trx.insertInto('diario').values({
            datalan: meta.datafech, contadebito: d, contacredito: c, valor: r2(Math.abs(diferenca)),
            codorigem: CODORIGEM_CONFERENCIA, idorigem: idsaldoop, codoperacao: situacao, codempresa: emp,
            codhist: hist, complemento: diferenca > 0 ? 'Sobra de caixa (PDV)' : 'Quebra de caixa (PDV)',
            codlote: Number((lote as any).codlotecontabil),
          }).execute();
          await trx.updateTable('saldo_operador').set({ contabilizado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` }).where('idsaldoop', '=', idsaldoop).execute();
          contabilizado = 'S';
        }
      }

      return { idsaldoop, codgrupo, esperado, valorReal, devolucao, diferenca, classificacao, codrcb, contabilizado, situacao };
    });
  }

  /**
   * Estorna a conferência do grupo (soft-delete SALDO_OPERADOR excluido='S'): reverte o DIÁRIO da divergência
   * (CODORIGEM 18/idorigem=idsaldoop + lote órfão) e DELETA o título-quebra gerado (o legado apaga o A Receber
   * na reabertura), desde que o título esteja INTOCADO (não baixado/agrupado/em-lote).
   */
  async estornar(codgrupo: number): Promise<{ codgrupo: number; estornado: true; tituloEstornado: number | null }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('saldo_operador').select(['idsaldoop', 'codrcb', 'datafechamento', 'contabilizado'])
        .where('idempresa', '=', emp).where('codgrupo', '=', codgrupo).where(sql`coalesce(excluido,'N')`, '<>', 'S')
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('CONFERENCIA_NAO_ENCONTRADA', { codgrupo });
      const idsaldoop = Number((s as any).idsaldoop);
      const codrcb = (s as any).codrcb as number | null;
      // se a divergência foi contabilizada, o estorno deleta o DIÁRIO → barra em período FECHADO (mesma trava
      // da NF/baixa; espelha caixa-pdv-contabil.reverter). Sem contábil (contabilizado=null) → nada a barrar.
      if ((s as any).contabilizado === 'S' && (await this.periodoFechado(trx, emp, (s as any).datafechamento))) {
        throw new BusinessRuleError('PERIODO_FECHADO', { data: (s as any).datafechamento });
      }

      // reverte o DIÁRIO da divergência (CODORIGEM 18 é EXCLUSIVO da conferência → sem colisão).
      const lotes = await trx
        .selectFrom('diario').select('codlote').distinct()
        .where('codorigem', '=', CODORIGEM_CONFERENCIA).where('idorigem', '=', idsaldoop).where('codempresa', '=', emp)
        .execute();
      await trx.deleteFrom('diario').where('codorigem', '=', CODORIGEM_CONFERENCIA).where('idorigem', '=', idsaldoop).where('codempresa', '=', emp).execute();
      const ids = (lotes as Record<string, unknown>[]).map((l) => Number(l.codlote)).filter((n) => Number.isFinite(n));
      if (ids.length) await trx.deleteFrom('lote_contabil').where('codlotecontabil', 'in', ids).execute();

      // deleta o título-quebra INTOCADO (fiel ao btnReabrir do legado que apaga o ARECEBER).
      let tituloEstornado: number | null = null;
      if (codrcb != null) {
        const t = await trx
          .selectFrom('areceber').select(['codrcb', 'quitada', 'agrupado'])
          .where('codrcb', '=', codrcb).where('codempresa', '=', emp).forUpdate().executeTakeFirst();
        if (t) {
          if ((t as any).quitada === 'S' || (t as any).agrupado === 'S') throw new BusinessRuleError('CONFERENCIA_TITULO_BAIXADO', { codrcb });
          const emBaixa = await trx.selectFrom('areceber_bx').select('codrcbbx').where('codrcb', '=', codrcb).executeTakeFirst();
          if (emBaixa) throw new BusinessRuleError('CONFERENCIA_TITULO_BAIXADO', { codrcb });
          const emLote = await trx.selectFrom('itens_lotecob').select('codilotcob').where('codrcb', '=', codrcb).executeTakeFirst();
          if (emLote) throw new BusinessRuleError('TITULO_EM_LOTE', { codrcb });
          await trx.deleteFrom('areceber').where('codrcb', '=', codrcb).where('codempresa', '=', emp).execute();
          tituloEstornado = codrcb;
        }
      }

      await trx.updateTable('saldo_operador').set({ excluido: 'S', usultalteracao: op, dtultimalteracao: sql`now()` }).where('idsaldoop', '=', idsaldoop).execute();
      return { codgrupo, estornado: true as const, tituloEstornado };
    });
  }

  /** consulta a conferência (ativa) de um grupo. */
  async obter(codgrupo: number): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('saldo_operador').selectAll()
      .where('idempresa', '=', emp).where('codgrupo', '=', codgrupo).where(sql`coalesce(excluido,'N')`, '<>', 'S')
      .executeTakeFirst();
  }
}
