import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { AdiantamentoCriarDto, AdiantamentoEditarDto, AdiantamentoListarDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';
import { assertPeriodoNaoFechado, type BloqPeriodo } from '../shared/periodo-contabil';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** F19→'C' (dinheiro ENTRA, gera A PAGAR) · F20→'D' (dinheiro SAI, gera A RECEBER) · F21→'E' (como 'C', com ADCREDITO). */
const TIPO_POR_OPERACAO: Record<string, 'C' | 'D' | 'E'> = { F19: 'C', F20: 'D', F21: 'E' };
/** a frase que o legado grava no título gerado (é o predicado do delete no legado — aqui só o texto). */
const obsTitulo = (cod: number) => `Originado do lancamento do adiantamento de parceiro n: ${cod}`;

/**
 * ADIANTAMENTO A FORNECEDOR/PARCEIRO (FRMADIANTAMENTOFORNECEDOR, uCadAdiantamentoFornecedor.pas — 699 acessos/
 * 11 operadores). Cada registro produz DOIS fatos, na mesma transação:
 *   1) MOVIMENTO na conta corrente (`mov_contas_bancarias`) — tipo 'D' debita (dinheiro sai), 'C'/'E' creditam;
 *   2) TÍTULO — 'D' → `areceber` (o parceiro nos deve), 'C'/'E' → `apagar` (devemos ao parceiro), ambos com
 *      ADFORNECEDOR='S', NRODUP=1, TIPODOC='A VISTA', DUPLICATA=código e a OBS "Originado do lancamento…".
 * Gates fiéis: DTCHAVEAMENTO da conta ("Caixa FECHADO…"), saldo insuficiente **só** no tipo 'D' e **só** em conta
 * CAIXA (codbco=0), QUITADA='S'/CONTABILIZADO='S'/período contábil fechado bloqueiam editar e excluir.
 * VALOR na MCB é gravado como MAGNITUDE + `tipomovimento` (convenção do novo; o legado grava com sinal — ver o
 * dossiê uCadAdiantamentoFornecedor.md §3, que registra o `abs()` necessário na carga).
 */
@Injectable()
export class AdiantamentoFornService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** o TIPO vem da situação do documento; a config `INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS` decide se ela é
   *  obrigatória (no golden: override Modulo='Retaguarda' → 'S', e IDSITUACAO_NF preenchido em 563/563). */
  private async tipoDoDocumento(db: AnyDB, dto: { idsituacao_nf?: number; tipo?: 'C' | 'D' | 'E' }): Promise<{ tipo: 'C' | 'D' | 'E'; idsituacao_nf: number | null }> {
    const exige = await this.config.ligado('INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS', { empresaId: this.emp(), operadorId: this.op(), modulo: 'Retaguarda' });
    if (dto.idsituacao_nf != null) {
      const s = (await db.selectFrom('situacao_nf').select(['idsituacao_nf', 'tipo_operacao']).where('idsituacao_nf', '=', dto.idsituacao_nf).executeTakeFirst()) as { tipo_operacao?: string } | undefined;
      if (!s) throw new BusinessRuleError('SITUACAO_NAO_ENCONTRADA', { idsituacao_nf: dto.idsituacao_nf });
      const tipo = TIPO_POR_OPERACAO[String(s.tipo_operacao ?? '').toUpperCase()];
      // "Nenhuma situação para adiantamento à parceiro foi encontrada" — a situação existe mas não é F19/F20/F21.
      if (!tipo) throw new BusinessRuleError('SITUACAO_NAO_ADIANTAMENTO', { idsituacao_nf: dto.idsituacao_nf, tipo_operacao: s.tipo_operacao ?? null });
      return { tipo, idsituacao_nf: dto.idsituacao_nf };
    }
    if (exige) throw new BusinessRuleError('SITUACAO_OBRIGATORIA'); // 'Informe a situação do documento.'
    if (!dto.tipo) throw new BusinessRuleError('TIPO_OBRIGATORIO'); // radio habilitado, mas nada escolhido
    return { tipo: dto.tipo, idsituacao_nf: null };
  }

  /** parceiro DA EMPRESA (fold auditoria [ALTA]: `parceiros` é empresa-escopado — mig 014 — e sem o filtro um
   *  operador da empresa 1 gravaria adiantamento/título/histórico com parceiro da empresa 2), ATIVADO='S' e, se a
   *  situação tiver lista em situacao_nf_parceiros, dentro da lista — o filtro do picker. */
  private async assertParceiro(db: AnyDB, codparceiro: number, idsituacao_nf: number | null, emp: number): Promise<void> {
    const p = (await db.selectFrom('parceiros').select(['codparceiro', 'ativado']).where('codparceiro', '=', codparceiro).where('idempresa', '=', emp).executeTakeFirst()) as { ativado?: string } | undefined;
    if (!p) throw new BusinessRuleError('PARCEIRO_NAO_ENCONTRADO', { codparceiro });
    if (String(p.ativado ?? 'S') !== 'S') throw new BusinessRuleError('PARCEIRO_INATIVO', { codparceiro });
    if (idsituacao_nf == null) return;
    const lista = (await db.selectFrom('situacao_nf_parceiros').select('codparceiro').where('idsituacao_nf', '=', idsituacao_nf).execute()) as Array<{ codparceiro: number }>;
    if (lista.length === 0) return; // lista vazia = sem restrição (o caso das situações 1011/1012 no golden)
    if (!lista.some((l) => Number(l.codparceiro) === codparceiro)) throw new BusinessRuleError('PARCEIRO_NAO_PERMITIDO_SITUACAO', { codparceiro, idsituacao_nf });
  }

  /**
   * A conta é da empresa? devolve codbco (0 = CAIXA, o único que trava saldo) e o chaveamento. O vínculo
   * operador×conta (`CONTAS_BANCARIAS_OP`) **também é gate de gravação**, não só do picker (fold auditoria
   * [MÉDIA]): `uCadAdiantamentoFornecedor.pas:568-575` consulta o par antes do `if FlagGravacao = 0`, com a
   * mensagem "Este Operador não tem permissão para manipular essa conta corrente." — vale no insert e no editar.
   */
  private async conta(db: AnyDB, codconta: number, emp: number, travar = false): Promise<{ codbco: number; dtchaveamento: string | null }> {
    // `travar` (fold auditoria [MÉDIA]): sem lock na conta, dois POST /criar concorrentes leem o MESMO saldo e os
    // dois passam o gate de saldo insuficiente (READ COMMITTED). Travar a linha da conta serializa por conta.
    // dtchaveamento vem como TEXTO do banco: um `date` chega como Date à meia-noite LOCAL e `toISOString()`
    // deslocaria o dia em host com offset UTC positivo.
    let q = db
      .selectFrom('contas_bancarias')
      .select(['codconta', 'codbco', sql<string | null>`to_char(dtchaveamento,'YYYY-MM-DD')`.as('dtchaveamento')])
      .where('codconta', '=', codconta)
      .where('idempresa', '=', emp);
    if (travar) q = q.forUpdate();
    const c = (await q.executeTakeFirst()) as { codbco?: number; dtchaveamento?: string | null } | undefined;
    if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta });
    const op = this.op();
    if (op != null) {
      const vinculo = await db.selectFrom('contas_bancarias_op').select('codrelacao').where('codconta', '=', codconta).where('codoperador', '=', op).executeTakeFirst();
      if (!vinculo) throw new BusinessRuleError('CONTA_SEM_PERMISSAO_OPERADOR', { codconta, codoperador: op });
    }
    return { codbco: c.codbco == null ? -1 : Number(c.codbco), dtchaveamento: c.dtchaveamento ?? null };
  }

  /** "Caixa FECHADO não é permitida alteração dos documentos!" (udmPrincipal.pas:2183) — data <= DTCHAVEAMENTO. */
  private assertChaveamento(dtchaveamento: string | null, data: string, codconta: number): void {
    if (dtchaveamento == null) return;
    const chav = dtchaveamento.slice(0, 10);
    if (data.slice(0, 10) <= chav) throw new BusinessRuleError('CAIXA_FECHADO', { codconta, dtchaveamento: chav, data });
  }

  /**
   * Saldo da conta NA MODALIDADE DINHEIRO — a fórmula que o gate do legado usa, não o saldo geral do razão
   * (fold auditoria [ALTA]). `GetSaldoContaCorrente` (udmPrincipal.pas:3877-3903) faz
   * `SUM(CASE WHEN M.LIBERADO='S' THEN M.VALOR ELSE 0 END)` com **INNER JOIN FORMAS_PGTO** e
   * `AND UPPER(F.MODALIDADE) = 'DINHEIRO'` (a modalidade vem do call site, uCadAdiantamentoFornecedor.pas:583).
   * A diferença é enorme no golden: conta 22 → −284.308,49 (legado) contra +1.590.292,62 (soma geral); conta 24 →
   * 0,00 contra 50.472,70. Com a soma geral o gate liberaria débito em conta que o legado barra.
   * O único termo que não dá para reproduzir é `LIBERADO`: a coluna não existe no nosso razão (split registrado
   * como adiado no Controle de Contas Correntes) — aqui todo movimento conta como liberado.
   * O sinal vem do `tipomovimento` (convenção do novo; o legado guarda VALOR já com sinal).
   */
  private async saldoDinheiro(db: AnyDB, codconta: number, emp: number): Promise<number> {
    const r = (await db
      .selectFrom('mov_contas_bancarias as m')
      .innerJoin('formas_pgto as f', 'f.idpgto', 'm.idpgto')
      .select(sql`coalesce(sum(case when m.tipomovimento='D' then -m.valor else m.valor end),0)`.as('saldo'))
      .where('m.codconta', '=', codconta)
      .where('m.idempresa', '=', emp)
      .where(sql`upper(f.modalidade)`, '=', 'DINHEIRO')
      .executeTakeFirst()) as { saldo?: unknown } | undefined;
    return r2(num(r?.saldo));
  }

  /** a forma do MOVIMENTO: conta CAIXA (codbco=0) → a de MODALIDADE 'DINHEIRO'; conta de BANCO → a de DESTINO='CXA'
   *  (LancaMovimento, udmPrincipal.pas:2168-2174). Sem forma cadastrada → null (o legado deixaria 0). */
  private async idpgtoMovimento(db: AnyDB, emp: number, codbco: number): Promise<number | null> {
    const q = db.selectFrom('formas_pgto').select('idpgto').where('idempresa', '=', emp);
    // orderBy p/ ser determinístico quando a empresa tem mais de uma forma DINHEIRO/CXA (fold auditoria nit).
    const f = (await (codbco === 0 ? q.where(sql`upper(modalidade)`, '=', 'DINHEIRO') : q.where('destino', '=', 'CXA')).orderBy('idpgto').executeTakeFirst()) as { idpgto?: number } | undefined;
    return f?.idpgto == null ? null : Number(f.idpgto);
  }

  /** a forma do TÍTULO a receber: `RetornarValores('FORMAS_PGTO','DESTINO;IDEMPRESA','RCB;<emp>','IDPGTO')`. */
  private async idpgtoRcb(db: AnyDB, emp: number): Promise<number | null> {
    const f = (await db.selectFrom('formas_pgto').select('idpgto').where('idempresa', '=', emp).where('destino', '=', 'RCB').orderBy('idpgto').executeTakeFirst()) as { idpgto?: number } | undefined;
    return f?.idpgto == null ? null : Number(f.idpgto);
  }

  /**
   * Área do período contábil desta tela: o Oracle tem um flag DEDICADO —`PERIODO_CONTABIL.BLOQ_ADIANTAMENTO_FORN`,
   * 'S' nos 2 períodos fechados do golden (fold auditoria [ALTA]) — e não os de A Receber/A Pagar.
   */
  private flagPeriodo(): BloqPeriodo {
    return 'bloq_adiantamento_forn';
  }

  /** situações que servem de adiantamento (o combo do "adicionar"), já com o tipo derivado. */
  async situacoes(): Promise<Array<{ idsituacao_nf: number; descricao: string; tipo_operacao: string; tipo: string }>> {
    const rows = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('situacao_nf')
      .select(['idsituacao_nf', 'descricao', 'tipo_operacao'])
      .where(sql`upper(coalesce(tipo_operacao,''))`, 'in', ['F19', 'F20', 'F21'])
      .orderBy('idsituacao_nf')
      .execute()) as Array<{ idsituacao_nf: number; descricao: string; tipo_operacao: string }>;
    return rows.map((r) => ({ ...r, tipo: TIPO_POR_OPERACAO[String(r.tipo_operacao).toUpperCase()] ?? '' }));
  }

  /** as contas que o operador pode usar (o picker filtra por CONTAS_BANCARIAS_OP.CODOPERADOR). */
  async contas(): Promise<Array<{ codconta: number; nroconta: string | null; titular: string | null; codbco: number | null; saldo: number }>> {
    const emp = this.emp();
    const op = this.op();
    const db = this.dbp.forTenantRead() as AnyDB;
    let q = db
      .selectFrom('contas_bancarias as c')
      .select(['c.codconta', 'c.nroconta', 'c.titular', 'c.codbco'])
      .where('c.idempresa', '=', emp)
      .where(sql`coalesce(c.ativo,'S')`, '=', 'S');
    if (op != null) q = q.where(sql<boolean>`exists (select 1 from contas_bancarias_op o where o.codconta = c.codconta and o.codoperador = ${op})`);
    const rows = (await q.orderBy('c.codconta').execute()) as Array<{ codconta: number; nroconta: string | null; titular: string | null; codbco: number | null }>;
    const out = [];
    for (const r of rows) out.push({ ...r, saldo: await this.saldoDinheiro(db, Number(r.codconta), emp) });
    return out;
  }

  async listar(f: AdiantamentoListarDto): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('adiantamento_forn as a')
      .leftJoin('parceiros as p', (j: any) => j.onRef('p.codparceiro', '=', 'a.codparceiro').on('p.idempresa', '=', emp))
      .leftJoin('contas_bancarias as cc', (j: any) => j.onRef('cc.codconta', '=', 'a.codcontacorrente').on('cc.idempresa', '=', emp))
      // os joins do título casam TAMBÉM adfornecedor + a OBS gerada (fold auditoria [MÉDIA]): `codadiantamento`
      // não é 1:1 — o golden tem 6 títulos de OUTROS fluxos com CODADIANTAMENTO preenchido, e um join só por ele
      // duplicaria a linha do adiantamento depois da carga.
      .leftJoin('areceber as r', (j: any) => j.onRef('r.codadiantamento', '=', 'a.codadiantamento').on('r.codempresa', '=', emp).on('r.adfornecedor', '=', 'S').onRef('r.obs', '=', sql`'Originado do lancamento do adiantamento de parceiro n: ' || a.codadiantamento`))
      .leftJoin('apagar as g', (j: any) => j.onRef('g.codadiantamento', '=', 'a.codadiantamento').on('g.codempresa', '=', emp).on('g.adfornecedor', '=', 'S').onRef('g.obs', '=', sql`'Originado do lancamento do adiantamento de parceiro n: ' || a.codadiantamento`))
      .select([
        'a.codadiantamento', 'a.codparceiro', 'a.codcontacorrente', 'a.dtadiantamento', 'a.dtvencimento', 'a.valor',
        'a.tipo', 'a.quitada', 'a.codmovconta', 'a.obs', 'a.idsituacao_nf', 'a.contabilizado',
        'p.razao', 'cc.nroconta', 'r.codrcb', 'g.codapg',
      ])
      .where('a.idempresa', '=', emp);
    if (f.codparceiro != null) q = q.where('a.codparceiro', '=', f.codparceiro);
    if (f.tipo) q = q.where('a.tipo', '=', f.tipo);
    if (f.quitada) q = q.where('a.quitada', '=', f.quitada);
    if (f.dtini) q = q.where(sql`cast(a.dtadiantamento as date)`, '>=', f.dtini);
    if (f.dtfim) q = q.where(sql`cast(a.dtadiantamento as date)`, '<=', f.dtfim);
    return (await q.orderBy('a.codadiantamento', 'desc').limit(f.limite ?? 500).execute()) as Record<string, unknown>[];
  }

  /** CRIAR: grava o adiantamento, o movimento na conta corrente e o título — tudo numa transação. */
  async criar(dto: AdiantamentoCriarDto): Promise<{ codadiantamento: number; tipo: string; codmovconta: number; codrcb: number | null; codapg: number | null; saldo: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { tipo, idsituacao_nf } = await this.tipoDoDocumento(trx, dto);
      await assertPeriodoNaoFechado(trx, emp, dto.dtadiantamento, this.flagPeriodo());
      await this.assertParceiro(trx, dto.codparceiro, idsituacao_nf, emp);
      const { codbco, dtchaveamento } = await this.conta(trx, dto.codcontacorrente, emp, true); // trava a conta (gate de saldo)
      this.assertChaveamento(dtchaveamento, dto.dtadiantamento, dto.codcontacorrente);
      const valor = r2(num(dto.valor));
      // saldo: só o tipo 'D' pede VerifSaldo=true, e o legado só trava em conta CAIXA (codbco=0).
      if (tipo === 'D' && codbco === 0) {
        const saldo = await this.saldoDinheiro(trx, dto.codcontacorrente, emp);
        if (r2(saldo - valor) < 0) throw new BusinessRuleError('SALDO_INSUFICIENTE', { codconta: dto.codcontacorrente, saldo, valor });
      }
      // ORDEM DO LEGADO (fold auditoria): o movimento na conta corrente é criado ANTES do adiantamento
      // (`ValidaSaldoAnterior` → `LancaMovimento` em edtNroContaExit, e só depois o post do registro com
      // CODMOVCONTA em uCadAdiantamentoFornecedor.pas:606); o vínculo inverso (MOV.CODADIANTAMENTO) é escrito no
      // fim (pas:396-401). Assim `codmovconta` pode ser NOT NULL, como a trigger VALIDA_ADIANTAMENTO exige.
      // HISTORICO = OBS (em MAIÚSCULAS, como o dbmOBSKeyPress do legado força — 563/563 do golden), ou o default
      // de ValidaSaldoAnterior quando a OBS vem vazia (caminho que o golden NUNCA exerceu: 0/563).
      const razao = (await trx.selectFrom('parceiros').select('razao').where('codparceiro', '=', dto.codparceiro).where('idempresa', '=', emp).executeTakeFirst()) as { razao?: string } | undefined;
      const obs = dto.obs?.trim() ? dto.obs.trim().toUpperCase().slice(0, 255) : null;
      const historico = (obs || (tipo === 'D' ? `ADIANTAMENTO PARA O PARCEIRO ${razao?.razao ?? dto.codparceiro}` : `ADIANTAMENTO DO PARCEIRO ${razao?.razao ?? dto.codparceiro}`)).slice(0, 255);
      const mov = (await trx
        .insertInto('mov_contas_bancarias')
        .values({
          codconta: dto.codcontacorrente, idempresa: emp, valor, tipomovimento: tipo === 'D' ? 'D' : 'C',
          codopconta: 0, origem: 'ADTOFORN', historico,
          idpgto: await this.idpgtoMovimento(trx, emp, codbco), codoperador: op,
          data_fechamento: dto.dtadiantamento, dtcadastro: sql`now()`,
        })
        .returning('codmovconta')
        .executeTakeFirstOrThrow()) as { codmovconta: number };
      const codmovconta = Number(mov.codmovconta);

      const ins = (await trx
        .insertInto('adiantamento_forn')
        .values({
          idempresa: emp, codparceiro: dto.codparceiro, codcontacorrente: dto.codcontacorrente,
          dtadiantamento: dto.dtadiantamento, dtvencimento: dto.dtvencimento, valor, tipo, quitada: 'N',
          obs, idsituacao_nf, codmovconta, usultalteracao: op,
          dtcadastro: sql`now()`, dtultimalteracao: sql`now()`, // o TfrmCadMaster carimba as DUAS no insert (563/563)
        })
        .returning('codadiantamento')
        .executeTakeFirstOrThrow()) as { codadiantamento: number };
      const cod = Number(ins.codadiantamento);
      // fecha o vínculo inverso no movimento (o `origem`/`idorigem` genéricos do razão + a coluna própria).
      await trx.updateTable('mov_contas_bancarias').set({ codadiantamento: cod, idorigem: cod }).where('codmovconta', '=', codmovconta).where('idempresa', '=', emp).execute();

      // 2) o título. Comum aos dois lados: DUPLICATA = o código, NRODUP=1, TIPODOC='A VISTA', ADFORNECEDOR='S'.
      const comum = {
        codparceiro: dto.codparceiro, codempresa: emp, dtvenc: dto.dtvencimento, duplicata: String(cod),
        codadiantamento: cod, obs: obsTitulo(cod), quitada: 'N', nrodup: 1, tipodoc: 'A VISTA',
        // sem IDSITUACAO_NF: os INSERTs do legado (pas:321/343) não listam a coluna e o golden confirma —
        // 0 dos 552 títulos do adiantamento no ARECEBER têm situação (fold auditoria [MÉDIA]).
        adfornecedor: 'S', valor, usultalteracao: op, dtcadastro: sql`now()`,
      };
      let codrcb: number | null = null;
      let codapg: number | null = null;
      if (tipo === 'D') {
        const t = (await trx
          .insertInto('areceber')
          .values({ ...comum, dtvenda: dto.dtadiantamento, consiliado: 'S', idpgto: await this.idpgtoRcb(trx, emp) })
          .returning('codrcb')
          .executeTakeFirstOrThrow()) as { codrcb: number };
        codrcb = Number(t.codrcb);
      } else {
        // ADCREDITO='S' só no tipo 'E' (`iif(TIPO='E','S',NULL)`); CODGRUPO do legado não tem par no nosso apagar.
        const t = (await trx
          .insertInto('apagar')
          .values({ ...comum, dtvenda: dto.dtadiantamento, adcredito: tipo === 'E' ? 'S' : null })
          .returning('codapg')
          .executeTakeFirstOrThrow()) as { codapg: number };
        codapg = Number(t.codapg);
      }
      return { codadiantamento: cod, tipo, codmovconta, codrcb, codapg, saldo: await this.saldoDinheiro(trx, dto.codcontacorrente, emp) };
    });
  }

  /**
   * Carrega o registro para alterar/excluir e aplica TODOS os bloqueios. Ordem de lock = **título primeiro, depois
   * o adiantamento** — a mesma das baixas (`areceber-baixa`/`apagar-baixa` travam o título e só então chamam
   * `marcarQuitada`); inverter daria deadlock 40P01 entre excluir e baixar (fold auditoria [MÉDIA]).
   *
   * Além dos 3 bloqueios do legado (QUITADA / CONTABILIZADO / período), confere o ESTADO REAL DO TÍTULO gerado
   * (fold auditoria [ALTA]): o flag `adiantamento_forn.quitada` é sombra e só é escrito pela baixa DIRETA do
   * título — se o título foi AGRUPADO (o consolidado carrega o valor dele), entrou em LOTE DE COBRANÇA/remessa, ou
   * já tem baixa, o hard-delete daqui apagaria o título (e, em cascata, as baixas) deixando consolidado com valor
   * de membro inexistente e `caixa_mov.codrcbbx`/`itens_lotecob.codrcb` pendurados (nenhum dos dois tem FK).
   */
  private async paraAlterar(trx: AnyDB, emp: number, cod: number, operacao: 'editar' | 'excluir'): Promise<{ tipo: string; codmovconta: number | null; codcontacorrente: number; valor: number; idsituacao_nf: number | null }> {
    // 1) leitura SEM lock só para descobrir o tipo (define qual tabela de título travar primeiro).
    const pre = (await trx
      .selectFrom('adiantamento_forn')
      .select(['codadiantamento', 'tipo'])
      .where('codadiantamento', '=', cod)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { tipo?: string } | undefined;
    if (!pre) throw new BusinessRuleError('ADIANTAMENTO_NAO_ENCONTRADO', { codadiantamento: cod });
    const tipoPre = String(pre.tipo);

    // 2) trava o título gerado (predicado estreito: `codadiantamento` não é 1:1 — ver o join do listar) e confere
    //    se ele ainda está intocado.
    if (tipoPre === 'D') {
      const t = (await trx
        .selectFrom('areceber')
        .select(['codrcb', 'quitada', 'agrupado'])
        .where('codadiantamento', '=', cod)
        .where('codempresa', '=', emp)
        .where('adfornecedor', '=', 'S')
        .where('obs', '=', obsTitulo(cod))
        .forUpdate()
        .executeTakeFirst()) as { codrcb?: number; quitada?: string; agrupado?: string } | undefined;
      if (t) {
        const codrcb = Number(t.codrcb);
        if (String(t.quitada ?? 'N') === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codadiantamento: cod, codrcb, operacao });
        if (String(t.agrupado ?? 'N') === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codadiantamento: cod, codrcb, operacao });
        // só baixa ATIVA bloqueia: o estorno é lógico (INDR='E') e deixa a linha, mas devolve o título a 'N' —
        // contar a estornada travaria para sempre um título que o legado volta a permitir excluir.
        const bx = await trx.selectFrom('areceber_bx').select('codrcbbx').where('codrcb', '=', codrcb).where('codempresa', '=', emp).where(sql`coalesce(indr,'I')`, '=', 'I').executeTakeFirst();
        if (bx) throw new BusinessRuleError('TITULO_TEM_BAIXA', { codadiantamento: cod, codrcb, operacao });
        const lote = await trx.selectFrom('itens_lotecob').select('codilotcob').where('codrcb', '=', codrcb).executeTakeFirst();
        if (lote) throw new BusinessRuleError('TITULO_EM_LOTE', { codadiantamento: cod, codrcb, operacao });
      }
    } else {
      const t = (await trx
        .selectFrom('apagar')
        .select(['codapg', 'quitada', 'agrupado'])
        .where('codadiantamento', '=', cod)
        .where('codempresa', '=', emp)
        .where('adfornecedor', '=', 'S')
        .where('obs', '=', obsTitulo(cod))
        .forUpdate()
        .executeTakeFirst()) as { codapg?: number; quitada?: string; agrupado?: string } | undefined;
      if (t) {
        const codapg = Number(t.codapg);
        if (String(t.quitada ?? 'N') === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codadiantamento: cod, codapg, operacao });
        if (String(t.agrupado ?? 'N') === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codadiantamento: cod, codapg, operacao });
        const bx = await trx.selectFrom('apagar_bx').select('codapgbx').where('codapg', '=', codapg).where('codempresa', '=', emp).where(sql`coalesce(indr,'I')`, '=', 'I').executeTakeFirst();
        if (bx) throw new BusinessRuleError('TITULO_TEM_BAIXA', { codadiantamento: cod, codapg, operacao });
      }
    }

    // 3) agora trava o adiantamento e reconfere o estado (outra trx pode ter quitado entre o passo 1 e aqui).
    const a = (await trx
      .selectFrom('adiantamento_forn')
      .select(['codadiantamento', 'tipo', 'quitada', 'contabilizado', 'codmovconta', 'codcontacorrente', 'valor', 'idsituacao_nf'])
      .where('codadiantamento', '=', cod)
      .where('idempresa', '=', emp)
      .forUpdate()
      .executeTakeFirst()) as { tipo?: string; quitada?: string; contabilizado?: string; codmovconta?: number; codcontacorrente?: number; valor?: unknown; idsituacao_nf?: number } | undefined;
    if (!a) throw new BusinessRuleError('ADIANTAMENTO_NAO_ENCONTRADO', { codadiantamento: cod });
    // o legado testa o período com a data de HOJE (GetDataHoraServidor), não com a data do registro.
    await assertPeriodoNaoFechado(trx, emp, new Date().toISOString(), this.flagPeriodo());
    if (String(a.quitada ?? 'N') === 'S') throw new BusinessRuleError('ADIANTAMENTO_BAIXADO', { codadiantamento: cod, operacao });
    // VerificaContabilizado: o legado ESTORNA a contabilização quando a empresa é INTEGRACAO='AUTOMATICA'. A
    // integração contábil DO ADIANTAMENTO (TIntegracaoAdiantamento) não está migrada — bloquear é o fail-closed:
    // liberar a edição deixaria o lançamento contábil velho de pé.
    if (String(a.contabilizado ?? '') === 'S') throw new BusinessRuleError('ADIANTAMENTO_CONTABILIZADO', { codadiantamento: cod, operacao });
    // movimento já CONCILIADO com o extrato OFX: conciliacao_bancaria_mov aponta p/ codmovconta SEM FK, e o match
    // é por data+valor — apagar/alterar aqui deixaria a conciliação mentindo (mesmo gate do Controle de Contas).
    if (a.codmovconta != null) {
      const mov = (await trx
        .selectFrom('mov_contas_bancarias')
        .select(['codmovconta', 'mov_conciliado'])
        .where('codmovconta', '=', Number(a.codmovconta))
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst()) as { mov_conciliado?: string } | undefined;
      if (mov && String(mov.mov_conciliado ?? 'N') === 'S') throw new BusinessRuleError('MOVIMENTO_CONCILIADO', { codadiantamento: cod, codmovconta: Number(a.codmovconta), operacao });
    }
    return {
      tipo: String(a.tipo), codmovconta: a.codmovconta == null ? null : Number(a.codmovconta),
      codcontacorrente: Number(a.codcontacorrente), valor: r2(num(a.valor)),
      idsituacao_nf: a.idsituacao_nf == null ? null : Number(a.idsituacao_nf),
    };
  }

  /** EDITAR: parceiro/datas/valor/obs no registro, no movimento e no título. O legado NÃO revalida saldo aqui
   *  (o ValidaSaldoAnterior só roda no insert) e NÃO atualiza o título do tipo 'E' — cópia fiel dos dois. */
  async editar(dto: AdiantamentoEditarDto): Promise<{ codadiantamento: number; tipo: string; titulo_atualizado: boolean }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const atual = await this.paraAlterar(trx, emp, dto.codadiantamento, 'editar');
      // a data NOVA também passa pelo gate de período (fold auditoria [MÉDIA]): senão editar jogaria o registro, o
      // movimento e o título para dentro de um período fechado, contornando o gate da criação.
      await assertPeriodoNaoFechado(trx, emp, dto.dtadiantamento, this.flagPeriodo());
      const { dtchaveamento } = await this.conta(trx, atual.codcontacorrente, emp, true);
      this.assertChaveamento(dtchaveamento, dto.dtadiantamento, atual.codcontacorrente);
      await this.assertParceiro(trx, dto.codparceiro, atual.idsituacao_nf, emp);
      const valor = r2(num(dto.valor));
      await trx
        .updateTable('adiantamento_forn')
        .set({ codparceiro: dto.codparceiro, dtadiantamento: dto.dtadiantamento, dtvencimento: dto.dtvencimento, valor, obs: dto.obs?.trim() ? dto.obs.trim().toUpperCase().slice(0, 255) : null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codadiantamento', '=', dto.codadiantamento)
        .where('idempresa', '=', emp)
        .execute();
      if (atual.codmovconta != null) {
        // o UPDATE do legado (linha 409) mexe em VALOR/DTEMISSAO/DTVENC/DTLIBERACAO e **não** no HISTORICO — é por
        // isso que 6 dos 563 movimentos do golden têm HISTORICO ≠ OBS (a OBS foi editada depois). Cópia fiel: o
        // histórico do movimento é o do lançamento original.
        await trx
          .updateTable('mov_contas_bancarias')
          .set({ valor, data_fechamento: dto.dtadiantamento })
          .where('codmovconta', '=', atual.codmovconta)
          .where('idempresa', '=', emp)
          .execute();
      }
      let titulo_atualizado = false;
      if (atual.tipo === 'D') {
        const r = await trx
          .updateTable('areceber')
          .set({ codparceiro: dto.codparceiro, dtvenda: dto.dtadiantamento, dtvenc: dto.dtvencimento, valor, consiliado: 'S' })
          .where('codadiantamento', '=', dto.codadiantamento)
          .where('codempresa', '=', emp)
          .where('adfornecedor', '=', 'S')
          .where('obs', '=', obsTitulo(dto.codadiantamento))
          .executeTakeFirst();
        titulo_atualizado = Number((r as any)?.numUpdatedRows ?? 0) > 0;
      } else if (atual.tipo === 'C') {
        const r = await trx
          .updateTable('apagar')
          .set({ codparceiro: dto.codparceiro, dtvenda: dto.dtadiantamento, dtvenc: dto.dtvencimento, valor })
          .where('codadiantamento', '=', dto.codadiantamento)
          .where('codempresa', '=', emp)
          .where('adfornecedor', '=', 'S')
          .where('obs', '=', obsTitulo(dto.codadiantamento))
          .executeTakeFirst();
        titulo_atualizado = Number((r as any)?.numUpdatedRows ?? 0) > 0;
      }
      // tipo 'E': o legado não tem ramo de UPDATE (só 'C' e 'D') — o APAGAR fica com os valores antigos.
      return { codadiantamento: dto.codadiantamento, tipo: atual.tipo, titulo_atualizado };
    });
  }

  /** EXCLUIR: apaga o movimento e o título junto com o registro (btnExcluirClick). */
  async excluir(cod: number): Promise<{ codadiantamento: number; movimento_removido: boolean; titulo_removido: boolean }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const atual = await this.paraAlterar(trx, emp, cod, 'excluir');
      let movimento_removido = false;
      if (atual.codmovconta != null) {
        const m = await trx.deleteFrom('mov_contas_bancarias').where('codmovconta', '=', atual.codmovconta).where('idempresa', '=', emp).executeTakeFirst();
        movimento_removido = Number((m as any)?.numDeletedRows ?? 0) > 0;
      }
      // o legado deleta o título por DUPLICATA + OBS LIKE + empresa; aqui: a coluna própria `codadiantamento` MAIS
      // adfornecedor + a mesma OBS (predicado tão estreito quanto o do legado — `codadiantamento` sozinho pegaria
      // os títulos de outros fluxos que o golden mostra com essa coluna preenchida). O tipo 'E' NÃO é tratado no
      // legado — o APAGAR sobrevive à exclusão (bug copiado, provado no smoke).
      let titulo_removido = false;
      if (atual.tipo === 'D' || atual.tipo === 'C') {
        const tabela = atual.tipo === 'D' ? 'areceber' : 'apagar';
        const t = await trx
          .deleteFrom(tabela as any)
          .where('codadiantamento', '=', cod)
          .where('codempresa', '=', emp)
          .where('adfornecedor', '=', 'S')
          .where('obs', '=', obsTitulo(cod))
          .executeTakeFirst();
        titulo_removido = Number((t as any)?.numDeletedRows ?? 0) > 0;
      }
      await trx.deleteFrom('adiantamento_forn').where('codadiantamento', '=', cod).where('idempresa', '=', emp).execute();
      return { codadiantamento: cod, movimento_removido, titulo_removido };
    });
  }

  /**
   * QUITAÇÃO pela baixa do título gerado — `update adiantamento_forn set quitada = 'S'` (UBaixaAreceber.pas:1233 /
   * UBaixaApagar.pas:485) e `'N'` na reversão (UReversaoBaixaContasPagar.pas:65). Chamada pelos serviços de baixa.
   * A reversão de A RECEBER do legado seta 'S' (bug — ver o dossiê §5); aqui as duas reversões devolvem 'N'.
   */
  static async marcarQuitada(trx: AnyDB, emp: number, codadiantamento: unknown, quitada: 'S' | 'N'): Promise<void> {
    if (codadiantamento == null) return;
    await trx
      .updateTable('adiantamento_forn')
      .set({ quitada, dtultimalteracao: sql`now()` })
      .where('codadiantamento', '=', Number(codadiantamento))
      .where('idempresa', '=', emp)
      .execute();
  }
}
