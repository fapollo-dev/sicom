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

**Decisão do usuário (28/08): seguir com o banco de homologação.** O ensaio, as migrations de capacidade e os
veredictos de unicidade ficam calibrados por ele — o que é suficiente para construir, e é o que temos. Fica
então **um item de checklist da virada, não um bloqueio do desenvolvimento**: rodar as três ferramentas contra
produção **antes** da janela (não durante), porque unicidade nova, coluna que estourou e volume real só
aparecem no dado de lá. Se aparecer violação nova, é migration — e migration na madrugada da virada é o que
esse checklist existe para evitar.

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

## 7p. F4 extraída — 17.374.630 linhas em 8m43s (medição de referência)

Extração completa do movimento, no banco de homologação: **17.374.630 linhas · 3,0 GB de CSV · 523 s**
(≈33 mil linhas/s). Detalhe: `vendas` 11.922.255 (50 colunas) · `historico_prod` 2.874.283 · `cx_vendas`
1.515.042 · `historico_dinamico` 1.029.760 · `nfe_nao_cadastradas` 20.581 · `caixa_pdv` 12.709.

É a primeira medição de **taxa** do projeto, e ela serve para dimensionar a janela — lembrando que o volume de
produção é maior (§7o), então o número real escala junto.

## 7q. F4 FECHADA — 17.374.630 linhas carregadas e reconciliadas (2026-09-01)

As seis tabelas do movimento entram inteiras no Postgres novo, contagem batendo com o manifesto:

| tabela | linhas |
|---|---|
| `vendas` | 11.922.255 |
| `historico_prod` (kardex) | 2.874.283 |
| `cx_vendas` | 1.515.042 |
| `historico_dinamico` | 1.029.760 |
| `nfe_nao_cadastradas` | 20.581 |
| `caixa_pdv` | 12.709 |

Com isso o **ensaio das cinco fases fecha em 20.943.541 linhas** (F0 48.734 · F1 405.108 · F2 1.662.682 ·
F3 1.452.387 · F4 17.374.630).

### O que segurou o kardex, e o que era de fato

Três diagnósticos errados meus na mesma tabela, todos com a mesma raiz: eu li "a coluna chega vazia" como "o
legado permite nulo" e derrubei a obrigatoriedade duas vezes (migs 188 e 189) antes de olhar o dicionário. As
colunas simplesmente **não existem no legado com esses nomes** — lá o kardex é nomeado por *alteração* e
*atual*:

| destino | origem | como sai |
|---|---|---|
| `qtde` | `QTDE_ALTER` | direto (com `nvl(...,0)`) |
| `saldo_novo` | `QTDE_ATUAL` | direto |
| `origem` | `ORIGEM_DOCUMENTO` | direto, com o **DEFAULT `'NF'`** do nosso schema |
| `saldo_anterior` | — | **derivada**: `QTDE_ATUAL − QTDE_ALTER` |
| `tipo` | — | **derivada**: `'S'` se o delta é negativo, senão `'E'` |

A mig **190** restaura o `NOT NULL` de `tipo` e `qtde` que as 188/189 tinham afrouxado: com o mapa certo elas
chegam completas nas 2.874.283 linhas, e o kardex é a tabela que sustenta a Ficha de Movimentação — não deve
aceitar movimento sem tipo nem sem quantidade.

`origem` é o caso oposto, e aqui **quem cede é o destino, não a carga**: o legado deixa `ORIGEM_DOCUMENTO`
nulo em **779.082 das 2.874.283 linhas (27%)**, e todas elas são movimento de nota (têm `CODNF` e o histórico
fala de NF). Não é preciso migration nenhuma: a coluna já nasceu `NOT NULL DEFAULT 'NF'` (mig 027), e o
extrator aplica o default automaticamente. As origens preenchidas são `VENDAS` (2.086.336), `PEDIDOS` (8.809)
e `SCRAP` (56) — o resto é NF, exatamente como o default assume.

O bug do extrator que escondia isso: a regra de defaults procurava o nome do **destino** entre as colunas da
origem. Com renomeação (`origem` aqui, `ORIGEM_DOCUMENTO` lá) ela nunca achava e o default não era aplicado.
Corrigido com o de-para inverso; o extrator também passou a aceitar uma lista de tabelas no lugar da fase,
para reextrair uma só depois de corrigir o mapa dela.

