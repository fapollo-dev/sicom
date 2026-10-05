# RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — recon e cortes 1 a 3

`uProdutosRel.pas` (2.687) + `.dfm` (3.640) + `UDMProdutosRel` (410 + 3.699) + três grades auxiliares
(`Grid`, `ListaConferenciaGrid`, `PercasGrid`). **~10.900 linhas.** 162 acessos, 19 operadores.

## 1. ⚠️ Isto é um épico, não uma tela

**⚠️ Correção (25/09/2026): o combo tem 21 itens, não 15** (`uProdutosRel.dfm`:1033-1054), e **quatro dos "mortos" estavam vivos** —
a medição de 15/09 olhou a tabela errada. Recon completo, na produção e só leitura, com a SQL de cada item: seis relatórios (15-20) nem
constavam aqui. A numeração abaixo é o `ItemIndex` (base 0) do Pascal.

| ItemIndex | relatório | substrato na produção (25/09/2026) | Apollo |
|---|---|---|---|
| 0 | Relatório para análise | ESTOQUE + MULTI_PRECO | ✅ corte-3 (o FDqProdutos do legado — §9) |
| 1 | Lista para conferência | ESTOQUE (emp 1: 10.926 ≠ 0; emp 2: 5.717) | ✅ corte-2 (a folha de contagem com as colunas em branco) |
| 2 | Receitas | RECEITA_PROD 86 linhas / 10 produtos; a página de receitas **não tem provider** no fonte (resíduo DBX→FireDAC) | 🪦 marginal e quebrado |
| 3 | Ruptura na loja | ESTOQUE × ESTOQUE_DEP (loja ≤ 0 E depósito > 0) | ✅ corte-3 — sai vazio neste cliente (ESTOQUE_DEP zerado), como no legado |
| 4 | Estoque atual | ESTOQUE + ESTOQUE_DEP | ✅ corte-3 (rgDisponivelEm + resumo por departamento) |
| 5 | Análise pedido | PEDIDOS: 53 linhas em 2026 (a metade "venda" morta; a de estoque/custo = item 0) | 🪦 marginal |
| 6 | Estoque por data | ~~HISTORICO_PROD_DEP 19 linhas~~ → **HISTORICO_PROD 14,7 M**, último de hoje; o último saldo bate com ESTOQUE em 100% | ✅ corte-2 |
| 7 | Estoque saldo | substrato vivo, **relatório falho** (o HAVING por dia descarta 87% das saídas; saldo inicial fixo no balanço de 2020 com empresa 0; filtros dão ORA-00979) | ⛔ não converter fiel — o 6 dá o saldo na data certo |
| 8 | Troca de mercadorias | lê PARCEIROS (não ESTOQUETROCA): REALIZA_TROCA 'S' em 94%, OBS_TROCA 0, lista repetida por produto | 🪦 morto |
| 9 | Percas | ~~"sem tabela"~~ → **SCRAP 3.795 / SCRAP_ITEM 133.613**, último de hoje | ✅ corte-2 |
| 10 | Venda externa | nenhum produto ATACADO = 'S' (os 1.277 NULL saem "ATACADO") | 🪦 marginal |
| 11 | Lotes e validades | ~~LOTE_PRODUTO_VALIDADE 1 linha~~ → **NF_PROD_LOTE 132.166 lotes** (2.979 vencem até 31/12/2026) | ✅ corte-2 |
| 12 | Preço 2 | 10 produtos (47 linhas) | 🪦 marginal |
| 13 | Alterações de preço | HISTORICO_DINAMICO: 83.185 de VRVENDA (05/10/2026) | ✅ corte-3 (o GetSQLRelAlteracaoPrecos) |
| 14 | Inativos em agenda | ~~0 produtos inativos~~ → o filtro é o **item** da agenda inativo: **953**, 83 em 2026 | ✅ corte-2 |
| 15 | Estoque atual/vendas período | VENDAS 19 M, ~7 mil/dia | ✅ corte-2 |
| 16 | Validade de inventário | FAMILIAS_PROD_AREA 0 linhas; 1 produto com seção | 🪦 morto |
| 17 | Produtos por fornecedor | vivo, semântica frágil ("última NF" = maior CODNF: errada em 4,4%; estoque na entrada com sinal trocado) | ✅ corte-2b (redesenhado sobre o dado — §7) |
| 18 | Comparativo de mix (estoque × loja) | 5.053 produtos com estoque na 1 e sem na 2 | ✅ corte-2 |
| 19 | Comparativo de mix (estoque × giros) | MOVIMENTACAO_DIARIA 4,05 M (a rotina GIROS rodou hoje) | ✅ corte-2 |
| 20 | Coletados para promoção | LOTE_PRODUTO_VALIDADE_PROMO 0 linhas | 🪦 morto |

