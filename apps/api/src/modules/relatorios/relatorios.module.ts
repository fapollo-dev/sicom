import { Module } from '@nestjs/common';
import { RelVendasController } from './rel-vendas.controller';
import { RelVendasService } from './rel-vendas.service';
import { PreviaFornecedorController } from './previa-fornecedor.controller';
import { PreviaFornecedorService } from './previa-fornecedor.service';
import { RelFinalizadorasController } from './rel-finalizadoras.controller';
import { RelFinalizadorasService } from './rel-finalizadoras.service';
import { RelTicketMedioController } from './rel-ticket-medio.controller';
import { RelTicketMedioService } from './rel-ticket-medio.service';
import { RelCaixaDreController } from './rel-caixa-dre.controller';
import { RelCaixaDreService } from './rel-caixa-dre.service';
import { RelSemMovimentoController } from './rel-sem-movimento.controller';
import { RelSemMovimentoService } from './rel-sem-movimento.service';
import { RelCurvaAbcController } from './rel-curva-abc.controller';
import { RelCurvaAbcService } from './rel-curva-abc.service';
import { RelVendasDataController } from './rel-vendas-data.controller';
import { RelVendasDataService } from './rel-vendas-data.service';
import { RelVendasDepartamentoController } from './rel-vendas-departamento.controller';
import { RelVendasDepartamentoService } from './rel-vendas-departamento.service';
import { RelVendasHoraController } from './rel-vendas-hora.controller';
import { RelVendasHoraService } from './rel-vendas-hora.service';
import { RelFormasPgtoController } from './rel-formas-pgto.controller';
import { RelFormasPgtoService } from './rel-formas-pgto.service';
import { RelVendasOperadorController } from './rel-vendas-operador.controller';
import { RelVendasOperadorService } from './rel-vendas-operador.service';
import { RelCaixaOpsController } from './rel-caixa-ops.controller';
import { RelCaixaOpsService } from './rel-caixa-ops.service';
import { RelCanceladosController } from './rel-cancelados.controller';
import { RelCanceladosService } from './rel-cancelados.service';
import { RelVendasExtrasController } from './rel-vendas-extras.controller';
import { RelVendasExtrasService } from './rel-vendas-extras.service';
import { RelatorioConstrutorController } from './relatorio-construtor.controller';
import { RelatorioConstrutorService } from './relatorio-construtor.service';
import { RelatorioImportadorService } from './relatorio-importador.service';
import { ConsultoriaController } from './consultoria.controller';
import { ConsultoriaService } from './consultoria.service';
import { RelCartoesController } from './rel-cartoes.controller';
import { RelCartoesService } from './rel-cartoes.service';
import { RentabilidadeCategoriasController } from './rentabilidade-categorias.controller';
import { AnaliseEntradaSaidaController } from './analise-entrada-saida.controller';
import { AnaliseEntradaSaidaService } from './analise-entrada-saida.service';
import { RelEntSaiController } from './rel-ent-sai.controller';
import { RelEntSaiService } from './rel-ent-sai.service';
import { RelFaturamentoController } from './rel-faturamento.controller';
import { RelFaturamentoService } from './rel-faturamento.service';
import { AnaliseComportamentoPeriodoController } from './analise-comportamento-periodo.controller';
import { AnaliseComportamentoPeriodoService } from './analise-comportamento-periodo.service';
import { PosicaoProdutoController } from './posicao-produto.controller';
import { PosicaoProdutoService } from './posicao-produto.service';
import { MovimentacoesDiaController } from './movimentacoes-dia.controller';
import { MovimentacoesDiaService } from './movimentacoes-dia.service';
import { RelAnaliseItensNfController } from './rel-analise-itens-nf.controller';
import { RelAnaliseItensNfService } from './rel-analise-itens-nf.service';
import { RelPrecosAlteradosController } from './rel-precos-alterados.controller';
import { RelPrecosAlteradosService } from './rel-precos-alterados.service';
import { RelVendasDinamicoController } from './rel-vendas-dinamico.controller';
import { RelVendasDinamicoService } from './rel-vendas-dinamico.service';
import { AnaliseCasaCarneController } from './analise-casa-carne.controller';
import { AnaliseCasaCarneService } from './analise-casa-carne.service';
import { ExtratoFornecedoresController } from './extrato-fornecedores.controller';
import { ExtratoFornecedoresService } from './extrato-fornecedores.service';
import { SimuladorVendaController } from './simulador-venda.controller';
import { SimuladorVendaService } from './simulador-venda.service';
import { RelFinanceiroController } from './rel-financeiro.controller';
import { RelFinanceiroService } from './rel-financeiro.service';
import { RelInterseccaoController } from './rel-interseccao.controller';
import { RelInterseccaoService } from './rel-interseccao.service';
import { RelDdeController } from './rel-dde.controller';
import { RelDdeService } from './rel-dde.service';
import { RelEntradasSaidasController } from './rel-entradas-saidas.controller';
import { RelEntradasSaidasService } from './rel-entradas-saidas.service';
import { ProdutosRelController } from './produtos-rel.controller';
import { ProdutosRelService } from './produtos-rel.service';
import { RelComprasController } from './rel-compras.controller';
import { RelComprasService } from './rel-compras.service';
import { RentabilidadeCategoriasService } from './rentabilidade-categorias.service';
import { ConsHistVendasController } from './cons-hist-vendas.controller';
import { ConsHistVendasService } from './cons-hist-vendas.service';
import { ConfigService } from '../cadastro/config.service';
import { DatabaseProvider } from '../../shared/database/database.provider';

