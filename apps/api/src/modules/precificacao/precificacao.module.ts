import { Module } from '@nestjs/common';
import { PrecificacaoController } from './precificacao.controller';
import { PrecificacaoNfController } from './precificacao-nf.controller';
import { PrecificacaoNfService } from './precificacao-nf.service';
import { PrecoService } from './preco.service';
import { FiscalPricingService } from './preco-fiscal.service';
import { TributacaoRepository } from './tributacao.repository';
import { PrecificacaoProdutoService } from './precificacao-produto.service';
import { PrecificacaoCustoService } from './precificacao-custo.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

@Module({
  controllers: [PrecificacaoController, PrecificacaoNfController],
  providers: [
    PrecoService,
    FiscalPricingService,
    TributacaoRepository,
    PrecificacaoProdutoService,
    PrecificacaoCustoService,
    ConfigService,
    DatabaseProvider,
    PrecificacaoNfService,
  ],
  exports: [PrecoService, FiscalPricingService, PrecificacaoProdutoService, TributacaoRepository],
})
export class PrecificacaoModule {}
