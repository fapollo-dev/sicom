import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { consultoriaAtmSchema, consultoriaSchema, type ConsultoriaAtmDto, type ConsultoriaDto } from '@apollo/shared';
import { ConsultoriaService } from './consultoria.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) — participação e rentabilidade por nível. RBAC: gate de tela. */
@Controller('relatorios/consultoria')
@UseGuards(AcessoGuard)
export class ConsultoriaController {
  constructor(private readonly svc: ConsultoriaService) {}

  @Get()
  @RequerAcesso('FRMCONSULTORIAATM', 'FRMCONSULTORIAATM')
  participacao(@Query(new ZodValidationPipe(consultoriaSchema)) q: ConsultoriaDto) {
    return this.svc.participacao({ nivel: q.nivel, dataIni: q.dataIni, dataFim: q.dataFim });
  }

  /** o `CmbRelatorio`: os layouts `at&m_*` da RELATORIOS (sem os da rentabilidade da família e sem o faturamento × rentabilidade) */
  @Get('layouts')
  @RequerAcesso('FRMCONSULTORIAATM', 'FRMCONSULTORIAATM')
  layouts() {
    return this.svc.layouts();
  }

  /** a pré-visualização do layout escolhido: a participação dos setores ou o ranking por famílias */
  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMCONSULTORIAATM', 'FRMCONSULTORIAATM')
  async consultar(@Body(new ZodValidationPipe(consultoriaAtmSchema)) dto: ConsultoriaAtmDto) {
    const nome = dto.arquivo.toLowerCase();
    if (nome.includes('ranking_geral_por_familias')) return { tipo: 'RANKING', ...(await this.svc.rankingFamilias(dto)) };
    if (nome.includes('participacao')) return { tipo: 'PARTICIPACAO', ...(await this.svc.participacaoSetores({ ...dto, plc: nome === 'at&m_participacao_dos_setores.fr3' ? dto.plc : null })) };
    return this.svc.impressao(dto).then(() => ({ tipo: 'NENHUM' }));
  }

  /** «Imprimir»: o layout com os dados e as variáveis do legado (o btnImprimir não tem opção própria — só o acesso à tela) */
  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMCONSULTORIAATM', 'FRMCONSULTORIAATM')
  impressao(@Body(new ZodValidationPipe(consultoriaAtmSchema)) dto: ConsultoriaAtmDto) {
    return this.svc.impressao(dto);
  }
}