### ⚠️ Pendência declarada desta seção

O CSV do kardex usado na carga é o da extração de **28/08**, anterior à correção do de-para — a coluna `origem`
saiu vazia nele. Como o Oracle de homologação caiu no meio do trabalho (`DPY-6005: host is down`, 192.168.1.230),
a carga foi feita com um CSV **derivado**, preenchendo os 779.082 vazios com o mesmo `'NF'` que o extrator
corrigido produz. A reconciliação vale (2.874.283/2.874.283), mas **a reextração de `historico_prod` pelo
extrator corrigido fica pendente** e entra no checklist da virada, junto com a conferência contra produção.

Nota de dado, contra a premissa de fev/2024: o kardex vai de **02/01/2023 a 21/08/2026** — diferente dos
clusters que param em fevereiro de 2024, este está vivo até a data da cópia.

## 7r. O ensaio inteiro estava reconciliando SÓ POR CONTAGEM (2026-09-01)

Achado contra o próprio ensaio, e o pior tipo: o que passa verde. Os **69 manifestos das cinco fases saíram com
`somas: {}`** — 20.943.541 linhas conferidas apenas por contagem. Contagem igual não prova valor igual: coluna
deslocada, decimal truncado, separador mal lido, tudo isso passa.

A causa é de uma linha. O `python-oracledb` entrega `NUMBER` como **float**, e o acumulador do extrator só
somava `Decimal` — nenhuma coluna caía no `if`, e de quebra o CSV de dinheiro saía com ruído de ponto flutuante.
Corrigido com `oracledb.defaults.fetch_decimals = True`.

Para não depender de uma nova janela do Oracle (que caiu no meio deste trabalho), o
`tools/cutover/etl/somar-csv.py` recalcula as somas dos CSVs já em disco e as grava no manifesto, marcadas com
`somas_origem: 'csv'`. ⚠️ **o que isso prova e o que não prova**: a soma sai do CSV, então confere o trecho
**CSV → Postgres** (parsing, tipo, escala, truncamento). O trecho **Oracle → CSV** só é conferido quando o
extrator gera o manifesto com o banco de pé — é o que a reextração pendente do §7q fecha.

Antes de acreditar no verde, o detector foi testado contra si mesmo: adulterando uma soma da F0 em +7, o
carregador acusou (`bancos: codbco Σ 177731 × 177738.0`, 16/17 tabelas). Não é falso-verde.

### O que a reconciliação de valores achou

| fase | resultado |
|---|---|
| F0 | 17/17 — valores batem |
| F1 | 19/19 — valores batem (2 tabelas marcadas por **órfãs de FK**, já confirmadas reais no Oracle) |
| F2 | **`nf_prod` com 6 somas fora** → causa real, ver abaixo |
| F3 | 12/12 — valores batem (2 marcadas por órfãs de FK conhecidas) |
| F4 | valores batem nas 5 tabelas carregadas |

**`nf_prod` era truncamento de escala, não erro de carga** (mig **191**): as colunas são `numeric(13,2)` e o
legado guarda até **seis** casas — `desconto` 6.418919 · `frete` 81.505672 · `bonificacao` 2.146742 ·
`mva` 0.0001 · `seguro` 0.0611 · `vrbasecalculo` 440.2748. O Postgres arredondava em silêncio. E não é
preciosismo: `DESCONTO` é **percentual** e entra no valor do item pela fórmula que a apuração de ICMS já copia
(`(VRCUSTO − VRCUSTO × DESCONTO/100) × QTDE`) — arredondar 6,418919% para 6,42% muda o item, a base e o
imposto. Escala nova pelo que o dado exige, precisão preservando os 11 dígitos inteiros que já cabiam:
`numeric(15,4)` em mva/seguro/vrbasecalculo e `numeric(17,6)` em desconto/frete/bonificacao. Com a migration a
F2 fecha em `nf_prod: 252469/252469`, sem divergência de soma.

