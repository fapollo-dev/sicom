import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * PROMOÇÃO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`, `uCadPromocaoAcumulativa.pas` 619 linhas).
 * Dossiê: `uCadPromocaoAcumulativa.md`. **199 acessos, 26 operadores.**
 *
 * "Leve N, pague menos": o cliente acumula `QTDE` unidades do produto no cupom e o preço cai `DESCONTO`.
 * Aqui é só o **cadastro** da regra — quem a aplica é o PDV, fora de escopo.
 *
 * ⚠️ **`IDEMPRESA` é uma LISTA**, `varchar(30)` no formato `;1;2;` — uma promoção vale para várias lojas.
 * O legado normaliza a string (`ValidaEmpresas:485`) garantindo o `;` na frente e atrás, justamente para
 * poder procurar `;n;` dentro dela sem casar `;12;` quando busca `;1;`. Mantido igual: é assim que a carga
 * traz e é assim que o PDV lê.
 *
 * As quatro validações do gravar, **na ordem do legado** (`btnGravarClick:195`):
 *  1. `ValidaDataHora` — fim **estritamente maior** que início, com hora;
 *  2. `ValidaEmpresas` — quantidade > 0, desconto > 0, e ao menos uma loja;
 *  3. `ValidaProdutoPromocao` — o produto não pode estar em outra promoção com período **sobreposto** na
 *     mesma loja;
 *  4. `ValidaGrupoPrecoPromocao` — o mesmo, pelo grupo de preço do produto.
 *
 * A sobreposição é testada com as três condições do legado (`:302-312`): início do outro dentro da janela,
 * fim do outro dentro da janela, ou o outro **envolvendo** a janela inteira. Repare que é comparação por
 * DATA e hora completas, e que o legado usa `>=`/`<=` — janelas que se encostam pelas pontas colidem.
 *
 * Só entra produto **ativo** (`get_produtos.ativo = 'S'`, `VerificarProdutoAtivo:390`).
 */
@Injectable()
export class PromocaoAcumulativaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** normaliza a lista de lojas para o formato do legado: `;1;2;` (`ValidaEmpresas:485`). */
  private listaEmpresas(empresas: number[]): string {
    const unicas = [...new Set(empresas.map((e) => Number(e)))].filter((e) => e > 0).sort((a, b) => a - b);
    if (unicas.length === 0) throw new BusinessRuleError('PROMO_SEM_EMPRESA');
    const s = `;${unicas.join(';')};`;
    if (s.length > 30) throw new BusinessRuleError('PROMO_EMPRESAS_EXCEDE', { tamanho: s.length, maximo: 30 });
    return s;
  }

  async listar(f: { descricao?: string | null; vigentes?: boolean }): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const onde = [
      // a loja da sessão tem de estar na lista — a busca é por `;n;` dentro da string normalizada
      sql`coalesce(p.idempresa, '') LIKE ${`%;${emp};%`}`,
    ];
    if (f.descricao) onde.push(sql`pr.descricao ILIKE ${`%${f.descricao}%`}`);
    if (f.vigentes) onde.push(sql`now() BETWEEN p.dtini AND p.dtfim`);
    return (await sql<Record<string, unknown>>`
      SELECT p.idproacumulativa, p.idproduto, pr.descricao, pr.codbarra,
             p.qtde, p.desconto, p.idempresa, p.dtini, p.dtfim,
             coalesce(p.atacarejo, 'N') AS atacarejo,
             coalesce(p.codgrupopreco, 0) AS codgrupopreco,
             f.descricao AS grupo_preco,
             p.usuinclusao, p.usultalteracao, p.dtcadastro, p.dtultimalteracao,
             (now() BETWEEN p.dtini AND p.dtfim) AS vigente
        FROM promocao_acumulativa p
        LEFT JOIN produtos pr      ON pr.idproduto = p.idproduto
        LEFT JOIN familias_prod f  ON f.codfamilia = pr.codgrupopreco AND f.tipo = 'P'
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY p.dtini DESC, p.idproacumulativa DESC
       LIMIT 501
    `.execute(db)).rows;
  }

  /**
   * A validação de sobreposição, que serve ao produto e ao grupo de preço. Devolve a promoção conflitante,
   * ou `null`. `porGrupo` troca o alvo: em vez do produto, todos os produtos do mesmo grupo de preço.
   */
  private async conflito(
    db: AnyDB,
    p: { idproduto: number; codgrupopreco: number; dtini: string; dtfim: string; empresas: number[]; excluir?: number | null },
    porGrupo: boolean,
  ): Promise<Record<string, unknown> | null> {
    const alvo = porGrupo
      ? sql`(p.codgrupopreco = ${p.codgrupopreco} OR pr.codgrupopreco = ${p.codgrupopreco})`
      : sql`p.idproduto = ${p.idproduto}`;
    if (porGrupo && !(p.codgrupopreco > 0)) return null;
    // as três formas de duas janelas se cruzarem (`ValidaGrupoPrecoPromocao:302`)
    const cruza = sql`(
         (p.dtini >= ${p.dtini}::timestamp AND p.dtini <= ${p.dtfim}::timestamp)
      OR (p.dtfim >= ${p.dtini}::timestamp AND p.dtfim <= ${p.dtfim}::timestamp)
      OR (p.dtini <= ${p.dtini}::timestamp AND p.dtfim >= ${p.dtfim}::timestamp)
    )`;
    // e a loja: basta UMA em comum entre as duas listas
    const lojas = sql.join(p.empresas.map((e) => sql`coalesce(p.idempresa, '') LIKE ${`%;${e};%`}`), sql` OR `);
    const rows = (await sql<Record<string, unknown>>`
      SELECT p.idproacumulativa, p.idproduto, p.dtini, p.dtfim, p.idempresa
        FROM promocao_acumulativa p
        LEFT JOIN produtos pr ON pr.idproduto = p.idproduto
       WHERE ${alvo} AND ${cruza} AND (${lojas})
         ${p.excluir ? sql`AND p.idproacumulativa <> ${p.excluir}` : sql``}
       LIMIT 1
    `.execute(db)).rows;
    return rows[0] ?? null;
  }

  async salvar(dto: {
    idproacumulativa?: number | null;
    idproduto: number;
    qtde: number;
    desconto: number;
    dtini: string;
    dtfim: string;
    empresas: number[];
    atacarejo?: string | null;
    usarGrupoPreco?: boolean;
  }): Promise<{ idproacumulativa: number; idempresa: string }> {
    this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;

    // 1. data e hora (`ValidaDataHora:445`) — fim ESTRITAMENTE maior
    if (!(dto.dtfim > dto.dtini)) throw new BusinessRuleError('PROMO_PERIODO_INVALIDO', { dtini: dto.dtini, dtfim: dto.dtfim });
    // 2. quantidade, desconto e loja (`ValidaEmpresas:465`)
    if (!(num(dto.qtde) > 0)) throw new BusinessRuleError('PROMO_QTDE_OBRIGATORIA');
    if (!(num(dto.desconto) > 0)) throw new BusinessRuleError('PROMO_DESCONTO_OBRIGATORIO');
    const idempresa = this.listaEmpresas(dto.empresas);

    // só produto ATIVO entra (`VerificarProdutoAtivo:390`)
    const prod = (await sql<{ idproduto: number; codgrupopreco: number | null }>`
      SELECT idproduto, codgrupopreco FROM produtos
       WHERE idproduto = ${dto.idproduto} AND coalesce(ativo, 'S') = 'S'
    `.execute(db)).rows[0];
    if (!prod) throw new BusinessRuleError('PRODUTO_INATIVO_OU_INEXISTENTE', { idproduto: dto.idproduto });

    const grupo = dto.usarGrupoPreco ? Number(prod.codgrupopreco ?? 0) : 0;
    const chave = {
      idproduto: dto.idproduto, codgrupopreco: Number(prod.codgrupopreco ?? 0),
      dtini: dto.dtini, dtfim: dto.dtfim, empresas: dto.empresas,
      excluir: dto.idproacumulativa ?? null,
    };
    // 3. o produto já está em outra promoção que cruza o período, na mesma loja
    const cProd = await this.conflito(db, chave, false);
    if (cProd) throw new BusinessRuleError('PROMO_PRODUTO_JA_EM_PROMOCAO', { promocao: cProd.idproacumulativa });
    // 4. o mesmo pelo grupo de preço
    const cGrupo = await this.conflito(db, chave, true);
    if (cGrupo) throw new BusinessRuleError('PROMO_GRUPO_PRECO_JA_EM_PROMOCAO', { promocao: cGrupo.idproacumulativa });

    return db.transaction().execute(async (trx: AnyDB) => {
      if (dto.idproacumulativa) {
        const r = (await sql<{ idproacumulativa: number }>`
          UPDATE promocao_acumulativa
             SET idproduto = ${dto.idproduto}, qtde = ${dto.qtde}, desconto = ${dto.desconto},
                 idempresa = ${idempresa}, dtini = ${dto.dtini}::timestamp, dtfim = ${dto.dtfim}::timestamp,
                 atacarejo = ${dto.atacarejo ?? 'N'}, codgrupopreco = ${grupo},
                 usultalteracao = ${op}, dtultimalteracao = now()
           WHERE idproacumulativa = ${dto.idproacumulativa}
           RETURNING idproacumulativa
        `.execute(trx)).rows[0];
        if (!r) throw new BusinessRuleError('PROMO_NAO_ENCONTRADA', { idproacumulativa: dto.idproacumulativa });
        return { idproacumulativa: r.idproacumulativa, idempresa };
      }
      const r = (await sql<{ idproacumulativa: number }>`
        INSERT INTO promocao_acumulativa
               (idproacumulativa, idproduto, qtde, desconto, idempresa, dtini, dtfim, atacarejo, codgrupopreco,
                usuinclusao, dtcadastro)
        VALUES ((SELECT coalesce(max(idproacumulativa), 0) + 1 FROM promocao_acumulativa),
                ${dto.idproduto}, ${dto.qtde}, ${dto.desconto}, ${idempresa},
                ${dto.dtini}::timestamp, ${dto.dtfim}::timestamp, ${dto.atacarejo ?? 'N'}, ${grupo},
                ${op}, now())
        RETURNING idproacumulativa
      `.execute(trx)).rows[0];
      return { idproacumulativa: r.idproacumulativa, idempresa };
    });
  }

  /** excluir a promoção inteira (`btnExcluirPromocaoClick:156`). */
  async excluir(id: number): Promise<{ excluida: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const r = (await sql<{ idproacumulativa: number }>`
      DELETE FROM promocao_acumulativa WHERE idproacumulativa = ${id} RETURNING idproacumulativa
    `.execute(db)).rows[0];
    if (!r) throw new BusinessRuleError('PROMO_NAO_ENCONTRADA', { idproacumulativa: id });
    return { excluida: r.idproacumulativa };
  }
}
