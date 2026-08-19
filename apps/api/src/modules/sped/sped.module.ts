import { Module } from '@nestjs/common';
import { SpedController } from './sped.controller';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
import { SpedEfdIcmsIpiService } from './sped-efd-icms-ipi.service';
import { SpedApuracaoPcService } from './sped-apuracao-pc.service';
import { ApuracaoIcmsController } from './apuracao-icms.controller';
import { ApuracaoIcmsService } from './apuracao-icms.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * SPED: EFD-Contribuições (PIS/COFINS: 0/C/M/9) + EFD ICMS/IPI (SPED Fiscal corte-1: 0/C+C190/E/9) + a
 * **APURAÇÃO DE ICMS** (o processo do livro de Registro de Entradas e Saídas, que produz o E110 — mig 164).
 */
@Module({
  controllers: [SpedController, ApuracaoIcmsController],
  providers: [SpedEfdContribuicoesService, SpedEfdIcmsIpiService, SpedApuracaoPcService, ApuracaoIcmsService, DatabaseProvider],
})
export class SpedModule {}
