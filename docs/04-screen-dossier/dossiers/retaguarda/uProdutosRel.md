# RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — recon e corte-1

`uProdutosRel.pas` (2.687) + `.dfm` (3.640) + `UDMProdutosRel` (410 + 3.699) + três grades auxiliares
(`Grid`, `ListaConferenciaGrid`, `PercasGrid`). **~10.900 linhas.** 162 acessos, 19 operadores.

## 1. ⚠️ Isto é um épico, não uma tela

**Quinze relatórios num combo só** (`cbbTipoRel`), servidos por **21 datasets**. Contados antes de começar,
para não repetir o erro da Precificação NF:

| # | relatório | substrato medido na produção (15/09/2026) | feito |
|---|---|---|---|
| 1 | Relatório para análise | `estoque` + `multi_preco` | ✅ |
| 4 | Ruptura na loja | `estoque` | ✅ |
| 5 | Estoque atual | `estoque`: 203.546 linhas, **4.121 negativos** | ✅ |
| 14 | **Alterações de preço** | `historico_dinamico`: **97.977 registros, 15.471 produtos**, o último de hoje | ✅ |
| 8 | Estoque saldo | `estoque` — variação do nº 5 | |
| 2 | Lista para conferência | grade própria | |
| 6 | Relatório para análise pedido | `pedidos` | |
| 11 | Estoques - Venda Externa | | |
| 3 | Receitas | `receita_prod`: **86 linhas** | 🪦 marginal |
| 13 | Produtos com preço 2 | `multi_preco.vrdescpreco2`: **38 produtos** | 🪦 marginal |
| 7 | Estoque por data | `historico_prod_dep`: **19 linhas** | 🪦 morto |
| 12 | Lotes e validades | `lote_produto_validade`: **1 linha** | 🪦 morto |
| 9 | Troca de mercadorias | `estoquetroca`: **0 linhas** | 🪦 morto |
| 15 | Inativos em agenda de promoções | **0** produtos inativos com promoção | 🪦 morto |
| 10 | Percas | grade própria; sem tabela `percas` no banco | 🪦 sem substrato |

**O placar importa mais que a contagem.** Dos quinze, quatro estão entregues e **sete estão mortos ou
marginais neste cliente** — somados, 144 linhas de dado. Os quatro que sobram (estoque saldo, lista para
conferência, análise de pedido e venda externa) valem um corte-2 quando alguém pedir; os sete mortos não
valem nenhum, e ter medido isso é o que evita gastar uma sessão inteira com eles.

O corte-1 entregou os três do núcleo de estoque; o corte-2 acrescentou o de **alterações de preço**, que era
o único vivo entre os doze restantes.

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

## 7. O que falta

Os **quatro relatórios vivos** que sobraram no §1 (estoque saldo, lista para conferência, análise de pedido,
venda externa) — os sete mortos não entram —, mais: salvar/carregar layout, o `rgDisponivelEm` (disponibilidade por loja), o
`rgPercas` e as três grades auxiliares.

✅ **exportar a grade** foi implementado (CSV com `;` e BOM UTF-8, o que está na tela e já filtrado).