A varredura que produziu isso (`tools/cutover/etl/escala-numerica.py`) passou pelas **cinco fases** e não achou
nenhuma outra coluna numérica fora de escala, nem nenhuma com dígitos inteiros além da precisão declarada —
essas seis são o universo do problema. Vale lembrar que precisão insuficiente não arredonda: **rejeita** a
linha (`numeric field overflow`), então esse lado também estava sem cobertura até agora.

## 7s. PRODUÇÃO medida pela primeira vez (2026-09-02) — SOMENTE LEITURA

O usuário liberou a base de produção (`hiperpinheirao.ddns.com.br`, SID `apollo`) **só para observação — "NÃO
ALTERAR NADA"**. Toda sessão abre com `SET TRANSACTION READ ONLY` e os scripts do cutover passaram a aceitar
`ORACLE_HOST` (padrão continua a homologação). Primeiro retrato, tirado às 14h21 de 02/09 com a loja operando
(última venda do mesmo minuto):

### Volume: 45.240.749 linhas nas 69 tabelas do plano — **2,16× a homologação**

| fase | homolog | produção | razão |
|---|---|---|---|
| F0 | 48.734 | 48.909 | 1,00× |
| F1 | 405.108 | 575.132 | 1,42× |
| F2 | 1.662.682 | 1.133.474 | 0,68× (ver abaixo) |
| F3 | 1.452.387 | 4.657.066 | **3,21×** |
| F4 | 17.374.630 | 38.830.262 | **2,23×** |

Os saltos que dimensionam a janela: `vendas` 11,9M → **18,9M** · `historico_prod` 2,87M → **14,55M (5×)** ·
`cx_vendas` 1,5M → 3,3M · `cartao` 125k → **2,04M (16×)** · `diario` 888k → 1,75M · e todo o financeiro da F3
DOBROU. Pela taxa medida na homologação (~33 mil linhas/s na extração, ~26 mil/s na carga), a F4 sozinha passa
de 20 min para **~45 min de extração + ~50 min de carga** — e isso pela internet, não na rede local.

### A homologação NÃO é um retrato de produção — tem dado que produção não tem

Várias tabelas são **menores** em produção: `aliquota` 33 → **12** (a homolog tem 21 códigos T10…T66 que não
existem em produção), `det_aliquota` 236 → 195, `inventario` 79.190 → 15.441, `balancoitens` 980.574 →
295.056, `pedidocompra_i` 286.853 → 207.401, `composicao` 161 → 61, `receita_prod` 117 → 86, `perfil` 20 → 15.
Ou seja: a homologação carrega **massa de teste** por cima da cópia. Consequência direta para o que fizemos até
aqui — todo veredicto tirado "do golden" sobre TABELA DE REFERÊNCIA (alíquotas, det_aliquota, perfis, receitas)
precisa ser reconferido contra produção antes da virada; os 47.651 produtos de produção referenciam só as 12
alíquotas reais (0 fora da tabela). O que cresce muito (operadores 157 → 284, permissoes 31k → 57k, empresas
4 → 5: entrou a 52 "PINHEIRAO SERVIÇOS ADMINISTRATIVOS") é operação de 2024-2026 que a homolog nunca viu.

### Uma tabela ficou FORA do ensaio inteiro: `LOTEPRECO`

Está no plano como `lote_preco` (nosso nome) e o extrator procurava `LOTE_PRECO` no Oracle, que não existe —
saiu como "pulada: nenhuma coluna casa" nas cinco rodadas, sem ninguém notar. Em produção tem **96.569 linhas**
(a fila do Ajuste de Preços). 19 das 20 colunas do destino casam; 4 só no Oracle (`codpedcomp`,
`etiqueta_impressa`, `permitealteracao`, `vrcusto_anterior`) e 1 só nossa (`dtcadastro`). Corrigido com o mapa
`TABELA_ORIGEM` no extrator e no mapa-colunas; entra na próxima extração.

Produção tem **866 tabelas** (homolog: 841) — as 25 novas ainda não foram listadas (pendente).

### ⛔ O plano de carga tinha um BURACO: 77 tabelas do destino existem no Oracle e não estavam em NENHUMA fase

