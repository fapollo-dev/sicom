# Os módulos do legado — e quanto de cada um já está convertido

> **Procedência (06/10/2026).** A árvore saiu da tabela `MENUEXPRESS` da **produção**
> (`hiperpinheirao`, `SET TRANSACTION READ ONLY`): 2.397 linhas, uma por
> `(operador, tela)`, com `MENUPAI` = módulo, `MENU` = rótulo, `FORMULARIO` = TForm e
> `ACESSOS` = uso real. Dá **276 telas distintas em 30 módulos**; 270 delas aparecem
> num módulo só (4 em dois), então o pai é confiável. Descartadas as linhas de
> `ULTIMOACESSO` e de pai nulo — são a barra de acesso rápido, onde rótulo e
> formulário saem de sincronia (ex.: *Scrap – perdas* apontando `FRMETIQUETA`).

> O `Config/Menu.XML` do fonte Delphi (mai/2020, 418 itens) traz a mesma espinha —
> CADASTRO · MOVIMENTAÇÃO FINANCEIRA · MOVIMENTAÇÃO DE MERCADORIAS · RELATÓRIOS ·
> VENDAS · CONTROLE DE ESTOQUE · FISCAL · CONTÁBIL · UTILITÁRIOS · INDÚSTRIA —, mas é
> retrato velho: o binário que o cliente roda é mais novo e já tem IBS/CBS, CRM,
> Autorizações, integrações fiscais. **Onde discordam, vale a produção.**

## Placar por módulo — **145/276 telas** (53%) e **99.8% do uso**

O % de uso é o que pesa: as telas que faltam são, quase todas, de cauda longa.

| Módulo (produção) | Telas | % do uso | Onde vive no Apollo |
|---|---:|---:|---|
| Operacoes basicas | 2/2 | 100.0% | Operações básicas |
| Movimentacao de mercadorias | 8/19 | 99.6% | Mercadorias |
| Vendas | 13/16 | 100.0% | Vendas |
| Movimentacao financeira | 22/35 | 99.4% | Financeiro |
| Produtos | 10/19 | 99.7% | Produtos |
| Controle de estoque | 7/18 | 98.8% | Estoque |
| Promocoes | 3/5 | 99.9% | Produtos › Promoções |
| Utilitarios | 6/21 | 97.6% | Utilitários |
| Parceiros | 1/4 | 99.9% | Parceiros |
| Fiscal | 16/32 | 77.1% | Fiscal |
| Relatorios | 27/34 | 99.0% | Relatórios |
| Outros | 8/19 | 93.0% | Cadastros gerais |
| Contabil | 1/1 | 100.0% | Contábil |
| Financeiro | 5/8 | 93.1% | Financeiro › Cadastros |
| Fornecedores | 2/4 | 97.9% | Parceiros › Fornecedores |
| Caixa | 2/2 | 100.0% | Financeiro › Caixa |
| Baixa de cartoes API | 0/1 | 0.0% | — (não convertido) |
| Movimentacao contabil | 1/3 | 96.5% | Contábil › Movimentação |
| Integracao Fiscal - Borba Fiscal | 0/1 | 0.0% | — (não convertido) |
| Cadastro | 7/8 | 98.2% | Contábil › Cadastros |
| Producao | 1/2 | 99.1% | Estoque › Produção |
| FGF | 0/2 | 0.0% | — (não convertido) |
| CRM | 0/3 | 0.0% | — (não convertido) |
| Integracao Fiscal | 1/5 | 38.5% | — (não convertido) |
| IBS CBS | 2/2 | 100.0% | Fiscal › IBS/CBS |
| WL Contabil | 0/2 | 0.0% | — (não convertido) |
| Autorizacoes | 0/3 | 0.0% | — (não convertido) |
| Importa | 0/2 | 0.0% | — (não convertido) |
| PDV | 0/2 | 0.0% | — (não convertido) |
| Indicadores financeiros | 0/1 | 0.0% | — (não convertido) |
| **TOTAL** | **145/276** | **99.8%** | 12 módulos no rail |

## O que falta, por módulo (fila pronta, ordenada por uso)

