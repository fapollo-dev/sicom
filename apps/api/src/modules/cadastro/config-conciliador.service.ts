import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConfigConciliadorDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * CONFIGURADOR DE CONCILIAÇÃO DE CARTÕES (`FRMCADCONFIGCONCILIADOR`) — **82 acessos, 6 operadores**.
 * Dossiê: `uCadConfigConciliador.md`. Migration 230.
 *
 * O layout com que se lê a planilha que cada operadora manda: em que linha os dados começam, que coluna é a
 * data da venda, qual é o valor, onde está o NSU — e **por qual chave casar** a linha com a venda de cartão.
 *
 * ⚠️ **procedência**: a tela **não veio no fonte clonado** (zero ocorrências de `CadConfigConciliador` e de
 * `CONFIG_IMPORT_CONCILIADOR` no repositório inteiro). Tudo abaixo saiu do DADO: os 7 layouts e 40 itens da
 * produção e as 245.984 linhas que eles produziram — o mesmo método do motor da integração contábil.
 *
 * Que o mecanismo está vivo: `ITENS_MANCARTAO` tem **245.984 linhas, todas** `TIPOCONCILIADOR='CONFIGURAVEL'`,
 * de 03/06/2024 a **03/05/2026**, com **98,96% casadas**. O último layout nasceu em **30/12/2025**.
 *
 * As regras estão no `configConciliadorSchema` (pacote compartilhado), porque a tela precisa das mesmas:
 * item `Fixo` tem valor e não tem coluna, os outros o contrário; formato só em `Data`; campo e coluna não se
 * repetem; os quatro campos que os 7 layouts têm sem exceção são obrigatórios; e ao menos uma chave ligada.
 */