Cruzando o schema de destino (207 tabelas) com o `user_tables` de produção: **77 tabelas** existem nos dois
lados e **não estão nas cinco fases** — o plano era uma lista mantida à mão, e ela cobria os 69 "principais" e
esquecia os FILHOS. Somam **~5,0 milhões de linhas** em produção. As maiores:

| tabela | linhas (prod) | de quem é filha |
|---|---|---|
| `apuracao_icms_detalhes` | 2.801.160 | apuração de ICMS (épico fechado em ago/2026 — a tabela que nós mesmos criamos para receber isto) |
| `historico_pdv` | 675.912 | PDV (fora da regra de funcionalidade, mas o dado histórico existe no destino) |
| `nfe_nao_cadastradas_itens` | 209.322 | `nfe_nao_cadastradas` (que ESTÁ na F4 — o filho ficou de fora) |
| `estoque_dep` | 203.311 | estoque de depósito (o balanço e o rotativo dependem dele) |
| `audit_permissoes` | 141.734 | RBAC |
| `scrap_item` | 132.644 | `scrap` (na F2; o filho não) |
| `nf_prod_lote` | 131.403 | `nf_prod` (o rastro — corte-1 entregue e sem carga!) |
| `nfe_eventos` | 106.720 | eventos da NF-e |
| `agenda_promocao_itens` | 46.366 | `agenda_promocao` (na F2; o filho não) |
| `nf_forma_pagamento` | 43.825 | NF |
| + 67 menores | ≈ 590k | `ajuste_estoque` 14k · `nf_referencia` 11k · `analise_pedido_nf*` 5 tabelas · `inventario_rotativo` 1.329 · `situacao_nf` · `motivos_operacao` · `indexador_tributario` 12k … |

Isso muda a leitura do §7q: o ensaio "das cinco fases" provou a carga de **69 tabelas**, não do destino. A
correção certa não é alongar a lista à mão de novo — é o extrator **derivar** o universo: toda tabela do destino
que exista no Oracle (com o mapa de nomes), fase pela **profundidade no grafo de FKs** do destino, e uma lista
explícita de EXCLUSÕES com motivo. Assim tabela nova aparece sozinha e "pulada" vira exceção declarada.

**Feito** (`tools/cutover/etl/plano-universo.py` → `tools/cutover/plano-tabelas.json`): o universo derivado tem
**145 tabelas em 5 fases** (f0 73 · f1 42 · f2 23 · f3 6 · f4 1 — a fase agora é a PROFUNDIDADE no grafo de FKs
do destino, não mais "referência → movimento"; o que importa para a carga é a ordem, e ela sai do grafo). Duas
exclusões declaradas (`historico_pdv` e `hist_sangria_suprimento`: PDV, por instrução do usuário) e 13 tabelas só
do destino (nossas). **75 novas em relação ao plano antigo, 4.306.853 linhas em produção** (70 com dado; 5 vazias).
O extrator e o mapa de colunas passaram a ler o JSON; a lista digitada ficou como fallback e registro.

Outras correções da mesma rodada: o `varre-unicidade.py` passou a honrar o **predicado do índice parcial** (acusava
`relacao_operador_perfil` por pares soft-delete 'E' + 'I' que o índice `WHERE coalesce(indr,'I') <> 'E'` permite),
`cotacao_prodqtde` ganhou DEDUP (2 pares idênticos em produção), e o `schema-destino.json` estava **defasado desde
26/08** (antes das migs 184-191) — os "não cabe" de `caixa`/`mov_contas_bancarias` que o mapa acusou em produção eram
o retrato velho; re-dumpado, produção cabe inteira (só `empresas.cnpj` com máscara, que a transformação já limpa).

Com o universo derivado, o mapa de capacidade rodou nas **145 tabelas contra produção**: 2 casos, os dois já
tratados por transformação — `empresas.cnpj` (18 com máscara → 14 dígitos) e `apuracao_pc_det.tipo` ('ENTRADA'/
'SAIDA NF'/'NFC-e' → 'C'/'D'). Nenhuma coluna de texto de produção estoura o destino.

## 7t. As 70 tabelas novas carregadas de PRODUÇÃO (2026-09-02)

