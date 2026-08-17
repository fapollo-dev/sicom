import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { manifestoListarSchema, manifestoIgnorarSchema, type ManifestoListarDto, type ManifestoIgnorarDto } from '@apollo/shared';
import { ManifestoDfeService } from './manifesto-dfe.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** MANIFESTO DO DFe (FRMMANIFESTODFE) — corte 1 local. RBAC: as opções REAIS do form (mig 148). */
@Controller('compras/manifesto-dfe')
@UseGuards(AcessoGuard)
export class ManifestoDfeController {
  constructor(private readonly svc: ManifestoDfeService) {}

  @Post('listar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNBUSCARNOTAS')
  listar(@Body(new ZodValidationPipe(manifestoListarSchema)) dto: ManifestoListarDto) {
    return this.svc.listar(dto);
  }

  @Get('eventos/:chave')
  @RequerAcesso('FRMMANIFESTODFE', 'FRMMANIFESTODFE')
  eventos(@Param('chave') chave: string) {
    return this.svc.eventos(chave);
  }

  // ignorar é uma decisão de manifestação — gate BTNMANIFESTACAO (a opção real que cobre as ações da fila)
  @Post('ignorar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNMANIFESTACAO')
  ignorar(@Body(new ZodValidationPipe(manifestoIgnorarSchema)) dto: ManifestoIgnorarDto) {
    return this.svc.ignorar(dto.codnfe_naocad, dto.motivo ?? null, dto.reverter === true);
  }

  @Get('xml/:chave')
  @RequerAcesso('FRMMANIFESTODFE', 'BTNIMPORTAR')
  xml(@Param('chave') chave: string) {
    return this.svc.xml(chave);
  }
}
