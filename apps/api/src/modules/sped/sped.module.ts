import { Module } from '@nestjs/common';
import { SpedController } from './sped.controller';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/** SPED fiscal (corte-1: EFD-Contribuições scaffold — bloco 0 + 9). Provê o DatabaseProvider localmente. */
@Module({
  controllers: [SpedController],
  providers: [SpedEfdContribuicoesService, DatabaseProvider],
})
export class SpedModule {}
