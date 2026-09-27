import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { relacaoOperadorPerfilSchema, type RelacaoOperadorPerfilDto } from '@apollo/shared';
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
