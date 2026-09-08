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
- multi-empresa: as origens 3-7 e 10-13 rodam só na empresa corrente (`:2068`).

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
