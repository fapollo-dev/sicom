import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SugestaoPromocaoService } from './sugestao-promocao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

/** GERENCIAR SUGESTÃO DE PROMOÇÃO (FRMGERENCIARSUGESTAOPROMOCAO) — o gate é o da tela (não há unit para saber os botões). */
@Controller('cadastro/sugestao-promocao')
@UseGuards(AcessoGuard)
export class SugestaoPromocaoController {
  constructor(private readonly svc: SugestaoPromocaoService) {}

  @Get()
  @RequerAcesso('FRMGERENCIARSUGESTAOPROMOCAO', 'FRMGERENCIARSUGESTAOPROMOCAO')
  listar(@Query('situacao') situacao?: string) {
    return this.svc.listar({ situacao });
  }

  @Post()
  @HttpCode(201)
  @RequerAcesso('FRMGERENCIARSUGESTAOPROMOCAO', 'FRMGERENCIARSUGESTAOPROMOCAO')
  sugerir(@Body() body: { idproduto?: number }) {
    const id = Number(body?.idproduto);
    if (!Number.isInteger(id) || id <= 0) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: body?.idproduto ?? null });
    return this.svc.sugerir(id);
  }

  @Post(':id/resolver')
  @HttpCode(200)
  @RequerAcesso('FRMGERENCIARSUGESTAOPROMOCAO', 'FRMGERENCIARSUGESTAOPROMOCAO')
  resolver(@Param('id', ParseIntPipe) id: number) {
    return this.svc.resolver(id);
  }
}
