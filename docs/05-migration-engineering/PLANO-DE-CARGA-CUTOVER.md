# Plano de Carga — Cutover Oracle (PINHEIRAO) → Postgres (tenant pinheirao)

> **Status: DESENHO — nenhum dado foi movido.** Este documento define ordem, volumes, transformações e
> validações da carga. O script de ETL será construído fase a fase a partir daqui, com ensaio em massa
> ANTES de qualquer janela de virada.

## 1. Panorama

- **Destino:** 135 tabelas criadas pelas migrations 001–150 (o schema é o contrato; a carga NUNCA altera DDL).
- **Origem:** 120 têm equivalente direto em `PINHEIRAO`; 15 são nossas/renomeadas (mapa na §6).
- **Mecânica proposta:** script Python (python-oracledb thin → Postgres `COPY` via psycopg), por tabela,
  em lotes de 50k, **resumível** (checkpoint por tabela+faixa de PK) e **idempotente** (truncate-and-load
  por tabela dentro da fase). Rede: a mesma usada no recon (192.168.1.230).
- **Regra de ouro:** Oracle é **READ-ONLY** (replicação ativa). Toda escrita é no Postgres.

## 2. Volumes (stats do dicionário, 2026-08-17)

| Tabela (Oracle) | Linhas | Observação |
|---|---:|---|
| VENDAS | 11.922.255 | a gigante; particionar por DTVENDA (mês a mês) |
| HISTORICO_PROD | 2.874.278 | kardex |
| CX_VENDAS | 1.515.042 | pagamentos do PDV |
| HISTORICO_DINAMICO | 1.027.914 | |
| DIARIO | 888.243 | contábil |
| PEDIDOCOMPRA_I | 286.854 | |
| HISTORICO_PDV | 284.173 | eventos PDV |
| NF_PROD | 252.468 | |
| MOV_CONTAS_BANCARIAS | 144.448 | |
| MULTI_PRECO / ESTOQUE | ~137,5k cada | |
| CARTAO | 125.240 | |
| CAIXA | 121.665 | livro-caixa |
| demais 108 tabelas | < 100k cada | |

Total estimado: **~20,5 M linhas**. Com COPY em lotes, estimativa de carga bruta: 1–3 h (a validar no ensaio).

## 3. Fases e ordem (FKs mandam)

1. **F0 — Catálogos sem dependência:** bancos, cidades, bairro, cfop, ncm, aliquota, tributacao,
   piscofins, det_aliquota, figura_fiscal, unidade, marcas, familias_prod, familias_prod_area, plc,
   plano_contas, dre_estrutura/dre_conta (nossas — seed próprio), condicoes_pagto, operacoes_conta.
2. **F1 — Núcleo cadastral:** empresas (**inclui ULTIMO_NSU, UF, AMBIENTE, cortes ABC, DESPOPERACIONAL**),
   configuracoes (**PRESERVANDO IDs — lição 24**), configuracoes_especificas (**grants de liberação — lição 23**),
   operadores (+ **cutover César→scrypt das 157 senhas**, rotina já pronta do épico AUTH), perfis/permissoes,
   parceiros (+end/bancos/pgto/rel), produtos (+kit/nutri/codauxiliar/codreferencia_for), multi_preco, estoque, pdv,
   contas_bancarias, formas_pgto, contacorrente.
3. **F2 — Documentos:** pedidocompra(+_i), nf (+nf_prod, nf_contabil*, nfe_xml, retencoes, forma_pagamento),
   cotacao*, devolução, troca, scrap*, inventario, producao, agenda_promocao*, clube_desconto, lote_preco.
4. **F3 — Financeiro:** areceber(+bx), apagar(+bx), cx_apagar, caixa (livro), cartao, mov_contas_bancarias,
   conciliacao_bancaria*(← MOVIMENTACAO_BANCARIA_OFX), diario, apuracao_pc*, **adiantamento_forn** (depois de
   contas_bancarias e dos títulos: cada linha referencia `codmovconta` e o título por `codadiantamento`).
5. **F4 — Movimento pesado (particionado):** vendas (mês a mês), cx_vendas, historico_prod,
   historico_dinamico, historico_pdv, hist_sangria_suprimento, caixa_pdv, nfe_nao_cadastradas, nfe_eventos.
6. **F5 — Pós-carga:** reset de TODAS as sequences (`setval(max(pk)+1)`), ANALYZE, reconciliação (§5).

## 4. Transformações conhecidas (lições já pagas — aplicar por reflexo)

- **`MOV_CONTAS_BANCARIAS.VALOR` vem COM SINAL do legado** (crédito positivo em 101.911 linhas, débito negativo
  em 42.527 — `select tipomovimento, sign(valor), count(*)` no golden), e a rotina que grava é a compartilhada
  `LancaMovimento` (udmPrincipal.pas:2138: `VALOR := ValorRef * -1`). O app novo grava **magnitude** e tira o sinal
  do `tipomovimento` (convenção dos 5 writers do razão). Na carga: `valor = abs(VALOR)` e `tipomovimento` derivado
  do sinal quando estiver nulo — sem isso o saldo/extrato do Controle de Contas Correntes inverte o débito.
