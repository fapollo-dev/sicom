# Dossiê de Tela — INVENTÁRIO (contagem física) — `uInventario`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-1 (núcleo + importar-produtos) ENTREGUE e verde 2026-07-16** (migration 090). Recon 3 frentes (Oracle READ-ONLY + uInventario.pas 2859 linhas + monorepo) + AskUserQuestion + auditoria adversarial. |
| **Fontes legadas** | `uInventario.pas`/`.dfm` (a tela; herda `TfrmMaster`) · `udmInventario.pas`/`.dfm` (DataModule) · `UCongelaEstoque.pas` (congelamento) · `uRelatorioInventarioRotativo.pas` (inventário ROTATIVO — outro modelo). |
| **Golden** | Oracle PINHEIRAO: `INVENTARIO` 79.190 linhas (~11 inventários reais: 7 emp 1, 4 emp 2 — contagem geral, milhares de produtos cada); `INVENTARIO_ROTATIVO` 1.334; `INVENTARIO_LIVRO` 20. |

## 1. Modelo (Oracle real) — o ACHADO central

O inventário **GERAL** do legado **NÃO tem máquina de estado nem gera kardex** — é um **editor de planilha**:
- Header **`INVENTARIO_LIVRO`** (livro fiscal): `CODINVENT` PK, `IDEMPRESA`, `DTINVENTARIO`, `TIPOINVENTARIO`(SPED),
  `MODELOINVENTARIO`, `PRODUTOSATIVOS`/`APENASESTOQUE` (escopo). **Sem coluna STATUS.**
- Itens **`INVENTARIO`** (flat, uma linha por produto): `SEQUENCIA` PK, `CODINVENT` FK, `IDEMPRESA`, `IDPRODUTO`,
  `CODBARRA`, `DESCRICAO`, `UNIDADE`, `QTDE` = **quantidade CONTADA**, `VRCUSTO`/`VRVENDA` (snapshot fiscal), `TIPO`.
  **Não persiste "qtd do sistema" nem "diferença"** — são calculadas ao vivo por LEFT JOIN em `ESTOQUE` (dfm:1157-1164).
- **Diferença** (calculada, udmInventario.dfm:1157): `CASE WHEN E.QTDE<0 AND I.QTDE>0 THEN E.QTDE+I.QTDE WHEN
  E.QTDE<0 AND I.QTDE<0 THEN 0 ELSE E.QTDE−I.QTDE END` = **ESTOQUE − CONTADO** (com tratamento de saldo negativo).
- **Efetivar** (`AtualizaEstoque1Click`, uInventario.pas:515-555): `ESTOQUE.QTDE := contado`, item a item —
  **SOBRESCRITA direta, sem kardex, sem contábil**, gated por `SenhaAdministrativa('ADM')`. Rerodável (sem trava).
- **Congelar** (`UCongelaEstoque`): freeze em massa por empresa (`ESTOQUE.QTDE_CONG=QTDE`), **desacoplado** do doc.
- O caminho fiscalmente correto (NF de perdas/sobras → kardex) só existe no **ROTATIVO** (`LOTE_INVENTARIO.OPERACAO`).

## 2. Decisões (AskUserQuestion)
- **Modelo: FIEL ao legado** (sobrescreve `estoque.qtde` direto, SEM kardex, SEM máquina de estado, rerodável,
  gated senha ADM). *(A alternativa "melhorado: estado + kardex via ajuste-estoque" foi oferecida e recusada.)*
- **Escopo corte-1: núcleo + importar-produtos.**

## 3. Corte-1 (ENTREGUE)
- **migration 090**: `inventario_livro` (header, sem status) + `inventario` (itens; `UNIQUE(codinvent,idproduto)`) +
  view `get_inventario_livro` (+ qtde_itens) + RBAC `FRMINVENTARIO` (BTNGRAVAR/EXCLUIR/IMPORTARPRODUTOS/APLICARESTOQUE).
