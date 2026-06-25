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
  Query,
  UseGuards,
} from '@nestjs/common';
import { loteCobrancaSchema, type CriarLoteCobrancaDto } from '@apollo/shared';
import { LotesCobrancaService } from './lotes-cobranca.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

@Controller('cobranca')
@UseGuards(AcessoGuard)
export class LotesCobrancaController {
  constructor(private readonly service: LotesCobrancaService) {}

  /**
   * Picker GET_ARECEBER: documentos a receber disponíveis p/ adicionar ao lote — SEMPRE
   * escopado por empresa do contexto (fail-closed). `consiliado=S|N` filtra conciliados
   * (legado: CONSILIADO='S' quando há fechamento de caixa); `excluirDoLote` remove os já
   * no lote informado. Espelha o btnAddIten do legado (frmPesquisa 'GET_ARECEBER').
   */
  @Get('areceber')
  areceber(
    @Query('consiliado') consiliado?: string,
    @Query('excluirDoLote') excluirDoLote?: string,
  ) {
    return this.service.listAreceber({
      consiliado: consiliado === 'S' ? 'S' : consiliado === 'N' ? 'N' : undefined,
      excluirDoLote: excluirDoLote ? Number(excluirDoLote) : undefined,
    });
  }

  /** Lookup do "Cobrador" (parceiros FUN='S') — alimenta o SelectField da tela. */
  @Get('cobradores')
  cobradores() {
    return this.service.listCobradores();
  }

  @Get('lotes')
  listar() {
    return this.service.list();
  }

  @Get('lotes/:cod')
  ler(@Param('cod', ParseIntPipe) cod: number) {
    return this.service.read(cod);
  }

  @Post('lotes')
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(loteCobrancaSchema)) dto: CriarLoteCobrancaDto) {
    return this.service.criar(dto);
  }

  @Put('lotes/:cod')
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNGRAVAR')
  atualizar(
    @Param('cod', ParseIntPipe) cod: number,
    @Body(new ZodValidationPipe(loteCobrancaSchema)) dto: CriarLoteCobrancaDto,
  ) {
    return this.service.atualizar(cod, dto);
  }

  @Delete('lotes/:cod')
  @RequerAcesso('FRMCADLOTECOBRANCA', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('cod', ParseIntPipe) cod: number) {
    return this.service.excluir(cod);
  }
}