**Placar: 13 de 21 entregues**; 6 mortos/marginais medidos; o 7 não se converte fiel (defeitos que o 6 não tem).

## 2. ⚠️ Duas tabelas gêmeas de estoque, e escolher a errada zera o relatório

| tabela | linhas | conteúdo |
|---|---|---|
| `ESTOQUE_DEP` | 203.546 | **completamente zerada**: nenhuma quantidade, nenhum mínimo, nenhum máximo, nenhum local |
| `ESTOQUE` | 203.546 | **4.121 produtos com estoque negativo**, 186.487 zerados |

Este cliente **não usa estoque por depósito**. Lemos `ESTOQUE`. Ler a gêmea daria um relatório inteiro de
zeros, sem erro nenhum na tela — o pior tipo de defeito.

### As 7 colunas que faltavam (mig 216)

`qtde`, `minimo`, `maximo` e `local` já vinham. Faltavam `qtde_est_ped_vendas`, `qtde_est_ped_compras`,
`qtde_est_condicional`, `qtde_cong`, `qtde_bk`, `dtvenda` e `dtvenda_anterior` — as de reserva e as datas de
giro. São elas que separam "tenho 10" de "tenho 10, mas 8 já estão vendidos e não saíram", e sem `dtvenda`
não existe ruptura com tempo.

## 3. As quinze comparações do `cmbFiltro` (e as do `cbbEstoqueDep`)

> ⚠️ **Corrigido no corte 3.** O texto antigo dizia que as dez de mínimo/máximo comparam contra `coalesce(minimo, 0)` — **errado**: o
> legado compara as colunas cruas (`B.QTDE <= B.MINIMO`, P:1128-1142). Mínimo/máximo **nulo** (87.021 linhas de ESTOQUE na
> produção) não satisfaz nenhuma comparação, então "igual ao mínimo" **não** traz o produto zerado sem mínimo. A 14 é
> `((B.QTDE = 0) OR (B.QTDE < 0))` — também cru (QTDE nula fica de fora). O `cbbEstoqueDep` repete as quinze sobre `DE.*`.

## 4. Ruptura na loja = falta na loja com saldo no depósito

> ⚠️ **Corrigido no corte 3.** O corte 1 inventou um corte "dias sem venda" que não existe no legado. A ruptura (`cbbTipoRelCloseUp`,
> item 3) **força o `cmbFiltro` = 14 (loja zerada ou negativa) e o `cbbEstoqueDep` = 13 (depósito > 0)** e trava os dois: é a lista
> do que dá para repor puxando do depósito. Neste cliente o ESTOQUE_DEP é todo zero → **o relatório sai vazio, como no legado**.
> Layout `prod_Posicao_Estoque_Dep_produtos.fr3` (Qtd. Dep., Qtd. Loja, mínimo/máximo do depósito).

## 5. Alterações de preço (13) — o `GetSQLRelAlteracaoPrecos`

`HISTORICO_DINAMICO` da MULTI_PRECO com **`CAMPO = 'VRVENDA'` exato**, ligado ao produto pela `CHAVE = 'IDPRODUTO'`; MULTI_PRECO,
ESTOQUE e ESTOQUE_DEP da empresa da alteração (para o ativo e os filtros de estoque — todos habilitados); empresas marcadas sobre
`H.CODEMPRESA`; `TRUNC(H.DATA)` no período. Ordem `A.DESCRICAO, H.CODEMPRESA, H.CODHISTORICO`. A grade do legado agrupa por código de
barras + descrição (detalhe: empresa, operador, histórico, anterior, atual, data); o "Expandir itens" vale aqui e na lista de conferência.