Extração das 70 tabelas que o plano antigo não cobria, direto de produção (só SELECT; 4,3M linhas, 729 MB em
~20 min pela internet), carga no Postgres descartável e reconciliação de contagem **e somas** (agora o manifesto
traz as somas do Oracle, então este é o primeiro trecho Oracle → CSV → Postgres conferido de ponta a ponta).

**Primeira passada: 54/70.** Os 13 bloqueios eram todos de MAPA ou de SCHEMA nosso — nenhum de carga:

| tabela | o que era | correção |
|---|---|---|
| `agenda_promocao_itens` · `scrap_item` · `contas_bancarias_op` | 9 · 7 · 2 linhas sem produto/operador (o legado aceita nulo; item sem produto não significa nada) | FILTRO com contagem do descarte |
| `apuracao_pc_det.tipo` | legado guarda texto ('ENTRADA' 118 · 'SAIDA NF' 27 · 'NFC-e' 48); o nosso é o papel na apuração ('C'/'D') | mapa semântico: ENTRADA → C, resto → D |
| `arquivo_remessa_areceber` | 69 nomes de arquivo REUTILIZADOS (até 3×, na mesma conta) e sem `codempresa`; o índice único era invenção nossa | mig 193: índice PARCIAL com `origem_legado` (padrão das migs 173/182/183/186/188) |
| `config_plano_contas.mascara` | o legado guarda a máscara como `NDIG_1..NDIG_8`; a nossa é o CSV '1,1,2,2,5' | CALCULADA na extração (concatena os níveis) |
| `indexador_tributario` | 4 NOT NULL da mig 008 (pré-recon) que o legado não tem; e a alíquota lá se chama ALIQUOTA | RENOMEIA + mig 193 derruba os 4 NOT NULL |
| `log_liberacoes.id` | `GENERATED ALWAYS` recusa o id do legado | mig 193: BY DEFAULT |
| `operadoras.operadora` | 1 operadora sem nome em produção (cod 921, ativa) | marcador explícito '(SEM NOME NO LEGADO)' em vez de afrouxar o schema por 1 linha |
| `pedido_devolucao_compra` | nomes com underscore no legado (`cod_parceiro`, `data_pedido`, …) | RENOMEIA (8 colunas) |
| `clube_desconto.idempresa` | VARCHAR2 com LISTA ('1,2' em 4 linhas; NULL em 3.019) | primeira empresa da lista; perda declarada: 4 linhas deixam de valer para a empresa 2 |
| `icms_cfop.tipo` | o legado não tem a coluna | CALCULADA pelo 1º dígito do CFOP |
| `nfe_nao_cadastradas_itens.vrunitario/…trib` · `indexador_tributario.mva` | 9 e 4 casas decimais × numeric(15,6)/(7,2) — as somas não fechavam | mig 192 (numeric(21,10) pelo leiaute da NF-e; (9,4)) |

Dois achados que são de RUNBOOK, não de tabela:
- **o TRUNCATE leva as sementes das migrations**, e uma delas é PAI de dado legado: o motivo 999 (4.874 ajustes de
  estoque em produção apontam para ele, e produção também não tem a linha — lá não há FK). Nasceu
  `tools/cutover/pos-carga.sql`: o que o Apollo exige e o legado não tem, reaplicado no fim da carga, idempotente.
- **as SEQUÊNCIAS não eram reposicionadas**: a carga grava os ids do legado em colunas serial/identity e o primeiro
  INSERT do app depois da virada colidiria. O carregador agora faz `setval(max)` em toda coluna com sequência das
  tabelas carregadas — e conta quantas.

**Resultado final: 70/70 carregadas, 4.306.813 linhas, contagem e somas batendo em 68** — as duas restantes são
informativas, não erro: `apuracao_pc_det.id_tipocredito` é NUMBER no Oracle e varchar aqui (valores 101/106,
os mesmos que o SPED grava como texto — soma não comparável por tipo), e `clube_desconto` tem **3.022 de 3.069
linhas apontando para promoções que não existem** em PROMOCAO nem em AGENDA_PROMOCAO (o Oracle não tem a FK;
ids como 631532/993095 parecem vir de outro sistema). A FK nossa foi recriada `NOT VALID` — vale para toda
linha nova e declara que o legado não passa por ela — e o caso vai para o relatório do cliente. Terceiro achado
de runbook nesta rodada, também genérico no carregador: **órfã legada sob FK nossa entra com gatilhos
suspensos e o Postgres segue achando a FK validada** — estado latente que um `pg_restore` ou um `VALIDATE`
denunciariam na pior hora.

