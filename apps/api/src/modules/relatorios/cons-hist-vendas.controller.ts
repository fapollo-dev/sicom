import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { consHistVendasSchema, histVendasListarSchema, type ConsHistVendasDto, type HistVendasListarDto } from '@apollo/shared';
import { ConsHistVendasService } from './cons-hist-vendas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerAcessoDeAlgum } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONSULTA DE HISTÓRICO DE VENDAS (FRMCONSHISTVENDAS) — corte-1: a consulta de um cupom.
 * RBAC: no golden o form tem UMA opção (o gate da tela), com 63 linhas / 36 operadores.
 */
@Controller('relatorios/hist-vendas')
@UseGuards(AcessoGuard)
export class ConsHistVendasController {
  constructor(private readonly svc: ConsHistVendasService) {}

  /** a consulta de um cupom — também a do "Detalhar" do kardex do produto, que abre a tela sem o gate dela (`TfrmConsHistVendas` criado
   *  de dentro do cadastro de produto) */
  @Post('consultar')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'])
  consultar(@Body(new ZodValidationPipe(consHistVendasSchema)) dto: ConsHistVendasDto) {
    return this.svc.consultar(dto);
  }

  /** o pedido de BALCÃO (o "Detalhar" do kardex do produto): os itens da PEDIDOS e as finalizadoras da CX_PEDIDOS */
  @Post('consultar-pedido')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'])
  consultarPedido(@Body() body: { nropedido?: string }) {
    const nro = String(body?.nropedido ?? '').trim();
    if (!nro) throw new BusinessRuleError('PEDIDO_NAO_INFORMADO');
    return this.svc.consultarPedido(nro);
  }

  /** o "Imprimir" (cupom ou pedido de balcão) e o "V.Troca" (os itens marcados) — os layouts .fr3 do cliente */
  @Post('impressao/:modo')
  @HttpCode(200)
  @RequerAcessoDeAlgum(['FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'])
  impressao(@Param('modo') modo: string, @Body() body: Record<string, unknown>) {
    if (modo !== 'cupom' && modo !== 'pedido' && modo !== 'vale-troca') throw new BusinessRuleError('RELATORIO_DESCONHECIDO', { modo });
    const itens = Array.isArray(body?.itens)
      ? (body.itens as Array<{ nroitem?: unknown; qtd_troca?: unknown }>)
          .map((m) => ({ nroitem: Number(m?.nroitem), qtd_troca: m?.qtd_troca == null ? null : Number(m.qtd_troca) }))
          .filter((m) => Number.isInteger(m.nroitem))
      : undefined;
    if (modo === 'pedido') return this.svc.impressao(modo, { nropedido: String(body?.nropedido ?? '').trim() } as never);
    const dto = consHistVendasSchema.parse(body);
    return this.svc.impressao(modo, { ...dto, itens });
  }

  /** a LISTA de vendas do período (o botão de pesquisa do legado, sobre GET_HIST_VENDAS). */
  @Post('listar')
  @HttpCode(200)
  @RequerAcesso('FRMCONSHISTVENDAS', 'FRMCONSHISTVENDAS')
  listar(@Body(new ZodValidationPipe(histVendasListarSchema)) dto: HistVendasListarDto) {
    return this.svc.listar(dto);
  }
}
