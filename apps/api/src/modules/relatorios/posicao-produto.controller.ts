import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  consultaProdutosSchema, kardexProdutoQuerySchema, posicaoProdutoSchema,
  type ConsultaProdutosDto, type KardexProdutoQueryDto, type PosicaoProdutoDto,
} from '@apollo/shared';
import { PosicaoProdutoService } from './posicao-produto.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONSULTA DE PRODUTOS (`FRMCONSPROD`) e ANÁLISE GERAL DO PRODUTO (`FRMPOSICAOPRODUTO`).
 * RBAC: a consulta é a tela do menu; a análise só abre de dentro dela, e tem gate próprio no legado.
 */
@Controller('relatorios/consulta-produto')
@UseGuards(AcessoGuard)
export class PosicaoProdutoController {
  constructor(private readonly svc: PosicaoProdutoService) {}

  @Get()
  @RequerAcesso('FRMCONSPROD', 'FRMCONSPROD')
  consultar(@Query(new ZodValidationPipe(consultaProdutosSchema)) q: ConsultaProdutosDto) {
    return this.svc.consultar(q);
  }

  @Get('posicao/:idproduto')
  @RequerAcesso('FRMPOSICAOPRODUTO', 'FRMPOSICAOPRODUTO')
  posicao(
    @Param('idproduto') idproduto: string,
    @Query(new ZodValidationPipe(posicaoProdutoSchema.omit({ idproduto: true }))) q: Omit<PosicaoProdutoDto, 'idproduto'>,
  ) {
    return this.svc.posicao({ ...q, idproduto: Number(idproduto) });
  }

  @Get('kardex/:idproduto')
  @RequerAcesso('FRMPOSICAOPRODUTO', 'FRMPOSICAOPRODUTO')
  kardex(
    @Param('idproduto') idproduto: string,
    @Query(new ZodValidationPipe(kardexProdutoQuerySchema)) q: KardexProdutoQueryDto,
  ) {
    return this.svc.kardex({ ...q, idproduto: Number(idproduto) });
  }
}
