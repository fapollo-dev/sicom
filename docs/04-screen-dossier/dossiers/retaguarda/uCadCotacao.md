# Dossiê de Tela — COTAÇÃO DE COMPRA (RFQ) — `uCadCotacao`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-1 (estrutura + preços) ENTREGUE e verde 2026-07-17** (migration 091). Recon 3 frentes (Oracle READ-ONLY + uCadCotacao.pas 3559 linhas + monorepo) + AskUserQuestion + auditoria adversarial. |
| **Fontes legadas** | `uCadCotacao.pas`/`.dfm` (3559) · `udmCadCotacao.pas`/`.dfm` · `uCadCotacaoForn.pas` (694, preenchimento) · `uLoginCotacao.pas` (218, login fornecedor César) · `uCotacaoListaFornecendores.pas` (variante FLG_ORIGEM='L'). |
| **Golden** | Oracle PINHEIRAO: COTACAO 56; COTACAO_PROD 3.971; COTACAO_FORN 104; **COTACAO_FORN_ITENS 14.116** (matriz preço); COTACAO_PRODQTDE 5.305; COTACAO_FECHAMENTO_APURACAO 20 (vestígio portal — não replicado). |

## 1. Modelo (Oracle real) — ÁRVORE de 3-4 níveis
```
COTACAO (header)                 PK CODCTC  · SITUACAO 'A'/'F' · LIBERADA (flag portal web) · PEDIDOS (log) · FLG_ORIGEM 'C'/'L'
├─ COTACAO_PROD (produtos)       PK CODCPR, FK CODCTC
│   └─ COTACAO_PRODQTDE          PK CODCPRQTDE, FK CODCPR  (+IDEMPRESA, QTDE)  ← qtde por LOJA (multi-empresa)
└─ COTACAO_FORN (convidados)     PK CODCTCFORN, FK CODCTC  (+CODPARCEIRO, PARTICIPA_APURACAO)
    └─ COTACAO_FORN_ITENS        PK CODCTCFIT, FK CODCTCFORN + FK CODCPR  ← a MATRIZ preço fornecedor×produto
```
Não cabe no agregado declarativo (netos + FK cruzada `forn_itens→prod`) → **serviço vertical** (molde recebimento).

**Fluxo (SITUACAO):** `'A'` Aberta (editável) → comprador/fornecedor preenchem preços → **Processar** (apura vencedor +
fecha + gera pedido) → `'F'` Fechada. Reabrir volta 'A' e reseta a apuração. `LIBERADA`/`COTACAO_FECHAMENTO_APURACAO` =
portal web (não no desktop). `PEDIDOS` = log textual dos pedidos gerados + trava anti-regeração.

**Apuração** (`SetaFornecedorGanhador`, uCadCotacao.pas:3005): vencedor por PRODUTO = menor **VALOR_LIQ = VALOR −
VALOR×ICMS/100** entre fornecedores `PARTICIPA_APURACAO='S'`; grava `GANHADOR='A'` em COTACAO_FORN_ITENS; escolha
manual (`DEFINIDO='S'`) sobrevive; empate → escolha manual. **Gerar-pedido** (`GerarPedido`, :1663): 1 PEDIDOCOMPRA
por fornecedor vencedor (agrupa itens ganhos), re-explode COTACAO_PRODQTDE → PEDIDO_COMPRA_QTDE.

## 2. Decisões (AskUserQuestion)
- **Escopo corte-1 = estrutura + preços.** Apuração + gerar-pedido = corte-2. Front = corte-3.
- **Comprador digita os preços** (a via desktop-operador). Portal do fornecedor (login por parceiro/César) = épico à parte.

## 3. Corte-1 (ENTREGUE)
- **migration 091**: `cotacao` (idempresa dona) + `cotacao_prod` (UNIQUE codctc,idproduto) + `cotacao_prodqtde`
  (UNIQUE codcpr,idempresa) + `cotacao_forn` (UNIQUE codctc,codparceiro) + `cotacao_forn_itens` (UNIQUE
  codctcforn,codcpr) + view `get_cotacao` + RBAC FRMCADCOTACAO.
- **`cotacao.service.ts`** (vertical): `criar` (header + produtos + qtde/loja + fornecedores; valida produtos existem
  + fornecedores FRN='S') · `atualizar` (só 'A'; DELETE+re-insere produtos/fornecedores) · `lancarPrecos` (upsert da
  matriz p/ 1 fornecedor; só 'A'; valida convidado + produto cotado) · `fechar`/`reabrir` (CAS A↔F) · `obter` (árvore
  completa) · `listar`.
- **`cotacao.controller.ts`** (compras/cotacao): CRUD + lançar-preços + fechar/reabrir; RBAC BTNGRAVAR/LANCARPRECOS/
  FECHAR/REABRIR; leitura só auth.
