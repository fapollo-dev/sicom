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

## 7b. ⚠️ UNICIDADE: 14 índices nossos que o dado do cliente VIOLA (varredura de 2026-08-26)

Antes de qualquer ETL: `tools/cutover/varre-unicidade.py` lê as 32 unicidades declaradas nas migrations e
confronta cada uma com o Oracle. Resultado — **14 violam o golden**, somando ~62 mil linhas que a carga
rejeitaria em silêncio:

| índice | tabela (colunas) | grupos | linhas | natureza (a decidir por item) |
|---|---|---:|---:|---|
| `ux_nf_cod_ped_dev_compra` | nf (cod_ped_dev_compra) | 8 | **22.946** | 22.9 mil NFs compartilham 8 valores — provável 0/NULL tratado como valor |
| `ux_nf_codpedcomp` | nf (codpedcomp) | 65 | **20.326** | idem + **recebimento parcial é regra real**: um pedido pode ter várias NFs |
| ~~`ux_inventario_produto`~~ | inventario (codinvent, idproduto) | 2.818 | 13.804 | ✅ removido na mig 172 |
| `ux_parceiros_end_doc` | parceiros_end (cnpj_cpf) | 1.049 | 3.017 | mesmo CNPJ/CPF em vários endereços/parceiros |
| `ux_mbo_fitid` | movimentacao_bancaria_ofx (codconta, mbo_transacao_id, mbo_check_num) | 79 | 1.741 | FITID repetido no extrato — o dedup do OFX presume unicidade |
| `ux_codref_for` | codreferencia_for (codfor, codref) | 77 | 232 | de-para de fornecedor com código repetido |
| `ux_nf_natural` (2 variantes) | nf (nronf, serie, modelo, idempresa, tipoemissao/tipo, codparceiro) | 38/41 | 215/214 | a "chave natural" da NF não é única no golden |
| `ux_cotacao_forn_itens` · `ux_cotacao_prod` · `ux_cotacao_prodqtde` | cotação | 5/7/2 | 25/14/4 | — |
| `ux_operadores_login` | operadores (upper(login)) | 5 | 15 | logins duplicados por caixa |
| `ux_relacao_operador_perfil` · `ux_nfe_naocad_chave` | — | 2/2 | 4/4 | — |

Passam sem violação (13): `multi_preco`, `estoque`, `empresas`, `configuracoes`, `plano_contas`, `formas_pgto`
(×2), `cotacao_forn`, `apuracao_pc`, `contas_bancarias_op`, `saldo_operador`, `operadoras_taxa`, `apuracao_icms`.
Sem equivalente no Oracle (nossas): `nfe_evento`, `dre_estrutura`, `caixa_sessao`. Não avaliadas pelo script
(expressão): `arquivo_remessa_areceber`, `nf_prod_lote` (esta já saiu na mig 172).

**Cada violação precisa de veredicto ANTES do ensaio**, e são três os possíveis: (a) o índice é invenção nossa e
sai; (b) o dado de origem é sujo e a carga **deduplica com regra explícita** (documentada e contada no relatório
de reconciliação); (c) a unicidade vale só para o dado NOVO e o índice vira parcial (`WHERE` que exclui o
histórico). O que não pode é descobrir isso com a carga rodando.

## 8. Próximos passos de execução (quando aprovado)

1. Spec por tabela da F0/F1 (mapa coluna-a-coluna gerado dos dicionários + revisto à mão).
2. Esqueleto do ETL (runner com checkpoint/retomada + relatório de reconciliação).
3. Ensaio F0+F1 → validação → iterar pelas fases.
