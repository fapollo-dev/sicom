# FRMCONFIGLEGISLACAONFE — Legislação da NF-e

**5 acessos · 2 operadores.** `uConfigLegislacaoNFe.pas` + `uDMConfigLegislacaoNFe`. Migration **268**.
API `fiscal/config-legislacao` (CRUD + `resolver`). Tela `/fiscal/config-legislacao`. Smoke §146 (3 checks).

## 1. O que faz

Guarda as **mensagens legais que saem nas observações da NF-e** e na informação adicional do item: texto
livre (CLOB) endereçado por empresa e, opcionalmente, UF, CFOP, produto e parceiro. Quem lê é o
`GetConfigLegislacao(UF, CFOP, produto, parceiro)` (`udmNF.pas:9628`), chamado em três lugares:
`mmoInfAdProd` do item (`uItensNF.pas:2701`), a observação da nota (`uNF.pas:4692`) e o mapa de carga
(`UCadMapaDeCarga.pas:1111`).

## 2. ⚠️ Três defeitos, com prova no dado (produção, 18/09/2026)

**1. A resolução nunca acha nada.** O WHERE exige `CODCFOP = <n>` — e **as 18 linhas da tabela têm
`CODCFOP` nulo**. Nenhuma NF-e do cliente jamais recebeu mensagem por este caminho.

**2. `if RecordCount = 1`.** Se duas linhas casassem, o legado devolveria vazio, em silêncio.

**3. Dado estragado dentro do texto:**

| o quê | onde |
|---|---|
| `'+ sLineBreak +'` — expressão Delphi colada no campo | SIMPLES_NACIONAL das empresas 1 e 50 |
| mojibake (`ReduÃ§Ã£o da Base de CÃ¡lculo`) | REDUCAO_LANA das empresas 1 e 50 |
| **RCTE/GO** (Goiás) numa casa cujas 5 empresas são de **MG** | BASE_LEGAL_REDUCAOBC |

Conteúdo: 7 chaves por empresa (MENSAGEM_ICMS_DIFAL, REDUCAO_LANA, APROVEITAMENTO_CREDITO, TRIBUTOS,
BASE_LEGAL_REDUCAOBC, SIMPLES_NACIONAL, INFORMACOES_OPERADORES) nas empresas 1 e 50, mais 4 de SUFRAMA
para `UF='AM'` (uma já `INDR='E'`). Os textos usam placeholders `%DIFAL%`, `%PERC_…%`, `$(NF_SUFRAMA)`.

## 3. O que o Apollo faz

- **`resolver(uf, cfop, produto, parceiro)`** escolhe por **especificidade** (produto 8 > parceiro 4 >
  UF 2 > CFOP 1), devolve todas as candidatas com a escolhida marcada e, ao lado, `resolucaoDoLegado` —
  o que a regra antiga entregaria (nada, no cliente).
- Cada regra vem com `alertas`: `invisivelNoLegado` (sem CFOP), `codigoVazado`, `mojibake`, `semTexto` e
  a lista de `placeholders` encontrados. Os textos ficam como estão — é dado do cliente; a tela agora
  mostra o problema em vez de escondê-lo.
- Tenant-scoped; exclusão lógica (`INDR='E'`), como o legado.