- **`MOV_CONTAS_BANCARIAS.DATA_FECHAMENTO` é NULL nos movimentos de adiantamento (563/563)**: a data desses
  movimentos vive em `DTEMISSAO`/`DTVENC`/`DTLIBERACAO` (as três iguais). A nossa coluna de data do razão é
  `data_fechamento` (é a que o extrato e o saldo-até-data usam) ⇒ na carga, `data_fechamento = DTEMISSAO` quando
  `DATA_FECHAMENTO` vier nula.
- **`ARECEBER.TOTAL_BRT`**: a trigger `SET_DEFAULTS` do legado faz `TOTAL_BRT := TOTAL`. Mesma classe do `TOTAL` já
  registrado (coluna espelho que o novo deriva) — não copiar, derivar.
- **`ADIANTAMENTO_FORN`:** não copiar `CODMAPA` (0/563 = morta) nem `OLD_CODPARCEIRO` (resíduo de migração antiga);
  `IDDOCGERADO` só tem 2 linhas preenchidas. O vínculo com o título vai por `codadiantamento` nas duas pontas
  (`areceber`/`apagar`), que o legado também repete em `DUPLICATA`.
- **Timezone:** colunas DATE/TIMESTAMP do Oracle são horário LOCAL → gravar como `timestamptz`
  interpretando em `America/Sao_Paulo` (lição 17). NUNCA passar por UTC implícito.
- **Flags S/N com lixo** ('0', vazio, minúscula): carregar CRU — as comparações do app já normalizam
  via `flag_sn` (lição 19). **Não** "limpar" na carga.
- **Senhas:** OPERADORES.SENHA (César) → scrypt na carga (rotina do épico AUTH, 157 senhas).
- **configuracoes.id**: preservar o ID do legado (UNIQUE `codigo`; FKs de grants apontam pro id — lição 24).
  Conflito com nossos seeds (ids 900+): nossos ids foram escolhidos FORA da faixa do legado — validar no ensaio.
- **NF_PROD colunas de conferência/precificação**: existem no destino; carregar o que houver, NULL no resto.
- **nfe_xml**: origem NÃO tem CODNF → carregar com codnf NULL; a reconciliação do Manifesto religa.
- **CLOBs** (XML, correcao): stream por lote menor (5k) p/ não estourar memória.
- **Numéricos**: Oracle NUMBER sem escala pode trazer float sujo → converter via string (sem passar por float do Python).

## 5. Validação (gate de aceite da carga — cada tabela precisa passar)

1. **Contagem**: `count(*)` origem = destino (por tabela; nas particionadas, por mês).
2. **Somas de controle**: colunas de dinheiro somadas — VENDAS(qtde, qtde*vrvenda), NF(totalnf),
   ARECEBER/APAGAR(valor), CAIXA(valor), CX_VENDAS(valor−troco) — origem = destino ao centavo.
3. **Golden checks funcionais** (amostra dos números já certificados nos dossiês): total de jun/2023 do
   Relatório de Vendas rel 01; DRE de caixa de um mês fechado; SPED Contribuições de um período; posição
   de estoque de 10 produtos sorteados; os 4 cortes ABC das empresas.
4. **Integridade**: FKs violadas = 0 (carga com constraints LIGADAS; ordem das fases garante).
5. **Sequences**: `nextval` > `max(pk)` em todas.

## 6. Mapa das 15 tabelas sem equivalente direto

| Destino | Origem real / natureza |
|---|---|
| conciliacao_bancaria_ofx / _mov | MOVIMENTACAO_BANCARIA_OFX (37.551) — mapear colunas na spec |
| lote_preco | LOTEPRECO |
| nf_contabil | NF_CONTABIL_* (conferir nome exato na mig 029) |
| caixa_mov / caixa_sessao | modelo NOSSO da sessão de caixa — nasce vazio (sem histórico de sessão no legado equivalente) |
| dre_conta / dre_estrutura / empresa_fiscal / tributacao_reforma | seeds nossos — não carregam do Oracle |
| empresas_senha_lockout / operadores_refresh_tokens / outbox | operacionais nossas — nascem vazias |
| nfe_evento (singular) | conferir: alias antigo? provável tabela nossa morta — remover ou ignorar |
| pedido_devolucao_compra_i | **RESOLVIDO (2026-08-19)**: é uma tabela NOSSA (mig 072) cujo nome no Oracle é `PEDIDO_DEVOLUCAO_COMPRA_ITENS`. Carrega de lá: cabeçalho 545 linhas + itens **3.809**, pedidos até out/2025. Mapear coluna a coluna no ETL (os nomes foram normalizados: `codpeddevcompra`, `idempresa`, `status`, `codnf_emitida`). |

## 7. Riscos e decisões em aberto

- **Janela de corte**: a replicação do Oracle continua ativa → definir se a virada é big-bang (fim de semana)
  ou com recarga incremental das tabelas de movimento (VENDAS/CX_VENDAS têm data — delta é viável).
