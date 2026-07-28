import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';

type AnyDB = Kysely<any>;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * POSIÇÃO DE ESTOQUE do produto (aba/consulta UPosicaoProduto do legado) — RELATÓRIO READ-ONLY. Reúne o
 * SALDO por empresa (tabela `estoque`) + a FICHA DE MOVIMENTAÇÃO (Kardex — `historico_prod`, que os movers
 * já gravam: NF/ajuste/inventário) com saldo corrente por linha. Escopo: catálogo GLOBAL de produto dentro
 * do tenant (schema-per-tenant isola; sem filtro de empresa — mostra todas as lojas do produto).
 *
 * NOTA (procedência): o monorepo tem UM balde de saldo por (produto,empresa) — ESTOQUE.QTDE. Os baldes
 * multi-bucket do legado (almoxarifado/depósito/reservas/gôndola/QTDE_CONG-balanço) estão DORMENTES no golden
 * (reservas 0/137k, almox 1 linha, transferências paradas desde 2021) → NÃO superficiados aqui. Movimento do
 * ORIGEM_ESTOQUE por item (E/X/D/P) segue adiado no processamento da NF (tudo cai em ESTOQUE.QTDE).
 */
@Injectable()
export class ProdutoEstoqueService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async posicao(idproduto: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const saldos = (await db
      .selectFrom('estoque')
      .select(['idempresa', 'qtde', 'minimo', 'maximo', 'local'])
      .where('idproduto', '=', idproduto)
      .orderBy('idempresa')
      .execute()) as Array<Record<string, unknown>>;
    const total = r3(saldos.reduce((s, r) => s + Number(r.qtde ?? 0), 0));
    const movimentos = (await db
      .selectFrom('historico_prod')
      .select([
        'codmov', 'idempresa', 'tipo', 'qtde', 'saldo_anterior', 'saldo_novo', 'origem', 'codnf', 'historico', 'codoperador',
        sql`to_char(data, 'YYYY-MM-DD"T"HH24:MI:SS')`.as('data'),
      ])
      .where('idproduto', '=', idproduto)
      .orderBy('data', 'desc')
      .orderBy('codmov', 'desc')
      .limit(500)
      .execute()) as Array<Record<string, unknown>>;
    return { saldos, total, movimentos };
  }
}
