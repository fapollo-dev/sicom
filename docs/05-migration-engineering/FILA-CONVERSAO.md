# Fila de conversão — as 194 telas com uso que ainda faltam

Gerado de `MENUEXPRESS` da produção em 15/09/2026, cruzado com os `FRM*` presentes em `apps/api`.
Exclui as 5 telas de PDV (fora de escopo por instrução do usuário).

> **A leitura honesta são dois números, não um.** Por **uso**, o Apollo cobre **98,4%** — mas o uso é
> hiperconcentrado: `FRMETIQUETA` sozinha responde por **2.375.302 de 3.045.902** acessos (78%). Por
> **formulário**, são **91 de 289** com uso registrado (31%). As 194 abaixo somam 4.145 acessos — 0,1% do
> volume, e ainda assim são 194 telas de trabalho.

## ⚠️ As 8 telas que ficaram FORA desta fila (varredura de 18/09/2026)

A fila foi gerada cruzando o `MENUEXPRESS` com os `FRM*` presentes em `apps/api`. Uma varredura do
`MENUEXPRESS` inteiro (289 formulários com uso) contra **a fila + o que já existe no Apollo** achou **8
formulários que não estavam em nenhum dos dois**, somando **43.071 acessos**:

| tela | acessos | op. | último acesso | veredito |
|---|---:|---:|---|---|
| `FRMFECHAMENTOSANGRIA` | 36.522 | 38 | 18/09/2026 | ⛔ PDV — fora de escopo por instrução do usuário |
| `FRMDEVOLUCAOVENDAS` | 3.958 | 36 | 17/09/2026 | ✅ **convertida** (mig 275) — era a maior lacuna de retaguarda |
| `FRMNFCE` | 1.444 | 13 | 17/09/2026 | ⛔ PDV |
| `FRMMANCADCARTAOBOAVISTA` | 560 | 6 | 20/05/2026 | 🟡 **sem unit no repositório — e o substrato é ENORME**: `RETORNO_PAG_BOAVISTA` **2.423.986** linhas · `REGISTROS_BOAVISTA` **977.994** · `RETORNO_BOAVISTA` 3.937 · `BANDEIRAS_BOAVISTA` 420 · `OPERADORAS_BOAVISTA` 322 · `CONTAS_CORRENTES_BOAVISTA` 4. **Nenhuma delas está no `plano-tabelas.json`** — achado de CUTOVER, não só de conversão. Precisa do fonte novo |
| `FRMVERIFICACAOTRIBUTARIABORBAFISCAL` | 388 | 3 | 15/06/2026 | 🟡 integração Borba Fiscal — **sem unit no repositório** (só referências em `UCadEmpresa`/`UdmSpedPisCofins`); corte próprio, já mapeado na memória |
| `FRMCADPDV` | 93 | 8 | 01/06/2026 | ⛔ PDV |
| `FRMCADDEVOLUCAO` | 91 | 16 | 19/08/2026 | 🪦 **marginal, com prova**: `DEVOLUCAO` tem **1 linha** (20/09/2022) e `I_DEVOLUCAO` **2 itens**; a devolução de compra viva está convertida (`compras/devolucao-compra`, sobre `PEDIDO_DEVOLUCAO_COMPRA`) |
| `FRMCADBALANCO` | 15 | 4 | — | 🪦 `BALANCO` com 8 linhas (o inventário/balanço do Apollo cobre) |

**Lição**: uma fila derivada por cruzamento só é completa se o cruzamento for verificado nos DOIS sentidos.

## Placar da fila — **194 de 194 com veredito** (18/09/2026)

| | telas | acessos | o que é |
|---|---:|---:|---|
| ✅ convertida | **43** | 1.422 (34,3%) | migrada, com migration, smoke e dossiê |
| 🟢 coberta | 23 | 480 (11,6%) | o que ela faz já existe em outra tela do Apollo, com a prova ao lado |
| 🪦 marginal | 39 | 820 (19,8%) | a regra existe, mas o dado do cliente é resíduo (0 a algumas dezenas de linhas, ou parou há anos) |
| ⛔ sem substrato/fonte | 81 | 1.380 (33,3%) | tabela vazia, tabela inexistente, unit ausente do repositório, ou fora de escopo (PDV) |
| 🟡 adiada com recon | **8** | 43 (1,0%) | viva e real — precisa de corte próprio |

**Todo veredito tem procedência**: contagem no Oracle de produção (só leitura), linha do fonte Delphi, ou
ambos. As 🟡 que restam são o trabalho que sobra desta fila:

| # | tela | por que ficou |
|---|---|---|
| 89 | `FRMPRECIFICACAONFBRUTA` | escrita sobre o motor de preços (LOTEPRECO + MARKUPFIXO) |  | ✅ **completa** (mig 273, `precificacao/nf-bruta`, dossiê `uPrecificacaoNFBruta.md`) — a irmã enxuta da precificação por NF: enfileira o lote com o preço sugerido e grava o markup fixo. **Dois defeitos corrigidos**: o legado dá `Commit` DENTRO do laço (lote pela metade se um item falha) e grava o lote na empresa da NOTA mas o markup fixo na empresa LOGADA. E o lote agora nasce com `origem` — as 67.855 linhas de `LOTEPRECO` com origem nula no cliente são desta tela, que não preenche a coluna |
| 97 | `FRMSINTEGRA` | o leiaute vive numa DLL de terceiros que não veio no repositório (128 funções externas) |  | 🟡 **bloqueada por falta de material, com prova (18/09/2026)**: o gerador do arquivo SINTEGRA (Convênio 57/95) **não formata nada no fonte** — as **128 funções de registro** (`Registro10`, `Registro50`, `Registro54`, `Registro60A`, `Registro74`, `Registro75`, `Registro90`…) são `external 'SIntegra32Dll.DLL'`, e **a DLL não veio no repositório**. O que veio são as consultas (`UdmSintegra`: `NFAUXSPED` 293, `VENDASAUXSPED` **201.878**, `NF_PRODAUXSPED` 3.336 — tabelas de trabalho com o processamento de **agosto/2026**), e essas mesmas fontes já alimentam o SPED EFD ICMS-IPI do Apollo (C100/C170/C190/H010/E110). Converter aqui é **reimplementar o leiaute posicional da legislação**, não migrar código — corte próprio, com a DLL ou o leiaute em mãos. Último acesso 25/05/2026, 2 operadores |
| 110 · 145 | `FRMCADCLASSTRIBIBSCBS` · `FRMCADCSTIBSCBS` | reforma tributária (EC 132/2023) | | ✅ **corte-1 completo** (mig 278, `cadastro/reforma-ibscbs`, dossiê `uCadIBSCBS.md`, smoke §153.1-5) — sem fonte porque o repositório é de **mai/2020** e a reforma é de 2023+; o material é o dado da produção. E o mecanismo está **vivo**: `NF_PROD_IBSCBS` tem **98.747 itens** (base R$ 26.276.533,06 · IBS R$ 15.931,30 · CBS R$ 143.275,55), **68.677 só em 2026**, e **44.501 dos 47.729 produtos (93,2%) já estão classificados**. A alíquota praticada (0,1% IBS + 0,9% CBS) **bate com o seed da mig 007**, feito da legislação antes de olhar o cliente. **A regra que uma implementação ingênua quebra**: a redução de IBS e a de CBS são independentes — há classificação com **60 no IBS e 100 na CBS**, e um percentual só cobraria imposto a mais. Também: a CST vale por documento fiscal (**9 flags**, não uma) e excluir classificação em uso é 422 (a nota sairia sem cClassTrib, rejeição na SEFAZ). **Corte-2 COMPLETO** (mig 279, `fiscal/nf-ibscbs`, smoke §154.1-5): os grupos na nota. ⚠️ **A alíquota EFETIVA é a que conta** — nos 31.633 itens com redução, usar a cheia cobraria **R$ 103.951,14 a mais** (23× no IBS e na CBS). E ler a coluna que o legado grava não resolve: `PALIQEFET_CBS` é 0 em 46.677 itens cuja redução é 0, e acerta só **57,9%** contra **99,96%** de quem deriva da redução. ⚠️ **O que o fornecedor mandou não é o que fica**: 36.278 itens com base alterada (R$ 4.040.470,56 → R$ 8.936.794,30) e 9.530 CSTs reclassificadas, 7.753 de 000 para 200 — o par `_ORI` existe para isso e recalcular não o reescreve. `VIBS = VIBSUF + VIBSMUN` é exato em 10.012/10.012. **AUDITORIA (mig 280)** — a pedido do usuário revisei o corte-2 minuciosamente e achei **4 defeitos meus**: (1) eu **cobraria imposto sobre imunidade constitucional** — `PRED_IBS` nulo significa "sem redução" em `TIPO_ALIQUOTA='Padrão'` e **"não tributa"** em `'Sem alíquota'`, e o cliente tem 17 produtos com CST 410 (livros/jornais) e 6 com CST 620 (combustível monofásico) circulando; (2) **a base não é o valor cheio** — a LC 214/2025 art. 12 §2º exclui ICMS, ISS, PIS e COFINS, e a fórmula certa acerta **98,2%** contra 61,5% da minha, que inflava a base em R$ 806.350,38 (R$ 213.682,85 de imposto a mais no regime pleno); (3) eu buscava a alíquota por `current_date` em vez da **data da nota** (26,5× de erro ao recalcular em 2033); (4) eu **carimbava procedência falsa** no par `_ORI`, o que faria a nota nunca mais divergir. A trava certa exige os DOIS indicadores (`IND_GIBSCBS` e `TIPO_ALIQUOTA`) — nenhum basta sozinho — e vale em 56 das 132 classificações; o que não se sabe calcular é recusado, não estimado. Folds confirmados: IBS municipal zero em 98.794/98.794 e **imposto seletivo inexistente no leiaute do legado** (frente nova: 3.276 produtos de bebida/fumo). **SEGUNDA REVISÃO** (o usuário mandou conferir de novo): auditei o que a primeira não olhou — o corte-1, o código e o ETL — e achei **mais 6 defeitos**: o cálculo **não tinha transação** (metade dos itens ao lado do cabeçalho velho); o `TIPO_ALIQUOTA`, que governa a fórmula, era **opcional e texto livre**; a exclusão validava fora da transação (**TOCTOU**); o histórico **perdia o nome** da classificação estornada; o upsert não atualizava nota/produto do item; e **a carga falharia na FK** — o legado guarda **9.733 itens e 416 cabeçalhos órfãos** (R$ 1.141.521,80 de base), agora filtrados e contados. **CORTE-3 (mig 281): a APURAÇÃO** — ⚠️ IBS e CBS se apuram **separadamente e um não compensa o outro** (a CBS é federal, o IBS é dos Estados e Municípios), e as ordens de grandeza provam por quê: em 2026-01 o crédito de IBS é R$ 1.530,42 e o de CBS R$ 13.745,12. Fold: o débito de cupom não entra (nenhuma NFC-e carrega os grupos; PDV fora de escopo). **CORTE-4 (mig 282): o IMPOSTO SELETIVO** — ⚠️ ele **INTEGRA** a base do IBS/CBS (art. 12 §1º), ao contrário de ICMS/ISS/PIS/COFINS, que a base exclui: é apurado ANTES e somado. Substrato de **R$ 22,66 milhões** (70.085 itens de bebida e 2.739 de fumo). Água (2201) e álcool (2207) ficam de fora de propósito — mesmo capítulo, não sujeitos. Ad valorem e por unidade, as duas formas (o cigarro é específico). **Não há apuração de IS**: ele é monofásico na origem e o supermercado não é contribuinte. **CORTE-5: os grupos na TRANSMISSÃO** — o Apollo não monta o XML (fica atrás da porta SEFAZ, `uNF.md` §8), mas o contrato **não levava os grupos**: o provider real emitiria a nota sem IBS/CBS/IS e a SEFAZ rejeitaria, lacuna que só apareceria na primeira transmissão real. `TransmitirReq` passou a levar o total e o detalhe por item. **E o que NÃO foi implementado, com prova**: das 76 classificações não calculáveis, o cliente usa 28 (imunidade e monofasia, já tratadas) e **48 não têm substrato nenhum** — incorporação imobiliária, locação, transporte internacional, resseguro, cooperativas, serviços financeiros: 0 produtos e 0 itens de nota. Essas são **recusadas** com a lista do motivo, não estimadas |
| 123 | `FRMRELCONFERENCIAEFD` | conferência do EFD — viva em 09/2026, sem fonte no repositório de mai/2020 |
| 124 | `FRMAUTORIZACAOPAGAMENTO` | alçada de pagamento — viva em 06/2026, sem fonte |
| 139 | `FRMRECEBIMENTOS` | recebimento de mercadoria — vivo em 08/2026, sem fonte |
| 148 | `FRMCADCODIGOAJUSTE` | códigos de ajuste do SPED — tabela vazia, mas acesso em 09/2026 |
| 151 | `FRMGERENCIARSUGESTAOPROMOCAO` | sugestão de promoção — viva em 08/2026, sem fonte |