/**
 * RELATÓRIOS — categoria nova no app (o legado tem dezenas). Migrados: Relatório de Vendas (rel 01) e
 * Prévia do Fornecedor / Análise de Giro (15 dias).
 */
@Module({
  controllers: [RelVendasController, PreviaFornecedorController, RelFinalizadorasController, RelTicketMedioController, RelCaixaDreController, RelSemMovimentoController, RelCurvaAbcController, RelVendasDataController, RelVendasDepartamentoController, RelVendasHoraController, RelFormasPgtoController, RelVendasOperadorController, RelCaixaOpsController, RelCanceladosController, RelVendasExtrasController, ConsHistVendasController,
    // FRMRELATORIO + FRMCADASTRORELATORIO — o construtor: catálogo de fontes, definição salva e execução.
    RelatorioConstrutorController,
    // FRMCONSULTORIAATM — participação e rentabilidade por nível da árvore (440 acessos).
    ConsultoriaController,
    // FRMRELCARTOES — total por cartão: bruto, líquido e a separação crédito/débito/alimentação (382 acessos).
    RelCartoesController,
    // FRMRENTABILIDADECATEGORIAS — a rentabilidade DEPOIS do imposto e da despesa (275 acessos).
    RentabilidadeCategoriasController,
    // FRMRELCOMPRAS — os três relatórios de compra por categoria (204 acessos).
    RelComprasController,
    // FRMPRODUTOSREL — corte-1: estoque atual, ruptura e análise (162 acessos).
    ProdutosRelController,
    // FRMRELENTRADASSAIDAS — listagem e comparativo entrada × saída (148 acessos).
    RelEntradasSaidasController,
    // FRMRELDDE — dias de estoque / cobertura (132 acessos).
    RelDdeController,
    // FRMRELINTERSECCAOPRODUTOS — o que o cliente leva junto (117 acessos).
    RelInterseccaoController,
    RelFinanceiroController,
    SimuladorVendaController,
    ExtratoFornecedoresController,
    AnaliseCasaCarneController,
    RelVendasDinamicoController,
    RelPrecosAlteradosController,
    RelAnaliseItensNfController,
    MovimentacoesDiaController,
    PosicaoProdutoController,
    AnaliseComportamentoPeriodoController,
    // FRMRELFATURAMENTO — faturamento por mês, com a perna NFC-e que falta no legado (80 acessos).
    RelFaturamentoController,
    // FRMRELENTSAI — compra × venda por produto (84 acessos).
    RelEntSaiController,
    // FRMANALISEENTRADAXSAIDA — por fornecedor, saída de venda ou pedido (68 acessos).
    AnaliseEntradaSaidaController],
  providers: [RelVendasService, PreviaFornecedorService, RelFinalizadorasService, RelTicketMedioService, RelCaixaDreService, RelSemMovimentoService, RelCurvaAbcService, RelVendasDataService, RelVendasDepartamentoService, RelVendasHoraService, RelFormasPgtoService, RelVendasOperadorService, RelCaixaOpsService, RelCanceladosService, RelVendasExtrasService, ConfigService, DatabaseProvider, ConsHistVendasService, RelatorioConstrutorService, RelatorioImportadorService, ConsultoriaService, RelCartoesService, RentabilidadeCategoriasService, RelComprasService, ProdutosRelService, RelEntradasSaidasService, RelDdeService, RelInterseccaoService, RelFinanceiroService, SimuladorVendaService, ExtratoFornecedoresService, AnaliseCasaCarneService, RelVendasDinamicoService, RelPrecosAlteradosService, RelAnaliseItensNfService, MovimentacoesDiaService, RelFaturamentoService, RelEntSaiService, AnaliseEntradaSaidaService, PosicaoProdutoService, AnaliseComportamentoPeriodoService],
})
export class RelatoriosModule {}
