# APURAÇÃO DE ICMS / REGISTROS DE ENTRADAS E SAÍDAS — `uRelRegistros_ES` (+ `uDMRelRegistros_ES`)

Recon de 2026-08-19 (autônomo). Alvo eleito pela **varredura por dado** (placar `c1ab594`): a tabela com mais
volume entre as que não têm nenhuma referência no código novo e **têm fonte** no legado.

**Ausência provada no código**: `grep -rln "apuracao_icms\|APURACAO_ICMS"` em `apps/api/migrations` e
`apps/api/src` acha **uma única** ocorrência — comentários no `sped-efd-icms-ipi.service.ts`, que registram
exatamente esta lacuna: *"o legado LÊ o E110 de uma tabela pré-calculada APURACAO_ICMS (processo de …)"* e *"o port
do processo APURACAO_ICMS"* pendente. Ou seja: o SPED já **consome** a apuração; quem a **produz** nunca foi
migrado.

## 1. O que a tela faz

É o **livro de Registro de Entradas e Saídas** + a **apuração do ICMS** do período: o operador escolhe o intervalo
de datas e a empresa, e o processo varre as notas, classifica por CFOP/CST/espécie e grava três coisas — o
**detalhe por documento**, o **resumo por CFOP** e o **cabeçalho da apuração** (que é a estrutura do E110 do SPED).

## 2. As três tabelas (golden)

| tabela | linhas | papel |
|---|---:|---|
| `APURACAO_ICMS` | **41** (33 com detalhe) | o **cabeçalho** por `(DATAINI, DATAFIN, IDEMPRESA)` — é o E110 inteiro |
| `APURACAO_ICMS_DETALHES` | **1.155.893** | o detalhe **por documento**: `TIPO` E/S, `CST`, `CFOP`, `ESPECIE`, `BASE`, `VALOR_ICMS`, `ISENTAS_NAOTRIB`, `OUTRAS`, `TOTALNF`, `ICMS`, `ICMS_EFETIVO`, `CLASSFISCAL`, `CODIGO` |
| `ICMS_CFOP` | **606** (em 33 apurações) | o **resumo por CFOP**: `VRCONTABIL`, `BASECALCULO`, `IMPOSTO`, `ISENTAS`, `OUTRAS` |

Cabeçalho = E110 campo a campo: `SALDOANT`, `CREDITOENTRADA`, `OUTROSCREDITOS`, `ESTORNODEBITOS`,
`SALDOCREDORSEGUINTE`, `DEBITOSAIDA`, `OUTROSDEBITOS`, `ESTORNOCREDITOS`, `SALDODEVEDOR`, `DEDUCOES`, `ARECOLHER`.

Distribuição do detalhe: **saídas 1.141.333** linhas (18 CFOPs, 9 CSTs, 2 espécies) × **entradas 14.560** (35
CFOPs, 9 CSTs, 1 espécie) — o varejo tem muito mais documento de saída, e uma apuração grande tem ~64 mil linhas
de detalhe (a maior: código 481 com 63.867).

Apurações reais mais recentes: 2026-03/04 (com números: crédito de entrada 2.393,67 e saldo credor seguinte
2.376,87) e 2025-11/2025-05 (com `ARECOLHER` 2,55 e 1,44). A última linha (2026-06-25) está toda zerada — execução
vazia, não apuração.

## 3. Regras já identificadas no fonte (3.047 + 1.063 linhas)

- **gate por CFOP**: as três consultas do processo (`uRelRegistros_ES.pas:1330`, `:1924`, `:2099`) fazem
  `JOIN CFOP C ON C.CODCFOP = ... AND COALESCE(C.NAO_GERA_APURACAO_ICMS,'N') = 'N'` — CFOP marcado **fica fora da
  apuração**. Golden: `'S'` em **5** CFOPs, `'N'` em 8, **nulo em 382** (o COALESCE trata nulo como 'N'). A nossa
  tabela `cfop` **não tem** essa coluna.
- **reprocesso com confirmação** (`:1855-1885`): procura apuração de `(DATAINI, DATAFIN, IDEMPRESA)`; se existe,
  pergunta *"Ja existe apuração nesse período, deseja reprocessar?"* — **não** apenas recarrega a apuração gravada
  (`PopulaDadosApuracaoICMS`), **sim** apaga `ICMS_CFOP` e `APURACAO_ICMS_DETALHES` daquele código e refaz.
- **id app-side**: `CODAPURACAOICMSDETALHES = COALESCE(MAX(...),0) + 1` (`:2313`, `uDMRelRegistros_ES.pas:525`) — o
  mesmo padrão `GetID` do resto do legado (no novo: sequence).
- o cabeçalho é montado num dataset (`cdsRecolhimento*`, com uma variante **IPI** paralela: `cdsRecolhimentoIPI*`,
  que zera todos os campos em `uDMRelRegistros_ES.pas:661-688`) ⇒ **a fórmula de cada campo do E110 é o que falta
  ler** antes de construir, e há um caminho de IPI espelhado (coerente com `APURACAO_IPI`, que está **vazia** no
  golden ⇒ candidato a cópia-fiel-negativa).

## 4. Irmãs vazias (cópia-fiel-negativa, registrar e não implementar)

`APURACAO_IPI`, `APURACAO_ICMS_ST`, `APURACAO_ICMS_ST_AJUSTES`, `APURACAO_CIAP`,
`APURACAO_ESTOQUE_ESCRITURADO`, `APURACAOCEREAL` — **todas com 0 linhas**. O tenant não usa nenhuma delas; o
caminho de IPI existe no fonte (datasets paralelos) mas nunca produziu dado.

## 5. Corte proposto

- **corte-1 — o processo da apuração**: as 3 tabelas (`apuracao_icms`, `apuracao_icms_detalhes`, `icms_cfop`) +
  `cfop.nao_gera_apuracao_icms`; a varredura de entradas e saídas do período com o gate de CFOP; o resumo por CFOP;
  o cabeçalho E110; o reprocesso idempotente (apaga detalhe/resumo e refaz) e a tela com os três quadros.
  **Antes de codar falta ler**, no fonte, a fórmula de cada campo do cabeçalho (o que entra em `CREDITOENTRADA` ×
  `OUTROSCREDITOS`, como nasce `SALDOANT`/`SALDOCREDORSEGUINTE` e o que são `DEDUCOES`) — é o miolo da fidelidade,
  e o golden dá 33 apurações para confrontar campo a campo.
- **corte-2 — o elo com o SPED**: trocar a leitura do E110 (hoje o `sped-efd-icms-ipi.service` espera a apuração
  pronta) para a apuração **produzida aqui**, e conferir o registro por CFOP contra o que o SPED emite.
- **fora, registrado**: IPI e as demais irmãs vazias.