- **PDV**: o usuário definiu NÃO mexer no PDV agora → o PDV continua gravando no Oracle após a virada?
  Se sim, VENDAS/CX_VENDAS precisam de sincronização contínua (fora deste plano; decisão do usuário).
- **Ensaio**: carga completa em banco descartável + validação §5 + rodar TODAS as suites (smoke aponta
  p/ o banco carregado) ANTES de qualquer janela.

## 7b. ⚠️ UNICIDADE: 14 índices nossos que o dado do cliente viola — com veredicto (2026-08-26)

`tools/cutover/varre-unicidade.py` lê as 32 unicidades declaradas nas migrations e confronta cada uma com o
Oracle. **Correção da primeira medição**: `GROUP BY` junta NULLs num grupo só, mas índice único trata cada NULL
como distinto — a v1 deste relatório contou 22.931 NULLs de `nf.cod_ped_dev_compra` como violação. Com a
semântica certa são **~18 mil linhas**, das quais 13.804 já foram resolvidas na mig 172.

| índice | grupos / linhas | o que as duplicatas SÃO (medido) | veredicto |
|---|---:|---|---|
| ~~`ux_inventario_produto`~~ | 2.818 / 13.804 | contagem repetida do mesmo produto no mesmo livro | ✅ **removido** (mig 172) |
| `ux_parceiros_end_doc` (cnpj_cpf) | 1.048 / 2.784 | **1.042 grupos são parceiros DIFERENTES com o mesmo documento** (só 6 são o mesmo parceiro com 2 endereços) | **índice sai**: a unicidade global do documento é invenção nossa. Duplicidade de cadastro vira **aviso na tela**, não bloqueio de carga |
| `ux_mbo_fitid` (OFX) | 77 / 693 | FITID reusado pelo banco — **nenhum grupo tem data e valor iguais** | **chave larga**: dedup do OFX passa a `(conta, fitid, data, valor)`; o índice atual sai |
| `ux_codref_for` | 76 / 230 | mesmo `(codfor, codref)` apontando para **produtos diferentes** em todos os 76 grupos | **índice sai** — o de-para do fornecedor não é 1:1 no legado |
| `ux_nf_natural` (2 variantes) | 38+41 / 215+214 | **215 linhas, todas `CANCELADA='N'`** e sem status de cancelamento: são notas vivas com a mesma chave natural | **índice vira parcial** (só para NF nova, a partir do cutover) — proibir hoje rejeitaria nota legítima |
| `ux_nf_codpedcomp` | 64 / 147 | um pedido com **várias NFs** — é o **recebimento parcial**, regra real e já migrada | **índice sai** (é regra do negócio, não anomalia) |
| ~~`ux_operadores_login`~~ (upper) | 5 / 15 | FLAVIA CARVALHO(2), LAURA(2), NATALIA(2), TESTE(4). LAURA e NATALIA são **par desativado+ativo**; FLAVIA e TESTE têm ativos colidindo, todos na empresa 1 | ✅ **DECIDIDO pelo usuário (26/08): índice PARCIAL + desempate por código** — mig 173. O legado casa `LOGIN+SENHA+EMPRESA` (`uLogin.dfm`, `segLogin`) e fica com a 1ª linha do cursor **sem ORDER BY**; aqui a unicidade vale só para quem nasce no Apollo (`origem_legado <> 'S'`, ativo) e a autenticação escolhe **ativo antes de desabilitado, depois o menor código** |
| `ux_cotacao_forn_itens` · `ux_cotacao_prod` · `ux_cotacao_prodqtde` | 5/25 · 7/14 · 2/4 | item repetido na mesma cotação | **dedup na carga** com regra contada (fica com a linha de maior código) |
| `ux_nf_cod_ped_dev_compra` | 7 / 15 | um pedido de devolução com 2-3 NFs | **índice sai** (mesmo caso do recebimento parcial) |
| `ux_relacao_operador_perfil` · `ux_nfe_naocad_chave` | 2/4 · 2/4 | grade de perfil repetida · mesma chave importada 2× | **dedup na carga** |

Passam limpas (13): `multi_preco`, `estoque`, `empresas`, `configuracoes`, `plano_contas`, `formas_pgto` (×2),
`cotacao_forn`, `apuracao_pc`, `contas_bancarias_op`, `saldo_operador`, `operadoras_taxa`, `apuracao_icms`.
Sem origem no Oracle (nossas): `nfe_evento`, `dre_estrutura`, `caixa_sessao`. Não avaliadas pelo script
(expressão): `arquivo_remessa_areceber` (a coluna tem outro nome lá), `nf_prod_lote` (já saiu na mig 172).

⚠️ **limite conhecido do índice parcial** (registrado, não escondido): ele compara **apenas os cadastros novos
entre si**. Um operador criado no Apollo ainda pode repetir um login que veio da carga — o banco aceita, porque
as linhas do legado ficam fora do índice. O 409 `LOGIN_DUPLICADO` que a tela mostra vem justamente da violação
desse índice (`all-exceptions.filter.ts`), então ele **deixa de disparar** nesse caso específico. Fechar exige
validação de aplicação (recusar login já usado por operador ativo, inclusive do histórico) — entra junto com a
tela de operadores e está na fila de caudas.

