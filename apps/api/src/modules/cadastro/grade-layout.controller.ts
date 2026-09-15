import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { gradeLayoutSalvarSchema, type GradeLayoutSalvarDto } from '@apollo/shared';
import { GradeLayoutService } from './grade-layout.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * LAYOUT DA GRADE — o [F8]/[F9] do legado, para todas as telas.
 *
 * ⚠️ **sem `AcessoGuard` de propósito**: o layout é do próprio operador e não é privilégio de tela nenhuma.
 * Exigir permissão aqui impediria de salvar a grade justamente em quem só tem acesso a uma tela. O escopo é
 * garantido pelo serviço, que só enxerga o operador da sessão.
 */
@Controller('cadastro/grade-layout')
export class GradeLayoutController {
  constructor(private readonly svc: GradeLayoutService) {}

  @Get()
  listar(@Query('tela') tela: string) {
    return this.svc.listar(String(tela ?? ''));
  }

  @Post()
  salvar(@Body(new ZodValidationPipe(gradeLayoutSalvarSchema)) b: GradeLayoutSalvarDto) {
    return this.svc.salvar(b.tela, { id: b.id, name: b.name ?? null, isPublic: b.isPublic ?? false, state: b.state });
  }

  @Delete(':tela/:viewId')
  excluir(@Param('tela') tela: string, @Param('viewId') viewId: string) {
    return this.svc.excluir(tela, viewId);
  }
}
