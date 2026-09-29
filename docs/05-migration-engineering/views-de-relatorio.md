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

Esquisitices que ficaram: GET_APAGAR só tem título em aberto; `VALOR` é o líquido (valor + vendor − desconto) e `JUROS` a taxa;
`CNPJ_CPF` é o do endereço ativo que não é o primeiro — **vazio em 100% dos 7.932 títulos da produção** (18.962 dos 18.986
parceiros têm um endereço só). GET_NF só tem NF com parceiro; `TIPO_EMISSAO` nulo sai 'T'. Diferença deliberada: a `PRECIFICADA`
negativa da produção é `NÃƒO` (o 'NÃO' em UTF-8 lido como cp1252 ao criar a view) — aqui sai `NÃO`.

Simulação sobre os 95 relatórios da produção (29/09/2026): **50 importam** (eram 28); 19 pendentes por coluna; 26 sem fonte.

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
