import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { LoteRotativoResumo } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { LiberacaoService } from '../auth/liberacao.service';

type AnyDB = Kysely<any>;

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
}