**Dois defeitos do corte 1 (medidos na produção em 05/10/2026):**
1. `UPPER(CAMPO) LIKE '%VRVENDA%'` trazia junto o **VRVENDASUG** — 15.865 linhas (16% a mais), que não é preço de venda;
2. o valor é **texto** em três formatos: "3.59" (alteração direta), **"3,59" em 97%** (cadastro, precificação, lote) e "9.999,00" (48,
   com milhar). O `::numeric` do corte 1 dava **erro em qualquer período real**. A variação (R$ e %, um acréscimo do Apollo — o legado
   mostra os dois textos) agora é calculada no código (`valorDoHistorico`: com vírgula, o ponto é milhar).

O layout PERSONALIZADO do cliente (`Alteracoes_preco.fr3`, cód. 638) imprime **VALOR_ANTERIOR também na coluna "Valor novo"** — defeito
do layout, não do dado (a grade mostra os dois certos).

## 6. Cobertura (§108 do smoke, 6 checks)

1. as comparações cruas (o mínimo nulo fora do "igual ao mínimo");
2. a ruptura vazia sem depósito; com 12 no depósito, o −5 da loja entra, com o valor de loja + depósito;
3. a análise: valor parado, ordem empresa › fornecedor › descrição, quantidade da loja e valor "sem incidência";
4. o "ativo" da MULTI_PRECO;
5. o estoque atual nos três "Disponível em" e o resumo por departamento;
6. as alterações de preço: só VRVENDA, os três formatos de texto, empresas, período na data da loja, ordem, operador, produto.

## 7. Corte-2 (25/09/2026) — os oito vivos do recon

`produtos-rel-2.service.ts` (mesma rota, `tipo` novo; multi-empresa como o `GetMultiEmpresa`: as marcadas, recortadas às do operador).
Smoke §264 (7 checks). Cada relatório com a regra do legado e o que foi decidido diferente:

- **15 Estoque × vendas no período** — venda bruta (IAT 'A' arredonda, os demais truncam), unitários médios do período, quantidade
  vendida NULA sem venda, a **seção filtra só a venda** (a lista segue inteira), estoque em valor só quando positivo (SEM_INCIDENCIA).
  Divisão por zero protegida (o legado daria ORA-01476; nunca aconteceu).
- **6 Estoque por data** — o `saldo_novo` (QTDE_ATUAL) do último movimento do HISTORICO_PROD até 23:59:59, a custo/venda atuais,
  arredondado a 2 casas como o CAST do legado; o filtro de saldo sempre vale (padrão "> 0" esconde os negativos e o produto sem
  movimento). Desempate no mesmo instante pelo código do movimento (o legado casa por DATA sem empresa; sem colisão na produção).
- **18 Mix estoque × loja** — a empresa do login é o CD; lista o que ele tem (> 0) e a loja marcada não (≤ 0), com as lojas juntas.
  O legado encadeia o ESTOQUE do CD no ESTOQUE_DEP (sem a linha do depósito o produto some): aqui cada um conta por si.
- **19 Mix estoque × giros** — o estoque medido no CD (login), o "sem giro" em cada empresa marcada — **mantido como o legado**: é a
  mesma leitura do 18 (CD × lojas), não um defeito. "Última execução do giros" = PROCESSOS.GIROS.
- **11 Lotes e validades** — NF_PROD_LOTE das NF de entrada; o 2º ramo (LOTE_PRODUTO_VALIDADE, morto) fica de fora; lote de NF
  cancelada aparece como no legado, **marcado**; as descrições de família não dependem da linha de ESTOQUE nem da empresa da família.
- **9 Percas** — o SQL do `FDqPercas` inteiro: perca pelo custo gravado, entradas (NF de compra × fator + AUMENTAR), saídas (NF de saída
  fora de 5929/6929 × fator + giro + DIMINUIR), saldo inicial do balanço nº 1, % = perca ÷ entradas. A grade/impressão do legado estão
  meio quebradas no fonte (dataset desligado); aqui a grade e a impressão mostram tudo.
