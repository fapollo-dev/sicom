import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { cancelarNfSchema, cceNfSchema, type CancelarNfDto, type CceNfDto } from '@apollo/shared';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerControle } from '../../shared/acesso/requer-acesso.decorator';
import { NfNfeService } from './nf-nfe.service';

/**
 * NF — Fase 6: ações de NFe (mod.55) atrás da porta SEFAZ. ESCRITA/EFEITO FISCAL → exigem
 * permissão (FRMNF). `transmitir` autoriza a NFe (gera chave/protocolo, STATUSNFE='P');
 * `cancelar` registra o evento de cancelamento (STATUSNFE='C', SEM tocar estoque/financeiro);
 * `cce` registra carta de correção. Mesmo path do agregado, sem conflito (sub-rotas /:id/...).
 */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfNfeController {
  constructor(private readonly nfe: NfNfeService) {}

  @Post(':id/transmitir')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'ENVIARNFE1')
  // o "Enviar NFe" fica sob o menu "NF-e" (GerarNFe1, Tag 1): sem a opção do menu, o submenu é inalcançável
  @RequerControle('FRMNF', 'GERARNFE1')
  transmitir(@Param('id', ParseIntPipe) id: number) {
    return this.nfe.transmitir(id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'CANCELARNFE1')
  @RequerControle('FRMNF', 'GERARNFE1') // idem: o "Cancelar NFe" é submenu de "NF-e"
  cancelar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(cancelarNfSchema)) dto: CancelarNfDto,
  ) {
    return this.nfe.cancelar(id, dto.xjust);
  }

  @Post(':id/cce')
  @HttpCode(200)
  @RequerAcesso('FRMNF', 'BTNCARTACORRECAO')
  cce(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(cceNfSchema)) dto: CceNfDto,
  ) {
    return this.nfe.cartaCorrecao(id, dto.correcao);
  }
}
