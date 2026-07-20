import { Module } from '@nestjs/common';
import { SpedController } from './sped.controller';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
import { SpedApuracaoPcService } from './sped-apuracao-pc.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/** SPED fiscal (corte-1: EFD-Contribuições scaffold bloco 0/9; corte-2a: apuração crédito de entrada + bloco M). */
@Module({
  controllers: [SpedController],
  providers: [SpedEfdContribuicoesService, SpedApuracaoPcService, DatabaseProvider],
})
export class SpedModule {}
