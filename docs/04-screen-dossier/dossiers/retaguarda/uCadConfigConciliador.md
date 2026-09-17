# FRMCADCONFIGCONCILIADOR — Configurador de conciliação de cartões

**82 acessos · 6 operadores · último acesso 12/05/2026.** Menu: *Movimentação financeira → Configurador de
conciliação de cartões*. Migration **230**. API `cadastro/config-conciliador`. Tela `/cadastro/config-conciliador`.

## 1. O que a tela faz

Cada operadora de cartão manda a sua planilha de um jeito. Esta tela guarda o **layout** de leitura: em que
linha os dados começam, que coluna é a data da venda, qual é o valor bruto, onde está o NSU — e, o que mais
importa, **por qual chave casar** cada linha com a venda de cartão do sistema.

Sem ela, a conciliação de cartões não tem como ler arquivo nenhum.

## 2. ⚠️ Procedência — a tela não veio no fonte

Não existe `uCadConfigConciliador` no repositório clonado: **zero ocorrências** de `CadConfigConciliador` e de
`CONFIG_IMPORT_CONCILIADOR` em todo o `retaguarda-master`. É o quinto caso (com Borba Fiscal, Controle Mobile,
Precificação Prod e a variante `FRMINTEGRACAOLOTEFGFAPI`).

A diferença é que aqui **o dado é legível por inteiro**, e foi dele que a regra saiu — o mesmo método que
reconstruiu o motor da integração contábil:

- os **7 layouts** e os **40 itens** da produção;
- as **245.984 linhas** de `ITENS_MANCARTAO` que esses layouts produziram.

## 3. Que o mecanismo está vivo, o dado prova

| medida | valor |
|---|---|
| linhas em `ITENS_MANCARTAO` | **245.984**, **todas** com `TIPOCONCILIADOR = 'CONFIGURAVEL'` |
| período | 03/06/2024 → **03/05/2026** |
| casadas com uma venda | **243.420 (98,96%)** |
| último layout criado | **30/12/2025** (`REDE VENDAS`) |
| layout mais antigo, última alteração | 17/03/2025 (`REDE`, criado em 26/10/2023) |

Não é tela que alguém abre e fecha: é cadastro que se mantém.

## 4. Os 7 layouts do cliente

| id | descrição | linha inicial | casa por |
|---|---|---|---|
| 81 | REDE | 3 | NSU + autorização |
| 102 | ALELO ALIMENTAÇÃO | 2 | autorização |
| 121 | VENDAS | 3 | data + estabelecimento + valor |
| 141 | VENDAS TESTE | 3 | data + estabelecimento + valor |
| 161 | SODEXO | 14 | autorização |
| 184 | VR | 30 | autorização |
| 222 | REDE VENDAS | 3 | NSU + autorização |

As linhas iniciais 14 e 30 são o tamanho do cabeçalho que a operadora põe antes dos dados.

## 5. O item: uma coluna da planilha → um campo de `ITENS_MANCARTAO`

Quatro tipos, e a contagem é a da produção: **`Texto` (23) · `Data` (9) · `Valor` (5) · `Fixo` (3)**.

⚠️ **`Fixo` não tem coluna.** O valor vem do cadastro, não do arquivo — é assim que SODEXO, VR e REDE VENDAS
informam o código do estabelecimento, que a planilha deles não traz (`37.954.975/0002-40`, `162841900027`,
`85150371`).

## 6. As invariantes, todas medidas nos 7 layouts / 40 itens

| regra | medição |
|---|---|
| item `Fixo` tem valor e **não** tem coluna | 3 de 3 |
| item de coluna tem coluna e **não** tem valor fixo | 37 de 37 |
| `dd/MM/yyyy` só em item `Data` | 9 de 9; os outros 31 com formato nulo |
| um campo não se repete no layout | **0** casos |
| uma coluna não alimenta dois campos | **0** casos |
| `CODESTABELECIMENTO`, `VRBRUTO`, `DTVENDA`, `AUTORIZACAO` presentes | **7 de 7** layouts, cada um |
| ao menos uma chave de casamento ligada | 7 de 7 |
| descrição única | 7 de 7 |
| `CICI_TAMANHO` trunca | usado 1 vez (o NSU da REDE, em 8) |
| `CICI_CASAS_DECIMAIS` | **nunca** usado |
| `CICI_TABELA` nula · `CICI_VALOR_FORMATADO` = 'S' | 40 de 40 cada — colunas que o legado tem e não usa |

Todas essas regras vivem no `configConciliadorSchema` do pacote compartilhado, então a tela as aplica enquanto
o operador digita e o servidor as reaplica na porta.

## 7. Divergências conscientes

- **A coluna é gravada em maiúscula.** O operador digita `k`, fica `K`. Os 40 itens do cliente estão em
  maiúscula; normalizar evita que `k` e `K` passem pela unicidade como se fossem colunas diferentes.
- **Editar o layout reescreve o mapa inteiro** (apaga os itens e regrava). Trocar um campo de coluna é mudar o
  mapa, não editar uma linha — e assim não sobra item órfão.
- ⚠️ **O layout que já importou não é apagado.** As 245.984 linhas guardam a **descrição** do layout em
  `ITENS_MANCARTAO.DESCRICAO`; apagá-lo deixaria o histórico sem dizer por qual mapa a linha entrou. O que
  nunca importou sai normalmente, levando os itens junto (`ON DELETE CASCADE`).
- **Os domínios de tipo de arquivo e separação** trazem mais opções do que o cliente usa (`TEXTO`,
  `POSICAO FIXA`, `DELIMITADO`) porque as colunas do legado existem para isso — `CICI_TAMANHO` só faz sentido
  em arquivo posicional. Hoje os 7 layouts são todos `EXCEL` / `COLUNAS EXCEL`.

## 8. O que fica para o próximo corte

A **importação em si** e o casamento com a venda: ler a planilha pelo layout, gravar em `ITENS_MANCARTAO` e
achar o `CODVENDCARTAO` por uma das quatro chaves. A tabela destino já está no destino (migration 230) e no
plano de carga; o que falta é o motor que a preenche.