O carregador ganhou dois modos para o **ensaio de operação**: `todas` (carrega as fases do `plano-tabelas.json`,
em ordem, no MESMO Postgres, com pós-carga/sequências/órfãos rodando uma vez no fim, e o tempo por tabela) e
`--manter` (não derruba o banco: imprime as variáveis para apontar a API — `PGPORT=5433` etc. — e fica vivo até
Ctrl+C). É com isso que a próxima etapa sobe o Apollo sobre a base de produção carregada.

## 7u. Reconferência dos veredictos de REFERÊNCIA contra produção (2026-09-02)

A homologação carrega massa de teste (§7s), então todo veredicto tirado "do golden" sobre tabela de referência
precisava ser reconferido. Comecei pelas **configurações**, que são as que viram regra no código. As 30 chaves
que o app lê, medidas em produção:

**Iguais ao que o código assume** — `VRCUSTO_INVENTARIO` = PRODUTO · `ATIVO_PELA_MULTIPRECO` = N ·
`ESTORNA_FINANCEIRO_NF` = N · `PERMITE_PROC_NF_ESTOQUE_NEG` = S · `TIPO_PRECIFICACAO` = P ·
`INVENTARIO_ROTATIVO_DIGITO_SEPARADOR` = / · `INVENTARIO_ROTATIVO_ESTOQUE_DEPOSITO` = N.

**Diferente da homologação, e muda comportamento:** `PERMITE_PRODUTO_MAIS_UMA_AGENDA` é **'N' em produção** e era
'S' no golden da homologação. O código está certo (lê a config), mas o veredicto que registrei — "default 'S' =
permissivo, fiel ao legado" — descrevia a homologação: **no cliente a anti-sobreposição de promoção está
LIGADA**. Como a config vem na carga, o comportamento pós-virada será o de produção; o que muda é a expectativa
de quem lê o dossiê.

**Não existem em produção** (são nossas, do app): `AUTH_MAX_TENTATIVAS_LOGIN`, `AUTH_BLOQUEIO_LOGIN_MINUTOS`,
`FUSO_HORARIO_ACESSO`, `VALOR_MAXIMO_DIARIO_PC`. Como o `TRUNCATE` da carga apaga o que as migrations semeiam,
**elas precisam entrar no `pos-carga.sql`** — senão o app pós-virada fica sem bloqueio de login por tentativa e
sem fuso (a lição 17 inteira depende de `FUSO_HORARIO_ACESSO`). ⚠️ pendência aberta.

### ⚠️ Uma incerteza que o fonte não resolve

`USUARIOS_ZERAM_ESTOQUE_INVENTARIO` (id 46) e `USUARIOS_ZERAM_INVENTARIO_ROTATIVO` (id 701) são declaradas como
**S/N** (`valorespossiveis = 'S;N|Sim;Não'`), e em produção valem **N** e **S** — sem nenhuma linha em
`configuracoes_especificas`. A nossa implementação ignora o valor global e monta a lista só das específicas
(`tipo='Usuario'`, `valor='S'`), o que dá "ninguém pode" nos dois casos. Para o id 46 (valor N) o resultado
coincide; para o **id 701 (valor S)** pode ser que o legado entenda "todos podem" — e aí divergimos.

Não dá para decidir pelo fonte: `GetUsuariosPermitidos` vive em `USessao.pas`, que **não está no repositório
clonado** (lição 35). Fica registrado como pergunta ao cliente / conferência na tela do legado, e não como
suposição implementada.

### Tributação: cobertura completa (a parte boa)

A outra reconferência que importava era a da **tributação por UF**, porque um produto cuja alíquota não tenha
linha em `det_aliquota` para a UF da empresa faz a precificação e a apuração levantarem `ALIQUOTA_NAO_CADASTRADA`.
Medido em produção: **zero** produtos nessa situação — os 47.651 têm cobertura em MG (13 linhas para as 12
alíquotas reais), e as outras 26 UFs têm 7 cada. As 21 alíquotas T10…T66 que existiam na homologação eram massa
de teste e não são usadas por nenhum produto do cliente.

