# Fila de conversão — as 194 telas com uso que ainda faltam

Gerado de `MENUEXPRESS` da produção em 15/09/2026, cruzado com os `FRM*` presentes em `apps/api`.
Exclui as 5 telas de PDV (fora de escopo por instrução do usuário).

> **A leitura honesta são dois números, não um.** Por **uso**, o Apollo cobre **98,4%** — mas o uso é
> hiperconcentrado: `FRMETIQUETA` sozinha responde por **2.375.302 de 3.045.902** acessos (78%). Por
> **formulário**, são **91 de 289** com uso registrado (31%). As 194 abaixo somam 4.145 acessos — 0,1% do
> volume, e ainda assim são 194 telas de trabalho.

| # | tela | acessos | operadores | nota |
|---|---|---|---|---|
| 1 | `FRMCADMDFE` | 153 | 12 | ⛔ **não migrar**: a tela nunca foi implementada no legado — 47 linhas com o corpo comentado, `.dfm` com um GroupBox vazio, DataModule vazio, e `MDFE`/`MDFE_DOCUMENTO` com 0 linhas. Migrar seria escrever do zero |
| 2 | `FRMRELINTERSECCAOPRODUTOS` | 117 | 10 | ✅ **completa** (mig 221) — sem a tabela de trabalho global do legado |
| 3 | `FRMDIGITACAOPEDIDOS` | 116 | 9 | 🟡 **corte-1** (mig 222): consulta de pedidos + **quem aplica a promoção acumulativa** (o atacarejo dá 5× o desconto normal). As 3 telas auxiliares do legado estão sem substrato — 0 linhas. Falta digitar o pedido e a reserva de estoque |
| 4 | `FRMSAIDADEP` | 104 | 9 | ⛔ **mecanismo morto no cliente**: `SAIDADEP` tem **16 linhas**, a última de **04/02/2021** — parou há mais de cinco anos. E a transferência é para o depósito, cuja tabela (`ESTOQUE_DEP`) está **inteiramente zerada** (ver `uProdutosRel.md` §2): este cliente não usa estoque por depósito. Os 104 acessos são gente abrindo a tela, não gravando. Reavaliar se algum tenant passar a usar depósito |
| 5 | `FRMCONTROLEMOBILE` | 101 | 5 | ⛔ **sem fonte no repositório clonado** — nenhuma unit, nenhum `.dfm`. Terceiro caso (com Borba Fiscal e Boa Vista) |
| 6 | `FRMFLUXOCARTOES` | 98 | 7 | ✅ **completa** (mig 223) — e sem a duplicação de 67% dos dias que o legado faz |
| 7 | `FRMMAPADEENTREGAS` | 98 | 3 | ⛔ **sem substrato**: `MAPA_DE_ENTREGA` e `MAPA_DE_ENTREGA_ITEM` com **0 linhas** |
| 8 | `FRMCADMETAS` | 97 | 4 | 🪦 marginal: `METAS` com **21 linhas** |
| 9 | `FRMRELENTSAI` | 84 | 10 | 🟢 **equivalente** (mig 225): compra × venda por produto, nas duas unidades certas. Falta a visão por pedido de compra |
| 10 | `FRMINTEGRACAOLOTEFGFAPI` | 82 | 2 | ⛔ **sem fonte no repositório clonado** — **zero** ocorrências de `FGFAPI` em todo o `retaguarda-master`. Existe a variante SEM API (`FRMINTEGRACAOLOTEFGF`, `uIntegracaoLoteFGF.pas`, 16 acessos), que atualiza dados fiscais de produto a partir de um XML do FGF; a staging dela (`FGF_PRODUTOS`) está com 0 linhas e `HISTORICO_DINAMICO` não guarda rastro (7 linhas para `PRODUTOS`, a última de 2020). Reavaliar se o fonte da versão API aparecer |
| 11 | `FRMCADCONFIGCONCILIADOR` | 82 | 6 | ✅ **completa** (mig 230) — o layout de leitura da planilha de cada operadora de cartão. ⚠️ a tela **não veio no fonte**; reconstruída do DADO (7 layouts, 40 itens) e viva: `ITENS_MANCARTAO` tem **245.984 linhas**, todas `CONFIGURAVEL`, até 03/05/2026, **98,96% casadas**. Falta o motor que importa a planilha |
| 12 | `FRMRELFATURAMENTO` | 80 | 7 | ✅ **completa** (mig 224) — ⚠️ o legado mostrava **0,04%** do faturamento: faltava a perna **NFC-e**, que é por onde a loja fatura |
| 13 | `FRMBAIXACHEQUE` | 80 | 11 | 🪦 marginal: `CHEQUE` com **11 linhas** e `CHEQUE_DEVOLVIDO` com **0** |
| 14 | `FRMCONTROLEFUN` | 75 | 4 | ⛔ **sem substrato**: `CONVENIO_FUN` e `FRETEIRO` com **0 linhas** |
| 15 | `FRMMOVCONCORRENTES` | 72 | 7 | 🪦 marginal: `CONCORRENCIA` **20**, `ANALISE_CONCORRENCIA` **1**, `MOV_ANALISE_CONCORRENTE` **6** linhas |
| 16 | `FRMANALISEENTRADAXSAIDA` | 68 | 9 | 🟢 **equivalente** (mig 228): por fornecedor, com a saída de venda **ou pedido**. ⚠️ corrigido o filtro que anulava o `LEFT JOIN` e escondia 4.502 produtos sem grupo |
| 17 | `FRMDESCONTOTITULO` | 68 | 11 | 🟡 **corte-1** (mig 226): a consulta do **encontro de contas** (o nome engana — não é desconto bancário). 18 operações, mas **R$ 254 mil**, a última há 4 dias. Falta executar e reverter |
| 18 | `FRMPEDIDOSCOMPRACERAL` | 68 | 5 | ⛔ **sem substrato**: `PEDIDOCOMPRACEREAL` com **0 linhas** |
| 19 | `FRMPRECIFICACAOPROD` | 67 | 7 | ⛔ **sem fonte no repositório clonado** |
| 20 | `FRMAGRUPACARTAO` | 64 | 11 | ⛔ **mecanismo nunca usado**: agrupa lançamentos sob um número de resumo da operadora, gravando `CARTAO.RESUMO` — coluna **nula nas 2.059.893 linhas**. Os 64 acessos são gente abrindo a tela |
| 21 | `FRMCONSCLIRCB` | 64 | 8 | ✅ **completa** (mig 227) — ⚠️ o legado exibia **R$ 11,5 milhões** de juro fantasma: a coluna JURO usava um default de 9% a.m. que o TOTAL não aplicava, em 99,96% dos títulos |
| 22 | `FRMRELPEDIDOCOMPRA` | 63 | 6 | ⛔ **sem fonte no repositório clonado** |
| 23 | `FRMCADHISTORICOCONTABIL` | 62 | 3 | ✅ **completa** (mig 231; a tabela e os 54 templates vieram na 229) — o texto que o razão imprime, com os `*` que a contabilização preenche. A tela simula o resultado enquanto se digita, usando a **mesma** função que a API usa para escrever |
| 24 | `FRMMULTATUALIZACAO` | 60 | 6 | ✅ **completa** (mig 232) — um campo, uma operação, N produtos. As três travas do legado (composição, tipo de família, hierarquia do subgrupo) + prévia com a MESMA conta da gravação. ⚠️ corrigido: dividir por zero derrubava a rotina; e os campos de controle (IDPRODUTO, auditoria) saíram do combo, onde o legado os deixou por esquecimento |
| 25 | `FRMCADTERMINAIS` | 56 | 2 | ⛔ **fora de escopo por instrução (NADA de PDV)** — as 8 linhas de `TERMINAIS` são os CAIXAS: cada uma aponta para um Firebird local (`192.168.15.xx:C:\SICOM\CONFIG\VENDAS.FDB`) e guarda a `DTAULTIMACARGA` da carga de preço para o PDV. O cadastro existe só para alimentar o PDV. Vivo (última carga hoje), mas reavaliar apenas se o escopo de PDV mudar |
| 26 | `FRMCONFIGINTEGRACAOCONTABIL` | 55 | 2 | ✅ **completa** (mig 233; as 60 colunas já vieram na 199-201) — qual situação o razão usa em cada um dos 59 eventos, nas 5 abas do legado. ⚠️ a tela avisa quando o apontador cai numa situação **sem as duas pernas**, que é o erro que só apareceria na contabilização; e grava só o que mudou, para não apagar configuração alheia num painel de 60 campos |
| 27 | `FRMANALISECOMPORTAMENTO` | 53 | 8 | 🟡 **recon feito, conversão pendente de um processo externo**. A tela (14.384 linhas no conjunto) é só o **leitor** de `REL_ANALISE_COPORTAMENTO` — ⚠️ e o comentário do autor do legado diz de onde vêm os números: *"é alimentada diariamente no processamento que fica dentro do **aplicativo Giros**, que é executado diariamente por volta das 4:00 da manhã"*. O Giros **não veio no fonte**. O resultado está vivo (14.014 linhas, **105 meses de jan/2018 a set/2026**, 3 empresas, 3 títulos: Faturamento, CMV, Num. Clientes, uma linha por dia). Reconstruir do dado deu **0,75% de diferença** em ago/2026 (cache 1.145.153,34 × `SUM(QTDE×VRVENDA)` 1.153.860,03) e **1 cupom** no nº de clientes; nenhuma coluna de desconto fecha a diferença sozinha (`DESC_PROMOCAO` 838,05 · `DESC_SCANNTECH` 838,05 · `TOTAL_ITEM_DEVOLVIDO` 428,05 · `DESC_ACRE_MEDIO` −7.071,28). **Entregar um relatório gerencial com número diferente do que o cliente vê é pior que adiar**: o corte depende de fechar o critério do Giros (mais medição dia a dia) ou de obter o fonte dele |
| 28 | `FRMCONFIGDRECONTABIL` | 51 | 3 |
| 29 | `FRMCADAGENDALIMITACAOVENDA` | 51 | 6 |
| 30 | `FRMCONFINTEGBANCARIA` | 50 | 3 |
| 31 | `FRMCADCONFPLANOCONTAS` | 45 | 2 |
| 32 | `FRMRELFINANCEIRO` | 43 | 7 |
| 33 | `FRMSIMULADORVENDA` | 42 | 5 |
| 34 | `FRMCADACORDOCOMERCIAL` | 39 | 4 |
| 35 | `FRMAPURACAOPISCOFINS` | 39 | 2 |
| 36 | `FRMEXTRATOFORNECEDORES` | 38 | 4 |
| 37 | `FRMANALISECOMPRAVENDACASACARNE` | 37 | 6 |
| 38 | `FRMRELATORIOVENDASDINAMICO` | 37 | 8 |
| 39 | `FRMRELPRECOSALTERADOS` | 35 | 4 |
| 40 | `FRMCADANALISECONCORRENTES` | 35 | 4 |
| 41 | `FRMRELANALISEITENSNF` | 34 | 4 |
| 42 | `FRMIMPORTAPED` | 34 | 7 |
| 43 | `FRMFATURAMENTO2` | 34 | 8 |
| 44 | `FRMCADCONCORRENTES` | 32 | 4 |
| 45 | `FRMPEDIDOTRANSFERENCIA` | 32 | 7 |
| 46 | `FRMDEVOLUCAO_NF` | 30 | 7 |
| 47 | `FRMMOVIMENTACOESDIA` | 27 | 8 |
| 48 | `FRMCADAGENDAPREVPAGTO` | 27 | 4 |
| 49 | `FRMVACINAS` | 27 | 6 |
| 50 | `FRMLANFRETE` | 27 | 4 |
| 51 | `FRMRELTROCAMERCADORIAFOR` | 27 | 5 |
| 52 | `FRMCONSPROD` | 25 | 8 |
| 53 | `FRMRELANALISECOMPORTAMENTOPERIODO` | 24 | 6 |
| 54 | `FRMCADINDEXADORTRIBUTARIO` | 23 | 4 |
| 55 | `FRMPROCESSAAPAGAR` | 23 | 4 |
| 56 | `FRMRELANALISEPEDIDONF` | 22 | 4 |
| 57 | `FRMCONSAPGBX` | 20 | 7 |
| 58 | `FRMRELDIFERENCASNFPEDIDO` | 20 | 5 |
| 59 | `FRMRELCORTESIAS` | 19 | 3 |
| 60 | `FRMCADMIDIADEPARTAMENTO` | 19 | 4 |
| 61 | `FRMCTRLRECARGASCORRESPONDENTE` | 19 | 3 |
| 62 | `FRMRELRUPTURAS` | 19 | 1 |
| 63 | `FRMATUALIZACAOPRODUTOS` | 18 | 5 |
| 64 | `FRMAGENDADESCARREGAMENTO` | 17 | 4 |
| 65 | `FRMAGENDALOTEPRECO` | 17 | 5 |
| 66 | `FRMCONSRCBBX` | 17 | 4 |
| 67 | `FRMRELPERDAS` | 17 | 4 |
| 68 | `FRMCADOPERADORASTELEFONIA` | 16 | 6 |
| 69 | `FRMINTEGRACAOLOTEFGF` | 16 | 4 |
| 70 | `FRMSCANNTECH` | 16 | 3 |
| 71 | `FRMCOLETOR` | 16 | 4 |
| 72 | `FRMDECLARACAOIMPORTACAONF` | 15 | 6 |
| 73 | `FRMEXPORTANFE` | 15 | 2 |
| 74 | `FRMRELACORDOCOMERCIAL` | 15 | 3 |
| 75 | `FRMCADPROMOCAODEPARTAMENTO` | 15 | 6 |
| 76 | `FRMCADPUBLICIDADE` | 14 | 5 |
| 77 | `FRMCADAGENDAATENDIMENTO` | 14 | 3 |
| 78 | `FRMCADPERIODOCONTABIL` | 14 | 5 |
| 79 | `FRMCONFIGURAPIX` | 14 | 1 |
| 80 | `FRMCADCARTAOPROPRIO` | 14 | 6 |
| 81 | `FRMRELBALANCETE` | 14 | 4 |
| 82 | `FRMEXTRATOCLIENTES` | 13 | 2 |
| 83 | `FRMCADPISCOFINS` | 13 | 3 |
| 84 | `FRMCADCHEQUE` | 13 | 5 |
| 85 | `FRMCADLANCAMENTODIARIO` | 12 | 2 |
| 86 | `FRMRELENTRADAS_FINAN` | 11 | 3 |
| 87 | `FRMCADNFE` | 11 | 1 |
| 88 | `FRMCADCEST` | 11 | 3 |
| 89 | `FRMPRECIFICACAONFBRUTA` | 11 | 4 |
| 90 | `FRMCADABASTECIMENTO` | 11 | 4 |
| 91 | `FRMINTEGRACAOLOTEWL` | 11 | 3 |
| 92 | `FRMCADCHEQUEPROPRIO` | 10 | 5 |
| 93 | `FRMAPURACAOICMSST` | 10 | 5 |
| 94 | `FRMMOTIVO` | 10 | 6 |
| 95 | `FRMVASILHAME` | 10 | 3 |
| 96 | `FRMINTEGRACAO_FISCAL` | 10 | 2 |
| 97 | `FRMSINTEGRA` | 10 | 2 |
| 98 | `FRMRELCURVAABCFORNECEDOR` | 10 | 4 |
| 99 | `FRMRELGESTAO` | 9 | 3 |
| 100 | `FRMCONTROLEENTREGAS` | 9 | 4 |
| 101 | `FRMCADMAPADECARGA` | 9 | 2 |
| 102 | `FRMRELFUNCIONARIO` | 9 | 4 |
| 103 | `FRMRELATORIOCAIXADME` | 9 | 2 |
| 104 | `FRMAPURACAOCIAP` | 9 | 4 |
| 105 | `FRMIMPORTAPRODUTOSEXCEL` | 9 | 1 |
| 106 | `FRMAPURACAO` | 8 | 6 |
| 107 | `FRMCADPRODUTOVALIDADE` | 8 | 3 |
| 108 | `FRMRELBALANCO` | 8 | 3 |
| 109 | `FRMGERARFINANCEIROLOTE` | 8 | 3 |
| 110 | `FRMCADCLASSTRIBIBSCBS` | 8 | 1 |
| 111 | `FRMCADCODIGOCONTABIL` | 8 | 2 |
| 112 | `FRMFATURAMENTOPEDIDO` | 8 | 4 |
| 113 | `FRMAGENDADEPARTAMENTO` | 7 | 1 |
| 114 | `FRMCOTACAOLISTAFORN` | 7 | 2 |
| 115 | `FRMCADLANCAMENTOCONTABIL` | 7 | 5 |
| 116 | `FRMGERENCIADORPROMOCAO` | 7 | 2 |
| 117 | `FRMRELHISTPDV` | 7 | 4 |
| 118 | `FRMNFRESSARC_ICMSST` | 7 | 3 |
| 119 | `FRMCADGRUPOCONTABIL` | 6 | 2 |
| 120 | `FRMCONSOLIDACAOPISCOFINS` | 6 | 3 |
| 121 | `FRMCADFIGURASFISCAIS` | 6 | 2 |
| 122 | `FRMLIBERACAOPEDIDO` | 6 | 3 |
| 123 | `FRMRELCONFERENCIAEFD` | 6 | 1 |
| 124 | `FRMAUTORIZACAOPAGAMENTO` | 6 | 2 |
| 125 | `FRMANALISEGERENCIALDEPEDIDOS` | 5 | 2 |
| 126 | `FRMCADTARA` | 5 | 2 |
| 127 | `FRMCADCTE` | 5 | 4 |
| 128 | `FRMCONFIGLEGISLACAONFE` | 5 | 2 |
| 129 | `FRMMANUTENCAOPEDIDOS` | 5 | 3 |
| 130 | `FRMMIXFISCAL` | 5 | 1 |
| 131 | `FRMCADTABELAFORNECEDORES` | 5 | 1 |
| 132 | `FRMCONGELAESTOQUE` | 4 | 2 |
| 133 | `FRMRELABASTECIMENTO` | 4 | 2 |
| 134 | `FRMPENDENCIAPRODUCAO` | 4 | 2 |
| 135 | `FRMMOVPEDIDOS` | 4 | 2 |
| 136 | `FRMIMPORTAPLANOREFERENCIAL` | 4 | 2 |
| 137 | `FRMLIBERASENHAGERENCIAL` | 4 | 4 |
| 138 | `FRMCADDOCA` | 4 | 3 |
| 139 | `FRMRECEBIMENTOS` | 4 | 1 |
| 140 | `FRMCADCLAVEGOS` | 4 | 3 |
| 141 | `FRMCADVEICULOS` | 4 | 1 |
| 142 | `FRMRELDIARIOCONTABIL` | 4 | 4 |
| 143 | `FRMCADPESQUISA` | 4 | 3 |
| 144 | `FRMCADGRUPOEMPRESARIAL` | 3 | 1 |
| 145 | `FRMCADCSTIBSCBS` | 3 | 1 |
| 146 | `FRMRELINDICADORESFINANCEIROS` | 3 | 2 |
| 147 | `FRMWLCONSULTAPRODUTOSSANEADOS` | 3 | 1 |
| 148 | `FRMCADCODIGOAJUSTE` | 3 | 3 |
| 149 | `FRMRELVENDEDORES` | 3 | 2 |
| 150 | `FRMIMPORTAHISTORICOCONTABIL` | 3 | 3 |
| 151 | `FRMGERENCIARSUGESTAOPROMOCAO` | 3 | 1 |
| 152 | `FRMREPOSICAODEGONDOLA` | 3 | 1 |
| 153 | `FRMLANCAPRECO2` | 3 | 3 |
| 154 | `FRMCADCODIGORECEITA` | 3 | 2 |
| 155 | `FRMCADGENERONCM` | 3 | 3 |
| 156 | `FRMCADMENSAGEMNF` | 2 | 2 |
| 157 | `FRMNFE_INUTILIZADA` | 2 | 2 |
| 158 | `FRMPRECIFICACAOTABELAPRECO` | 2 | 1 |
| 159 | `FRMSOLICITACOESPORTALCONVENIO` | 2 | 2 |
| 160 | `FRMFILTROCENTRALCOBRANCA` | 2 | 1 |
| 161 | `FRMRELPERMISSAOUSER` | 2 | 1 |
| 162 | `FRMMAPARESUMO` | 2 | 1 |
| 163 | `FRMHISTORICOFGF` | 2 | 2 |
| 164 | `FRMSUGESTAOPEDIDOCOMPRA` | 2 | 2 |
| 165 | `FRMCHQCUSTODIA` | 2 | 2 |
| 166 | `FRMCADREDUCAOZ` | 2 | 1 |
| 167 | `FRMDEVOLUCAOCH` | 2 | 1 |
| 168 | `FRMMULTIPRECO` | 2 | 2 |
| 169 | `FRMCONFIGBAL` | 2 | 1 |
| 170 | `FRMCADDRECONTABIL` | 2 | 2 |
| 171 | `FRMIMPRIMEETIQUETA` | 2 | 1 |
| 172 | `FRMWLALINHAMENTO` | 1 | 1 |
| 173 | `FRMWITALINHAMENTO` | 1 | 1 |
| 174 | `FRMALINHAGENERATOR` | 1 | 1 |
| 175 | `FRMLOTEPRODUCAO` | 1 | 1 |
| 176 | `FRMCADCATCORTESIA` | 1 | 1 |
| 177 | `FRMCADMAPACARGAPROD` | 1 | 1 |
| 178 | `FRMCADREGIAO` | 1 | 1 |
| 179 | `FRMAUTORIZACAOBAIXA` | 1 | 1 |
| 180 | `FRMEXPORTACAOCOLETOR` | 1 | 1 |
| 181 | `FRMCADLIMITECOMPRA` | 1 | 1 |
| 182 | `FRMRELATORIOINDUSTRIA` | 1 | 1 |
| 183 | `FRMORDEMSERVICO` | 1 | 1 |
| 184 | `FRMSOLICITAOFIGURAFISCAL` | 1 | 1 |
| 185 | `FRMRELOSPLACA` | 1 | 1 |
| 186 | `FRMCADLOCALESTOQUE` | 1 | 1 |
| 187 | `FRMRELENTREGA` | 1 | 1 |
| 188 | `FRMRELDIVERGENCIAINTEGRACAO` | 1 | 1 |
| 189 | `FRMRELTROCOPDV` | 1 | 1 |
| 190 | `FRMPONTORECEBIMENTO` | 1 | 1 |
| 191 | `FRMGRIDEXCEL` | 1 | 1 |
| 192 | `FRMRETIRARAUTORIZACAOPAGAMENTO` | 1 | 1 |
| 193 | `FRMCADTIPOFATURAMENTO` | 1 | 1 |
| 194 | `FRMREMESSAVENDAS` | 1 | 1 |
