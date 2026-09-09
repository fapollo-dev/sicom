# CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) — recon e corte-1

`uConsultoriaATM.pas` (1.240 linhas). 440 acessos no cliente.

## 1. A tela não tem lista de relatórios

Ela **varre o disco**: monta o combo com os arquivos `Relatorios\at&m_*.fr3` que encontrar
(`uConsultoriaATM.pas:389`), tira o prefixo e a extensão e mostra o que sobrou. Em produção existem **15
layouts distintos** (30 linhas em `RELATORIOS`, cada um em DEFAULT e PERSONALIZADO):

| tema | layouts |
|---|---|
| participação dos setores | 4 (+ 2 gráficos) |
| participação de seções | 2 |
| participação de grupos | 2 |
| rentabilidade da família | 3 (cheia, simplificada, totais) |
| ranking geral por famílias | 1 |
| faturamento × rentabilidade | 1 |

**Todos giram em torno da mesma coisa**: participação e rentabilidade por nível da árvore de famílias. Por
isso o corte-1 não porta "um relatório" — porta **o cálculo**, parametrizado pelo nível.

## 2. A árvore, medida em produção

`FAMILIAS_PROD.TIPO`: **D** departamento (34) · **G** grupo (92) · **S** seção (520) · P (1.817, o produto) ·
E/O/R (8 no total). E `PRODUTOS` aponta para os três níveis: `CODDPTO`, `CODGRUPO`, `CODSUBGRUPO` — 21, 93 e
481 valores distintos em uso. Um único `GROUP BY` trocando o campo cobre setor, grupo e seção.

## 3. As contas do legado (`ParticipacaoSetor`, `:469-560`)

| conta | regra |
|---|---|
| acréscimo | só a parte **positiva** de `DESC_ACRE_MEDIO` e `DESC_ACRE_ITEM` |
| desconto | `DESC_PROMOCAO + DESC_DEPARTAMENTO` **mais** a parte negativa daqueles dois, invertida |
| venda | `QTDE × VRVENDA` — **arredonda** se o item é por peso (`IAT = 'A'`), **trunca no centavo** se não |
| custo | `QTDE × VRCUSTO` |
| resultado | venda + acréscimo − desconto |
| lucro | resultado − custo |
| **rentabilidade** | lucro / **custo** × 100 — sobre o custo, não sobre a venda |
| cupons | `NROPEDIDO` distintos |

⚠️ **o truncamento**: `TRUNC(x × 100) / 100` no item por unidade é o que faz o relatório fechar com o PDV.
No teste isso se prova pela **quantidade** (3 casas), não pelo preço — `VRVENDA` é `numeric(15,2)` no
destino, então um preço de três casas nem chega a ser gravado. Foi o que me pegou ao escrever o smoke.

**A participação é nossa.** O legado a calcula dentro do `.fr3`; sem ela, a tela chamada "participação de
setores" não mostraria participação nenhuma.

## 4. O que fica

O modo **"Vendas e Notas Fiscais"** (`rdgPesquisa = 1`), que faz UNION com `NF_PROD` para somar o que saiu por
nota; os dois layouts de **gráfico**; e a **previsão** (`PREVISAO`), que é epic próprio.
