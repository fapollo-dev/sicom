import { Module } from '@nestjs/common';
import { BancosController } from './bancos.controller';
import { BancosService } from './bancos.service';
import { BancoRepository } from './banco.repository';
import { OperacoesContaCrudController } from './operacoes-conta.crud';
import { ContasBancariasCrudController } from './contas-bancarias.crud';
import { MarcasCrudController } from './marcas.crud';
import { MotivosOperacaoCrudController } from './motivos-operacao.crud';
import { AjusteEstoqueController } from './ajuste-estoque.controller';
import { AjusteEstoqueService } from './ajuste-estoque.service';
import { AgendaPromocaoAggregateController } from './agenda-promocao.aggregate';
import { AgendaPromocaoController } from './agenda-promocao.controller';
import { AgendaPromocaoService } from './agenda-promocao.service';
import { BairroCrudController } from './bairro.crud';
import { PrecoCrudController } from './preco.crud';
import { NcmCrudController } from './ncm.crud';
import { CidadeCrudController } from './cidade.crud';
import { ParceiroAggregateController } from './parceiro.aggregate';
import { ProdutoAggregateController } from './produto.aggregate';
import { NfAggregateController } from './nf.aggregate';
import { UnidadeCrudController } from './unidade.crud';
import { FamiliasCrudController } from './familias.crud';
import { AliquotaCrudController } from './aliquota.crud';
import { SituacaoNfCrudController } from './situacao-nf.crud';
import { CfopCrudController } from './cfop.crud';
import { PlcCrudController } from './plc.crud';
import { PlanoContasController } from './plano-contas.controller';
import { PlanoContasService } from './plano-contas.service';
import { DreController } from './dre.controller';
import { DreService } from './dre.service';
import { EmpresasCrudController } from './empresas.crud';
import { OperadoresAggregateController } from './operadores.aggregate';
import { FormasPgtoCrudController } from './formas-pgto.crud';
import { NfFiscalController } from './nf-fiscal.controller';
import { NfFiscalService } from './nf-fiscal.service';
import { ConfigService } from './config.service';
import { NfProcessamentoController } from './nf-processamento.controller';
import { NfProcessamentoService } from './nf-processamento.service';
import { NfFaturamentoController } from './nf-faturamento.controller';
import { NfFaturamentoService } from './nf-faturamento.service';
import { NfNfeController } from './nf-nfe.controller';
import { NfNfeService } from './nf-nfe.service';
import { NfContabilizacaoController } from './nf-contabilizacao.controller';
import { NfContabilizacaoService } from './nf-contabilizacao.service';
import { SEFAZ_PORT } from './sefaz/sefaz.port';
import { SimuladorSefazProvider } from './sefaz/simulador.provider';
import { CepController } from './cep.controller';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { PrecificacaoModule } from '../precificacao/precificacao.module';

/**
 * Cadastros. Bancos é hand-written (piloto de referência, com golden de runtime).
 * Operações de Conta, Contas Bancárias e Marcas são DECLARATIVAS (engine CRUD) —
 * cada uma é só uma config; o engine herda auditoria/soft-delete/outbox/RBAC.
 */
