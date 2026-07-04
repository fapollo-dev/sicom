import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { CaixaContabilService } from './caixa-contabil.service';

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
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly contabil: CaixaContabilService,
  ) {}

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

  /**
   * Fecha o caixa (só o dono; CAS 'A'→'F'); grava saldo_final = saldo corrente (o ESPERADO).
   * CONFERÊNCIA (corte-2b): se `valorContado` vier, calcula a diferença = contado − esperado e a grava
   * COM SINAL (quebra<0/sobra>0). Quebra (com `gerarTituloQuebra`, default true) gera um título A Receber
   * `ORIGEM='Q'` contra o PARCEIRO do operador (fiel a UfinalizaFechamento.pas:750-806). Sobra não gera
   * nada financeiro. Sem `valorContado` = fecha simples (comportamento do corte-1).
   */
  async fechar(
    codcaixa: number,
    dto: { valorContado?: number; gerarTituloQuebra?: boolean; obs?: string },
  ): Promise<{ codcaixa: number; status: 'F'; saldoFinal: number; valorContado: number | null; diferenca: number | null; classificacao: 'OK' | 'QUEBRA' | 'SOBRA' | null; codrcbQuebra: number | null }> {
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

      const saldoFinal = await this.saldoCorrente(trx, codcaixa, num((s as any).saldo_inicial)); // esperado
      const setObj: Record<string, unknown> = {
        status: 'F', dtfechamento: sql`now()`, saldo_final: saldoFinal,
        usultalteracao: op, dtultimalteracao: sql`now()`,
      };
      if (dto?.obs != null) setObj.obs = dto.obs;

      // ── conferência (só quando o contado é informado) ──
      let valorContado: number | null = null;
      let diferenca: number | null = null;
      let classificacao: 'OK' | 'QUEBRA' | 'SOBRA' | null = null;
      let codrcbQuebra: number | null = null;
      if (dto.valorContado != null) {
        valorContado = r2(num(dto.valorContado));
        diferenca = r2(valorContado - saldoFinal); // contado − esperado
        classificacao = diferenca < 0 ? 'QUEBRA' : diferenca > 0 ? 'SOBRA' : 'OK';
        setObj.valor_contado = valorContado;
        setObj.diferenca = diferenca;

        // QUEBRA (falta) → título A Receber contra o parceiro do operador (só se gerarTituloQuebra).
        if (classificacao === 'QUEBRA' && (dto.gerarTituloQuebra ?? true)) {
          const oper = await trx.selectFrom('operadores').select('codparceiro').where('codoperador', '=', op).executeTakeFirst();
          const codparceiro = (oper as any)?.codparceiro ?? null;
          if (codparceiro == null) throw new BusinessRuleError('OPERADOR_SEM_PARCEIRO', { codoperador: op }); // fiel ao abort do legado (:272)
          const valorQuebra = r2(Math.abs(diferenca));
          const arIns = await trx
            .insertInto('areceber')
            .values({
              codempresa: emp, codparceiro, valor: valorQuebra,
              dtvenda: sql`current_date`, dtvenc: sql`current_date`,
              origem: 'Q', quitada: 'N', agrupado: 'N', consiliado: 'S', // ORIGEM='Q' (UfinalizaFechamento:1803)
              obs: `Originado do lançamento de quebra de caixa do operador ${op}, caixa ${codcaixa}.`,
              usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
            })
            .returning('codrcb').executeTakeFirstOrThrow();
          codrcbQuebra = Number((arIns as any).codrcb);
          // duplicata = o próprio CODRCB (UfinalizaFechamento:1793).
          await trx.updateTable('areceber').set({ duplicata: String(codrcbQuebra) }).where('codrcb', '=', codrcbQuebra).execute();
          setObj.codrcb_quebra = codrcbQuebra;
        }
      }

      const upd = await trx
        .updateTable('caixa_sessao').set(setObj)
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp).where('status', '=', 'A')
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('CAIXA_JA_FECHADO', { codcaixa });
      return { codcaixa, status: 'F' as const, saldoFinal, valorContado, diferenca, classificacao, codrcbQuebra };
    });
  }

  /**
   * REABERTURA (corte-2c): desfaz um fechamento (status 'F'→'A'), reabrindo a sessão. Espelho do
   * `fechar` + `btnReabrirClick` do legado: estorna (DELETE, como o legado) o título de quebra gerado
   * e limpa a conferência (valor_contado/diferenca/codrcb_quebra/saldo_final). Guardas: só o dono
   * reabre; não reabre se o operador já tiver OUTRO caixa aberto (1-aberto-por-operador; índice parcial
   * é o backstop → 23505 traduzido); a quebra não pode estar baixada/agrupada/em-lote. Os movimentos
   * ficam (a sessão volta a aceitar movimento/estorno de baixa — destrava o CAIXA_FECHADO do corte-2a).
   */
  async reabrir(codcaixa: number, dto: { obs?: string }): Promise<{ codcaixa: number; status: 'A'; quebraEstornada: number | null }> {
    const emp = this.emp();
    const op = this.opReq();
    try {
      return await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
        const s = await trx
          .selectFrom('caixa_sessao').select(['codcaixa', 'status', 'codoperador', 'codrcb_quebra'])
          .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
          .forUpdate().executeTakeFirst();
        if (!s) throw new BusinessRuleError('CAIXA_NAO_ENCONTRADO', { codcaixa });
        if ((s as any).status !== 'F') throw new BusinessRuleError('CAIXA_NAO_FECHADO', { codcaixa });
        if ((s as any).codoperador !== op) throw new BusinessRuleError('CAIXA_OUTRO_OPERADOR', { codcaixa }); // só o dono reabre

        // não reabrir se o operador já tem outra sessão ABERTA (1-aberto-por-operador+empresa).
        const outra = await trx
          .selectFrom('caixa_sessao').select('codcaixa')
          .where('codempresa', '=', emp).where('codoperador', '=', op).where('status', '=', 'A')
          .forUpdate().executeTakeFirst();
        if (outra) throw new BusinessRuleError('CAIXA_JA_ABERTO', { codcaixa: (outra as any).codcaixa });

        // estorna o CONTÁBIL do fechamento (se contabilizado) — DELETE do DIÁRIO por codorigem=17/idorigem
        // (uFechamentoCaixa.pas:736 estorna a integração na reabertura). Idempotente (no-op se não houve).
        await this.contabil.estornarNoTrx(trx, emp, codcaixa, op);

        // estorna o título de quebra gerado no fechamento (o legado DELETA o ARECEBER na reabertura,
        // uFechamentoCaixa.pas:967). ENDURECIMENTO consciente: o legado deletava INCONDICIONALMENTE (as
        // travas quitada/agrupado vinham do lado APAGAR, ExcluiApagarGerado); aqui barramos baixado/
        // agrupado/em-lote para não desfazer dinheiro/agrupamento por aqui (coerente com o corte-2a).
        let quebraEstornada: number | null = null;
        const codrcbQuebra = (s as any).codrcb_quebra as number | null;
        if (codrcbQuebra != null) {
          const t = await trx
            .selectFrom('areceber').select(['codrcb', 'quitada', 'agrupado'])
            .where('codrcb', '=', codrcbQuebra).where('codempresa', '=', emp)
            .forUpdate().executeTakeFirst();
          if (t) {
            if ((t as any).quitada === 'S') throw new BusinessRuleError('REABERTURA_QUEBRA_BAIXADA', { codrcb: codrcbQuebra });
            if ((t as any).agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codrcb: codrcbQuebra });
            const emLote = await trx.selectFrom('itens_lotecob').select('codilotcob').where('codrcb', '=', codrcbQuebra).executeTakeFirst();
            if (emLote) throw new BusinessRuleError('TITULO_EM_LOTE', { codrcb: codrcbQuebra });
            await trx.deleteFrom('areceber').where('codrcb', '=', codrcbQuebra).where('codempresa', '=', emp).execute();
            quebraEstornada = codrcbQuebra;
          }
        }

        // CAS 'F'→'A' + limpa a conferência do fechamento.
        const upd = await trx
          .updateTable('caixa_sessao')
          .set({
            status: 'A', dtfechamento: null, saldo_final: null,
            valor_contado: null, diferenca: null, codrcb_quebra: null,
            obs: dto?.obs != null ? dto.obs : sql`obs`,
            usultalteracao: op, dtultimalteracao: sql`now()`,
          })
          .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp).where('status', '=', 'F')
          .executeTakeFirst();
        if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('CAIXA_NAO_FECHADO', { codcaixa });
        return { codcaixa, status: 'A' as const, quebraEstornada };
      });
    } catch (e) {
      // backstop anti-corrida do índice parcial único (reabrir com outra sessão já aberta).
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('CAIXA_JA_ABERTO');
      throw e;
    }
  }

  // ── Wire da BAIXA de A Receber / A Pagar → CAIXA (corte-2) ──
  // Chamados DENTRO da transação da baixa (recebem o `trx` do serviço de baixa), garantindo
  // atomicidade: se o caixa falhar (fechado/saldo/inexistente), a baixa inteira faz rollback.

  /**
   * Lança no caixa ABERTO do operador o valor de uma baixa em DINHEIRO: A Receber → RECEBIMENTO
   * (entrada); A Pagar → PAGAMENTO (saída, com guarda de saldo≥0). Vincula por codrcbbx/codapgbx.
   * Exige caixa aberto (CAIXA_NAO_ABERTO) — não se recebe/paga dinheiro sem caixa.
   */
  async lancarDaBaixa(
    trx: AnyDB,
    p: { origem: 'AR' | 'AP'; valorpg: number; codrcbbx?: number; codapgbx?: number; dtpgto?: string; obs?: string | null },
  ): Promise<number> {
    const emp = this.emp();
    const op = this.opReq();
    const tipo: 'E' | 'S' = p.origem === 'AR' ? 'E' : 'S';
    const especie = p.origem === 'AR' ? 'RECEBIMENTO' : 'PAGAMENTO';
    const valor = r2(num(p.valorpg));
    if (valor <= 0) throw new BusinessRuleError('CAIXA_VALOR_INVALIDO', { valor });

    const s = await trx
      .selectFrom('caixa_sessao').select(['codcaixa', 'saldo_inicial'])
      .where('codempresa', '=', emp).where('codoperador', '=', op).where('status', '=', 'A')
      .forUpdate().executeTakeFirst();
    if (!s) throw new BusinessRuleError('CAIXA_NAO_ABERTO');

    if (tipo === 'S') {
      const saldo = await this.saldoCorrente(trx, (s as any).codcaixa, num((s as any).saldo_inicial));
      if (r2(saldo - valor) < 0) throw new BusinessRuleError('CAIXA_SALDO_INSUFICIENTE', { saldo, valor });
    }

    const ins = await trx
      .insertInto('caixa_mov')
      .values({
        codcaixa: (s as any).codcaixa, codempresa: emp, tipo, especie, recurso: 'DINHEIRO', valor,
        codrcbbx: p.codrcbbx ?? null, codapgbx: p.codapgbx ?? null,
        // data do movimento = data da baixa (edtDataBaixa no legado, UBaixaAreceber.pas:1266);
        // fallback now() quando a baixa não informa dtpgto.
        codoperador: op, data_operacao: p.dtpgto ?? sql`now()`, indr: 'I', obs: p.obs ?? null,
      })
      .returning('codmov').executeTakeFirstOrThrow();
    return Number((ins as any).codmov);
  }

  /**
   * Estorna (lógico) o movimento de caixa ligado a uma baixa que está sendo estornada. No-op se a
   * baixa não gerou movimento (recurso ≠ dinheiro). Se o caixa daquele movimento já foi FECHADO,
   * bloqueia (CAIXA_FECHADO) — não se desfaz dinheiro de um caixa fechado (reabra-o antes).
   */
  async estornarDaBaixa(trx: AnyDB, p: { codrcbbx?: number; codapgbx?: number }): Promise<number | null> {
    const emp = this.emp();
    let q = trx
      .selectFrom('caixa_mov as m')
      .innerJoin('caixa_sessao as s', 's.codcaixa', 'm.codcaixa')
      .select(['m.codmov', 's.status'])
      .where('s.codempresa', '=', emp)
      .where(sql`coalesce(m.indr,'I')`, '=', 'I');
    if (p.codrcbbx != null) q = q.where('m.codrcbbx', '=', p.codrcbbx);
    else if (p.codapgbx != null) q = q.where('m.codapgbx', '=', p.codapgbx);
    else return null;
    const m = await q.forUpdate().executeTakeFirst();
    if (!m) return null; // baixa não gerou movimento de caixa — nada a estornar
    if ((m as any).status !== 'A') throw new BusinessRuleError('CAIXA_FECHADO', { codmov: (m as any).codmov });

    await trx
      .updateTable('caixa_mov').set({ indr: 'E', data_operacao: sql`now()` })
      .where('codmov', '=', (m as any).codmov).where(sql`coalesce(indr,'I')`, '=', 'I').execute();
    return Number((m as any).codmov);
  }
}
