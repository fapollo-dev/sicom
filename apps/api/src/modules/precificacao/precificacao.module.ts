import { HistProcNfController } from './hist-proc-nf.controller';
import { HistProcNfService } from './hist-proc-nf.service';
import { ClubeDescontoController } from './clube-desconto.controller';
import { ClubeDescontoService } from './clube-desconto.service';
import { Module } from '@nestjs/common';
import { PrecificacaoController } from './precificacao.controller';
import { PrecificacaoNfController } from './precificacao-nf.controller';
import { PrecificacaoNfBrutaController } from './precificacao-nf-bruta.controller';
import { PrecificacaoNfBrutaService } from './precificacao-nf-bruta.service';
import { PrecificacaoNfService } from './precificacao-nf.service';
import { PrecoService } from './preco.service';
import { FiscalPricingService } from './preco-fiscal.service';
import { TributacaoRepository } from './tributacao.repository';
import { PrecificacaoProdutoService } from './precificacao-produto.service';
import { PrecificacaoCustoService } from './precificacao-custo.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

@Module({
  controllers: [HistProcNfController, ClubeDescontoController, 
    // FRMPRECIFICACAONFBRUTA — a irmã enxuta da precificação por NF
    PrecificacaoNfBrutaController,
    PrecificacaoController,
    PrecificacaoNfController,
  ],
  providers: [HistProcNfService, ClubeDescontoService, 
    PrecificacaoNfBrutaService,
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