**Movimentacao de mercadorias** — faltam 11:  
MDF-e Manifesto Eletronico de Doc. Fiscais (`FRMCADMDFE`, 154), Precificacao concorrentes (`FRMMOVCONCORRENTES`, 72), Pedido de compra cereal (`FRMPEDIDOSCOMPRACERAL`, 67), Analise de concorrentes (`FRMCADANALISECONCORRENTES`, 36), Agenda de descarregamento (`FRMAGENDADESCARREGAMENTO`, 16), Declaracao de Importacao (DI) (`FRMDECLARACAOIMPORTACAONF`, 15), Cotacao Lista Fornecedores (`FRMCOTACAOLISTAFORN`, 7), Nota Ressarcimento ICMS-ST (`FRMNFRESSARC_ICMSST`, 6), CT-e (`FRMCADCTE`, 5), Liberacao de Pedido (`FRMLIBERACAOPEDIDO`, 4), Controle de clavegos (`FRMCADCLAVEGOS`, 3)

**Vendas** — faltam 3:  
Relatorio de cortesias (`FRMRELCORTESIAS`, 19), Analise gerencial de pedidos (`FRMANALISEGERENCIALDEPEDIDOS`, 5), Relatorio de Entregas (`FRMRELENTREGA`, 1)

**Movimentacao financeira** — faltam 13:  
Baixa de cheques pre (`FRMBAIXACHEQUE`, 80), Controle de funcionarios (`FRMCONTROLEFUN`, 75), Agrupar cartao (`FRMAGRUPACARTAO`, 65), Lancamento de freteiros (`FRMLANFRETE`, 28), Processar Contas a Pagar (gerar arquivos Banco) (`FRMPROCESSAAPAGAR`, 23), Controle de recargas e corresp (`FRMCTRLRECARGASCORRESPONDENTE`, 19), Cheques (`FRMCADCHEQUE`, 13), Cheques proprios (`FRMCADCHEQUEPROPRIO`, 10), Faturamento de pedidos (`FRMFATURAMENTOPEDIDO`, 5), Recebimentos (`FRMRECEBIMENTOS`, 4), Custodia de cheque (`FRMCHQCUSTODIA`, 2), Devolucao de cheques (`FRMDEVOLUCAOCH`, 2), Central de Cobranca (`FRMFILTROCENTRALCOBRANCA`, 2)

**Produtos** — faltam 9:  
Precificacao de Produtos (`FRMPRECIFICACAOPROD`, 65), Validades de Produtos (`FRMCADPRODUTOVALIDADE`, 8), FGF - Atualizacao em Lote (`FRMINTEGRACAOLOTEFGF`, 7), Tabela de precos (`FRMCADTABELAPRECO`, 4), Lanca preco 2 (`FRMLANCAPRECO2`, 3), WL - Consulta Produtos Saneados (`FRMWLCONSULTAPRODUTOSSANEADOS`, 3), Precificacao por tabela de precos (`FRMPRECIFICACAOTABELAPRECO`, 2), Preco mult-loja mercadorias (`FRMMULTIPRECO`, 2), FGF - Historico Atualizacoes  (`FRMHISTORICOFGF`, 1)

**Controle de estoque** — faltam 11:  
Transferencia de mercadoria (`FRMSAIDADEP`, 103), Mapa de Entregas (`FRMMAPADEENTREGAS`, 98), Devolucao de produtos (`FRMCADDEVOLUCAO`, 92), Pedido de Transferencia entre lojas (`FRMPEDIDOTRANSFERENCIA`, 30), Devolucao de Vendas (NF) (`FRMDEVOLUCAO_NF`, 30), Lancamento balanco (`FRMCADBALANCO`, 15), Mapa de carga distribuidor (`FRMCADMAPADECARGA`, 9), Controle de entregas (`FRMCONTROLEENTREGAS`, 8), Reposicao de Gondola (`FRMREPOSICAODEGONDOLA`, 3), Sugestao Pedido de Compra (`FRMSUGESTAOPEDIDOCOMPRA`, 2), Remessa de Vendas (`FRMREMESSAVENDAS`, 1)

