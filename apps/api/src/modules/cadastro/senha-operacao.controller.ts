import { Body, Controller, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { senhaOperacaoSetSchema, senhaOperacaoVerificarSchema, type SenhaOperacaoSetDto, type SenhaOperacaoVerificarDto } from '@apollo/shared';
import { SenhaOperacaoService } from './senha-operacao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * SENHA DE OPERAÇÃO por empresa (E7). Base própria `cadastro/senha-operacao` (evita o :id do CRUD de empresa).
 * `definir` exige RBAC (FRMCADEMPRESA/BTNSENHAOPERACAO); `verificar` é chamável por qualquer operador autenticado
 * (é o gate de uma ação sensível — quem tem a senha autoriza).
 */
@Controller('cadastro/senha-operacao')
@UseGuards(AcessoGuard)
export class SenhaOperacaoController {
  constructor(private readonly svc: SenhaOperacaoService) {}

  @Put()
  @HttpCode(200)
  @RequerAcesso('FRMCADEMPRESA', 'BTNSENHAOPERACAO')
  definir(@Body(new ZodValidationPipe(senhaOperacaoSetSchema)) dto: SenhaOperacaoSetDto) {
    return this.svc.definir(dto.tipo, dto.senha);
  }

  @Post('verificar')
  @HttpCode(200)
  verificar(@Body(new ZodValidationPipe(senhaOperacaoVerificarSchema)) dto: SenhaOperacaoVerificarDto) {
    return this.svc.verificar(dto.tipo, dto.senha);
  }
}
