import { Injectable } from '@nestjs/common';
import { type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';

type AnyDB = Kysely<any>;

/**
 * PRODUTOS FILHOS (aba TsFilhos do UCadProduto) — grid READ-ONLY das variações filhas de um produto.
 * Espelha QryProdutosFilhos (udmCadProduto.dfm:9494): SELECT ... FROM PRODUTOS WHERE IDPRODUTO_PAI = :id.
 * `produtos` é catálogo GLOBAL (não empresaScoped) — como no legado, sem filtro de empresa.
 * ADIADO (sub-corte b), com procedência + requisitos que a auditoria levantou:
 *  - motor de propagação de preço: DIF_PRECO_PROD_FILHO_X_PAI/TPDIF (colunas NET-NEW) + AtualizaPrecoFilho
 *    (preço-do-filho = preço-do-pai ± DIF, tipo $/%; fator FORÇADO a 1 — NÃO VRVENDA×FATOR) escrevendo
 *    multi_preco por empresa + historico_dinamico. Golden VAZIO p/ a config (DIF≠0 = 0 linhas) → não
 *    certificável por dado; certificar por construção. EXIGE cycle-detection (hoje só o self direto é barrado
 *    no validar; um ciclo A→B→A passaria e travaria a propagação recursiva).
 *  - copy-on-link (PreencheDadosPai) + LOCK (DesabilitaControlesProdutoFilho): o legado trava os atributos do
 *    filho (unidade/NCM/custo/fiscal + esconde abas) no vínculo E a cada reabertura. Sem o lock, um filho
 *    editado na web pode DIVERGIR dos atributos do pai (sem corrupção — só drift). Fechar junto com o motor.
 * Aqui (sub-corte a): só o vínculo (idproduto_pai/fator_filho) + a lista read-only + regra pai≠self.
 */
@Injectable()
export class ProdutoFilhosService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async filhos(idprodutoPai: number) {
    const rows = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('produtos')
      .select(['idproduto', 'codbarra', 'descricao', 'unidade', 'fator_filho', 'ativo'])
      .where('idproduto_pai', '=', idprodutoPai)
      .orderBy('descricao')
      .execute();
    return rows;
  }
}
