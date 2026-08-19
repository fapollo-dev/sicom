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
   conciliacao_bancaria*(← MOVIMENTACAO_BANCARIA_OFX), diario, apuracao_pc*.
5. **F4 — Movimento pesado (particionado):** vendas (mês a mês), cx_vendas, historico_prod,
   historico_dinamico, historico_pdv, hist_sangria_suprimento, caixa_pdv, nfe_nao_cadastradas, nfe_eventos.
6. **F5 — Pós-carga:** reset de TODAS as sequences (`setval(max(pk)+1)`), ANALYZE, reconciliação (§5).

## 4. Transformações conhecidas (lições já pagas — aplicar por reflexo)

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
| pedido_devolucao_compra_i | **RESOLVIDO (2026-08-18)**: o nome no Oracle é `PEDIDO_DEVOLUCAO_COMPRA_ITENS` (não `_I`) — cabeçalho `PEDIDO_DEVOLUCAO_COMPRA` 545 linhas e itens **3.809**, com pedidos até **out/2025**. A tela (FRMCADPEDIDODEVOLUCAOCOMPRAS: 1.753 acessos, 15 operadores) é VIVA. |

## 7. Riscos e decisões em aberto

- **Janela de corte**: a replicação do Oracle continua ativa → definir se a virada é big-bang (fim de semana)
  ou com recarga incremental das tabelas de movimento (VENDAS/CX_VENDAS têm data — delta é viável).
- **PDV**: o usuário definiu NÃO mexer no PDV agora → o PDV continua gravando no Oracle após a virada?
  Se sim, VENDAS/CX_VENDAS precisam de sincronização contínua (fora deste plano; decisão do usuário).
- **Ensaio**: carga completa em banco descartável + validação §5 + rodar TODAS as suites (smoke aponta
  p/ o banco carregado) ANTES de qualquer janela.

## 8. Próximos passos de execução (quando aprovado)

1. Spec por tabela da F0/F1 (mapa coluna-a-coluna gerado dos dicionários + revisto à mão).
2. Esqueleto do ETL (runner com checkpoint/retomada + relatório de reconciliação).
3. Ensaio F0+F1 → validação → iterar pelas fases.
