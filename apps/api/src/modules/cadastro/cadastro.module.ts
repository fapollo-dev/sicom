import { Module } from '@nestjs/common';
import { BancosController } from './bancos.controller';
import { BancosService } from './bancos.service';
import { BancoRepository } from './banco.repository';
import { OperacoesContaCrudController } from './operacoes-conta.crud';
import { ContasBancariasCrudController } from './contas-bancarias.crud';
import { MarcasCrudController } from './marcas.crud';
import { BairroCrudController } from './bairro.crud';
import { PrecoCrudController } from './preco.crud';
import { NcmCrudController } from './ncm.crud';
import { CidadeCrudController } from './cidade.crud';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * Cadastros. Bancos é hand-written (piloto de referência, com golden de runtime).
 * Operações de Conta, Contas Bancárias e Marcas são DECLARATIVAS (engine CRUD) —
 * cada uma é só uma config; o engine herda auditoria/soft-delete/outbox/RBAC.
 */
@Module({
  controllers: [
    BancosController, // hand-written (referência + paridade SQL + golden)
    OperacoesContaCrudController, // engine (combo)
    ContasBancariasCrudController, // engine (FK/lookup)
    MarcasCrudController, // engine (soft-delete)
    BairroCrudController, // engine (1ª herdeira completa: texto+combo+flag via <CadMaster>)
    PrecoCrudController, // engine (palette completo: número/moeda + checkbox)
    NcmCrudController, // engine (CHAVE NATURAL + data + memo)
    CidadeCrudController, // engine (chave natural; alvo do lookup de Bairros)
  ],
  providers: [BancosService, BancoRepository, DatabaseProvider],
  exports: [BancosService],
})
export class CadastroModule {}
