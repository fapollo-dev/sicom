import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { congelaEstoqueSchema, type CongelaEstoqueDto } from '@apollo/shared';
import { CongelaEstoqueService } from './congela-estoque.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONGELAR / DESCONGELAR ESTOQUE (`FRMCONGELAESTOQUE`).
 * O legado pede liberação separada para cada lado ("Usuário não possui permissão para congelar/descongelar
 * estoque") — aqui são dois grants distintos.
 */
@Controller('cadastro/congela-estoque')
@UseGuards(AcessoGuard)
export class CongelaEstoqueController {
  constructor(private readonly svc: CongelaEstoqueService) {}

  @Get()
  @RequerAcesso('FRMCONGELAESTOQUE', 'FRMCONGELAESTOQUE')
  situacao() { return this.svc.situacao(); }

  @Post('congelar')
  @RequerAcesso('FRMCONGELAESTOQUE', 'BTNCONGELAR')
  congelar() { return this.svc.executar({ acao: 'CONGELAR' }); }

  @Post('descongelar')
  @RequerAcesso('FRMCONGELAESTOQUE', 'BTNDESCONGELAR')
  descongelar(@Body(new ZodValidationPipe(congelaEstoqueSchema.partial())) _b: Partial<CongelaEstoqueDto>) { return this.svc.executar({ acao: 'DESCONGELAR' }); }
}
