import { Module } from '@nestjs/common';
import { LotesCobrancaController } from './lotes-cobranca.controller';
import { LotesMdController } from './lotes-md.controller';
import { LotesCobrancaService } from './lotes-cobranca.service';
import { LoteCobrancaRepository } from './lote-cobranca.repository';
import { DatabaseProvider } from '../../shared/database/database.provider';

@Module({
  // LotesMdController (cobranca/lotes-md) substitui o controller genérico da fábrica:
  // mesmo caminho/RBAC e mesmas transações (engine), mas READ enriquecido (master+RAZAO+
  // itens com display columns + juros/total) e validação do "Cobrador" FUN='S'.
  controllers: [LotesCobrancaController, LotesMdController],
  providers: [LotesCobrancaService, LoteCobrancaRepository, DatabaseProvider],
  exports: [LotesCobrancaService],
})
export class CobrancaModule {}
