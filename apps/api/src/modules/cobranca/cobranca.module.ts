import { Module } from '@nestjs/common';
import { LotesCobrancaController } from './lotes-cobranca.controller';
import { LotesMdController } from './lotes-md.controller';
import { LotesCobrancaService } from './lotes-cobranca.service';
import { LoteCobrancaRepository } from './lote-cobranca.repository';
import { AreceberController } from './areceber.controller';
import { AreceberService } from './areceber.service';
import { AreceberBaixaService } from './areceber-baixa.service';
import { ApagarController } from './apagar.controller';
import { ApagarService } from './apagar.service';
import { ApagarBaixaService } from './apagar-baixa.service';
import { CaixaController } from './caixa.controller';
import { CaixaService } from './caixa.service';
import { CaixaContabilService } from './caixa-contabil.service';
import { CaixaPdvContabilService } from './caixa-pdv-contabil.service';
import { BaixaContabilService } from './baixa-contabil.service';
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
  controllers: [LotesCobrancaController, LotesMdController, AreceberController, ApagarController, CaixaController],
  providers: [
    LotesCobrancaService, LoteCobrancaRepository,
    AreceberService, AreceberBaixaService, ApagarService, ApagarBaixaService,
    CaixaService, CaixaContabilService, CaixaPdvContabilService, BaixaContabilService,
    DatabaseProvider,
  ],
  exports: [LotesCobrancaService],
})
export class CobrancaModule {}