@Injectable()
export class ConfigConciliadorService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** a lista da tela: o layout e quantas colunas ele mapeia. */
  async listar(): Promise<Array<Record<string, unknown>>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT c.cic_id, c.cic_descricao, c.cic_tipo_importacao, c.cic_linha_inicio_importacao,
             c.cic_tipo_separacao_campos, c.buscadataempvlr, c.buscadatavlrcartao, c.buscansu,
             c.buscaautorizacao, c.dtultimalteracao, c.dtcadastro,
             (SELECT count(*) FROM config_import_conciliador_item i WHERE i.cic_id = c.cic_id)::int AS itens
        FROM config_import_conciliador c
       ORDER BY upper(c.cic_descricao)
    `.execute(db)).rows;
  }

  async obter(cicId: number): Promise<Record<string, unknown>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cab = (await sql<Record<string, unknown>>`
      SELECT * FROM config_import_conciliador WHERE cic_id = ${cicId}
    `.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('CONFIG_CONCILIADOR_NAO_ENCONTRADA', { cicId });
    const itens = (await sql<Record<string, unknown>>`
      SELECT cici_id, cici_campo_tabela, cici_tipo_campo, cici_formato_campo, cici_posicao,
             cici_tamanho, cici_casas_decimais, cici_valor_formatado, cici_valor_fixo
        FROM config_import_conciliador_item
       WHERE cic_id = ${cicId}
       -- item Fixo não tem coluna e vai para o fim, como a tela do legado mostra
       ORDER BY (cici_posicao IS NULL), upper(cici_posicao), cici_id
    `.execute(db)).rows;
    return { ...cab, itens };
  }

  async criar(dto: ConfigConciliadorDto, operador: number | null): Promise<{ cic_id: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertDescricaoLivre(trx, dto.cic_descricao, null);
      const cab = (await sql<{ cic_id: number }>`
        INSERT INTO config_import_conciliador
          (cic_descricao, cic_tipo_importacao, cic_linha_inicio_importacao, cic_tipo_separacao_campos,
           buscadataempvlr, buscadatavlrcartao, buscansu, buscaautorizacao, usultalteracao, dtultimalteracao)
        VALUES (${dto.cic_descricao}, ${dto.cic_tipo_importacao}, ${dto.cic_linha_inicio_importacao},
                ${dto.cic_tipo_separacao_campos}, ${dto.buscadataempvlr}, ${dto.buscadatavlrcartao},
                ${dto.buscansu}, ${dto.buscaautorizacao}, ${operador}, now())
        RETURNING cic_id
      `.execute(trx)).rows[0];
      await this.gravarItens(trx, Number(cab.cic_id), dto);
      return { cic_id: Number(cab.cic_id) };
    });
  }

  async atualizar(cicId: number, dto: ConfigConciliadorDto, operador: number | null): Promise<{ cic_id: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const existe = (await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM config_import_conciliador WHERE cic_id = ${cicId}
      `.execute(trx)).rows[0];
      if (!Number(existe?.n)) throw new BusinessRuleError('CONFIG_CONCILIADOR_NAO_ENCONTRADA', { cicId });
      await this.assertDescricaoLivre(trx, dto.cic_descricao, cicId);
      await sql`
        UPDATE config_import_conciliador
           SET cic_descricao = ${dto.cic_descricao}, cic_tipo_importacao = ${dto.cic_tipo_importacao},
               cic_linha_inicio_importacao = ${dto.cic_linha_inicio_importacao},
               cic_tipo_separacao_campos = ${dto.cic_tipo_separacao_campos},
               buscadataempvlr = ${dto.buscadataempvlr}, buscadatavlrcartao = ${dto.buscadatavlrcartao},
               buscansu = ${dto.buscansu}, buscaautorizacao = ${dto.buscaautorizacao},
               usultalteracao = ${operador}, dtultimalteracao = now()
         WHERE cic_id = ${cicId}
      `.execute(trx);
      // os itens são o layout inteiro: trocar um campo de coluna é reescrever o mapa, não editar linha a linha
      await sql`DELETE FROM config_import_conciliador_item WHERE cic_id = ${cicId}`.execute(trx);
      await this.gravarItens(trx, cicId, dto);
      return { cic_id: cicId };
    });
  }

  /**
   * ⚠️ o layout que já importou alguma coisa **não é apagado**: as 245.984 linhas de `ITENS_MANCARTAO` guardam
   * a descrição do layout em `DESCRICAO`, e apagá-lo deixaria o histórico sem dizer por qual mapa entrou.
   */
  async excluir(cicId: number): Promise<{ cic_id: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const cab = (await sql<{ cic_descricao: string }>`
      SELECT cic_descricao FROM config_import_conciliador WHERE cic_id = ${cicId}
    `.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('CONFIG_CONCILIADOR_NAO_ENCONTRADA', { cicId });
    const usos = (await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM itens_mancartao
       WHERE upper(coalesce(descricao,'')) = upper(${cab.cic_descricao})
    `.execute(db)).rows[0];
    if (Number(usos?.n) > 0) throw new BusinessRuleError('CONFIG_CONCILIADOR_EM_USO', { cicId, linhas: Number(usos.n) });
    await sql`DELETE FROM config_import_conciliador WHERE cic_id = ${cicId}`.execute(db);
    return { cic_id: cicId };
  }

  private async assertDescricaoLivre(trx: AnyDB, desc: string, cicId: number | null): Promise<void> {
    const r = (await sql<{ cic_id: number }>`
      SELECT cic_id FROM config_import_conciliador
       WHERE upper(cic_descricao) = upper(${desc})
         AND (${cicId}::int IS NULL OR cic_id <> ${cicId}::int)
    `.execute(trx)).rows[0];
    if (r) throw new BusinessRuleError('CONFIG_CONCILIADOR_DESCRICAO_DUPLICADA', { descricao: desc });
  }

  private async gravarItens(trx: AnyDB, cicId: number, dto: ConfigConciliadorDto): Promise<void> {
    for (const i of dto.itens) {
      await sql`
        INSERT INTO config_import_conciliador_item
          (cic_id, cici_campo_tabela, cici_tipo_campo, cici_formato_campo, cici_posicao,
           cici_tamanho, cici_casas_decimais, cici_valor_formatado, cici_valor_fixo)
        VALUES (${cicId}, ${i.cici_campo_tabela}, ${i.cici_tipo_campo}, ${i.cici_formato_campo ?? null},
                ${i.cici_posicao ? i.cici_posicao.toUpperCase() : null}, ${i.cici_tamanho ?? null},
                ${i.cici_casas_decimais ?? null}, 'S', ${i.cici_valor_fixo ?? null})
      `.execute(trx);
    }
  }
}