- Smoke §84 (6): criar+obter · lançar preços (matriz 3) · guardas (não-convidado/não-cotado) · fornecedor não-FRN→422
  · fechar/lançar-na-fechada→422/reabrir · RBAC 403.

## 4. Adiado (com procedência)
- **APURAÇÃO** (GANHADOR = menor VALOR_LIQ; PARTICIPA_APURACAO; empate manual) + **GERAR-PEDIDO** (1 pedido/fornecedor
  vencedor, reusa pedido-compra `createAggregate`, re-explode prodqtde) = **corte-2**. **FRONT** = corte-3.
- **Portal do fornecedor** (login por parceiro/César, preenchimento online, `LIBERADA`, janela DTINICIO/DTFIM,
  `COTACAO_FECHAMENTO_APURACAO`) = épico à parte. **FLG_ORIGEM='L'** (cotação por lista) = variante adiada.

## 5. Auditoria adversarial — folds aplicados
- **[ALTA] `atualizar` apagava a matriz de preços**: full-delete+reinsere → CASCADE zerava `cotacao_forn_itens`
  (perda silenciosa). Fix: **delta por chave natural** (idproduto/codparceiro) — inalterados mantêm codcpr/codctcforn
  (preços SOBREVIVEM), novos entram, removidos caem (fiel ao ApplyUpdates). Smoke §84.7.
- **[MÉDIA] `atualizar` zerava `descricao`** em update parcial → só grava se veio no dto.
- **[MÉDIA] `valortotal`** = valorembal → agora `QUANTIDADE × VALOREMBAL` (fiel uCadCotacaoForn:224).
- **[BAIXA]** janela DTFIM>DTINICIO (superRefine) · datas malformadas 22007/22008 → 400 (antes 500) · endpoint
  **DELETE** (soft-delete, consome o grant BTNEXCLUIR) — smoke §84.8.
- **[BAIXA] adiado documentado**: `cotacao_prodqtde.idempresa` (loja destino) não valida existência da empresa — o
  gerar-pedido (corte-2) valida a loja ao re-explodir; não é IDOR (db-per-tenant, a idempresa nomeia loja do próprio tenant).

**Verde pós-fold:** api tsc 0 · api test 156 · smoke **597/0** (§84, 8 checks) · web tsc 0.

## 6. Auditoria controle a controle (15/10/2026) — `uCadCotacao.dfm` × Apollo — corte do CABEÇALHO

Uso na produção (COTACAO por ano): 2024 = 8, 2025 = 3, 2026 = 1 — toda cotação tem a janela de preenchimento e as lojas; 'Liberar' na
maioria; o e-mail aos fornecedores **nunca foi usado** (DTENVIOEMAIL vazio em todas).

| controle (pnlCabCotacao) | regra | Apollo |
|---|---|---|
| `edtDESCRICAO` | — | ✅ |
| `edtDATA` (DATA) | — | ❌→✅ |
| `edtDtInicio` + `mskHoraInicio` / `edtDtFim` + `mskHoraFim` | a janela com hora; sem janela gravada a tela mostra hoje 00:01 → hoje 23:59 (`edtCodigoExit` :1285); fim ≤ início → "Hora fim não pode ser MENOR ou IGUAL hora início." (`btnGravarClick` :710-716) | ❌→✅ (o `atualizar` ignorava a janela; a criação a aceitava sem a hora na tela) |
| `edtempresas` (EMPRESAS) | o `GravarEmpresas` grava as lojas do multiempresa como ";1;2;" e o campo nunca habilita | ❌→✅ (só na inclusão; só leitura depois) |
| `DBCheckBox1` "Liberar Cotação" (LIBERADA) | editável no desktop (o comentário "write-once 'N' no desktop" da mig 091 estava errado: 2/3 das cotações da produção estão liberadas) | ❌→✅ |
| `DBMemo1` (PEDIDOS) | os pedidos gerados | ✅ (só leitura) |

`get_cotacao` recriada (mig 429): a view de 091 era `c.*` congelado e não trazia EMPRESAS. A lista da tela também não renderizava:
sem `getRowId`, a DataTable do design system usa `row.id` (inexistente) e quebra no `editingCell?.rowId === rowId` — corrigido aqui e
nas outras 5 listas com o mesmo risco (ajuste de estoque, operadoras, produção, inventário, trocas, devolução de compra).

**Próximos cortes da Cotação** (por ordem de valor): as quantidades por loja (GrdQuantidades, com o estoque), a aba de status dos
fornecedores (total/preenchidos/não preenchidos, participa da apuração, itens do fornecedor), as impressões (cotação / por empresa / sem
custo), duplicar, a análise geral do produto [F6], agrupar produtos e o coletor. Fora com prova: o envio de e-mail (nunca usado).
