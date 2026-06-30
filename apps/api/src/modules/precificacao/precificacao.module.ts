import { Module } from '@nestjs/common';
import { PrecificacaoController } from './precificacao.controller';
import { PrecoService } from './preco.service';
import { FiscalPricingService } from './preco-fiscal.service';
import { TributacaoRepository } from './tributacao.repository';
import { PrecificacaoProdutoService } from './precificacao-produto.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

@Module({
  controllers: [PrecificacaoController],
  providers: [
    PrecoService,
    FiscalPricingService,
    TributacaoRepository,
    PrecificacaoProdutoService,
    DatabaseProvider,
  ],
  exports: [PrecoService, FiscalPricingService, PrecificacaoProdutoService, TributacaoRepository],
})
export class PrecificacaoModule {}
