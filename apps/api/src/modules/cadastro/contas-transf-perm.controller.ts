import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { transferenciasPermitidasSchema, type TransferenciasPermitidasDto } from '@apollo/shared';
import { ContasTransfPermService } from './contas-transf-perm.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** TRANSFERÊNCIAS PERMITIDAS a partir de uma conta (mig 295). Grava a lista inteira. */
@Controller('cadastro/contas-bancarias/:codconta/transferencias-permitidas')
@UseGuards(AcessoGuard)
export class ContasTransfPermController {
  constructor(private readonly svc: ContasTransfPermService) {}

  @Get()
  listar(@Param('codconta', ParseIntPipe) cod: number) {
    return this.svc.listar(cod);
  }

  @Put() @RequerAcesso('FRMCADCONTASBANCARIAS', 'BTNGRAVAR')
  gravar(
    @Param('codconta', ParseIntPipe) cod: number,
    @Body(new ZodValidationPipe(transferenciasPermitidasSchema)) dto: TransferenciasPermitidasDto,
  ) {
    return this.svc.gravar(cod, dto);
  }
}
