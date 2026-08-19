import { Module } from '@nestjs/common';
import { LotesCobrancaController } from './lotes-cobranca.controller';
import { LotesMdController } from './lotes-md.controller';
import { LotesCobrancaService } from './lotes-cobranca.service';
import { LoteCobrancaRepository } from './lote-cobranca.repository';
import { AreceberController } from './areceber.controller';
import { AreceberService } from './areceber.service';
import { AreceberBaixaService } from './areceber-baixa.service';
import { AreceberAgrupamentoService } from './areceber-agrupamento.service';
import { ApagarAgrupamentoService } from './apagar-agrupamento.service';
import { ApagarController } from './apagar.controller';
import { ApagarService } from './apagar.service';
import { ApagarBaixaService } from './apagar-baixa.service';
import { CaixaController } from './caixa.controller';
import { CaixaService } from './caixa.service';
import { CaixaContabilService } from './caixa-contabil.service';
import { CaixaPdvContabilService } from './caixa-pdv-contabil.service';
import { CaixaConferenciaService } from './caixa-conferencia.service';
import { BaixaContabilService } from './baixa-contabil.service';
import { CnabRemessaController } from './cnab-remessa.controller';
import { CnabRemessaService } from './cnab-remessa.service';
import { AdiantamentoFornController } from './adiantamento-forn.controller';
import { AdiantamentoFornService } from './adiantamento-forn.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { CadastroModule } from '../cadastro/cadastro.module';

@Module({
  // E7: reusa SenhaOperacaoService (exportado por CadastroModule) para o gate de senha de DESCONTO na baixa AR.
  imports: [CadastroModule],
  // LotesMdController (cobranca/lotes-md) substitui o controller genérico da fábrica:
  // mesmo caminho/RBAC e mesmas transações (engine), mas READ enriquecido (master+RAZAO+
  // itens com display columns + juros/total) e validação do "Cobrador" FUN='S'.
  // AreceberController (cadastro/areceber) = CONTAS A RECEBER; ApagarController (cadastro/apagar) = A PAGAR.
  // CaixaController (cobranca/caixa) = CAIXA (sessão + movimento manual, corte-1).
  // AdiantamentoFornController (financeiro/adiantamentos) = ADIANTAMENTO A FORNECEDOR/PARCEIRO: movimento na conta
  // corrente + título gerado (areceber no tipo 'D', apagar em 'C'/'E').
  controllers: [LotesCobrancaController, LotesMdController, AreceberController, ApagarController, CaixaController, CnabRemessaController, AdiantamentoFornController],
  providers: [
    LotesCobrancaService, LoteCobrancaRepository,
    AreceberService, AreceberBaixaService, AreceberAgrupamentoService, ApagarService, ApagarBaixaService, ApagarAgrupamentoService,
    CaixaService, CaixaContabilService, CaixaPdvContabilService, CaixaConferenciaService, BaixaContabilService,
    CnabRemessaService, AdiantamentoFornService, ConfigService,
    DatabaseProvider,
  ],
  exports: [LotesCobrancaService],
})
export class CobrancaModule {}