**Resumo do que fazer antes do ensaio:** 5 índices saem, 2 viram parciais (chave natural da NF e login), 4 grupos
duplicam na carga com regra contada. O login **já foi decidido e implementado** (mig 173); a carga precisa marcar
`operadores.origem_legado='S'` em tudo que vier do Oracle, senão o índice parcial rejeita os 15 duplicados. Nenhum desses é discutível "no meio da carga" — é por isso
que esta seção existe.

## 7c. Mapa coluna-a-coluna por EVIDÊNCIA — F0 medida (2026-08-26)

Duas ferramentas novas substituem a "spec no papel" da §8.1:
- `apps/api/scripts/dump-schema-destino.ts` sobe o Postgres embarcado com TODAS as migrations e dumpa o schema
  real em `tools/cutover/schema-destino.json` (**207 tabelas · 2.786 colunas · 111 FKs**);
- `tools/cutover/etl/mapa-colunas.py` cruza esse schema com o dicionário do Oracle por fase e aponta o que
  bloqueia a carga.

**F0 (18 tabelas de catálogo) — resultado:**

| achado | tabelas | providência |
|---|---|---|
| **capacidade MENOR no destino** (truncaria) | `det_aliquota` (icm/icm_efetivo/base num(7,2) × NUMBER(13); csosn 4×12; lei 200×500), `familias_prod.descricao` 60×100, `plano_contas.descricao` 120×150 | ✅ **mig 174** alarga |
| tabela do plano que **não existe** no destino | `tributacao` (o nome real é `tributacao_reforma`, e é seed nosso) | corrigir a lista da §3 |
| nome de coluna diferente | `aliquota`: destino `(codigo, descricao)` × origem `(aliquota)` | mapear no ETL |
| colunas da origem não migradas | `cfop` 31 · `familias_prod` 25 · `plc` 14 · `figura_fiscal` 13 · `unidade` 11 · `piscofins` 5 | conferir uma a uma se alguma é REGRA (foi assim que `nao_gera_apuracao_icms` e `proc_qtde` entraram) |

Volumes reais da F0 (do Oracle): ncm 11.215 · figura_fiscal 16.839 · plano_contas 11.024 · cidades 5.564 ·
familias_prod 2.392 · bancos 596 · plc 376 · cfop 395 · det_aliquota 240 · condicoes_pagto 37 · aliquota 33 ·
piscofins 13 · unidade 11 · marcas 1 · operacoes_conta 1 · familias_prod_area 1 · **bairro 0**.

## 7d. PRIMEIRO ENSAIO DE CARGA — F0 rodou (2026-08-26): 15/17 tabelas reconciliadas

`tools/cutover/etl/extrair.py f0` (Oracle → CSV + manifesto com contagem/somas) e
`apps/api/scripts/carregar-cutover.ts f0` (Postgres descartável com todas as migrations → INSERT em lote →
reconciliação contra o manifesto). Resultado do primeiro tiro: **37.474 linhas carregadas, 15 das 17 tabelas
reconciliadas** (contagem e somas idênticas à origem). ncm 11.215 · figura_fiscal 16.839 · cidades 5.564 ·
familias_prod 2.392 · bancos 596 · plc 376 · cfop 395 · demais menores.

**As 2 falhas são achados, não acidentes** — e nenhuma delas apareceria sem rodar:

1. `det_aliquota` — `duplicate key value violates "det_aliquota_pkey"`: **a PK do destino não é única na
   origem**. A varredura de unicidade (§7b) olhou `CREATE UNIQUE INDEX` e `UNIQUE(...)`, **não as PRIMARY KEYs** —
   o script precisa cobri-las (são 207 tabelas com PK declarada no `schema-destino.json`).
2. `plano_contas` — `violates foreign key constraint "fk_plano_contas_pai"`: FK **auto-referente** (conta pai).
   Carga de árvore exige ordem topológica ou `SET CONSTRAINTS ALL DEFERRED` na transação; o carregador ainda não
   faz nenhum dos dois. Vale para toda tabela hierárquica da carga.

## 7e. ⛔ O MAIOR BLOQUEIO DA CARGA: a PK de `vendas` (achado de 2026-08-26, ao estender a varredura às PKs)

A varredura da §7b só olhava índices/constraints `UNIQUE` — **as PRIMARY KEYs ficaram de fora**. Corrigido (agora
são 192 unicidades verificadas, não 32), e o resultado muda a prioridade da carga:

| PK do destino | grupos / linhas repetidas na origem | leitura |
|---|---:|---|
| **`vendas(codvendas)`** | **1.887.781 / 11.370.238** | `CODVENDAS` no Oracle é **por VENDA (cupom), não por linha** — 11.922.255 linhas para 2.439.798 códigos |
| `cx_vendas(codcxvendas)` | 89 / 178 | mesma natureza, escala menor |
| `det_aliquota(aliquota, uf)` | 1 / 5 | foi o que derrubou a tabela no ensaio da F0 |
| `caixa_pdv(codcaixa)` | 1 / 2 | — |

