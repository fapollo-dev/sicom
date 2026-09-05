import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  permissaoGrantSchema, permissaoOperadorGrantSchema, permissaoLoteSchema, permissaoClonarSchema,
  type PermissaoGrantDto, type PermissaoOperadorGrantDto, type PermissaoLoteDto, type PermissaoClonarDto,
} from '@apollo/shared';
import { PermissoesService } from './permissoes.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PERMISSÕES (`FRMCTRLPERMISSOES`) — matriz de grants FORM×OPCAO, por PERFIL e por OPERADOR. Base
 * `cadastro/permissoes`. RBAC FRMCADPERFILOPERADOR/BTNPERMISSOES (gerir acesso é a mesma tela de perfis).
 * O caminho por OPERADOR é o que o cliente usa (`CONTROLE_PERMISSOES='Usuario'`) — ver dossiê uCtrlPermissoes.md.
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

  /** trilha de auditoria (AUDIT_PERMISSOES) — mudanças de grant; filtro opcional por perfil. */
  @Get('auditoria')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  auditoria(@Query('codperfil') codperfil?: string, @Query('limite') limite?: string) {
    const cp = codperfil != null && codperfil !== '' ? Number(codperfil) : undefined;
    return this.svc.auditoria(cp, limite != null && limite !== '' ? Number(limite) : 100);
  }

  @Put()
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  setGrant(@Body(new ZodValidationPipe(permissaoGrantSchema)) dto: PermissaoGrantDto) {
    return this.svc.setGrant(dto.codperfil, dto.form, dto.opcao, dto.concedido);
  }

  /** os grants de um OPERADOR (empresa opcional; ausente = a da sessão, como o seletor da tela do legado). */
  @Get('operador/:codoperador')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  listarPorOperador(@Param('codoperador', ParseIntPipe) codoperador: number, @Query('codempresa') codempresa?: string) {
    return this.svc.listarPorOperador(codoperador, codempresa ? Number(codempresa) : undefined);
  }

  /** concede/revoga um grant a um OPERADOR — o caminho que o cliente usa no dia a dia. */
  @Put('operador')
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  setGrantOperador(@Body(new ZodValidationPipe(permissaoOperadorGrantSchema)) dto: PermissaoOperadorGrantDto) {
    return this.svc.setGrantOperador(dto);
  }

  /** marcar/desmarcar em lote: `form` presente = as opções daquele formulário; ausente = o catálogo inteiro. */
  @Put('lote')
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  setLote(@Body(new ZodValidationPipe(permissaoLoteSchema)) dto: PermissaoLoteDto) {
    return this.svc.setLote(dto);
  }

  /** clonar permissões de um operador/perfil para outro (⚠️ destrutivo no destino, como o SP do legado). */
  @Post('clonar')
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNPERMISSOES')
  clonar(@Body(new ZodValidationPipe(permissaoClonarSchema)) dto: PermissaoClonarDto) {
    return this.svc.clonar(dto);
  }
}
