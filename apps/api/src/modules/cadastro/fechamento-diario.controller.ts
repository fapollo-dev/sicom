import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { fecharDiaSchema, fecharMesSchema, type FecharDiaDto, type FecharMesDto } from '@apollo/shared';
import { FechamentoDiarioService } from './fechamento-diario.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * FECHAMENTO DIÁRIO (`FRMFECHAMENTODIARIO`). RBAC: o cliente concede só o **gate da tela** (29 operadores) —
 * não há opção por botão, então abrir e fechar respondem ao mesmo grant, como no legado.
 */
@Controller('cadastro/fechamento-diario')
@UseGuards(AcessoGuard)
export class FechamentoDiarioController {
  constructor(private readonly svc: FechamentoDiarioService) {}

  /** o mês inteiro: dias sem linha aparecem como abertos, com a contagem de notas pendentes de cada um. */
  @Get()
  @RequerAcesso('FRMFECHAMENTODIARIO', 'FRMFECHAMENTODIARIO')
  listar(@Query('ano') ano: string, @Query('mes') mes: string) {
    return this.svc.listarMes(Number(ano), Number(mes));
  }

  @Post('fechar-dia')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTODIARIO', 'FRMFECHAMENTODIARIO')
  fecharDia(@Body(new ZodValidationPipe(fecharDiaSchema)) dto: FecharDiaDto) {
    return this.svc.fecharDia(dto.data);
  }

  @Post('abrir-dia')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTODIARIO', 'FRMFECHAMENTODIARIO')
  abrirDia(@Body(new ZodValidationPipe(fecharDiaSchema)) dto: FecharDiaDto) {
    return this.svc.abrirDia(dto.data);
  }

  /** fechar/abrir o mês inteiro — o "total" da tela, que evita marcar dia a dia. */
  @Post('mes')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTODIARIO', 'FRMFECHAMENTODIARIO')
  mes(@Body(new ZodValidationPipe(fecharMesSchema)) dto: FecharMesDto) {
    return this.svc.mesInteiro(dto.ano, dto.mes, dto.fechar);
  }
}
