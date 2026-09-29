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

### As fontes que não existiam (mig 391)

14 views do catálogo da produção, com as colunas de ALL_TAB_COLUMNS e o rótulo do combo (o COMMENT sem o `;` do início — 'VENDAS'
e 'VENDAS;' são duas): GET_ADIANTAMENTO_FORN, GET_APAGARBXCC, GET_CAIXA, GET_CARTAOBX, GET_CP, GET_CX, GET_DRE_COMPETENCIA,
GET_NOTAS_SEM_PEDIDO, GET_TIPO_CODIGO_VENDIDO, GET_VALORES_CARTAO, GET_VENDAS, GET_VENDASRELAT, GET_ESTOQUE_TOTALIZADO e
GET_PRODUTOS_ESTOQUE. As esquisitices que ficaram estão no cabeçalho da migration (GET_APAGARBXCC soma a TAXA de juros como valor;
GET_ESTOQUE_TOTALIZADO repete o saldo a cada preço igual de outra loja; NEUTRA 'NÃƒO' → 'NÃO').

### O código da venda (mig 392)

No Oracle `VENDAS.CODVENDAS` identifica a **venda** (o cupom: 6.248 linhas para 1.572 códigos num dia); aqui `vendas.codvendas` é a
PK da linha e o do legado mora em `codvendas_legado` (o mesmo com `cx_vendas.codcxvendas`). GET_VENDAS, GET_VENDASRELAT e GET_CX
passaram a expor o código do legado — a 391 usava a PK da linha e a GET_VENDAS saía uma linha por item. E a GET_HIST_VENDAS (a
pesquisa da consulta de histórico, mig 161) foi realinhada com a view de hoje da produção: 14 colunas, uma linha por venda — a
161 fora feita sobre uma versão antiga, com o PIS na chave (17 colunas) e o menor ID de linha no lugar do código. Ao portar view
sobre tabela da carga, conferir o `RENOMEIA` do `extrair.py`: o nome igual pode guardar outra coisa.

### O placar (simulação sobre os 95 relatórios da produção, 29/09/2026)

**81 importam**, cada um na fonte onde roda no legado (eram 28 no começo do dia). Os 14 que sobram:

| motivo | relatórios |
|---|---|
| citam coluna que a view da produção **não tem mais** (já quebram lá) | 3 — `PESO_TOTAL` e `CODIGO_PEDIDO` (GET_NF), `TAXA` (GET_CARTAOBX, de 2018) |
| citam view que **não existe** na produção (já quebram lá) | 8 — FINALIZADORAS, OURO - FLUXO DE CAIXA NIVEL-2 (2), _OURO - PRODUTO VENDIDO, VENDAS_PEDIDOS (2), _OURO - VENDAS_PEDIDOS (2) |
| GET_ARECEBER sem COMMENT — o legado não a oferece e o arquivo não aparece sob nenhuma view do combo | 1 |
| GET_CONTATOS_PDV — lê a PUBLICIDADE_PRE, que só o PDV grava (fora do escopo, como a HISTORICO_PDV) | 2 |

Ou seja: todo relatório do cliente que roda no legado de hoje importa, menos os 2 do PDV.

## As fontes das telas, na versão do legado (mig 393)

As views que alimentam a grade das telas entregam o **código cru** (filtros e selos dependem dele); o legado entrega o texto
decodificado e outras colunas. Resolvido pelo mecanismo da mig 389: `rel_get_` de agenda de promoção, bairro, contas bancárias,
empresas, famílias, formas de pagamento, livro de inventário, lote de cobrança, operadoras, operadores, devolução de compra,
perfil, plano de contas, produção, promoção, troca e unidade. Senhas (`SENHAADMIN`… da GET_EMPRESAS, `SENHA` da GET_OPERADORES)
existem com o nome e saem **nulas**. A GET_TROCA do legado conta os status do sub-nível `ITENS_TROCA_QTDE` (cópia 1:1 dos itens,
veredito EQUIVALENTE): troca sem item sai FECHADA. E a carga passou a preencher `itens_troca.idempresa` (o legado guarda a empresa
do item nesse sub-nível — sem isso os 309 itens chegariam com a empresa nula).

A GET_ARECEBERBX ganhou os nomes **literais** da produção: `"cod_desconto_titulo "` (com espaço), `"x.txmulta"`,
`"x.valor_perc_multa"`, `"x.multa"`; o construtor cita o identificador inteiro (`sql.id`) e o schema aceita ponto e espaço no campo.

### O conferidor permanente (smoke §283)

`tools/cutover/catalogo-construtor-producao.json` é o retrato das **199 views do catálogo da produção** (COMMENT que não começa com
`#` — os `#PDV_…` são as views de carga do PDV; rótulo = o COMMENT sem o `;` do início), com colunas, tipos e SQL. O §283 confere
toda fonte daqui contra ele: rótulo igual, colunas do legado na ordem (na `rel_` quando existe), nenhuma fonte inventada. Em
29/09/2026: **116 de 199** fontes existem aqui, todas conferidas (migs 394–396: 70 fontes novas, em lotes, com a lista de colunas
explícita no `CREATE VIEW` como no Oracle). Rótulos com acidente de codificação no próprio COMMENT (`HistÃ³rico Desconto`, um
U+0081 invisível em `MOVIMENTAÇÃO DIÁRIA`) saem consertados, e o importador conserta o `TABELA` do arquivo antes de comparar. Renovar o retrato: `tools/cutover/retratar-catalogo-construtor.py`
(só leitura).

Equivalentes (sem ação): `get_bairro`, `get_cidades`, `get_empresas`, `get_parceiros`, `get_pedido_devolucao_compra`,
`get_nf`, `get_operadoras`, `get_perfil`, `get_scrap`, `get_unidade`, `get_bancos`. `get_hist_vendas` foi portada com agregação
própria (mig 161). Não comparadas por estrutura (o parser não casa): `get_apagar`, `get_estoque`, `get_produtos`,
`get_inventario_livro`, `get_lote_cobranca`.
