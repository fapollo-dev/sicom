import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SenhaOperacaoService } from './senha-operacao.service';

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
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly senhaOp: SenhaOperacaoService,
  ) {}

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

  /**
   * A pesquisa da tela abre um diálogo com **três** opções (`ChamaTelaOpcoes:254`), e o critério não é o que
   * se imagina: **"aberta" é `DTFIM >= hoje`**, não "vigente agora". Uma promoção que só começa semana que
   * vem conta como aberta, e é isso que o operador espera ao montar a agenda de promoções.
   */
  async listar(f: { descricao?: string | null; situacao?: 'ABERTAS' | 'FECHADAS' | 'TODAS' | null }): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const onde = [
      // a loja da sessão tem de estar na lista — a busca é por `;n;` dentro da string normalizada
      sql`coalesce(p.idempresa, '') LIKE ${`%;${emp};%`}`,
    ];
    if (f.descricao) onde.push(sql`pr.descricao ILIKE ${`%${f.descricao}%`}`);
    // `FIM >= TRUNC(SYSDATE)` / `FIM < TRUNC(SYSDATE)` — as duas do legado, literais
    if (f.situacao === 'ABERTAS') onde.push(sql`p.dtfim >= current_date`);
    else if (f.situacao === 'FECHADAS') onde.push(sql`p.dtfim < current_date`);
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
   * A GRADE `dbgPromocao` (`dtsProdutosPromocao`): quando o produto tem grupo de preço, a tela lista **todos
   * os produtos do grupo** com a promoção de cada um. É essa lista que o botão "excluir promoção" varre.
   *
   * O `LEFT JOIN` do legado parte de `PRODUTOS` — então aparecem também os irmãos **sem** promoção, com as
   * colunas de promoção vazias. É o que deixa o operador ver o grupo inteiro antes de decidir.
   */
  async produtosDoGrupo(codgrupopreco: number): Promise<Array<Record<string, unknown>>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (!(codgrupopreco > 0)) return [];
    return (await sql<Record<string, unknown>>`
      SELECT pp.idproduto, pp.descricao, pp.codgrupopreco,
             p.idproacumulativa, p.dtini, p.dtfim, p.idempresa,
             f.descricao AS desc_grupo
        FROM produtos pp
        LEFT JOIN promocao_acumulativa p ON p.idproduto = pp.idproduto
        LEFT JOIN familias_prod f ON f.codfamilia = pp.codgrupopreco AND f.tipo = 'P'
       WHERE pp.codgrupopreco = ${codgrupopreco}
       ORDER BY pp.descricao
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

  /**
   * EXCLUIR uma promoção (`btnExcluirClick:130`).
   *
   * ⚠️ **exige SENHA ADMINISTRATIVA** — o legado abre `dmPrincipal.SenhaAdministrativa('ADM')` **antes** de
   * qualquer coisa e sai se não passar. É a única operação da tela com essa trava, e faz sentido: apagar a
   * promoção some com o desconto que a loja está anunciando.
   *
   * E grava **log de exclusão** com histórico em texto (`:145`), no formato do legado — quem apagou, quando,
   * e qual promoção.
   */
  async excluir(id: number, senhaOperacao?: string | null): Promise<{ excluida: number }> {
    this.emp();
    if (!senhaOperacao) throw new BusinessRuleError('SENHA_OPERACAO_REQUERIDA', { tipo: 'admin' });
    const { ok } = await this.senhaOp.verificar('admin', senhaOperacao);
    if (!ok) throw new BusinessRuleError('SENHA_OPERACAO_INVALIDA', { tipo: 'admin' });

    const db = this.dbp.forTenant() as AnyDB;
    const r = (await sql<{ idproacumulativa: number }>`
      DELETE FROM promocao_acumulativa WHERE idproacumulativa = ${id} RETURNING idproacumulativa
    `.execute(db)).rows[0];
    if (!r) throw new BusinessRuleError('PROMO_NAO_ENCONTRADA', { idproacumulativa: id });
    await this.log(db, r.idproacumulativa);
    return { excluida: r.idproacumulativa };
  }

  /**
   * EXCLUIR A PROMOÇÃO DE TODO O GRUPO (`btnExcluirPromocaoClick:156`) — o outro botão, que não é o mesmo.
   *
   * O legado percorre a grade de produtos do grupo de preço e, para cada um, roda
   * `DELETE FROM PROMOCAO_ACUMULATIVA WHERE IDPRODUTO = <o produto>`.
   *
   * ⚠️ **sem filtro de período e sem filtro de loja**: apaga TODAS as promoções daquele produto, de qualquer
   * data e de qualquer loja — inclusive as históricas e as de lojas onde o operador nem trabalha. É um botão
   * de estrago largo, e é assim no legado. Mantido igual, com a mesma senha administrativa do outro excluir
   * e com o total devolvido, para a tela poder dizer quantas linhas foram embora antes de confirmar.
   */
  async excluirGrupo(codgrupopreco: number, senhaOperacao?: string | null): Promise<{ excluidas: number; produtos: number[] }> {
    this.emp();
    if (!(codgrupopreco > 0)) throw new BusinessRuleError('PROMO_GRUPO_INVALIDO', { codgrupopreco });
    if (!senhaOperacao) throw new BusinessRuleError('SENHA_OPERACAO_REQUERIDA', { tipo: 'admin' });
    const { ok } = await this.senhaOp.verificar('admin', senhaOperacao);
    if (!ok) throw new BusinessRuleError('SENHA_OPERACAO_INVALIDA', { tipo: 'admin' });

    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const alvos = (await sql<{ idproduto: number }>`
        SELECT idproduto FROM produtos WHERE codgrupopreco = ${codgrupopreco}
      `.execute(trx)).rows.map((x) => Number(x.idproduto));
      if (alvos.length === 0) return { excluidas: 0, produtos: [] };
      const apagadas = (await sql<{ idproacumulativa: number }>`
        DELETE FROM promocao_acumulativa WHERE idproduto = ANY(${alvos}) RETURNING idproacumulativa
      `.execute(trx)).rows;
      for (const a of apagadas) await this.log(trx, Number(a.idproacumulativa));
      return { excluidas: apagadas.length, produtos: alvos };
    });
  }

  /**
   * O log de exclusão (`btnExcluirClick:145`). O legado monta um `TRecLog` com ação, formulário, tabela,
   * chave, operador, data e um histórico em texto; a tabela genérica que já existe no destino com esses
   * mesmos campos é a `historico_dinamico` — a mesma que o mecanismo de preço pai/filho usa.
   */
  private async log(db: AnyDB, id: number): Promise<void> {
    const op = currentTenant().operadorId ?? null;
    const emp = currentTenant().empresaId ?? null;
    await sql`
      INSERT INTO historico_dinamico
             (codhistorico, campo, valor_anterior, valor_atual, tabela, data, codoperador, codempresa,
              chave, valor_chave, historico, origem)
      VALUES ((SELECT coalesce(max(codhistorico), 0) + 1 FROM historico_dinamico),
              'IDPROACUMULATIVA', ${String(id)}, NULL, 'PROMOCAO_ACUMULATIVA', now(), ${op}, ${emp},
              'IDPROACUMULATIVA', ${String(id)},
              ${`Promoção acumulativa ${id} foi excluída pelo operador ${op ?? ''}.`},
              'Promoção Acumulativa')
    `.execute(db);
  }
}
