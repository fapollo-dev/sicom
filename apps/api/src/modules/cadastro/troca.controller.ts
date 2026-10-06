import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { TrocaService } from './troca.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * TROCA DE MERCADORIA COM FORNECEDOR — ações verticais de estoque: fechar (baixa a mercadoria avariada que sai) e
 * reabrir (estorna). Convivem no caminho `cadastro/troca` do agregado (CRUD do documento). Decopladas do gravar,
 * como o Scrap/Inventário.
 */
@Controller('cadastro/troca')
@UseGuards(AcessoGuard)
export class TrocaController {
  constructor(private readonly svc: TrocaService) {}

  /**
   * o "Imprimir troca" do botão Relatório: a troca no extr - Troca.fr3 do cliente. Sem opção própria: a mesma regra de LER a troca
   * (o GET do agregado), e a produção não tem nenhuma linha de PERMISSOES para este formulário.
   */
  @Get(':id/impressao')
  impressao(@Param('id', ParseIntPipe) id: number) {
    return this.svc.impressao(id);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @RequerAcesso('FRMTROCAMERCADORIAFOR', 'BTNGRAVAR')
  fechar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.fechar(id);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  @RequerAcesso('FRMTROCAMERCADORIAFOR', 'BTNEXCLUIR')
  reabrir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reabrir(id);
  }
}
