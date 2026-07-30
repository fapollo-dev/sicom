# Dossiê de Tela — SCRAP / PERDAS — `FRMCADSCRAP`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (registro + baixa de estoque) ENTREGUE e verde, 2026-07-30, commit `ff0a6ed`, migration 116. Recon (mapa menu×migrado×dado-real via `MENUEXPRESS` + Oracle golden + monorepo) + auditoria adversarial (2 agentes: paridade + correção) — sem defeito ALTA de dados. Verde: shared build · api tsc 0 · api test 172 · smoke **796/0** (§47b, 10 checks) · web tsc 0 · build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `FRMCADSCRAP` (unit `uCadSCRAP`). Kardex: `HISTORICO_PROD`. Lookup: `MOTIVOS_OPERACAO`. Relacionados adiados: `UmportaVendasPerdas` (importador F7), NF de perda CFOP 5927. |
| **Golden** | Oracle PINHEIRAO: `SCRAP` + `ITENS_SCRAP` (populado até 2026), `MOTIVOS_OPERACAO`, `ESTOQUE`, `HISTORICO_PROD`, `MENUEXPRESS` (auditoria de uso). |

## 1. Por que esta tela (seleção do módulo)

O corte foi escolhido por um **mapa menu × migrado × dado real**: a tabela de auditoria de uso `MENUEXPRESS` mede quem abre cada tela do legado. Scrap saiu como a **3ª tela mais usada** do ERP, com `SCRAP` populado até 2026, tabela limpa e primo direto do Inventário/Ajuste já migrados.

**Descartados por DADO-MORTO neste tenant** (mesmo veredito do Bloco D do SPED): Logística de Recebimento/Doca/Agenda, Mapa de Carga, MDF-e, CT-e, Cheques, Transferência entre lojas, Vasilhame, Entregas, Funcionários, Recargas.

**Vivos não escolhidos** (viraram fila): Manifestação do Destinatário de NF-e de entrada (SEFAZ externo), Cartões/recebíveis (125k linhas → entregue depois em `uCadCartao.md`), Conciliação OFX, Produção açougue/padaria, Troca com fornecedor (→ `uTrocaMercadoriaFor.md`), Devolução de Vendas, Adiantamento a Fornecedor.

## 2. Modelo (Oracle real)

- Documento **MESTRE-DETALHE** de perda (quebra / vencimento / avaria).
- **`SCRAP`** (cabeçalho): `codscrap`, `dt_cadastro`, `codplc`, `codparceiro`, `idsituacao_nf`, `mov_estoque`, `importado`, `obs`.
- **`ITENS_SCRAP`** (itens, FK em cascata): `idproduto`, `qtde` **signed**, `vr_custo`/`vrcustorep`, `codmotivoop`, `codsetor`, `codfor`, + `origem`/`motivo`/`faturado` com default.
- **`qtde` é SIGNED** — o golden tem 6 negativos e 22 zeros (estornos). **Não clampar.**
- **Sem `INDR`** → exclusão física (fiel).
- **Domínio PERDA** em `MOTIVOS_OPERACAO`: 4 motivos exatos — **127** GERAL (o mais usado), **141** VALIDADE, **142** AVARIA, **261** IDENTIFICADA. Tolera null/0.
- **Valoração** é unitária × qtde — **não existe coluna de total**.
- Colunas mortas dropadas (100% null/zero); manteve o `VRCUSTOREP` vivo e dropou o twin morto `VR_CUSTO_REPOSI`.

### Contexto histórico do golden (decisivo para o recorte)

As perdas **fluíram por NF-de-perda** (`importado='S'`, 92% entre 2020-24) e **viraram baixa-direta** (`mov_estoque='S'`) a partir de **2025-10-27**. Implementar a baixa-direta e decoplar o "aplicar" é fiel ao comportamento **atual** da operação.

## 3. Corte-1 (ENTREGUE)