## 7v. ENSAIO DE OPERAÇÃO — o Apollo rodando sobre PRODUÇÃO (2026-09-03)

O ensaio de carga provava que o dado entra. Este prova que o **sistema funciona em cima dele**.

### Carga completa: 49.651.289 linhas em 28,3 min · 145/145 tabelas, contagem batendo em todas

| tabela | linhas | tempo |
|---|---|---|
| `vendas` | 18.883.845 | 1.067,7 s (17,8 min) — 51 colunas, ~17,7 mil linhas/s |
| `historico_prod` | 14.554.098 | 262,6 s |
| `apuracao_icms_detalhes` | 2.801.160 | — |
| `cartao` | 2.043.606 | — |
| `historico_dinamico` | 1.985.019 | 37,5 s |
| `diario` | 1.746.160 | — |

Nenhum `⛔`. Os 20 `⚠️` são de dois tipos, ambos esperados: **soma não comparável** (11 casos — coluna que é
NUMBER no Oracle e texto no destino: `cfop`, `codcontabil`, `numero`, `versaoxml`, `origemprod`…) e **órfã de FK
nossa** (13 casos, todas recriadas `NOT VALID`). A maior é `diario.codlote` → **1.744.994 órfãs (99,9%)**, porque
`LOTE_CONTABIL` está vazia em produção; depois `cartao.codoperadora` 36.924 e `clube_desconto.idpromocao` 3.022.
`[sequências] 99 reposicionadas` e o pós-carga aplicado.

### As telas, com o volume real

`tools/cutover/ensaio-operacao.sh`, operador real do cliente (cod 4, 1.079 grants), agosto/2026:

| | resultado |
|---|---|
| cadastros (produtos, parceiros, operadores, bancos) | 200 · **0,00 a 0,09 s** |
| documentos (NF, AR, AP, pedidos, inventários) | 200 · **0,00 a 0,05 s** |
| 9 relatórios sobre o movimento | 200 · **0,01 a 0,41 s** (o mais lento é `sem-movimento`, com 7,8 MB de resposta; `curva-abc` 0,18 s / 1,6 MB) |

**Nenhuma falha.** Os dois não-200 são comportamento correto: `apuracao-icms/obter` devolve 422
`APURACAO_NAO_ENCONTRADA` (não há apuração gravada para agosto — o endpoint é o de *obter*, não o de processar) e
`sped/apuracao-pc` devolve 403 porque o operador 4 não tem esse grant no RBAC do cliente.

E o dado é o real: `vendas-data` de 01/08 traz **1.016 cupons, R$ 55.346,35**, empresa "HIPER PINHEIRAO -
MARTINS". Não é resposta vazia.

### Âncoras Oracle × Postgres, e a régua certa

A primeira rodada do `conferir-ancoras` acusou 15 diferenças "sem explicação" — `vendas` +6.802,
`historico_prod` +7.915, `caixa` +308. Não era perda de carga: **é a loja operando** entre a extração (02/09) e a
conferência (03/09). A régua certa é o MANIFESTO (o que a extração leu), não o Oracle de agora. Corrigido, o
resultado é **igual ao extraído nas 16 âncoras**, e a coluna "ORACLE agora" virou a medida de quanto o legado
andou — que numa virada real, com o legado congelado, **tem de ser zero**. É o §1 do runbook virando teste.

## 7w. ⛔ PARADA DE VIRADA — o RBAC do app não é o RBAC do cliente (2026-09-04)

O ensaio de operação só lia; o de **escrita** (`tools/cutover/ensaio-escrita.sh`) tentou operar, e foi ele que
achou o problema mais sério até agora.

### O que funcionou

**As sequências.** Criar uma NF nova sobre a base carregada devolveu `codnf 161734` (o máximo do legado é
161733) e o DELETE em seguida deu 204. Era o teste principal do `setval(max)` — sem ele, o primeiro documento
do dia seguinte à virada morreria com *duplicate key*. Passou.