@Module({
  imports: [PrecificacaoModule], // reuso do motor fiscal (TributacaoRepository/FiscalPricingService) na NF F2
  controllers: [
    BancosController, // hand-written (referência + paridade SQL + golden)
    OperacoesContaCrudController, // engine (combo)
    ContasBancariasCrudController, // engine (FK/lookup)
    MarcasCrudController, // engine (soft-delete)
    BairroCrudController, // engine (1ª herdeira completa: texto+combo+flag via <CadMaster>)
    PrecoCrudController, // engine (palette completo: número/moeda + checkbox)
    NcmCrudController, // engine (CHAVE NATURAL + data + memo)
    CidadeCrudController, // engine (chave natural; alvo do lookup de Bairros)
    ParceiroAggregateController, // engine MESTRE-DETALHE (Parceiros unificado: master + endereços)
    ProdutoAggregateController, // engine MESTRE-DETALHE (Produto núcleo: master + codauxiliar)
    NfAggregateController, // engine MESTRE-DETALHE (NF núcleo: header + itens + referências; SEM efeitos)
    UnidadeCrudController, // engine (lookup de apoio do Produto)
    FamiliasCrudController, // engine (lookup único G/S/D/O/R do Produto)
    AliquotaCrudController, // engine (catálogo fiscal; chave natural CODIGO)
    SituacaoNfCrudController, // engine (lookup da NF: natureza do documento)
    CfopCrudController, // engine (lookup da NF: CFOP; chave natural)
    PlcCrudController, // engine (lookup do rateio contábil da NF: centro de custo gerencial; chave natural)
    PlanoContasController, // vertical (PLANO DE CONTAS contábil — árvore/validações/travas)
    DreController, // vertical read-only (DRE contábil — relatório calculado do DIÁRIO)
    EmpresasCrudController, // engine (cadastro da empresa/tenant: núcleo+fiscal+precificação; pk digitada, não-empresaScoped)
    OperadoresAggregateController, // mestre-detalhe (OPERADORES + empresas-permitidas; global, pk digitada, soft-delete INDR)
    FormasPgtoCrudController, // engine (FORMAS DE PAGAMENTO; empresaScoped, 3 vínculos p/ Caixa corte-2d)
    NfFiscalController, // F2 — recálculo fiscal por item (POST /fiscal/nf/recalcular), reusa precificacao
    NfProcessamentoController, // F3 — processar/reverter (move estoque atômico)
    NfFaturamentoController, // F4 — faturar/estornar (gera títulos ARECEBER/APAGAR atômico)
    NfNfeController, // F6 — NFe mod.55 (transmitir/cancelar/cce) atrás da porta SEFAZ
    NfContabilizacaoController, // F5b — contabilizar/estornar (gera/estorna o DIÁRIO — partida dobrada)
    MotivosOperacaoCrudController, // engine (lookup do motivo do ajuste; soft-delete)
    AjusteEstoqueController, // vertical (AJUSTE DE ESTOQUE — move o saldo + kardex; sem contábil)
    AgendaPromocaoAggregateController, // AGENDA DE PROMOÇÃO (cadastro header+itens; corte-1 sem efeito)
    AgendaPromocaoController, // vertical (encerrar/reabrir a agenda)
    CepController, // proxy ViaCEP (autofill de endereço)
  ],
  providers: [
    BancosService,
    BancoRepository,
    DatabaseProvider,
    ConfigService,
    NfFiscalService,
    NfProcessamentoService,
    NfFaturamentoService,
    NfNfeService,
    NfContabilizacaoService,
    PlanoContasService,
    DreService,
    AjusteEstoqueService,
    AgendaPromocaoService,
    // Porta SEFAZ (F6): seleção REAL por env SEFAZ_PROVIDER (default 'simulador'). Hoje só existe
    // o SIMULADOR (homologação); o provider real (ACBrLibNFe/lib NFe Node/microserviço) implementa
    // a mesma SefazPort e entra aqui sem tocar no service. Travas: 'simulador' é PROIBIDO em
    // produção (NODE_ENV='production') e qualquer outro valor falha (o real ainda não existe) —
    // assim nunca se transmite de mentira em produção nem se assume um provider inexistente.
    {
      provide: SEFAZ_PORT,
      useFactory: () => {
        const provider = (process.env.SEFAZ_PROVIDER ?? 'simulador').toLowerCase();
        if (provider === 'simulador') {
          if (process.env.NODE_ENV === 'production') {
            throw new Error(
              "SEFAZ_PROVIDER='simulador' é proibido em produção (NODE_ENV=production): configure o provider real de SEFAZ.",
            );
          }
          return new SimuladorSefazProvider();
        }
        throw new Error(
          `SEFAZ_PROVIDER='${provider}' indisponível: o provider real de SEFAZ ainda não foi implementado (F6b). Use 'simulador' (homologação).`,
        );
      },
    },
  ],
  exports: [BancosService, NfFaturamentoService, ConfigService], // reusados pelo ComprasModule (recebimento corte-4 / pedido corte-final)
})
export class CadastroModule {}
