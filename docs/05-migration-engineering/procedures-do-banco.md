# Procedures e funções do banco do legado × Apollo

Auditoria de 25/09/2026, na produção (só leitura): as 38 `PROCEDURE`/`FUNCTION` do schema `PINHEIRAO` (31 válidas, 7 inválidas),
lidas do `user_source`, com quem chama (fonte Delphi de mai/2020, `user_dependencies`, `user_scheduler_jobs`) e o que cada uma grava.
Complementa [gatilhos-do-legado.md](gatilhos-do-legado.md) e [jobs-do-banco.md](jobs-do-banco.md).

**O que a auditoria mudou no Apollo:** a `SP_ATUALIZA_DTCONTABIL_NF` virou rotina (`rotinas-do-banco.agendador.ts`, smoke §261). O resto
já tinha equivalente, é tabela de trabalho de relatório (o Apollo consulta direto), PDV, morto (inválido ou sem uso) ou utilitário.

## A que estava viva e faltava

| objeto | o que faz | quem chama | prova na produção | Apollo |
|---|---|---|---|---|
| `SP_ATUALIZA_DTCONTABIL_NF` (2014) | `UPDATE NF SET DTCONTABIL = SYSDATE WHERE PROC = 'N'` | nada no fonte de 2020 nem nos jobs — o binário novo | as **327** notas não processadas de 25/09/2026 têm DTCONTABIL = o dia; **641 de 653** entradas processadas em set/2026 ficaram com a data do processamento | ✅ `RotinasDoBancoAgendador` (a cada minuto por tenant, no fuso da loja, idempresa-agnóstico como a procedure) |

## As demais

| objeto | grava | quem chama | veredito |
|---|---|---|---|
| `CONGELAMENTO_ESTOQUE` | ESTOQUE, ESTOQUE_DEP, HISTORICO_PROD, EMPRESAS | binário novo (DDL 06/2026) | 🪦 **dormente**: usada uma vez (24-25/05/2022: 39.248 "ENTRADA EM CONGELAMENTO", 39.251 "SAIDA DE CONGELAMENTO"); FLAGETQCONG = N nas 5 lojas. ⚠️ Diverge do Apollo (`congela-estoque.service.ts`, do fonte de 2020): o descongelar da procedure **aplica a contagem** (QTDE := QTDE_CONG ± o movimento desde o congelamento) e os gatilhos de estoque (ESTOQUE/ESTOQUE_NOTAS/ESTOQUE_OS/ESTOQUE_PED, via `GETEMPRESAETQCONG`) desviam o movimento enquanto congelado; o Apollo só levanta a marca. Reabrir se o cliente voltar a congelar |
| `GETEMPRESAETQCONG` | — | os 4 gatilhos de estoque acima | idem (lê a marca) |
| `ATUALIZA_MULTIPRECO_PELA_NF` | MULTI_PRECO.VRCUSTO das linhas com custo 0 | ninguém (sem fonte, sem job) | corretiva eventual: hoje só **6** das 1.199 linhas com custo 0 têm entrada processada. O processamento da NF do Apollo já grava o custo com as mesmas flags (PROC_TRANSF/ALTERA_CUSTO_NF). Defeito: pega o 1º item da nota, não o do produto. Não portada |
| `ATUALIZA_NATUREZA_RECEITA` | PC_TIPOCREDITOISENTO (insere/atualiza a descrição) | ninguém | manutenção de catálogo (natureza da receita do SPED); a carga traz a tabela. Não portada |
| `SP_REPLICA_PERMISSAO` | PERMISSOES | `uCtrlPermissoes` (copiar para) | ✅ `permissoes.service.ts` (clonar) |
| `POE_REPLICA_USUARIO` | PERMISSOES | ninguém | equivalente ao acima, sem chamador |
| `SP_PROCESSA_MERGE_CARTAO` | CARTAO (valor líquido, taxa, NSU do extrato CONS_REG10) | `UbaixaCartao` | o Apollo concilia o extrato na baixa de cartão (`cartao-baixa.service.ts`, CONS_REG10) |
| `GERA_MOVIMENTACAO_DIARIA`, `POE_MOVIMENTOS_VENDAS`, `POE_REL_ANALISE_VENDAS`, `POE_FECHAMENTO_DIARIO`, `POE_PEDIDOS`, `POE_PEDIDOS_PED`, `SP_GERA_REL_AUX`, `SP_GERA_REL_AUX_NF`, `SP_PROCESSA_DADOS_AUX_COMP` | só tabelas de trabalho (MOVIMENTACAO_DIARIA, MOVIMENTOS_VENDAS/VENDAS_DIARIO, VENDAS_TEMP, RES_ALIQ_60D, SELECT_PEDIDOS, REL_AUX, NFAUXCOMP/NF_PRODAUXCOMP) | as telas de relatório e o pedido de compra | tabela de trabalho: o Apollo consulta a origem direto (ex.: a Análise Geral lê a venda, não a cache — smoke §126.2) |
| `POE_REL_PRECOS_ALTERADOS`, `SP_PEDIDOS_ATENDI`, `SP_GERA_IMOBILIZADO`, `GETESTOQUEPRODUTO`, `GETESTOQUEDEPOSITOPRODUTO`, `GETESTOQUETOTALPRODUTO`, `OBTER_VALOR_GET_APAGARBX` | — | — | ⛔ **INVÁLIDAS** no banco (não compilam, não rodam). O relatório de preços alterados do Apollo consulta direto (§121) |
| `SP_CX_PEDIDOS_ATENDI` | CX_PEDIDOS | integração do pedido de atendimento | PDV — fora |
| `ENVIA_EMAIL` | — (UTL_SMTP) | `uCadCotacao` | épico de plataforma "envio de e-mail" (FILA) |
| `SICRONIZA_PARCEIROS_APOLLO`, `SICRONIZA_PARCEIROS_END_APOLLO` | PARCEIROS@dblink | job | morto: falha em todas as execuções (jobs-do-banco.md) |
| `SP_RESULT01` | — | — | ⛔ **nunca portar**: recebe SQL em base64 e o executa (`EXECUTE IMMEDIATE`) — porta dos fundos para SQL arbitrário |
| `GETNFPEDIDOCOMPRA`, `GET_CNPJCPF_PARCEIRO` | — | binário novo (SQL das telas) | leitura sem regra própria (LISTAGG dos NRONF do pedido; o CNPJ ativo do parceiro) |
| `CHARACTER_LENGTH`, `STRING_AGG`, `TIRA_MASCARA`, `ENCODEBASE64`, `EXISTE_CAMPO_TABELA`, `RESET_SEQUENCE`, `POE_QTDE` | — / PROCESSOS / ESTOQUE da loja 5 | views, gatilho REM_CARTAO, utilitários | utilitário de SQL (o Postgres tem o equivalente nativo) ou de manutenção (`POE_QTDE` cria estoque para a loja 5, que não existe) |
