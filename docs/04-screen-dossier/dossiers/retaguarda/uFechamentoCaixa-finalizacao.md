# FECHAMENTO DE CAIXA — a FINALIZAÇÃO (consolidação por PDV) e o FECHAMENTO DIÁRIO

Recon de 2026-08-19. **Ausência provada no código** (`grep` por `finaliza_fechamento`, `doc_fechamento`,
`'DINHEIRO CONTADO'`, `'SANGRIA EM'` em `apps/api/src` e `apps/api/migrations`: zero ocorrências) — a lição do
ciclo anterior aplicada antes de eleger o alvo.

## 1. O achado: uma lacuna no épico MAIS USADO do sistema

Refazendo o levantamento de uso do menu **sem truncar a saída** (o erro do ciclo anterior escondeu as 15
primeiras linhas), o topo real é:

| acessos | operadores | form | coberto no novo? |
|---:|---:|---|---|
| 512.456 | 30 | `FRMETIQUETA` | sim |
| **41.215** | **35** | **`FRMFECHAMENTOCAIXA`** | sim (épico Caixa) — **mas falta a etapa desta nota** |
| 40.741 | 38 | `FRMCADSCRAP` | sim |
| 29.341 | 41 | `FRMNF` | sim |
| 27.161 | 39 | `FRMCADPRODUTO` | sim |
| 27.086 | 33 | `FRMMANIFESTODFE` | sim |
| 25.881 | 34 | `FRMCADAGENDAPROMOCAO` | sim |
| 24.915 | 20 | `FRMPEDIDOCOMPRA` | sim |
| 24.045 | 28 | `FRMAPAGAR` | sim |
| 14.287 | 25 | `FRMRELVENDAS` | sim (hub) |
| 7.897 | 9 | `FRMRELFINALIZADORAS` | sim |

Ou seja: os 11 forms mais usados estão migrados — o que confirma a estratégia "o mais pesado primeiro". O que
falta é uma **etapa interna** do 2º colocado.

## 2. `FINALIZA_FECHAMENTO` + `DOC_FECHAMENTO` — a consolidação que falta

Quem escreve essas tabelas no legado: `UfinalizaFechamento.pas` (2.664 linhas), `Utesouraria.pas` +
`UdmTesouraria` e `uDmFechamentoCaixa.dfm`. Quem abre a tela `TfrmFinalizaFechamento`: **`uFechamentoCaixa.pas`**
(o form de 41.215 acessos), `UConsDocs.pas` e `uFinalizaFechamentoLanc.pas`. É a etapa em que o gerente/tesouraria
**consolida, por PDV e por operação, o que o caixa apurou** — e guarda os documentos que compõem cada valor.

`FINALIZA_FECHAMENTO` — **172.164 linhas**, 2020-08 a **2025-09**, 21 PDVs:

| coluna | papel |
|---|---|
| `DATA` · `PDV` · `IDEMPRESA` | a chave do fechamento (dia × PDV × empresa) |
| `OPERACAO` | o que está sendo fechado (texto, §3) |
| `VRREAL` | o valor apurado da operação |
| `OPERADOR` | quem fechou |
| `CODIFINFECH` | o id da linha (referenciado por `DOC_FECHAMENTO`) |
| `CONSOLIDADO` | `'F'` em 2.280 linhas · nulo nas outras |
| `CHAVE` | identificador auxiliar |
| `TIPO` | **NULL em 172.164/172.164 ⇒ coluna morta** (cópia-fiel-negativa) |

`DOC_FECHAMENTO` — **876.927 linhas**: `CODIGO` · `OPERACAO` · `CODDOCFEH` · `CODIFINFECH` (o vínculo com a linha
de `FINALIZA_FECHAMENTO`). É o **detalhe documental** de cada valor consolidado.

## 3. As operações do fechamento (do golden, com volume e soma)

| operação | linhas | Σ VRREAL |
|---|---:|---:|
| CARTOES | 12.255 | R$ 34.212.644,09 |
| SANGRIA EM DINHEIRO | 12.262 | R$ 13.951.430,12 |
| DINHEIRO | 12.262 | R$ 13.927.789,24 |
| POS | 12.259 | R$ 2.979.873,23 |
| SUPRIMENTO | 12.262 | R$ 371.004,74 |
| DINHEIRO CONTADO | 12.262 | R$ 350.727,24 |
| DEVOLUCAO | 12.259 | R$ 50.667,17 |
| CHEQUE · SANGRIA EM CHEQUE · OUTRAS SANGRIAS | 12.262 cada | **R$ 0,00** (cópia-fiel-negativa: a operação existe e nunca teve valor) |

O padrão de ~12.260 linhas por operação mostra que **todas as operações são gravadas sempre**, mesmo zeradas —
é um "formulário fixo" por PDV/dia, não uma lista do que houve. Copiar isso importa: um fechamento sem linha de
CHEQUE não é o mesmo que um fechamento com CHEQUE = 0.

## 4. `FRMFECHAMENTODIARIO` — a outra tela, pequena e independente

Não confundir: `uFechamentoDiario.pas` (840 linhas, 389 acessos, 8 operadores) mexe só na tabela
**`FECHAMENTO`** (3.439 linhas · 4 empresas · 2019-08 a **2026-04** · `STATUS` `'F'` em 1.997 e nulo em 1.442).
O que ela faz: um calendário do mês onde cada dia é **fechado** (`FechaDia` → `STATUS='F'` + `VerificaNFs`) ou
**reaberto** (`AbreDia` → `STATUS = null`), com botões de fechar/abrir o **mês inteiro** (F8/F9) e atalhos
F6/F7. As três grades da tela (`cdsNF`, `cdsNFS`, `cdsEcf`) mostram as notas de entrada, de saída e os cupons do
dia — é a conferência antes de travar.

Relação com o que já existe: o novo tem `periodo_contabil` com bloqueios por **período/mês** (migs 038/100,
`BLOQ_NF` etc.). O `FECHAMENTO` é um nível **por DIA** e não tem equivalente — mas é uma tela pequena.

## 5. Corte proposto (ordem por valor)

1. **corte-1 — a finalização do fechamento de caixa**: `finaliza_fechamento` + `doc_fechamento`, a gravação do
   formulário fixo de operações por PDV/dia (inclusive as zeradas), o vínculo documental e o `CONSOLIDADO`.
   É a lacuna do form de 41.215 acessos. Antes de codar falta ler em `UfinalizaFechamento.pas` **de onde vem
   cada `VRREAL`** (o que é somado do PDV × o que o operador digita, como o `DINHEIRO CONTADO`) e o que o
   `CONSOLIDADO='F'` habilita/trava.
2. **corte-2 — fechamento diário** (`FECHAMENTO`): fechar/reabrir o dia, em lote pelo mês, com a conferência de
   NFs/cupons; e decidir a relação com o `periodo_contabil` (dia × mês) em vez de duplicar o conceito.
