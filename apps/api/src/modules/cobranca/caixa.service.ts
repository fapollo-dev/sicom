import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

// ESPÉCIE → sinal do movimento: SUPRIMENTO/ENTRADA entram (E); SANGRIA/SAIDA saem (S).
// (uMovCaixa: TPCONTA decide o sinal; aqui a espécie carrega essa semântica de forma explícita.)
const ESPECIE_TIPO: Record<string, 'E' | 'S'> = {
  SUPRIMENTO: 'E', ENTRADA: 'E', SANGRIA: 'S', SAIDA: 'S',
};

/**
 * CAIXA — corte-1 (sessão + movimento manual). Serviço STATEFUL no molde dos serviços da NF/baixa
 * (`areceber-baixa.service.ts`): transação única + FOR UPDATE + CAS + BusinessRuleError→422 + tenant
 * por CODEMPRESA e por OPERADOR (fail-closed — o caixa É do operador).
 *
 * `abrir`: cria a sessão (status 'A'), barrando 2ª sessão aberta do mesmo operador+empresa (trava
 * legada UabertCaixa.pas:212; backstop = índice parcial único ux_caixa_sessao_aberta).
 * `movimentar`: insere `caixa_mov` na sessão aberta do operador; espécie→tipo; valor>0; saldo≥0 nas
 * saídas (não deixa o caixa negativo). `estornarMovimento`: estorno LÓGICO (indr='E'; não deleta).
 * `fechar`: CAS status 'A'→'F', só o dono; grava saldo_final = saldo corrente.
 * Adiado (corte-2, dossiê §3): wire da baixa AR/AP→caixa, conferência/quebra (SALDO_OPERADOR),
 * integração contábil (DIÁRIO), tesouraria (contas_bancarias), recursos cheque/cartão, período-fechado.
 */