**Promocoes** — faltam 2:  
Promocao por departamento (`FRMCADPROMOCAODEPARTAMENTO`, 15), Gerenciador de Promocoes (`FRMGERENCIADORPROMOCAO`, 7)

**Utilitarios** — faltam 15:  
Controle Mobile (`FRMCONTROLEMOBILE`, 127), Metas (`FRMCADMETAS`, 97), Importacao de pedidos (`FRMIMPORTAPED`, 34), Controle de vacinas (`FRMVACINAS`, 27), Atualizacao manual produto (`FRMATUALIZACAOPRODUTOS`, 19), Coletor de dados (`FRMCOLETOR`, 16), Agenda processamento lote de preco (`FRMAGENDALOTEPRECO`, 11), Controle de Vasilhame (`FRMVASILHAME`, 10), Libera senha gerencial (`FRMLIBERASENHAGERENCIAL`, 4), Manutencao de pedidos (`FRMMANUTENCAOPEDIDOS`, 4), Exportacao Coletor (`FRMEXPORTACAOCOLETOR`, 3), Abastecimento (`FRMCADABASTECIMENTO`, 3), Consulta solicitacao de figura (`FRMSOLICITAOFIGURAFISCAL`, 1), Ordem de servico (`FRMORDEMSERVICO`, 1), Alinha generator (`FRMALINHAGENERATOR`, 1)

**Parceiros** — faltam 3:  
Grupos Empresariais (`FRMCADGRUPOEMPRESARIAL`, 3), Solicitacoes do portal - Convenio (`FRMSOLICITACOESPORTALCONVENIO`, 2), Bairro (`FRMCADBAIRRO`, 2)

**Fiscal** — faltam 16:  
Consulta NFC-e (`FRMNFCE`, 1516), Gerador sped fiscal (`FRMSPEDFISCAL`, 903), Gerador sped contribuicoes (`FRMSPEDPISCOFINS`, 25), Nfe (`FRMCADNFE`, 11), Gerador sintegra (`FRMSINTEGRA`, 10), Apuracao de ICMS ST (`FRMAPURACAOICMSST`, 10), Apuracao ciap (`FRMAPURACAOCIAP`, 10), Compras x saidas (`FRMAPURACAO`, 7), Conferencia EFD (`FRMRELCONFERENCIAEFD`, 7), Consolidacao das operacoes por CST PIS/COFINS (`FRMCONSOLIDACAOPISCOFINS`, 6), Genero ncm (`FRMCADGENERONCM`, 3), Codigo da receita (`FRMCADCODIGORECEITA`, 3), Codigo de ajuste/incentivo/beneficio (`FRMCADCODIGOAJUSTE`, 3), Mapa resumo (`FRMMAPARESUMO`, 2), Reducaoz (`FRMCADREDUCAOZ`, 2), Divergencia Integracao (`FRMRELDIVERGENCIAINTEGRACAO`, 1)

**Relatorios** — faltam 7:  
Diferenca entre nf e pedido (`FRMRELDIFERENCASNFPEDIDO`, 20), Relatorio de Rupturas (`FRMRELRUPTURAS`, 19), Relatorio Gestao (`FRMRELGESTAO`, 8), Abastecimento (`FRMRELABASTECIMENTO`, 4), Relatorio de vendedores (`FRMRELVENDEDORES`, 3), Movimentacoes de Pedidos (`FRMMOVPEDIDOS`, 2), Os por placa (`FRMRELOSPLACA`, 1)

**Outros** — faltam 11:  
PDV (`FRMCADPDV`, 93), Terminais (`FRMCADTERMINAIS`, 56), Concorrentes (`FRMCADCONCORRENTES`, 32), Operadoras de telefonia (`FRMCADOPERADORASTELEFONIA`, 16), Agenda de atendimento (`FRMCADAGENDAATENDIMENTO`, 14), Taras (`FRMCADTARA`, 5), Veiculos (`FRMCADVEICULOS`, 4), Docas (`FRMCADDOCA`, 4), Pesquisas (`FRMCADPESQUISA`, 2), Regiao (`FRMCADREGIAO`, 1), Cortesias por categoria (`FRMCADCATCORTESIA`, 1)