- **1 Lista para conferência** — a folha de contagem por empresa e fornecedor com as duas colunas em branco (a impressão da tela).
- **14 Inativos em agenda** — o item de agenda desativado, todo o histórico, preço da empresa do login.
- **17 Produtos por fornecedor** (corte-2b, §265) — o produto sob o emitente da ÚLTIMA nota de entrada, com código/descrição NA
  nota, custo, fator, quantidade e data, vendido desde, estoque atual e na entrada. Redesenhado onde a conta do legado erra: última nota
  pela data e por empresa (o MAX(CODNF) do legado erra 4,4%); estoque na entrada = o saldo que o kardex gravou naquela nota (o legado
  faz atual − vendido, sinal trocado, 0 sem venda; 94% das entradas de uma semana de set/2026 têm o movimento no kardex); vendido desde
  = giro da mesma empresa (o legado soma todas e conta duas vezes as NF de saída que o giro já inclui).

**Correção do filtro de ativo (corte-2b):** o `cbbAtivo` tem 7 opções (Todos + ativos/inativos p/ compra, p/ venda, p/ os dois) e lê a
MULTI_PRECO quando a config ATIVO_PELA_MULTIPRECO é 'S'. Na produção ela é 'N' na base e **'S' no override "Modulo / Todos"** — o recon
que leu só a base concluiu "pelo produto", e o corte-2 saiu assim. Agora o `ConfigService` resolve o override e as 7 opções estão na tela.
Vale também para os relatórios do corte-1 (estoque atual, ruptura, análise), que liam `coalesce(PRODUTOS.ATIVO, 'S')` e abriam em "Só ativos" — o
legado abre em "Todos" (config REL_PRODUTOS_DEF_ATIVO_COMPRA_VENDA) e lê a MULTI_PRECO; o §108.4 dizia "o ativo é do cadastro" e foi corrigido.

**Achado colateral: a MOVIMENTACAO_DIARIA não era regenerada no Apollo.** O giro (19), a perca (9) e o DDE leem a tabela que o
processo GIROS do legado refaz todo dia (`GERA_MOVIMENTACAO_DIARIA`, fórmula conferida em 100% das linhas de 5 janelas). Virou rotina
do `rotinas-do-banco.agendador.ts` (mig 378, smoke §263) — ver `procedures-do-banco.md`.

## 8. Corte 3 (05/10/2026) — o núcleo `FDqProdutos` para 0, 3 e 4

`produtos-rel-2.service.ts` `nucleo()` (o corte-1, `produtos-rel.service.ts`, foi aposentado: os treze relatórios estão num serviço só).
PRODUTOS ⟕ MULTI_PRECO (empresas marcadas) ⟕ ESTOQUE B ⟕ ESTOQUE_DEP DE (mesma empresa) ⟕ FAMILIAS_PROD C/D/E pelo código (sem o tipo)
⟕ PARCEIROS ⟕ última venda de balcão (PEDIDOS) ⟕ EMPRESAS. O `FormataEstoque`:

| relatório | `rgDisponivelEm` | QTDE | TOTALCUSTO / TOTALVENDA |
|---|---|---|---|
| 0 análise | invisível (`StrToEnum(…) > 0` — o índice 0 é a própria análise) → SEM_INCIDENCIA | loja | (loja + depósito) × preço, só se > 0 |
| 3 ruptura | invisível → SEM_INCIDENCIA | loja | idem |
| 4 estoque atual | Todos / Estoque / Depósito | a escolhida | a escolhida × preço, só se > 0 |

Ordem: análise (e lista) `M.IDEMPRESA, P.RAZAO, A.DESCRICAO`; os demais `M.IDEMPRESA, A.CODFOR, P.RAZAO, A.DESCRICAO`. O estoque atual
traz o `QrySubConsulta` (o mesmo recorte por departamento; sem departamento = −999999 "PRODUTO COM DEPARTAMENTO NÃO DEFINIDO").
Filtros habilitados por relatório = o `cbbTipoRelCloseUp` (a tela mostra só esses).