- **`inventario.aggregate.ts`**: agregado header+itens (molde `devolucao-compra`), `empresaScoped`, soft-delete, **sem
  guarda de estado** (fiel — planilha sempre editável). `derivarItensTrx` = SNAPSHOT server-authoritative
  (descricao/unidade/codbarra de `produtos`; vrcusto/vrvenda de `multi_preco`; `idempresa=emp` no detalhe — o engine
  não carimba idempresa em detalhe). `validar`: produto existe. Path `cadastro/inventario`.
- **`inventario.service.ts`** (vertical): `importarProdutos` (DELETE + repopula de produtos+multi_preco+estoque;
  filtros `apenasAtivos`[multi_preco.ativo]/`apenasComSaldo`[estoque.qtde>0]; contado=0; lotes de 1000) · `diferencas`
  (fórmula fiel, read) · `aplicar` (gate senha ADM via `SenhaOperacaoService.verificar('admin')` ANTES da trx →
  SENHA_OPERACAO_REQUERIDA/INVALIDA; UPDATE `estoque.qtde`=contado item a item, INSERT/onConflict se sem linha; SEM
  kardex; transação única; rerodável).
- Smoke §83 (6): cria livro+itens+snapshot · diferença calculada · aplicar sem/errada senha→422 · aplicar ADM →
  estoque sobrescrito (1→50, 2→3) · importar-produtos popula (contado=0) · RBAC 403.

## 4. Divergências CONSCIENTES / adiado (com procedência)
- **Sem kardex / sem estado** = FIEL ao legado (decisão do usuário; o próprio legado sobrescreve direto e é rerodável).
- **importarProdutos DELETA os itens atuais** antes de repopular — fiel (`DELETE FROM INVENTARIO WHERE CODINVENT`,
  uInventario.pas:1378/1715). Perde a contagem em andamento (como o legado).
- **Adiado (cortes seguintes):** BALANÇO fiscal (`BALANCO`/`BALANCOITENS` → SPED bloco H); CONGELAR/DESCONGELAR
  (`ESTOQUE.QTDE_CONG`, freeze por empresa — precisa colunas novas); inventário ROTATIVO (`LOTE_INVENTARIO`, NF de
  perdas/sobras); **`VlrcustoInventario='FISCAL'`** (snapshot `VRCUSTOFISCAL` vs `VRCUSTO` — hoje sempre `multi_preco.vrcusto`;
  afeta só a valoração fiscal do livro, não o efeito no estoque — fold auditoria [BAIXA]); **histórico de alteração
  de QTDE/VRCUSTO por item** (`SetaHistorico_Dinamico`, uInventario.pas:792-812 — só o histórico master é emitido; fold
  auditoria [BAIXA]); FRONT.

## 5. Auditoria adversarial — folds aplicados
- **[ALTA] import→aplicar zeraria o estoque**: o import semeava contado=0 e o aplicar sobrescreve `estoque=contado`
  → os itens não-recontados iam a 0 (wipe silencioso). O legado semeia contado = SALDO DE SISTEMA (uInventario.pas:1748),
  tornando import→aplicar um NO-OP idempotente. **Fix:** import semeia `qtde = coalesce(estoque.qtde,0)`. Smoke §83.5/§83.5b.
- **[MÉDIA] import partia do catálogo GLOBAL `produtos`** (puxava produtos alheios à empresa) → agora parte da
  **`multi_preco` da empresa** (INNER, `idempresa=emp`, fiel dfm:86,96). **[MÉDIA]** faltava o filtro **`idproduto_pai`**
  (excluir filhos, dfm:97) → adicionado. **[MÉDIA]** `apenasAtivos` ignorava `ATIVO_PELA_MULTIPRECO` → agora respeita
  (default = `produtos.ativo`, uInventario.pas:1692-1695). **[BAIXA]** `diferencas`/`aplicar` não excluíam `tipo='T'`
  (dfm:1179) → adicionado.

**Verde pós-fold:** api tsc 0 · api test 156 · smoke **589/0** (§83, 7 checks) · web tsc 0.