| # | tela | acessos | operadores | nota |
|---|---|---|---|---|
| 1 | `FRMCADMDFE` | 153 | 12 | ⛔ **não migrar**: a tela nunca foi implementada no legado — 47 linhas com o corpo comentado, `.dfm` com um GroupBox vazio, DataModule vazio, e `MDFE`/`MDFE_DOCUMENTO` com 0 linhas. Migrar seria escrever do zero |
| 2 | `FRMRELINTERSECCAOPRODUTOS` | 117 | 10 | ✅ **completa** (mig 221) — sem a tabela de trabalho global do legado |
| 3 | `FRMDIGITACAOPEDIDOS` | 116 | 9 | 🪦 **corte-1 entregue (mig 222) e o resto é fluxo MORTO, com prova nova (18/09/2026)**: a digitação de pedidos **parou em fevereiro de 2025** — 2025-01: 1.200 pedidos · 2025-02: 212 · 2025-03: **1** · 2025-04: 1 · nada até 2026-03 (1) e 2026-07 (1). Em 2026 são **2 pedidos, R$ 4.993** contra 16.115 em 2024. Os 116 acessos são históricos (último 12/08/2026, consulta). A consulta e a promoção acumulativa (quem dá 5× o desconto) estão no corte-1; digitar pedido novo e reservar estoque é reconstruir um fluxo que a casa desligou |
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
| 17 | `FRMDESCONTOTITULO` | 68 | 11 | ✅ **completa** (mig 226 + **272**, `cobranca/desconto-titulo`, dossiê `uDescontoTitulo.md`) — o **encontro de contas** (o nome engana). Corte-2 executa e reverte: **abate o MENOR dos dois valores reais nos dois títulos e o que sobra de cada um vira título novo** — regra única reconstruída da operação 221 do cliente, que reproduz os dois casos do comentário do autor. O dado **contradiz o comentário**: o título gerado fica só com `CODGRUPO_DESCONTO_TITULO`. A mais: reverter é recusado se o título gerado já tem baixa (o legado deixava a baixa órfã) |
| 18 | `FRMPEDIDOSCOMPRACERAL` | 68 | 5 | ⛔ **sem substrato**: `PEDIDOCOMPRACEREAL` com **0 linhas** |
| 19 | `FRMPRECIFICACAOPROD` | 67 | 7 | 🪦 **marginal, com o fonte em mãos (23/09/2026)**: o "sem fonte" antigo estava errado (`uFrmPrecificacaoProd.pas` + `uDMPrecificacaoProd` existem — lição 121). É um editor de preço de venda em massa: filtra produtos, mostra por loja custo real/reposição/CSI, PMZ, venda sugerida e lucro bruto, e "Aplicar" grava **só `MULTI_PRECO.VRVENDA`** (na loja, ou em todas com a opção) — sem histórico, sem lote. **Nenhum acesso desde 12/05/2026**, quando o `MENUEXPRESS` passou a registrar data (os 67 são anteriores), e 60 deles dos operadores 1-3. O preço vivo passa pelo cadastro do produto, pelo pedido de compra e pela precificação de NF, todos convertidos. Reabrir se voltar a ter uso |
| 20 | `FRMAGRUPACARTAO` | 64 | 11 | ⛔ **mecanismo nunca usado**: agrupa lançamentos sob um número de resumo da operadora, gravando `CARTAO.RESUMO` — coluna **nula nas 2.059.893 linhas**. Os 64 acessos são gente abrindo a tela |
| 21 | `FRMCONSCLIRCB` | 64 | 8 | ✅ **completa** (mig 227) — ⚠️ o legado exibia **R$ 11,5 milhões** de juro fantasma: a coluna JURO usava um default de 9% a.m. que o TOTAL não aplicava, em 99,96% dos títulos |
| 22 | `FRMRELPEDIDOCOMPRA` | 63 | 6 | ✅ **convertida** (mig 306, `relatorios/pedidos-compra`, dossiê `uRelPedidosCompra.md`, smoke §166). ⚠️ **O veredito anterior estava ERRADO**: "sem fonte no repositório" — o fonte existe, `uRelPedidosCompra.pas` (com "s"; a classe é `TfrmRelPedidoCompra`, e a busca pelo nome do form não casava com o da unit). Previsão de pagamentos dos pedidos, **por pedido e por loja** (Σ `PEDIDO_COMPRA_QTDE.TOTALCUSTO`), desdobrada nas parcelas da condição, com os 4 filtros de data e os 5 agrupamentos dos `.fr3` |
| 23 | `FRMCADHISTORICOCONTABIL` | 62 | 3 | ✅ **completa** (mig 231; a tabela e os 54 templates vieram na 229) — o texto que o razão imprime, com os `*` que a contabilização preenche. A tela simula o resultado enquanto se digita, usando a **mesma** função que a API usa para escrever |
| 24 | `FRMMULTATUALIZACAO` | 60 | 6 | ✅ **completa** (mig 232) — um campo, uma operação, N produtos. As três travas do legado (composição, tipo de família, hierarquia do subgrupo) + prévia com a MESMA conta da gravação. ⚠️ corrigido: dividir por zero derrubava a rotina; e os campos de controle (IDPRODUTO, auditoria) saíram do combo, onde o legado os deixou por esquecimento |
| 25 | `FRMCADTERMINAIS` | 56 | 2 | ⛔ **fora de escopo por instrução (NADA de PDV)** — as 8 linhas de `TERMINAIS` são os CAIXAS: cada uma aponta para um Firebird local (`192.168.15.xx:C:\SICOM\CONFIG\VENDAS.FDB`) e guarda a `DTAULTIMACARGA` da carga de preço para o PDV. O cadastro existe só para alimentar o PDV. Vivo (última carga hoje), mas reavaliar apenas se o escopo de PDV mudar |
| 26 | `FRMCONFIGINTEGRACAOCONTABIL` | 55 | 2 | ✅ **completa** (mig 233; as 60 colunas já vieram na 199-201) — qual situação o razão usa em cada um dos 59 eventos, nas 5 abas do legado. ⚠️ a tela avisa quando o apontador cai numa situação **sem as duas pernas**, que é o erro que só apareceria na contabilização; e grava só o que mudou, para não apagar configuração alheia num painel de 60 campos |
| 27 | `FRMANALISECOMPORTAMENTO` | 53 | 8 | ✅ **completa** (mig 251) — estava **adiada** (a cache do Giros dava 0,75% de diferença); o critério fechado na mig 250 reproduz a cache a **1 centavo em R$ 1,1 milhão**. Três blocos (mês anterior / atual / ano anterior) × nove linhas × cinco "semanas" **fixas** de 7 dias (1–7, 8–14, 15–21, 22–28, 29–fim; semana 1 de ago/2026 = 238.838,52 nos dois lados) + dois comparativos. ⚠️ a tela tem **dois critérios**: com filtro de família ela sai da cache e calcula com um `LEFT JOIN MULTI_PRECO` **sem IDEMPRESA** (111.535 linhas → 475.737, ×4,265) e um `IDEMPRESA IN (1)` **fixo no código** — CMV de **R$ 3.518.208,52** contra R$ 805.652,00 (4,37×), e a loja 2 vendo o custo da loja 1. ⚠️ `IMPOSTOS` tem **0 linhas** no cliente: a "Previsão de Impostos" nunca teve dado (Lucro Final sempre = Rentabilidade); a tabela e a manutenção entram. ⚠️ a NF do caminho filtrado entra por `VRVENDA`, zero em 57 dos 62 itens. Esta tela acerta a % do comparativo (÷ base) |
| 28 | `FRMCONFIGDRECONTABIL` | 51 | 3 | ✅ **completa** (mig 234) — o editor da árvore do DRE, que era o corte-2 declarado na migration 047. 98 linhas em 3 níveis, 10.439 vínculos conta→linha. ⚠️ a classe passa a vir do tipo (no cliente a correlação é perfeita: 78 P↔A, 20 sintéticas↔S) e **uma conta só entra em uma linha** — o legado não trava, e sem isso ela soma duas vezes no DRE. Falta o seletor de contas em lote |
| 29 | `FRMCADAGENDALIMITACAOVENDA` | 51 | 6 | ✅ **completa** (mig 235) — quanto cada cliente pode levar de um produto no período. Uso **sazonal**: 11 agendas e 92 itens entre 2020 e 2023, 8 delas ligadas ao "DIA D". ⚠️ o `CODGRUPO` do item é o grupo de **PREÇO** (não o de produto), e é por ele que o flag estende o limite à família |
| 30 | `FRMCONFINTEGBANCARIA` | 50 | 3 | ✅ **completa** (mig 236; a tabela veio com o CNAB na 153) — banco, conta, layout e convênio que o CNAB de cobrança usa. 3 configurações vivas no cliente (última alteração 02/07/2025). ⚠️ a tela avisa que a **sequência é ESTADO** (baixá-la faz o banco rejeitar a remessa) e que **CODBCO e CODFORNBCO são dois números diferentes** para o mesmo banco |
| 31 | `FRMCADCONFPLANOCONTAS` | 45 | 2 | ✅ **completa** (mig 237; a tabela veio nas 103/108) — a máscara do código e as contas padrão por natureza. ⚠️ **corrigido um defeito nosso**: o seed dizia `1,1,2,2,4`, mas **10.653 contas** do cliente usam 5 dígitos no último nível contra **297** com 4, e `NDIG_5` diz 5 — com a máscara curta o auto-código errava em 97,3% dos casos. 4 checks de smoke antigos foram atualizados |
| 32 | `FRMRELFINANCEIRO` | 43 | 7 | 🟢 **equivalente** (mig 238): recebíveis e compromissos no mesmo extrato, com a baixa ao lado. ⚠️ **o filtro por data de BAIXA do A Receber nem roda no legado** (ORA-00918, coluna ambígua) — e a coluna que ele tentaria usar esconde **11.782 títulos baixados, R$ 12.207.925,74**. Falta o ramo de cartões (2,06M linhas) |
| 33 | `FRMSIMULADORVENDA` | 42 | 5 | ✅ **completa** (mig 239) — o vendido no período, produto a produto, com o preço simulado ao lado. ⚠️ **o legado somava TODAS as empresas** (a query não filtra `IDEMPRESA`): em agosto/2026 mostrava R$ 2.227.179,71 onde a loja da sessão vendeu R$ 1.153.860,03. O "Lucro %" é markup sobre o custo, e foi mantido |
| 34 | `FRMCADACORDOCOMERCIAL` | 39 | 4 | 🪦 **marginal — parado desde jan/2022**: `ACORDO_COMERCIAL` tem **7 acordos** em toda a base (set/2020 a **07/01/2022**), `ARQUIVO_ACORDO` está **zerada**, o `FLG_OPERACAO_ACORDO` (abater no boleto / gerar novo financeiro) é **nulo nos 7** e a situação contábil do acordo (`CONFIG_ACORDO_COMER_DESC_NF`) nunca foi configurada — ou seja, nenhum acordo chegou ao razão. Reavaliar se voltar a ser usado |
| 35 | `FRMAPURACAOPISCOFINS` | 39 | 2 | ✅ **completa** (mig 240) — a TELA do motor que já existia desde a migration 098: apurações realizadas, crédito × débito e o **saldo por tributo** (o a recolher do M200/M600). Crédito maior que o débito **transporta**, em vez de virar valor negativo. Excluir é o "reabrir" do legado |
| 36 | `FRMEXTRATOFORNECEDORES` | 38 | 4 | 🟢 **equivalente** (mig 241): o que se deve a cada fornecedor, com o **saldo retroativo** (que olha a data do pagamento, não o flag — título pago depois ainda era dívida naquele dia). ⚠️ o campo Parceiro do legado é **injeção de SQL** (sem `%`, concatena cru: `AND PA.RAZAO NESTLE`, que nem roda). O modelo de cheques próprios fica fora: `CHQ_PROPRIO` tem 0 linhas |
| 37 | `FRMANALISECOMPRAVENDACASACARNE` | 37 | 6 | 🟢 **equivalente** (mig 242): compra a peça, vende o corte — 13 peças em 30 cortes, vivo (corte vendido hoje). ⚠️ **o custo do corte saía 2,4× maior**: o legado esquece o `/100` do percentual e usa o custo UNITÁRIO — R$ 7.047,00 contra R$ 2.956,85, **138,3% a mais**. E a tabela de trabalho era `CREATE TABLE` em runtime; virou CTE |
| 38 | `FRMRELATORIOVENDASDINAMICO` | 37 | 8 | 🟢 **equivalente** (mig 243): giro do período + última compra e custo, por produto. ⚠️ **quatro defeitos corrigidos**: `f.ativado=S` no WHERE anulava o LEFT JOIN (**228 produtos** sumiam); a última compra não filtrava empresa (3) nem nota cancelada (4); o último custo vinha do **maior CODNF** em vez da nota mais recente (**1.431 de 19.966**); e havia **uma consulta por linha** só para o saldo de estoque |
| 39 | `FRMRELPRECOSALTERADOS` | 35 | 4 | 🟢 **equivalente** (mig 244): que preços mudaram, de quanto para quanto e por quem, nas duas origens. ⚠️ **o legado escondia 55,2% das alterações**: o `JOIN HISTORICO_DINAMICO` é INNER e `MULTI_PRECO.CODHISTORICO` só existe em 43% das linhas — 328 de 594 em ago/2026. E o `ROWNUM=1 ORDER BY` do outro dataset devolve linha arbitrária (produto 8242: 17,90 em vez de 12,99) |
| 40 | `FRMCADANALISECONCORRENTES` | 35 | 4 | 🪦 **marginal** — mesmo substrato do item 15: `CONCORRENCIA` **20** linhas, `ANALISE_CONCORRENCIA` **1** e `MOV_ANALISE_CONCORRENTE` **6**. A pesquisa de preço de concorrente nunca pegou no cliente |
| 41 | `FRMRELANALISEITENSNF` | 34 | 4 | 🟢 **equivalente** (mig 245): item a item das notas, com custo, base, ICMS, ST e isento. ⚠️ o `WHERE` do legado **só filtrava DATA** — somava 6.840 entradas com **943 saídas** de **3 empresas** em ago/2026, inclusive canceladas. E `NP.DESCONTO` sem `COALESCE` sumia com o item do total (23 de 497.627) |
| 42 | `FRMIMPORTAPED` | 34 | 7 | 🪦 **marginal + fora de escopo**: importa pedido de **arquivo texto num diretório** (`PEDIDOS_*.txt` delimitado por `|`), nas abas Convênio, **Smart PDV** (fora de escopo por instrução) e Site. Medido: **28 pedidos importados** de 37.080 (**0,08%**), e `ORIGEM_IMPORT` nula em todos. A exportação de cadastros para o PDV externo é do mesmo bloco. Reavaliar se o e-commerce entrar em escopo — aí a forma muda de diretório para upload/API |
| 43 | `FRMFATURAMENTO2` | 34 | 8 | 🟢 **corte-1** (mig 246): as parcelas de cada nota, com a legenda de três estados (vencendo hoje / atrasada / faturada). **47.063 parcelas, 42.502 notas, R$ 125,7 milhões**, 7.472 em 2026. ⚠️ cópia-fiel-negativa: `TIPOREF` nulo nas 47.063 e `LOTE_FATURAMENTO` com 0 linhas — a aba de movimento não tem substrato. ⚠️ **5 parcelas com o ano digitado errado** (202, 2202, 5202), R$ 11.193,35. Falta o ato de faturar (que mexe em `pedidos` e `cx_pedidos`) |
| 44 | `FRMCADCONCORRENTES` | 32 | 4 | 🪦 **marginal** — mesmo substrato do item 15: `CONCORRENCIA` **20** linhas, `ANALISE_CONCORRENCIA` **1** e `MOV_ANALISE_CONCORRENTE` **6**. A pesquisa de preço de concorrente nunca pegou no cliente |
| 45 | `FRMPEDIDOTRANSFERENCIA` | 32 | 7 | 🪦 **marginal**: pedido de transferência entre lojas é `PEDIDOS` com `TIPO='T'` — **33 pedidos** em 37.080, de **15/12/2023 a 26/02/2025**, parado há 7 meses. A operação é real e pode voltar; hoje não justifica o corte frente a telas com mais uso |
| 46 | `FRMDEVOLUCAO_NF` | 30 | 7 | ⛔ **sem fonte no repositório clonado** — o menu a chama "Devolucao de Vendas (NF)", mas nenhuma unit responde por `FRMDEVOLUCAO_NF` nem pelo caption. As outras devoluções TÊM fonte e estão em outro ponto da fila: `FRMDEVOLUCAOVENDAS` (3.958 acessos), `FRMCADPEDIDODEVOLUCAOCOMPRAS` (2.525, já migrada), `FRMCADDEVOLUCAO` (91) |
| 47 | `FRMMOVIMENTACOESDIA` | 27 | 8 | ✅ **completa** (mig 247) — o "o que aconteceu hoje e quem fez": pedidos, contas pagas, recebidas e o log, os quatro por período e operador. ⚠️ a tabela **`HISTORICO`** (a trilha em TEXTO, **455.264 linhas** até hoje) **não existia no destino** e entra agora. ⚠️ as quatro consultas do legado **não filtram empresa** (nem as views que elas usam) |
| 48 | `FRMCADAGENDAPREVPAGTO` | 27 | 4 | 🪦 **marginal — carga única e parada**: `AGENDA_PREV_PAGTO` tem **27 linhas, todas cadastradas em 04/10/2021 no mesmo minuto** (uma carga só) e nada depois. A previsão de pagamento recorrente nunca virou rotina |
| 49 | `FRMVACINAS` | 27 | 6 | ⛔ **sem substrato**: não existe tabela `VACINAS`; a única do assunto é `CAMPANHA_VACINACAO`, com **0 linhas**. As units existem (`Uvacinas`, `uCadCampanhaVacina`) mas o mecanismo nunca foi usado |
| 50 | `FRMLANFRETE` | 27 | 4 | ⛔ **sem substrato, com o fonte em mãos (23/09/2026)**: o "sem fonte" antigo estava errado (`UlancFrete.pas` existe — lição 121). É o "Lançamento de Freteiros", um cadastro sobre `FRETEIRO` (funcionário, valor, data, observação) — e `FRETEIRO` tem **0 linhas** na produção. O acesso de 03/09/2026 foi abrir a tela, não gravar |
| 51 | `FRMRELTROCAMERCADORIAFOR` | 27 | 5 | 🪦 **marginal**: `TROCA` tem **107** registros e `ITENS_TROCA` **309** (último item em 24/11/2025). A troca com fornecedor existe, mas em volume que não justifica corte próprio agora |
| 52 | `FRMCONSPROD` | 25 | 8 | ✅ **completa** (mig 249) — a consulta com **preços** (o que a `get_produtos` não traz) + a **`FRMPOSICAOPRODUTO`** no mesmo corte, porque ela não tem acesso próprio: só abre de dentro desta. A escada de custo→lucro é **lida** de `MULTI_PRECO` (a foto da precificação), não recalculada. ⚠️ os quadros de venda do legado leem **caches materializadas por job** (`MOVIMENTOS_VENDAS`, `SELECT_PEDIDOS`) que **não batem com a venda**: em ago/2026, mês FECHADO, a cache marca **+226,5 un** e em 2025 **+620,35** — ela congelou vendas canceladas depois do job e nunca reprocessa o passado (7,5% dos produtos divergem no mês corrente). ⚠️ a "média anual" esconde **sete anos** (a cache começa em 2025-01, a venda em 2018). ⚠️ o modo "Pedidos" muda **1 quadro de 4**, e nesse único aplica `TIPO='P'` — NULL em **36.887 dos 37.080** pedidos (99,5%). ⚠️ critério de cancelado divergente entre quadros (33 pedidos entram num e somem do outro) |
| 53 | `FRMRELANALISECOMPORTAMENTOPERIODO` | 24 | 6 | ✅ **completa** (mig 250) — compara três períodos nomeados em seis métricas. O legado lê a cache do **Giros** (o processo externo que bloqueou o item 27), mas aqui os campos são nomeados e deu para **reconstruir o critério do dado**: o faturamento fecha **60 de 60 dias × 2 lojas exatos** (e produto a produto), os tickets 58/60, a NF em todos os dias com nota. ⚠️ o **CMV do Giros usa o custo da madrugada seguinte**, não o da venda (produto 130 gravou 24,33 e a cache diz 26,367) — 177/180 dias exatos, **0,027%** de diferença total; aqui sai do custo da linha da venda. ⚠️ a **variação % divide pela referência**: ago/2026 × ago/2025 é queda de 31,28% e a tela mostra **−45,52%** (14,24 pontos). ⚠️ a mesma tela conta ticket por **cupom** sem filtro e por **pedido** com ele (974 × 970). ⚠️ a cache termina ontem; calculando, hoje aparece |
| 54 | `FRMCADINDEXADORTRIBUTARIO` | 23 | 4 | ✅ **completa** (mig 248) — de onde sai o ICMS-ST de toda entrada. **12.053 indexadores atualizados hoje**, para apenas **1.075 NCMs**: 748 NCMs têm mais de um e o `19053100` tem **285**, então a chave é a figura completa com desempate por especificidade (o motor já existia). ⚠️ indexador **sem discriminador** seria curinga universal no OR-null: recusado. Exclusão é **lógica** (`INDR=E`), como no legado |
| 55 | `FRMPROCESSAAPAGAR` | 23 | 4 | 🪦 **marginal — abandonado em 2021, com prova**: é o gerador de **CNAB 240 de pagamento a fornecedor** (segmentos J/J52, tributos por código de barras `8x`, concessionárias) sobre um componente compilado (`VTASCNAB` no repositório são 1.469 linhas de invólucro; o layout, o `StrToBanco` e o `TBoletoValidador` não vieram). Uso real no cliente: `REMESSA_GERADA='S'` em **18 de 55.240** títulos, **3 lotes** (nº 2, 22 e 42 — o contador chegou a 42, só 3 pegaram), **R$ 27.081,94**, o último em **29/01/2021**. `CODBARRASBLT` preenchido em 2,2% dos títulos e caindo: 999 em 2020 → 3 em 2025; nos **8.443 títulos abertos**, só **7** têm código de barras (0,08%). A função de converter código de barras de 44 posições em linha digitável não tem um só título de 44 para converter. Reviver exigiria reescrever o CNAB 240 de pagamento da especificação FEBRABAN para um fluxo que o cliente tentou por seis meses e largou. As colunas `adcredito`/`agrupado` já estão no destino; `codbarrasblt`/`remessa_gerada`/`lote_remessa` vêm pela carga integral de `APAGAR` se um dia precisar |
| 56 | `FRMRELANALISEPEDIDONF` | 22 | 4 | ✅ **completa** (mig 252) — o RELATÓRIO da análise pedido × NF-e; a análise em si já vivia no destino (mig 152) e o motor em `compras/pendencias`. Viva no cliente: **9.796** análises, a última **ontem**. Lista por período/fornecedor/comprador com notas e pedidos agregados; "Expandido" embute o `dossie` do motor (divergentes / só na NF / só no pedido) — a mesma leitura, não uma segunda. ⚠️ o SQL do legado faz o **produto cartesiano NF × PEDIDO** e o `LISTAGG` lista cada nota N vezes (**31 análises** no cliente, 3×3 → 9 linhas). ⚠️ `JOIN OPERADORES` INNER derruba **24 análises ativas** (comprador nulo/órfão). ⚠️ `MAX(comprador)` esconde um dos dois em **5 análises**. Fold: comprador = `pedidocompra.codoperador` (a mig 060 não trouxe `USUCADASTRO`) |
| 57 | `FRMCONSAPGBX` | 20 | 7 | ✅ **completa** (mig 253) — consulta de baixas do A Pagar **por lote** (a F3 é por LOTE em `GET_APAGARBX`) + **Reverter baixa** do lote inteiro. Dado: **51.589 baixas em 7.383 lotes**, ~8 títulos/lote; **4.483 reversões**, sempre do lote inteiro (**461 lotes, 0 parciais**), 502 em 2026; 100% dos lotes de 2026 com movimento bancário. A reversão encadeia o `estornar` por título que já existia (extraído em `estornarNoTrx`) numa transação e cria o contra-movimento bancário (`idlote_reversao`, coluna que faltava). ⚠️ cheques (3 tabelas) **mortos** no cliente: 0 linhas com lote. ⚠️ `GET_APAGARBX_REVERTIDAS` soma `TXJUROS` ao valor e a normal não (inócuo: TXJUROS=0 nas 4.459 revertidas). `CaixaFechado` da conta vive em BO compilado que não veio; a trava é a do caixa do Apollo. Fold: baixa do Apollo não carimba IDLOTE → lote de um |
| 58 | `FRMRELDIFERENCASNFPEDIDO` | 20 | 5 | 🪦 **marginal — abandonado em 2021, com prova**: lê `DIFERENCANFPEDIDO`, gravada pelo `udmNF` no fluxo de importação da NF a partir do manifesto (`pOrigemManifestoDestinatario`). No cliente a tabela tem **9 linhas** (3 notas, 3 pedidos), a primeira em 11/09/2020 e a última em **07/12/2021**; e o filtro "Operador da liberação" lê `NF.CODOPERADOR_LIBERACAO`, que está **vazio nas 6.331** NFs de entrada de 2026. O que esta tela queria mostrar (divergência item a item pedido × NF) é hoje o item 56, sobre a análise persistida que a casa usa todo dia |
| 59 | `FRMRELCORTESIAS` | 19 | 3 | ⛔ **sem substrato, com prova**: o relatório cruza `PEDIDOS.NROCOMANDA` com `CONTROLE_CORTESIA` e `CATEGORIA_CORTESIA`. No cliente: `CONTROLE_CORTESIA` **0 linhas**, `CATEGORIA_CORTESIA` **0**, **0** parceiros com `IDCATEGORIA`, e `PEDIDOS.NROCOMANDA` nunca foi preenchido (**0 de 37.080**). Os 19 acessos abriram um relatório vazio. O cadastro irmão `FRMCADCATCORTESIA` (1 acesso, 1 operador) cai junto |
| 60 | `FRMCADMIDIADEPARTAMENTO` | 19 | 4 | ⛔ **sem fonte no repositório clonado** |
| 61 | `FRMCTRLRECARGASCORRESPONDENTE` | 19 | 3 | ⛔ **sem substrato, com prova**: controle de recargas de celular e de correspondente bancário feitas no PDV — lê `HIST_RECARGA` e `HIST_CORRESPONDENTE`, e as duas têm **0 linhas** no cliente (as tabelas existem com 12 e 11 colunas, e nunca receberam um lançamento). Além de vazio, é operação de PDV, fora do escopo |
| 62 | `FRMRELRUPTURAS` | 19 | 1 | ⛔ **sem fonte no repositório clonado** (e 1 operador) |
| 63 | `FRMATUALIZACAOPRODUTOS` | 18 | 5 | 🪦 **marginal — abandonado em 2023, com prova**: grade de edição em massa que grava, por produto, `MULTI_PRECO.VRCUSTO/VRVENDA`, cadastro (descrição, dpto/grupo/subgrupo, alíquota, tabela, PIS/COFINS), `ESTOQUE.QTDE/MINIMO/MAXIMO` e `ESTOQUE_DEP.QTDE` como valor **absoluto**, e escreve `HISTORICO_PROD` "ATUALIZAÇÃO MANUAL DE PRODUTO…" **incondicionalmente** a cada produto salvo. No cliente esse texto aparece **3 vezes, 1 produto, todas em 2023** (último uso **15/07/2023**); `HISTORICO_PROD_DEP` (o irmão do depósito) tem 19 linhas, 2020→2023. Os 18 acessos abriram a grade e quase nunca gravaram. ⚠️ e o que gravou está errado: o histórico leva `QTDE_ALTER = 0` com o novo `QTDE_ATUAL` — o Kardex mostra movimento zero e o saldo saltando. O que a tela faz já existe com histórico certo: `FRMMULTATUALIZACAO` (mig 232) para preço/cadastro e `FRMAJUSTEESTOQUE` para estoque com delta |
| 64 | `FRMAGENDADESCARREGAMENTO` | 17 | 4 | ⛔ **sem substrato**: `AGENDA_DESCARREGAMENTO` tem **3 linhas**, a última de **05/08/2020** |
| 65 | `FRMAGENDALOTEPRECO` | 17 | 5 | 🪦 **marginal — mecanismo inerte, com prova**: calendário (TDBPlanner) que agenda o processamento automático do lote de preço por empresa em `AGENDA_LOTE_PRECO`. No cliente a tabela tem **5 linhas** — um único agendamento, para **06/05/2026**, uma por empresa — todas `PROCESSADO='N'`; e em `LOTEPRECO` os **89.255** lotes processados são **100% `PROCESSADO_MANUAL='S'`** (mais 1.176 antigos sem a flag): a agenda nunca disparou um processamento. No repositório só a própria tela toca `AGENDA_LOTE_PRECO` — o consumidor seria externo (Giros) e não veio. O processamento do lote é o `FRMAJUSTEPRECOS`, já migrado |
| 66 | `FRMCONSRCBBX` | 17 | 4 | ✅ **completa** (mig 254) — a gêmea de recebíveis da 57: lotes de baixa do A Receber, títulos com **dias de atraso**, movimento bancário, **observação editável** da baixa e **Reverter lote** (o `estornar` do AR extraído em `estornarNoTrx`, encadeado numa transação + contra-movimento). Dado: **19.225 baixas em 3.219 lotes**, 611 reversões sempre do lote inteiro (109/0). ⚠️ `GET_ARECEBERBX` é UNION com `ARECEBER_BX_SALDO` (**0 linhas**) e carrega o juro fantasma de 9%; `PERMUTAS` **0 linhas**; cheques 0 — tudo fora. 2 baixas com DTPGTO no ano 5022 |
| 67 | `FRMRELPERDAS` | 17 | 4 | ✅ **completa** (mig 255) — relatório sobre os scraps que o Apollo já tem (`cadastro/scrap`): analítico (item a item + resumo por centro de custo) e sintético (produto × motivo × setor, custo médio ponderado + total por empresa), com os filtros do legado. Dado: **3.794 scraps, 133.309 itens**, último em 02/09/2026. ⚠️ **um scrap** (16155, 22/08/2026) vale **91,1%** das perdas de 2026 — um item de **139.502 kg** de MUCHIBA (média dos outros: 393 kg); o legado imprime o total sem avisar, aqui `totais.maiorItem` mostra o item e a participação. Fold: `STATUSNOTA` lê `PEDIDO_NF`, que não existe no destino |
| 68 | `FRMCADOPERADORASTELEFONIA` | 16 | 6 | ⛔ **sem substrato, com prova**: `CadMaster` de 45 linhas sobre `OPERADORAS_TELEFONIA` — **0 linhas** no cliente. É o cadastro que alimenta as recargas de celular do PDV (`HIST_RECARGA.CODOPERADORA`, item 61, também vazio). Os 16 acessos (último em 09/09/2026) abriram uma grade vazia |
| 69 | `FRMINTEGRACAOLOTEFGF` | 16 | 4 | 🪦 **marginal — integração externa parada, com prova**: baixa um XML de produtos do provedor **FGF** (classificação fiscal por EAN: NCM, CEST, CST ICMS/PIS/COFINS, natureza de receita, IBPT, MVA) pelo `IDCLIENTE_FGF` da empresa (6529 nas lojas 1 e 52) e aplica no cadastro de produtos. No cliente: `FGF_PRODUTOS`, `FGF_PRODUTOS_ESPELHO` e `FGF_VENDAS` **0 linhas**; `FGF_API` 19.353 (catálogo estático); `HISTORICO_DINAMICO_FGF` 201.399 alterações (147.900 em 2024, 53.499 em 2025) com a **última em 13/05/2025** — o serviço parou há 16 meses. Depende de um provedor externo que não está no repositório; o que ele alterava (alíquota, CEST, NCM, PIS/COFINS) é o cadastro de produto já migrado |
| 70 | `FRMSCANNTECH` | 16 | 3 | ⛔ **sem fonte no repositório e integração desligada, com prova**: nenhuma unit com o form (as 6 units que citam Scanntech são configuração e relatórios); `CONFIGURACOES.SCANNTECH = 'N'`, dias retroativos/intervalo/quantidade = 0. O que sobrou vivo — o `DESC_SCANNTECH` das vendas (6.579 itens em 2026) — é derivado das promoções (`VENDAS.IDPROMOCAO`) e já está nos relatórios de venda (mig 147) |
| 71 | `FRMCOLETOR` | 16 | 4 | 🟢 **coberto com substituição declarada**: importa um TXT de coletor (código de barras; quantidade; preço) e, por linha, grava `ESTOQUE.QTDE` (somando ou substituindo) ou `ESTOQUE_DEP.QTDE` e `PRODUTOS/MULTI_PRECO.VRVENDA` — **sem escrever `HISTORICO_PROD`** (estoque muda e o Kardex não vê). `COLETA_CODBARRA`/`COLETA_ITEM` **0 linhas** (o legado nem persiste a coleta). No Apollo a contagem por coletor entra pelo **inventário** (`importarProdutosInventario` → aplicar, com Kardex) e o preço pela fila de preço; a função existe, o caminho é outro |
| 72 | `FRMDECLARACAOIMPORTACAONF` | 15 | 6 | ⛔ **sem substrato, com prova**: a Declaração de Importação (DI) da NF de entrada — `NF_DECLARACAO_IMPORTACAO`, `_ADIC` e `_RESP` têm **0 linhas** no cliente. Supermercado não importa; a unit tem 1.105 linhas para uma aba que nunca foi preenchida |
| 73 | `FRMEXPORTANFE` | 15 | 2 | ✅ **completa** (mig 259) — as notas eletrônicas do período (chave, status SEFAZ, se há XML) e o XML guardado de cada uma (`nfe_xml`, **43.185** no cliente). Fold: o **DANFE em PDF** do legado não existe no Apollo (sem renderizador) — declarado; transmitir/cancelar/CC-e já são a `fiscal/nf` |
| 74 | `FRMRELACORDOCOMERCIAL` | 15 | 3 | 🪦 **marginal, com prova**: relatório sobre `ACORDO_COMERCIAL` — **7 acordos** na vida, cadastrados entre 04/09/2020 e **07/01/2022**, nada depois; `ARQUIVO_ACORDO` 0 linhas. O cadastro do acordo (`FRMCADACORDOCOMERCIAL`) segue o mesmo dado |
| 75 | `FRMCADPROMOCAODEPARTAMENTO` | 15 | 6 | ⛔ **sem substrato, com prova**: `PROMOCAO_DEPARTAMENTO` tem **0 linhas**. A promoção da casa é por produto/agenda (`FRMCADPROMOCAO`, épico Promoções já fechado) |
| 76 | `FRMCADPUBLICIDADE` | 14 | 5 | ⛔ **sem substrato, com prova**: publicidade com anexos e envios a parceiros — `PUBLICIDADE`, `PUBLICIDADE_ANEXO`, `PUBLICIDADE_ENVIOS` e `PUBLICIDADE_ENVIOS_PARCEIROS` têm **0 linhas**, as quatro. 529 linhas de tela para um mecanismo nunca usado |
| 77 | `FRMCADAGENDAATENDIMENTO` | 14 | 3 | ⛔ **sem substrato, com prova**: `AGENDA_ATENDIMENTO` e `AGENDA_NAO_ATENDIMENTO` têm **0 linhas** (último acesso 15/05/2026 — abriu vazio) |
| 78 | `FRMCADPERIODOCONTABIL` | 14 | 5 | ✅ **completa** (mig 256) — a tabela de onde saem as travas de período fechado (mig 038) ganhou a tela: competência única por empresa, normalizada para MMAAAA (o cliente tem `082024` e `02/2025` convivendo), nove bloqueios por tipo de movimento. Cliente: **3 períodos**, `CHAVEAMENTO_PERIODO` NULL — a trava viva é esta tabela |
| 79 | `FRMCONFIGURAPIX` | 14 | 1 | ⛔ **sem substrato, com prova**: `PIX_CONFIG` **0 linhas**, `PIX_TRANSACAO` **0 linhas**, nenhuma chave `%PIX%` em `CONFIGURACOES`; 1 operador, unit não está no repositório. (A `PIX_FLAVIA` de 253 linhas é tabela pessoal de backup, não do mecanismo.) PIX no PDV está fora do escopo |
| 80 | `FRMCADCARTAOPROPRIO` | 14 | 6 | ⛔ **sem substrato, com prova**: o cartão próprio da loja — `CRT_PROPRIO` **0 linhas**, `BX_APAGAR_CRT_PROPRIO` **0**. A `CONFIG_BAIXA_CHEQUE`/cartão próprio nunca teve lançamento |
| 81 | `FRMRELBALANCETE` | 14 | 4 | ✅ **completa** (mig 258) — saldo anterior/débito/crédito/saldo atual por conta sobre `DIARIO` (1,77 mi) × plano, faixa/nível/analíticas/sem movimento. ⚠️ o roll-up do legado só anda sobre contas com `NIVEL` — **387 de 11.028**; **520 das 658 contas com lançamento** não têm nível e ficavam fora dos totais dos pais. Aqui o nível sai do código expandido e o roll-up é por prefixo |
| 82 | `FRMEXTRATOCLIENTES` | 13 | 2 | ✅ **completa** (mig 257) — quatro modelos (período / referência a menor / a maior / saldo em) × campo de data × status × cliente, analítico/sintético. ⚠️ **três dos quatro modelos não filtram empresa** (2026: 3.129 títulos na loja 1, **6.364** no total). ⚠️ o "saldo em" confia em `DTPGTO`, vazio em **44.130 quitados (R$ 13,78 mi)** — aqui a data efetiva é a da baixa quando o título não a tem |
| 83 | `FRMCADPISCOFINS` | 13 | 3 | ✅ **completa** (mig 256) — as 12 situações de PIS/COFINS que 45.416 produtos apontam, com o **tipo de crédito** (SPED 4.3.6, `pc_tipocredito`, 25 códigos semeados) e `EXIGENATUREZA`, que o destino não tinha. Excluir situação em uso é recusado com a contagem (TRIBUTADOS tem 31.626 produtos). 5 situações do cliente chamam-se "CADASTRADO VIA FGF" (item 69) |
| 84 | `FRMCADCHEQUE` | 13 | 5 | 🪦 **marginal, com prova**: `CHEQUE` tem **11 cheques** na vida (20/04/2022 → 11/12/2023, 4 baixados); `CHEQUE_REP`, `CHEQUE_DEVOLVIDO` e `CHQ_PROPRIO` **0 linhas**; nenhum cheque com lote de baixa. A casa não recebe em cheque — 1.146 linhas de tela para 11 registros |
| 85 | `FRMCADLANCAMENTODIARIO` | 12 | 2 | ⛔ **sem substrato, com prova**: lançamento MANUAL no diário contábil — a tela grava `CODORIGEM = 1` e recusa editar/excluir lançamentos de outras origens. No `DIARIO` (1,77 milhão de linhas, 19 origens) **não existe um único lançamento com CODORIGEM=1**: a casa nunca lançou à mão. O diário é todo gerado pelas integrações (origem 61 = 1,2 mi), que o Apollo já tem, e a consulta do diário é a `contabil/lancamentos` |
| 86 | `FRMRELENTRADAS_FINAN` | 11 | 3 | ✅ **completa** (mig 262, `relatorios/entradas-financeiro`, dossiê `uRelEntradas_Finan.md`) — NF de entrada × títulos a pagar. Defeitos medidos: sem filtro de empresa (6.547 NF de 2026 das 3 lojas juntas); `COALESCE(TOTALPROD,0.01)`; não filtra cancelada. **Na loja 1, 346 de 4.007 NF de entrada de 2026 (R$ 438 mil) não têm título nenhum** — vem como coluna e filtro |
| 87 | `FRMCADNFE` | 11 | 1 | 🟢 **coberto, com prova**: config de NF-e por empresa — a tabela `NFE` tem **1 linha** (AUTENTICACAO = chave do componente NF-e `75A03A1D05F6850C`, TIPONFE `C`, NRONF 1), última alteração 07/02/2024, 1 operador, sem data de acesso. No Apollo série/ambiente/cUF vivem em `empresa_fiscal` (mig 030) e a numeração no motor de NF-e; a chave do componente Delphi não tem equivalente |
| 88 | `FRMCADCEST` | 11 | 3 | ✅ **completa** (mig 260, `cadastro/cest`, dossiê `uCadCest.md`) — a tabela CEST × NCM (19.109 pares, 896 CESTs) que `produtos.cest` aponta; não existia no destino nem na carga. **248 produtos apontam um CEST inexistente** (+4 fora do formato) — `sem-cadastro` lista; unicidade do par e "não apagar o último NCM em uso" a mais |
| 89 | `FRMPRECIFICACAONFBRUTA` | 11 | 4 | 🟡 **adiada com recon**: precificação pela NF "bruta" — 994 linhas, **último acesso 17/06/2026**, 4 operadores. SELECT de `NF_PROD` tipo E com `MULTI_PRECO`; grava `LOTEPRECO` (67.855 linhas com ORIGEM nulo, 29.008 com `P`) e `MULTI_PRECO.MARKUPFIXO`. É tela de ESCRITA sobre o motor de precificação (mig 211-212) — merece corte próprio; próxima do bloco |
| 90 | `FRMCADABASTECIMENTO` | 11 | 4 | 🪦 **marginal, com prova**: controle de abastecimento de veículos — `ABASTECIMENTO` tem **4 registros** e `VEICULOS` **2**. Não é operação da casa |
| 91 | `FRMINTEGRACAOLOTEWL` | 11 | 3 | ⛔ **sem fonte no repositório e sem substrato**: nenhuma unit com o form; `INTEGRACAO_IBSCBS_WL` **0 linhas**, `WL_PRODUTOS_SANEADOS` **0**. É a integração externa "WL" de saneamento fiscal (IBS/CBS) — irmã da FGF (item 69), e nunca operou |
| 92 | `FRMCADCHEQUEPROPRIO` | 10 | 5 | ⛔ **sem substrato, com prova**: `CHQ_PROPRIO` **0 linhas** (ver item 84 — a casa não opera com cheque; 11 cheques de terceiros na vida) |
| 93 | `FRMAPURACAOICMSST` | 10 | 5 | ⛔ **sem substrato, com prova**: `APURACAO_ICMS_ST` **0 linhas**, `APURACAO_ICMS_ST_AJUSTES` **0**; `OBRIGACAO_RECOLHER` tem 9. A apuração de ICMS (não ST) é viva (87 apurações, 2,7 mi de detalhes) e já está no Apollo; a de ST, como substituído, o cliente nunca apurou |
| 94 | `FRMMOTIVO` | 10 | 6 | ✅ **completa** (mig 261, `cadastro/motivos`, dossiê `uMotivo.md`) — **e corrigiu uma FK errada do Apollo**: no legado `AJUSTE_ESTOQUE.CODMOTIVO` tem FK para `MOTIVOS` (3 linhas: 999 INVENTARIO ROTATIVO, 1 PERCA INDENTIFICADA, 41 excluído), não para `MOTIVOS_OPERACAO` (38, do scrap); a mig 059 apontou para a errada e a 171 "inventou" o 999 lá. Reapontada; combo do ajuste lê a tabela certa; exclusão lógica como o legado |
| 95 | `FRMVASILHAME` | 10 | 3 | ⛔ **sem substrato, com prova**: `HIST_VASILHAME` **0 linhas** — controle de vasilhame nunca usado |
| 96 | `FRMINTEGRACAO_FISCAL` | 10 | 2 | ⛔ **sem substrato, com prova**: aplica um lote de saneamento fiscal em produtos por empresa — `PRODUTO_EMPRESA_LOTE` e `PRODUTO_EMPRESA_LOTE_ITENS` **0 linhas** |
| 97 | `FRMSINTEGRA` | 10 | 2 | 🟡 **adiada com recon**: gerador do arquivo SINTEGRA (registros 10/11/50/54/60A/74/75/88*) — **2.037 linhas**, 10 acessos, 2 operadores, **último acesso 25/05/2026**; as 5 empresas são MG. Usa `NFAUXSPED` (293 linhas, jul–ago/2026), tabela compartilhada com o SPED Fiscal (`UdmSpedFiscal`) e **ausente no destino** — pendência a checar no épico SPED, não aqui. Obrigação acessória viva: corte próprio |
| 98 | `FRMRELCURVAABCFORNECEDOR` | 10 | 4 | 🟢 **coberto**: a curva ABC do Apollo (`relatorios/curva-abc`, `rel-curva-abc.service.ts`) já tem a dimensão **FORNECEDOR** (rel 11, ao lado de PRODUTO e CLIENTE) — é esta tela. Nada a acrescentar |
| 99 | `FRMRELGESTAO` | 9 | 3 | 🪦 **defeituoso na origem, com prova no fonte**: `uDMRelGestao.dfm` define `TOTAL_CUSTO` e `TOTAL_VENDA` com a MESMA expressão `SUM(QUANTIDADE * VL_UNITARIO)` e a faixa de rentabilidade é `(V − D) − C / NULLIF(V − D × 100, 0)` (precedência errada) — a "margem" filtrada é aritmeticamente sem sentido; 9 acessos, 3 operadores, sem data de acesso. As outras 2 consultas (baixas AP/AR do período) estão nas telas de baixas (mig 253/254) |
| 100 | `FRMCONTROLEENTREGAS` | 9 | 4 | ⛔ **sem substrato, com prova**: `HISTORICO_CONT_ENTREGAS` **0 linhas** — o controle de entregas nunca registrou uma |
| 101 | `FRMCADMAPADECARGA` | 9 | 2 | ⛔ **sem substrato, com prova**: a maior unit do bloco (**6.161 linhas**, toca 20+ tabelas: caixa, cartão, cheque, a receber, estoque, faturamento…) para `MAPA_DE_CARGA`, `MAPA_DE_CARGA_DESPESAS` e `MAPA_DE_CARGA_RECEBIMENTOS` com **0 linhas** as três. Fluxo de venda externa/rota que a casa não pratica |
| 102 | `FRMRELFUNCIONARIO` | 9 | 4 | ✅ **completa** (mig 263, `cobranca/extrato-funcionario`, dossiê `uRelFuncionario.md`) — extrato do convênio de funcionários (AP + / AR −, tipo pelo texto da OBS, agrupados fora, convênio obrigatório só com tipo "Todos"). Medido: **74% dos AR de funcionários de 2026 (7.490, R$ 314 mil) são AGRUPADO=S** e ficam fora por regra; o legado não filtra empresa (AP em 4 empresas); `AGRUPARECEBER` tem 0 linhas (3º ramo não replicado) |
| 103 | `FRMRELATORIOCAIXADME` | 9 | 2 | ✅ **completa** (mig 264, `cobranca/caixa-dme`, dossiê `uRelatorioCaixaDME.md`) — DME: quem passou de R$ 30 mil em espécie (loja 1 em 2026: 5 fornecedores + 3 clientes, um com R$ 461 mil). Folds: conta a variante `1 - DINHEIRO` (1.636 lançamentos que o legado ignora), um endereço por parceiro (o LEFT JOIN dobrava a soma), tenant, e mostra os R$ 3,9 mi em dinheiro sem parceiro que a DME não enxerga |
| 104 | `FRMAPURACAOCIAP` | 9 | 4 | ⛔ **sem substrato, com prova**: crédito de ICMS do ativo permanente — `APURACAO_CIAP` **0 linhas**, `APROPRIADO_CIAP` **0**. Nunca apurado |
| 105 | `FRMIMPORTAPRODUTOSEXCEL` | 9 | 1 | ⛔ **sem fonte no repositório clonado** — nenhuma unit com o form; 1 operador (último acesso 18/06/2026). Importação de planilha de produtos: no Apollo a carga de produtos entra pela API/ETL |
| 106 | `FRMAPURACAO` | 8 | 6 | 🪦 **defeituoso na origem, com prova no fonte**: apuração entrada × saída por alíquota — o SQL das saídas faz `LEFT JOIN DET_ALIQUOTA A ON V.ALIQUOTA = A.ALIQUOTA AND A.UF = 'GO'` (`Uapuracao.dfm`), **Goiás fixo no código**, e as 5 empresas são de **MG** (a `DET_ALIQUOTA` tem 13 linhas de MG e 7 de GO): o débito sai pela alíquota efetiva do estado errado. Ainda usa `AVG(5102)` como CFOP e cruza os dois lados no cliente Delphi. A apuração de verdade está no Apollo (`apuracao_icms`, mig 164, a que alimenta o E110) e a comparação entrada×saída em 3 telas já convertidas |
| 107 | `FRMCADPRODUTOVALIDADE` | 8 | 3 | 🪦 **marginal, com prova**: coleta de validade por lote (`LOTE_PRODUTO_VALIDADE`) — **1 linha na vida**, de 09/03/2021 (produto 813096, lote "5"); `LOTE_PRODUTO_VALIDADE_PROMO` **0 linhas**. O controle de validade que a casa usa é o do produto (`CONTROLE_VALIDADE='S'` em 43.810 produtos), não o lote |
| 108 | `FRMRELBALANCO` | 8 | 3 | ✅ **completa** (mig 265, `contabil/balanco`, dossiê `uRelBalanco.md`) — balanço patrimonial (ativo e passivo numa data: saldo anterior antes do 1º do mês + movimento do mês). **Defeito medido: o modo "só sintéticas" do legado vinha VAZIO** — filtra `CLASSE='S'` e o plano só tem 'A' (10.950) e 'T' (78). Aqui sintética = tem conta filha, roll-up por prefixo com separador, tenant-scoped |
| 109 | `FRMGERARFINANCEIROLOTE` | 8 | 3 | ✅ **completa** (mig 266, `cobranca/gerar-financeiro-lote`, dossiê `uGerarFinanceiroLote.md`) — a cobrança mensal dos clientes de valor fixo: **169 clientes, R$ 182.522,81/mês**, e **10.666 títulos em 2026** (a tela tem 8 acessos porque abre 1× por mês). Copiadas a marca `DUP 01/01`/`GERADO=SISTEMA`, a trava da forma DUPLICATA e a guarda anti-duplicidade; a mais, o modo SIMULAR e `parceiros.fixo`/`areceber.codoperador`, que não existiam no destino |
| 110 | `FRMCADCLASSTRIBIBSCBS` | 8 | 1 | 🟡 **épico futuro (reforma tributária), sem fonte**: classificação tributária IBS/CBS — a unit não veio no repositório, mas o substrato JÁ EXISTE e cresce: `CST_IBS_CBS` 17 linhas, `IBS_UF` 27, **`NF_IBSCBS` 9.956** e `NF_PROD_IBSCBS`. É o começo da EC 132/2023 no legado; o Apollo ainda não tem IBS/CBS em lugar nenhum. Corte próprio, com o fonte novo em mãos |
| 111 | `FRMCADCODIGOCONTABIL` | 8 | 2 | ⛔ **sem substrato, com prova**: de-para "código contábil → conta débito/conta crédito" (`CODCONTABIL`, campos CONTADEBITO/CONTACREDITO) — a tabela tem **0 linhas**. O de-para que a casa usa é o `CODIREDUZIDO` do próprio plano (11.028 de 11.028 preenchidos), já no destino |
| 112 | `FRMFATURAMENTOPEDIDO` | 8 | 4 | 🪦 **marginal, com prova**: faturar pedido/OS pelo caixa (2.479 linhas, a maior do bloco) — de **36.887 pedidos** na base, apenas **3 têm `DT_FATU`**, e o último pedido é de 04/02/2025 (o tipo P parou em 09/03/2026, com 147). O caminho vivo é NF direto; o vínculo pedido→NF (`PEDIDO_NF`, 3.531) já está no Apollo |
| 113 | `FRMAGENDADEPARTAMENTO` | 7 | 1 | 🪦 **marginal, sem fonte**: nenhuma unit com o form no repositório clonado; `AGENDA_DEPARTAMENTO_COMERCIAL` tem **5 linhas**. 7 acessos, 1 operador, sem data de acesso registrada |
| 114 | `FRMCOTACAOLISTAFORN` | 7 | 2 | 🪦 **marginal, com prova**: monta uma "lista de fornecedores" para a cotação — `COTACAO_LISTAF` tem **1 linha**, chamada **"TESTE COTACAO"**, de 02/01/2023. A cotação viva (39 cotações, 97 cotações-fornecedor até 16/03/2026, 16.014 itens) está convertida em `compras/cotacao` + `cotacao-forn` |
| 115 | `FRMCADLANCAMENTOCONTABIL` | 7 | 5 | ⛔ **sem substrato, com prova** (a mesma do item 85): lançamento contábil MANUAL no diário — `ORIGEM_CONTABIL` tem a origem **1 = MANUAL** e o `DIARIO` (1,77 mi de linhas) tem **0 lançamentos com CODORIGEM=1**. A casa nunca lançou à mão; o diário é todo das integrações (61 = 1,2 mi). A consulta de lançamentos já existe (`contabil/lancamentos`, mig 209) |
| 116 | `FRMGERENCIADORPROMOCAO` | 7 | 2 | 🟢 **coberto, com prova**: nenhuma unit com este form no repositório; o substrato é `PROMOCAO` (25, a última terminou em **18/05/2024**) + `CLUBE_DESCONTO` (3.111, vivo até 16/09/2026) — as duas já convertidas em `cadastro/promocoes` (header + CLUBE_DESCONTO por origem) e `agenda-promocao`. Último acesso 24/08/2026, 2 operadores |
| 117 | `FRMRELHISTPDV` | 7 | 4 | ⛔ **fora de escopo (PDV)**: relatório sobre `HISTORICO_PDV` (681.173 linhas) — o usuário excluiu o PDV do escopo em 19/08 e a tabela está marcada como excluída no `plano-tabelas.json` por essa razão |
| 118 | `FRMNFRESSARC_ICMSST` | 7 | 3 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form no repositório e nenhuma tabela de ressarcimento de ICMS-ST no schema (procurado `%RESSARC%`: só as de CT-e). NF de ressarcimento nunca foi emitida nesta base |
| 119 | `FRMCADGRUPOCONTABIL` | 6 | 2 | ⛔ **sem substrato, com prova**: `GRUPO_CONTABIL` (CODGRUPOCONTABIL, DESCGRUPO, STATUS) tem **0 linhas** |
| 120 | `FRMCONSOLIDACAOPISCOFINS` | 6 | 3 | 🟢 **coberto, com prova**: a unit não tem SQL próprio (só exporta de arquivo); o substrato é `APURACAO_PC` — **18 apurações** — e a apuração de PIS/COFINS + o bloco M do SPED já estão no Apollo (`apuracao_pc`, mig 098; épico SPED PIS-COFINS fechado) |
| 121 | `FRMCADFIGURASFISCAIS` | 6 | 2 | ✅ **completa** (mig 267, `fiscal/figuras-fiscais`, dossiê `uCadFigurasFiscais.md`) — o catálogo que as regras do indexador tributário apontam (o caminho que 4 das 5 empresas usam, `EMPRESAS.FIGURAFISCAL='O'`). **16.838 figuras, e só 11 aparecem em alguma regra** — o filtro "só em uso" mostra quais; excluir figura em uso é recusado |
| 122 | `FRMLIBERACAOPEDIDO` | 6 | 3 | ⛔ **sem substrato, com prova**: `LIBERACAO_PEDIDO` **0 linhas**; a unit do form (`ufrmLiberacaoPedido`) não tem SQL próprio. A casa nunca usou liberação de pedido |
| 123 | `FRMRELCONFERENCIAEFD` | 6 | 1 | 🟡 **viva, sem fonte**: conferência do EFD — **último acesso 09/09/2026** (6 acessos, 1 operador), mas nenhuma unit com o form no repositório clonado e nenhuma tabela `%EFD%` no schema: é relatório de confronto entre o que o SPED gerou e o movimento. Precisa do fonte novo (o repositório é de mai/2020); o épico SPED ICMS-IPI/PIS-COFINS já está no Apollo e é a base dele |
| 124 | `FRMAUTORIZACAOPAGAMENTO` | 6 | 2 | 🟡 **viva, sem fonte**: autorização de pagamento — último acesso 03/06/2026 (6 acessos, 2 operadores); nenhuma unit no repositório e nenhuma tabela `%AUTORIZ%` no schema. Provável fluxo de alçada sobre `APAGAR`, que já está convertido; precisa do fonte novo |
| 125 | `FRMANALISEGERENCIALDEPEDIDOS` | 5 | 2 | 🪦 **marginal, com prova**: análise gerencial de pedidos cruzando `PEDIDOS` × `PEDIDO_NF` × **`MAPA_DE_CARGA`** — o mapa de carga é o item 101, morto por falta de substrato, e os pedidos pararam (3 faturados em 36.887; ver item 112). O que sobra (pedido × NF) está em `compras/rel-analise-pedido-nf` (mig 252) |
| 126 | `FRMCADTARA` | 5 | 2 | ⛔ **sem substrato, com prova**: a tabela `TARA` existe e tem **0 linhas** |
| 127 | `FRMCADCTE` | 5 | 4 | ⛔ **sem substrato, com prova**: `CTE` **0 linhas** e `CTE_AUTORIZADOS` **0** — a casa nunca emitiu nem recebeu CT-e por aqui (as 20+ tabelas `CTE_*` do schema estão todas vazias) |
| 128 | `FRMCONFIGLEGISLACAONFE` | 5 | 2 | ✅ **completa** (mig 268, `fiscal/config-legislacao`, dossiê `uConfigLegislacaoNFe.md`) — as mensagens legais das observações da NF-e. **Três defeitos medidos**: a resolução do legado exige `CODCFOP = n` e **as 18 regras têm CFOP nulo** (nenhuma NF-e jamais recebeu mensagem por ela); `if RecordCount = 1` devolvia vazio em silêncio; e há **código Delphi colado dentro do texto** (`'+ sLineBreak +'`), mojibake em 2 linhas e uma base legal do **RCTE/GO** numa casa de MG. Aqui a resolução é por especificidade e cada regra mostra os alertas |
| 129 | `FRMMANUTENCAOPEDIDOS` | 5 | 3 | 🪦 **marginal, com prova**: manutenção de `PEDIDOS` (a unit só toca essa tabela) — 36.906 pedidos não cancelados, mas o fluxo parou (ver 112: 3 faturados na vida, último pedido em 04/02/2025). 5 acessos, 3 operadores, sem data de acesso |
| 130 | `FRMMIXFISCAL` | 5 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form no repositório e nenhuma tabela `%MIX%` no schema |
| 131 | `FRMCADTABELAFORNECEDORES` | 5 | 1 | 🪦 **marginal, com prova**: `TABELA_FORNECEDORES` **3 linhas** e `TABELA_FORNECEDORES_ITEM` **96**. O de-para de código do fornecedor que a casa usa de verdade é `CODREFERENCIA_FOR` (**23.193 linhas**), já convertido em `cadastro/de-para` |
| 132 | `FRMCONGELAESTOQUE` | 4 | 2 | ✅ **completa** (mig 269, `cadastro/congela-estoque`, dossiê `uCongelaEstoque.md`) — a foto do estoque para o balanço (`qtde_cong`/`qtde_bk` nas duas tabelas + marca na empresa). Medido: a foto está em **100%** das 47.716 linhas da loja 1 e já **diverge do saldo em 13.960 produtos (29%)**, e `USUCONGETQ`/`DATACONGETQ` estão **nulos nas 5 empresas** — tirada sem deixar quem nem quando. Aqui operador e data são obrigatórios e há histórico em `congelamento_estoque` |
| 133 | `FRMRELABASTECIMENTO` | 4 | 2 | 🪦 **marginal, com prova** (mesma do item 90): relatório de abastecimento de veículos — `ABASTECIMENTO` **4 linhas**. Último acesso 28/08/2026, 2 operadores |
| 134 | `FRMPENDENCIAPRODUCAO` | 4 | 2 | 🪦 **marginal, com prova**: pendências de produção sobre `PRODUCAO` (**43 ordens**) e `ITENS_PRODUCAO` (**46**), **paradas em 01/10/2024**. A produção já está convertida no Apollo (épico Produção); o que falta é a fila de pendências de um fluxo que a casa deixou de usar |
| 135 | `FRMMOVPEDIDOS` | 4 | 2 | 🪦 **marginal, com prova**: relatório de movimento de pedidos (view `GET_REL_MOVPEDIDOS` + `ARECEBER`) — mesmo substrato parado dos itens 112/129 (3 pedidos faturados em 36.887) |
| 136 | `FRMIMPORTAPLANOREFERENCIAL` | 4 | 2 | ⛔ **sem substrato, com prova**: importar o plano referencial da RFB — nenhuma tabela de plano referencial no schema, e `PLANO_CONTAS.CODPLANOREFERENCIAL` existe mas o vínculo nunca foi carregado. A importação do plano do escritório está no TRON (mig 199-201) |
| 137 | `FRMLIBERASENHAGERENCIAL` | 4 | 4 | 🟢 **coberto, com prova**: a unit não tem SQL nem tabela própria — é a caixa de liberação por senha gerencial que as telas de dinheiro chamam. No Apollo isso é a **senha de operação por empresa** (`cadastro/senha-operacao`, E7) mais o RBAC por FORM×OPÇÃO, usados por todas as telas que pedem liberação (zerar estoque, congelar, baixar, estornar) |
| 138 | `FRMCADDOCA` | 4 | 3 | 🪦 **marginal, com prova**: cadastro de docas de recebimento — `DOCA` tem **1 linha** ('DEPOSITO PRINCIPAL', de 05/08/2020) |
| 139 | `FRMRECEBIMENTOS` | 4 | 1 | 🟡 **viva, sem fonte**: nenhuma unit com o form no repositório clonado (que é de mai/2020) e nenhuma tabela `RECEBIMENTO*` no schema — mas o **último acesso é 17/08/2026** (4 acessos, 1 operador). Provável recebimento de mercadoria sobre `NF`/`PEDIDOCOMPRA`, ambos já convertidos; precisa do fonte novo para dizer o que falta |
| 140 | `FRMCADCLAVEGOS` | 4 | 3 | ⛔ **sem substrato, com prova**: `CLAVEGOS` (de-para de código de produto do sistema Clavegos) **0 linhas** |
| 141 | `FRMCADVEICULOS` | 4 | 1 | 🪦 **marginal, com prova**: `VEICULOS` tem **2 linhas**, ambas de teste — 'UNO/OK33' (MG) e 'UNO/TTTTT' (**AM**), cadastradas em 10 e 13/06/2022. Ligada ao mapa de carga (item 101, morto) e ao abastecimento (90/133, 4 linhas) |
| 142 | `FRMRELDIARIOCONTABIL` | 4 | 4 | ✅ **completa** (mig 270, `contabil/diario`, dossiê `uRelDiarioContabil.md`) — o livro Diário, terceiro da família (balancete 258, balanço 265). **Defeito medido: o legado usa `UNION` e não `UNION ALL`** — dois lançamentos idênticos no mesmo dia colapsam em um e o livro perde lançamento legítimo. A mais: tenant-scoped, nome da origem (mig 209), contagem de lançamentos com **uma perna só**, filtros por conta e origem, e a tabela `contabilista` (4 linhas, faltava no destino) |
| 143 | `FRMCADPESQUISA` | 4 | 3 | ⛔ **sem substrato, com prova**: pesquisa de satisfação — `PESQUISA`, `PESQUISA_QUESTIONARIO`, `PESQUISA_RESPOSTA` e `PESQUISA_ATENDIMENTO` todas com **0 linhas** (a `LOG_PESQUISA`, com 196.645, é o log da tela de PESQUISA genérica do sistema, outra coisa) |
| 144 | `FRMCADGRUPOEMPRESARIAL` | 3 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form e nenhuma tabela `GRUPO_EMPRESARIAL` no schema. As 5 empresas do cliente já convivem por tenant no Apollo |
| 145 | `FRMCADCSTIBSCBS` | 3 | 1 | 🟡 **épico futuro (reforma tributária)**, junto com o item 110: `CST_IBS_CBS` tem **17 linhas** e `NF_IBSCBS` **9.956** — o legado já começou a EC 132/2023; o Apollo ainda não tem IBS/CBS. Sem fonte no repositório de mai/2020 |
| 146 | `FRMRELINDICADORESFINANCEIROS` | 3 | 2 | 🪦 **marginal, com prova no fonte**: indicadores financeiros por parceiro cruzando `ARECEBER`/`ARECEBER_BX`, `APAGAR`/`APAGAR_BX` e **`CHEQUE`** — e `CHEQUE` tem **11 linhas na vida** (item 84). O que o relatório tem de vivo (posição e baixas de AR/AP) está em `cobranca/cons-cli-rcb`, `cons-apg-bx`, `cons-rcb-bx` e no extrato de clientes |
| 147 | `FRMWLCONSULTAPRODUTOSSANEADOS` | 3 | 1 | ⛔ **integração WL sem fonte e sem substrato** (mesmo caso do item 91): nenhuma unit no repositório; a integração Web Lojas não tem tabela com dado neste banco |
| 148 | `FRMCADCODIGOAJUSTE` | 3 | 3 | 🟡 **viva, sem substrato próprio**: códigos de ajuste da apuração (E111/C197 do SPED) — `CODIGO_AJUSTE` tem **0 linhas**, mas o **último acesso é de 11/09/2026**. Os ajustes que o SPED do Apollo emite hoje vêm de `EMPRESAS.COD_AJUS_*` (mig 032); se a casa começar a usar a tabela, vira corte próprio |
| 149 | `FRMRELVENDEDORES` | 3 | 2 | 🪦 **marginal, com prova**: o DM da tela (`uDMRelVendedores`) **não tem SQL nenhum** — só o esqueleto; não há tabela `VENDEDORES` no schema (o vendedor é `PARCEIROS.CODVENDEDOR`). A comissão/venda por vendedor aparece nos relatórios de venda já convertidos |
| 150 | `FRMIMPORTAHISTORICOCONTABIL` | 3 | 3 | 🪦 **marginal, com prova**: importa históricos contábeis de arquivo — a unit não tem SQL próprio e `HISTORICO_CONTABIL` tem **54 linhas** (já convertida na mig 229, com CRUD). Importação de 54 linhas não paga corte próprio |
| 151 | `FRMGERENCIARSUGESTAOPROMOCAO` | 3 | 1 | 🟡 **viva, sem fonte**: nenhuma unit com o form; **último acesso 26/08/2026** (3 acessos, 1 operador). O substrato vivo é `CLUBE_DESCONTO` (3.111, até 16/09/2026), já convertido em promoções — a parte de *sugestão* precisa do fonte novo |
| 152 | `FRMREPOSICAODEGONDOLA` | 3 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form e nenhuma tabela de reposição/gôndola no schema |
| 153 | `FRMLANCAPRECO2` | 3 | 3 | 🟢 **coberto, com prova**: lançamento rápido de preço — a unit usa `PRODUTOS` + a procedure `UPDATEGRUPOPRECO` (que **não existe** no banco: `USER_OBJECTS` não tem nada com esse nome, a tela chamaria e falharia). Último acesso 26/06/2026. O lançamento de preço vivo está em `precificacao/*` e no ajuste em massa (mig 244) |
| 154 | `FRMCADCODIGORECEITA` | 3 | 2 | ⛔ **sem substrato, com prova**: `CODIGO_RECEITA` (códigos de receita de tributo p/ DARF) tem **0 linhas** |
| 155 | `FRMCADGENERONCM` | 3 | 3 | ⛔ **sem substrato, com prova**: `GENERO_NCM` (o capítulo/gênero do NCM) tem **0 linhas**. O NCM em si está convertido (`cadastro/ncm`) |
| 156 | `FRMCADMENSAGEMNF` | 2 | 2 | ⛔ **sem substrato, com prova**: não existe tabela `MENSAGEM_NF` no schema; a unit não tem SQL. As mensagens que a NF-e usa de verdade estão em `CONFIG_LEGISLACAO` — item 128, convertido (mig 268) |
| 157 | `FRMNFE_INUTILIZADA` | 2 | 2 | ✅ **completa** (mig 271, `fiscal/nfe-inutilizada`, dossiê `uNFE_Inutilizada.md`) — o livro das numerações queimadas: **187.138 registros** (131.333 na loja 1, 54.904 na 2), todos de **um número só**, até hoje (~78/dia em 2026), e `NF.STATUSNFE='I'` tem **0 linhas**: a inutilização vive só nesta tabela, que **não existia no destino nem na carga**. A mais: `buracos` (números sem nota e sem inutilização — o que o fisco pergunta), recusa de faixa sobreposta e de numeração de nota emitida, e registro com protocolo da SEFAZ não se apaga |
| 158 | `FRMPRECIFICACAOTABELAPRECO` | 2 | 1 | 🟢 **coberto, com prova**: precificação por tabela de preço — não existe tabela `TABELA_PRECO` no schema (o cadastro de tabelas de preço do Apollo, `tabela-preco`, veio do modelo do legado); o motor de preço (`MULTI_PRECO`, 203.640 linhas) e a precificação por NF estão convertidos (mig 129, 211-212) |
| 159 | `FRMSOLICITACOESPORTALCONVENIO` | 2 | 2 | ⛔ **sem substrato, com prova**: solicitações do portal do convênio — `CONVENIO_FUN` **0 linhas** e nenhuma tabela `SOLICITACAO*` com dado. O convênio de funcionários vive em `PARCEIROS.CODCONVENIO` (item 102, convertido) |
| 160 | `FRMFILTROCENTRALCOBRANCA` | 2 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form e nenhuma tabela de central de cobrança com dado (a `OCORR_CENTRAL_CONBRANCA` é a de ocorrências, sem tela própria aqui) |
| 161 | `FRMRELPERMISSAOUSER` | 2 | 1 | 🟢 **coberto, com prova**: relatório de permissões por usuário — nenhuma unit com o form no repositório, e o dado é a própria `PERMISSOES`, já convertida com a matriz FORM×OPÇÃO por perfil (`cadastro/permissoes`, corte-2) e a auditoria `audit_permissoes`. **Último acesso 28/08/2026** — o que ele mostra, a matriz mostra |
| 162 | `FRMMAPARESUMO` | 2 | 1 | ⛔ **sem substrato, com prova**: mapa resumo do caixa a partir de `REDUCAOZ` e `REDUCAOZ_ALIQ` — as duas com **0 linhas** (a casa nunca gravou redução Z aqui; a venda vem por `CX_VENDAS`, 3,37 mi, já convertida) |
| 163 | `FRMHISTORICOFGF` | 2 | 2 | ⛔ **sem substrato, com prova**: histórico dinâmico FGF sobre `TEMP_HISTORICO_DINAMICO_FGF` — **0 linhas** (a integração FGF parou em 05/2025, ver item 69) |
| 164 | `FRMSUGESTAOPEDIDOCOMPRA` | 2 | 2 | 🟢 **coberto, com prova**: nenhuma unit com este nome no repositório; a sugestão de compra do Apollo é a **prévia do fornecedor** (`compras/previa-fornecedor`) somada ao relatório de dias de estoque (`relatorios/dias-estoque`), ambos convertidos |
| 165 | `FRMCHQCUSTODIA` | 2 | 2 | 🪦 **marginal, com prova** (mesma do item 84): cheques em custódia sobre `CHEQUE` — **11 cheques na vida**, o último em 11/12/2023 |
| 166 | `FRMCADREDUCAOZ` | 2 | 1 | ⛔ **sem substrato, com prova**: `REDUCAOZ` e `REDUCAOZ_ALIQ` com **0 linhas** — e é tela de PDV/ECF, fora de escopo por instrução do usuário |
| 167 | `FRMDEVOLUCAOCH` | 2 | 1 | ⛔ **sem substrato, com prova**: devolução de cheque — `CHEQUE_DEVOLVIDO` **0 linhas** |
| 168 | `FRMMULTIPRECO` | 2 | 2 | 🟢 **coberto, com prova**: a tela lê `MULTI_PRECO` (**203.640 linhas**) e `PERMISSOES` — é a foto de preço por produto/empresa, convertida na mig 129 e usada por toda a precificação (mig 211-212, 244) e pelos relatórios de preço |
| 169 | `FRMCONFIGBAL` | 2 | 1 | 🪦 **marginal, com prova**: configuração da balança — a unit não tem SQL próprio e `CONFIG_BALANCA` tem **2 linhas**; a integração de balança é arquivo gerado por produto (fora do banco) |
| 170 | `FRMCADDRECONTABIL` | 2 | 2 | 🟢 **coberto, com prova**: o configurador da árvore do DRE contábil é `CONFIG_DRE_CONTABIL` (**98 linhas**, 3 níveis) — convertido na **mig 234** (`cadastro/dre-estrutura`, dossiê `uConfigDreContabil.md`, 51 acessos). Este item é o mesmo cadastro por outro nome de form (2 acessos) |
| 171 | `FRMIMPRIMEETIQUETA` | 2 | 1 | 🟢 **coberto, com prova**: impressão de etiqueta a partir de `PRODUTOS`/`COMPOSICAO`/`RECEITAS` — o épico **Etiquetas** já está no Apollo (fila de impressão + layouts), e `FRMETIQUETA` sozinha responde por 2,37 mi dos 3,05 mi de acessos do sistema. Esta é a variante com composição/receita (`RECEITAS` tem **0 linhas**) |
| 172 | `FRMWLALINHAMENTO` | 1 | 1 | ⛔ **integração WL sem fonte e sem substrato** (como 91 e 147): nenhuma unit no repositório, nenhuma tabela com dado |
| 173 | `FRMWITALINHAMENTO` | 1 | 1 | ⛔ **integração WIT sem fonte e sem substrato**: nenhuma unit no repositório, nenhuma tabela com dado |
| 174 | `FRMALINHAGENERATOR` | 1 | 1 | ⛔ **ferramenta de desenvolvimento, não é tela de negócio**: a unit lê `ALL_OBJECTS`, `ALL_CONSTRAINTS` e `ALL_CONS_COLUMNS` (o dicionário do Oracle) para gerar código de alinhamento de tabelas — utilitário interno do fornecedor |
| 175 | `FRMLOTEPRODUCAO` | 1 | 1 | ⛔ **sem substrato, com prova**: lote de produção sobre `LOTE_PRODUCAO`, `PRODUTO_FINAL_PRODUCAO` e `APONTAMENTO_PRODUCAO` — **nenhuma das três existe** no schema; `RECEITAS` tem 0 linhas e `COMPOSICAO` 61. A produção viva (43 ordens, parada em 01/10/2024) já está convertida |
| 176 | `FRMCADCATCORTESIA` | 1 | 1 | ⛔ **sem substrato** — cadastro das categorias de cortesia: `CATEGORIA_CORTESIA` tem **0 linhas** no cliente (ver item 59) |
| 177 | `FRMCADMAPACARGAPROD` | 1 | 1 | ⛔ **sem substrato, com prova**: mapa de carga da produção sobre `PEDIDOSPRODUCAO` (**0 linhas**) e `PEDIDOSPRODUCAO_ITENS` (**0**) — e o mapa de carga geral é o item 101, também morto |
| 178 | `FRMCADREGIAO` | 1 | 1 | ⛔ **sem substrato, com prova**: `REGIAO` **0 linhas**, `REGIAO_CIDADES` **0** e `PUBLICIDADE` **0** (esta última é o item 76). Região de entrega nunca foi usada |
| 179 | `FRMAUTORIZACAOBAIXA` | 1 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form no repositório e nenhuma tabela de autorização de baixa. A alçada de baixa no Apollo é RBAC + senha de operação |
| 180 | `FRMEXPORTACAOCOLETOR` | 1 | 1 | 🟢 **coberto, com prova** (como o item 71): exportação para coletor — o inventário do Apollo já faz a ponte com o coletor (importar/exportar contagem), e não há tabela própria desta tela no schema |
| 181 | `FRMCADLIMITECOMPRA` | 1 | 1 | ⛔ **sem substrato, com prova**: `LIMITE_COMPRA` **0 linhas**. O limite que a casa usa é `PARCEIROS.CREDITO` / `LIMITE_ESPECIAL`, já convertidos |
| 182 | `FRMRELATORIOINDUSTRIA` | 1 | 1 | ⛔ **sem substrato, com prova**: relatório da indústria sobre `PEDIDOSPRODUCAO` + `PEDIDOSPRODUCAO_ITENS` — **0 linhas nas duas** (mesma prova do item 177) |
| 183 | `FRMORDEMSERVICO` | 1 | 1 | ⛔ **sem substrato, com prova**: `ORDEM_SERVICO` **0 linhas** e `COTACAO_ORDEM_SERVICO` **0** |
| 184 | `FRMSOLICITAOFIGURAFISCAL` | 1 | 1 | 🪦 **marginal, com prova**: solicita ao fornecedor a criação de figura fiscal — grava em `SUPORTE` (**1 linha**). O cadastro de figuras fiscais em si está convertido (item 121, mig 267) |
| 185 | `FRMRELOSPLACA` | 1 | 1 | ⛔ **sem substrato, com prova**: relatório de ordem de serviço por placa — `ORDEM_SERVICO` **0 linhas** (item 183); a unit só cruza `PARCEIROS`/`PARCEIROS_END` |
| 186 | `FRMCADLOCALESTOQUE` | 1 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form e nenhuma tabela `LOCAL_ESTOQUE`. O local no Apollo é `estoque.local` + `estoque_dep` (loja/depósito), já convertidos |
| 187 | `FRMRELENTREGA` | 1 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form e nenhuma tabela de entrega no schema (o controle de entregas é o item 100, com `HISTORICO_CONT_ENTREGAS` vazia) |
| 188 | `FRMRELDIVERGENCIAINTEGRACAO` | 1 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form; as divergências de integração que existem de verdade (pedido × NF) estão em `analise_pedido_nf_diverg`, convertida (mig 252) |
| 189 | `FRMRELTROCOPDV` | 1 | 1 | ⛔ **fora de escopo (PDV)**: relatório de troco do PDV — o usuário excluiu o PDV do escopo em 19/08; sem unit no repositório e sem tabela `TROCO_PDV` |
| 190 | `FRMPONTORECEBIMENTO` | 1 | 1 | ⛔ **sem substrato** (o "sem fonte" estava errado: `uPR_PontoRecebimento.pas` existe — lição 121): é o recebimento da PRODUÇÃO, sobre `RECEBIMENTO_PRODUCAO` — **0 linhas** na produção (23/09/2026) |
| 191 | `FRMGRIDEXCEL` | 1 | 1 | ⛔ **utilitário de UI, não é tela de negócio**: a janela genérica de exportação de grid para Excel do framework Delphi. No Apollo, exportar é função de cada tela |
| 192 | `FRMRETIRARAUTORIZACAOPAGAMENTO` | 1 | 1 | ⛔ **sem fonte e sem substrato** (par do item 124): nenhuma unit no repositório e nenhuma tabela de autorização de pagamento no schema |
| 193 | `FRMCADTIPOFATURAMENTO` | 1 | 1 | ⛔ **sem substrato** (o "sem fonte" estava errado: `uCadTipoFaturamento.pas` existe — lição 121): cadastro sobre `TIPOFATURAMENTO` (sem sublinhado) — **0 linhas** na produção (23/09/2026); o faturamento vivo (parcelas da nota) está convertido |
| 194 | `FRMREMESSAVENDAS` | 1 | 1 | ⛔ **sem fonte e sem substrato**: nenhuma unit com o form e nenhuma tabela `REMESSA_VENDAS`. A remessa que existe é a bancária (CNAB), convertida |

