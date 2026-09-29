# Views de relatório — o Apollo × o legado (28/09/2026)

As views com `COMMENT ON VIEW` são o **catálogo do construtor de relatórios** (o legado chamava de "fonte"; o rótulo é o COMMENT).
Um relatório do cliente importado para o construtor lê as colunas **pelo nome** — tem de ler o mesmo valor. Conferência coluna a
coluna contra `ALL_VIEWS`/`ALL_TAB_COLUMNS` da produção (só leitura) com `tools/cutover/conferir-views.py`: das 32 do catálogo
com homônima no Oracle, a mig 203 tinha trazido as quatro fontes que só o construtor usa com um subconjunto de colunas e vários
valores trocados.

## Corrigidas (migs 387-388) — na íntegra do legado

| view | relatórios | o que estava diferente |
|---|---:|---|
| `get_rcb` (A RECEBER) | 13 | 43 de 73 colunas; sem `dias_atrazo`/`juro`/`multa`/`total`; `nro_pedido` = `nroped`; `parcela` = `nrodup`; `cliente_completo` noutro formato; endereço de cobrança pelo padrão (o legado usa o `CODEND` do cliente); data de pagamento do título (o legado usa a da baixa); o par situação/código |
| `get_cp_cen` (CONTAS A PAGAR 2 CENTRO DE CUSTO) | 3 | partia do rateio com o valor do rateio (o legado parte do título: valor + vendor − desconto, centro pelo CODGRUPO); `data_contabil`; `nota_fiscal` = id |
| `get_apagarbx` (CONTAS A PAGAR BAIXADAS) | 4 | `valor_documento`/`acres_desc` trocados; `observacao` era a da baixa (é a do título; a da baixa é `historico`); conta contábil e centro de custo como id |
| `get_areceberbx` (CONTAS A RECEBER BAIXADAS) | 4 | `valor_liquido` somava o pago; forma de pagamento do título (é a do lote); endereço composto |

Esquisitices do legado que ficaram (são o que os relatórios dele mostram): em `get_rcb` a **lista de colunas da view manda** —
`CODIGO_SITUACAO_DOCUMENTO` recebe a descrição e `SITUACAO_DOCUMENTO` o código; título com duas baixas sai duas vezes; a taxa
diária de juro é arredondada a 2 casas. Em `get_areceberbx` o `DECODE` do endereço descarta número e CEP preenchidos.

## A versão do legado ao lado — `rel_<fonte>` (mig 389)

Uma fonte do catálogo que também serve a uma tela tem as colunas da tela. A versão integral do legado vive ao lado, com o prefixo
`rel_` e **sem COMMENT** (fora do catálogo): o construtor e o importador leem dela quando ela existe (`relacaoDaFonte`, em
`relatorio-construtor.service.ts`); o rótulo e o nome gravado na definição continuam os da fonte. No fim da `rel_`, com o mesmo
nome, as colunas da tela que o legado não tem — o que já foi montado aqui sobre a fonte continua de pé.

| fonte | `rel_` | relatórios do cliente que passaram a importar |
|---|---|---|
| `get_apagar` (CONTAS A PAGAR) | 53 do legado + 22 da tela | 14 de 14 |
| `get_nf` (NF) | 49 + 10 | 8 de 10 — os outros 2 citam `PESO_TOTAL` e `CODIGO_PEDIDO`, que **a view da produção não tem** (já quebram lá) |
| `get_produtos` (PRODUTOS) | 95 + 2 — uma linha por preço da loja (MULTI_PRECO) | 7 de 7 |
| `get_cartao` (CARTAO) | 42 + 12 — a coluna 41 chama-se literalmente `txefetiva tx_adm_arquivo` | 5 de 5 |
| `get_parceiros` (PARCEIROS) | 61 + 3 — uma linha por endereço | 3 de 3 |
| `get_pedidocompra` (PEDIDO DE COMPRA) | 24 + 15 (e a auxiliar `get_pedido_nf`, sem COMMENT) | 1 de 1 |
| `get_scrap` (SCRAP) | 16 + 7 | 1 de 1 |

`get_estoque` (ESTOQUE) só o construtor usa: foi substituída no lugar (10 do legado + 4), como as da mig 388 (mig 390).

### Qual é a fonte de um arquivo