E **não há chave natural única** para `vendas`: `(nropedido, nroitem)` dá 6.576.214 valores distintos e
`(idempresa, nropedido, nroitem)` dá 6.576.230 — ambos muito abaixo dos 11,9M de linhas.

⇒ **Providência (a maior da carga, ainda não aplicada):** `vendas.codvendas` deixa de ser a PK carregada do
legado e passa a ser **surrogate nosso** (a sequence já existe), com o valor do Oracle preservado numa coluna de
referência (`codvendas_legado`, indexada) — é ela que os relatórios de venda usam para amarrar o cupom. Mesmo
tratamento para `cx_vendas`, `det_aliquota` e `caixa_pdv`. Sem isso a F4 (movimento pesado) não carrega **uma
linha sequer** de venda.

## 7f. F0 FECHADA — 17/17 tabelas reconciliadas (2º ensaio, 2026-08-26)

Com as três providências abaixo, o ensaio da F0 passou inteiro: **48.734 linhas, 17 de 17 tabelas com contagem e
somas idênticas à origem**, e nenhuma órfã de FK.

1. **mig 175** — `vendas.codvendas_legado` e `cx_vendas.codcxvendas_legado` (indexados): as duas tabelas já
   nasciam com PK surrogate, então o conserto não foi de schema-de-aplicação — foi impedir a carga de trazer o
   código do Oracle para dentro da PK. O extrator renomeia na origem.
2. **dedup declarado** para PK natural que a origem repete (`det_aliquota` por (aliquota, uf), `caixa_pdv` por
   codcaixa): fica a última linha por chave (ROWID desc) e o extrator **conta e imprime o descarte** —
   det_aliquota entrou com 236 de 240, com as 4 descartadas registradas.
3. **carga com gatilhos suspensos** (`DISABLE TRIGGER ALL` … `ENABLE`) resolve FK auto-referente
   (`plano_contas.pai`, 11.024 contas) sem depender de ordem topológica; em troca, a reconciliação passou a
   **conferir órfãos de TODAS as FKs** da tabela depois da carga, em vez de presumir integridade.

## 7g. F1 mapeada (2026-08-26) — e a lição de medir o DADO, não a declaração

O mapa da F1 (17 tabelas: empresas, configuracoes(+especificas), operadores, perfil/permissoes, parceiros(+end/
bancos), produtos, composicao/decomposicao/receita_prod, codauxiliar, codreferencia_for, multi_preco, estoque,
contas_bancarias, formas_pgto) acusou **20 colunas com declaração menor** que a origem. Só que declaração menor
não é problema: `cnpj varchar(14)` contra `VARCHAR2(30)` nunca estoura. O mapa passou a medir `max(length)` no
Oracle — e sobraram **quatro**:

| coluna | dado real | destino | providência |
|---|---:|---:|---|
| `produtos.descricao` | 126 | 120 | ✅ mig 176 alarga p/ 150 |
| `produtos.descricao_resumida` | 100 | 60 | ✅ mig 176 alarga p/ 100 |
| `produtos.descricao_balanca` | 126 | 60 | ✅ mig 176 alarga p/ 150 |
| `empresas.cnpj` | 18 | 14 | **transformação de carga**, não alargamento: lá o CNPJ vem FORMATADO (`00.000.000/0000-00`); aqui a coluna é de 14 porque o app guarda só dígitos. Alargar aceitaria os pontos e quebraria toda comparação de CNPJ |

Também corrigido: `produto_kit` não existe em **nenhum** dos dois lados — os nomes reais são `composicao`,
`decomposicao` e `receita_prod` (mig 023). A lista da §3 vinha errada desde o início.

Volumes da F1: permissoes 31.448 · produtos 43.116 · parceiros 18.297 (+18.261 endereços) · multi_preco 137.526 ·
estoque 137.524 · codreferencia_for 16.229 · configuracoes 847 (+337 específicas) · operadores 157 · perfil 20 ·
empresas 4.

## 7h. 1º ensaio da F1 — 6/19 tabelas, e cinco classes de achado (2026-08-26)

352.318 linhas carregadas, **6 de 19 tabelas reconciliadas**. As falhas são todas acionáveis:

**Falhas duras (5):**
1. `empresas.idempresa` e `parceiros.idempresa` NOT NULL: a origem chama `CODEMPRESA` — falta **renomeação**
   no extrator (mesmo caso já resolvido para `aliquota` e `vendas`).
2. `codreferencia_for.codfor` NOT NULL: **a origem permite NULL**. Classe nova de achado — `NOT NULL` nosso
   que o dado do cliente viola. Precisa de varredura própria, como fizemos com UNIQUE e PK.
3. `operadores`: violou `ux_operadores_login_novo` — porque o ETL **não está marcando `origem_legado='S'`**,
   que é exatamente o requisito registrado na §7b. O extrator precisa preencher a coluna.
