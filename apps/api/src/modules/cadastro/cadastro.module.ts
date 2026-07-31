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
import { InventarioAggregateController } from './inventario.aggregate';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';
import { ScrapAggregateController } from './scrap.aggregate';
import { ScrapController } from './scrap.controller';
import { ScrapService } from './scrap.service';
import { ProducaoAggregateController } from './producao.aggregate';
import { ProducaoController } from './producao.controller';
import { ProducaoService } from './producao.service';
import { EtiquetaController } from './etiqueta.controller';
import { EtiquetaService } from './etiqueta.service';
import { ControleContasController } from './controle-contas.controller';
import { ControleContasService } from './controle-contas.service';
import { ExportaBalancaController } from './exporta-balanca.controller';
import { ExportaBalancaService } from './exporta-balanca.service';
import { OperadorasAggregateController } from './operadoras.aggregate';
import { CartaoCrudController } from './cartao.crud';
import { CartaoBaixaController } from './cartao-baixa.controller';
import { CartaoBaixaService } from './cartao-baixa.service';
import { ConciliacaoBancariaController } from './conciliacao-bancaria.controller';
import { ConciliacaoBancariaService } from './conciliacao-bancaria.service';
import { TrocaAggregateController } from './troca.aggregate';
import { TrocaController } from './troca.controller';
import { TrocaService } from './troca.service';
import { AgendaPromocaoAggregateController } from './agenda-promocao.aggregate';
import { AgendaPromocaoController } from './agenda-promocao.controller';
import { AgendaPromocaoService } from './agenda-promocao.service';
import { PerfilCrudController } from './perfil.crud';
import { PerfilRelacaoController } from './perfil-relacao.controller';
import { PerfilRelacaoService } from './perfil-relacao.service';
import { PermissoesController } from './permissoes.controller';
import { PermissoesService } from './permissoes.service';
import { SenhaOperacaoController } from './senha-operacao.controller';
import { SenhaOperacaoService } from './senha-operacao.service';
import { BairroCrudController } from './bairro.crud';
import { PrecoCrudController } from './preco.crud';
import { NcmCrudController } from './ncm.crud';
import { CidadeCrudController } from './cidade.crud';
import { ParceiroAggregateController } from './parceiro.aggregate';
import { ParceiroHistoricoController } from './parceiro-historico.controller';
import { ParceiroHistoricoService } from './parceiro-historico.service';
import { ProdutoAggregateController } from './produto.aggregate';
import { ProdutoFilhosController } from './produto-filhos.controller';
import { ProdutoFilhosService } from './produto-filhos.service';
import { ProdutoEstoqueController } from './produto-estoque.controller';
import { ProdutoEstoqueService } from './produto-estoque.service';
import { NfAggregateController } from './nf.aggregate';
import { UnidadeCrudController } from './unidade.crud';
import { FamiliasCrudController } from './familias.crud';
import { PromocaoAggregateController } from './promocao.aggregate';
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
import { ConfiguracoesAdminController } from './configuracoes-admin.controller';
import { ConfiguracoesAdminService } from './configuracoes-admin.service';
import { RazaoController } from './razao.controller';
import { RazaoService } from './razao.service';
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
    ParceiroHistoricoController, // extrato financeiro read-only (aba tsSaldoParceiros)
    ProdutoAggregateController, // engine MESTRE-DETALHE (Produto núcleo: master + codauxiliar)
    ProdutoFilhosController, // grid read-only de variações filhas (aba TsFilhos)
    ProdutoEstoqueController, // posição de estoque read-only (saldo/empresa + Kardex)
    NfAggregateController, // engine MESTRE-DETALHE (NF núcleo: header + itens + referências; SEM efeitos)
    UnidadeCrudController, // engine (lookup de apoio do Produto)
    FamiliasCrudController, // engine (lookup único G/S/D/O/R do Produto)
    AliquotaCrudController, // engine (catálogo fiscal; chave natural CODIGO)
    SituacaoNfCrudController, // engine (lookup da NF: natureza do documento)
    CfopCrudController, // engine (lookup da NF: CFOP; chave natural)
    PlcCrudController, // engine (lookup do rateio contábil da NF: centro de custo gerencial; chave natural)
    PlanoContasController, // vertical (PLANO DE CONTAS contábil — árvore/validações/travas)
    DreController, // vertical read-only (DRE contábil — relatório calculado do DIÁRIO)
    RazaoController, // vertical read-only (LIVRO RAZÃO contábil — movimentos do DIÁRIO por conta/período)
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
    InventarioAggregateController, // INVENTÁRIO (livro+itens; contagem física — planilha fiel, sem estado)
    InventarioController, // vertical: importar-produtos + diferenças + aplicar (sobrescreve estoque, gated senha ADM)
    ScrapAggregateController, // SCRAP/PERDAS (scrap+scrap_item; documento de perda — valoração MULTI_PRECO)
    ScrapController, // vertical: aplicar/estornar baixa de estoque (kardex origem='SCRAP')
    ProducaoAggregateController, // PRODUÇÃO (producao+itens_producao; requisição de manufatura — valoração MULTI_PRECO)
    ProducaoController, // vertical: processar/reverter (explode receita → baixa ingredientes + entra acabado, kardex origem='PRODUCAO')
    EtiquetaController, // ETIQUETAS DE PREÇO (fila do coletor + preço/promo server-auth de MULTI_PRECO + imprimir)
    ControleContasController, // CONTROLE DE CONTAS CORRENTES (lançamento manual + transferência 2-legged + estorno; razão mov_contas_bancarias)
    ExportaBalancaController, // EXPORTAR P/ BALANÇA (arquivos PLU Toledo TXITENS/CADASTRO/ITENSMGV p/ download)
    OperadorasAggregateController, // CARTÕES: administradora/adquirente + taxa por-empresa (operadoras+operadoras_taxa)
    CartaoCrudController, // CARTÕES: recebível (consulta/cadastro; líquido+vencimento computados na view get_cartao)
    CartaoBaixaController, // CARTÕES corte-2: baixa/liquidação em lote (credita mov_contas_bancarias) + estorno
    ConciliacaoBancariaController, // CONCILIAÇÃO BANCÁRIA (OFX): importar extrato + conciliar vs mov_contas_bancarias
    TrocaAggregateController, // TROCA c/ fornecedor (troca+itens_troca; documento mestre-detalhe, valoração MULTI_PRECO)
    TrocaController, // vertical: fechar/reabrir baixa de estoque (kardex origem='TROCA')
    AgendaPromocaoAggregateController, // AGENDA DE PROMOÇÃO (cadastro header+itens; corte-1 sem efeito)
    AgendaPromocaoController, // vertical (encerrar/reabrir a agenda)
    PromocaoAggregateController, // GESTÃO DE PROMOÇÕES (UCadPromocao): header PROMOCAO + detalhe CLUBE_DESCONTO por ORIGEM
    PerfilCrudController, // PERFIS & PERMISSÕES corte-1: CRUD de perfis (RBAC)
    PerfilRelacaoController, // vertical: atribuir perfis a operadores (relacao_operador_perfil)
    PermissoesController, // corte-2: matriz de grants FORM×OPCAO por perfil (UCtrlPermissoes)
    SenhaOperacaoController, // E7: senha de operação por empresa (definir/verificar)
    ConfiguracoesAdminController, // CONFIGURAÇÕES (UConfigura): catálogo chave-valor + overrides por escopo
    CepController, // proxy ViaCEP (autofill de endereço)
  ],
  providers: [
    BancosService,
    BancoRepository,
    ParceiroHistoricoService,
    ProdutoFilhosService,
    ProdutoEstoqueService,
    DatabaseProvider,
    ConfigService,
    ConfiguracoesAdminService,
    NfFiscalService,
    NfProcessamentoService,
    NfFaturamentoService,
    NfNfeService,
    NfContabilizacaoService,
    PlanoContasService,
    DreService,
    RazaoService,
    AjusteEstoqueService,
    InventarioService,
    ScrapService,
    ProducaoService,
    EtiquetaService,
    ControleContasService,
    ExportaBalancaService,
    TrocaService,
    CartaoBaixaService,
    ConciliacaoBancariaService,
    AgendaPromocaoService,
    PerfilRelacaoService,
    PermissoesService,
    SenhaOperacaoService,
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
  exports: [BancosService, NfFaturamentoService, ConfigService, SenhaOperacaoService], // reusados por ComprasModule (recebimento corte-4/pedido corte-final) e CobrancaModule (E7: gate de senha na baixa AR)
})
export class CadastroModule {}