O legado lista um arquivo sob **toda** view cujo `<VIEW>_` aparece no nome (`PercorreOrigem`, `Pos(PrefixoTabela, Arquivo) > 0`)
— `GET_ESTOQUE_TOTALIZADO_X.XML` aparece em GET_ESTOQUE e em GET_ESTOQUE_TOTALIZADO — e grava o rótulo da view em `TABELA`
(menos nos totais: `cbbTabela.Items[cbbTabelaShow.ItemIndex]`, uRelatorio.pas:3006, aplica o índice do combo ordenado na lista
sem ordem, e o rótulo sai de outra view). O importador tenta primeiro a view de prefixo com o rótulo das colunas, depois as outras
de prefixo (da mais longa), e fica com a primeira que tem todos os campos — o rótulo pode ser antigo (três relatórios do GET_RCB
gravaram "ARECEBER ABERTA", que a produção não tem mais, e rodam no GET_RCB). Sem nenhuma, fica pendente com o nome da fonte que
falta. Até aqui o prefixo sozinho mandava dois relatórios para a view errada (ESTOQUE TOTALIZADO → get_estoque; PRODUTOS E
ESTOQUE → get_produtos).

Esquisitices que ficaram: GET_APAGAR só tem título em aberto; `VALOR` é o líquido (valor + vendor − desconto) e `JUROS` a taxa;
`CNPJ_CPF` é o do endereço ativo que não é o primeiro — **vazio em 100% dos 7.932 títulos da produção** (18.962 dos 18.986
parceiros têm um endereço só). GET_NF só tem NF com parceiro; `TIPO_EMISSAO` nulo sai 'T'. Diferença deliberada: a `PRECIFICADA`
negativa da produção é `NÃƒO` (o 'NÃO' em UTF-8 lido como cp1252 ao criar a view) — aqui sai `NÃO`.

Simulação sobre os 95 relatórios da produção (29/09/2026): **65 importam** (eram 28), cada um na fonte onde roda no legado; 2
pendentes por coluna (as que a produção não tem); 28 sem fonte — destes, 8 citam views que **não existem na produção**
(FINALIZADORAS, OURO - FLUXO DE CAIXA NIVEL-2, _OURO - PRODUTO VENDIDO, VENDAS_PEDIDOS, _OURO - VENDAS_PEDIDOS: já quebram lá);
os outros 20 esperam as fontes GET_APAGARBXCC, GET_CARTAOBX, GET_CONTATOS_PDV, GET_NOTAS_SEM_PEDIDO, GET_CP, GET_CAIXA, GET_CX,
GET_ARECEBER, GET_ADIANTAMENTO_FORN, GET_DRE_COMPETENCIA, GET_TIPO_CODIGO_VENDIDO, GET_VALORES_CARTAO, GET_VENDAS,
GET_VENDASRELAT, GET_ESTOQUE_TOTALIZADO e GET_PRODUTOS_ESTOQUE.

## Divergências conhecidas — views que também servem telas do Apollo

Estas alimentam a grade de pesquisa das telas com o **código cru** (filtros e selos da tela dependem dele); o legado entrega o
texto decodificado. Trocar quebraria a tela; um relatório importado que filtre pelo texto ("DEPARTAMENTO") não casa. O caminho é
o da seção acima (uma `rel_` com o texto do legado); nenhum dos 95 relatórios do cliente usa estas fontes ainda:

| view | colunas |
|---|---|
| `get_familias_prod` | `tipo` (D/G/S/P… → DEPARTAMENTO/GRUPO/SUBGRUPO/GRUPO DE PRECO) |
| `get_formas_pgto` | `destino` (TEF/CHQ/CXA/RCB… → texto), `conta_corrente` (código × titular), `conta_contabil` (reduzido × descrição), `inativo` |
| `get_operadores` | `tipoop` (OPE/USU/FOR… → Operador(a)…), `desabilitado` |
| `get_plano_contas` | `classe` (A/T → ANALITICA/SINTETICA), `tipo` (E/R → EMPRESA/REFERENCIAL), `status` |
| `get_producao` | `status` (A → ABERTA / PROCESSADA) |
| `get_promocao` | `opcao`, `tipo`, `destino` (códigos → texto) |
| `get_cartao` | `tipocartao` (o legado decodifica o TIPO da operadora) |
| `get_troca` | `status` (outra regra de agregação dos itens) |

Equivalentes (sem ação): `get_bairro`, `get_cidades`, `get_empresas`, `get_parceiros`, `get_pedido_devolucao_compra`,
`get_nf`, `get_operadoras`, `get_perfil`, `get_scrap`, `get_unidade`, `get_bancos`. `get_hist_vendas` foi portada com agregação
própria (mig 161). Não comparadas por estrutura (o parser não casa): `get_apagar`, `get_estoque`, `get_produtos`,
`get_inventario_livro`, `get_lote_cobranca`.
