import { Module } from '@nestjs/common';
import { LotesCobrancaController } from './lotes-cobranca.controller';
import { LotesMdController } from './lotes-md.controller';
import { LotesCobrancaService } from './lotes-cobranca.service';
import { LoteCobrancaRepository } from './lote-cobranca.repository';
import { AreceberController } from './areceber.controller';
import { AreceberService } from './areceber.service';
import { AreceberBaixaService } from './areceber-baixa.service';
import { ApagarController } from './apagar.controller';
import { ApagarService } from './apagar.service';
import { ApagarBaixaService } from './apagar-baixa.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

@Module({
  // LotesMdController (cobranca/lotes-md) substitui o controller genérico da fábrica:
  // mesmo caminho/RBAC e mesmas transações (engine), mas READ enriquecido (master+RAZAO+
  // itens com display columns + juros/total) e validação do "Cobrador" FUN='S'.
  // AreceberController (cadastro/areceber) = CONTAS A RECEBER; ApagarController (cadastro/apagar) = A PAGAR.
  controllers: [LotesCobrancaController, LotesMdController, AreceberController, ApagarController],
  providers: [
    LotesCobrancaService, LoteCobrancaRepository,
    AreceberService, AreceberBaixaService, ApagarService, ApagarBaixaService,
    DatabaseProvider,
  ],
  exports: [LotesCobrancaService],
})
export class CobrancaModule {}
