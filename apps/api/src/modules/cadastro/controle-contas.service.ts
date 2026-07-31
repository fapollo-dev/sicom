import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ORIGENS_MANUAIS = ['MANUAL', 'TRANSF']; // as únicas que esta tela cria/estorna (as demais são de outros módulos)

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS) — corte-1. Lançamentos MANUAIS no razão de tesouraria
 * (mov_contas_bancarias). `saldo`/`extrato`: Σ com sinal (C:+ / D:−) da conta. `lancar`: 1 linha (operação C/D →
 * tipomovimento, VALOR magnitude, origem='MANUAL'). `transferir`: 2 linhas (débito origem + crédito destino) ligadas
 * por idorigem=lote, origem='TRANSF', numa ÚNICA transação (o legado faz 2 posts soltos — melhoramos). `estornar`:
 * transferência apaga as DUAS pernas por lote; manual apaga a linha; bloqueia linhas de OUTRO módulo (origem≠MANUAL/
 * TRANSF) e já conciliadas (mov_conciliado='S'). Saldo-negativo travado só p/ conta CAIXA (codbco=0), fiel ao legado.
 * Tenant fail-closed por idempresa.
 */
@Injectable()
export class ControleContasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** confirma que a conta é da empresa e devolve codbco (0 = CAIXA, trava saldo negativo). */
  private async conta(db: AnyDB, codconta: number, emp: number): Promise<{ codbco: number }> {
    const c = (await db.selectFrom('contas_bancarias').select(['codconta', 'codbco']).where('codconta', '=', codconta).where('idempresa', '=', emp).executeTakeFirst()) as { codbco?: number } | undefined;
    if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta });
    // codbco null → −1 (NÃO tratar como CAIXA/0; fold auditoria nit). CAIXA = codbco 0 (trava saldo negativo).
    return { codbco: c.codbco == null ? -1 : Number(c.codbco) };
  }

  /** saldo (Σ com sinal) da conta. `ateData` (opcional) = saldo ATÉ a data (âncora do extrato com filtro). */
  private async saldoDe(db: AnyDB, codconta: number, emp: number, ateData?: string): Promise<number> {
    let q = db
      .selectFrom('mov_contas_bancarias')
      .select(sql`coalesce(sum(case when tipomovimento='D' then -valor else valor end),0)`.as('saldo'))
      .where('codconta', '=', codconta)
      .where('idempresa', '=', emp);
    if (ateData) q = q.where(sql`data_fechamento`, '<=', ateData);
    const r = (await q.executeTakeFirst()) as { saldo?: unknown } | undefined;
    return r2(num(r?.saldo));
  }

  /** operações manuais disponíveis (catálogo C/D, exclui a 0=TRANSFERENCIA interna). */
  async operacoes(): Promise<Array<{ codopconta: number; descricao: string; tipo: string }>> {
    return (await (this.dbp.forTenantRead() as AnyDB).selectFrom('operacoes_conta').select(['codopconta', 'descricao', 'tipo']).where('codopconta', '>', 0).orderBy('descricao').execute()) as Array<{ codopconta: number; descricao: string; tipo: string }>;
  }

  /** saldo da conta (com totais de entrada/saída). */
  async saldo(codconta: number): Promise<{ codconta: number; saldo: number; entradas: number; saidas: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, codconta, emp);
    const r = (await db
      .selectFrom('mov_contas_bancarias')
      .select([
        sql`coalesce(sum(case when tipomovimento='C' then valor else 0 end),0)`.as('entradas'),
        sql`coalesce(sum(case when tipomovimento='D' then valor else 0 end),0)`.as('saidas'),
      ])
      .where('codconta', '=', codconta)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { entradas?: unknown; saidas?: unknown };
    const entradas = r2(num(r?.entradas));
    const saidas = r2(num(r?.saidas));
    return { codconta, saldo: r2(entradas - saidas), entradas, saidas };
  }

  /** extrato: movimentos da conta (mais recentes primeiro, até 5000) + saldo corrente por linha. O header usa o
   *  saldo VERDADEIRO (Σ ALL — fold auditoria [MÉDIA]: antes o header vinha do Σ das 5000 mais ANTIGAS → errado numa
   *  conta com >5000 mov.). O saldo corrente é ancorado no saldo até dtfim (após o mais recente exibido) e desce. */
  async extrato(codconta: number, dtini?: string, dtfim?: string): Promise<{ codconta: number; saldo: number; movimentos: Record<string, unknown>[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, codconta, emp);
    const saldoAtual = await this.saldoDe(db, codconta, emp); // Σ ALL = saldo corrente real (header)
    const ancora = dtfim ? await this.saldoDe(db, codconta, emp, dtfim) : saldoAtual; // saldo após o mais recente do recorte
    let q = db
      .selectFrom('mov_contas_bancarias')
      .select(['codmovconta', 'valor', 'tipomovimento', 'codopconta', 'historico', 'origem', 'idorigem', 'data_fechamento', 'mov_conciliado'])
      .where('codconta', '=', codconta)
      .where('idempresa', '=', emp);
    if (dtini) q = q.where(sql`data_fechamento`, '>=', dtini);
    if (dtfim) q = q.where(sql`data_fechamento`, '<=', dtfim);
    // mais recentes primeiro (limita aos 5000 últimos, não aos primeiros).
    const rows = (await q.orderBy('data_fechamento', 'desc').orderBy('codmovconta', 'desc').limit(5000).execute()) as Record<string, unknown>[];
    // saldo corrente: da linha mais nova (após ela = âncora) descendo p/ as mais antigas.
    let running = ancora;
    const movimentos = rows.map((m) => {
      const delta = String(m.tipomovimento) === 'D' ? -num(m.valor) : num(m.valor);
      const linha = { ...m, valor_com_sinal: r2(delta), saldo_corrente: r2(running) };
      running = r2(running - delta); // saldo ANTES desta linha = saldo APÓS a próxima (mais antiga)
      return linha;
    });
    return { codconta, saldo: saldoAtual, movimentos };
  }

  /** lançamento MANUAL (1 linha). A operação define o tipomovimento (C/D); VALOR gravado como magnitude. */
  async lancar(dto: { codconta: number; codopconta: number; valor: number; historico?: string; idpgto?: number; data?: string }): Promise<{ codmovconta: number; tipomovimento: string; saldo: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { codbco } = await this.conta(trx, dto.codconta, emp);
      const oc = (await trx.selectFrom('operacoes_conta').select(['codopconta', 'tipo']).where('codopconta', '=', dto.codopconta).where('codopconta', '>', 0).executeTakeFirst()) as { tipo?: string } | undefined;
      if (!oc) throw new BusinessRuleError('OPERACAO_NAO_ENCONTRADA', { codopconta: dto.codopconta });
      const tipo = String(oc.tipo) === 'D' ? 'D' : 'C';
      const valor = r2(num(dto.valor));
      // saldo-negativo travado só p/ conta CAIXA (codbco=0) — fiel a Utransferencia.pas:187 / udmPrincipal:2232.
      if (tipo === 'D' && codbco === 0) {
        const saldo = await this.saldoDe(trx, dto.codconta, emp);
        if (r2(saldo - valor) < 0) throw new BusinessRuleError('SALDO_INSUFICIENTE', { codconta: dto.codconta, saldo, valor });
      }
      const ins = (await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa: emp, valor, tipomovimento: tipo, codopconta: dto.codopconta, origem: 'MANUAL', idorigem: null,
        historico: dto.historico ?? null, idpgto: dto.idpgto ?? null, codoperador: op, data_fechamento: dto.data ?? sql`now()`, dtcadastro: sql`now()`,
      }).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      return { codmovconta: Number(ins.codmovconta), tipomovimento: tipo, saldo: await this.saldoDe(trx, dto.codconta, emp) };
    });
  }

  /** TRANSFERÊNCIA: débito origem + crédito destino (mesmo valor) numa ÚNICA transação, ligados por idorigem=lote. */
  async transferir(dto: { codorigem: number; coddestino: number; valor: number; historico?: string; data?: string }): Promise<{ idlote: number; debito: number; credito: number }> {
    const emp = this.emp();
    const op = this.op();
    if (dto.codorigem === dto.coddestino) throw new BusinessRuleError('TRANSFERENCIA_MESMA_CONTA', { conta: dto.codorigem });
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const orig = await this.conta(trx, dto.codorigem, emp);
      await this.conta(trx, dto.coddestino, emp);
      const valor = r2(num(dto.valor));
      if (orig.codbco === 0) {
        const saldo = await this.saldoDe(trx, dto.codorigem, emp);
        if (r2(saldo - valor) < 0) throw new BusinessRuleError('SALDO_INSUFICIENTE', { codconta: dto.codorigem, saldo, valor });
      }
      const loteRes = await trx.executeQuery(sql`select nextval('seq_controle_lote') as lote`.compile(trx));
      const lote = Number((loteRes.rows[0] as { lote: number | string }).lote);
      const hist = (dto.historico ?? 'Transferência entre contas').slice(0, 240);
      const dataMov = dto.data ?? sql`now()`;
      const deb = (await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codorigem, idempresa: emp, valor, tipomovimento: 'D', codopconta: 0, origem: 'TRANSF', idorigem: lote,
        historico: `${hist} — p/ conta ${dto.coddestino} (lote ${lote})`, codoperador: op, data_fechamento: dataMov, dtcadastro: sql`now()`,
      }).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      const cre = (await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.coddestino, idempresa: emp, valor, tipomovimento: 'C', codopconta: 0, origem: 'TRANSF', idorigem: lote,
        historico: `${hist} — de conta ${dto.codorigem} (lote ${lote})`, codoperador: op, data_fechamento: dataMov, dtcadastro: sql`now()`,
      }).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      return { idlote: lote, debito: Number(deb.codmovconta), credito: Number(cre.codmovconta) };
    });
  }

  /** estorna (apaga) um movimento MANUAL/TRANSFERÊNCIA. Transferência apaga as 2 pernas por lote. Bloqueia linhas de
   *  outro módulo (origem≠MANUAL/TRANSF) e já conciliadas. */
  async estornar(codmovconta: number): Promise<{ codmovconta: number; removidos: number; origem: string }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const m = (await trx.selectFrom('mov_contas_bancarias').select(['codmovconta', 'origem', 'idorigem', 'mov_conciliado']).where('codmovconta', '=', codmovconta).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as { origem?: string; idorigem?: number; mov_conciliado?: string } | undefined;
      if (!m) throw new BusinessRuleError('MOVIMENTO_NAO_ENCONTRADO', { codmovconta });
      const origem = String(m.origem ?? '');
      if (!ORIGENS_MANUAIS.includes(origem)) throw new BusinessRuleError('MOVIMENTO_NAO_MANUAL', { codmovconta, origem }); // de outro módulo
      if (String(m.mov_conciliado ?? 'N') === 'S') throw new BusinessRuleError('MOVIMENTO_CONCILIADO', { codmovconta }); // desfazer a conciliação antes
      let removidos = 0;
      if (origem === 'TRANSF' && m.idorigem != null) {
        // trava AS DUAS pernas do lote com o MESMO predicado do delete (fold auditoria: senão o SELECT inicial trava só
        // 1 perna e um `conciliar` concorrente na OUTRA sneak-in → junção pendurada). Serializa com conciliar (forUpdate).
        await trx.selectFrom('mov_contas_bancarias').select('codmovconta').where('origem', '=', 'TRANSF').where('idorigem', '=', Number(m.idorigem)).where('idempresa', '=', emp).forUpdate().execute();
        // trava se QUALQUER perna do lote já foi conciliada (senão apagar só uma deixaria meia-transferência).
        const conc = Number((await trx.selectFrom('mov_contas_bancarias').select(sql`count(*)`.as('n')).where('origem', '=', 'TRANSF').where('idorigem', '=', Number(m.idorigem)).where('idempresa', '=', emp).where(sql`coalesce(mov_conciliado,'N')`, '=', 'S').executeTakeFirst() as any)?.n ?? 0);
        if (conc > 0) throw new BusinessRuleError('MOVIMENTO_CONCILIADO', { codmovconta });
        // apaga as DUAS pernas do lote (fiel a UconsMovBancaria.pas:924 DELETE ... WHERE IDLOTE=...).
        const res = await trx.deleteFrom('mov_contas_bancarias').where('origem', '=', 'TRANSF').where('idorigem', '=', Number(m.idorigem)).where('idempresa', '=', emp).executeTakeFirst();
        removidos = Number((res as any)?.numDeletedRows ?? 0);
      } else {
        const res = await trx.deleteFrom('mov_contas_bancarias').where('codmovconta', '=', codmovconta).where('idempresa', '=', emp).executeTakeFirst();
        removidos = Number((res as any)?.numDeletedRows ?? 0);
      }
      return { codmovconta, removidos, origem };
    });
  }
}
