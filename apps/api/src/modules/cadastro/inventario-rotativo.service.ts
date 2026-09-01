import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { LoteRotativoResumo } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { LiberacaoService } from '../auth/liberacao.service';
import { estornarVinculoRotativo } from './inventario-rotativo-nf';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * INVENTÁRIO ROTATIVO (`FRMRELINVENTARIOROTATIVO`) — corte-1: o LOTE e seu ciclo. Dossiê:
 * `uRelatorioInventarioRotativo.md`. O alvo com movimento mais recente do tenant (31/07/2026).
 *
 * ⚠️ Duas coisas moldam tudo aqui, e as duas vêm do golden:
 *  1. **uma tabela, dois papéis** — `OPERACAO` 'ABERTO'/'FECHADO' é cabeçalho de lote; 'SUBSTITUIR'/'AUMENTAR' é
 *     movimento coletado;
 *  2. **o estado é uma LINHA NOVA** — fechar INSERE 'FECHADO' ao lado de 'ABERTO'
 *     (uRelatorioInventarioRotativo.pas:227-339), então "aberto" = existe ABERTO e não existe FECHADO.
 */
@Injectable()
export class InventarioRotativoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly liberacao: LiberacaoService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * LISTA os lotes da empresa com o estado DERIVADO (não há coluna de estado): um lote está aberto quando tem
   * linha 'ABERTO' e não tem 'FECHADO'. Traz a contagem de coletas e as NFs de perdas/sobras quando existirem.
   */
  async listarLotes(): Promise<{ itens: LoteRotativoResumo[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      SELECT r.lote,
             max(r.nomelote) FILTER (WHERE r.operacao IN ('ABERTO','FECHADO')) AS nomelote,
             max(r.tipo)     FILTER (WHERE r.operacao IN ('ABERTO','FECHADO')) AS tipo,
             ${emp}::int AS idempresa,
             bool_or(r.operacao = 'ABERTO') AND NOT bool_or(r.operacao = 'FECHADO') AS aberto,
             to_char(min(r.data) FILTER (WHERE r.operacao = 'ABERTO'), 'YYYY-MM-DD HH24:MI') AS abertura,
             to_char(max(r.data) FILTER (WHERE r.operacao = 'FECHADO'), 'YYYY-MM-DD HH24:MI') AS fechamento,
             count(*) FILTER (WHERE r.operacao NOT IN ('ABERTO','FECHADO') OR r.operacao IS NULL) AS coletas,
             max(r.codinv_rotativo) FILTER (WHERE r.operacao = 'ABERTO') AS codinv_rotativo_aberto,
             max(r.codnf_perdas) AS codnf_perdas,
             max(r.codnf_sobras) AS codnf_sobras
        FROM inventario_rotativo r
       WHERE r.idempresa = ${emp} AND r.lote IS NOT NULL
       GROUP BY r.lote
       ORDER BY r.lote DESC
    `.execute(db)).rows as Array<Record<string, unknown>>;
    return {
      itens: rows.map((r) => ({
        lote: r.lote == null ? null : Number(r.lote),
        nomelote: (r.nomelote as string) ?? null,
        tipo: (r.tipo as string) ?? null,
        idempresa: Number(r.idempresa),
        aberto: r.aberto === true,
        abertura: (r.abertura as string) ?? null,
        fechamento: (r.fechamento as string) ?? null,
        coletas: Number(r.coletas ?? 0),
        codinv_rotativo_aberto: r.codinv_rotativo_aberto == null ? null : Number(r.codinv_rotativo_aberto),
        codnf_perdas: r.codnf_perdas == null ? null : Number(r.codnf_perdas),
        codnf_sobras: r.codnf_sobras == null ? null : Number(r.codnf_sobras),
      })),
    };
  }

  /** o histórico do legado (`SetaHistorico`) vive na tabela `LOG` do Oracle, que não existe aqui: mapeado em
   * `historico_dinamico` com `tabela='INVENTARIO_ROTATIVO'`, `chave='LOTE'` e a mensagem em `historico`. */
  private async historico(trx: AnyDB, acao: string, lote: number, msg: string, emp: number, op: number | null): Promise<void> {
    await trx
      .insertInto('historico_dinamico')
      .values({
        tabela: 'INVENTARIO_ROTATIVO', chave: 'LOTE', valor_chave: String(lote),
        campo: 'OPERACAO', valor_atual: acao.slice(0, 20),
        historico: msg.slice(0, 500), origem: 'FRMRELINVENTARIOROTATIVO',
        codoperador: op, codempresa: emp, data: sql`now()`,
      })
      .execute();
  }

  /**
   * ABRIR LOTE (`UFrmLoteInventarioRotativo.pas:156-247`): `nomelote` obrigatório, `OPERACAO='ABERTO'`, número de
   * lote da sequência própria, filtros NULL quando vazios (no golden nunca são 0, apesar do `StrToIntDef(...,0)`
   * do fonte) e N departamentos. Grava histórico "Abertura do lote X realizada pelo operador Y". Transacional.
   */
  async criarLote(dto: Record<string, any>): Promise<{ codinv_rotativo: number; lote: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const lote = Number(((await sql<{ n: number }>`SELECT nextval('seq_lote_inv_rotativo') AS n`.execute(trx)).rows[0] as any).n);
      const cab = (await trx
        .insertInto('inventario_rotativo')
        .values({
          idempresa: emp, lote, nomelote: dto.nomelote, operacao: 'ABERTO', tipo: dto.tipo ?? 'R',
          data: sql`now()`, operador: op,
          codgrupo: dto.codgrupo ?? null, codsubgrupo: dto.codsubgrupo ?? null,
          codsecao: dto.codsecao ?? null, codforn: dto.codforn ?? null,
          exigeconfirmacao: dto.exigeconfirmacao ?? null,
          almoxarifado_padrao: dto.almoxarifado_padrao ?? null,
          produtoinativo: dto.produtoinativo ?? null, busca_inativo: dto.busca_inativo ?? null,
        })
        .returning('codinv_rotativo')
        .executeTakeFirstOrThrow()) as { codinv_rotativo: number };

      const dptos: number[] = Array.from(new Set<number>(dto.departamentos ?? []));
      if (dptos.length) {
        await trx
          .insertInto('inventario_rotativo_dpto')
          .values(dptos.map((coddpto) => ({ codinv_rotativo: cab.codinv_rotativo, coddpto })))
          .execute();
      }
      await this.historico(trx, 'Abertura', lote, `Abertura do lote ${lote} realizada pelo operador ${op ?? '?'}.`, emp, op);
      return { codinv_rotativo: Number(cab.codinv_rotativo), lote };
    });
  }

  /**
   * ALTERAR o lote aberto. Fiel ao legado: regrava só o **cabeçalho** (`TDB.Alterar`) — a lista de departamentos
   * NÃO é recriada na alteração (quirk registrado no dossiê). Só a linha 'ABERTO' do lote é alterável.
   */
  async alterarLote(codinv: number, dto: Record<string, any>): Promise<{ codinv_rotativo: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const atual = (await trx
        .selectFrom('inventario_rotativo')
        .select(['codinv_rotativo', 'lote', 'operacao'])
        .where('codinv_rotativo', '=', codinv)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as { codinv_rotativo: number; lote: number | null; operacao: string } | undefined;
      if (!atual) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { codinv_rotativo: codinv });
      if (atual.operacao !== 'ABERTO') throw new BusinessRuleError('LOTE_NAO_ABERTO', { operacao: atual.operacao });

      const set: Record<string, unknown> = {};
      for (const k of ['nomelote', 'tipo', 'codgrupo', 'codsubgrupo', 'codsecao', 'codforn', 'exigeconfirmacao', 'almoxarifado_padrao', 'produtoinativo', 'busca_inativo']) {
        if (dto[k] !== undefined) set[k] = dto[k];
      }
      if (Object.keys(set).length) {
        await trx.updateTable('inventario_rotativo').set(set).where('codinv_rotativo', '=', codinv).where('idempresa', '=', emp).execute();
      }
      return { codinv_rotativo: codinv };
    });
  }

  /**
   * FECHAR (`btnFecharInventarioClick`): dois caminhos, na ordem do legado.
   *  - **sem lote**: número novo + linha 'FECHADO' + carimbo das coletas órfãs da empresa
   *    (`UPDATE … WHERE LOTE IS NULL AND IDEMPRESA = emp`). No legado esse ramo roda **sem transação**; aqui vai
   *    dentro dela — divergência consciente (registrada no dossiê): não faz sentido deixar a linha 'FECHADO' órfã.
   *  - **com lote**: linha 'FECHADO' copiando `nomelote` e os filtros do 'ABERTO' + réplica dos departamentos.
   * O legado NÃO impede fechar duas vezes (criaria duas linhas 'FECHADO'); mantemos o comportamento e devolvemos
   * `ja_fechado` para a tela avisar.
   */
  async fecharLote(dto: { lote?: number }): Promise<{ lote: number; codinv_rotativo: number; coletas_carimbadas: number; ja_fechado: boolean; departamentos: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      if (!dto.lote) {
        const lote = Number(((await sql<{ n: number }>`SELECT nextval('seq_lote_inv_rotativo') AS n`.execute(trx)).rows[0] as any).n);
        const cab = (await trx
          .insertInto('inventario_rotativo')
          .values({ idempresa: emp, lote, operacao: 'FECHADO', data: sql`now()`, operador: op })
          .returning('codinv_rotativo')
          .executeTakeFirstOrThrow()) as { codinv_rotativo: number };
        const upd = await trx
          .updateTable('inventario_rotativo')
          .set({ lote })
          .where('lote', 'is', null)
          .where('idempresa', '=', emp)
          .where('codinv_rotativo', '<>', cab.codinv_rotativo)
          .executeTakeFirst();
        await this.historico(trx, 'Fechamento', lote, `Fechamento do lote ${lote} realizado pelo operador ${op ?? '?'}.`, emp, op);
        return { lote, codinv_rotativo: Number(cab.codinv_rotativo), coletas_carimbadas: Number((upd as any)?.numUpdatedRows ?? 0), ja_fechado: false, departamentos: 0 };
      }

      const aberto = (await trx
        .selectFrom('inventario_rotativo')
        .select(['codinv_rotativo', 'nomelote', 'tipo', 'codgrupo', 'codsubgrupo', 'codsecao'])
        .where('lote', '=', dto.lote)
        .where('idempresa', '=', emp)
        .where('operacao', '=', 'ABERTO')
        .orderBy('codinv_rotativo', 'desc')
        .executeTakeFirst()) as Record<string, any> | undefined;
      if (!aberto) throw new BusinessRuleError('LOTE_SEM_ABERTURA', { lote: dto.lote });
      const jaFechado = !!(await trx
        .selectFrom('inventario_rotativo')
        .select('codinv_rotativo')
        .where('lote', '=', dto.lote)
        .where('idempresa', '=', emp)
        .where('operacao', '=', 'FECHADO')
        .executeTakeFirst());

      const cab = (await trx
        .insertInto('inventario_rotativo')
        .values({
          idempresa: emp, lote: dto.lote, operacao: 'FECHADO', data: sql`now()`, operador: op,
          nomelote: aberto.nomelote ?? null, tipo: aberto.tipo ?? null,
          // o legado só copia grupo/subgrupo/seção quando > 0 (uRelatorioInventarioRotativo.pas:294-299)
          codgrupo: aberto.codgrupo ?? null, codsubgrupo: aberto.codsubgrupo ?? null, codsecao: aberto.codsecao ?? null,
        })
        .returning('codinv_rotativo')
        .executeTakeFirstOrThrow()) as { codinv_rotativo: number };

      // réplica dos departamentos do ABERTO para a nova linha (`getDepartamentos`, linha 305)
      const dptos = (await trx
        .selectFrom('inventario_rotativo_dpto')
        .select('coddpto')
        .where('codinv_rotativo', '=', aberto.codinv_rotativo)
        .execute()) as Array<{ coddpto: number }>;
      if (dptos.length) {
        await trx
          .insertInto('inventario_rotativo_dpto')
          .values(dptos.map((d) => ({ codinv_rotativo: cab.codinv_rotativo, coddpto: Number(d.coddpto) })))
          .execute();
      }
      await this.historico(trx, 'Fechamento', dto.lote, `Fechamento do lote ${dto.lote} realizado pelo operador ${op ?? '?'}.`, emp, op);
      return { lote: dto.lote, codinv_rotativo: Number(cab.codinv_rotativo), coletas_carimbadas: 0, ja_fechado: jaFechado, departamentos: dptos.length };
    });
  }

  /**
   * ZERAR ESTOQUE pela grade (uInvRotativoGrid.pas:146-292 + `ZeraEstoque`:381-446) — a parte de DINHEIRO do
   * épico. Gates, na ordem do legado: (1) "Informe quais estoques serão zerados." (loja e/ou depósito, validado no
   * schema); (2) **liberação por login** contra a lista da config `USUARIOS_ZERAM_ESTOQUE_INVENTARIO` — no golden
   * a lista está VAZIA, então sem grant ninguém zera. Depois, por produto × bucket, os TRÊS fatos do legado:
   * zera o saldo, grava a coleta (`SUBSTITUIR` + `QTD_ANTERIOR`) e grava o ajuste (`CODMOTIVO=999`, `ORIGEM='I'`,
   * `IDORIGEM` = a coleta, `OPERACAO` invertida quando o saldo era negativo). Tudo em UMA transação.
   */
  async zerarEstoque(dto: {
    idprodutos: number[]; loja?: boolean; deposito?: boolean; lote?: number; login: string; senha: string;
  }): Promise<{ zerados: number; ajustes: number; coletas: number; liberado_por: number | null }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const lib = await this.liberacao.validar({
      codigo: 'USUARIOS_ZERAM_ESTOQUE_INVENTARIO',
      login: dto.login,
      senha: dto.senha,
      liberacao: 'Zerar estoque pelo inventário rotativo',
    });
    if (!lib.liberado) throw new BusinessRuleError('LIBERACAO_NEGADA', { codigo: 'USUARIOS_ZERAM_ESTOQUE_INVENTARIO' });

    const buckets: Array<{ tabela: 'estoque' | 'estoque_dep'; destinoColeta: string; destinoAjuste: string }> = [];
    if (dto.loja) buckets.push({ tabela: 'estoque', destinoColeta: 'LOJA', destinoAjuste: 'ESTOQUE' });
    if (dto.deposito) buckets.push({ tabela: 'estoque_dep', destinoColeta: 'DEPOSITO', destinoAjuste: 'DEPOSITO' });

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      let zerados = 0;
      let ajustes = 0;
      let coletas = 0;
      for (const idproduto of Array.from(new Set(dto.idprodutos))) {
        for (const b of buckets) {
          const saldo = (await trx
            .selectFrom(b.tabela as any)
            .select(sql<number>`coalesce(qtde,0)`.as('q'))
            .where('idproduto', '=', idproduto)
            .where('idempresa', '=', emp)
            .forUpdate()
            .executeTakeFirst()) as { q: unknown } | undefined;
          // o legado só entra no ZeraEstoque para produto que veio da grade (JOIN ESTOQUE) — sem linha, não há o
          // que zerar nem que auditar.
          if (!saldo) continue;
          const anterior = Number(saldo.q ?? 0);

          await trx.updateTable(b.tabela as any).set({ qtde: 0 }).where('idproduto', '=', idproduto).where('idempresa', '=', emp).execute();
          zerados++;

          const coleta = (await trx
            .insertInto('inventario_rotativo')
            .values({
              idempresa: emp, idproduto, operacao: 'SUBSTITUIR', destino: b.destinoColeta,
              qtd_anterior: anterior, qtd_atual: 0, qtd_coletada: 0,
              data: sql`now()`, operador: op, lote: dto.lote ?? null,
            })
            .returning('codinv_rotativo')
            .executeTakeFirstOrThrow()) as { codinv_rotativo: number };
          coletas++;

          await trx
            .insertInto('ajuste_estoque')
            .values({
              idproduto, idempresa: emp,
              // saldo negativo virando zero é AUMENTO de estoque (uInvRotativoGrid.pas:431)
              operacao: anterior < 0 ? 'AUMENTAR' : 'DIMINUIR',
              destino: b.destinoAjuste,
              qtde: Math.abs(anterior),
              qtdeanterior: anterior, qtdeatual: 0,
              codmotivo: 999, codoperador: op ?? lib.codOperador ?? 0,
              origem: 'I', idorigem: Number(coleta.codinv_rotativo),
              codoperador_liberacao: lib.codOperador ?? null,
              dtcadastro: sql`now()`,
            })
            .execute();
          ajustes++;
        }
      }
      return { zerados, ajustes, coletas, liberado_por: lib.codOperador ?? null };
    });
  }
  // ==========================================================================================================
  // CORTE-3 — AS DUAS PONTES DE DINHEIRO: a NF de PERDAS e a NF de SOBRAS.
  //
  // O ciclo não fecha nesta tela: quem gera a nota é a tela de NF (`uNF.pas:12747` perdas / `:12901` sobras),
  // e é ela que carimba de volta (`uNF.pas:5267` e `:5280`). Aqui ficam as três metades que são REGRA:
  // o cálculo da diferença por produto, o gate anti-reimporte e o carimbo/estorno.
  // ==========================================================================================================

  /**
   * A DIFERENÇA por produto do lote — a `sqqInventarioRotativo` do legado (`udmNF.dfm:19003-19086`), que é
   * bem menos óbvia do que "contado − sistema":
   *   QTD_ANT   = `qtd_anterior` da coleta de MENOR id com operação 'SUBSTITUIR';
   *   QTD_ATUAL = `qtd_atual`    da coleta de MAIOR id com operação em ('SUBSTITUIR','AUMENTAR');
   *   QTD_DIFERENCA = QTD_ATUAL − QTD_ANT   → negativo é PERDA, positivo é SOBRA.
   * O drive são as linhas de COLETA (`operacao <> 'FECHADO'`) com INNER JOIN em produtos.
   *
   * ⚠️ QUIRK COPIADO: o `GROUP BY` do legado inclui `TRUNC(I.DATA)` sem selecioná-la, então um produto coletado
   * em DOIS DIAS no mesmo lote rende DUAS linhas — e como as subconsultas de QTD_ANT/QTD_ATUAL não filtram por
   * data, as duas linhas trazem a MESMA diferença. Na inclusão do item o legado soma por produto, então a
   * quantidade sai dobrada. É dinheiro, então fica fiel e a resposta devolve `linhas_duplicadas` para a tela
   * poder avisar.
   * ⚠️ FOLD DE SEGURANÇA (divergência consciente): as subconsultas do legado não filtram `IDEMPRESA` — como o
   * `lote` é sequência por empresa, dois tenants com o mesmo número de lote se contaminariam. Aqui elas filtram
   * (lição de reflexo: efeito de estoque/dinheiro é cross-tenant até prova em contrário).
   */
  private async diferencasDoLote(db: AnyDB, lote: number, emp: number): Promise<Array<Record<string, unknown>>> {
    return (await sql<Record<string, unknown>>`
      WITH coleta AS (
        SELECT i.lote, i.nomelote, i.idproduto, p.descricao, p.codbarra, i.idempresa, i.destino
          FROM inventario_rotativo i
          JOIN produtos p ON p.idproduto = i.idproduto
         WHERE i.operacao <> 'FECHADO' AND i.lote = ${lote} AND i.idempresa = ${emp}
         GROUP BY i.lote, i.nomelote, date_trunc('day', i.data), i.idempresa, i.idproduto,
                  p.descricao, p.codbarra, i.destino
      )
      SELECT c.lote, c.nomelote, c.idproduto, c.descricao, c.codbarra, c.idempresa, c.destino,
             qa.qtd_anterior AS qtd_ant,
             qb.qtd_atual    AS qtd_atual,
             coalesce(qb.qtd_atual,0) - coalesce(qa.qtd_anterior,0) AS qtd_diferenca,
             m.vrcusto, m.vrvenda, p.aliquota, p.unidade, p.ncmsh, p.cest
        FROM coleta c
        LEFT JOIN LATERAL (
          SELECT ii.qtd_anterior FROM inventario_rotativo ii
           WHERE ii.codinv_rotativo = (SELECT min(iii.codinv_rotativo) FROM inventario_rotativo iii
                                        WHERE iii.idproduto = c.idproduto AND iii.lote = c.lote
                                          AND iii.idempresa = c.idempresa AND iii.operacao = 'SUBSTITUIR')
        ) qa ON true
        LEFT JOIN LATERAL (
          SELECT ii.qtd_atual FROM inventario_rotativo ii
           WHERE ii.codinv_rotativo = (SELECT max(iii.codinv_rotativo) FROM inventario_rotativo iii
                                        WHERE iii.idproduto = c.idproduto AND iii.lote = c.lote
                                          AND iii.idempresa = c.idempresa
                                          AND iii.operacao IN ('SUBSTITUIR','AUMENTAR'))
        ) qb ON true
        LEFT JOIN multi_preco m ON m.idproduto = c.idproduto AND m.idempresa = c.idempresa
        LEFT JOIN produtos p ON p.idproduto = c.idproduto
       ORDER BY c.descricao
    `.execute(db)).rows;
  }

  /**
   * ITENS PARA A NF — a prévia. Recebe os lotes escolhidos e o lado (PERDAS usa `qtd_diferenca < 0`, SOBRAS usa
   * `> 0`, `uNF.pas:12846` e `:13000`) e devolve os itens já agregados por produto, o CFOP e a observação da
   * nota. **Não grava nada**: no legado os itens entram no dataset em memória e só o `btnGravar` persiste.
   *
   * O que é fiel, item a item (`IncluirProdutoInventarioRotativoPerdas`, `uNF.pas:14155`):
   *  · quantidade = |QTD_DIFERENCA| e custo = `MULTI_PRECO.VRCUSTO`;
   *  · produto REPETIDO entre lotes é UMA linha: soma quantidade e total, e o custo vira a MÉDIA PONDERADA
   *    (`total / quantidade`, `:14174`);
   *  · alíquota do PRODUTO, e vazia vira `'0'` (`:14213`);
   *  · `fatorembal` 1 (`:14225`);
   *  · **o CFOP do ITEM é fixo** — 5927 nas perdas e 1949 nas sobras (`:14189`, `:14284`) — mesmo quando o da
   *    NOTA é interestadual (6927/2949). É quirk do legado e está copiado: mexer nisso muda escrituração.
   *
   * O gate anti-reimporte (`uNF.pas:12832`) roda aqui também, e é POR LOTE: o lote já importado é PULADO com
   * aviso, os outros seguem — o legado não aborta a importação inteira.
   */
  async itensParaNf(dto: { lotes: number[]; tipo: 'PERDAS' | 'SOBRAS'; uf_destino?: string }): Promise<{
    tipo: string; cfop_nota: number; cfop_item: number; observacao: string;
    lotes_aceitos: number[]; lotes_recusados: Array<{ lote: number; motivo: string; codnf?: number | null }>;
    itens: Array<Record<string, unknown>>; linhas_duplicadas: number;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const perdas = dto.tipo === 'PERDAS';

    const ufEmp = ((await db.selectFrom('empresas').select('uf').where('idempresa', '=', emp).executeTakeFirst()) as { uf?: string } | undefined)?.uf ?? null;
    // CFOP da NOTA: dentro do estado × fora (uNF.pas:12804-12807 perdas · :12958-12961 sobras). Sem UF de
    // destino informada assume-se a própria (o legado compara com a UF do titular já carregado na nota).
    const dentro = !dto.uf_destino || !ufEmp || dto.uf_destino === ufEmp;
    const cfopNota = perdas ? (dentro ? 5927 : 6927) : (dentro ? 1949 : 2949);
    const cfopItem = perdas ? 5927 : 1949;

    const aceitos: number[] = [];
    const recusados: Array<{ lote: number; motivo: string; codnf?: number | null }> = [];
    const acc = new Map<number, { idproduto: number; descricao: string | null; unidade: string | null; codbarra: string | null; ncmsh: string | null; cest: string | null; aliquota: string; quantidade: number; total_prod: number; vrcusto: number }>();
    let duplicadas = 0;

    for (const lote of Array.from(new Set(dto.lotes))) {
      // o carimbo mora na linha FECHADO do lote (uNF.pas:5268) — é ela que diz se já foi importado.
      const fechado = (await db
        .selectFrom('inventario_rotativo')
        .select(['codinv_rotativo', 'importado_perdas', 'codnf_perdas', 'importado_sobras', 'codnf_sobras'])
        .where('lote', '=', lote).where('idempresa', '=', emp).where('operacao', '=', 'FECHADO')
        .orderBy('codinv_rotativo', 'desc')
        .executeTakeFirst()) as Record<string, any> | undefined;
      if (!fechado) { recusados.push({ lote, motivo: 'LOTE_NAO_FECHADO' }); continue; }
      const jaImportado = perdas ? fechado.importado_perdas === 'S' : fechado.importado_sobras === 'S';
      if (jaImportado) {
        recusados.push({ lote, motivo: 'JA_IMPORTADO', codnf: perdas ? fechado.codnf_perdas : fechado.codnf_sobras });
        continue;
      }

      const linhas = await this.diferencasDoLote(db, lote, emp);
      const doLado = linhas.filter((l) => (perdas ? Number(l.qtd_diferenca) < 0 : Number(l.qtd_diferenca) > 0));
      if (!doLado.length) { recusados.push({ lote, motivo: perdas ? 'SEM_PERDAS' : 'SEM_SOBRAS' }); continue; }
      // quirk do GROUP BY por dia: o mesmo produto aparecendo 2× no lote é contado 2× (ver diferencasDoLote)
      duplicadas += doLado.length - new Set(doLado.map((l) => Number(l.idproduto))).size;

      for (const l of doLado) {
        const idproduto = Number(l.idproduto);
        const qtde = Math.abs(Number(l.qtd_diferenca));
        const custo = Number(l.vrcusto ?? 0);
        const ant = acc.get(idproduto);
        if (ant) {
          ant.quantidade = r3(ant.quantidade + qtde);
          ant.total_prod = r2(ant.total_prod + custo * qtde);
          ant.vrcusto = ant.quantidade ? r3(ant.total_prod / ant.quantidade) : custo; // média ponderada (:14174)
        } else {
          acc.set(idproduto, {
            idproduto, descricao: (l.descricao as string) ?? null, unidade: (l.unidade as string) ?? null,
            codbarra: (l.codbarra as string) ?? null, ncmsh: (l.ncmsh as string) ?? null, cest: (l.cest as string) ?? null,
            aliquota: String(l.aliquota ?? '') || '0', // vazia vira '0' (:14213)
            quantidade: r3(qtde), total_prod: r2(custo * qtde), vrcusto: custo,
          });
        }
      }
      aceitos.push(lote);
    }

    // os campos fiscais (base, ICMS, CST, BCR) saem da tributação por UF, como o legado faz com `cdsAliquota`
    // aberta por UF (`uNF.pas:14216-14226`). O VALOR do imposto continua sendo do motor da NF: aqui vão os
    // parâmetros, não o cálculo — duplicar o CalcValorNota seria criar uma segunda verdade.
    const itens: Array<Record<string, unknown>> = [];
    let nroitem = 0;
    for (const it of acc.values()) {
      const trib = ufEmp
        ? ((await db.selectFrom('det_aliquota').select(['icm', 'icm_efetivo', 'base', 'cst'])
            .where('aliquota', '=', it.aliquota).where('uf', '=', ufEmp).executeTakeFirst()) as Record<string, any> | undefined)
        : undefined;
      nroitem += 1;
      itens.push({
        nroitem, codproduto: it.idproduto, descricao: it.descricao, unidade: it.unidade, codbarra: it.codbarra,
        ncmsh: it.ncmsh, cest: it.cest, aliquota: it.aliquota, cfop: cfopItem, fatorembal: 1,
        quantidade: it.quantidade, vrcusto: it.vrcusto, total_prod: it.total_prod,
        icms: trib?.icm ?? null, icme: trib?.icm_efetivo ?? null, bcr: trib?.base ?? null, cst: trib?.cst ?? null,
      });
    }

    return {
      tipo: dto.tipo, cfop_nota: cfopNota, cfop_item: cfopItem,
      // a observação é literal do legado (uNF.pas:12886 / :13037)
      observacao: `Nota fiscal referente a inventário rotativo (${perdas ? 'perdas' : 'sobras'}), Lotes: ${aceitos.join(',')}`,
      lotes_aceitos: aceitos, lotes_recusados: recusados, itens, linhas_duplicadas: duplicadas,
    };
  }

  /**
   * CARIMBA a NF nos lotes — o `UPDATE INVENTARIO_ROTATIVO SET IMPORTADO_x='S', CODNF_x=<codnf> WHERE
   * CODINV_ROTATIVO=… AND OPERACAO='FECHADO'` que o legado dispara ao gravar a nota (`uNF.pas:5267`/`:5280`).
   * Aqui é transacional e re-checa o gate DENTRO da transação: entre a prévia e o gravar outra sessão pode ter
   * importado o mesmo lote (o legado, que carimba fora de transação, tem essa corrida em aberto).
   */
  async vincularNf(dto: { codnf: number; lotes: number[]; tipo: 'PERDAS' | 'SOBRAS' }): Promise<{
    codnf: number; carimbados: number[]; recusados: Array<{ lote: number; motivo: string; codnf?: number | null }>;
  }> {
    const emp = this.emp();
    const perdas = dto.tipo === 'PERDAS';
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = (await trx.selectFrom('nf').select(['codnf', 'tipo', 'cancelada'])
        .where('codnf', '=', dto.codnf).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, any> | undefined;
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf: dto.codnf });
      if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf: dto.codnf });
      // o estorno do legado escolhe o lado pelo TIPO da nota (udmNF.pas:3414) — perdas é saída, sobras é
      // entrada. Vincular ao contrário deixaria um carimbo que o estorno nunca desfaria.
      const tipoEsperado = perdas ? 'S' : 'E';
      if (nf.tipo !== tipoEsperado) throw new BusinessRuleError('NF_TIPO_INCOMPATIVEL', { codnf: dto.codnf, tipo: nf.tipo, esperado: tipoEsperado });

      const carimbados: number[] = [];
      const recusados: Array<{ lote: number; motivo: string; codnf?: number | null }> = [];
      for (const lote of Array.from(new Set(dto.lotes))) {
        const fechado = (await trx.selectFrom('inventario_rotativo')
          .select(['codinv_rotativo', 'importado_perdas', 'codnf_perdas', 'importado_sobras', 'codnf_sobras'])
          .where('lote', '=', lote).where('idempresa', '=', emp).where('operacao', '=', 'FECHADO')
          .orderBy('codinv_rotativo', 'desc').forUpdate().executeTakeFirst()) as Record<string, any> | undefined;
        if (!fechado) { recusados.push({ lote, motivo: 'LOTE_NAO_FECHADO' }); continue; }
        if (perdas ? fechado.importado_perdas === 'S' : fechado.importado_sobras === 'S') {
          recusados.push({ lote, motivo: 'JA_IMPORTADO', codnf: perdas ? fechado.codnf_perdas : fechado.codnf_sobras });
          continue;
        }
        await trx.updateTable('inventario_rotativo')
          .set(perdas ? { importado_perdas: 'S', codnf_perdas: dto.codnf } : { importado_sobras: 'S', codnf_sobras: dto.codnf })
          .where('codinv_rotativo', '=', Number(fechado.codinv_rotativo))
          .where('operacao', '=', 'FECHADO')
          .execute();
        carimbados.push(lote);
      }
      return { codnf: dto.codnf, carimbados, recusados };
    });
  }

  /**
   * ESTORNA o carimbo quando a NF é cancelada ou excluída. A regra mora em `inventario-rotativo-nf.ts` porque
   * tem dois chamadores (o cancelamento da NF-e e a exclusão do agregado) e não pode divergir entre eles.
   */
  async estornarVinculo(trx: AnyDB, codnf: number, tipoNf: string | null, emp: number): Promise<number> {
    return estornarVinculoRotativo(trx, codnf, tipoNf, emp);
  }
}
