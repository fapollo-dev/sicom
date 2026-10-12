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

As opções da tela chegaram (seção abaixo). Faltam: o A100/A170 (nota de serviço modelo 3 com PIS de entrada — **1 nota desde 2025**
na produção) e o C010 de cada estabelecimento da raiz (o legado abre o C001 sempre com dados e escreve o C010 de todos; o Apollo, o da
loja, e C001 sem dados quando não há documento — os dois são aceitos pelo leiaute).

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

## Os blocos do leiaute e o frete (12/10/2026)

O ACBr do legado (`SaveFileTXT`, :1918) escreve **todos** os blocos (0 A C D F I M P 1 9); o Apollo escrevia só 0/C/M/9 — o PVA não abre
o arquivo sem as aberturas. ⛔→✅ Agora, na ordem do leiaute:

| Bloco | Legado | Apollo |
|---|---|---|
| A | `GeraBlocoA` (:595-683): A001 com dados + A010 de cada estabelecimento | igual; A100/A170 pendentes (1 nota) |
| D | `GeraBlocoD` (:746-786): D001 com dados se o `sqqNFfrete` tem linha, D010 de cada estabelecimento, D100/D101/D105 | igual — o frete sob o D010 da loja da sessão (a NFAUXSPED do legado é a dela) |
| F, I, P, 1 | não preenchidos (o ACBr abre sem dados) | X001 IND_MOV 1 + X990 |

**D100** (:1365-1434, `sqqNFfrete` UdmSpedPisCofins.dfm:5108 — modelos 7/8/9/10/11/26/27/57 com número, sem filtro de processada nem de
cancelada): IND_OPER 0, IND_EMIT 1 (terceiro), COD_PART = o CNPJ/CPF do endereço da nota (entra no 0150), COD_MOD (90 → 1B — morto: o 90
não está no filtro), COD_SIT 00, SER com 3 dígitos, SUB 0, CHV_CTE, DT_A_P = DTCONTABIL, VL_DOC = VL_SERV = TOTALNF, VL_DESC 0, IND_FRT
pelo TIPOFRETE (0-4 e 9; fora disso vazio), ICMS da nota, VL_NT 0, COD_CTA da conta do CFOP. **D101/D105** por grupo do
`sqqAnaliticoFrete` (:5387 — itens de CFOP com SINTEGRA = S, por CST/CFOP/CSTs de PIS-COFINS do produto (98 sem cadastro)/ICME/cupom):
VL_ITEM = Σ (custo − desconto%) × qtde + despesas + frete% + IPI%, IND_NAT_FRT pelo TIPOFRETE (0-5 e 9), CST de entrada ou saída pelo
TIPO da nota, NAT_BC_CRED 07, alíquotas **fixas** 1,65 / 7,60.

Produção (só leitura, 12/10): 15 conhecimentos desde 2025 (14 modelo 8 + 1 modelo 7, todos de entrada, TIPOFRETE 9), **nenhum item
com CFOP do Sintegra** — o legado escreve o D100 sem D101/D105 e o Apollo também (fiel; se o PVA cobrar o analítico, é o cadastro do
CFOP do frete que decide). Modelos 9/10/11/26/27: 0 notas. O bloco C já excluía 7/8/57. Validador: exige as 10 aberturas/fechamentos
na ordem e conta os campos de A010/D010/D100/D101/D105. Smoke §312, `sped-validator.spec.ts`.