---

## ⚠️ Varredura do DADO (18/09/2026) — o que o plano de carga não estava vendo

Fechada a conta pelas TELAS, fiz a mesma conta pelo **dado**: as 792 tabelas do Oracle (fora
bkp/tmp/audit/log) contra o destino + o `plano-tabelas.json`.

**Achado 1 — 8 tabelas marcadas como "só do destino" TÊM origem no Oracle, com nome diferente.** Sem o
mapeamento, a carga deixaria **~246 mil linhas** para trás, em módulos já convertidos:

| destino | origem no Oracle | linhas |
|---|---|---:|
| `nfe_evento` | `NFE_EVENTOS` | 107.708 (último evento: hoje) |
| `nf_contabil` | `CODCONTABILNF` | 47.720 — o rateio contábil da NF |
| `conciliacao_bancaria_ofx` | **`CONCILICAO_BANCARIA_OFX`** | 46.846 |
| `conciliacao_bancaria_mov` | **`CONCILICAO_BANCARIA_MOV`** | 27.986 |
| `dre_conta` | `VINCULO_PLC_CFG_DRE` | 10.439 |
| `pedido_devolucao_compra_i` | `PEDIDO_DEVOLUCAO_COMPRA_ITENS` | 6.103 |
| `dre_estrutura` | `CONFIG_DRE_CONTABIL` | 98 |
| `tributacao_reforma` | `CST_IBS_CBS` | 17 |

