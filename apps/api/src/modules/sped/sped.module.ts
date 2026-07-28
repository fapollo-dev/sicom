import { Module } from '@nestjs/common';
import { SpedController } from './sped.controller';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
import { SpedEfdIcmsIpiService } from './sped-efd-icms-ipi.service';
import { SpedApuracaoPcService } from './sped-apuracao-pc.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/** SPED: EFD-Contribuições (PIS/COFINS: 0/C/M/9) + EFD ICMS/IPI (SPED Fiscal corte-1: 0/C+C190/E/9). */
@Module({
  controllers: [SpedController],
  providers: [SpedEfdContribuicoesService, SpedEfdIcmsIpiService, SpedApuracaoPcService, DatabaseProvider],
})
export class SpedModule {}
