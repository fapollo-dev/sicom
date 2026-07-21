import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { restricaoAcessoSchema, type RestricaoAcessoDto } from '@apollo/shared';
import { RestricaoAcessoService } from './restricao-acesso.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * OPERADORES_RESTRICAO_ACESSO — janelas de horário de acesso do operador (T1.5). Sub-recurso do operador
 * (RBAC FRMCADOPERADOR, a mesma tela). O login gate lê estas janelas no AuthService. Rota profunda
 * (`:cod/restricao-acesso/...`) não colide com o agregado `cadastro/operadores/:id`.
 */
@Controller('cadastro/operadores/:cod/restricao-acesso')
@UseGuards(AcessoGuard)
export class RestricaoAcessoController {
  constructor(private readonly svc: RestricaoAcessoService) {}

  @Get()
  @RequerAcesso('FRMCADOPERADOR', 'BTNGRAVAR')
  listar(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.listar(cod);
  }

  @Post()
  @HttpCode(201)
  @RequerAcesso('FRMCADOPERADOR', 'BTNGRAVAR')
  adicionar(@Param('cod', ParseIntPipe) cod: number, @Body(new ZodValidationPipe(restricaoAcessoSchema)) dto: RestricaoAcessoDto) {
    return this.svc.adicionar(cod, dto);
  }

  @Delete(':id')
  @RequerAcesso('FRMCADOPERADOR', 'BTNEXCLUIR')
  remover(@Param('cod', ParseIntPipe) cod: number, @Param('id', ParseIntPipe) id: number) {
    return this.svc.remover(cod, id);
  }
}
