import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { permissaoGrantSchema, type PermissaoGrantDto } from '@apollo/shared';
import { PermissoesService } from './permissoes.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PERMISSÕES (UCtrlPermissoes) — matriz de grants FORM×OPCAO por perfil. Base `cadastro/permissoes`.
 * RBAC FRMCADPERFILOPERADOR/BTNPERMISSOES (gerir acesso é a mesma tela de perfis).
 */
@Controller('cadastro/permissoes')
@UseGuards(AcessoGuard)
export class PermissoesController {
  constructor(private readonly svc: PermissoesService) {}

  @Get('catalogo')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  catalogo() {
    return this.svc.catalogo();
  }

  @Get('perfil/:codperfil')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  listarPorPerfil(@Param('codperfil', ParseIntPipe) codperfil: number) {
    return this.svc.listarPorPerfil(codperfil);
  }

  @Put()
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  setGrant(@Body(new ZodValidationPipe(permissaoGrantSchema)) dto: PermissaoGrantDto) {
    return this.svc.setGrant(dto.codperfil, dto.form, dto.opcao, dto.concedido);
  }
}
