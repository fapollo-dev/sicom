# Dossiê de Tela — TROCA DE MERCADORIA COM FORNECEDOR — `FRMTROCAMERCADORIAFOR`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (documento + movimento de estoque) ENTREGUE e verde, 2026-07-30, commit `54454db`, migration 118. Recon (Oracle golden + fonte Delphi + monorepo) + auditoria adversarial (2 agentes). Verde: shared build · api tsc 0 · api test 172 · smoke **808/0** · web tsc 0 · web test 32 · build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `FRMTROCAMERCADORIAFOR`. Trigger de estoque: `ESTOQUE_TROCA` (em `ITENS_TROCA`). View de lista: `GET_TROCA`. Adiado: `uImportaTrocaForDevolucao` (NF de devolução → SPED). |
| **Golden** | Oracle PINHEIRAO: `TROCA`, `ITENS_TROCA`, `ITENS_TROCA_QTDE`, `ESTOQUE`, `HISTORICO_PROD`, `PARCEIROS.REALIZA_TROCA`, `PRODUTOS.REALIZATROCA`. |

## 1. O que é

Mercadoria **avariada ou vencida que sai da loja de volta para o fornecedor**. Documento mestre-detalhe: o operador registra os produtos que saem, e o fechamento dá baixa no estoque.

**É supplier-side — não depende do PDV.** Foi isso que o tornou construível agora, ao contrário da Devolução de Vendas (que carimba a venda original e por isso vai junto do épico do PDV).

## 2. Modelo (Oracle real) — migration 118

- **`troca`** (cabeçalho): `codtroca` PK (sequence), `idempresa` (legado `CODEMPRESA`, normalizado para o `empresaScoped` do engine), `codparceiro` (fornecedor, soft ref), `data`, `descricao`, auditoria (`usucadastro`/`dtcadastro`/`usultalteracao`/`dtultimalteracao`).
- **`itens_troca`** (itens): `coditenstroca` PK, `codtroca` FK **ON DELETE CASCADE**, `idempresa`, `idproduto` FK, `qtde` numeric(13,3), `vrcusto`, `vrcustorep` (custo de reposição), `estoqueretirada` (`LOJA`/`DEPOSITO` — **só LOJA no golden**), `fechado` char(1) (`'S'` = baixa aplicada), `codscrap` (link para scrap — **inerte** neste tenant).
- **`get_troca`** — cabeçalho + fornecedor (`parceiros.razao`) + nº de itens + valor total (Σ `qtde × vrcusto`) + **`status` DERIVADO**.

### O status é derivado, não armazenado

**`TROCA.STATUS` do legado é vestigial (sempre 0).** O status real espelha o `GET_TROCA` e sai dos itens:

```
FECHADA  ⇔  existe item  E  não existe item com fechado <> 'S'
ABERTA   ⇔  caso contrário
```

Sem `INDR` → exclusão física (fiel).

## 3. Corte-1 (ENTREGUE)

### Núcleo — `troca.aggregate`

Agregado mestre-detalhe (`empresaScoped: true`, `softDelete: false`, view `get_troca`, RBAC `FRMTROCAMERCADORIAFOR`, rota `cadastro/troca`).

- **Custo SERVER-AUTHORITATIVE:** `derivarItensTrx` lê `vrcusto`/`vrcustorep` de `MULTI_PRECO` por `(idproduto, idempresa)`. O operador **não digita custo**; `fechado` nasce `'N'` (a baixa é o `fechar`). `estoqueretirada` default `'LOJA'`.
- **`validar` — dupla habilitação, fiel ao legado:** fornecedor com `parceiros.realiza_troca='S'` (senão `FORNECEDOR_NAO_REALIZA_TROCA`) **e** produto com `produtos.realizatroca='S'` (senão `PRODUTO_NAO_REALIZA_TROCA`); inexistentes → `PARCEIRO_NAO_ENCONTRADO` / `PRODUTO_NAO_ENCONTRADO`.
- **`validar` também trava o PUT** de troca com item já `fechado='S'` → `TROCA_ITEM_FECHADO`. **Fold herdado do padrão Scrap:** o factory faz delete+insert dos itens no update, então editar um documento com baixa aplicada dessincronizaria o saldo.
- **`validarRemocao`** bloqueia excluir documento com item fechado (reabrir/estornar antes).

