import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { itensHistoricoContabilSchema, type ItensHistoricoContabilDto } from '@apollo/shared';
import { HistoricoContabilItensService } from './historico-contabil-itens.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** OS ITENS DO HISTÓRICO CONTÁBIL — qual campo preenche cada `*` do razão (mig 294). Grava a lista inteira. */
@Controller('cadastro/historico-contabil/:codhistcontabil/itens')
@UseGuards(AcessoGuard)
export class HistoricoContabilItensController {
  constructor(private readonly svc: HistoricoContabilItensService) {}

  @Get()
  listar(@Param('codhistcontabil', ParseIntPipe) cod: number) {
    return this.svc.listar(cod);
  }

  @Put() @RequerAcesso('FRMCADHISTORICOCONTABIL', 'BTNGRAVAR')
  gravar(
    @Param('codhistcontabil', ParseIntPipe) cod: number,
    @Body(new ZodValidationPipe(itensHistoricoContabilSchema)) dto: ItensHistoricoContabilDto,
  ) {
    return this.svc.gravar(cod, dto);
  }
}
