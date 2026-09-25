# Os gatilhos do legado

Lidos em 25/09/2026 no Oracle de **produção**, só leitura (`SET TRANSACTION READ ONLY`, só SELECT em `ALL_TRIGGERS`,
`ALL_SOURCE`, `ALL_OBJECTS` e nas tabelas). Universo: os **119 gatilhos habilitados** do dono PINHEIRAO, fora os das
tabelas `BKP*` e `AUDIT*`. Todos estão `VALID`.

Para cada um: o corpo inteiro, a prova de uso no dado, quem escreve a tabela (retaguarda ou PDV) e onde o Apollo o
reproduz (`apps/api/src`, `apps/api/migrations`). "Fonte" é o Delphi de 2020 (`retaguarda-master/fonte/Units`, 1.846 units).

## Resumo

| Grupo | Qtde | Veredito |
|---|---|---|
| Replicação pura (`REM_*` sem efeito colateral + `REPLICA_REMESSA`) | 26 | FORA — fila `REMESSA_SERVER` do PDV |
| Auditoria pura (`AUDIT_*`, fora `AUDIT_CARGAS`) | 33 | FORA — só `AUDIT_PERMISSOES` existe no Apollo |
| Com regra de negócio | 60 | abaixo |

Os 60 com regra:

| Veredito | Qtde |
|---|---|
| ✅ reproduzido | 11 |
| ⚠️ parcial | 8 |
| ❌ faltando | 11 |
| FORA (PDV, replicação, outro processo) | 10 |
| MORTO (com prova) | 20 |

**Replicação (26).** `REM_BANCOS`, `REM_CENTRALIZADOR_GERAL_PDV`, `REM_CLUBE_DESCONTO(_EXT)`, `REM_CODAUXILIAR`,
`REM_COMPOSICAO`, `REM_ESTOQUE_DEP`, `REM_FORMAPGTO`, `REM_MOTIVOS_OPERACAO`, `REM_MULTI_PRECO(_ATACAREJO)`,
`REM_OPERADORAS`, `REM_OPERADORES`, `REM_PARCEIROSEND/PGOT/REL`, `REM_PIX_CONFIG`, `REM_PRODUTO`, `REM_PRODUTOS_IMAGENS`,
`REM_PROMOCAO_ACUMULATIVA/DEPARTAMENTO`, `REM_PUBLICIDADE_PRE`, `REM_RELACAO_EMP_OP`, `REM_STEF_TERMINAL/USUARIO` e
`REPLICA_REMESSA` (multiplica a linha por terminal de `EMPRESA_REMESSA`). Só gravam instruções em `REMESSA_SERVER`.
O sucessor é o protocolo de sync ([sync-protocol.md](sync-protocol.md)). O Apollo tem o esqueleto `outbox`
(`migrations/001_init.sql:33`), usado só por bancos (`banco.queries.ts:69`); nenhuma config liga `replica: true`.
Os 9 `REM_*` que também mexem em outras tabelas estão na tabela abaixo.

**Auditoria (33).** Cópia da linha com PROGRAMA/MAQUINA de `GSESSION`. São volumosas (AUDIT_ESTOQUE 15,0 mi,
AUDIT_CARTAO 7,7 mi, AUDIT_CX_VENDAS 6,2 mi, AUDIT_PEDIDO_COMPRA_QTDE 4,8 mi). **O fonte não lê nenhuma**: grep dos 34
nomes nas 1.846 units dá 0 leituras. A única citação é `uTron.pas:2590-2609`, que **desliga** AUDIT_APAGAR e
AUDIT_APAGARBX durante a integração contábil. No Apollo só existe `audit_permissoes` (mig 104; gravada em
`permissoes.service.ts:89`). Manter ou não as outras é decisão pendente ([auditoria-esqueletos.md](auditoria-esqueletos.md) §3).

## A tabela (os 60 com regra)

Ordem: estoque, custo, preço, financeiro, fiscal, cadastro, depois FORA e MORTO.