4. `parceiros_end`: violou `ux_parceiros_end_doc` — o índice que a §7b **já mandou remover** e ainda não saiu.

**Metodologia (o ensaio se autocorrigindo):** as "órfãs" reportadas (137.524 em `estoque`, 137.526 em
`multi_preco`, 43.054 em `produtos.codunidade`) são **artefato da ordem alfabética** de carga — `produtos` entra
depois de `estoque`. O carregador precisa (a) ordenar as tabelas por dependência de FK e (b) conferir
integridade **no fim da fase**, não tabela a tabela. Sem isso o relatório assusta sem motivo.

Passaram limpas: configuracoes (847), configuracoes_especificas (337), permissoes (31.448), perfil (20),
formas_pgto (36), receita_prod (117).

## 7i. 2º ensaio da F1 — 12/19 (era 6/19) e o que sobrou é MODELAGEM, não bug

Depois dos folds (mig 177 + extrator): **370.736 linhas, 12 de 19 tabelas reconciliadas**. A ordem topológica
por FK eliminou as 137 mil "órfãs" falsas de `estoque`/`multi_preco`. O que restou é de outra natureza:

| pendência | o que é |
|---|---|
| `parceiros.idempresa` NOT NULL | **no legado o parceiro é GLOBAL** (não tem empresa); no nosso schema é obrigatório. Decisão de modelagem: ou a carga replica o parceiro por empresa, ou a coluna vira nullable/derivada |
| `empresas.razao_social` NOT NULL | a origem tem outro nome para o campo — falta a renomeação (o mapa já apontava "só no destino") |
| `codreferencia_for.codref` NOT NULL | mesma classe do `codfor`: a origem permite NULL |
| `produtos.codunidade → unidade` 43.054 órfãs · `codfor → parceiros` 35.945 | **FKs que o legado não tem**: produto aponta para unidade/fornecedor inexistente. Ou a carga cria os faltantes, ou as FKs viram opcionais |
| `parceiros_end.codparceiro` 18.255 órfãs · `contas_bancarias.codbco` 30 | consequência de `parceiros` não ter carregado (cai junto quando ela entrar) |

Ou seja: a fase deixou de falhar por **mecânica** e passou a falhar por **modelo** — que é exatamente onde um
ensaio de carga tem de chegar. As três primeiras são decisões pequenas; a de `parceiros.idempresa` é do usuário.

## 7j. F1 em 15/19 — e a última pendência é uma decisão de MODELO

Terceiro ensaio: **370.740 linhas, 14/19** (com a mig 180, 15/19). O que caiu desde a §7i:
- `empresas.razao_social`: era só a renomeação (`RAZAOSOCIAL` na origem);
- `codreferencia_for.codref` NOT NULL: origem tem 4 nulos em 16.229 → mig 179 derruba (mesma classe do `codfor`);
- `ux_codref_for`: mig 180 remove — 76 grupos com o mesmo (codfor, codref) apontando para produtos diferentes;
- **as "43.054 órfãs" de `produtos.codunidade` eram artefato**: a conferência comparava com `unidade`, que é da
  **F0** e não existe na fase. Medido no Oracle, os órfãos reais são **3** (unidade) e **7** (fornecedor). O
  carregador passou a ignorar FK cujo alvo não está na fase — e a registrar isso.

**Pendência única e final da F1 — decisão do usuário, agora com os números na mesa.** Corrigindo o que escrevi
na §7i: a tabela `PARCEIROS` do Oracle **tem sim** a coluna `IDEMPRESA` — ela só está quase sempre vazia:

| | linhas |
|---|---:|
| total de parceiros | 18.297 |
| com `IDEMPRESA` preenchida | **575** (empresa 1: 417 · 50: 149 · 2: 9) |
| com `IDEMPRESA` NULA | **17.722 (96,9%)** |

Ou seja: o parceiro é global *na prática*, e a coluna existe para os poucos casos em que a casa quis amarrar o
cadastro a uma loja. Do nosso lado, `parceiros.idempresa` é `NOT NULL DEFAULT 1` (mig 014) — e **nenhum dos 17
pontos que consultam `parceiros` no código filtra por empresa**.

Com isso, a recomendação fica objetiva: **(c) carimbar o default** — a carga leva o `IDEMPRESA` quando existe e
usa 1 quando é nulo, que é exatamente o que o `DEFAULT 1` do schema já diz. Custo zero de código, nenhuma
duplicação de cadastro, e o dado do cliente preservado nos 575 casos em que ele se importou. As opções (a)
replicar por empresa e (b) tornar opcional só fariam sentido se algum filtro de tenant dependesse da coluna — e
não depende.

## 7k. F2 mapeada (2026-08-26) — quase limpa

16 tabelas de documento medidas contra o Oracle: **um único bloqueio de capacidade** —
`inventario.descricao` (dado 126 > destino 120, em 79.190 linhas), mesma medida que `produtos.descricao` já
recebeu na mig 176 → **mig 181**. Nenhum outro campo estoura, e nenhuma tabela falta no destino.