**Financeiro** — faltam 3:  
Agenda de previsao de pagamentos (`FRMCADAGENDAPREVPAGTO`, 23), Cartoes proprios (`FRMCADCARTAOPROPRIO`, 14), Configura Pix (`FRMCONFIGURAPIX`, 14)

**Fornecedores** — faltam 2:  
Acordo comercial (`FRMRELACORDOCOMERCIAL`, 13), Curva abc por fornecedor (`FRMRELCURVAABCFORNECEDOR`, 2)

**Baixa de cartoes API** — faltam 1:  
Boa Vista (`FRMMANCADCARTAOBOAVISTA`, 560)

**Movimentacao contabil** — faltam 2:  
Lancamento no diario (`FRMCADLANCAMENTODIARIO`, 12), Lancamento em lote (`FRMCADLANCAMENTOCONTABIL`, 2)

**Integracao Fiscal - Borba Fiscal** — faltam 1:  
Integracao Fiscal - Borba Fiscal (`FRMVERIFICACAOTRIBUTARIABORBAFISCAL`, 387)

**Cadastro** — faltam 1:  
Grupo de contas (`FRMCADGRUPOCONTABIL`, 6)

**Producao** — faltam 1:  
Lista de pendencias (`FRMPENDENCIAPRODUCAO`, 1)

**FGF** — faltam 2:  
FGF - Atualizacao em Lote (API) (`FRMINTEGRACAOLOTEFGFAPI`, 82), FGF - Historico Atualizacoes  (`FRMHISTORICOFGF`, 1)

**CRM** — faltam 3:  
Chama Fila (`FRMCADMIDIADEPARTAMENTO`, 19), Scanntech (`FRMSCANNTECH`, 16), Publicidade (`FRMCADPUBLICIDADE`, 14)

**Integracao Fiscal** — faltam 4:  
Produtos Planilha Excel (`FRMIMPORTAPRODUTOSEXCEL`, 9), Mix Fiscal (`FRMMIXFISCAL`, 5), Borba Fiscal (`FRMVERIFICACAOTRIBUTARIABORBAFISCAL`, 1), WIT Fiscal (`FRMWITALINHAMENTO`, 1)

**WL Contabil** — faltam 2:  
WL - Atualizacao em Lote (`FRMINTEGRACAOLOTEWL`, 9), WL - Alinhamento (`FRMWLALINHAMENTO`, 1)

**Autorizacoes** — faltam 3:  
Autorizacao de Pagamento (`FRMAUTORIZACAOPAGAMENTO`, 6), Autorizacao de Baixa (`FRMAUTORIZACAOBAIXA`, 1), Retirar Autorizacao de Pagamento (`FRMRETIRARAUTORIZACAOPAGAMENTO`, 1)

**Importa** — faltam 2:  
Importa historico (`FRMIMPORTAHISTORICOCONTABIL`, 3), Plano de contas referencial (`FRMIMPORTAPLANOREFERENCIAL`, 2)

**PDV** — faltam 2:  
Motivo de desconto (`FRMRELHISTPDV`, 3), Troco solidario PDV (`FRMRELTROCOPDV`, 1)

**Indicadores financeiros** — faltam 1:  
Indicadores de contas a pagar (`FRMRELINDICADORESFINANCEIROS`, 2)

## Como o rail foi montado

12 contextos (um ícone cada) em `apps/web/src/app/modulos.ts`, na ordem de uso da
produção. Módulo pequeno do legado vira **subgrupo colapsável** do rail a que
pertence (`Promocoes` → *Produtos › Promoções*; `Financeiro`, que no legado é só
cadastro financeiro, → *Financeiro › Cadastros*) — são os mesmos dois níveis do menu
do legado, só que o 1º nível cabe no rail. `ROTA_MODULO` mapeia rota → módulo com o
TForm e os acessos no comentário de cada linha; tela nova sem registro cai no módulo
do prefixo da rota e continua aparecendo.