| Gatilho | Tabela | Evento | O que faz | Vivo? | Apollo | Veredito |
|---|---|---|---|---|---|---|
| `ESTOQUE_NOTAS` | NF | AFTER UPDATE, linha | PROC N→S: move ESTOQUE (ou DEP/ALMOX/local/congelado) por item com GERAESTOQUE; grava HISTORICO_PROD com FIN/CFOP/SIT.DOC e o "CIÊNCIA DE QTDE NEGATIVA E AUTORIZADO POR"; carimba ESTOQUE.DTENT/QTDE_ENT/IDORIGEM_ENT (+_ANTERIOR) na entrada e DTVENDA/QTDE_VENDA/IDORIGEM na saída; item com DECOMPOSICAO='S' reparte nos filhos e grava DECOMPOSICAO_NF_QTDE. Cancelamento/reversão/denegada: estorna e devolve as datas anteriores | sim: 61.835 entradas e 6.444 saídas no Kardex em 2026; 2.840 produtos com DTENT em set/2026 | `nf-processamento.service.ts:385-440` move o saldo e grava o Kardex; `:101-125` estoque negativo. **Não** carimba DTENT/QTDE_ENT/DTVENDA (nenhum escritor no `src`; a Prévia do fornecedor lê, `previa-fornecedor.service.ts:253`); texto do Kardex sem FIN/CFOP/SIT.DOC e sem o sufixo do negativo (15.431 linhas em 2026); sem VALOR_ALTER; DECOMPOSICAO='S' no item (2 em 2026) | ⚠️ |
| `ESTOQUE_AJUSTE` | AJUSTE_ESTOQUE | AFTER INSERT | Só grava o Kardex do ajuste: HISTORICO_PROD (destino E), _DEP (D), _ALMOX (X) ou _<local>; texto por ORIGEM (A manual, I inventário rotativo, B balanço). Não move saldo | sim: 1.073 ajustes em 2026 (A/E 2.458 desde 2025; I/E 8) | manual da loja ✅ `ajuste-estoque.service.ts:82-83`. Zeramento do inventário rotativo ✅ (25/09/2026) grava o Kardex ("AJUSTE DE ESTOQUE INVENTARIO ROTATIVO OPERADOR: n  / CODINV = coleta") e DESTINO 'E'/'D' como a produção desde 2022 (36 linhas; 'ESTOQUE' só até 30/08/2022). Ajuste de depósito sem HISTORICO_PROD_DEP (tabela nem existe; última linha no legado em 2023; nenhum ajuste D na produção) | ✅ |
| `ESTOQUE_TROCA` | ITENS_TROCA | BEFORE I/U/D | A baixa sai **na inclusão do item** (ESTOQUE ou ESTOQUE_DEP −QTDE) e soma QTDETROCA. Fechar (N→S) só abate QTDETROCA; devolve saldo só com ORIGEM_FECHAMENTO TROCA/SCRAP. Reabrir só volta QTDETROCA. Excluir devolve. Corrige inventário rotativo posterior | sim até 24/11/2025: 317 "RETIRADA DO ESTOQUE LOJA PARA TROCA" | `troca.service.ts:36-78`: baixa **no fechar** e devolve no reabrir. Os 130 itens carregados abertos (105 FECHADO nulo + 25 'N') já saíram do estoque no legado: fechar no Apollo baixa **de novo**. Sem QTDETROCA, depósito e rotativo (`migrations/118_troca.sql:3-7`) | ⚠️ |
| `VALIDA_ESTOQUE` | ESTOQUE | AFTER I/U | Erro se QTDE nulo | sim | `migrations/022_estoque.sql:21` (NOT NULL) | ✅ |
| `VALIDA_SCRAP` | SCRAP_ITEM | AFTER I/U | Erro se o scrap aparece na view VALIDA_SCRAP_ITEM (Kardex de SCRAP duplicado desde 29/07/2025) — trava contra baixa dupla | sim: SCRAP_ITEM até hoje | equivalente na origem: `scrap.service.ts:90` (mov_estoque com lock) e `scrap.aggregate.ts:143` (aplicado não edita) | ✅ |
| `ATUALIZA_CUSTO_COTACAO` | COTACAO_FORN_ITENS | BEFORE INSERT | ULTIMO_VALOR := VRCUSTOREP do item na última NF de entrada processada do fornecedor (CFOPs de compra, até a data da cotação) | sim: 550 de 1.562 itens de 2026 | ✅ (25/09/2026) mig 364 `apollo_ultimo_custo_rep_cotacao`, gravada nas duas inclusões (`cotacao-forn.service.ts` abrir, `cotacao.service.ts` lançar preços) e lida ao vivo na matriz | ✅ |
| `UPDATE_CUSTO_MULTI_PRECO` | MULTI_PRECO | AFTER UPDATE | HISTORICO_DINAMICO de VRCUSTO, VRCUSTOREP, VRPROMO, VRVENDA; operador = CLIENT_IDENTIFIER/CODUSUALT/PRODUTOS | sim: 135.758 linhas em 2026 | `migrations/354_multi_preco_historico_custo.sql:16-45` | ✅ |
| `ATUALIZAPROD` | MULTI_PRECO | BEFORE I/U | Sempre DTULTIMALTERACAO := agora. INSERT: DTULTPRECOALTERADO e ETQ_IMPRESSA 'N'. UPDATE com VRVENDA/VRPROMO/PROMOCAO/**ATACAREJO_ATIVO** mudado: idem | sim | ✅ (25/09/2026) UPDATE: `migrations/365_atualizaprod.sql` (com ATACAREJO_ATIVO e DTULTIMALTERACAO); INSERT: `produto-lojas.ts` incluirNasLojas e `produto.aggregate.ts` (linha nova do cadastro), fora do banco por causa do delete+insert | ✅ |
| `CLUBE_DESCONTO_ESTOQUE` | CLUBE_DESCONTO | BEFORE UPDATE | Toda alteração recalcula ENCERRADA: 'T' só se MAXIMO_ESTOQUE>0 e VENDA_ESTOQUE ≥ teto; senão 'F' | sim (3.125 regras, 0 com teto, 0 encerradas) | `clube-desconto.service.ts:155` grava a ENCERRADA que vier; sem a regra do teto | ⚠️ |
| `CONTROLADELETEAGENDA` | AGENDA_PROMOCAO_ITENS | BEFORE DELETE | MULTI_PRECO.PROMOCAO := 'N' do produto **em todas as lojas** (o filtro por loja está comentado) | raro: 3 exclusões de item em 2026 | `agenda-promocao.aggregate.ts:377-386` desliga só as linhas desta agenda (codagenda); não toca promoção de outra origem | ⚠️ |
| `ATUALIZAPROD_ATACAREJO` | MULTI_PRECO_ATACAREJO | BEFORE I/U | Inclusão ou VALOR/QUANTIDADE mudado: MULTI_PRECO.DTULTPRECOALTERADO e ETQ_IMPRESSA 'N' | quase: 3 linhas; escrita por `uAjustePrecos`, `udmCadProduto` | a tabela não existe no destino | ❌ |
| `CHECK_REMESSAS_BOLETOS_CONTAS` | ARECEBER | BEFORE DELETE | Erro se o título está em REMESSAS_BOLETOS_CONTAS com INDR ≠ 'E' | sim: 14.133 de 14.224 linhas ativas, última em 01/09/2026 | ✅ (25/09/2026) `migrations/367_areceber_remessa_boleto.sql` — gatilho BEFORE DELETE, todos os caminhos; 422 pelo HINT | ✅ |
| `REM_RECEBER` | ARECEBER | AFTER I/U/D | Além da remessa: HISTARECEBER "DATA DA VENDA ALTERADA"; apaga/atualiza TESOURARIA (RCB), NF_FINANCEIRO_DIF_PEDIDO e MAPA_DE_CARGA_RECEBIMENTOS | HISTARECEBER sim (16, até 12/2025); as outras 3 tabelas estão vazias | `migrations/315_histareceber.sql:15-31`. O resto é morto | ✅ |
| `CAIXA_APAGAR` | CX_APAGAR | BEFORE DELETE | Apaga a CAIXA do rateio (CODGRUPO + CODCXAPAGAR) | sim | `apagar-caixa.ts:47-51`; os outros DELETE de cx_apagar apagam a CAIXA antes ou a refazem (`fechamento-caixa.service.ts:1752`, `nf-faturamento.service.ts:116`, `apagar.service.ts:155-156`) | ✅ |
| `SET_DEFAULTS` | ARECEBER | BEFORE I/U | TOTAL_BRT := TOTAL quando nulo | sim | só 2 dos 14 INSERT em areceber gravam (`nf-faturamento.service.ts:564`, `fechamento-caixa.service.ts:1621`). Nenhum leitor no fonte; a LOG do binário novo o lista | ⚠️ |
| `TEMP_AGRUPADO` | ARECEBER | BEFORE I/U | AGRUPADO := 'N' quando nulo | sim | `migrations/043_areceber_gestao.sql:25` (DEFAULT 'N') | ✅ |
| `VALIDA_AGRUPAMENTO` | APAGAR | AFTER I/U | Erro se CODGRUPO = 0 ou CODGRUPO_AGRUPAMENTO_APG = 0 | trava sem disparo: 0 casos | sem a trava; o código vem de sequência (`apagar-caixa.ts:20`) | ❌ |
| `VALIDA_ADIANTAMENTO` | ADIANTAMENTO_FORN | AFTER I/U | Erro se CODMOVCONTA, VALOR ou CODPARCEIRO nulo | sim: 586, último 24/09/2026 | `migrations/159_adiantamento_forn.sql:12,16,19` (NOT NULL) | ✅ |
| `ATUALIZATRIBUTOS` | MULTI_PRECO | AFTER I/U | Copia para PRODUTOS o que mudou na linha: IDPISCOFINS, TIPOPIS, IDTABELA, CODFIGURAFISCAL e ALIQUOTASAIDA → ALIQUOTA | sim: PRODUTOS × linha da loja 1 iguais em 98,7% (alíquota) | ✅ (25/09/2026) mig 366 `trg_multi_preco_atualiza_tributos` (UPDATE; o INSERT das inclusões do Apollo não muda o produto) + o `AtualizaTributos` da alteração (`produto-lojas.ts` espalharTributosNaUf) | ✅ |
| `UPDATE_CODAUXILIAR` | PRODUTOS | BEFORE UPDATE | CODBARRA mudou: CODAUXILIAR.CODBARRA := novo (a coluna é o código principal) | sim: 1.147 de 1.147 iguais | ✅ (25/09/2026) `migrations/368_update_codauxiliar.sql` + o detalhe do cadastro leva o código do produto (sem carimbar DTALTERACAO) | ✅ |
| `UPDATE_PRODUTOS_FILHOS` | PRODUTOS | BEFORE UPDATE (autônoma) | Replica 25 campos fiscais/cadastrais do pai nos filhos (CODGRUPOPRECO só se DIF = 0) | sim: 201 filhos | `migrations/132_produtos_filhos_propagacao.sql:40-160` (mesma transação, divergência documentada) | ✅ |
| `CASCATA_FAMILIA_PROD` | FAMILIAS_PROD | BEFORE UPDATE | CODDPTO/CODGRUPO da família mudou: move **todos** os produtos do departamento/grupo antigo para o novo. O ramo de TIPO é no-op (mesmo código) | sim: 99% dos produtos batem com o subgrupo | `familias.crud.ts` não arrasta os produtos | ❌ |
| `REM_PARCEIROS` | PARCEIROS | AFTER I/U/D | Além da remessa: ATIVADO mudou → PARCEIROS_END, _REL e _PGTO recebem o mesmo | sim: 827 endereços N/N | `parceiro.aggregate.ts` grava o ativado do endereço como veio; não desce | ❌ |
| `PLC_BI0` | PLC | BEFORE INSERT | CODPLC := sequência | sim | `migrations/349_plc_cadastro.sql:5` | ✅ |
| `COTACAO_FORN_BI` | COTACAO_FORN | BEFORE INSERT | CODCTCFORN := sequência. O fonte desliga ao gravar com código próprio (`uCadCotacaoForn.pas:640-673`) | sim | `migrations/091_cotacao.sql:49` (bigserial) | ✅ |
| `COTACAO_FORN_ITENS_BI` | COTACAO_FORN_ITENS | BEFORE INSERT | CODCTCFIT := sequência (idem) | sim | `migrations/091_cotacao.sql:60` | ✅ |
| `RECEITA_PROD_HIST` | RECEITA_PROD | BEFORE I/U/D | Histórico I/U/D da receita em RECEITA_PROD_HIST (lido em "Histórico de modificações – Receitas", `UCadProduto.pas:3414`) | sim: 858, última 15/10/2025 | a tabela veio na carga (`migrations/311_todos_os_dados.sql:153`); ninguém grava | ❌ |
| `PRODUCAO_HIST` | PRODUCAO | BEFORE I/U/D | Histórico da ordem de produção. O SPED lê para o K270/K275 (`UdmSpedFiscal.pas:1586-1602`) | parado: 79, última 01/10/2024 | a tabela não existe no destino | ❌ |
| `ITENS_PRODUCAO_HIST` | ITENS_PRODUCAO | BEFORE I/U/D | Idem, itens (SPED, `Uspedfiscal.pas:1849`) | parado: 52, 10/2024 | não existe | ❌ |
| `ITENS_PRODUCAO_RECEITA_HIST` | ITENS_PRODUCAO_RECEITA | BEFORE I/U/D | Idem, insumos (SPED, `Uspedfiscal.pas:1860`) | parado: 563, 10/2024 | não existe | ❌ |
| `ESTOQUE` | VENDAS | AFTER I/U | Baixa/estorna ESTOQUE (ou congelado) por item do PDV, Kardex "BAIXA DE ESTOQUE DERIVADO DO PDV", DTVENDA/QTDE_VENDA, PRODUTOS.ULTIMAVENDA, carimba PEDIDOS; cancelamento apaga CX_VENDAS, ARECEBER e CHEQUE | sim: 1,8 mi linhas de Kardex em 2026 | PDV | FORA |
| `CASCATA_ESTOQUE` | VENDAS | BEFORE I/U | Produto com COMPOSICAO='S': baixa/estorna os componentes | sim (9 produtos compostos) | PDV | FORA |
| `VENDA_ESTOQUE_CLUBE_DESCONTO` | VENDAS | AFTER I/U | Soma/abate CLUBE_DESCONTO.VENDA_ESTOQUE | sim | PDV | FORA |
| `UPDATE_PARCEIROS_DTULTCOMPRA` | VENDAS | BEFORE INSERT | PARCEIROS.DTULTCOMPRA := DTVENDA | sim | PDV | FORA |
| `AUDIT_CARGAS` | VENDAS | AFTER INSERT | Atualiza a linha única de AUDIT_CARGAS com a última venda da loja (monitor) | sim | PDV | FORA |
| `ESTOQUE_PED` | PEDIDOS | BEFORE I/U/D | PROC='S': baixa/estorna estoque. Cancelamento/exclusão apaga CX_PEDIDOS, ARECEBER, CHEQUE do pedido | PROC='S' só do PDV (36.888), último 04/02/2025; o pedido da retaguarda nasce PROC='N' | o Apollo não inclui, cancela nem exclui pedido (`pedido-venda.service.ts`) | FORA |
| `EXPORTACAO_NFC_BORBA` | NFC | BEFORE UPDATE | STATUSNFE mudou: EXPORTADA_BORBA := nulo | sim | NFC-e do PDV | FORA |
| `TG_NF_CANCELAMENTO` | NF_CANCELAMENTO | AFTER I/U | Modelo 65: NFC cancelada; sem NFC viva no pedido, VENDAS CANCELADO='S'/TIPOCANC='C'. O ramo UPDATE está aninhado no INSERTING (morto) | sim: 12.380, hoje | só PDV/monitor; o fonte não cita a tabela | FORA |
| `REM_CARTAO` | CARTAO | BEFORE I/U/D | INSERT: resolve CODOPERADORA pela OPERADORA_PDV ou cria a OPERADORA ("… - CODREDE n"). TESOURARIA no UPDATE; o DELETE usa :NEW (nunca casa) | sim: 320 mil cartões em 2026 (PDV); 50 operadoras criadas assim | os INSERT do Apollo já trazem codoperadora (`fechamento-caixa.service.ts:591,810`). TESOURARIA vazia | FORA |
| `REM_EMPRESAS` | EMPRESAS | AFTER I/U/D | Mantém EMPRESA_REMESSA (terminais da replicação); no INSERT usa :OLD (nulo) | sim | configuração da replicação | FORA |
| `ESTOQUE_BAL` | BALANCOITENS | AFTER INSERT | HISTORICO_PROD "REGISTRO DE SALDO INICIAL" por item | desligado na prática: 135.683 linhas só em 2020; os 4 balanços de 2021 e 2026 (159 mil itens) não geraram nenhuma. LAST_DDL_TIME = o segundo do balanço 61 (13/01/2026 14:40:49) | `balanco.service.ts` não grava | MORTO |
| `ESTOQUE_TRANS` | SAIDADEP | AFTER INSERT | Só Kardex das transferências entre estoques (não move saldo) | 16 linhas, última 04/02/2021 | — | MORTO |
| `ESTOQUE_OS` | OS | BEFORE I/U/D | Baixa/estorno do módulo OS | OS vazia | — | MORTO |
| `DEL_PRODUTO` | PRODUTOS | AFTER DELETE | Apaga VENDAS, ESTOQUE, ESTOQUE_DEP do produto | 0 exclusões em AUDIT_PRODUTOS (32 mil eventos) | FK ON DELETE CASCADE em estoque/estoque_dep (`migrations/022_estoque.sql:19`) | MORTO |
| `PRODUTOS_COMP` | COMPOSICAO | AFTER UPDATE | Com PARAMETRO.ATUCOMPOSICAO='S': recalcula custo/venda do composto | PARAMETRO vazia: nunca liga | — | MORTO |
| `COMPOSICAO_PROD` | MULTI_PRECO | AFTER UPDATE | Idem: COMPOSICAO.VALOR := VRVENDA ou VRCUSTO | PARAMETRO vazia | — | MORTO |
| `COMPOSICAO_PROD_KIT` | MULTI_PRECO | AFTER UPDATE | Kit (TIPO_PRODUTO='K'): rateia a diferença de VRVENDA na COMPOSICAO | 0 produtos 'K' | — | MORTO |
| `ATUALIZA_VENDAS` | RES_ALIQ_60D | BEFORE UPDATE | Propaga DESC_AJUSTADO_UNIT e VRVENDA para VENDAS | RES_ALIQ_60D vazia | — | MORTO |
| `ATUALIZA_PEDIDOS` | ITENS_MAPA_DE_CARGA | BEFORE I/D | PEDIDOS.NROMAPA | tabela vazia | — | MORTO |
| `ATUALIZA_MSN` | PEDIDO_NF | BEFORE INSERT | TIPO='P': mensagem "FATURADO" em MSN | 5 mensagens em 5 anos; o fonte não lê MSN | — | MORTO |
| `CADCHEQUE` | CHEQUE | AFTER I/U/D | CODCHQREF preenchido: lança MOV_CONTAS_BANCARIAS | 11 cheques, 1 com CODCHQREF, último 12/2023 | — | MORTO |
| `REM_CHEQUE` | CHEQUE | AFTER I/U/D | Além da remessa: TESOURARIA (CHQ); o DELETE usa :NEW | TESOURARIA vazia | — | MORTO |
| `TG_HIST_VALE_TROCO_BX` | HIST_VALE_TROCO_BX | AFTER I/U/D | Liga/desliga CODHISTVALETROCOBX em HIST_VALE_TROCO | tabela vazia; o fonte não cita | — | MORTO |
| `CODPROMOCIONAL_CLUBE_DESCONTO` | HIST_CODIGOPROMOCIONAL | AFTER INSERT | VENDA_ESTOQUE + 1 | tabela vazia | — | MORTO |
| `FGF_PRODUTOS` | FGF_PRODUTOS | AFTER DELETE | Copia a linha apagada em FGF_PRODUTOS_ESPELHO | as duas vazias | — | MORTO |
| `INS_PEDIDOS_COZINHA` | PEDIDOS | AFTER I/U/D | Item de cozinha → PEDIDOS_COZINHA | PEDIDOS_COZINHA vazia | — | MORTO |
| `REM_PEDIDO_ECOMMERCE` | PEDIDO_ECOMMERCE | BEFORE INSERT | Site Mercado: numera, acha loja/cliente, cria PARCEIROS/END | tabela vazia | — | MORTO |
| `REM_PEDIDO_ECOMMERCE_ITEM` | PEDIDO_ECOMMERCE_ITEM | BEFORE INSERT | Cria o item em PEDIDOS | vazia | — | MORTO |
| `REM_PEDIDO_ECOMMERCE_PAGAMENTO` | PEDIDO_ECOMMERCE_PAGAMENTO | BEFORE INSERT | Cria CX_PEDIDOS | vazia | — | MORTO |
| `REM_PEDIDO_ECOMMERCE_CARTAO` | PEDIDO_ECOMMERCE_CARTAO | BEFORE INSERT | Só numera | vazia | — | MORTO |

## Os ❌ e ⚠️ por dano provável

1. ✅ **`ESTOQUE_TROCA` (corrigido em 25/09/2026, `troca-estoque.ts`).** O momento da baixa é outro. Os 130 itens de troca carregados em aberto já saíram
   do estoque no legado; o "fechar" do Apollo os baixa de novo. O "reabrir" devolve saldo que o legado não devolve.
2. ◐ **`ESTOQUE_NOTAS` (25/09/2026: a última entrada/venda no ESTOQUE e o texto/valor do kardex ✅; falta a decomposição da antiga estrutura — dormente).** A NF não carimba a última entrada/saída em ESTOQUE (DTENT, QTDE_ENT, IDORIGEM_ENT,
   DTVENDA, QTDE_VENDA e os _ANTERIOR). A Prévia do fornecedor do Apollo lê DTENT/QTDE_ENT: congela na virada.
   O Kardex perde FIN/CFOP/SIT.DOC, o autorizador do negativo e o valor. Item de decomposição na nota não reparte.
3. ✅ **`ESTOQUE_AJUSTE` (corrigido em 25/09/2026, `inventario-rotativo.service.ts`).** O zeramento do inventário rotativo não deixava linha no Kardex e gravava DESTINO
   'ESTOQUE', código que a produção abandonou em 2022 (grava 'E'). Agora grava 'E'/'D' e o Kardex da loja com o texto do gatilho. A produção só
   tem ORIGEM A/E e I/E (nenhum B, nenhum D): o balanço e o depósito não passam por aqui.
4. ✅ **`ATUALIZA_CUSTO_COTACAO` (corrigido em 25/09/2026, mig 364 `apollo_ultimo_custo_rep_cotacao`).** O comprador perdia o último custo de reposição do fornecedor na cotação.
   A coluna existia com outro significado ("preço anterior", inventado; 0 de 550 linhas de 2026 batem com isso, 549 batem com o gatilho). Agora
   as duas inclusões gravam o custo do gatilho, a matriz do comprador mostra o "Ult. Custo Rep." ao vivo e a tela do fornecedor deixou de receber
   esse custo e o custo/venda da loja (o legado não os seleciona no preencher). VALOREMBAL_BK: nulo nas 16.014 linhas da produção, o Apollo não grava mais.
5. ✅ **`ATUALIZAPROD` (corrigido em 25/09/2026, mig 365 + `produto.aggregate.ts`/`produto-lojas.ts`).** Mudar o atacarejo não pedia reimpressão de etiqueta; linha nova de loja
   nascia sem DTULTPRECOALTERADO; DTULTIMALTERACAO não era carimbada. Agora o UPDATE (gatilho do banco) cobre ATACAREJO_ATIVO e carimba DTULTIMALTERACAO;
   o ramo INSERT fica no código (a inclusão nas lojas e as linhas novas do cadastro), porque o cadastro regrava o detalhe por delete+insert e 92.471 linhas
   da produção têm ETQ_IMPRESSA nula — no banco, cada gravação pediria etiqueta de todas. No cadastro, a linha que já existia segue o UPDATE do legado:
   preço/promoção/atacarejo mudado pede etiqueta, qualquer outra mudança só carimba DTULTIMALTERACAO, linha intocada fica como estava.
6. ✅ **`ATUALIZATRIBUTOS` (corrigido em 25/09/2026, mig 366 + `produto-lojas.ts` espalharTributosNaUf).** PRODUTOS.ALIQUOTA e TIPOPIS não seguiam a linha de preço.
   O recon achou mais: no legado o combo "Alíquota" do cadastro É a MULTI_PRECO.ALIQUOTASAIDA (cmbALIQUOTA em dtsMulti_Preco) e o gravar da
   alteração espalha a tributação para todas as lojas da UF (`AtualizaTributos`, UCadProduto.pas:1302) — 96 de 96 produtos alterados em set/2026
   iguais nas 5 lojas. O Apollo mudava só a linha da sessão (o §227 tinha lido só a inclusão): a figura/PIS/alíquota editadas não chegavam às
   lojas 2/50/51/52. Agora: o UPDATE da linha devolve ao produto o que mudou (gatilho), a alteração espalha pela UF, a linha da sessão espelha a
   alíquota do produto e a web deixou de ter a "Alíquota saída" separada.
7. ✅ **`CHECK_REMESSAS_BOLETOS_CONTAS` (corrigido em 25/09/2026, mig 367).** Título já enviado ao banco podia ser excluído (o boleto ficava
   registrado no banco sem título no sistema). Agora é gatilho do banco — vale para todos os caminhos de exclusão — e o erro volta 422
   ARECEBER_EM_REMESSA_BOLETO com o texto do legado (HINT 'APOLLO:<código>', mapeado no filtro de erros para qualquer gatilho portado).
8. ✅ **`UPDATE_CODAUXILIAR` (corrigido em 25/09/2026, mig 368 + `produto.aggregate.ts`).** Trocar o código de barras principal deixava o código auxiliar
   apontando o antigo. Agora o gatilho do banco acompanha (multi-atualização) e o cadastro regrava as linhas com o código do produto.
9. **`CLUBE_DESCONTO_ESTOQUE` (⚠️, promoção).** O Apollo aceita ENCERRADA do payload; o legado a recalcula em toda
   alteração. O teto por estoque nunca foi usado.
10. **`SET_DEFAULTS` (⚠️, financeiro, baixo).** TOTAL_BRT fica nulo em 12 dos 14 caminhos de inclusão.
11. **`CASCATA_FAMILIA_PROD` (❌, cadastro/relatórios).** Mudar o departamento ou grupo de uma família não arrasta os
    produtos. Relatórios por departamento divergem.
12. **`CONTROLADELETEAGENDA` (⚠️, preço, baixo).** O Apollo desliga só o preço da agenda; o legado desliga PROMOCAO do
    produto em todas as lojas. 3 casos em 2026.
13. **`REM_PARCEIROS` (❌, cadastro, baixo).** Inativar o parceiro não inativa endereços, relacionados e pagamentos.
    Quem lê é o PDV (via remessa).
14. **`RECEITA_PROD_HIST`, `PRODUCAO_HIST`, `ITENS_PRODUCAO_HIST`, `ITENS_PRODUCAO_RECEITA_HIST` (❌, fiscal/auditoria,
    baixo).** O histórico para na virada. O SPED do legado usa os três de produção no K270/K275. As três tabelas de
    produção nem existem no destino. Produção parada desde 10/2024.
15. **`VALIDA_AGRUPAMENTO` (❌, financeiro, baixo).** Sem a trava de CODGRUPO = 0. O Apollo usa sequência.
16. **`ATUALIZAPROD_ATACAREJO` (❌, preço, baixo).** A tabela MULTI_PRECO_ATACAREJO não existe no destino (3 linhas).

## Gatilhos do Postgres criados pelo Apollo

| Gatilho (migração) | Corresponde a |
|---|---|
| `trg_multi_preco_preco_alterado` (127:67, 365) | `ATUALIZAPROD` (o ramo UPDATE; o INSERT no código) |
| `trg_produtos_propaga_filhos` (132:157) | `UPDATE_PRODUTOS_FILHOS` |
| `trg_areceber_historico` (315:30) | `REM_RECEBER` (HISTARECEBER) + `ExcluiHistAReceber` do fonte |
| `trg_apagar_dtcompra` (327:20) | nenhum: regra do Apollo (DTCOMPRA ↔ DTVENDA) |
| `update_custo_multi_preco` (354:45) | `UPDATE_CUSTO_MULTI_PRECO` |
| `nf_prod_vricm_positivo`, `apagar_sem_conta_deb_baixa`, `apagar_bx_plc_juros` (361) | jobs do banco, não gatilhos ([jobs-do-banco.md](jobs-do-banco.md)) |

## Para o fluxo do PDV

Os FORA de VENDAS e NFC continuam sendo regra. Quando a venda do PDV entrar no Apollo, a ingestão precisa fazer o que
`ESTOQUE`, `CASCATA_ESTOQUE`, `VENDA_ESTOQUE_CLUBE_DESCONTO`, `UPDATE_PARCEIROS_DTULTCOMPRA` e `TG_NF_CANCELAMENTO`
fazem: baixa e estorno de estoque (com componentes), Kardex, DTVENDA/QTDE_VENDA, ULTIMAVENDA, DTULTCOMPRA, contador do
clube e, no cancelamento, apagar CX_VENDAS, ARECEBER e CHEQUE. E resolver a operadora do cartão pelo texto (`REM_CARTAO`).

## Observações

- **Gatilho ligado e desligado pelo aplicativo.** O fonte desliga COTACAO_FORN_BI/ITENS_BI (`uCadCotacaoForn.pas:640`),
  REM_PRODUTO (`udmIntegracaoLote.pas:1742`) e AUDIT_APAGAR/BX (`uTron.pas:2590`). O binário novo faz o mesmo com
  ESTOQUE_BAL no balanço e com o grupo de ESTOQUE em 23/01/2026 22:21:57, logo após o "POSICIONAMENTO DE SALDO".
  Status ENABLED não prova que o gatilho roda em toda operação.
- **Defeitos no próprio legado:** o UPDATE de TG_NF_CANCELAMENTO nunca roda; o DELETE de REM_CARTAO e REM_CHEQUE usa
  :NEW; CASCATA_FAMILIA_PROD move o departamento inteiro, não só os produtos da família; REM_EMPRESAS grava :OLD no INSERT.
- **LAST_DDL_TIME recente** (ESTOQUE_NOTAS e UPDATE_PRODUTOS_FILHOS em 10/09/2026; o grupo de MULTI_PRECO em 04/09) pode
  ser só recompilação após ALTER TABLE. O corpo lido hoje é o que vale; os ports devem ser conferidos contra ele.