Duas delas escaparam do casamento automático por um **erro de grafia do próprio legado**:
`CONCILICAO_BANCARIA_*` (sem o segundo "A"). Corrigido em `plano-tabelas.json` **e** nos dois scripts do
ETL (`extrair.py` e `plano-universo.py`, que regenera o plano) — senão o mapa se perderia na próxima
regeneração.

**Achado 2 — tabelas vivas sem destino nem plano** (as maiores, com movimento de hoje):

| tabela | linhas | o que é |
|---|---:|---|
| `REMESSA_LOTE` | 10.919.452 | fila de replicação do legado (`TABELA` + `IDTABELA` + lote): infraestrutura de sincronização, não regra — o Apollo é centralizado |
| `ANALISE_COMP_DIA_PROD` | 4.554.664 | cache do job de comportamento (as telas 22/23 recalculam do dado) |
| `CLUBE_DESCONTO_MOV` | 3.106.133 | movimento do clube de desconto **com integrações externas** (IZIO, Mercafácil, Cresce Vendas) — fora do escopo de conversão, mas é decisão de cutover |
| `NFC` / `NFC_ARQUIVO` | 3.162.075 / 2.419.449 | cupom fiscal (PDV) |
| `CARTAO_BX` | 1.168.435 | baixas de cartão (o épico Cartões usa outro modelo) |
| `HISTORICO_PROCESSAMENTO_NF` · `NF_STATUS_PROCESSO` | 862.152 · 439.611 | rastro do processamento de NF (ambas com registro de hoje) |
| `PEDIDO_COMPRA_QTDE` | 256.813 | o grandchild por empresa do pedido de compra (nota de paridade já registrada) |

