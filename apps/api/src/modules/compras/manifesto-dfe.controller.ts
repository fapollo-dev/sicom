import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { manifestoListarSchema, manifestoIgnorarSchema, type ManifestoListarDto, type ManifestoIgnorarDto } from '@apollo/shared';
import { ManifestoDfeService } from './manifesto-dfe.service';
import { SefazDfeService, EVENTOS_MANIFESTO } from './sefaz-dfe.service';
import { manifestarSchema, type ManifestarDto } from '@apollo/shared';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** MANIFESTO DO DFe (FRMMANIFESTODFE) — corte 1 local. RBAC: as opções REAIS do form (mig 148). */
@Controller('compras/manifesto-dfe')
@UseGuards(AcessoGuard)
export class ManifestoDfeController {
  constructor(
    private readonly svc: ManifestoDfeService,
    private readonly sefaz: SefazDfeService,
  ) {}

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

  /** corte 2 — busca notas novas na SEFAZ (distribuição DF-e por último NSU). */
  @Post('sincronizar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNBUSCARNOTAS')
  sincronizar() {
    return this.sefaz.sincronizar();
  }

  /** corte 2 — envia o evento de manifestação (ciência/confirmação/desconhecimento/op. não realizada). */
  @Post('manifestar')
  @HttpCode(200)
  @RequerAcesso('FRMMANIFESTODFE', 'BTNMANIFESTACAO')
  manifestar(@Body(new ZodValidationPipe(manifestarSchema)) dto: ManifestarDto) {
    return this.sefaz.manifestar(dto.chave, dto.evento as keyof typeof EVENTOS_MANIFESTO, dto.justificativa);
  }

  @Get('xml/:chave')
  @RequerAcesso('FRMMANIFESTODFE', 'BTNIMPORTAR')
  xml(@Param('chave') chave: string) {
    return this.svc.xml(chave);
  }
}
