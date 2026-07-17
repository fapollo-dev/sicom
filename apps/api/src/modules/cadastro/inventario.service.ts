import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { InventarioDiferenca } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SenhaOperacaoService } from './senha-operacao.service';
import { ConfigService } from './config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * INVENTÁRIO — ações verticais (uInventario): importar-produtos (popular a folha), diferenças (calculada) e
 * aplicar-ao-estoque. FIEL ao legado: a efetivação SOBRESCREVE `estoque.qtde` = contado (AtualizaEstoque1Click,
 * uInventario.pas:515-555), item a item, SEM kardex e SEM máquina de estado (rerodável), gated por
 * SenhaAdministrativa('ADM') → reusa a senha de operação 'admin' da empresa (E7). Tenant `idempresa` fail-closed.
 */
@Injectable()
export class InventarioService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly senhaOp: SenhaOperacaoService,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** garante que o livro existe no tenant (fail-closed). */
  private async carregarLivro(db: AnyDB, codinvent: number, emp: number): Promise<void> {
    const l = await db
      .selectFrom('inventario_livro')
      .select('codinvent')
      .where('codinvent', '=', codinvent)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst();
    if (!l) throw new BusinessRuleError('INVENTARIO_NAO_ENCONTRADO', { codinvent });
  }

  /**
   * IMPORTA a folha de contagem (fiel a Importarprodutos1Click): DELETA os itens atuais e repopula. Parte da
   * **MULTI_PRECO da empresa** (não do catálogo global `produtos`) — só produtos registrados/precificados nesta
   * empresa (udmInventario.dfm:86,96) — e exclui os **produtos-filho** (`idproduto_pai` NULL/0, dfm:97).
   * **fold ALTA:** a QTDE CONTADA nasce = SALDO DE SISTEMA (não 0), fiel a uInventario.pas:1748 — assim
   * import→aplicar sem recontar é NO-OP (não zera o estoque); o operador só edita as linhas que recontou.
   * Filtros: apenasComSaldo (estoque.qtde>0); apenasAtivos respeita `ATIVO_PELA_MULTIPRECO` (default = produtos.ativo,
   * uInventario.pas:1692-1695). Snapshot descricao/unidade/codbarra de produtos + vrcusto/vrvenda de multi_preco.
   */
  async importarProdutos(codinvent: number, opts: { apenasAtivos?: boolean; apenasComSaldo?: boolean }): Promise<{ codinvent: number; itens: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ativoPelaMp = (await this.config.resolver('ATIVO_PELA_MULTIPRECO', { empresaId: emp })) === 'S';
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregarLivro(trx, codinvent, emp);
      await trx.deleteFrom('inventario').where('codinvent', '=', codinvent).where('idempresa', '=', emp).execute();

      // DRIVE por MULTI_PRECO da empresa (só produtos desta empresa) + saldo (estoque) + exclui filhos.
      let q = trx
        .selectFrom('multi_preco as mp')
        .innerJoin('produtos as p', 'p.idproduto', 'mp.idproduto')
        .leftJoin('estoque as e', (j: any) => j.onRef('e.idproduto', '=', 'p.idproduto').on('e.idempresa', '=', emp))
        .select([
          'p.idproduto as idproduto', 'p.descricao as descricao', 'p.unidade as unidade', 'p.codbarra as codbarra',
          'p.aliquota as aliquota', 'mp.vrcusto as vrcusto', 'mp.vrvenda as vrvenda',
          sql<number>`coalesce(e.qtde,0)`.as('saldo'),
        ])
        .where('mp.idempresa', '=', emp)
        .where(sql`coalesce(p.idproduto_pai,0)`, '=', 0); // exclui produtos-filho (variações)
      if (opts.apenasAtivos) q = ativoPelaMp ? q.where(sql`coalesce(mp.ativo,'S')`, '=', 'S') : q.where(sql`coalesce(p.ativo,'S')`, '=', 'S');
      if (opts.apenasComSaldo) q = q.where(sql`coalesce(e.qtde,0)`, '>', 0);
      const prods = (await q.execute()) as Array<{ idproduto: number; descricao?: string; unidade?: string; codbarra?: string; aliquota?: string; vrcusto?: unknown; vrvenda?: unknown; saldo?: unknown }>;

      let n = 0;
      for (let i = 0; i < prods.length; i += 1000) {
        const lote = prods.slice(i, i + 1000);
        if (!lote.length) continue;
        await trx
          .insertInto('inventario')
          .values(
            lote.map((r) => ({
              codinvent, idempresa: emp, idproduto: r.idproduto, codbarra: r.codbarra ?? null, descricao: r.descricao ?? null,
              unidade: r.unidade ?? null, aliquota: r.aliquota ?? null,
              qtde: num(r.saldo), // CONTADO nasce = saldo de sistema (fold ALTA: import→aplicar = no-op)
              vrcusto: num(r.vrcusto), vrvenda: num(r.vrvenda),
              tipo: 'P', usucadastro: op, dtcadastro: sql`now()`,
            })),
          )
          .execute();
        n += lote.length;
      }
      return { codinvent, itens: n };
    });
  }

  /**
   * DIFERENÇAS (calculada, não persistida — fiel à query do legado, udmInventario.dfm:1157-1164):
   * DIFERENCA = ESTOQUE.QTDE − CONTADO, com tratamento do saldo de sistema negativo:
   *   sistema<0 e contado>0 → sistema+contado ; sistema<0 e contado<0 → 0 ; senão → sistema−contado.
   */
  async diferencas(codinvent: number): Promise<{ codinvent: number; itens: InventarioDiferenca[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.carregarLivro(db, codinvent, emp);
    const rows = (await db
      .selectFrom('inventario as i')
      .leftJoin('estoque as e', (j: any) => j.onRef('e.idproduto', '=', 'i.idproduto').on('e.idempresa', '=', emp))
      .select([
        'i.idproduto as idproduto',
        'i.descricao as descricao',
        'i.qtde as contado',
        sql<number>`coalesce(e.qtde,0)`.as('sistema'),
      ])
      .where('i.codinvent', '=', codinvent)
      .where('i.idempresa', '=', emp)
      .where(sql`coalesce(i.tipo,'P')`, '<>', 'T') // fiel: a query do legado exclui TIPO='T' (udmInventario.dfm:1179)
      .orderBy('i.sequencia')
      .execute()) as Array<{ idproduto: number; descricao: string | null; contado: unknown; sistema: unknown }>;

    const itens: InventarioDiferenca[] = rows.map((r) => {
      const contado = r3(num(r.contado));
      const sistema = r3(num(r.sistema));
      const diferenca = sistema < 0 && contado > 0 ? r3(sistema + contado) : sistema < 0 && contado < 0 ? 0 : r3(sistema - contado);
      return { idproduto: Number(r.idproduto), descricao: r.descricao ?? null, contado, sistema, diferenca };
    });
    return { codinvent, itens };
  }

  /**
   * APLICA ao estoque (fiel a AtualizaEstoque1Click): SOBRESCREVE `estoque.qtde` = contado, item a item (SUBSTITUIR
   * direto, SEM kardex — o legado não gera). Gated por senha de operação ADM da empresa (SenhaAdministrativa('ADM')
   * → E7). Rerodável (sem trava de estado). Transação única. Se o produto não tem linha de estoque, cria (o legado
   * assume a linha carregada; aqui INSERT p/ robustez).
   */
  async aplicar(codinvent: number, dto: { senhaOperacao?: string }): Promise<{ codinvent: number; aplicados: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    // GATE senha ADM (E7) — antes da transação. Sem senha / errada / não-configurada → bloqueia (fiel; sem oráculo).
    if (!dto.senhaOperacao) throw new BusinessRuleError('SENHA_OPERACAO_REQUERIDA', { tipo: 'admin' });
    const { ok } = await this.senhaOp.verificar('admin', dto.senhaOperacao);
    if (!ok) throw new BusinessRuleError('SENHA_OPERACAO_INVALIDA', { tipo: 'admin' });

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregarLivro(trx, codinvent, emp);
      const itens = (await trx
        .selectFrom('inventario')
        .select(['idproduto', 'qtde'])
        .where('codinvent', '=', codinvent)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(tipo,'P')`, '<>', 'T') // fiel: não efetiva itens TIPO='T' (udmInventario.dfm:1179)
        .execute()) as Array<{ idproduto: number; qtde: unknown }>;
      if (!itens.length) throw new BusinessRuleError('INVENTARIO_SEM_ITENS', { codinvent });

      let aplicados = 0;
      for (const it of itens) {
        const contado = num(it.qtde);
        const upd = await trx
          .updateTable('estoque')
          .set({ qtde: contado })
          .where('idproduto', '=', it.idproduto)
          .where('idempresa', '=', emp)
          .executeTakeFirst();
        if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) {
          // produto sem linha de estoque → cria (idempotente; a UNIQUE(idproduto,idempresa) evita corrida).
          await trx
            .insertInto('estoque')
            .values({ idproduto: it.idproduto, idempresa: emp, qtde: contado })
            .onConflict((oc: any) => oc.columns(['idproduto', 'idempresa']).doUpdateSet({ qtde: contado }))
            .execute();
        }
        aplicados++;
      }
      // marca a alteração no livro (auditoria — não é estado).
      await trx.updateTable('inventario_livro').set({ usultalteracao: op, dtultimalteracao: sql`now()` }).where('codinvent', '=', codinvent).where('idempresa', '=', emp).execute();
      return { codinvent, aplicados };
    });
  }
}
