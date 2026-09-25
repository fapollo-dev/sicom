import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { FechamentoSangriaService, type Cedulas } from './fechamento-sangria.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * FECHAMENTO DE SANGRIA (FRMFECHAMENTOSANGRIA) — `fechamento-sangria.service.ts`. RBAC do legado (PERMISSOES da produção): acessar o
 * formulário (FRMFECHAMENTOSANGRIA) — que é o que o fiscal usa para autenticar — e "Fechar/Reverter" (BTNPROCESSO).
 */
@Controller('cobranca/fechamento-sangria')
@UseGuards(AcessoGuard)
export class FechamentoSangriaController {
  constructor(private readonly svc: FechamentoSangriaService) {}

  @Get()
  @RequerAcesso('FRMFECHAMENTOSANGRIA', 'FRMFECHAMENTOSANGRIA')
  listar(@Query('dataIni') dataIni?: string, @Query('dataFim') dataFim?: string) {
    const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!ok(dataIni) || !ok(dataFim)) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (dataIni! > dataFim!) throw new BusinessRuleError('LOG_PERIODO_INVALIDO');
    return this.svc.listar({ dataIni: dataIni!, dataFim: dataFim! });
  }

  @Post('autenticar')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOSANGRIA', 'FRMFECHAMENTOSANGRIA')
  autenticar(@Body() body: { sangrias?: number[] }) {
    return this.svc.autenticar(Array.isArray(body?.sangrias) ? body.sangrias : []);
  }

  @Post('fechar')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOSANGRIA', 'BTNPROCESSO')
  fechar(@Body() body: { sangrias?: number[]; cedulas?: Cedulas }) {
    return this.svc.fechar({ sangrias: Array.isArray(body?.sangrias) ? body.sangrias : [], cedulas: body?.cedulas });
  }

  @Post('lotes/:codcontagem/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMFECHAMENTOSANGRIA', 'BTNPROCESSO')
  estornar(@Param('codcontagem', ParseIntPipe) codcontagem: number) {
    return this.svc.estornar(codcontagem);
  }
}
