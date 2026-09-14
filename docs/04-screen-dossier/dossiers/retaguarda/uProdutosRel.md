# RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — recon e corte-1

`uProdutosRel.pas` (2.687) + `.dfm` (3.640) + `UDMProdutosRel` (410 + 3.699) + três grades auxiliares
(`Grid`, `ListaConferenciaGrid`, `PercasGrid`). **~10.900 linhas.** 162 acessos, 19 operadores.

## 1. ⚠️ Isto é um épico, não uma tela

**Quinze relatórios num combo só** (`cbbTipoRel`), servidos por **21 datasets**. Contados antes de começar,
para não repetir o erro da Precificação NF:

| # | relatório | substrato medido na produção (14/09/2026) | corte-1 |
|---|---|---|---|
| 1 | Relatório para análise | `estoque` + `multi_preco` | ✅ |
| 2 | Lista para conferência | grade própria | |
| 3 | Receitas | `receita_prod`: **86 linhas** | |
| 4 | Ruptura na loja | `estoque` | ✅ |
| 5 | Estoque atual | `estoque`: 203.546 linhas | ✅ |
| 6 | Relatório para análise pedido | `pedidos` | |
| 7 | Estoque por data | `historico_prod_dep`: **19 linhas** — praticamente morto | |
| 8 | Estoque saldo | `estoque` | |
| 9 | Troca de mercadorias | `estoquetroca` | |
| 10 | Percas | grade própria | |
| 11 | Estoques - Venda Externa | | |
| 12 | Lotes e validades | | |
| 13 | Produtos que possuem preço 2 | `URelProdutosPreco2` | |
| 14 | Alterações de preço dos produtos | `historico_dinamico` | |
| 15 | Produtos inativos em agenda de promoções | `promocao_acumulativa` | |

O corte-1 entrega os **três que compartilham o mesmo núcleo** — a posição de estoque. Os outros doze estão
acima com o substrato de cada um, para o próximo corte ser escolhido por valor e não por ordem de combo.

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

## 5. Cobertura (§108 do smoke, 4 checks)

1. as comparações de sinal exatas, e a armadilha do mínimo em branco explicada com número;
2. ruptura com e sem corte de dias;
3. a análise pondo dinheiro na posição (30 × 5,00 = 150,00 parados, margem 50%);
4. o "ativo" é do **cadastro**, não do estoque — produto inativo com 7 em estoque existe e precisa ser achado
   antes do inventário.

## 6. O que falta

Os **doze relatórios** do §1, mais: salvar/carregar layout, o `rgDisponivelEm` (disponibilidade por loja), o
`rgPercas` e as três grades auxiliares.

✅ **exportar a grade** foi implementado (CSV com `;` e BOM UTF-8, o que está na tela e já filtrado).