São **282 tabelas** com dado fora do plano, somando 48,3 milhões de linhas — a maior parte log, backup
nomeado por pessoa (`LUHAN23042026`…), temporária (`Z_TEMP_*`) e materializada de BI. As sete acima são
as que merecem decisão explícita antes da virada.


### Achado 3 — a carga levaria os pedidos de compra R$ 32,4 milhões subcontados

`PEDIDOCOMPRA_I` **não tem coluna de quantidade** no legado: ela vive no grandchild por-empresa
`PEDIDO_COMPRA_QTDE` (o comprador da rede pede e distribui entre as lojas — **46.142 itens são
multi-loja**, e `PEDIDOCOMPRA.EMPRESAS` é um texto tipo `'1, 2'`). O nosso modelo é a projeção
single-empresa da mig 078, com `qtde` no item.

O extrator casa coluna por coluna **pelo nome** — e `qtde`/`qtdtotal`/`totalcusto` não existem na origem.
Resultado silencioso: a carga cairia no `DEFAULT qtde = 1`, e o total dos pedidos migraria assim:

| | |
|---|---:|
| Σ `TOTALCUSTO` real | **R$ 43.328.145,14** |
| Σ com `qtde = 1` | R$ 10.927.188,98 |
| **diferença** | **R$ 32.400.956,16** |

