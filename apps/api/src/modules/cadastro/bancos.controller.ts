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
import {
  bancoSchema,
  atualizarBancoSchema,
  type CriarBancoDto,
  type AtualizarBancoDto,
} from '@apollo/shared';
import { BancosService } from './bancos.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

@Controller('cadastro/bancos')
@UseGuards(AcessoGuard)
export class BancosController {
  constructor(private readonly service: BancosService) {}

  @Get()
  listar() {
    return this.service.list();
  }

  @Get(':codbco')
  ler(@Param('codbco', ParseIntPipe) codbco: number) {
    return this.service.read(codbco);
  }

  @Post()
  @RequerAcesso('FRMCADBANCOS', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(bancoSchema)) dto: CriarBancoDto) {
    return this.service.criar(dto);
  }

  @Put(':codbco')
  @RequerAcesso('FRMCADBANCOS', 'BTNGRAVAR')
  atualizar(
    @Param('codbco', ParseIntPipe) codbco: number,
    @Body(new ZodValidationPipe(atualizarBancoSchema)) dto: AtualizarBancoDto,
  ) {
    return this.service.atualizar(codbco, dto);
  }

  @Delete(':codbco')
  @RequerAcesso('FRMCADBANCOS', 'BTNEXCLUIR')
  @HttpCode(204)
  excluir(@Param('codbco', ParseIntPipe) codbco: number) {
    return this.service.excluir(codbco);
  }
}
