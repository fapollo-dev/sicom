import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { relacaoOperadorPerfilSchema, operadoresDoPerfilSchema, type RelacaoOperadorPerfilDto, type OperadoresDoPerfilDto } from '@apollo/shared';
import { PerfilRelacaoService } from './perfil-relacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * PERFIL — atribuição de perfis a operadores (RELACAO_OPERADOR_PERFIL). Base própria `cadastro/perfil-operador`
 * (evita conflito com o GET/PUT :id do CRUD de perfil). No legado o vínculo é detalhe do cadastro do perfil
 * (uCadPerfilOperador: BtnAdicionar/ExcluirOperadorVinculado, sem Tag 1) e só vai ao banco no Gravar, que o
 * TfrmCadMaster confere por código (`PossuiAcessoForm(Self.Name,'BTNGRAVAR')`): ler = gate da tela, mudar = BTNGRAVAR.
 */
@Controller('cadastro/perfil-operador')
@UseGuards(AcessoGuard)
export class PerfilRelacaoController {
  constructor(private readonly svc: PerfilRelacaoService) {}

  /** os operadores vinculados ao perfil (a grade do cadastro de perfil) */
  @Get('perfil/:codperfil')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'FRMCADPERFILOPERADOR')
  operadoresDoPerfil(@Param('codperfil', ParseIntPipe) codperfil: number) {
    return this.svc.operadoresDoPerfil(codperfil);
  }

  /** grava a lista de operadores do perfil — no legado vai no Gravar do cadastro de perfil (BTNGRAVAR) */
  @Put('perfil/:codperfil')
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNGRAVAR')
  gravarOperadoresDoPerfil(@Param('codperfil', ParseIntPipe) codperfil: number, @Body(new ZodValidationPipe(operadoresDoPerfilSchema)) dto: OperadoresDoPerfilDto) {
    return this.svc.gravarOperadoresDoPerfil(codperfil, dto.operadores);
  }

  /** "Relação perfil x operador" (menu Imprimir da tela de perfis, sem Tag) */
  @Get('perfil/:codperfil/relatorio/operadores')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'FRMCADPERFILOPERADOR')
  relatorioOperadores(@Param('codperfil', ParseIntPipe) codperfil: number) {
    return this.svc.relatorioOperadores(codperfil);
  }

  /** "Relação perfil x permissões de acesso" (menu Imprimir da tela de perfis, sem Tag) */
  @Get('perfil/:codperfil/relatorio/permissoes')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'FRMCADPERFILOPERADOR')
  relatorioPermissoes(@Param('codperfil', ParseIntPipe) codperfil: number) {
    return this.svc.relatorioPermissoes(codperfil);
  }

  @Get(':codoperador')
  @RequerAcesso('FRMCADPERFILOPERADOR', 'FRMCADPERFILOPERADOR')
  listar(@Param('codoperador', ParseIntPipe) codoperador: number) {
    return this.svc.listar(codoperador);
  }

  @Put()
  @HttpCode(200)
  @RequerAcesso('FRMCADPERFILOPERADOR', 'BTNGRAVAR')
  set(@Body(new ZodValidationPipe(relacaoOperadorPerfilSchema)) dto: RelacaoOperadorPerfilDto) {
    return this.svc.set(dto.codoperador, dto.codperfil, dto.atribuido);
  }
}
