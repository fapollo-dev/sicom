# FRMCADFIGURASFISCAIS — Figuras fiscais

**6 acessos · 2 operadores.** `uCadFigurasFiscais.pas` + `udmCadFigurasFiscais`. Migration **267**.
API `fiscal/figuras-fiscais` (CRUD). Tela `/fiscal/figuras-fiscais`. Smoke §145 (2 checks).

## 1. O que faz

Mantém o catálogo de **figuras fiscais** — a chave do `INDEXADOR_TRIBUTARIO` multi-campo que a mig 034 já
implementou (`CODFIGURAFISCAL + TP_CADASTRO + ORIGEM + DESTINO + CODCFOP + …`). É o caminho tributário que
**4 das 5 empresas** usam (`EMPRESAS.FIGURAFISCAL = 'O'`); a quinta está em 'D' e consulta `DET_ALIQUOTA`
por alíquota. A tela do legado edita um campo só: `DESCFIGURAFISCAL`.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| `FIGURA_FISCAL` | **16.838 linhas**, todas ativas (`INDR='I'`) |
| figuras que aparecem no `INDEXADOR_TRIBUTARIO` | **11** |
| exemplos | ISENTO · SUBSTITUICAO · TRIBUTADO 7% · TRIBUTADO 12% |
| colunas além das 3 da tela | `CODREDUZIDO`, `ORIGEM_*`/`DESTINO_*` (todas nulas na amostra), `INTEGRACAO_ID` |

O catálogo tem 16.838 linhas e a regra tributária usa 11 — o resto é histórico de integração.

## 3. O que o Apollo faz

CRUD com o campo do legado + `codreduzido`, a **contagem de regras** por figura e o filtro "só as usadas".
Exclusão é lógica (`INDR='E'`) e **figura em uso pelo indexador não sai** (422 `FIGURA_EM_USO`) — a regra
tributária ficaria órfã. A tabela já existia no destino (mig 034) e no plano de carga; a 267 acrescenta as
colunas que a carga precisa preservar, a sequência do código e o índice por figura no indexador.
