import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { relacaoOperadorPerfilSchema, type RelacaoOperadorPerfilDto } from '@apollo/shared';
import { PerfilRelacaoService } from './perfil-relacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PERFIL — atribuição de perfis a operadores (RELACAO_OPERADOR_PERFIL). Base própria `cadastro/perfil-operador`
 * (evita conflito com o GET/PUT :id do CRUD de perfil). RBAC FRMCADPERFILOPERADOR/BTNRELACAO.
 */
@Controller('cadastro/perfil-operador')
@UseGuards(AcessoGuard)
export class PerfilRelacaoController {
  constructor(private readonly svc: PerfilRelacaoService) {}

  @Get(':codoperador')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNRELACAO')
  listar(@Param('codoperador', ParseIntPipe) codoperador: number) {
    return this.svc.listar(codoperador);
  }

  @Put()
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNRELACAO')
  set(@Body(new ZodValidationPipe(relacaoOperadorPerfilSchema)) dto: RelacaoOperadorPerfilDto) {
    return this.svc.set(dto.codoperador, dto.codperfil, dto.atribuido);
  }
}
