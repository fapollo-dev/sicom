import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import {
  criarLoteRotativoSchema, alterarLoteRotativoSchema, fecharLoteRotativoSchema,
  type CriarLoteRotativoDto, type AlterarLoteRotativoDto, type FecharLoteRotativoDto,
} from '@apollo/shared';
import { InventarioRotativoService } from './inventario-rotativo.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * INVENTÁRIO ROTATIVO (FRMRELINVENTARIOROTATIVO) — corte-1: o lote e seu ciclo. As opções de RBAC são as três do
 * golden: o gate da tela, BTNNOVOLOTE (abrir/alterar) e BTNFECHARINVENTARIO (fechar).
 */
@Controller('cadastro/inventario-rotativo')
@UseGuards(AcessoGuard)
export class InventarioRotativoController {
  constructor(private readonly svc: InventarioRotativoService) {}

  /** lotes da empresa com o estado DERIVADO (aberto = tem ABERTO e não tem FECHADO). */
  @Get()
  @RequerAcesso('FRMRELINVENTARIOROTATIVO', 'FRMRELINVENTARIOROTATIVO')
  listar() {
    return this.svc.listarLotes();
  }

  /** abre um lote (nome obrigatório + filtros opcionais + departamentos). */
  @Post()
  @HttpCode(201)
  @RequerAcesso('FRMRELINVENTARIOROTATIVO', 'BTNNOVOLOTE')
  criar(@Body(new ZodValidationPipe(criarLoteRotativoSchema)) body: CriarLoteRotativoDto) {
    return this.svc.criarLote(body);
  }

  /** altera o cabeçalho do lote ABERTO (o legado não recria os departamentos na alteração). */
  @Put(':codinv')
  @RequerAcesso('FRMRELINVENTARIOROTATIVO', 'BTNNOVOLOTE')
  alterar(
    @Param('codinv', ParseIntPipe) codinv: number,
    @Body(new ZodValidationPipe(alterarLoteRotativoSchema)) body: AlterarLoteRotativoDto,
  ) {
    return this.svc.alterarLote(codinv, body);
  }

  /** fecha: sem `lote` cria número novo e carimba as coletas órfãs; com `lote` copia o cabeçalho do ABERTO. */
  @Post('fechar')
  @HttpCode(200)
  @RequerAcesso('FRMRELINVENTARIOROTATIVO', 'BTNFECHARINVENTARIO')
  fechar(@Body(new ZodValidationPipe(fecharLoteRotativoSchema)) body: FecharLoteRotativoDto) {
    return this.svc.fecharLote(body);
  }
}
