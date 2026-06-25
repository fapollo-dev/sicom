import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { loteCobrancaSchema, type CriarLoteCobrancaDto } from '@apollo/shared';
import { LotesCobrancaService } from './lotes-cobranca.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

@Controller('cobranca/lotes')
@UseGuards(AcessoGuard)
export class LotesCobrancaController {
  constructor(private readonly service: LotesCobrancaService) {}

  @Get()
  listar() {
    return this.service.list();
  }

  @Get(':cod')
  ler(@Param('cod', ParseIntPipe) cod: number) {
    return this.service.read(cod);
  }

  @Post()
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(loteCobrancaSchema)) dto: CriarLoteCobrancaDto) {
    return this.service.criar(dto);
  }

  @Put(':cod')
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR')
  atualizar(
    @Param('cod', ParseIntPipe) cod: number,
    @Body(new ZodValidationPipe(loteCobrancaSchema)) dto: CriarLoteCobrancaDto,
  ) {
    return this.service.atualizar(cod, dto);
  }

  @Delete(':cod')
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('cod', ParseIntPipe) cod: number) {
    return this.service.excluir(cod);
  }
}