É o mesmo bug que a **mig 078** corrigiu no modelo ("~2,5× subcontado"), voltando pela porta da carga —
agora 4×. 147.073 das 256.813 linhas do rateio têm `QTDE > 1`, e **os 210.670 itens têm rateio** (nenhum
ficaria de fora do erro).

Corrigido em `etl/extrair.py` (bloco `CALCULADAS`): as três colunas passam a vir da **soma do rateio** por
item, com a expressão conferida na produção — o Σ bate em R$ 43.328.145,14.

### Achado 4 — a empresa que vem do pai: 52.193 linhas iriam para a loja errada

Cinco tabelas de movimento **não guardam a empresa** no legado — ela vem do pai (o título, a conta
corrente). O nosso schema a exige (`NOT NULL`), e o extrator tem uma regra de fallback que preenche
**constante 1** quando não acha a coluna. Tudo iria para a loja 1, sem um erro sequer:

| tabela | linhas de OUTRA empresa |
|---|---:|
| `MOV_CONTAS_BANCARIAS` | 16.496 |
| `ARECEBER_BX` | **14.538** (75% das baixas: 14.172 da empresa 50) |
| `MOVIMENTACAO_BANCARIA_OFX` | 10.471 |
| `APAGAR_BX` | 10.645 |
| `PEDIDOCOMPRA` | 43 |
| **total** | **52.193** |

Com a empresa errada, extrato, DRE de caixa, balancete e conciliação da loja 2 perdem o movimento.
Corrigido em `CALCULADAS`: cada uma busca a empresa no pai, e as sete expressões foram testadas na
produção. `COTACAO`/`PEDIDOCOMPRA` são o caso torto — a empresa é **texto** (`';1;'`, `'1, 2'`) e a
projeção single-empresa fica com a primeira da lista, a loja que abriu o documento.

Também entrou aqui `NF.TOTALICM_STEXTERNO` → `nf.total_icmst_externo` (`RENOMEIA`): **2.661 notas com
valor, R$ 49.050,73** (353 em 2026) chegariam zeradas.

### Achado 5 — achar a tabela não é achar o dado: a coluna que não casa pelo nome

O Achado 2 mapeou 8 tabelas que existiam no cliente e não tinham destino. Conferindo agora **coluna a
coluna**, em 6 delas o nome da tabela casou e o das colunas não. O extrator casa pelo nome: a coluna que
não casa simplesmente não entra — e quando o destino a exige (`NOT NULL` sem default) a carga **falha**,
não silencia.

| destino ← origem | o que não casava | tamanho |
|---|---|---:|
| `dre_estrutura` ← `CONFIG_DRE_CONTABIL` | **as 9 colunas de negócio** têm prefixo `CFGDRE_` | 98 linhas (a árvore inteira do DRE) |
| `dre_conta` ← `VINCULO_PLC_CFG_DRE` | `CFGDRE_CODIGO` → `codestrutura` | 10.439 vínculos (0 órfãos) |
| `pedido_devolucao_compra_i` ← `…_ITENS` | as 5 chaves em `cod_*` com underscore | 6.126 itens, R$ 407.275,10 |
| `nfe_evento` ← `NFE_EVENTOS` | o evento só tem a **chave de acesso**, não a NF | 107.830 eventos |
| `conciliacao_bancaria` | conta e empresa vêm **dois níveis abaixo** | 18.511, 13.804 resolvidas |
| `operadores_acessos` | `CODOPERADORESACESSO` → `id` | 70.507 acessos |

E o pior deles, numa tabela que já estava no plano desde sempre:

**`nf_prod.vripi` — R$ 343.351,49 de IPI sumiriam do SPED.** No legado `NF_PROD.IPI` é a **alíquota** (%)
e o valor mora em `IPI_NOTA`; o nosso modelo guarda os dois separados, e `ipi_nota` casa pelo nome — então
`vripi` ficaria zerado em **33.642 itens**. `vripi` é exatamente o VL_IPI dos registros **C100 e C170** da
EFD ICMS-IPI e da EFD Contribuições. A aritmética prova o leiaute: `quantidade × vrcusto × ipi/100 =
IPI_NOTA`, e a soma por nota bate com `NF.TOTALIPI` em **3.469 das 3.471** notas com IPI.

**Correção minha:** `tributacao_reforma` saiu da carga. Eu a mapeei para `CST_IBS_CBS` no Achado 2 e estava
errado — aquilo é o **catálogo de CST** da reforma (000/010/011/200/210…), enquanto a nossa tabela é
alíquota por UF e vigência (mig 007, seed da EC 132/2023 + LC 214/2025). A tabela de alíquota do legado
seria `IBS_UF`, e é mais pobre: 27 UFs com `valor_ibs_uf` e nada de CBS, vigência ou fonte. Serve de
**conferência** — e confere, 0,1 de IBS em 2026. `CST_IBS_CBS` fica sem destino, em aberto.

### O silêncio virou ruído

Duas mudanças para o padrão não voltar:

- **`tools/cutover/conferir-colunas-orfas.py`** (novo) varre as 177 tabelas do plano procurando coluna que
  o destino exige e a origem não tem. Lê `RENOMEIA`/`CALCULADAS`/`CONSTANTES` **do próprio extrator** (por
  AST — `extrair.py` não tem guarda `if __name__`, importá-lo dispararia a extração), então não envelhece.
  Sai com código 1 quando sobra alguma de risco alto. Hoje: **0 altas**, 14 médias, todas flag nossa com
  default sensato.
- **`EMPRESA_SEM_ORIGEM`** no extrator. A constante 1 continua sendo a saída certa onde a empresa
  realmente não existe (`log_impressao_etiqueta` 115.607 · `operadores_acessos` 70.507 · `periodo_contabil`
  3 — conferido: nem o log nem `OPERADORES` guardam loja), mas agora é **decisão escrita**. Tabela não
  declarada imprime ⚠️ na extração e entra no manifesto.

E um defeito que anulava o Achado 4: o fallback de empresa rodava **antes** das `CALCULADAS` entrarem em
`cols`, e o header do CSV é `cols + const` — `mov_contas_bancarias.idempresa` sairia **duas vezes**, o
valor certo e a constante 1 ao lado. Corrigido descontando `CALCULADAS`/`CONSTANTES` do fallback.


### Achado 6 — o clube de desconto: a carga perdia o produto de 3.104 regras

A varredura das tabelas sem destino (22/09/2026) começou pelo tamanho e terminou em três defeitos de carga
numa tabela que **já estava no plano desde a mig 112**.

| tabela | linhas | em 2026 | situação antes |
|---|---:|---:|---|
| `CLUBE_DESCONTO` | 3.111 | 400 | no plano, com 3 defeitos |
| `CLUBE_DESCONTO_MOV` | **3.118.725** | **824.491** | fora do plano |
| `CLUBE_DESCONTO_EXT` | 40 | | fora do plano |
| `CLUBE_DESCONTO_PROD` | 273 | | fora do plano |

**(a) O produto sumia.** `BARRAS` diz sobre qual produto a regra age, está em **3.104 das 3.111 (99,8%)** e
não existia no destino. Sem ela a regra chega inútil. Mais nove colunas ficavam para trás.

**(b) A chave estrangeira rejeitaria 98,5% da carga.** A mig 112 ligou `idpromocao` a `promocao`, mas só
**47 de 3.111** casam — o id é da promoção no sistema do clube, não da nossa. A carga falharia inteira.

**(c) A empresa vinha como TEXTO com lista** (`'1,2'`) para uma coluna `integer`. Mesmo padrão do Achado 4:
a projeção fica com a primeira da lista.

Corrigido na mig 285, com tela de cadastro das nove operações. A regra central é que **o `valor` muda de
unidade**: em `PRECO` (2.970 regras) vai de 0,99 a 419,40 e é preço; em `VARIAVEL` fica entre 6 e 20 e é
percentual. Dossiê `uClubeDesconto.md`.

**Lição de método:** eu comecei a escrever uma migration criando `clube_desconto` do zero, e o smoke a
rejeitou porque a tabela já existia desde a mig 112. **Antes de criar tabela para uma "tabela sem destino",
conferir cada nome contra o `schema-destino.json`** — a lista de pendências dizia `CLUBE_DESCONTO_MOV`, e eu
li "a família do clube".


### Achado 7 — a conferência só olhava um lado, e o outro tinha 167 colunas

O `conferir-colunas-orfas.py` comparava **destino → origem**: a coluna que o destino exige e a origem não
tem, onde a carga cai no default. Faltava o inverso: **a coluna que a origem tem e o destino não**. Essa
não cai em default nenhum — ela simplesmente não é carregada, e o dado some sem deixar buraco visível.

Foi exatamente o que escondeu o `CLUBE_DESCONTO.BARRAS` por três migrations (Achado 6): o sentido antigo
nunca o veria, porque do lado do destino não faltava nada.

Com os dois sentidos e a mesma régua (chave ou número, preenchido em 50% ou mais das linhas), sobram
**167 colunas** que a origem tem e o destino não recebe. As de maior peso:

| coluna | preenchida |
|---|---:|
| `cartao.codoperador` | 2.025.583 (100%) |
| `nf.*` — 15 totais fiscais (ICMS desonerado, FCP, ST real, base de ICMS da nota, desconto final, frete 2, produtos ST, outros) | 49.655 cada (100%) |
| `vendas.vrcustoreal`, `vrcustocsi`, `vrcustoajuste`, `vrfcpst` | 16.358.670 (86%) |
| `historico_prod.id_origem_documento` | 11.106.972 (79%) |
| `nf.codnfstatuspro` (liga à esteira do manifesto) | 42.032 (85%) |
| `inventario.idunico` | 15.441 (100%) |

Não são 167 defeitos: é uma lista de triagem ordenada por quanto o dado está preenchido. Cada uma precisa
de coluna no destino ou de um padrão em `ORIGEM_NAO_VEM` dizendo por que não vem. Os totais fiscais da NF e
os custos de venda são os primeiros a olhar, porque mudam número.

**E a ferramenta ficou utilizável:** era um `count()` por coluna, com 186 tabelas e uma delas de 18 milhões
de linhas — passava de dez minutos e por isso não seria rodada. Agora lê o dicionário em três consultas e
mede o preenchimento pelas estatísticas do Oracle: **5,6 segundos**. Estatística desatualizada mede a
menos, nunca a mais, então ela erra para o lado seguro.


### Achado 8 — R$ 160 milhões de bases e valores de ICMS/ST que a nota perdia na carga

Primeiro resultado do sentido novo do conferidor (Achado 7). A tabela `nf` está no plano desde o começo e
mesmo assim deixava **28 colunas do cabeçalho** para trás — não em silêncio parcial, mas inteiras.

Das 28, **12 entraram** (mig 286), com o valor medido em notas que têm o campo diferente de zero:

| coluna | notas | soma |
|---|---:|---:|
| `total_icms_nota_bc` | 26.056 | R$ 49.762.363,32 |
| `totalbase_stexterno` | 17.078 | R$ 43.524.106,47 |
| `totalbaseicmt` | 16.999 | R$ 41.191.944,85 |
| `totalbaseicmsrep` | 7.153 | R$ 7.638.892,75 |
| `totalprodst` | 1.903 | R$ 7.063.321,44 |
| `total_icms_nota_valor` | 23.956 | R$ 6.006.312,03 |
| `total_streal` | 17.051 | R$ 3.058.772,97 |
| `totalrepicm` | 7.190 | R$ 913.053,46 |
| `total_bonificado` | 1.891 | R$ 889.628,65 |
| `total_fcp_valor_st` · `_ret` · `total_icmsdeson` | 5.216 | R$ 447.310,53 |
| **total** | | **R$ 160.495.706,47** |

O padrão do que faltava é nítido: o destino trouxe os totais principais (produto, desconto, frete, ICMS,
IPI) e deixou de fora os de **substituição tributária, FCP, repasse e o par de conferência da nota**.

`TOTAL_ICMS_NOTA_BC` e `_VALOR` são o par de conferência do cabeçalho — o que o fornecedor declarou ao lado
do que a conferência apurou, o mesmo desenho que o item já tinha. Sem eles, a nota perde a referência de
origem justamente nos dois campos que a fiscalização confronta primeiro.

**As outras 16 ficam de fora com prova**, agora declaradas em `ORIGEM_DECLARADA` no conferidor:
`codnfstatuspro` é FK para a esteira que ainda não tem destino (entra com ela); `qtde` é derivável de
`nf_prod` e guardá-la criaria uma segunda verdade; `validatotalnf` é flag de processo; e as demais somam
menos de R$ 151 mil em pouquíssimas notas, ou estão zeradas nas 49.655.

Com isso o sentido 2 do conferidor caiu de **167 para 139**, e a `nf` saiu da lista inteira. O que sobra se
concentra em `nf_prod` (31), `vendas` (26), `pedido_devolucao_compra_i` (23) e `empresas` (18).


### Achado 9 — o item da nota perdia a escada de custo: R$ 137 milhões

Depois do cabeçalho (Achado 8), o item repete o padrão e com valores maiores, porque é aqui que mora a
**escada de custo** que a precificação usa. Migration 287, 24 colunas.

| coluna | itens ≠ 0 | soma |
|---|---:|---:|
| `vrbase_stexterno` | 124.158 | R$ 43.523.952,71 |
| `vrcustoreal` | 422.514 | R$ 30.085.170,82 |
| `ultcustorep` | 411.701 | R$ 18.128.955,45 |
| `custo_real_unit` | 391.422 | R$ 15.931.303,45 |
| `markup` | 385.147 | R$ 12.443.660,80 |
| `vrbasecalculoicm_calc` | 66.351 | R$ 9.536.359,85 |
| `vendaliq` | 383.537 | R$ 5.994.641,70 |
| demais (ICMS recalculado, margem, FCP-ST, ajuste do Decreto 47.530, desonerado, frete) | | R$ 1.856.676,15 |
| **total** | | **R$ 137.500.720,73** |

E `IDSITUACAO_NF` estava preenchida em **497.983 dos 498.439 itens**: é a situação do item na nota, e sem
ela o item perde o próprio estado.

**Por que a escada importa**: o destino já tinha `vrcusto`, `vrcustorep`, `vrcustocsi`, `ultcusto` e
`vl_custo`, mas não o `vrcustoreal` nem o `custo_real_unit` — justamente os degraus que a precificação por
NF usa para decidir preço. Carregar meia escada faz o recálculo partir de um degrau que não existe, e o
erro não aparece como falta: aparece como **preço diferente**.

### O conferidor ficou preciso: zero não é valor

A primeira versão do sentido 2 contava "preenchida" pela estatística do Oracle, que é **não-nula** — e zero
conta como preenchido. Seis colunas de `nf_prod` (`vrpis`, `markupl`, `vrcomissao`, `vrsaldoflex`,
`custo_recalculo_bonif`, `vricms_stexterno_separadonf`) apareciam como perda de 100% estando **zeradas em
todas as 498.439 linhas**.

Agora há uma segunda passada: **uma consulta por tabela** (não por coluna) conta o que tem valor ≠ 0 e
descarta as zeradas. São ~20 idas ao banco, o conferidor passou de 5,6s para 1min26 e a lista caiu de 114
para **89** — ruído que não voltaria a ser triado à mão a cada rodada.

O que sobra se concentra em `pedido_devolucao_compra_i` (23), `empresas` (18) e `vendas` (15).


### Achado 10 — a venda perdia as duas escadas de custo e o que foi lido no caixa

Terceiro da série, e na maior tabela do sistema: `VENDAS`, **18.995.349 linhas**. Migration 288.

| coluna | vendas ≠ 0 | soma |
|---|---:|---:|
| `vrproduto` | 14.527.218 | R$ 172.748.041,54 |
| `vrcustoreal` | 16.378.032 | R$ 112.180.725,27 |
| `vrcustocsi` | 16.301.522 | R$ 111.496.471,56 |
| `margem_comissao` | 220.328 | R$ 660.984,00 |
| `vrfcpst` | 1.253.770 | R$ 135.567,38 |
| **total** | | **R$ 397.221.038,16** |

