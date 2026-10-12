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

## As opções da tela (12/10/2026)

Recon completo por agente (`UspedPisCofins.pas`/`.dfm`, `UdmSpedPisCofins.dfm`); convertidas com o padrão do `.dfm` quando ausentes:

| Opção | Padrão | O que muda |
|---|---|---|
| Finalidade do Arquivo (Original/Retificação) | Original | 0000.TIPO_ESCRIT (:401). ⚠️ O legado deixava o NUM_REC_ANTERIOR vazio (:403) e a tela não tinha o campo — a retificadora saía inválida; o Apollo pede o recibo na retificação |
| Apurar registros de forma (Analítica/Sintético) | Analítica | só o C010.IND_ESCRI (2 individualizada / 1 consolidada — GetIndEscrituracao, :2210-2213); não muda os registros, como no legado. ⛔→✅ O Apollo escrevia 1 com o comentário "individualizada" |
| Gerar M100/810 | marcado | desmarcado o legado não escrevia o bloco M (nem o M001 — o PVA não abre); aqui o bloco M sai sem dados |
| Gerar CFOP 5929 | desmarcado | desmarcado, a nota só com 5929/6929 fica fora do C100 e do 0150 e o 5929 fora do VL_MERC (o padrão que o Apollo já seguia); marcado, entram |
| Alíquotas PIS / COFINS | 0,65 / 3,00 | ⛔→✅ o grupo do C175 com CST de COFINS 05 sai com base e valor 0 e a alíquota da tela, quando as duas estão preenchidas (:1005-1017) — 92 itens de NFC-e com CST 05 em set/2026. O C100 da NFC-e soma os C175 que saem (o legado somava os valores sem zerar e o C100 discordava dos C175) |
| Indicador da incidência tributária | 1 (o LP abre em 2 — FormShow :375-376) | 0110.COD_INC_TRIB; no cumulativo não há crédito (o legado pula o M100/M500 e não desconta crédito no M200/M600) |
| Indicador de método de apropriação de créditos | **2 – rateio proporcional** | 0110.IND_APRO_CRED. ⚠️ O rateio exige o 0111, que o legado nunca gerou — o validador do Apollo acusa; a tela avisa e o operador escolhe 1 |
| Indicador do tipo de contribuição | 1 | 0110.COD_TIPO_CONT |
| IND_REG_CUM | — | o legado põe 9 (competência detalhada) só no LP; aqui 9 sempre que a incidência é cumulativa/ambas (o validador aceitava {1,2,3} — o domínio é {1,2,9}) |

Fora, com prova: Entradas/Saidas (declarados, nunca lidos — :33-34); C400/C490 (ECF; os dois são mutuamente exclusivos e o legado sempre
escrevia um deles — **0 vendas de ECF em 2026**); IND_SIT_ESP "cisão" quando a data final não é fim de mês (:2244-2247 — erro do
legado, não se copia). Erros do legado anotados, não copiados: CST de COFINS nos dois campos do C170 (já tratado no corte anterior), o
loop infinito do 0150 com "AO CONSUMIDOR", o M400 que dobra na segunda geração, o crédito do M200 sem teto, o M610 01 sempre. Smoke §311.
