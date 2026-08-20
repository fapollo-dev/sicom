import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { BalancoResumo } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * BALANÇO do inventário (`BALANCO`/`BALANCOITENS`) — a "foto" de estoque do legado e os dois comandos do popup de
 * `FRMINVENTARIO` que a produzem e a consomem. Dossiê: `uInventario-balanco.md`.
 *
 *  - **Gerar Balanço a partir do Inventário** (`GerarBalanco1Click`, uInventario.pas:1218-1299): a contagem vira
 *    foto. Chave consultada = (DATA, CODEMPRESA); com foto existente o legado pergunta "deseja substituir?" e
 *    então só ATUALIZA a qtde dos produtos que já estão na foto (produto novo NÃO é inserido).
 *  - **Importar Balanço** (`ImportaBalancoInserindo`, uInventario.pas:1343-1483): o balanço entra como LISTA DE
 *    PRODUTOS e a quantidade vem do ESTOQUE DE HOJE (`estoque.qtde + estoque_dep.qtde`), com custo/preço de
 *    `multi_preco` da empresa da foto (INNER — produto sem preço na empresa fica fora do inventário).
 */
@Injectable()
export class BalancoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o livro do inventário (fail-closed no tenant) — devolve a data, que é a chave do balanço. */
  private async livro(db: AnyDB, codinvent: number, emp: number): Promise<{ codinvent: number; data: string }> {
    const l = (await db
      .selectFrom('inventario_livro')
      .select(['codinvent', sql<string>`to_char(dtinventario,'YYYY-MM-DD')`.as('data')])
      .where('codinvent', '=', codinvent)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codinvent: number; data: string } | undefined;
    if (!l) throw new BusinessRuleError('INVENTARIO_NAO_ENCONTRADO', { codinvent });
    return l;
  }

  /**
   * LISTA (o lookup `GET_BALANCO` do legado, filtrado por empresa como no call site —
   * uInventario.pas:623-625). Ordem: mais recente primeiro. `ativo` NULL = ativo (fiel a `sqqDataBalanco`).
   */
  async listar(): Promise<{ itens: BalancoResumo[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await db
      .selectFrom('balanco as b')
      .select([
        'b.codbalanco as codbalanco',
        'b.descricao as descricao',
        sql<string>`to_char(b.data,'YYYY-MM-DD')`.as('data'),
        'b.codempresa as idempresa',
        sql<number>`(select count(*) from balancoitens i where i.codbalanco = b.codbalanco)`.as('itens'),
      ])
      .where('b.codempresa', '=', emp)
      .where(sql`coalesce(b.ativo,'S')`, '=', 'S') // NULL = ativo
      .orderBy('b.data', 'desc')
      .orderBy('b.codbalanco', 'desc')
      .execute()) as Array<{ codbalanco: number; descricao: string | null; data: string; idempresa: number; itens: unknown }>;
    return { itens: rows.map((r) => ({ ...r, itens: Number(r.itens ?? 0) })) };
  }

  /**
   * GERAR BALANÇO A PARTIR DO INVENTÁRIO. Fiel ao legado:
   *  - a data é a do livro (`edtDataInventario`), a empresa é a da sessão;
   *  - **existindo** foto nessa data (o legado percorre TODAS as fotos da data, não só a primeira): pede o
   *    "substituir" e então atualiza a QTDE só dos produtos que já estão na foto — produto novo não entra;
   *  - **não existindo**: cria o cabeçalho com `GERACAO DE INVENTARIO DATA: dd/mm/aaaa` + um item por linha da
   *    folha (as linhas `TIPO='T'` ficam fora, como na consulta do grid).
   */
  async gerarDoInventario(
    codinvent: number,
    dto: { substituir?: boolean; descricao?: string },
  ): Promise<{ codbalanco: number | null; modo: 'criado' | 'atualizado'; itens: number; balancos: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const l = await this.livro(trx, codinvent, emp);

      const folha = (await trx
        .selectFrom('inventario')
        .select(['idproduto', 'qtde', 'codbarra', 'descricao'])
        .where('codinvent', '=', codinvent)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(tipo,'P')`, '<>', 'T')
        .orderBy('sequencia')
        .execute()) as Array<{ idproduto: number; qtde: unknown; codbarra: string | null; descricao: string | null }>;
      if (!folha.length) throw new BusinessRuleError('INVENTARIO_SEM_ITENS', { codinvent });

      const existentes = (await trx
        .selectFrom('balanco')
        .select('codbalanco')
        .where('data', '=', sql`${l.data}::date`)
        .where('codempresa', '=', emp)
        .forUpdate()
        .execute()) as Array<{ codbalanco: number }>;

      if (existentes.length) {
        // "Existe um balanço lançado para essa data, deseja substituir?" (default NO no legado).
        if (!dto.substituir) throw new BusinessRuleError('BALANCO_EXISTE_NA_DATA', { data: l.data, balancos: existentes.length });
        const cods = existentes.map((b) => b.codbalanco);
        // o legado faz laço item×foto; aqui é um UPDATE ... FROM (mesmo efeito, sem 43 mil round-trips por foto):
        // só linhas que JÁ existem na foto são tocadas — produto novo não entra (o quirk do "substituir" parcial).
        const upd = await sql`
          UPDATE balancoitens bi
             SET qtde = i.qtde
            FROM inventario i
           WHERE i.codinvent = ${codinvent} AND i.idempresa = ${emp} AND coalesce(i.tipo,'P') <> 'T'
             AND bi.codbalanco IN (${sql.join(cods)}) AND bi.idproduto = i.idproduto
        `.execute(trx);
        const atualizados = Number((upd as any)?.numAffectedRows ?? 0);
        await trx
          .updateTable('balanco')
          .set({ usultalteracao: op, dtultimalteracao: sql`now()` })
          .where('codbalanco', 'in', cods)
          .execute();
        // produto que não está na foto NÃO é inserido (quirk do legado: o "substituir" é parcial).
        return { codbalanco: existentes[existentes.length - 1].codbalanco, modo: 'atualizado', itens: atualizados, balancos: existentes.length };
      }

      const [d, m, y] = [l.data.slice(8, 10), l.data.slice(5, 7), l.data.slice(0, 4)];
      const descricao = dto.descricao ?? `GERACAO DE INVENTARIO DATA: ${d}/${m}/${y}`;
      const cab = (await trx
        .insertInto('balanco')
        .values({ descricao, data: sql`${l.data}::date`, codoperador: op, codempresa: emp, usultalteracao: op, dtcadastro: sql`now()` })
        .returning('codbalanco')
        .executeTakeFirstOrThrow()) as { codbalanco: number };

      for (let i = 0; i < folha.length; i += 1000) {
        const lote = folha.slice(i, i + 1000);
        if (!lote.length) continue;
        await trx
          .insertInto('balancoitens')
          .values(lote.map((it) => ({ codbalanco: cab.codbalanco, codempresa: emp, idproduto: it.idproduto, qtde: num(it.qtde) })))
          .execute();
      }
      return { codbalanco: cab.codbalanco, modo: 'criado', itens: folha.length, balancos: 0 };
    });
  }

  /**
   * IMPORTAR BALANÇO para a folha de contagem. **A quantidade NÃO vem do balanço** (uInventario.pas:1347-1358):
   * o balanço só diz QUAIS produtos entram; a qtde é `estoque.qtde + estoque_dep.qtde` de hoje, e o custo sai de
   * `multi_preco` da empresa da foto — `VRCUSTOFISCAL` (com fallback p/ `VRCUSTO`) quando a config
   * `VRCUSTO_INVENTARIO` = 'FISCAL'. `qtde`, `estoque_qtd` e `qtde_ist` do legado recebem o MESMO valor; aqui só
   * temos `qtde` (a folha não guarda as outras duas), e a diferença do grid continua calculada ao vivo.
   */
  async importarBalanco(codinvent: number, dto: { codbalanco: number; confirmar?: boolean }): Promise<{ codinvent: number; codbalanco: number; itens: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const custoFiscal = (await this.config.resolver('VRCUSTO_INVENTARIO', { empresaId: emp })) === 'FISCAL';
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.livro(trx, codinvent, emp);

      const bal = (await trx
        .selectFrom('balanco')
        .select(['codbalanco', 'codempresa'])
        .where('codbalanco', '=', dto.codbalanco)
        .where('codempresa', '=', emp) // fiel ao lookup: só balanço da empresa
        .where(sql`coalesce(ativo,'S')`, '=', 'S')
        .executeTakeFirst()) as { codbalanco: number; codempresa: number } | undefined;
      if (!bal) throw new BusinessRuleError('BALANCO_NAO_ENCONTRADO', { codbalanco: dto.codbalanco });

      // "O inventário atual será excluído. Deseja continuar?" (uInventario.pas:616) — e o DELETE da linha 1378.
      const atual = (await trx
        .selectFrom('inventario')
        .select(sql<number>`count(*)`.as('n'))
        .where('codinvent', '=', codinvent)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as { n: unknown } | undefined;
      if (Number(atual?.n ?? 0) > 0 && !dto.confirmar) throw new BusinessRuleError('INVENTARIO_SERA_EXCLUIDO', { codinvent, itens: Number(atual?.n ?? 0) });
      await trx.deleteFrom('inventario').where('codinvent', '=', codinvent).where('idempresa', '=', emp).execute();

      const prods = (await trx
        .selectFrom('balancoitens as bi')
        .innerJoin('produtos as p', 'p.idproduto', 'bi.idproduto')
        .innerJoin('multi_preco as mp', (j: any) => j.onRef('mp.idproduto', '=', 'p.idproduto').on('mp.idempresa', '=', bal.codempresa))
        .leftJoin('estoque as e', (j: any) => j.onRef('e.idproduto', '=', 'mp.idproduto').onRef('e.idempresa', '=', 'mp.idempresa'))
        .leftJoin('estoque_dep as d', (j: any) => j.onRef('d.idproduto', '=', 'mp.idproduto').onRef('d.idempresa', '=', 'mp.idempresa'))
        .select([
          'p.idproduto as idproduto', 'p.descricao as descricao', 'p.unidade as unidade', 'p.codbarra as codbarra',
          'p.aliquota as aliquota', 'p.codsubgrupo as codsubgrupo',
          'mp.vrvenda as vrvenda',
          sql<number>`coalesce(coalesce(e.qtde,0) + coalesce(d.qtde,0), 0)`.as('qtde'),
          // FISCAL com fallback p/ VRCUSTO quando o fiscal é nulo (uInventario.pas:1419-1427)
          (custoFiscal
            ? sql<number>`coalesce(mp.vrcustofiscal, mp.vrcusto)`
            : sql<number>`mp.vrcusto`
          ).as('vrcusto'),
        ])
        .where('bi.codbalanco', '=', bal.codbalanco)
        .execute()) as Array<Record<string, unknown>>;

      let n = 0;
      for (let i = 0; i < prods.length; i += 1000) {
        const lote = prods.slice(i, i + 1000);
        if (!lote.length) continue;
        await trx
          .insertInto('inventario')
          .values(
            lote.map((r) => ({
              codinvent,
              idempresa: emp,
              idproduto: Number(r.idproduto),
              codbarra: (r.codbarra as string) ?? null,
              descricao: (r.descricao as string) ?? null,
              unidade: (r.unidade as string) ?? null,
              codsubgrupo: r.codsubgrupo == null ? null : Number(r.codsubgrupo),
              aliquota: (r.aliquota as string) ?? null,
              qtde: num(r.qtde), // = saldo atual (estoque + depósito), NÃO a qtde do balanço
              vrcusto: num(r.vrcusto),
              vrvenda: num(r.vrvenda),
              tipo: 'P',
              usucadastro: op,
              dtcadastro: sql`now()`,
            })),
          )
          .execute();
        n += lote.length;
      }
      return { codinvent, codbalanco: bal.codbalanco, itens: n };
    });
  }
}
