import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { NfImpressaoService, RELATORIOS_NF, type RelatorioNf } from './nf-impressao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerControle } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

/** AS IMPRESSÕES DA NF (o menu da tela): o modelo .fr3 da RELATORIOS e os datasets do legado, desenhados no navegador. */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfImpressaoController {
  constructor(private readonly svc: NfImpressaoService) {}

  @Get(':id/impressao/:relatorio')
  @RequerAcesso('FRMNF', 'FRMNF')
  imprimir(@Param('id', ParseIntPipe) id: number, @Param('relatorio') relatorio: string) {
    // o DANFE tem as rotas dele, com as permissões de controle do menu e do botão
    if (!(relatorio in RELATORIOS_NF) || relatorio === 'danfe') throw new BusinessRuleError('RELATORIO_NF_DESCONHECIDO', { relatorio });
    return this.svc.imprimir(id, relatorio as RelatorioNf);
  }

  /** "Imprimir DANFE" do menu "NF-e" (ImprimirDANFE1, Tag 1, submenu de GerarNFe1, Tag 1: sem as duas opções o item é inalcançável) */
  @Get(':id/danfe')
  @RequerAcesso('FRMNF', 'FRMNF')
  @RequerControle('FRMNF', 'GERARNFE1', 'IMPRIMIRDANFE1')
  danfe(@Param('id', ParseIntPipe) id: number) {
    return this.svc.imprimir(id, 'danfe');
  }

  /** o botão "Imprimir" do rodapé NF-e (btnImprimirNFe, Tag 1): passa pelo `LinhaComandosNfeLiberada` antes do DANFE */
  @Get(':id/danfe-rodape')
  @RequerAcesso('FRMNF', 'FRMNF')
  @RequerControle('FRMNF', 'BTNIMPRIMIRNFE')
  danfeRodape(@Param('id', ParseIntPipe) id: number) {
    return this.svc.imprimir(id, 'danfe', { rodape: true });
  }

  /** o botão "Conf. Preço" da grade do Manifesto (UManifestoDFe.pas:821), habilitado na nota cadastrada — a conferência simplificada */
  @Get(':id/conferencia-preco-manifesto')
  @RequerAcesso('FRMMANIFESTODFE', 'FRMMANIFESTODFE')
  conferenciaPrecoManifesto(@Param('id', ParseIntPipe) id: number) {
    return this.svc.imprimir(id, 'conferencia-preco-simples');
  }
}
