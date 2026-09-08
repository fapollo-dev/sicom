# INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — recon e plano de cortes

Decisão do usuário (08/09): migrar por completo. Fontes: `uTron.pas` (2.615 linhas, a tela),
`UIntegracaoContabil.pas` (4.616, o motor) e o dado de **produção**.

## 1. O que a tela é

Um exportador contábil com **15 origens** num radio group (`btnExportarClick`, `:2101-2117`) — notas fiscais,
contas a pagar/receber, cinco tipos de baixa, fechamento de caixa, Redução Z, transferências, três cadastros e
NFC-e — mais um **estornar** (`:2128-2384`).

Apesar do nome "exportar", **não gera arquivo**: cada origem instancia uma classe de `UIntegracaoContabil` e
grava partidas em **`DIARIO`** via `LancaDiarioContabil`; o estorno é `DELETE FROM DIARIO` pela origem/documento.
É o mesmo motor que o corte F5b já portou para a nota fiscal.

Dois gates, e nenhum deles é o fechamento diário:
- `TIntegracaoContabil.PeriodoFechado` (`UIntegracaoContabil.pas:282`) compara a data com
  `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` — **NULL em produção**, ou seja não bloqueia hoje;
- multi-empresa: **corrigido no corte-1** — `:2068` não restringe as origens 3-7 e 10-13 à empresa corrente,
  ele apenas as deixa FORA do seletor de empresas. O SQL delas não filtra empresa nenhuma: varrem o banco
  inteiro e tiram o `IDEMPRESA` de cada lançamento da própria linha (o razão do cliente tem lançamentos de
  cartão nas empresas 1 e 2 — e 19 linhas com `CODEMPRESA = 51`, que é um CODORIGEM gravado no lugar errado).

## 2. O que o cliente REALMENTE usa (`DIARIO` por origem, produção)

| cod | origem | linhas | em 2026 | situação no Apollo |
|---|---|---|---|---|
| **61** | baixa de cartões — **taxas** | **1.200.524** | 44.817 | ✗ |
| 17 | fechamento de caixa | 117.612 | 16.071 | ✓ (contabilizar do caixa) |
| **62** | baixa de cartões — outras despesas | 110.053 | 7.576 | ✗ |
| 12 | notas fiscais | 78.207 | 13.447 | ✓ **F5b** |
| 67 | NFC-e | 73.925 | 11.123 | PDV — fora de escopo |
| **15** | baixa de contas a pagar | 47.795 | 7.274 | ✗ |
| **16** | baixa de contas a receber | 35.689 | 2.818 | ✗ |
| **51** | baixa de cartões | 31.400 | 7.036 | ✗ |
| 19 | transferências entre contas | 17.581 | 94 | ✗ |
| 65 | agrupamento de convênio | 15.119 | 231 | ✗ |
| 64 | movimentação do caixa | 7.261 | 234 | ✗ |
| 14 | contas a receber (cadastro) | 6.710 | 253 | ✗ |
| 13 | contas a pagar (cadastro) | 3.935 | 150 | ✗ |
| 66 | importação | 1.166 | 58 | ✗ |
| 55·57·63·54·58 | juros, acréscimos, descontos, adiantamento | 2.425 | 417 | ✗ |
| 18 | Redução Z | **0** | 0 | `REDUCAOZ` está vazia |

Último lançamento gravado: **18/08/2026**. A integração está viva e é o maior consumidor do diário
(1,75 milhão de linhas no total).

**A leitura que importa:** o volume não está onde a intuição diz. **Baixa de cartões (61+62+51) é 1,34 milhão de
linhas — 77% de tudo**, com 58.879 lançamentos só em 2026. Fechamento de caixa e nota fiscal, que já temos, são
os dois seguintes.

## 3. Plano de cortes (por uso, não por ordem de tela)

1. **corte-1 — BAIXA DE CARTÕES** (61 · 62 · 51): o maior volume de longe. Três origens que saem de um mesmo
   fluxo (a baixa do cartão, suas taxas e as outras despesas).
2. **corte-2 — BAIXAS DE AP e AR** (15 · 16) mais os acessórios de cada uma (53-58: juros, acréscimos,
   descontos) — 86.958 linhas somadas.
3. **corte-3 — CADASTRO de CP e CR** (13 · 14), **transferências** (19), **movimentação do caixa** (64),
   **adiantamento** (63) e **agrupamento de convênio** (65).
4. **estorno** — vale para todas as origens; entra junto do corte-1 e é ampliado a cada um.
5. **fora**: NFC-e (67) é PDV; Redução Z (18) não tem dado; importação (66) precisa de recon próprio.

## 4. O que já está pronto e serve de base

O `NfContabilizacaoService` (F5b, fases 1-4) já implementa o núcleo: resolução de conta por
`ITENS_INTEGRACAO_CONTABIL` (tipo 'F' fixa / 'A' automática), partida dobrada em `diario`, idempotência por
`(codorigem, idorigem)`, estorno por `DELETE`, e o bloqueio de período contábil. **Os cortes acima reusam esse
motor** — o que muda por origem é de onde vem o valor e qual par de contas.

## 5. Corte-1 ENTREGUE — baixa de cartões (`mig 199`, smoke §92, 1060/0)

### 5.1 O motor, reconstruído do razão

