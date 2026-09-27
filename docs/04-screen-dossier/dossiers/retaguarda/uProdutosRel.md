# RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — recon, corte-1 e corte-2

`uProdutosRel.pas` (2.687) + `.dfm` (3.640) + `UDMProdutosRel` (410 + 3.699) + três grades auxiliares
(`Grid`, `ListaConferenciaGrid`, `PercasGrid`). **~10.900 linhas.** 162 acessos, 19 operadores.

## 1. ⚠️ Isto é um épico, não uma tela

**⚠️ Correção (25/09/2026): o combo tem 21 itens, não 15** (`uProdutosRel.dfm`:1033-1054), e **quatro dos "mortos" estavam vivos** —
a medição de 15/09 olhou a tabela errada. Recon completo, na produção e só leitura, com a SQL de cada item: seis relatórios (15-20) nem
constavam aqui. A numeração abaixo é o `ItemIndex` (base 0) do Pascal.

| ItemIndex | relatório | substrato na produção (25/09/2026) | Apollo |
|---|---|---|---|
| 0 | Relatório para análise | ESTOQUE + MULTI_PRECO | ✅ corte-1 |
| 1 | Lista para conferência | ESTOQUE (emp 1: 10.926 ≠ 0; emp 2: 5.717) | ✅ corte-2 (a folha de contagem com as colunas em branco) |
| 2 | Receitas | RECEITA_PROD 86 linhas / 10 produtos; a página de receitas **não tem provider** no fonte (resíduo DBX→FireDAC) | 🪦 marginal e quebrado |
| 3 | Ruptura na loja | ESTOQUE | ✅ corte-1 |
| 4 | Estoque atual | ESTOQUE | ✅ corte-1 |
| 5 | Análise pedido | PEDIDOS: 53 linhas em 2026 (a metade "venda" morta; a de estoque/custo = item 0) | 🪦 marginal |
| 6 | Estoque por data | ~~HISTORICO_PROD_DEP 19 linhas~~ → **HISTORICO_PROD 14,7 M**, último de hoje; o último saldo bate com ESTOQUE em 100% | ✅ corte-2 |
| 7 | Estoque saldo | substrato vivo, **relatório falho** (o HAVING por dia descarta 87% das saídas; saldo inicial fixo no balanço de 2020 com empresa 0; filtros dão ORA-00979) | ⛔ não converter fiel — o 6 dá o saldo na data certo |
| 8 | Troca de mercadorias | lê PARCEIROS (não ESTOQUETROCA): REALIZA_TROCA 'S' em 94%, OBS_TROCA 0, lista repetida por produto | 🪦 morto |
| 9 | Percas | ~~"sem tabela"~~ → **SCRAP 3.795 / SCRAP_ITEM 133.613**, último de hoje | ✅ corte-2 |
| 10 | Venda externa | nenhum produto ATACADO = 'S' (os 1.277 NULL saem "ATACADO") | 🪦 marginal |
| 11 | Lotes e validades | ~~LOTE_PRODUTO_VALIDADE 1 linha~~ → **NF_PROD_LOTE 132.166 lotes** (2.979 vencem até 31/12/2026) | ✅ corte-2 |
| 12 | Preço 2 | 10 produtos (47 linhas) | 🪦 marginal |
| 13 | Alterações de preço | HISTORICO_DINAMICO 97.977 | ✅ corte-1 |
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

## 3. As quinze comparações do `cmbFiltro` — e a armadilha do mínimo em branco

As quatro de **sinal** são exatas: negativa, zerada, maior que zero, negativa ou zerada.

As dez de **mínimo/máximo** comparam contra `coalesce(minimo, 0)`. Num cadastro sem mínimo elas viram
comparações contra **zero**: "igual ao mínimo" traz junto todo produto **zerado** com mínimo em branco, porque
`0 = 0`. Não é defeito da consulta — é o cadastro. Em produção **4 produtos têm mínimo** e **2 têm máximo**,
em 203.546 linhas. As dez comparações existem e funcionam, mas neste cliente medem quase nada; é por isso que
a **ruptura** é o corte que interessa.

## 4. Ruptura é falta COM tempo

Zerado ou negativo já é falta. O que decide a ação é **há quantos dias não vende** (`estoque.dtvenda`): é a
diferença entre "acabou porque vende muito" e "acabou e ninguém sentiu falta". O corte em dias é do operador.

## 5. Alterações de preço — o relatório que sobrou dos doze

Lê o `historico_dinamico`, onde toda mudança de `VRVENDA` fica registrada: quem mudou, quando, de quanto para
quanto. **97.977 registros em 15.471 produtos**, de 07/08/2020 a 15/09/2026 — o último no dia desta medição.

É o relatório que responde *"por que este produto está com esse preço"* — e, quando o preço saiu errado, quem
o colocou lá. A variação vem em reais e em percentual, e a alteração de **custo** não entra: o relatório é de
preço.

Alteração vinda de rotina (lote de preço, carga) não tem operador, e a coluna mostra isso em vez de inventar
um nome.

## 6. Cobertura (§108 do smoke, 5 checks)

1. as comparações de sinal exatas, e a armadilha do mínimo em branco explicada com número;
2. ruptura com e sem corte de dias;
3. a análise pondo dinheiro na posição (30 × 5,00 = 150,00 parados, margem 50%);
4. o "ativo" é do **cadastro**, não do estoque — produto inativo com 7 em estoque existe e precisa ser achado
   antes do inventário;
5. as alterações de preço, com variação em reais e em percentual, e a alteração de custo ficando de fora.

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

**Achado colateral: a MOVIMENTACAO_DIARIA não era regenerada no Apollo.** O giro (19), a perca (9) e o DDE leem a tabela que o
processo GIROS do legado refaz todo dia (`GERA_MOVIMENTACAO_DIARIA`, fórmula conferida em 100% das linhas de 5 janelas). Virou rotina
do `rotinas-do-banco.agendador.ts` (mig 378, smoke §263) — ver `procedures-do-banco.md`.

## 8. O que falta

Salvar/carregar layout; o `rgDisponivelEm` (qual das três
colunas de saldo o 6 imprime — a API devolve as três).

✅ **exportar a grade** foi implementado (CSV com `;` e BOM UTF-8, o que está na tela e já filtrado).