**Sem `vrcustoreal` e `vrcustocsi` não há margem no histórico.** O destino tinha `vrcusto` e `vrcustorep`,
que são outros degraus: todo relatório de rentabilidade sobre 18,9 milhões de vendas ficaria sem o custo
que o legado de fato usou. É a mesma meia-escada da mig 287, com 38 vezes mais linhas.

**E o que foi lido no caixa:**

| coluna | linhas | distintos |
|---|---:|---:|
| `ncmsh` | 19.021.932 | 963 |
| `codigo_informado` | 12.246.066 | **405.681** |
| `cest` | 13.580.609 | 492 |
| `vrvenda_tipo` · `codigo_tipo` | ~13 milhões | 4 cada |
| `codfor` | 18.657.242 | |

`CODIGO_INFORMADO` é o código que o operador leu ou digitou, com mais valores distintos do que o cadastro
tem de produtos. É a evidência de **como** a venda aconteceu, e sem ela não há como auditar divergência
entre o que foi lido e o produto que saiu.

Fica de fora, com prova: a integração Cresce Vendas (14.612 de 18,9 milhões, 0,08%, R$ 39 mil) — e o status
dela está nulo nas 3,1 milhões de linhas do movimento do clube, ou seja, nunca foi usada.

### Placar da varredura origem → destino

| passo | achados restantes |
|---|---:|
| ao criar o sentido 2 | 167 |
| depois da nf (mig 286) | 139 |
| depois de nf_prod (mig 287) | 114 → **89** com o descarte das zeradas |
| depois de vendas (mig 288) | **74** |

Recuperado até aqui: **R$ 695,2 milhões** em bases, custos e valores que a carga deixava para trás. O que
sobra se concentra em `pedido_devolucao_compra_i` (23) e `empresas` (18).


### Achado 11 — o kardex sem valor, o cartão sem autoria e o CFOP sem regra (mig 290)

Fecha a série. As últimas concentrações eram menores em volume e maiores em consequência.

**O kardex guardava a quantidade e não o valor.** `HISTORICO_PROD` tem 13.968.279 linhas e o destino
trouxe só o movimento em quantidade. Ficaram de fora `valor_alter` e `valor_atual` (445.233 linhas com
valor, R$ 6.455.305,54) e `id_origem_documento` (**11.810.697 linhas, 2.668.620 documentos distintos**).
Sem o valor, o kardex responde "quanto entrou" e não "por quanto"; sem a origem, não responde "de onde".

**O cartão perdia os três operadores**: quem lançou (2.068.857), de qual operadora veio (2.031.051) e quem
baixou (1.769.287) — a trilha inteira do recebível.

**O CFOP perdia REGRA, não dado.** `ALTERA_CUSTO_NF` está em 389 dos 398 CFOPs: é o CFOP dizendo se a
entrada por ele altera o custo do produto. Sem a coluna, ou toda entrada passa a alterar custo ou nenhuma
altera, conforme o default — e é a diferença entre bonificação mexer ou não no preço.

Mais `pedidocompra_i.vendaliq`/`vrcustob` (R$ 4,1 milhões, a escada de custo de novo), a figura fiscal e o
enquadramento de PIS/COFINS em `multi_preco`, e doze colunas menores de autoria e chave.

### A varredura origem → destino está fechada

| passo | restantes |
|---|---:|
| ao criar o sentido 2 | 167 |
| mig 286 — totais da nota | 139 |
| mig 287 — item da nota (+ descarte das zeradas) | 89 |
| mig 288 — vendas | 74 |
| mig 289 — devolução e empresa | 33 |
| mig 290 — kardex, cartão, CFOP, preço | 6 |
| RENOMEIA das PKs + declaração das últimas | **0** |

> **`[1] 14 achados, 0 de risco alto · [2] 0 — nenhuma coluna da origem ficando para trás.`**

Recuperado na série: **R$ 707,8 milhões** em bases, custos e valores, mais 19 milhões de NCMs de venda,
12,2 milhões de códigos lidos no caixa e 11,8 milhões de vínculos de kardex com o documento de origem.

Tudo que não vem está declarado com o número medido ao lado, em `ORIGEM_DECLARADA` no conferidor — a lista
não volta a crescer sem exame, porque o conferidor sai com erro quando alguém acrescenta coluna nova sem
justificar.


### Achado 12 — o histórico que responde "por que o custo mudou" não tinha destino

`HISTORICO_PROCESSAMENTO_NF`, **863.582 linhas** (128 mil em 2026), era a segunda maior tabela viva sem
destino. Migration 291, com tela de consulta. Dossiê `uHistoricoProcessamentoNF.md`.

O kardex responde *quanto* entrou e saiu. Esta tabela responde a pergunta que mais ninguém responde: **por
que o custo e o preço do produto mudaram** — em que nota, em que data, de quanto para quanto. Guarda a
escada de custo inteira a cada processamento.

**Cada evento grava DUAS linhas**: `PRODUTO` é o antes, `PROCESSAMENTO` é o depois. Os totais por ano são
idênticos porque é sempre um par. E o par não é decorativo — nos 531.650 pares completos, **191.695 (36%)
mudaram o custo** e 20.330 mudaram o preço, com variação média de 18,29% em 2026.

Três decisões de projeto, cada uma com o número que a justifica:

- **o par vem casado e a variação calculada** no serviço, para que nenhum consumidor refaça a subtração;
- **sem o par, a variação é desconhecida e não zero** — ~2.000 linhas estão nessa condição, e mostrar zero
  afirmaria que nada mudou;
- **a FK é só para `produtos`** (casa em 100%), não para a nota (861.582 de 863.582): uma FK para a nota
  rejeitaria os órfãos e levaria junto o histórico do produto, que vale mesmo sem ela.

⚠️ E mais um caso do Achado 4: a tabela não guarda empresa, e derivando da nota são **685.702 linhas na
loja 1, 177.804 na loja 2 e 76 na 52**. Sem a derivação, 177.880 iriam para a loja errada.

**Restam duas tabelas vivas sem destino**: `NF_STATUS_PROCESSO` (440.211 linhas, a esteira do manifesto) e
`REMESSA_LOTE` (11 milhões), esta última já triada como **log de replicação** — infraestrutura do legado,
não regra, e o veredito de não migrar precisa ser escrito.


### Achado 13 — a esteira da nota, e o fim do inventário de tabelas sem destino

`NF_STATUS_PROCESSO`, **440.571 linhas para 44.054 chaves**: sempre as mesmas dez etapas por nota, do
manifesto à devolução. Migration 292, com tela. Dossiê `uNfStatusProcesso.md`.

**Pendente não tem data, e isso é o estado.** São 237.036 realizadas (com data) e **201.557 pendentes sem
data**: a etapa foi criada e não aconteceu. Preencher a data afirmaria que ocorreu; deixar a linha de fora
perderia que ela está prevista e parada. É o que permite responder em que etapa cada nota travou.

**A nota que nunca virou NF também tem esteira**: a chave casa com `nfe_nao_cadastradas` em 438.731 linhas
e com `nf` em 420.769 — **19.802 (4,5%)** são de notas manifestadas que nunca entraram. Sem FK para `nf`,
porque ela apagaria o histórico do que não entrou.

**O painel conta só a primeira pendente de cada nota** — as seguintes são consequência, e somá-las contaria
a mesma nota várias vezes.

⚠️ E a empresa é nula em **201.556 linhas**, justamente as pendentes. Medido: 44.051 das 44.054 chaves são
mistas, então ela se recupera da própria esteira; só 3 caem na nota e depois na loja 1.

### O inventário de tabelas vivas sem destino está fechado

| tabela | linhas | desfecho |
|---|---:|---|
| `CLUBE_DESCONTO_MOV` + família | 3.118.725 | mig 285 |
| `HISTORICO_PROCESSAMENTO_NF` | 863.582 | mig 291 |
| `NF_STATUS_PROCESSO` | 440.571 | mig 292 |
| `REMESSA_LOTE` | **11.048.221** | **não migra** — log de replicação, veredito escrito no plano |

`REMESSA_LOTE` era a maior de todas e é a única que não vira nada: cada linha é uma tripla (tabela, id,
data) apontando outra tabela, e o Apollo tem outro mecanismo de sincronização. Migrar o log de sincronismo
do legado não reproduz regra nenhuma — e isso agora está no `plano-tabelas.json`, em `excluidas`, com o
motivo por extenso.

**E o vínculo da nota com a esteira (mig 293)** — que na mig 286 ficou declarado no conferidor como "entra
com a esteira" — entrou: `nf.codnfstatuspro` e `nfe_nao_cadastradas.codnfstatuspro`, 42.065 e 43.872
preenchidos, 100% casando. ⚠️ Ele aponta **uma etapa**, o cursor da nota, e o cursor atrasa: é a etapa
realizada mais alta em 96,8% das notas e fica **para trás em 1.321**. A tela calcula o estado pelas dez linhas,
não pelo ponteiro. As duas declarações saíram do conferidor, que segue em **0 nos dois sentidos**.

### Achado 14 — o inventário completo: 337 tabelas com dado fora do plano, e o razão da nota sem texto

⚠️ **Correção de escopo do Achado 13.** "O inventário de tabelas vivas sem destino está fechado" valia para o
recorte que ele fez — as maiores, com movimento no dia. Uma triagem **tabela a tabela** de tudo que tem dado e
está fora do plano dá **337 tabelas** (566 milhões de linhas, 470 milhões delas num único backup,
`BKP_ESTOQUE_SICOM`). A maior parte é backup datado, temporária, BI, log, auditoria por trigger ou PDV — mas
não toda, e a Boa Vista (3,4 milhões de linhas, parada em mai/2026) mostrou que "parou" não é veredito.

**Primeira lacuna fechada — `ITENS_HISTORICO_CONTABIL` (mig 294).** A grade do cadastro de histórico é a regra
que monta o texto do razão: o texto segue a ORDEM dos itens mesmo contra o rótulo do template (no 62 o CFOP sai
no rótulo "CNPJ"). Montado assim, o razão das notas bate em **32.731 de 32.894** linhas (99,5%). E a
contabilização da NF do Apollo **gravava o razão sem texto** — 14.322 linhas de nota em 2026 no cliente, todas
com texto. Dossiê `uTron-integracao-contabil.md` §8.7.

**Vereditos já fechados, com prova:**

| tabela | linhas | veredito |
|---|---:|---|
| `NF_CANCELAMENTO` | 12.485 | ⛔ PDV — **só modelo 65** (NFC-e) em todos os anos, de 2020 a 2026 |
| `FCP` | 11 | 🪦 as 11 categorias de MG a 2% existem, mas **nenhum produto aponta `codfcp`** — o FCP das notas vem da alíquota e do XML |
| `COD_BENEFICIO_FISCAL` | 1.823 | 🪦 cBenef: **1 produto em 47.741** o preenche e **nenhuma das 5 lojas** tem `HAB_COD_BENEFICIO_FIS` |
| `APP_PERMISSOES` | 469 | ⛔ permissões do app mobile — já adiado com prova em `uCadPerfilOperador.md` |

**Lacunas achadas, na fila (medidas no Oracle de produção):**

| tabela | linhas | o que é |
|---|---:|---|
| `PEDIDO_COMPRA_QTDE` · `_EMPRESA` · `_HISTORICO` | 257.345 · 15.070 · 266 | o **split do pedido por loja**, adiado como "cross-docking" por decisão do usuário — tomada sobre "2% dos pedidos", número da HOMOLOGAÇÃO. Na produção **78% dos pedidos de 2024-2026 são para duas lojas** (`EMPRESAS='1, 2'`: 1.000/1.230, 752/975, 441/566), 46.309 itens (R$ 10,8 mi) divididos, fechamento POR LOJA. A carga preserva o total mas perde qual loja recebe quanto, e o pedido vai inteiro para a loja 1. ✅ **corte-A (mig 303)** — o usuário mandou converter (23/09/2026): quantidade por loja, fechamento por loja com as travas do legado, histórico, visibilidade por participação, tela. ✅ **corte-B**: NF de entrada por loja, saldo por loja, trava de faturado por loja, posição do produto por loja, preço nas lojas do pedido (+ trava de promoção da loja logada). ✅ **corte-C**: parcelas por loja (1.083/1.083 dos multi-loja com parcela), limite no escopo da rede (o Apollo filtrava a loja dona), ações pela loja participante. Conferência financeira da análise antiga: morta (0 linhas em `NF_PEDCOMP_DIV_FINANCEIRO` × 325 análises desde 19/10/2025). Meta diária por loja ✅ (mig 304; nula no cliente). Cotação → pedido por loja ✅. Impressão do pedido (por loja + agrupado) ✅ — não existia. Dossiê §18-§21 |
| `SUGEST_PROMO_PROD` | 471 | o substrato da tela 151 (`FRMGERENCIARSUGESTAOPROMOCAO`), que estava como "sem fonte" — o dado existe, até 21/09/2026 |
| `NCM_LC224_2025` | 59 | ✅ **mig 296, como REFERÊNCIA** — PIS/COFINS a 10% da alíquota padrão por NCM (LC 224/2025), vigência 01/04/2026. ⚠️ **o legado tem a tabela e não a aplica**: o catálogo `PISCOFINS` não tem nenhuma alíquota 0,165/0,76 nem 0,065/0,3, e as 28.428 vendas com CST 06 da 1ª semana de abril/2026 saíram com PIS nulo. Por fidelidade o Apollo também não calcula — aplicar é decisão fiscal do cliente |
| `CONTAS_BANC_TRANSF_PERM` | 19 | ✅ **mig 295, com a regra** — origem com linhas ativas só transfere para os destinos listados; origem sem linhas fica livre. Saiu do dado: desde a matriz, nenhuma transferência de conta listada foi para destino fora da lista, e as 6 "fora" eram da conta 201, que não é origem nela. Quadro no cadastro da conta. Dossiê `UCadContasBancarias.md` |
| `CONFIG_LANCAMENTO_AUTO_OFX` + `CFG_DESCRICAO_NAO_IMPORTAR_OFX` | 5.311 + 3 | ✅ **mig 298** — o filtro de importação (igualdade exata: 'REND PAGO APLIC AUT MAIS' contém o texto e o legado importa) e o lançamento automático das regras N (o mecanismo dos 17 movimentos de ago/2026: CAIXA + razão + conciliação num lote). As 5.254 regras T nunca geraram movimento — carregadas, não aplicadas. Dossiê `uConciliacaoBancaria-lote.md` §4 |
| `RETORNO_PAG_BOAVISTA` + 5 | 3,4 mi | a conciliadora de cartão Boa Vista: R$ 131 mi em retornos, parada desde 04/05/2026; as baixas seguiram sem ela (39 mil em jul/2026) |

### Achado 15 — o razão bancário: a carga somaria os débitos, e o estorno os dobrava (mig 297)

Achado ao estudar o lançamento automático do OFX. O legado grava o valor do movimento bancário **com sinal**
e soma pelo sinal; o Apollo guarda o valor **absoluto** com a direção no tipo. A convenção nova foi decidida e
seguida por todo gravador e leitor do Apollo — **mas a carga não convertia o dado do legado para ela**.

| Σ dos saldos das 27 contas | |
|---|---:|
| legado | R$ 41.364.570,33 |
| Apollo, carga convertida (agora) | R$ 41.364.570,33 — 27/27 iguais |
| Apollo, carga crua (antes) | **R$ 658.788.795,95** — 25/27 erradas |

E o estorno de baixa em lote copiava o `valor × −1` do legado: lá zera, aqui **dobrava** o débito — com um
smoke afirmando o valor errado como fidelidade. Junto, o `LIBERADO` (R$ 9,1 mi a prazo que o saldo atual do
legado não soma) entrou no destino; o conferidor não o acusava porque só olha colunas de chave/número.
Dossiê `UCadContasBancarias.md`.

**Dois pontos cegos do conferidor, registrados**: (1) só acusa coluna preenchida em ≥ 50% — `CLAO_ID` (17 de
1,2 milhão) passa; (2) só olha chave/número — a flag `LIBERADO`, que decide o saldo, passa. A convenção de um
valor (sinal × absoluto) ele não vê de jeito nenhum: a coluna existe nos dois lados.

### Achado 16 — o que a carga não conseguiria carregar, e o cupom que as apurações não veriam (migs 299-300)

**Capacidade, medida na PRODUÇÃO.** O `mapa-colunas.py` confere capacidade, mas mede na homologação. Refeito
contra a produção em todas as fases: cinco colunas apontadas, duas falso positivo (a carga já transforma) e
**três que parariam a carga**: `diario.tipodoc` (15 contra 10 — 36.596 linhas), `diario.deschist` (371 contra
255) e `clube_desconto_mov.movimento` (um registro posicional de 1,5 a 3 mil caracteres num varchar(60) — a mig
285 supôs que era "a chave do cupom"). `diario` é o razão contábil inteiro.

**A ligação do cupom.** `vendas.codnfc/chavenfe/statusnfe` não existem no `VENDAS` do legado (moram na `NFC`)
e a carga não as derivava: as pernas de cupom das apurações de ICMS e de IBS/CBS viriam vazias. Derivadas pela
ligação do `GetSQLNFC`; na semana conferida, 53.015 itens e ICMS R$ 9.179,50 idênticos ao legado.

**E uma afirmação minha corrigida.** Eu tinha registrado que o cupom não carrega IBS/CBS (medi as notas); os
itens do cupom carregam desde mar/2026 — ~200 mil por mês, CBS ~R$ 9 mil/mês. A apuração de IBS/CBS ganhou a
perna do cupom. Dossiês `uCadIBSCBS.md` §13.3 e `uRelRegistros_ES-apuracao-icms.md`.

**Os pontos cegos do conferidor, triados (continuação, migs 301-302).** Refeita a varredura das colunas da
origem ausentes no destino SEM os dois filtros do conferidor (≥ 50% e só chave/número): **575 colunas**, 17 do
PDV/PAF e 25 de replicação/integração, e **533 para triagem semântica** — `empresas` 61, `nf` 52, `parceiros` 46,
`produtos` 42, `nf_prod` 32, `vendas` 31, `multi_preco` 29, `areceber` 25, `cfop` 18… Das 31 de `vendas`, 15 eram o
IBS/CBS do cupom (mig 299). As 18 do `cfop` (mig 301):