`LancaDiarioContabil` mora em `FuncoesApollo`, que **não veio no fonte clonado** — o mesmo buraco que a F5b
enfrentou na nota. Reconstruído em `integracao-contabil.motor.ts` a partir de 1,34 milhão de linhas do razão
do cliente cruzadas com a `ITENS_INTEGRACAO_CONTABIL`. Duas regras, as duas medidas:

1. **O FORMATO sai do `CODHISTORICO`.** Pernas com o mesmo histórico ⇒ UMA linha balanceada; históricos
   diferentes ⇒ DUAS linhas, cada uma com um lado só e o seu histórico.

   | situação | hist D / C | linhas no razão | balanceadas | só-débito | só-crédito |
   |---|---|---|---|---|---|
   | 894 despesas | 96 / 96 | 110.053 | **110.053** | 0 | 0 |
   | 895 taxas | 96 / 96 | 1.200.524 | **1.200.524** | 0 | 0 |
   | 893 baixa | **94 / 95** | 31.400 | **0** | 15.700 | 15.700 |
   | 2009 baixa AR | 92 / 93 | 35.689 | 0 | 17.619 | 18.070 |
   | 2004 baixa AP | 91 / 221 | 47.795 | 0 | 42.147 | 5.415 |
   | 910 convênio | 104 / 105 | 15.119 | 0 | 30 | 15.089 |

   (Há 5 situações pequenas fora do padrão — 464, 1190, 500, 463, 11 — todas de origens que não migramos.)

2. **A conta da perna `TIPO='A'` sai do dataset** (o "substitui pelo dataset"). Na 895 o crédito é automático
   e o `CONTACREDITO` bate com o `CONTAS_BANCARIAS.CODLANCCONTABIL` da forma de pagamento em **1.200.523 de
   1.200.523** linhas — três contas distintas (213, 557, 211), nenhuma fixa.

### 5.2 O que o corte-1 entregou

- **`CONFIG_INTEGRACAO_CONTABIL`** (60 colunas, a config de instalação inteira — as outras origens leem daqui).
- **`cartao.valor_outras_despesas_paga`**: o terceiro valor da baixa, que faltava, e que decide a origem 62.
- **`mov_contas_bancarias.idlote`**: o elo entre o lote de cartões e o crédito no banco — 204.904 linhas
  preenchidas no cliente e **fora da nossa carga até agora**. O `cartao-baixa.service` passa a carimbá-la.
- **`diario.documento`**: preenchida em 1.749.372 das 1.749.402 linhas do razão e ausente do destino.
- As três origens: **51** (um lançamento por LOTE, pelo líquido), **61** e **62** (um por CARTÃO que tenha
  taxa / outras despesas), o **estorno** das três (por período, como a tela faz, ou por lote) e a prévia.
- Gates copiados: chaveamento de período (`<=`, e NULL não bloqueia), centro de custo obrigatório na taxa e
  nas outras despesas, conta contábil da conta bancária, `M.VALOR > 0` na movimentação, "devolução de cheque"
  fora, lote sem os dois lados aborta a integração inteira.
- Quirk copiado com prova: o **`IDORIGEM` do lançamento principal sai do cartão em que o cursor do legado
  parou** — o último do lote quando não houve rateio, o primeiro quando o resíduo do `AjustaValores` foi
  aplicado. No cliente: 10.105 lançamentos com o último, 6.721 com o primeiro.

### 5.3 Achados e divergências registradas

- ⛔ **`DIARIO.CODCC` não entra**: existe no legado e está preenchida em **0 de 1.749.402** linhas. O centro de
  custo só serve para resolver a conta quando a perna é automática, e para o gate.
- ⛔ **`LOTE_CONTABIL` está VAZIA no cliente** — o `DIARIO.CODLOTE` é só um número de sequência por lançamento.
  Mantemos o cabeçalho porque as contabilizações já migradas o gravam e a nossa `diario.codlote` tem FK.
- ⚠️ **multi-empresa**: rodamos na empresa do tenant, o legado varre todas. Separa 23 lotes que hoje misturam
  duas empresas; nenhum valor se perde, a partição é outra.
- ⚠️ **`AjustaValores` é inócuo no razão deste cliente**: ele ajusta o dataset em memória, mas o valor do
  lançamento é o total de ANTES (`Valor := vValor`, `:365`) e as duas pernas da 893 são fixas. Fica implementado
  fiel porque numa instalação com perna automática o ajuste chegaria ao razão.
- ⚠️ **prefixo novo de rota exige entrada no `TenantMiddleware`** (`app.module.ts`): sem `'contabil'` na lista,
  `currentTenant()` estoura e a rota devolve 500.
- Estado do cliente hoje: **13.275 cartões pendentes em 84 lotes**, com data de baixa entre 2020 e 2025.

### 5.4 O que fica para os próximos cortes

Corte-2 (baixas de AP/AR, 15/16 + acessórios 53-58) e corte-3 (cadastros 13/14, transferências 19, movimentação
de caixa 64, adiantamento 63, convênio 65). O `BaixaContabilService` já cobre o auto-disparo das baixas de
AR/AP com partida-por-baixa; o corte-2 é o caminho do TRON (agregado, single-legged) sobre o mesmo motor —
e a nota "ADIADO: baixa por CHEQUE/CARTÃO (situação 893 ausente)" que ele carrega já pode cair.