Volumes da F2 (o peso real da carga fora da F4): `balancoitens` 980.574 · `pedidocompra_i` 286.869 ·
`nf_prod` 252.469 · `inventario` 79.190 · `nf` 23.420 · `nfe_xml` 20.355 · `pedidocompra` 10.392 ·
`cotacao_prod` 4.261 · `scrap` 2.878 · `agenda_promocao` 2.028 · demais abaixo de 150.

A F2 depende da F1 (nf → parceiros, produtos), então o ensaio dela só roda depois da decisão de
`parceiros.idempresa` (§7j).

## 7l. F1 FECHADA — 405.108 linhas, 19/19 carregadas (2026-08-26)

Aplicada a recomendação da §7j (a carga preserva `IDEMPRESA` quando existe e usa o default 1 nos 96,9% nulos),
mais a correção de um bug meu no extrator (o FILTRO declarado não estava sendo aplicado no caminho do DEDUP, e
por isso `codref` nulo ainda passava):

- **405.108 linhas carregadas, as 19 tabelas entraram**;
- **17 reconciliam sem nenhuma divergência** (contagem e somas idênticas à origem);
- as 2 restantes carregam 100% e só acusam **órfãs REAIS do legado**: `produtos.codfor` (7) e
  `codreferencia_for.codfor` (11) apontam para parceiros que não existem — os mesmos 7 e 11 medidos direto no
  Oracle. É dado sujo do cliente, não erro de carga: entra no relatório de reconciliação para o cliente decidir
  (criar os fornecedores faltantes ou aceitar a referência solta).

Somando as duas fases já ensaiadas: **F0 48.734 + F1 405.108 = 453.842 linhas** carregadas e reconciliadas
contra a origem, com todas as regras de transformação/dedup/filtro declaradas e contadas.

## 7m. F2 FECHADA — 1.662.682 linhas, as 15 tabelas dentro (2026-08-27)

Do 1º ensaio (2/15) até aqui, cada rodada trocou um erro grosso por um mais fino. O que ficou de permanente
foram **regras gerais no extrator**, não mapas tabela a tabela:

| regra | por que existe |
|---|---|
| `CODEMPRESA` → `idempresa` quando o destino exige e a origem não tem | 6 tabelas de documento caíam juntas |
| `idempresa` nula → **1** (o `DEFAULT 1` do schema) | parceiros, cotacao, pedidocompra, inventario |
| coluna `NOT NULL` com **default declarado** → usa o default (numérico **ou** texto) | dezenas de flags e percentuais; o regex que só via número deixou `pedidocompra.fechado` passar duas rodadas |
| coluna `NOT NULL` sem equivalente na origem → entra como constante com o default | idem |
| `FILTROS` (descarta e conta) | item de pedido sem produto, pedido sem fornecedor, `codref` nulo |
| `DEDUP` (fica a última, conta o descarte) | PK/único que a origem repete |
| LOB/`bytes` → texto ou hex | o XML da NF-e derrubava a extração |

Migrations do caminho: **182** (chave natural da NF) e **183** (NF de devolução) passaram a excluir o histórico
carregado via `origem_legado`, como o login (173) e o CNPJ do endereço (178) — sempre estendendo o predicado,
nunca removendo a proteção, porque nos dois casos o índice é backstop transacional do app.

**Sobram 2 avisos, ambos dado real do cliente:**
- `inventario → inventario_livro`: **13.611 órfãs — confirmadas no Oracle** (o legado tem 20 livros e 79.190
  linhas de contagem apontando para livros que não existem mais). Vai para o relatório do cliente;
- `pedidocompra_i → pedidocompra`: **3 órfãs**, resto dos 12 pedidos sem fornecedor que a carga descartou.

Somando as três fases ensaiadas: **F0 48.734 + F1 405.108 + F2 1.662.682 = 2.116.524 linhas** carregadas e
reconciliadas contra a origem.

## 7n. F3 FECHADA — 1.452.387 linhas, as 12 tabelas dentro (2026-08-28)

Financeiro carregado: **12 de 12 tabelas, 10 reconciliando sem divergência**. `diario` 888.243 ·
`mov_contas_bancarias` 144.448 · `cartao` 125.240 · `caixa` 121.684 · `areceber` 49.584 ·
`movimentacao_bancaria_ofx` 37.551 · `apagar` 26.339 · `apagar_bx` 24.809 · `cx_apagar` 24.512 ·
`areceber_bx` 9.411 · `adiantamento_forn` 563 · `apuracao_pc` 3.

Achados (migs 184-186), todos medidos:
- **o legado guarda PALAVRA onde assumimos flag**: `caixa.tiporecurso` char(1) × 'DINHEIRO'/'BOLETO'/'CARTOES',
  `gerado` × 'SISTEMA', `origem` × 'TRIGGER CAIXA_PAGAR'. Alargadas — nenhuma tem lógica no app;