## 9. A impressão (corte 4) — os 13 layouts do cliente

`GET relatorios/produtos/impressao` (mesmos filtros + `expandido`) → `{titulo, modelo, datasets, variaveis, textos?}`; a tela imprime pelo
motor do FastReport (`imprimirRelatorio`). Arquivo e dataset (UserName do TfrxDBDataset do `UDMProdutosRel`/`uProdutosRel`) por relatório:

| relatório | layout (PERSONALIZADO da produção) | dataset |
|---|---|---|
| 0 análise | `prod_Posicao_estoque_produtos.fr3` (894) | frxDataSetProdutos + frxDatasetEmpresas |
| 1 lista | `prod_Lista_Conferencia.fr3` (891) | frxDataSetProdutos (RAZAO = fornecedor) |
| 3 ruptura | `prod_Posicao_Estoque_Dep_produtos.fr3` (893) | frxDataSetProdutos |
| 4 estoque atual | `Rel_Posicao_Estoque.fr3` (996) | frxDBDatasetEstoque + **dbdSubConsulta** (a 2ª página: resumo por departamento) |
| 6 por data | `Rel_Posicao_Estoque_Por_Data.fr3` (999) | frxDBDProd |
| 9 percas | `Rel_ProdutosPercas.fr3` (1007) | frxDBDPercas |
| 11 lotes | `Rel_Prod_Lotes_Validades.fr3` (1011) | frxDBDPrdutosLoteVal (ordenado DTVALIDADE;DESCRICAO — o `IndexFieldNames` do script) |
| 13 alterações | `Alteracoes_preco.fr3` (638) | FrxRelGeral (DATA no fuso da loja; valores como o TEXTO gravado) |
| 14 inativos | `Relatorio_Produtos_Inativos.fr3` (924) | dbdRelProdAtivo; o memo "Empresas" = "Empresa: <login>" |
| 15 × vendas | `Rel_Posicao_Estoque_Vendas_Periodo.fr3` (1001) | FrxRelGeral (DESCDEPTO) |
| 17 por fornecedor | `ProdutosPorFornecedor.fr3` (885) | dbdConsulta + dbdEmpresa (ULT_CODNF = o CODNF, como o legado, sob o título "Ult.NroNF") |
| 18 / 19 mix | `ProdComparativoMixEstoqueXLoja/XGiros.fr3` (879/878) | dbdConsulta (LOJA_SEM_ESTOQUE / RAZAOSOCIAL) |

Variáveis: FILTRO (texto do cmbFiltro — **o legado concatena um "7" perdido**, `cmbFiltro.Text + '7 '`, que não foi reproduzido), EMPRESAS
("1,2"), DEP_ESTOQUE, EXPANDIDO, RELATORIO; no 6, **SALDO/CUSTO/VENDA e TOTSALDO/TOTCUSTO/TOTVENDA são expressões** da coluna do
rgDisponivelEm (`<frxDBDProd."QTDE_ESTOQUE">`, `<SUM(…,MasterData1)>`) — o motor passou a reavaliar a variável-expressão a cada uso; no
11, FORNECEDOR/DEPTO/GRUPO/SUBGRUPO pelo nome ou "Todos". A lista: o legado mexe no `GroupHeader1` antes de imprimir (DrillDown = não
expandido) — aqui o mesmo no XML. As alterações: o script do layout faz `GroupHeader1.ExpandDrillDown := <EXPANDIDO> = 'S'` — o motor
deixava o `ExpandDrillDown="True"` gravado vencer o script (corrigido). Sem registro: só o 9 ("Não foi encontrado movimentação para esse
período.") e o 11 ("Não foram encontrados lotes…") avisam; os outros imprimem a folha vazia, como o legado.

Cobertura: smoke §108.7; web `relatorio-fr3.spec.ts` (os 13 layouts).

## 10. O que falta

Nada: o "salvar layout" das grades do legado é o layout salvo da grade do Apollo (gradeLayoutService), já presente.

✅ **exportar a grade** foi implementado (CSV com `;` e BOM UTF-8, o que está na tela e já filtrado).
