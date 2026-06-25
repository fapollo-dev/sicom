import { Module } from '@nestjs/common';
import { LotesCobrancaController } from './lotes-cobranca.controller';
import { LotesCobrancaService } from './lotes-cobranca.service';
import { LoteCobrancaRepository } from './lote-cobranca.repository';
import { LoteCobrancaAggregateController } from './lote-cobranca.aggregate';
import { DatabaseProvider } from '../../shared/database/database.provider';

@Module({
  controllers: [LotesCobrancaController, LoteCobrancaAggregateController],
  providers: [LotesCobrancaService, LoteCobrancaRepository, DatabaseProvider],
  exports: [LotesCobrancaService],
})
export class CobrancaModule {}
