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

  /**
   * "IMPORTAR BALANÇO E ATUALIZAR ESTOQUE" (`ImportaBalancoSincronizar`, uInventario.pas:1485-1529 +
   * `sqqImportaSincroniza`): reconstrói a folha somando o movimento do intervalo à foto. Quatro pernas agregadas
   * por produto — foto (`balancoitens`), entradas de NF (**lista literal de 14 CFOPs**, `tipo='E'`, `proc='S'`,
   * `cancelada='N'`, `quantidade × fatorembal`), saídas de NF (`tipo='S'`, CFOP **∉** 5929/6929) e vendas
   * (`cancelado='N'`) — e o SENTIDO decide a fórmula e o intervalo:
   *   dataLivro > dataFoto → `[dataFoto+1, dataLivro]`, saldo = foto + entradas − saídas
   *   dataFoto > dataLivro → `[dataLivro, dataFoto−1]`, saldo = foto − entradas + saídas
   *   iguais              → o legado não abre nenhum ramo (a folha já foi apagada): folha vazia + aviso.
   * Quirks copiados: **sem piso em zero** (o `HAVING (...) > 0` está comentado no SQL) e `multi_preco` em LEFT
   * (produto sem preço na empresa ENTRA, com custo nulo) — o contrário do "Importar Balanço".
   */
  async importarSincronizando(
    codinvent: number,
    dto: { codbalanco: number; confirmar?: boolean },
  ): Promise<{ codinvent: number; codbalanco: number; itens: number; sentido: 'frente' | 'tras' | 'nenhum'; dtini: string | null; dtfim: string | null; aviso?: string }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const custoFiscal = (await this.config.resolver('VRCUSTO_INVENTARIO', { empresaId: emp })) === 'FISCAL';
    // balde de data em coluna timestamptz (vendas.dtvenda) resolve no fuso da SESSÃO ⇒ fuso explícito (lição 17)
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const l = await this.livro(trx, codinvent, emp);
      const bal = (await trx
        .selectFrom('balanco')
        .select(['codbalanco', 'codempresa', sql<string>`to_char(data,'YYYY-MM-DD')`.as('data')])
        .where('codbalanco', '=', dto.codbalanco)
        .where('codempresa', '=', emp)
        .where(sql`coalesce(ativo,'S')`, '=', 'S')
        .executeTakeFirst()) as { codbalanco: number; codempresa: number; data: string } | undefined;
      if (!bal) throw new BusinessRuleError('BALANCO_NAO_ENCONTRADO', { codbalanco: dto.codbalanco });

      const atual = (await trx
        .selectFrom('inventario')
        .select(sql<number>`count(*)`.as('n'))
        .where('codinvent', '=', codinvent)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as { n: unknown } | undefined;
      if (Number(atual?.n ?? 0) > 0 && !dto.confirmar) throw new BusinessRuleError('INVENTARIO_SERA_EXCLUIDO', { codinvent, itens: Number(atual?.n ?? 0) });
      await trx.deleteFrom('inventario').where('codinvent', '=', codinvent).where('idempresa', '=', emp).execute();

      // o sentido e o intervalo (espelhados, como no legado)
      const sentido: 'frente' | 'tras' | 'nenhum' = l.data > bal.data ? 'frente' : bal.data > l.data ? 'tras' : 'nenhum';
      if (sentido === 'nenhum') {
        return {
          codinvent, codbalanco: bal.codbalanco, itens: 0, sentido, dtini: null, dtfim: null,
          aviso: 'A data do inventário é igual à do balanço: o legado não abre nenhum dos dois ramos e a folha fica vazia (uInventario.pas:1506-1529).',
        };
      }
      const dtini = sentido === 'frente' ? sql<string>`(${bal.data}::date + 1)` : sql<string>`${l.data}::date`;
      const dtfim = sentido === 'frente' ? sql<string>`${l.data}::date` : sql<string>`(${bal.data}::date - 1)`;
      const sinal = sentido === 'frente' ? 1 : -1; // + entradas − saídas · − entradas + saídas

      const rows = (await sql<Record<string, unknown>>`
        WITH mov AS (
          SELECT bi.idproduto AS idproduto, bi.qtde AS qtde, 0::numeric AS entradas, 0::numeric AS saidas
            FROM balancoitens bi WHERE bi.codbalanco = ${bal.codbalanco}
          UNION ALL
          -- ENTRADAS: a LISTA LITERAL de CFOPs do legado (não o cfop.proc_qtde do outro comando)
          SELECT np.codproduto, 0, sum(np.quantidade * coalesce(nullif(np.fatorembal,0),1)), 0
            FROM nf n JOIN nf_prod np ON np.codnf = n.codnf
           WHERE n.dtcontabil BETWEEN ${dtini} AND ${dtfim} AND n.idempresa = ${emp}
             AND n.tipo = 'E' AND n.proc = 'S' AND coalesce(n.cancelada,'N') = 'N'
             AND np.cfop::int IN (1102,2102,1403,2403,1910,2910,1152,1409,1157,1556,1652,1949,1202,1405)
           GROUP BY np.codproduto
          UNION ALL
          SELECT np.codproduto, 0, 0, sum(np.quantidade * coalesce(nullif(np.fatorembal,0),1))
            FROM nf n JOIN nf_prod np ON np.codnf = n.codnf
           WHERE n.dtcontabil BETWEEN ${dtini} AND ${dtfim} AND n.idempresa = ${emp}
             AND n.tipo = 'S' AND n.proc = 'S' AND coalesce(n.cancelada,'N') = 'N'
             AND np.cfop::int NOT IN (5929,6929)
           GROUP BY np.codproduto
          UNION ALL
          SELECT v.codproduto, 0, 0, sum(v.qtde)
            FROM vendas v
           WHERE (v.dtvenda AT TIME ZONE ${tz})::date BETWEEN ${dtini} AND ${dtfim}
             AND v.idempresa = ${emp} AND coalesce(v.cancelado,'N') = 'N'
           GROUP BY v.codproduto
        )
        SELECT x.idproduto,
               sum(x.qtde) + ${sinal} * (sum(x.entradas) - sum(x.saidas)) AS saldo,
               p.descricao, p.unidade, p.codbarra, p.aliquota, p.codsubgrupo,
               mp.vrvenda,
               ${custoFiscal ? sql`coalesce(mp.vrcustofiscal, mp.vrcusto)` : sql`mp.vrcusto`} AS vrcusto
          FROM mov x
          JOIN produtos p ON p.idproduto = x.idproduto
          LEFT JOIN multi_preco mp ON mp.idproduto = x.idproduto AND mp.idempresa = ${emp}
         GROUP BY x.idproduto, p.descricao, p.unidade, p.codbarra, p.aliquota, p.codsubgrupo, mp.vrvenda, mp.vrcusto, mp.vrcustofiscal
         ORDER BY x.idproduto
      `.execute(trx)).rows as Array<Record<string, unknown>>;

      let n = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const lote = rows.slice(i, i + 1000);
        if (!lote.length) continue;
        await trx
          .insertInto('inventario')
          .values(
            lote.map((r) => ({
              codinvent, idempresa: emp, idproduto: Number(r.idproduto),
              codbarra: (r.codbarra as string) ?? null, descricao: (r.descricao as string) ?? null,
              unidade: (r.unidade as string) ?? null, codsubgrupo: r.codsubgrupo == null ? null : Number(r.codsubgrupo),
              aliquota: (r.aliquota as string) ?? null,
              qtde: num(r.saldo), // sem piso em zero: o HAVING do legado está comentado
              vrcusto: num(r.vrcusto), vrvenda: num(r.vrvenda),
              tipo: 'P', usucadastro: op, dtcadastro: sql`now()`,
            })),
          )
          .execute();
        n += lote.length;
      }
      return { codinvent, codbalanco: bal.codbalanco, itens: n, sentido, dtini: sentido === 'frente' ? bal.data : l.data, dtfim: sentido === 'frente' ? l.data : bal.data };
    });
  }

  /**
   * "SINCRONIZAR INVENTÁRIO (ENTRADAS - SAÍDAS)" (`SincronizarInventrio1Click`, uInventario.pas:2631-2705 +
   * `sqqMovimentos`): recalcula a QTDE das linhas que **já estão** na folha — não cria linha. Movimento negativo
   * vira 0 e produto sem movimento vira 0 (linhas 2687-2701). As quatro pernas aqui são OUTRAS: o gate é
   * `cfop.proc_qtde = 'S'` (estrito — NULL fica fora) e **não há** filtro de `proc`/`cancelada` nas notas; a foto
   * usada é a do `MAX(data)` dos balanços ativos — e o legado calcula esse MAX **sem filtrar empresa**
   * (`sqqDataBalanco`), o que devolve saldo inicial zero se outra empresa tiver foto mais recente. Copiado, com
   * `aviso` quando é o caso.
   */
  async sincronizarMovimentos(
    codinvent: number,
    dto: { dtinicial?: string },
  ): Promise<{ codinvent: number; atualizados: number; zerados: number; dtinicial: string; dtfinal: string; dtbalanco: string | null; aviso?: string }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const l = await this.livro(trx, codinvent, emp);
      // `sqqDataBalanco`: MAX(DATA) dos balanços ATIVOS — sem filtro de empresa (quirk fiel)
      const maxG = (await trx
        .selectFrom('balanco')
        .select(sql<string>`to_char(max(data),'YYYY-MM-DD')`.as('data'))
        .where(sql`coalesce(ativo,'S')`, '=', 'S')
        .executeTakeFirst()) as { data: string | null } | undefined;
      const dtbalanco = maxG?.data ?? null;
      const daEmpresa = dtbalanco
        ? await trx.selectFrom('balanco').select('codbalanco').where('codempresa', '=', emp).where('data', '=', sql`${dtbalanco}::date`).where(sql`coalesce(ativo,'S')`, '=', 'S').executeTakeFirst()
        : undefined;
      const aviso = dtbalanco && !daEmpresa
        ? `A data do último balanço (${dtbalanco}) é de outra empresa: o legado busca o MAX(DATA) sem filtrar empresa (sqqDataBalanco), então o saldo inicial da foto entra ZERO.`
        : undefined;

      const dtinicial = dto.dtinicial ?? dtbalanco;
      if (!dtinicial) throw new BusinessRuleError('DATA_INICIAL_REQUERIDA', { motivo: 'não há balanço ativo para sugerir a data' });

      const rows = (await sql<Record<string, unknown>>`
        SELECT x.codproduto, sum(x.qtde) AS qtde FROM (
          SELECT np.codproduto, sum(np.quantidade * coalesce(nullif(np.fatorembal,0),1)) AS qtde
            FROM nf n JOIN nf_prod np ON np.codnf = n.codnf
            LEFT JOIN cfop c ON c.codcfop::int = np.cfop::int
           WHERE n.dtcontabil BETWEEN ${dtinicial}::date AND ${l.data}::date AND n.idempresa = ${emp}
             AND n.tipo = 'E' AND c.proc_qtde = 'S' AND np.codproduto IS NOT NULL
           GROUP BY np.codproduto
          UNION ALL
          SELECT np.codproduto, sum(np.quantidade * coalesce(nullif(np.fatorembal,0),1)) * -1
            FROM nf n JOIN nf_prod np ON np.codnf = n.codnf
            LEFT JOIN cfop c ON c.codcfop::int = np.cfop::int
           WHERE n.dtcontabil BETWEEN ${dtinicial}::date AND ${l.data}::date AND n.idempresa = ${emp}
             AND n.tipo = 'S' AND c.proc_qtde = 'S'
           GROUP BY np.codproduto
          UNION ALL
          SELECT bi.idproduto, sum(bi.qtde)
            FROM balanco b JOIN balancoitens bi ON bi.codbalanco = b.codbalanco
           WHERE b.codempresa = ${emp} AND b.data = ${dtbalanco}::date
           GROUP BY bi.idproduto
          UNION ALL
          SELECT v.codproduto, sum(v.qtde) * -1
            FROM vendas v
           WHERE v.idempresa = ${emp} AND coalesce(v.cancelado,'N') = 'N'
             AND (v.dtvenda AT TIME ZONE ${tz})::date BETWEEN ${dtinicial}::date AND ${l.data}::date
           GROUP BY v.codproduto
        ) x GROUP BY x.codproduto
      `.execute(trx)).rows as Array<{ codproduto: number; qtde: unknown }>;
      const mov = new Map<number, number>(rows.map((r) => [Number(r.codproduto), num(r.qtde)]));

      const folha = (await trx
        .selectFrom('inventario')
        .select(['sequencia', 'idproduto'])
        .where('codinvent', '=', codinvent)
        .where('idempresa', '=', emp)
        .execute()) as Array<{ sequencia: number; idproduto: number }>;
      let atualizados = 0;
      let zerados = 0;
      for (const it of folha) {
        const m = mov.get(Number(it.idproduto));
        // movimento negativo → 0 · produto sem movimento → 0 (uInventario.pas:2687-2701)
        const q = m == null || m < 0 ? 0 : m;
        if (q === 0) zerados++; else atualizados++;
        await trx.updateTable('inventario').set({ qtde: q, usultalteracao: op, dtultimalteracao: sql`now()` }).where('sequencia', '=', it.sequencia).execute();
      }
      return { codinvent, atualizados, zerados, dtinicial, dtfinal: l.data, dtbalanco, aviso };
    });
  }
}
