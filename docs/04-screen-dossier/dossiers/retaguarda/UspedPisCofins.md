# SPED Contribuições — EFD PIS/COFINS (`FRMSPEDPISCOFINS`, `UspedPisCofins.pas`)

> Fonte: `UspedPisCofins.pas` + `.dfm`, `UdmSpedPisCofins.dfm` (QryConfiguracoesSPED :6608, cdsApuracao :6204). Produção: 13 acessos;
> CONFIGURACOES_SPED com a loja 1 nas quatro contas (183 — CAIXA CENTRAL). Apollo: `/fiscal/sped-contribuicoes`,
> `GET/PUT fiscal/sped/contas-pc`, `POST fiscal/sped/efd-contribuicoes` (`exigirApuracao`); smoke §308, jsdom `spedContribuicoes.spec.tsx`.

## O `&Gerar` (`btnOkClick`, :245-276)

1. `ValidaConfiguracoesSPED` (:2575-2605): grava e confere a **Configuração de contas** — o M400, M410, M800 e M810 da loja do login
   (CONFIGURACOES_SPED; o campo recebe o código REDUZIDO da conta, a Pesquisa GET_PLANO_CONTAS com CLASSE = ANALITICA e TIPO = EMPRESA,
   e grava o CODPLANOCONTAS); faltando uma, "Informe o plano contábil para o registro M400." (… M410/M800/M810) e não gera. O legado
   também grava a configuração ao fechar a tela — o Apollo grava ao trocar a conta.
2. `PreValidadorSPED` (:2523): o pré-validador (marcado por padrão; não bloqueia) — dossiê `UPendenciasSPED.md`.
3. `PreparaGeracaoSPED` (:2420-2450): sem uma apuração do período EXATO (APURACAO_PC, sem filtro de loja), "Não existe apuração para o
   periodo informado!" e não gera (a rota da API sem `exigirApuracao` segue gerando com o bloco M vazio).
4. O arquivo `SPED_CONTRIBUICOES_<CNPJ>_<ddmmaaaa>.txt` (:2445) — "Arquivo Gerado com Sucesso".

## Ainda não chegaram ao gerador do Apollo

Finalidade do arquivo, "Apurar registros de forma", entradas/saídas, "Gerar C400" / "Gerar M100/810" / "Gerar C490", "Gerar CFOP
5929", as alíquotas de PIS/COFINS da tela e os três indicadores (método de apropriação, tipo de contribuição, incidência — o LP marca
a incidência no FormShow). O gerador usa o padrão do `.dfm`.