| flag | CFOPs | veredito |
|---|---:|---|
| `NAO_GERA_SPED` | 1 (2949) | ✅ **regra viva** — o SPED do legado só aceita CFOP com 'N' (`UdmSpedFiscal.dfm:2658`); ligada no SPED ICMS-IPI, cabeçalho e item |
| `COD_BC_CREDITO` | 17 | ⚠️ **achado para o épico SPED PIS/COFINS**: a apuração do Apollo grava base de crédito 1 FIXA; a do legado varia (1, 2, 4, 6, 7). Pelo CFOP reproduz-se só parte (bases 1 e 2, aproximadas; 02-03/2026: 473 mil × 478 mil na 1, 62,6 mil × 56,8 mil na 2); as 4/6/7 vêm de fontes que o fonte de 2020 não mostra |
| `NAOALIMENTADRE` | 4 | carregada; nenhuma DRE do Apollo lê nota de saída, onde agiria |
| `PRECO_CUSTO` | 5 | só no fluxo de nota a partir de pedido de venda tipo 7 (`uNF.pas:1616`) — fluxo morto com prova |
| `DISPENSADO_COLETA` | 4 | etapa de coleta do app de conferência (mobile) — fora do escopo |
| 7 flags | 398 | 'N' em todos os CFOPs — comportamento padrão, sem efeito |

**Escala numérica, medida na produção** (o `escala-numerica.py` lê os CSVs da homologação): nenhum estouro de
precisão; três escalas curtas alargadas (mig 302), a relevante na minha própria mig 291 —
`historico_processamento_nf.vrcusto` arredondava 115.363 custos de 5-6 casas.

### Épico de plataforma — ENVIO DE E-MAIL (não existe no Apollo)

Achado ao fechar a impressão do pedido (23/09/2026): o Apollo não tem envio de e-mail nem PDF gerado no servidor
(a impressão é a camada `imprimirPagina`, no navegador). O legado envia de **9 units** — `NFe.pas` (4 pontos),
`uPedidoCompra.pas` (3), `uCadCotacao.pas` (3), `uCadAcordoComercial.pas` (3), `uNFCe.pas` (2), `udmNF.pas`,
`uDMSolicitacoesPortalConvenio.pas`, `uConfBoleto.pas`, `UCadEmpresa.pas` (o teste do SMTP) — sempre pelo SMTP DA
EMPRESA (`EMPRESAS.SMTP/EMAIL/SENHA_EMAIL/PORTA`, preenchido em 4 das 5 empresas do cliente), com o relatório em PDF
anexo (o pedido: `Pedido000123.pdf`, assunto "Pedido de Compra - <fantasia>", saudação pela hora) e, quando existe,
pelo executável `EnviaEmail.exe` em vez do Indy. Peças: remetente SMTP por empresa + PDF no servidor (os `.fr3`
viram HTML, como a impressão) + a confirmação "deseja enviar" em cada tela. Sem rastro de envio no banco (nenhuma
tabela de e-mail), então o uso não é medível pelo dado.

### Achado 17 — o pedido de compra chegaria "recebido": a data digitada no carimbo (23/09/2026)

No legado `PEDIDOCOMPRA.DTFATURAMENTO` é a data de faturamento DIGITADA (edtDtFaturamento, a base do vencimento
das parcelas) — **1.541 de 1.541** pedidos de 2025-26 a têm. O Apollo a guardou em `data_faturamento` (mig 067) e
deu ao `dtfaturamento` outro sentido: o carimbo da primeira nota de entrada, que TRAVA o pedido (`PEDIDO_FATURADO`
em editar, reabrir, gerar parcelas, importar itens, liberar limite). A carga casava pelo nome: **todo pedido
migrado chegaria recebido e travado**, e sem a base das parcelas (que cairia na data do pedido). É a lição 112 de
novo — convenção decidida no Apollo que a carga não converte e nenhuma conferência vê (o conferidor olha nomes).

Corrigido: `RENOMEIA` leva `DTFATURAMENTO` → `data_faturamento`, e o carimbo sai da nota vinculada no
`pos-carga.sql` (`NF.CODPEDCOMP`: 3.269 notas de 3.193 pedidos; a outra perna da `GET_PEDIDO_NF`, `PEDIDO_NF` tipo
'P', tem 1 linha). Medido na produção: de 2.771 pedidos de 2024-26, **41** têm nota vinculada — são esses que
chegam travados, não os 2.771. A subconsulta no Oracle levaria ~20 min na carga inteira (`NF.CODPEDCOMP` sem
índice); no Postgres, depois da carga, é uma agregação.

### Achado 18 — o conferidor não via imposto nem lucro: 51 colunas fora do destino (23/09/2026)

Na revisão do pedido de compra (dossiê `uPedidoCompra.md` §22) o item perdia 21 colunas preenchidas em 85-99% — a
composição do custo e a escada de preço — e o `conferir-colunas-orfas.py` não acusava: o filtro de nomes dele
(`custo|preco|valor|margem…`) não pega `ICME`, `ICMST`, `IPI`, `FRETE`, `SEGURO`, `DESPACESSORIO`, `LUCROBRUTOV`,
`IMPREND`, `CONTSOCIAL`, `PISCONFIS`, `DEBITOICM`. O filtro foi estendido; o pedido foi resolvido (mig 307); e apareceram
**51 colunas em outras tabelas**, agora declaradas em `TRIAGEM_PENDENTE` (saem no relatório toda vez, sem derrubar o
gate):

| tabela | colunas | linhas | o que parece |
|---|---|---:|---|
| `vendas` | `creditoicm`, `creditopiscofins`, `debitoicm`, `despopv`, `imprend`, `contsocial`, `frete`, `frete2`, `ipi`, `seguro`, `despacessorio`, `icmst` (86%), `pis` (97%), `icms_modalidade_bc`, `icms_origem_mercadoria`, `icms_taxa_reducao_bc` (100%) | 18,9 mi | a escada de preço de cada item vendido (a rentabilidade por venda) e o ICMS do cupom |
| `nf_prod` | `debitoicm`, `despopv`, `imprend`, `contsocial`, `lucrobrutov/p`, `lucroliqv/p` (100%), `ipi_devolucao`, `destacicmssn` (97%) | 498 mil | a escada no item da nota de entrada |
| `pedido_devolucao_compra_i` | ICMS/ST/IPI/frete/PIS-COFINS com e sem "_nota" (14 colunas, 100%) | 6.136 | os tributos da devolução de compra |
| `nf` | `pis_nfe`, `cofins_nfe`, `rateio_ipi`, `rateio_ipi_devolucao`, `abater_icms_deson` | 49,6 mil | totais de PIS/COFINS da NF-e e flags de rateio |
| `produtos` | `pis`, `taraembalagem` | 47,7 mil | |
| `parceiros` | `hab_ret_pis_nf_sai`, `hab_ret_cofins_nf_sai` | 19 mil | habilita retenção de PIS/COFINS na saída |

Cada uma precisa de coluna no destino (e da regra que a lê) ou de uma linha em `ORIGEM_DECLARADA` com a prova.

**Andamento (23/09/2026):** a devolução de compra era a de maior risco — o item não guardava os tributos e a NF de
devolução rateava o imposto ESCRITURADO em vez do DESTACADO na nota (37.881 itens de entrada de 2025-26 com base
destacada e escriturada zero; R$ 3.943 × R$ 520 de ICMS devolvido em 2025). Corrigido (mig 308, dossiê
`uCadPedidoDevolucaoCompras.md` corte-4), junto com o defeito que ela revelou no motor: **salvar a NF apagava 59 colunas
do item**; o motor agora preserva o que o agregado não gerencia, ligado em 10 detalhes (NF, produto, inventário, troca,
scrap, operadoras). Pendentes do Achado 18: 34 (a escada na venda e no item da nota, PIS/COFINS da NF-e, `produtos.pis`
e as constantes a declarar).

**Fechado (23/09/2026, mig 309):** das 34 restantes, entram no destino a escada de preço da venda (12 colunas + o flag de
PIS, a redução da base e a origem da mercadoria do cupom) e do item da nota (8), os totais de PIS/COFINS da NF-e e o
`produtos.pis` (lido pela apuração, Uapuracao.dfm:1535); ficam de fora, declaradas em `ORIGEM_DECLARADA` com a medida, as
constantes e resíduos — modalidade da base do cupom (sempre 3), rateio de IPI (sempre 'N'), abater ICMS desonerado (4
notas), destaque de ICMS no Simples (sempre 'N'), tara da embalagem (2 produtos) e a retenção de PIS/COFINS na saída
(todos os parceiros 'N'). `TRIAGEM_PENDENTE` vazia; conferidor 0/0.


> **Revertido no mesmo dia (Achado 19):** as constantes e resíduos declarados "de fora" acima entram também — ordem do
> usuário, "tem que ter todos os campos". `ORIGEM_DECLARADA` vazia.

### Achado 19 — todos os campos: 1.319 colunas da origem que o destino não tinha (23/09/2026, mig 310)

Ordem do usuário, depois de eu ter declarado constantes e resíduos "de fora" no Achado 18: **"tem que ter todos os
campos"**. O conferidor passou a acusar QUALQUER coluna da origem ausente no destino — sem filtro de nome, de
preenchimento ou de zeros — e, contra a PRODUÇÃO, achou **1.319 colunas em 82 tabelas** do plano.

- **7 eram só nome diferente** e o dado chegava VAZIO sem ninguém notar (viraram de-para em `RENOMEIA`):
  - `CONFIGURACOES.CONFIGESPECIFICASPERMITIDAS` (842 de 842) → `config_especificas_permitidas`: a lista de escopos em que
    cada configuração aceita valor por loja/operador. Sem ela, depois da virada só o valor GLOBAL valeria;
  - `EMPRESAS.SERIE` ('001' nas lojas que emitem) → `serie_nfe` (o Apollo assumia '1'). A numeração da NF passou a
    comparar a série normalizada (`ltrim` dos zeros): '001' e '1' são a mesma série para a SEFAZ — sem isso a numeração
    própria recomeçaria do 1 e duplicaria NF-e;
  - `COTACAO` (2 datas de preenchimento), `INVENTARIO_LIVRO` (2 flags), `FORMAS_PGTO.LANC_MOVIMENT_INDIVIDUAL` (o legado
    grafa sem o O).
- **1.312 entram pela mig 310**, com o tipo do Oracle (gerada do `user_tab_columns`, em ordem de coluna). A carga casa
  pelo nome; o extrator e o carregador passaram a citar nomes que só existem entre aspas (`PARCEIROS."2017"…"2022"`),
  a gravar BLOB/RAW como `bytea` (a biometria — decodificar como texto corromperia) e a dividir o lote pelo número de
  colunas (500 linhas × 240 colunas estourava o limite de 65.535 parâmetros do Postgres).
- **As telas preservam o que não mostram:** `preservarNaoGerenciadas` ligado em mais 10 detalhes (item do pedido,
  pagamentos/relacionamentos/endereços do parceiro, código auxiliar, clube de desconto, agenda de promoção, operações da
  conta, referências e contábil da NF) — salvar pela tela não apaga coluna que veio do legado.
- **`nf.faturada`** (flag só do Apollo, padrão 'N'): a pós-carga marca 'S' nas notas com título em ARECEBER/APAGAR — sem
  isso nenhuma nota migrada poderia ter o faturamento estornado.

Conferidor: **sentido 2 = 0** (nenhuma coluna da origem fica para trás, 196 tabelas); sentido 1 = 9 colunas só do
Apollo, todas com padrão. Smoke 1445/0.

### Achado 20 — todos os dados: a triagem das 329 tabelas fora do plano (23/09/2026, mig 311)

Continuação do "tem que ter todos os campos" uma escala acima. As **329 tabelas com dado fora do plano** (inventário
do Achado 14 menos as que entraram depois) foram triadas **uma a uma contra a produção**, em quatro frentes (caixa,
fiscal, compras/produto, sistema/auditoria). Cada veredito tem prova — fonte, trigger, job ou número do Oracle.

⚠️ **"Não está no fonte" não é prova de morte.** O fonte é de mai/2020 e a produção roda binário mais novo: tabelas
vivas como `SUGEST_PROMO_PROD` (21/09/2026), `CARTAO_SELECAO` (340 mil, gravada hoje), `AGENDA_PROMOCAO_EMPRESA` e
`TB_SPEED_AUX` não aparecem no fonte. E `user_objects.created` = 19/10/2025 para quase tudo (a data da mudança do
banco) — a data de criação não separa backup de tabela viva; o nome datado separa.

**O resultado:**
- **48 tabelas entram (mig 311)**, com todas as colunas e o tipo do Oracle (gerada do dicionário; o plano é derivado do
  destino e as pegou sozinho — 200 → 248). São o dado de negócio que uma tela convertida usa e o Apollo não tinha onde
  guardar, ou que é de tela ainda não convertida e se perderia. Mais `reducaoz` (vazia) com as 19 colunas do legado.
- **280 ficam de fora, com veredito**: auditoria técnica 32 · auxiliar 57 · cópia/planilha 63 · equivalente 11 ·
  outro sistema 37 · morta 66 · PDV 13.
- **Conferidor novo, permanente: `tools/cutover/conferir-tabelas-fora.py`** — falha em qualquer tabela com dado fora do
  plano sem veredito (tabela nova que o binário da produção criar aparece sozinha). O de colunas continua em 0 nas 248.
- O gerador do plano apagava uma exclusão que só existia no JSON (`REMESSA_LOTE`) — agora mora no gerador.

**A fila de trabalho que a triagem abriu (lacunas em telas JÁ convertidas), por risco:**

| # | tabela(s) | o que é | o que falta no Apollo |
|---|---|---|---|
| 1 ✅ corte-1 mig 313 (`uLog-registros.md`) | `LOG` (2,49 mi, viva) | o "Registros de Log" que **21 telas** abrem (`TLog.GravaLog`, 113 chamadas em 25 units): usuário + valor anterior/atual de cada campo. É o **único registro de quem mudou permissão de quem** (1.501 linhas de PERMISSOES — ex.: "CLONOU AS PERMISSOES … PARA O USUARIO …") | a tabela (✅ mig 311), o visualizador nas telas e o Apollo gravar nela. ⚠️ `uCtrlPermissoes.md` §3 item 7 marca como coberto por `audit_permissoes` — **errado**: o GravaLog grava na LOG; a `audit_permissoes` só guarda programa + máquina Windows |
| 2 ✅ mig 312 | `AGENDA_PROMOCAO_EMPRESA` + `agenda_promocao_itens.empresas` | agenda de promoção **multi-loja**: em 2026, 185 de 468 agendas valem para mais de uma loja. Quem manda no preço é a lista de lojas DO ITEM (o multi_preco segue ela em 106/108 desde jun/2026); a tabela de lojas da agenda é o filtro do app de gestão | o Apollo aplica só na loja logada (mig 080 adiou com a premissa do "cross-docking" — a mesma que caiu no pedido). ⚠️ E o **ciclo de vida**: `FLAGPROMOCAO` N=ABERTA → E=EXECUTANDO → J=FECHADA (combo `cbbStatus`; na produção E = as 6 vigentes, J = as 1.142 passadas, N = 1 futura). O dossiê leu 'J' como "agendada = norma" e o Apollo grava agenda nova como **'J' = fechada** |
| 3 | `ISITUACAO_NF` (148) | CFOPs permitidos por situação de NF — é a origem da situação de **99,5% dos itens de NF de 2026** (68.238/68.606); teste de bonificação, transferências | a mig 076 copiou só 4 CFOPs para `cfop.idsituacao_nf_saida` |
| 4 | `SITUACAO_NF_PLC` (333) | centros de custo por situação: o CC do faturamento quando a NF não tem rateio (396 NFs em 2026), os CCs permitidos, o rateio pré-preenchido | adiado para "F5b" com a premissa de que nada se perdia — a configuração se perderia |
| 5 | `PEDIDO_NF` (3.531) | NF emitida a partir do SCRAP: **199 de 244 scraps de 2026 viraram NF-e** (CFOP 5927/5949/5557) | o Apollo baixa o estoque direto no scrap. ⚠️ `uCadSCRAP.md` diz que desde 27/10/2025 a baixa é direta (`MOV_ESTOQUE='S'`) — **na produção MOV_ESTOQUE é nulo em todos os scraps de 2024-2026**; o Apollo somaria uma segunda baixa à da NF |
| 6 | `TB_SPEED_AUX` (7.796, viva) | registros 0205 (produto mudou descrição/código) e 0175 (parceiro mudou) do SPED; 1.474 ainda não informados | o SPED do Apollo não tem 0205/0175 nem a captura da alteração |
| 7 | `PRODUTOS_FORN_DESASSOCIADOS` (304) | produtos que o comprador desassociou do fornecedor — a importação de itens do pedido os pula (`uPedidoCompra.pas:8313`) | o filtro no `importarItens` |
| 8 | `NFE_REF_DEV_ENT_VINCULO` (589) | vínculo NF de devolução × NF de entrada no manifesto | o manifesto mostra como "não importada" a contrapartida da devolução |
| 9 | `ARQUIVO_MANCARTAO`, `REDE`, `EMPRESA_REDE_ESTABELECIMENTO`, `CONTAGEM_CEDULAS`, `CX_PEDIDOS`, `HISTARECEBER`, `CONTAS_BANCARIAS_EMPRESAS`, `RECEITA_PROD_HIST`, `CONFIRMA_INV_ROT`, `DECOMPOSICAO_NF_QTDE`, `PC_BASECREDITO` | pais/catálogos de tabelas já carregadas (a `itens_mancartao` apontava para um cabeçalho que não vinha; `cartao.codrede` para um nome que não vinha), pagamentos do pedido de venda, trilha do AR por trigger… | as tabelas (✅ mig 311); o uso em tela, caso a caso |

**Tela fora do escopo que guarda dado de tesouraria:** a finalização do fechamento de caixa (`FINALIZA_FECHAMENTO`
386 mil + `DOC_FECHAMENTO` 2,1 mi, vivas; `FRMFECHAMENTOCAIXA` 64.854 acessos) saiu da fila em 19/08 pela regra "nada
de PDV" — **interpretação minha**, não do usuário. Os dados entram (mig 311); a tela aguarda a decisão.

**Correções de vereditos antigos:** a FILA dizia que o inventário de tabelas vivas sem destino estava fechado — não
estava (TB_SPEED_AUX, ICME_PROD_APURACAO, REF_MENSAGENS_NF, NFE_REF_DEV_ENT_VINCULO e SITUACAO_NF_PLC gravadas em
set/2026). Item 97: `NFAUXSPED`/`NF_PRODAUXSPED`/`VENDASAUXSPED` são fotos refeitas a cada geração (o horário da
recriação bate com o do FRMSPEDFISCAL). Item 156: `MENSAGENS_NF` existe (no plural), e o veredito "morta" fica. A
`PEDIDO_NF` não parou em set/2025 — só a coluna `INDR_DATA` parou; junto de NF vai até 01/09/2026.

**Fora do Apollo mas lendo este Oracle** (registrado, não é dado do Apollo): o app GestaoMobile (login e permissões em
`APP_PERMISSOES`), o licenciamento central do fornecedor (270 clientes ativos) e o BI novo (usuários, painéis, metas).
