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
| 27 | `FRMANALISECOMPORTAMENTO` | 53 | 8 | 🟡 **recon feito, conversão pendente de um processo externo**. A tela (14.384 linhas no conjunto) é só o **leitor** de `REL_ANALISE_COPORTAMENTO` — ⚠️ e o comentário do autor do legado diz de onde vêm os números: *"é alimentada diariamente no processamento que fica dentro do **aplicativo Giros**, que é executado diariamente por volta das 4:00 da manhã"*. O Giros **não veio no fonte**. O resultado está vivo (14.014 linhas, **105 meses de jan/2018 a set/2026**, 3 empresas, 3 títulos: Faturamento, CMV, Num. Clientes, uma linha por dia). Reconstruir do dado deu **0,75% de diferença** em ago/2026 (cache 1.145.153,34 × `SUM(QTDE×VRVENDA)` 1.153.860,03) e **1 cupom** no nº de clientes; nenhuma coluna de desconto fecha a diferença sozinha (`DESC_PROMOCAO` 838,05 · `DESC_SCANNTECH` 838,05 · `TOTAL_ITEM_DEVOLVIDO` 428,05 · `DESC_ACRE_MEDIO` −7.071,28). **DESTRAVADO em 18/09/2026 pelo item 53** (mig 250): o critério do Giros foi reconstruído do dado e o Faturamento agora fecha. Ago/2026, loja 1: a cache marca **1.146.825,82** e o cálculo dá **1.146.825,83** — **1 centavo** em R$ 1,1 milhão (era 0,75%, R$ 8.706,69). A conta é `Σ round(qtde × vrvenda, 2) + DESC_ACRE_MEDIO − DESC_PROMOCAO` mais a NF de saída cujo CFOP tem `PROC_FINANCEIRO='S'` e `DEVOLUCAO='N'`. O que sobra é pequeno e **explicado**: o CMV difere **0,09%** porque o Giros usa o custo da madrugada seguinte, e o Num. Clientes **0,8%** (24.097 contra 24.288) pelos mesmos cupons cancelados após o job. ⚠️ e a armadilha da contagem: o número do cupom **reinicia a cada dia**, então `DISTINCT NROCUPOM` no mês subconta 10,5% (21.804 contra 24.097) — a chave é o par (data, cupom). Pronta para converter |
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
| 40 | `FRMCADANALISECONCORRENTES` | 35 | 4 | | 🪦 **marginal** — mesmo substrato do item 15: `CONCORRENCIA` **20** linhas, `ANALISE_CONCORRENCIA` **1** e `MOV_ANALISE_CONCORRENTE` **6**. A pesquisa de preço de concorrente nunca pegou no cliente |
| 41 | `FRMRELANALISEITENSNF` | 34 | 4 | 🟢 **equivalente** (mig 245): item a item das notas, com custo, base, ICMS, ST e isento. ⚠️ o `WHERE` do legado **só filtrava DATA** — somava 6.840 entradas com **943 saídas** de **3 empresas** em ago/2026, inclusive canceladas. E `NP.DESCONTO` sem `COALESCE` sumia com o item do total (23 de 497.627) |
| 42 | `FRMIMPORTAPED` | 34 | 7 | 🪦 **marginal + fora de escopo**: importa pedido de **arquivo texto num diretório** (`PEDIDOS_*.txt` delimitado por `|`), nas abas Convênio, **Smart PDV** (fora de escopo por instrução) e Site. Medido: **28 pedidos importados** de 37.080 (**0,08%**), e `ORIGEM_IMPORT` nula em todos. A exportação de cadastros para o PDV externo é do mesmo bloco. Reavaliar se o e-commerce entrar em escopo — aí a forma muda de diretório para upload/API |
| 43 | `FRMFATURAMENTO2` | 34 | 8 | 🟢 **corte-1** (mig 246): as parcelas de cada nota, com a legenda de três estados (vencendo hoje / atrasada / faturada). **47.063 parcelas, 42.502 notas, R$ 125,7 milhões**, 7.472 em 2026. ⚠️ cópia-fiel-negativa: `TIPOREF` nulo nas 47.063 e `LOTE_FATURAMENTO` com 0 linhas — a aba de movimento não tem substrato. ⚠️ **5 parcelas com o ano digitado errado** (202, 2202, 5202), R$ 11.193,35. Falta o ato de faturar (que mexe em `pedidos` e `cx_pedidos`) |
| 44 | `FRMCADCONCORRENTES` | 32 | 4 | | 🪦 **marginal** — mesmo substrato do item 15: `CONCORRENCIA` **20** linhas, `ANALISE_CONCORRENCIA` **1** e `MOV_ANALISE_CONCORRENTE` **6**. A pesquisa de preço de concorrente nunca pegou no cliente |
| 45 | `FRMPEDIDOTRANSFERENCIA` | 32 | 7 | 🪦 **marginal**: pedido de transferência entre lojas é `PEDIDOS` com `TIPO='T'` — **33 pedidos** em 37.080, de **15/12/2023 a 26/02/2025**, parado há 7 meses. A operação é real e pode voltar; hoje não justifica o corte frente a telas com mais uso |
| 46 | `FRMDEVOLUCAO_NF` | 30 | 7 | ⛔ **sem fonte no repositório clonado** — o menu a chama "Devolucao de Vendas (NF)", mas nenhuma unit responde por `FRMDEVOLUCAO_NF` nem pelo caption. As outras devoluções TÊM fonte e estão em outro ponto da fila: `FRMDEVOLUCAOVENDAS` (3.958 acessos), `FRMCADPEDIDODEVOLUCAOCOMPRAS` (2.525, já migrada), `FRMCADDEVOLUCAO` (91) |
| 47 | `FRMMOVIMENTACOESDIA` | 27 | 8 | ✅ **completa** (mig 247) — o "o que aconteceu hoje e quem fez": pedidos, contas pagas, recebidas e o log, os quatro por período e operador. ⚠️ a tabela **`HISTORICO`** (a trilha em TEXTO, **455.264 linhas** até hoje) **não existia no destino** e entra agora. ⚠️ as quatro consultas do legado **não filtram empresa** (nem as views que elas usam) |
| 48 | `FRMCADAGENDAPREVPAGTO` | 27 | 4 | 🪦 **marginal — carga única e parada**: `AGENDA_PREV_PAGTO` tem **27 linhas, todas cadastradas em 04/10/2021 no mesmo minuto** (uma carga só) e nada depois. A previsão de pagamento recorrente nunca virou rotina |
| 49 | `FRMVACINAS` | 27 | 6 | ⛔ **sem substrato**: não existe tabela `VACINAS`; a única do assunto é `CAMPANHA_VACINACAO`, com **0 linhas**. As units existem (`Uvacinas`, `uCadCampanhaVacina`) mas o mecanismo nunca foi usado |
| 50 | `FRMLANFRETE` | 27 | 4 | ⛔ **sem fonte no repositório clonado** — nenhuma unit com esse nome |
| 51 | `FRMRELTROCAMERCADORIAFOR` | 27 | 5 | 🪦 **marginal**: `TROCA` tem **107** registros e `ITENS_TROCA` **309** (último item em 24/11/2025). A troca com fornecedor existe, mas em volume que não justifica corte próprio agora |
| 52 | `FRMCONSPROD` | 25 | 8 | ✅ **completa** (mig 249) — a consulta com **preços** (o que a `get_produtos` não traz) + a **`FRMPOSICAOPRODUTO`** no mesmo corte, porque ela não tem acesso próprio: só abre de dentro desta. A escada de custo→lucro é **lida** de `MULTI_PRECO` (a foto da precificação), não recalculada. ⚠️ os quadros de venda do legado leem **caches materializadas por job** (`MOVIMENTOS_VENDAS`, `SELECT_PEDIDOS`) que **não batem com a venda**: em ago/2026, mês FECHADO, a cache marca **+226,5 un** e em 2025 **+620,35** — ela congelou vendas canceladas depois do job e nunca reprocessa o passado (7,5% dos produtos divergem no mês corrente). ⚠️ a "média anual" esconde **sete anos** (a cache começa em 2025-01, a venda em 2018). ⚠️ o modo "Pedidos" muda **1 quadro de 4**, e nesse único aplica `TIPO='P'` — NULL em **36.887 dos 37.080** pedidos (99,5%). ⚠️ critério de cancelado divergente entre quadros (33 pedidos entram num e somem do outro) |
| 53 | `FRMRELANALISECOMPORTAMENTOPERIODO` | 24 | 6 | ✅ **completa** (mig 250) — compara três períodos nomeados em seis métricas. O legado lê a cache do **Giros** (o processo externo que bloqueou o item 27), mas aqui os campos são nomeados e deu para **reconstruir o critério do dado**: o faturamento fecha **60 de 60 dias × 2 lojas exatos** (e produto a produto), os tickets 58/60, a NF em todos os dias com nota. ⚠️ o **CMV do Giros usa o custo da madrugada seguinte**, não o da venda (produto 130 gravou 24,33 e a cache diz 26,367) — 177/180 dias exatos, **0,027%** de diferença total; aqui sai do custo da linha da venda. ⚠️ a **variação % divide pela referência**: ago/2026 × ago/2025 é queda de 31,28% e a tela mostra **−45,52%** (14,24 pontos). ⚠️ a mesma tela conta ticket por **cupom** sem filtro e por **pedido** com ele (974 × 970). ⚠️ a cache termina ontem; calculando, hoje aparece |
| 54 | `FRMCADINDEXADORTRIBUTARIO` | 23 | 4 | ✅ **completa** (mig 248) — de onde sai o ICMS-ST de toda entrada. **12.053 indexadores atualizados hoje**, para apenas **1.075 NCMs**: 748 NCMs têm mais de um e o `19053100` tem **285**, então a chave é a figura completa com desempate por especificidade (o motor já existia). ⚠️ indexador **sem discriminador** seria curinga universal no OR-null: recusado. Exclusão é **lógica** (`INDR=E`), como no legado |
| 55 | `FRMPROCESSAAPAGAR` | 23 | 4 |
| 56 | `FRMRELANALISEPEDIDONF` | 22 | 4 |
| 57 | `FRMCONSAPGBX` | 20 | 7 |
| 58 | `FRMRELDIFERENCASNFPEDIDO` | 20 | 5 |
| 59 | `FRMRELCORTESIAS` | 19 | 3 |
| 60 | `FRMCADMIDIADEPARTAMENTO` | 19 | 4 | ⛔ **sem fonte no repositório clonado** |
| 61 | `FRMCTRLRECARGASCORRESPONDENTE` | 19 | 3 |
| 62 | `FRMRELRUPTURAS` | 19 | 1 | ⛔ **sem fonte no repositório clonado** (e 1 operador) |
| 63 | `FRMATUALIZACAOPRODUTOS` | 18 | 5 |
| 64 | `FRMAGENDADESCARREGAMENTO` | 17 | 4 | ⛔ **sem substrato**: `AGENDA_DESCARREGAMENTO` tem **3 linhas**, a última de **05/08/2020** |
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