### Efeito — `troca.service` (vertical, molde scrap/ajuste)

- **`fechar`** — numa transação: `forUpdate` no cabeçalho (escopado por `idempresa`) → seleciona os itens **abertos** (`fechado <> 'S' OR NULL`; nenhum → `TROCA_SEM_ITENS_ABERTOS`) → por item, movimento **RELATIVO** `−qtde` em `estoque.qtde` + 1 linha de Kardex → marca `fechado='S'`.
- **`reabrir`** — o espelho: itens `fechado='S'` (nenhum → `TROCA_SEM_ITENS_FECHADOS`), `+qtde`, `fechado='N'`.
- **`moverEstoque`** — `forUpdate` na linha de estoque; UPDATE se existe, INSERT se não (`23505` → `TROCA_ESTOQUE_CONCORRENTE`, mesmo backstop de corrida do Ajuste); Kardex `historico_prod` com `origem='TROCA'`, `tipo` E/S pelo sinal, `saldo_anterior`/`saldo_novo`, e histórico textual carimbando o `codtroca` (`"Retirada do estoque para TROCA. Cód troca N"` / `"Estorno da TROCA. Cód troca N"`).
- Arredondamento a 3 casas (`r3`) na quantidade, coerente com `numeric(13,3)`. Tenant e operador **fail-closed**.

Fiel ao `ESTOQUE_TROCA` no caminho `LOJA` / `ORIGEM_FECHAMENTO = null`: **baixa definitiva** — a reposição volta depois por NF (corte futuro).

### Front

`TrocaPage` (mestre-detalhe: lista + documento com itens produto/qtde, valoração, fechar/reabrir/excluir) + rota `/estoque/troca` + menu (ícone Undo2).

### Folds da auditoria

- **[ALTA]** o front derivava `fechada` do **`status` da view** — que é view-only e vem `undefined` no `GET /:id` → o botão **Reabrir desaparecia**. Passou a derivar de `itens[].fechado`. Padrão a lembrar: **campo computado na listagem não existe no detalhe**.
- **[BAIXA]** grant RBAC `BTNEXCLUIR` faltando na empresa 2.

## 4. Adiado (fiel / inerte neste tenant)

- **Balde `QTDETROCA`** (reserva) — a mercadoria em troca não é segregada num bucket próprio.
- **Sub-nível `ITENS_TROCA_QTDE`** (1:1).
- **`DEPOSITO` / `ESTOQUE_DEP`** — depende do modelo multi-bucket de estoque (dormente neste tenant).
- **`CODSCRAP` / `ORIGEM_FECHAMENTO`** — **0 linhas** no golden.
- **NF de devolução** (`uImportaTrocaForDevolucao` → SPED, via o motor de NF de saída já entregue).
- **`INVENTARIO_ROTATIVO`**.

Aplicação direta da lição "em tela de estoque o valor está no Kardex + saldo": a distribuição real foi checada **antes** de investir na mecânica dos baldes.

## 5. Vizinho que ficou de fora

**Devolução de Vendas** foi olhada no mesmo recon e **adiada**: é acoplada ao PDV/VENDAS (desligado) porque carimba a venda original. Vai junto do épico do PDV.

## Ver também

- [uCadSCRAP.md](uCadSCRAP.md) — o molde direto (documento + baixa decoplada + custo server-auth + trava no PUT).
- [uAjusteEstoque.md](uAjusteEstoque.md) — a origem do movimento relativo + Kardex.
- [uInventario.md](uInventario.md) — o precedente do "aplicar decoplado do gravar".
