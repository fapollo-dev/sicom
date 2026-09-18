# FRMCADCEST — Cadastro de CEST

**11 acessos · 3 operadores.** `uCadCest.pas` + `.dfm` (CadMaster de 3 campos). Migration **260**.
API `cadastro/cest` (busca, `sem-cadastro`, CRUD). Tela `/cadastro/cest`. Smoke §138 (3 checks).

## 1. O que faz

A tabela de referência do **Código Especificador da Substituição Tributária** (Convênio ICMS 92/15), por
NCM — o código que `produtos.cest` aponta e que sai na NF-e e no SPED. A tela do legado edita CEST,
DESCRIÇÃO e NCM; a tabela tem ainda SEGUIMENTO, ITEM e ANEXOXXVII, que o Apollo expõe também.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| linhas · CESTs distintos | **19.109 · 896** (a tabela é CEST × NCM; zero pares repetidos) |
| PK | `CODCEST` (surrogate) |
| NCM | `VARCHAR2(150)` na origem, 100% com 8 dígitos |
| produtos com CEST | **31.556** |
| produtos apontando CEST **inexistente** na tabela | **248** |
| produtos com CEST fora do formato (7 dígitos) | 4 |

## 3. O que o Apollo faz a mais — e por quê

- **`GET cadastro/cest/sem-cadastro`**: os 248 produtos que apontam um CEST que não existe (e os 4 com
  formato inválido, marcados). A tela do produto do legado não valida contra nada, e o código errado vai
  para a NF-e. O legado não tem nada equivalente.
- **Unicidade do par (CEST, NCM)** — a origem tem zero duplicados, o destino recusa criar um (422 `CEST_DUPLICADO`).
- **Excluir o último NCM de um CEST que produtos apontam é recusado** (422 `CEST_EM_USO`): apagar deixaria
  os produtos com código sem cadastro. Outros NCMs do mesmo CEST podem sair.
- Formato validado na entrada: CEST 7 dígitos, NCM 8 dígitos.

## 4. Carga

A tabela `CEST` não estava no destino nem no plano de carga — entrou na f0 do `plano-tabelas.json`
(recarga total, 19.109 linhas).