### O que NÃO funcionou

Processar a nota: **403 SEM_PERMISSAO** — e não é o operador, é o RBAC. `FRMNF/BTNPROCESSAR` **não existe para
nenhum operador** no cliente. O que o cliente tem em `FRMNF` é outro vocabulário: `ENVIARNFE1`, `GERARNFE1`,
`CANCELARNFE1`, `IMPRIMIRDANFE1`, `BTNFATURAMENTO`, `BTNINUTILIZARNFE`, `STATUSNFE2`, `AJUSTEST1`…

Cruzando **tudo** que os controllers exigem (`@RequerAcesso` + o par BTNGRAVAR/BTNEXCLUIR que o factory de CRUD
impõe) com as permissões reais de produção:

> **176 pares exigidos · 85 existem · 91 FALTAM**, em 36 formulários.
> Destes, **50 são de formulário que nem existe** no cliente (tela nossa ou renomeada).

O relatório por formulário está em `tools/cutover/rbac-faltante.md`. Exemplos do tamanho do estrago:
`FRMNF` tem 65 operadores com grants no cliente e nenhum deles conseguiria **processar, reverter, contabilizar
ou transmitir**; `FRMCAIXA` não existe (abrir/fechar/movimentar/conferir caixa: 9 opções); `FRMCADAPAGAR` não
existe (baixar e estornar); `FRMAJUSTEESTOQUE` existe com `BTNOK` onde pedimos `BTNAJUSTAR`/`BTNESTORNAR`.

**Efeito prático se a virada acontecesse hoje:** o sistema abre, mostra tudo, e quase nenhuma ação de escrita
funciona — para todos os 284 operadores. É exatamente a falha que nenhum teste de leitura pega, e que o smoke
não pega porque ele semeia os próprios grants.

### Não é bug de carga — é decisão de projeto pendente

Já tínhamos visto a ponta disso uma vez (mig 090: opções inventadas renomeadas para `IMPORTARPRODUTOS1`/
`ATUALIZAESTOQUE1`, "senão o cutover perde os grants dos 15 operadores"). Agora está medido no conjunto todo.
Os caminhos, e nenhum deles é técnico o bastante para eu decidir sozinho:

1. **Renomear** a opção nossa para a do legado onde existe equivalente (`BTNFATURAR` → `BTNFATURAMENTO` é
   direto; `BTNPROCESSAR` **não tem** equivalente, porque no legado processar é efeito de outro botão).
2. **Semear no pós-carga** a opção nova, concedendo a quem já tem uma opção-âncora do mesmo formulário (ex.:
   quem tem `BTNGRAVAR` em `FRMNF` ganha `BTNPROCESSAR`). Simples, mas **eleva privilégio** — quem só
   consultava passa a poder mover estoque.
3. **Mapa explícito** revisado com o cliente, opção a opção, para os 36 formulários.

O (2) sem o (3) é o que ninguém quer descobrir depois. Isto entra como **decisão do usuário** antes da virada, e
está no runbook como bloqueio.

## 8. Próximos passos (estado em 2026-09-02)

Os três itens originais desta seção estão feitos (mapa por tabela, runner com reconciliação, ensaio por fase).
O que falta para a virada ser real, em ordem:

1. **Ensaio de OPERAÇÃO** — extração completa de PRODUÇÃO (145 tabelas, em andamento), `carregar-cutover.ts
   todas --manter`, API apontada para o banco carregado, `tools/cutover/ensaio-operacao.sh`: as telas que a loja
   usa respondendo sobre 18,9M de vendas, com tempo por tela. É o teste que diz se dá para virar.
2. **Runbook da janela** — congelamento do legado, extração, carga, pós-carga, sequências, reconciliação,
   go/no-go, volta atrás. Com a taxa medida em produção (não na homolog).
3. **Reconferência dos veredictos de referência** contra produção (alíquotas, det_aliquota, perfis, receitas — a
   homolog tinha massa de teste).
4. Relatório ao cliente dos órfãos e perdas declaradas (clube_desconto 3.022, parceiros 7/11, apagar 370/712,
   inventario 13.611, clube_desconto.idempresa 4 linhas, cotacao_forn_itens 20 linhas).
