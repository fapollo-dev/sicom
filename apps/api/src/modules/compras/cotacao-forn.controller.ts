import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { cotacaoFornLoginSchema, cotacaoFornPreencherSchema, cotacaoFornCriarSchema,
  type CotacaoFornLoginDto, type CotacaoFornPreencherDto, type CotacaoFornCriarDto } from '@apollo/shared';
import { CotacaoFornService } from './cotacao-forn.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** PREENCHER COTAÇÃO (`FRMCADCOTACAOFORN`) — RBAC: gate de tela. */
@Controller('compras/cotacao-forn')
@UseGuards(AcessoGuard)
export class CotacaoFornController {
  constructor(private readonly svc: CotacaoFornService) {}

  /** a porta da tela: operador da empresa OU fornecedor. */
  @Post('autenticar')
  @RequerAcesso('FRMCADCOTACAOFORN', 'FRMCADCOTACAOFORN')
  autenticar(@Body(new ZodValidationPipe(cotacaoFornLoginSchema)) b: CotacaoFornLoginDto) {
    return this.svc.autenticar({
      comoParceiro: b.comoParceiro, login: b.login ?? null,
      codparceiro: b.codparceiro ?? null, senha: b.senha,
    });
  }

  @Get(':codctcforn')
  @RequerAcesso('FRMCADCOTACAOFORN', 'FRMCADCOTACAOFORN')
  abrir(@Param('codctcforn', ParseIntPipe) id: number) {
    return this.svc.abrir(id);
  }

  @Post('preencher')
  @RequerAcesso('FRMCADCOTACAOFORN', 'FRMCADCOTACAOFORN')
  preencher(@Body(new ZodValidationPipe(cotacaoFornPreencherSchema)) b: CotacaoFornPreencherDto) {
    return this.svc.preencher({
      codctcforn: b.codctcforn, porEmpresa: b.porEmpresa, codoperador: b.codoperador ?? null,
      itens: b.itens, obs: b.obs ?? null, datavalidade: b.datavalidade ?? null,
    });
  }

  @Post()
  @RequerAcesso('FRMCADCOTACAOFORN', 'FRMCADCOTACAOFORN')
  criar(@Body(new ZodValidationPipe(cotacaoFornCriarSchema)) b: CotacaoFornCriarDto) {
    return this.svc.criar({
      codctc: b.codctc, codparceiro: b.codparceiro,
      datavalidade: b.datavalidade ?? null, obs: b.obs ?? null,
    });
  }
}
