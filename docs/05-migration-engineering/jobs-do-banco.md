# Os jobs do banco de produção

Lidos em 25/09/2026 de `ALL_SCHEDULER_JOBS` (somente leitura). `ALL_JOBS` (o agendador antigo) está vazio.
O fonte Delphi não tem nenhum deles, mas os que alteram dado fazem parte do comportamento vivo do legado.

| Job | Quando | Execuções / falhas | O que faz | No Apollo |
|---|---|---|---|---|
| `UPDATEICMSNEGATIVO_SPED` | a cada 3 h | 2.466 / 0 | `UPDATE nf_prod SET vricm = vricm * -1 WHERE vricm < 0`. Na produção não há item com VRICM negativo | ✅ gatilho `nf_prod_vricm_positivo` (mig 361), sem a espera de 3 h |
| `UPDATE_INTEGRACAO_CODPLANOCONTAS_DEB_BAIXA_C` | todo dia, 05:00 | 341 / 0 | `UPDATE apagar SET codplanocontas_deb_baixa_cp = NULL` e `UPDATE apagar_bx SET codplc_juros = 3707 WHERE codplc_juros IS NULL AND acre_desc < 0` (3707 = "JUROS BANCARIOS") | ✅ gatilhos `apagar_sem_conta_deb_baixa` e `apagar_bx_plc_juros` (mig 361). O 3707 só age se o centro existir na base |
| `BKP_SICOM_ESTOQUE` | 12:00 e 23:00 | 682 / 12 | cópia do ESTOQUE em `BKP_ESTOQUE_SICOM` | infraestrutura — fora |
| `DELETAPROCESSOSVERSAO` | a cada 5 s | 5,9 milhões / 0 | `DELETE FROM processos WHERE nomeprocesso = 'VERSAO'` | controle de versão do executável — fora |
| `LIMPA_REMESSA_SERVER` | 22:00 | 341 / 0 | apaga `REMESSA_SERVER` com mais de 2 dias | fila de replicação do PDV — fora |
| `JOB_MONITOR_CONTINGENCIA` | a cada hora | 4.696 / 0 | conta NFC em contingência (STATUSNFE G/R/V) | NFC-e do PDV — fora |
| `MV_RF$J_0_S_15326/28/30` | a cada 2 dias, 02:00/04:30/03:00 | 70 / 0 | refresh das views materializadas `BI_MV_VENDAS_DIA`, `BI_MV_MARGEM_DEPTO`, `BI_MV_ESTOQUE_POSICAO` | BI externo — a avaliar quando o BI for tratado |
| `SICRONIZA_PARCEIROS_APOLLO_PROCEDURE` | 12:00 e 23:00 | 682 / **682** | copia conveniados para `parceiros@apollosistemas` (dblink) | **morto**: falha em todas as execuções |
| `SQLSCRIPT_4815687`, `SQLSCRIPT_6791982` | — | desabilitados | shrink de tabelas de outro esquema (BERNARDAO) | fora |

## Fora do banco

A curva ABC da MULTI_PRECO (ABC, DATA_ABC, PERC_ABC nas lojas 1 e 2) é recalculada todo dia por volta das 05:30, mas não por um
job do banco nem por gatilho. É um processo externo (serviço do binário novo) que lê os percentuais de `EMPRESAS.PC_CURVA_ABC_A..D`.
Os relatórios de 2020 já leem o resultado (`uRelVendasGrid9/10/11/31`). A regra do cálculo não está no fonte: não determinado.