@Injectable()
export class CaixaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN'); // fail-closed (caixa é por empresa)
    return e;
  }
  private opReq(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN'); // fail-closed (caixa é do operador)
    return o;
  }

  /** saldo corrente = saldo_inicial + Σ(entradas − saídas) das linhas válidas (indr='I'). */
  private async saldoCorrente(trx: AnyDB, codcaixa: number, saldoInicial: number): Promise<number> {
    const agg = await trx
      .selectFrom('caixa_mov')
      .select(sql`coalesce(sum(case when tipo = 'E' then valor else -valor end), 0)`.as('mov'))
      .where('codcaixa', '=', codcaixa)
      .where(sql`coalesce(indr,'I')`, '=', 'I')
      .executeTakeFirst();
    return r2(saldoInicial + num((agg as any)?.mov));
  }

  /** Sessão ABERTA do operador logado (ou null) + seus movimentos — painel do front. */
  async atual(): Promise<{ sessao: Record<string, unknown>; movimentos: Record<string, unknown>[] } | null> {
    const emp = this.emp();
    const op = this.opReq();
    const sessao = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('get_caixa_sessao').selectAll()
      .where('codempresa', '=', emp).where('codoperador', '=', op).where('status', '=', 'A')
      .executeTakeFirst();
    if (!sessao) return null;
    const movimentos = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('caixa_mov').selectAll()
      .where('codcaixa', '=', (sessao as any).codcaixa)
      .orderBy('codmov', 'desc').execute();
    return { sessao, movimentos };
  }

  /** whitelist de colunas filtráveis do histórico (anti-injection). */
  private static readonly PESQUISA = new Set(['codcaixa', 'status', 'codoperador']);

  /** Histórico de sessões do escopo (empresa) — filtro status/operador. */
  async list(query: Record<string, string | undefined>): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    let q = (this.dbp.forTenantRead() as AnyDB).selectFrom('get_caixa_sessao').selectAll().where('codempresa', '=', emp);
    if (query.situacao === 'abertos') q = q.where('status', '=', 'A');
    else if (query.situacao === 'fechados') q = q.where('status', '=', 'F');
    const campo = query.campo;
    if (campo && CaixaService.PESQUISA.has(campo) && query.valor != null && query.valor !== '') {
      q = q.where(sql.ref(campo) as any, '=', query.valor);
    }
    return q.orderBy('codcaixa', 'desc').limit(Math.min(Number(query.limite) || 200, 500)).execute();
  }

  /** Leitura de uma sessão por código (escopo empresa) + movimentos. */
  async read(codcaixa: number): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const sessao = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('get_caixa_sessao').selectAll()
      .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp).executeTakeFirst();
    if (!sessao) return undefined;
    const movimentos = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('caixa_mov').selectAll().where('codcaixa', '=', codcaixa).orderBy('codmov', 'desc').execute();
    return { ...sessao, movimentos };
  }

  /** Abre o caixa do operador (1 aberto por operador+empresa). */
  async abrir(dto: { saldoInicial?: number; obs?: string }): Promise<{ codcaixa: number; saldoInicial: number; status: 'A' }> {
    const emp = this.emp();
    const op = this.opReq();
    try {
      return await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
        // trava: 1 caixa ABERTO por (empresa, operador). O check serializa o caso comum; mas
        // `forUpdate` NÃO trava linha inexistente (MVCC sem predicate lock) — o índice parcial
        // único `ux_caixa_sessao_aberta` é o backstop anti-corrida (ver catch do 23505 abaixo).
        const aberta = await trx
          .selectFrom('caixa_sessao').select('codcaixa')
          .where('codempresa', '=', emp).where('codoperador', '=', op).where('status', '=', 'A')
          .forUpdate().executeTakeFirst();
        if (aberta) throw new BusinessRuleError('CAIXA_JA_ABERTO', { codcaixa: (aberta as any).codcaixa });

        const saldoInicial = r2(num(dto.saldoInicial));
        const ins = await trx
          .insertInto('caixa_sessao')
          .values({
            codempresa: emp, codoperador: op, dtabertura: sql`now()`,
            saldo_inicial: saldoInicial, status: 'A', obs: dto.obs ?? null,
            usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
          })
          .returning('codcaixa').executeTakeFirstOrThrow();
        return { codcaixa: Number((ins as any).codcaixa), saldoInicial, status: 'A' as const };
      });
    } catch (e) {
      // CORRIDA: duas aberturas concorrentes passam o check (nada travado) e a 2ª viola o índice
      // parcial único → 23505. Traduz para o erro de domínio (senão o filtro devolveria 409
      // DUPLICADO com mensagem crua, em vez de 422 CAIXA_JA_ABERTO). O único índice único da
      // tabela é o de sessão aberta, então 23505 aqui só pode ser esse.
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('CAIXA_JA_ABERTO');
      throw e;
    }
  }

  /** Lança um movimento manual na sessão aberta do operador. */
  async movimentar(
    dto: { especie: string; valor: number; recurso?: string; obs?: string },
  ): Promise<{ codmov: number; codcaixa: number; tipo: 'E' | 'S'; especie: string; valor: number; saldoCorrente: number }> {
    const emp = this.emp();
    const op = this.opReq();
    const especie = String(dto.especie);
    const tipo = ESPECIE_TIPO[especie];
    if (!tipo) throw new BusinessRuleError('CAIXA_ESPECIE_INVALIDA', { especie });
    const valor = r2(num(dto.valor));
    if (valor <= 0) throw new BusinessRuleError('CAIXA_VALOR_INVALIDO', { valor });

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // sessão aberta do operador (trava a linha p/ serializar contra fechamento/movimento concorrente).
      const s = await trx
        .selectFrom('caixa_sessao').select(['codcaixa', 'saldo_inicial'])
        .where('codempresa', '=', emp).where('codoperador', '=', op).where('status', '=', 'A')
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('CAIXA_NAO_ABERTO');

      // saída não pode deixar o caixa negativo (não há dinheiro para retirar).
      if (tipo === 'S') {
        const saldo = await this.saldoCorrente(trx, (s as any).codcaixa, num((s as any).saldo_inicial));
        if (r2(saldo - valor) < 0) throw new BusinessRuleError('CAIXA_SALDO_INSUFICIENTE', { saldo, valor });
      }

      const ins = await trx
        .insertInto('caixa_mov')
        .values({
          codcaixa: (s as any).codcaixa, codempresa: emp, tipo, especie,
          recurso: dto.recurso ?? 'DINHEIRO', valor,
          codoperador: op, data_operacao: sql`now()`, indr: 'I', obs: dto.obs ?? null,
        })
        .returning('codmov').executeTakeFirstOrThrow();

      const saldoCorrente = await this.saldoCorrente(trx, (s as any).codcaixa, num((s as any).saldo_inicial));
      return { codmov: Number((ins as any).codmov), codcaixa: (s as any).codcaixa, tipo, especie, valor, saldoCorrente };
    });
  }

  /** Estorno LÓGICO de um movimento (indr='E'); só em caixa aberto e movimento ainda válido. */
  async estornarMovimento(codmov: number): Promise<{ codmov: number; indr: 'E' }> {
    const emp = this.emp();
    this.opReq();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // trava o movimento + a sessão (escopo empresa + status).
      const m = await trx
        .selectFrom('caixa_mov as m')
        .innerJoin('caixa_sessao as s', 's.codcaixa', 'm.codcaixa')
        .select(['m.codmov', 'm.indr', 's.status'])
        .where('m.codmov', '=', codmov).where('s.codempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!m) throw new BusinessRuleError('CAIXA_MOV_NAO_ENCONTRADO', { codmov });
      if (String((m as any).indr ?? 'I') === 'E') throw new BusinessRuleError('CAIXA_MOV_ESTORNADO', { codmov });
      if ((m as any).status !== 'A') throw new BusinessRuleError('CAIXA_FECHADO', { codmov }); // não estorna em caixa fechado

      const upd = await trx
        .updateTable('caixa_mov')
        .set({ indr: 'E', data_operacao: sql`now()` })
        .where('codmov', '=', codmov)
        .where(sql`coalesce(indr,'I')`, '=', 'I')
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('CAIXA_MOV_ESTORNADO', { codmov });
      return { codmov, indr: 'E' as const };
    });
  }

  /** Fecha o caixa (só o dono; CAS 'A'→'F'); grava saldo_final = saldo corrente. */
  async fechar(codcaixa: number, dto: { obs?: string }): Promise<{ codcaixa: number; status: 'F'; saldoFinal: number }> {
    const emp = this.emp();
    const op = this.opReq();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('caixa_sessao').select(['codcaixa', 'status', 'codoperador', 'saldo_inicial'])
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('CAIXA_NAO_ENCONTRADO', { codcaixa });
      if ((s as any).status === 'F') throw new BusinessRuleError('CAIXA_JA_FECHADO', { codcaixa });
      if ((s as any).codoperador !== op) throw new BusinessRuleError('CAIXA_OUTRO_OPERADOR', { codcaixa }); // só o dono fecha

      const saldoFinal = await this.saldoCorrente(trx, codcaixa, num((s as any).saldo_inicial));
      const setObj: Record<string, unknown> = {
        status: 'F', dtfechamento: sql`now()`, saldo_final: saldoFinal,
        usultalteracao: op, dtultimalteracao: sql`now()`,
      };
      if (dto?.obs != null) setObj.obs = dto.obs;
      const upd = await trx
        .updateTable('caixa_sessao').set(setObj)
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp).where('status', '=', 'A')
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('CAIXA_JA_FECHADO', { codcaixa });
      return { codcaixa, status: 'F' as const, saldoFinal };
    });
  }
}
