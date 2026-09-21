import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  cclassTribNcmConsultaSchema, classTribSchema, cstIbsCbsSchema, ibsUfSchema, reformaConsultaSchema,
  type CclassTribNcmConsultaDto, type ClassTribDto, type CstIbsCbsDto, type IbsUfDto,
  type ReformaConsultaDto,
} from '@apollo/shared';
import { ReformaIbsCbsService } from './reforma-ibscbs.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** REFORMA TRIBUTÁRIA IBS/CBS — cadastros (`FRMCADCSTIBSCBS` e `FRMCADCLASSTRIBIBSCBS`). */
@Controller('cadastro/reforma-ibscbs')
@UseGuards(AcessoGuard)
export class ReformaIbsCbsController {
  constructor(private readonly svc: ReformaIbsCbsService) {}

  @Get('cst') @RequerAcesso('FRMCADCSTIBSCBS', 'FRMCADCSTIBSCBS')
  listarCst(@Query(new ZodValidationPipe(reformaConsultaSchema)) q: ReformaConsultaDto) { return this.svc.listarCst(q); }

  @Post('cst') @HttpCode(200) @RequerAcesso('FRMCADCSTIBSCBS', 'FRMCADCSTIBSCBS')
  gravarCst(@Body(new ZodValidationPipe(cstIbsCbsSchema)) b: CstIbsCbsDto) { return this.svc.gravarCst(b); }

  @Get('class-trib') @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'FRMCADCLASSTRIBIBSCBS')
  listarClassTrib(@Query(new ZodValidationPipe(reformaConsultaSchema)) q: ReformaConsultaDto) { return this.svc.listarClassTrib(q); }

  @Post('class-trib') @HttpCode(200) @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'BTNGRAVAR')
  gravarClassTrib(@Body(new ZodValidationPipe(classTribSchema)) b: ClassTribDto) { return this.svc.gravarClassTrib(b); }

  @Delete('class-trib/:id') @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'BTNEXCLUIR')
  excluirClassTrib(@Param('id', ParseIntPipe) id: number) { return this.svc.excluirClassTrib(id); }

  @Get('ncm') @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'FRMCADCLASSTRIBIBSCBS')
  ncm(@Query(new ZodValidationPipe(cclassTribNcmConsultaSchema)) q: CclassTribNcmConsultaDto) { return this.svc.ncmDaClassificacao(q); }

  @Get('ibs-uf') @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'FRMCADCLASSTRIBIBSCBS')
  listarIbsUf() { return this.svc.listarIbsUf(); }

  @Post('ibs-uf') @HttpCode(200) @RequerAcesso('FRMCADCLASSTRIBIBSCBS', 'BTNGRAVAR')
  gravarIbsUf(@Body(new ZodValidationPipe(ibsUfSchema)) b: IbsUfDto) { return this.svc.gravarIbsUf(b); }
}