- **Migration 116:** `scrap` + `scrap_item` (FK cascata) + seed dos 4 motivos PERDA em `motivos_operacao` + view `get_scrap` (nº de itens + valor Σ `qtde × vr_custo`) + RBAC `FRMCADSCRAP`.
- **`scrap.aggregate`** — CRUD mestre-detalhe via factory (molde Inventário). Valoração do custo **SERVER-AUTHORITATIVE** por `MULTI_PRECO`: o operador **não digita custo**.
- **`scrap.service`** — `aplicar`/`estornar` = movimento **RELATIVO** em `estoque.qtde` (delta −qtde na baixa / +qtde no estorno) + Kardex `historico_prod` com `origem='SCRAP'` (molde ajuste-estoque; `forUpdate` na linha do scrap **e** na do estoque). A baixa é **decoplada do gravar** (precedente do Inventário); `mov_estoque='S'` marca aplicado.
- **`scrap.controller`** para aplicar/estornar. **Front** `ScrapPage` mestre-detalhe (lista + documento: produto/qtde/motivo, valoração, aplicar/estornar/excluir) + rota `/estoque/scrap` + menu (ícone Trash2).

### Folds da auditoria

- **[ALTA] PUT em documento aplicado/faturado dessincronizava a baixa.** O `updateAggregate` faz delete+insert dos itens sem checar estado, e o `estornar` usa os itens **atuais** → corromperia o saldo (aplicar 8 → PUT para qtde 100 → estornar → +100). O **`validar` passou a travar o update** (`mov_estoque='S'` → `SCRAP_ESTOQUE_APLICADO`; `importado='S'` → `SCRAP_JA_FATURADO`), espelhando o `validarRemocao`. Smoke §47b.2b (PUT → 422, saldo intacto).
- **[MÉDIA] custo confiado do cliente** → `derivarItensTrx` **sempre** lê `MULTI_PRECO`; `vr_custo`/`vrcustorep` removidos do schema de input (valor da perda não é forjável). Smoke §47b.8.
- **[MÉDIA] web "Aplicar" habilitado com itens locais não salvos** — atuava no estado do servidor, perdia input e deixava documento "aplicado" vazio → **dirty-guard** (salvar antes de aplicar).
- **[BAIXA]** `origem_estoque` default `'E'` (dominante no golden, 61%); comentário "261 padrão" corrigido para "127 GERAL, o mais usado".

### Não-issues confirmados

Idempotência de aplicar/estornar (`forUpdate` + guard de `mov_estoque` re-checado na transação) · mesmo produto 2× no documento (delta relativo + read-your-writes) · concorrência cross-documento (`forUpdate` na linha de estoque) · rollback no meio do loop · tenant scoping (`idempresa` em tudo) · cascata da FK.

## 4. Adiado (com procedência)

- **Lançamento gerencial em CAIXA** (`btnGravarClick`).
- **NF de perda CFOP 5927** → SPED, via o motor de NF de saída mod. 55 já entregue.
- **Importador F7** de perdas identificadas (`UmportaVendasPerdas`).
- **Gating de config PLC** (`PERDA='S'`, `FLG_USO_SETOR`, `OBRIGA_MOTIVO`) e de setor.
- **Situação do documento** (E02).

### CAVEAT de ETL

Re-save de documentos legados com motivo **não-PERDA** (51 linhas: {6, 3000, 3860}) reprovaria no `validar` — tolerar na ETL ou aplicar a regra só a itens novos. E **7 itens com `idproduto` órfão** barrariam no `NOT NULL` + FK.

## 5. Pendência

**Preview de tela não renderizado** — pendente do eyeball do usuário. A tela espelha Inventário e Ajuste de Estoque, ambos já validados visualmente.

## Ver também

- [uInventario.md](uInventario.md) — o primo que definiu o "aplicar decoplado".
- [uAjusteEstoque.md](uAjusteEstoque.md) — o molde do movimento relativo + Kardex.
- [uTrocaMercadoriaFor.md](uTrocaMercadoriaFor.md) — mesmo molde, lado do fornecedor.
