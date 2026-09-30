import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { conferenciaAprovarSchema, conferenciaCancelarSchema, type ConferenciaAprovarDto, type ConferenciaCancelarDto } from '@apollo/shared';
import { ConferenciaNotaService } from './conferencia-nota.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcessoDeAlgum } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONFERÊNCIA DE NOTA FISCAL (FRMCONFERENCIANOTA) — corte-1. RBAC: gate de tela (a única opção do form no Oracle).
 * A APROVAÇÃO tem gate próprio por LIBERAÇÃO de supervisor (config USUARIOS_APROVAM_CONFERENCIA_NOTA).
 */
const impressaoListaSchema = z.object({ tipo: z.enum(['lista', 'usuarios']), selecionados: z.array(z.number().int()).default([]) });
const relatorioDiferencasSchema = z.object({
  tipo: z.enum(['fornecedor', 'produto']),
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), horaIni: z.string().optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), horaFim: z.string().optional(),
  codparceiro: z.number().int().nullish(), coddpto: z.number().int().nullish(), codgrupo: z.number().int().nullish(), codproduto: z.number().int().nullish(),
});

@Controller('compras/conferencia-nota')
@UseGuards(AcessoGuard)
export class ConferenciaNotaController {
  constructor(private readonly svc: ConferenciaNotaService) {}

  /** itens da NF com o que o coletor conferiu + contadores (aprovados / pendentes / conferidos). */
  @Get(':codnf')
  @RequerAcessoDeAlgum(['FRMMANIFESTODFE', 'FRMMANIFESTODFE'], ['FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA'])
  listar(@Param('codnf', ParseIntPipe) codnf: number) {
    return this.svc.listar(codnf);
  }

  /** aprova os itens selecionados — exige login+senha de um AUTORIZADOR da lista. */
  @Post('aprovar')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMMANIFESTODFE', 'FRMMANIFESTODFE'], ['FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA'])
  aprovar(@Body(new ZodValidationPipe(conferenciaAprovarSchema)) dto: ConferenciaAprovarDto) {
    return this.svc.aprovar(dto);
  }

  /** "Análise produto": os itens selecionados voltam a LIBERADO (a esteira desmarca coleta e conferência). */
  @Post('analisar')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMMANIFESTODFE', 'FRMMANIFESTODFE'], ['FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA'])
  analisar(@Body(new ZodValidationPipe(conferenciaCancelarSchema)) dto: ConferenciaCancelarDto) {
    return this.svc.analisar(dto);
  }

  /** cancela a aprovação dos itens selecionados (volta a pendente). */
  @Post('cancelar')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMMANIFESTODFE', 'FRMMANIFESTODFE'], ['FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA'])
  cancelar(@Body(new ZodValidationPipe(conferenciaCancelarSchema)) dto: ConferenciaCancelarDto) {
    return this.svc.cancelar(dto);
  }

  /** "Lista de Conferência" / "Lista de Conferência Usuários" do menu Imprimir (os itens marcados, por descrição). */
  @Post(':codnf/impressao')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMMANIFESTODFE', 'FRMMANIFESTODFE'], ['FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA'])
  impressaoLista(@Param('codnf', ParseIntPipe) codnf: number, @Body(new ZodValidationPipe(impressaoListaSchema)) dto: z.infer<typeof impressaoListaSchema>) {
    return this.svc.impressaoLista(codnf, dto.tipo, dto.selecionados);
  }

  /** "Relatório" do menu Imprimir: as entradas com coleta divergente por fornecedor ou por produto. */
  @Post('relatorio-diferencas')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMMANIFESTODFE', 'FRMMANIFESTODFE'], ['FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA'])
  relatorioDiferencas(@Body(new ZodValidationPipe(relatorioDiferencasSchema)) dto: z.infer<typeof relatorioDiferencasSchema>) {
    return this.svc.relatorioDiferencas(dto);
  }
}
