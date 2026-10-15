import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';

/**
 * A aba "Operadoras Assossiadas" do Cadastro de Operadoras (UcadOperadoras.dfm `tbOperadorasAssossiadas`): as operadoras que têm a aberta
 * como OPERADORA BASE — o `qryOperadorasFilhas` do uRDMCadOperadoras (`SELECT * FROM OPERADORAS WHERE CODOPERADORABASE = :CODOPERADORABASE`),
 * com as colunas da grade. A OPERADORAS do legado não tem INDR (o Excluir apaga); aqui a excluída (soft-delete) fica fora, como lá.
 * Leitura como a do agregado (o acesso da tela pede-se no gravar).
 */
@Controller('cadastro/operadoras')
@UseGuards(AcessoGuard)
export class OperadorasFilhasController {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Get(':id/filhas')
  async filhas(@Param('id', ParseIntPipe) id: number) {
    const db = this.dbp.forTenantRead() as Kysely<any>;
    return (await sql<Record<string, unknown>>`
      SELECT codoperadoras, operadora, operadora_pdv, diascomp, txadm, codadm, txgestao, txanuidade, tipo, diafechamento, codbanco, obs,
             empresas, ativo, pos, tipocartao, codrede, codbandeira
        FROM operadoras
       WHERE codoperadorabase = ${id} AND coalesce(indr, '') <> 'E'
       ORDER BY codoperadoras`.execute(db)).rows;
  }
}