- **coluna inteira recebendo texto**, duas na mesma tabela: `caixa.nrparcela` vem `"1/3"` (parcela/total) e
  `caixa.formapgto` vem `'BOLETO'`. Transformação na extração;
- **razão sem uma das pernas**: 26.946 linhas sem contacredito, 29.475 sem contadebito, 718 sem idorigem — de
  888.243. `NOT NULL` nosso, removido;
- **FITID reusado pelo banco** (77 grupos) e **54 adiantamentos com vencimento anterior ao adiantamento** (a
  regra do legado vive no `btnGravarClick`, valida na tela e nunca impediu o histórico).

Sobram 2 avisos, **órfãs reais confirmadas no Oracle**: `apagar_bx → apagar` (370) e `cx_apagar → apagar` (712)
— baixas e lançamentos de caixa apontando para títulos que não existem mais.

**Total ensaiado até aqui: F0 48.734 + F1 405.108 + F2 1.662.682 + F3 1.452.387 = 3.568.911 linhas.**
Falta a F4 (movimento pesado: vendas 11,9M, cx_vendas, historico_prod…), onde o `codvendas_legado` da mig 175
será exercido.

## 7o. ⚠️ CORREÇÃO (o usuário, 28/08): o Oracle que medimos é HOMOLOGAÇÃO

A leitura abaixo — "o movimento parou em fev/2024" — está **errada na causa**. O banco `pinheirao@192.168.1.230`
é de **homologação**: a data-marco de fev/2024 é quando a cópia/replicação parou, não quando o cliente parou de
operar. Em produção o dado continua.

O que isso invalida e o que sobrevive:

| conclusão | status |
|---|---|
| "não há carga incremental de venda" | ❌ **falsa**. A decisão **big-bang × delta volta a valer**, e a F4 volta a dimensionar a janela |
| volumes usados para dimensionar (11,9M vendas, 3,5M já ensaiados) | ⚠️ **piso, não total** — produção tem mais, e a proporção entre fases pode mudar |
| tudo que foi decidido por **FONTE** (Delphi/dicionário): regras, fórmulas, quirks, nomes de RBAC, capacidades de coluna, unicidades violadas | ✅ **vale** — não depende de volume |
| veredictos de "morto/dormente" que usaram **ausência de dado recente** como argumento (cluster GIROS, fechamento diário, lote/validade, coleta do rotativo, `REDUCAOZ` vazia) | ⚠️ **precisam de reconferência contra PRODUÇÃO** antes de virar decisão final. O argumento de fonte (procedure de cache, `btnGravar` comentado, `if IsEmpty`) continua de pé; o argumento "ninguém usa mais" não |

⇒ **ação registrada:** antes do cutover, repetir contra o banco de produção (a) a varredura de unicidade
(`tools/cutover/varre-unicidade.py`), (b) o mapa de capacidades por fase e (c) as medições de liveness que
sustentaram rebaixamentos. As ferramentas já aceitam outro DSN — é trocar a conexão, não reescrever.

## 7o-bis. O que a partição por mês mostrou no banco de homologação

Ao particionar a extração de `vendas` por mês, julho/2026 veio **vazio**. Medindo a série inteira:

| ano | linhas |
|---|---:|
| 2018 | 2.346.244 |
| 2019 | 2.222.959 |
| 2020 | 1.342.732 |
| 2021 | 1.979.471 |
| 2022 | 1.923.457 |
| 2023 | 1.834.032 |
| **2024** | **272.980** |
| 2025 | **302** |
| 2026 | **78** |

E o mês exato: 2023-12 = 197.552 · 2024-01 = 218.197 · **2024-02 = 54.654** · **2024-03 = 9**. É a mesma
data-marco do cluster GIROS, do fechamento diário, do lote/validade e da coleta do rotativo — **fev/2024**.

Consequências para o cutover, e são grandes:
1. **não existe carga incremental de venda a fazer**: a `vendas` é 100% histórico. A decisão "big-bang × delta"
   da §7, que existia por causa do movimento, perde o objeto — não há movimento novo entrando no Oracle;
2. a F4 deixa de ser a fase que dimensiona a janela. Ela é grande (11,9M linhas) mas **fria**: pode ser
   carregada ANTES da virada, em qualquer ritmo, e conferida com calma;
3. reforça o que o recon já vinha dizendo: a operação no legado esvaziou em fev/2024. Vale confirmar com o
   usuário **o que o cliente usa hoje** — porque isso decide se o cutover é uma virada ou uma adoção.

(nota de método: as outras tabelas da F4 ignoraram a partição porque não têm `DTVENDA` — cada uma precisa da
sua própria coluna de data. `cx_vendas` 1.515.042 e `historico_prod` 2.874.283 saíram inteiras no piloto.)

## 8. Próximos passos de execução (quando aprovado)

1. Spec por tabela da F0/F1 (mapa coluna-a-coluna gerado dos dicionários + revisto à mão).
2. Esqueleto do ETL (runner com checkpoint/retomada + relatório de reconciliação).
3. Ensaio F0+F1 → validação → iterar pelas fases.
