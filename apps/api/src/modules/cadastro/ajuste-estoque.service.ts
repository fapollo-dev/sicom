import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000; // numeric(13,3)

/**
 * AJUSTE DE ESTOQUE (FRMAJUSTEESTOQUE) — serviço vertical (molde caixa/nf-processamento): o movimento MANUAL
 * que escreve no saldo de ESTOQUE. Numa transação: lê+trava `estoque.qtde` (qtdeanterior), calcula o novo saldo
 * pela OPERACAO (AUMENTAR +qtde / DIMINUIR −qtde / SUBSTITUIR =qtde), BLOQUEIA saldo negativo, grava
 * `estoque.qtde` (upsert), grava o KARDEX (`historico_prod`, origem='AJUSTE') e registra o ajuste. Tenant por
 * `idempresa` fail-closed. SEM contábil (o ajuste não toca o DIÁRIO — a valoração do estoque é via CMV/inventário).
 * `estornar`: reverte o saldo p/ o qtdeanterior (guarda: o saldo atual tem de ser o qtdeatual do ajuste — sem
 * movimento posterior), grava kardex reverso e marca `estornado='S'`.
 */
@Injectable()
export class AjusteEstoqueService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** operador obrigatório (legado: AJUSTE_ESTOQUE.CODOPERADOR NOT NULL + FK) — fail-closed. */
  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }

  async ajustar(dto: {
    idproduto: number; operacao: 'AUMENTAR' | 'DIMINUIR' | 'SUBSTITUIR'; destino?: string;
    qtde: number; codmotivo: number; obs?: string; minimo?: number; maximo?: number;
  }): Promise<{ codajuste: number; idproduto: number; operacao: string; qtdeanterior: number; qtdeatual: number }> {
    const emp = this.emp();
    const op = this.op();
    const qtde = r3(num(dto.qtde));
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const prod = await trx.selectFrom('produtos').select('idproduto').where('idproduto', '=', dto.idproduto).executeTakeFirst();
      if (!prod) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: dto.idproduto });
      const mot = await trx.selectFrom('motivos').select('codmotivo').where('codmotivo', '=', dto.codmotivo).where(sql`coalesce(indr,'I')`, '=', 'I').executeTakeFirst();
      if (!mot) throw new BusinessRuleError('MOTIVO_NAO_ENCONTRADO', { codmotivo: dto.codmotivo });

      // o DESTINO (CBdestino, UajusteEstoque.pas:336-395): 'E' = o saldo da LOJA (ESTOQUE), 'D' = o do DEPÓSITO (ESTOQUE_DEP)
      const destino = dto.destino === 'D' ? 'D' : 'E';
      if (destino === 'D') return this.ajustarDeposito(trx, emp, op, dto, qtde);
      // lê e TRAVA o saldo (por produto+empresa). Sem linha → saldo 0 (será criada).
      const est = await trx
        .selectFrom('estoque').select(['id_estoque', 'qtde', 'minimo', 'maximo'])
        .where('idproduto', '=', dto.idproduto).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      const qtdeanterior = r3(num((est as any)?.qtde));
      const qtdeatual =
        dto.operacao === 'AUMENTAR' ? r3(qtdeanterior + qtde)
        : dto.operacao === 'DIMINUIR' ? r3(qtdeanterior - qtde)
        : qtde; // SUBSTITUIR
      // saldo NEGATIVO é PERMITIDO (fiel: o legado tem 677 ajustes manuais com saldo<0 — ex.: corrigir
      // produto já negativado por venda sem entrada). Divergência do NF (que bloqueia negativo por gate).

      // grava o saldo (write-path que faltava): UPDATE se existe, senão INSERT (com backstop de corrida).
      // o MÍNIMO e o MÁXIMO da tela vão junto no saldo e no ajuste (UajusteEstoque.pas:355-356, :423-424); a tela os abre com os atuais
      const minimo = dto.minimo != null ? r3(num(dto.minimo)) : (est as any)?.minimo ?? null;
      const maximo = dto.maximo != null ? r3(num(dto.maximo)) : (est as any)?.maximo ?? null;
      if (est) {
        await trx.updateTable('estoque').set({ qtde: qtdeatual, minimo, maximo }).where('id_estoque', '=', (est as any).id_estoque).execute();
      } else {
        try {
          await trx.insertInto('estoque').values({ idproduto: dto.idproduto, idempresa: emp, qtde: qtdeatual, minimo, maximo }).execute();
        } catch (e) {
          // forUpdate não trava linha inexistente (MVCC): 2 ajustes do mesmo produto NOVO batem no UNIQUE
          // (idproduto,idempresa). Traduz o 23505 p/ erro de domínio (retry) em vez de "DUPLICADO" cru.
          if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('AJUSTE_CONCORRENTE', { idproduto: dto.idproduto });
          throw e;
        }
      }
      // o texto do trigger ESTOQUE_AJUSTE: "AJUSTE DE ESTOQUE LOJA <motivo> OPERADOR:<login>" (produção: ajuste 23915)
      await this.kardex(trx, emp, dto.idproduto, qtdeanterior, qtdeatual, op, await this.historicoLegado(trx, dto.codmotivo, op));

      const ins = await trx
        .insertInto('ajuste_estoque')
        .values({
          idproduto: dto.idproduto, idempresa: emp, operacao: dto.operacao, destino,
          qtde, qtdeanterior, qtdeatual, codmotivo: dto.codmotivo, codoperador: op, origem: 'A', minimo, maximo,
          // DATA = a hora do servidor (`GetDataHoraServidor`, :414) — é a coluna que o legado e o histórico migrado usam
          obs: dto.obs ?? null, data: sql`now()`, dtcadastro: sql`now()`,
        })
        .returning('codajuste').executeTakeFirstOrThrow();
      return { codajuste: Number((ins as any).codajuste), idproduto: dto.idproduto, operacao: dto.operacao, qtdeanterior, qtdeatual };
    });
  }

  /** o ajuste no DEPÓSITO (CBdestino item 1): ESTOQUE_DEP; o depósito não tem kardex próprio (historico_prod é o da loja) */
  private async ajustarDeposito(trx: AnyDB, emp: number, op: number, dto: { idproduto: number; operacao: 'AUMENTAR' | 'DIMINUIR' | 'SUBSTITUIR'; qtde: number; codmotivo: number; obs?: string; minimo?: number; maximo?: number }, qtde: number) {
    const dep = await trx.selectFrom('estoque_dep').select(['qtde', 'minimo', 'maximo']).where('idproduto', '=', dto.idproduto).where('idempresa', '=', emp).forUpdate().executeTakeFirst();
    const minimo = dto.minimo != null ? r3(num(dto.minimo)) : (dep as any)?.minimo ?? null;
    const maximo = dto.maximo != null ? r3(num(dto.maximo)) : (dep as any)?.maximo ?? null;
    const qtdeanterior = r3(num((dep as any)?.qtde));
    const qtdeatual = dto.operacao === 'AUMENTAR' ? r3(qtdeanterior + qtde) : dto.operacao === 'DIMINUIR' ? r3(qtdeanterior - qtde) : qtde;
    if (dep) await trx.updateTable('estoque_dep').set({ qtde: qtdeatual, minimo, maximo }).where('idproduto', '=', dto.idproduto).where('idempresa', '=', emp).execute();
    else await trx.insertInto('estoque_dep').values({ idproduto: dto.idproduto, idempresa: emp, qtde: qtdeatual, minimo, maximo }).execute();
    const ins = await trx.insertInto('ajuste_estoque').values({
      idproduto: dto.idproduto, idempresa: emp, operacao: dto.operacao, destino: 'D',
      qtde, qtdeanterior, qtdeatual, codmotivo: dto.codmotivo, codoperador: op, origem: 'A', minimo, maximo,
      obs: dto.obs ?? null, data: sql`now()`, dtcadastro: sql`now()`,
    }).returning('codajuste').executeTakeFirstOrThrow();
    return { codajuste: Number((ins as any).codajuste), idproduto: dto.idproduto, operacao: dto.operacao, qtdeanterior, qtdeatual };
  }

  private async historicoLegado(trx: AnyDB, codmotivo: number, op: number | null): Promise<string> {
    const m = (await trx.selectFrom('motivos').select('descricao').where('codmotivo', '=', codmotivo).executeTakeFirst()) as { descricao?: string } | undefined;
    const o = op == null ? undefined : ((await trx.selectFrom('operadores').select('login').where('codoperador', '=', op).executeTakeFirst()) as { login?: string } | undefined);
    return `AJUSTE DE ESTOQUE LOJA ${String(m?.descricao ?? '').trim()} OPERADOR:${String(o?.login ?? '').trim()}`.slice(0, 200);
  }

  async estornar(codajuste: number): Promise<{ codajuste: number; estornado: true; qtde: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const a = await trx
        .selectFrom('ajuste_estoque').select(['codajuste', 'idproduto', 'qtdeanterior', 'qtdeatual', 'estornado', 'destino'])
        .where('codajuste', '=', codajuste).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!a) throw new BusinessRuleError('AJUSTE_NAO_ENCONTRADO', { codajuste });
      if ((a as any).estornado === 'S') throw new BusinessRuleError('AJUSTE_JA_ESTORNADO', { codajuste });

      const idproduto = Number((a as any).idproduto);
      const qtdeatualAjuste = r3(num((a as any).qtdeatual));
      const qtdeanterior = r3(num((a as any).qtdeanterior));

      // FOLD (auditoria de correção): o ajuste pode ser do DEPÓSITO — o zeramento do inventário rotativo
      // (uInvRotativoGrid) grava `destino='DEPOSITO'` mexendo em `estoque_dep`. Estornar sempre em `estoque`
      // devolvia o saldo no bucket ERRADO (a loja ganhava o saldo do depósito e o depósito continuava zerado).
      // 'D' é o código da tela; 'DEPOSITO' o que o zeramento do inventário rotativo grava
      const noDeposito = ['D', 'DEPOSITO'].includes(String((a as any).destino ?? '').toUpperCase());
      const est = noDeposito
        ? await trx
            .selectFrom('estoque_dep').select(['idproduto as id_estoque', 'qtde'])
            .where('idproduto', '=', idproduto).where('idempresa', '=', emp)
            .forUpdate().executeTakeFirst()
        : await trx
            .selectFrom('estoque').select(['id_estoque', 'qtde', 'minimo', 'maximo'])
            .where('idproduto', '=', idproduto).where('idempresa', '=', emp)
            .forUpdate().executeTakeFirst();
      const saldoAtual = r3(num((est as any)?.qtde));
      // só estorna se o saldo ainda é o que este ajuste deixou (nenhum movimento posterior) — evita corromper.
      if (!est || saldoAtual !== qtdeatualAjuste) throw new BusinessRuleError('AJUSTE_ESTORNO_SALDO_MUDOU', { codajuste, saldoAtual, esperado: qtdeatualAjuste });

      if (noDeposito) {
        await trx.updateTable('estoque_dep').set({ qtde: qtdeanterior })
          .where('idproduto', '=', idproduto).where('idempresa', '=', emp).execute();
      } else {
        await trx.updateTable('estoque').set({ qtde: qtdeanterior }).where('id_estoque', '=', (est as any).id_estoque).execute();
      }
      // kardex só do estoque de LOJA: o depósito não tem razão própria no legado (historico_prod é do saldo da loja)
      if (!noDeposito) await this.kardex(trx, emp, idproduto, saldoAtual, qtdeanterior, op, `Estorno do ajuste ${codajuste}`);
      const upd = await trx
        .updateTable('ajuste_estoque')
        .set({ estornado: 'S', codoperador_estorno: op })
        .where('codajuste', '=', codajuste).where('idempresa', '=', emp).where((eb: any) => eb.or([eb('estornado', '<>', 'S'), eb('estornado', 'is', null)]))
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('AJUSTE_JA_ESTORNADO', { codajuste });
      return { codajuste, estornado: true as const, qtde: qtdeanterior };
    });
  }

  /** 1 linha de KARDEX (historico_prod) por movimento de ajuste — mesmo razão da NF (origem='AJUSTE'). */
  private async kardex(trx: AnyDB, emp: number, idproduto: number, saldoAnt: number, saldoNovo: number, op: number | null, historico: string) {
    const delta = r3(saldoNovo - saldoAnt);
    await trx.insertInto('historico_prod').values({
      idproduto, idempresa: emp, tipo: delta >= 0 ? 'E' : 'S', qtde: Math.abs(delta),
      saldo_anterior: saldoAnt, saldo_novo: saldoNovo, origem: 'AJUSTE', codnf: null,
      historico, data: sql`now()`, codoperador: op,
    }).execute();
  }

  /** histórico de ajustes (lista/tela) — enriquecido com produto/motivo. */
  async listar(limite = 50): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return db
      .selectFrom('ajuste_estoque as a')
      .leftJoin('produtos as p', 'p.idproduto', 'a.idproduto')
      .leftJoin('motivos as m', 'm.codmotivo', 'a.codmotivo')
      .select([
        'a.codajuste', 'a.idproduto', 'p.descricao as produto', 'a.operacao', 'a.destino',
        'a.qtde', 'a.qtdeanterior', 'a.qtdeatual', 'a.codmotivo', 'm.descricao as motivo',
        'a.codoperador', 'a.origem', 'a.obs', 'a.estornado', 'a.dtcadastro',
        // a DATA do ajuste (a do legado; a do histórico migrado) — o `dtcadastro` é só do Apollo
        sql<string>`coalesce(a.data, a.dtcadastro)`.as('data'),
      ])
      .where('a.idempresa', '=', emp)
      .orderBy(sql`coalesce(a.data, a.dtcadastro)`, 'desc').orderBy('a.codajuste', 'desc')
      .limit(limite)
      .execute();
  }
}
