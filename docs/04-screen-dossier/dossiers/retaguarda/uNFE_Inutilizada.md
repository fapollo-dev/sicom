# FRMNFE_INUTILIZADA — NF-e / NFC-e inutilizadas

**2 acessos · 2 operadores** no menu — e **187.138 registros na tabela**. `UNFE_Inutilizada.pas` (cadastro
de 5 campos). Migration **271**. API `fiscal/nfe-inutilizada` (CRUD + `buracos`). Tela
`/fiscal/nfe-inutilizada`. Smoke §149 (3 checks).

## 1. O que faz

O **livro das numerações queimadas**. Quando um número de NFC-e se perde (queda de energia, travamento do
PDV, contingência), a SEFAZ autoriza a inutilização e devolve um protocolo — e esse registro é o que
explica o buraco na sequência das notas para o fisco. A tela é pequena (data, série, número inicial,
número final, protocolo) porque **quem grava é o processo de emissão**; ela serve para consultar e
corrigir.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| registros | **187.138** |
| soma das faixas (`Σ fim − ini + 1`) | **187.138** → toda inutilização é de **um número só** |
| loja 1 · loja 2 · loja 51 (NFC-e) | 131.333 (19/08/2020 → hoje) · 54.904 (22/12/2023 → hoje) · 899 |
| NF-e (modelo 55) na vida | **2** (uma em 2023, outra em 2024) |
| em 2026 | **21.339** — ~78 por dia |
| `NF.STATUSNFE = 'I'` | **0 linhas** — a inutilização não deixa rastro na NF, vive só aqui |

A tabela não existia no destino nem no `plano-tabelas.json`; entra na f0 (187 mil linhas).

## 3. O que o Apollo faz a mais

- **`GET buracos`**: os números que não foram emitidos **nem** inutilizados na série e no período — é
  exatamente o que o fisco pergunta, e o legado não tinha essa conta.
- **Faixa sobreposta é recusada** (422 `FAIXA_JA_INUTILIZADA`, com o registro conflitante no detalhe): o
  legado deixava inutilizar o mesmo número duas vezes.
- **Numeração de nota emitida é recusada** (422 `NUMERACAO_EM_USO`): inutilizar número de nota que existe
  é o erro que a fiscalização pega.
- **Registro com protocolo não é apagado** (422 `INUTILIZACAO_COM_PROTOCOLO`) — o protocolo é da SEFAZ; o
  buraco ficaria sem explicação.
- Consulta por período, tipo, série e **por número** (acha a faixa que o contém); totais com quantos
  números e quantos registros estão **sem protocolo**.

## 4. Fora

A comunicação com a SEFAZ (pedido de inutilização) — o registro aqui é o livro, como no legado; o XML
guardado (`ARQUIVO_XML`) tem coluna e vem pelo `obter`, mas não há emissão por esta tela.
