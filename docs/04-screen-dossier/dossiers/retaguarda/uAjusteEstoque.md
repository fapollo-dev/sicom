# Dossiê de Tela — AJUSTE DE ESTOQUE — `FRMAJUSTEESTOQUE`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (movimento manual do saldo) ENTREGUE e verde, 2026-07-07. Recon (Oracle AJUSTE_ESTOQUE 10.215 linhas + monorepo estoque/kardex) + auditoria adversarial (2 agentes: paridade vs Oracle + não-regressão). Verde: shared build · api tsc 0 · api test 123 · smoke **394/0** (12 AJUSTE) · web tsc 0 · web test 27 · build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `FRMAJUSTEESTOQUE` (form; .pas ausente no filesystem — recon por Oracle + monorepo). Kardex: `HISTORICO_PROD`. Lookup: `MOTIVOS_OPERACAO`. |
| **Golden** | Oracle PINHEIRAO: AJUSTE_ESTOQUE (10.215 linhas, flat), MOTIVOS_OPERACAO, ESTOQUE, HISTORICO_PROD. |

## 1. Modelo (Oracle real)
- **`AJUSTE_ESTOQUE` é FLAT** (1 linha = 1 ajuste de 1 produto). Colunas: `CODAJUSTE` PK, `IDPRODUTO`, `OPERACAO` (AUMENTAR/DIMINUIR/SUBSTITUIR), `DESTINO` (LOJA/E/ESTOQUE), `QTDE`, `QTDEANTERIOR`/`QTDEATUAL` (auditoria), `CODMOTIVO` (NOT NULL, FK→MOTIVOS_OPERACAO), `CODOPERADOR` (NOT NULL, FK→OPERADORES), `IDEMPRESA`, `MINIMO`/`MAXIMO`, `ORIGEM` ('A' ajuste manual / 'I' inventário), `IDORIGEM`, `OBS` (varchar 1000), `CODOPERADOR_LIBERACAO`.
- **Fórmula (confirmada, caminho manual `origem='A'` — 0 mismatches):** AUMENTAR → `qtdeatual = qtdeanterior + qtde`; DIMINUIR → `qtdeanterior − qtde`; SUBSTITUIR → `= qtde`.
- **SEM contábil** — o DIÁRIO não tem codorigem de ajuste (codorigem = {12,13,14,15,16,17,19,51,54,55,57,58,61–67}); a valoração do estoque é via CMV/inventário, não por-ajuste.
- **KARDEX** = `HISTORICO_PROD` (a mesma da NF); o ajuste grava 1 linha por movimento.
- **Saldo NEGATIVO é PERMITIDO** — 677 ajustes manuais reais com `QTDEATUAL<0` (ex.: corrigir produto já negativado por venda sem entrada). O legado NÃO bloqueia.
- **DESTINO** LOJA vs ESTOQUE/E = split loja/almoxarifado no legado (ESTOQUE.QTDE=loja vs QTDE_ALMOXARIFADO=depósito; por isso `qtdeatual≠estoque.qtde` nas amostras 'E'). **Nosso estoque é SINGLE-BUCKET.**
- **CODOPERADOR_LIBERACAO** (aprovação): **0/10.215 preenchidos** — feature morta.

## 2. Monorepo
`estoque` (022) tem 1 saldo `qtde` por (idproduto,idempresa), movido só pela NF (027, upsert relativo + kardex `historico_prod`). O ajuste é o write-path MANUAL que faltava. `MOTIVOS_OPERACAO` não existia — criado como lookup (059). Molde: serviço VERTICAL (como caixa/nf-processamento).

## 3. Corte-1 (ENTREGUE)
- **Migration 059**: `motivos_operacao` (lookup + seed 6 motivos + view) + `ajuste_estoque` (flat) + RBAC (`FRMAJUSTEESTOQUE`/`FRMCADMOTIVOOPERACAO`). Kardex reusa `historico_prod` (origem='AJUSTE').
- **Serviço vertical `ajuste-estoque.service.ts`**: `ajustar` (produto+motivo check → lê+trava `estoque.qtde` → calcula qtdeatual pela OPERACAO → grava saldo (UPDATE/INSERT com backstop de corrida 23505→`AJUSTE_CONCORRENTE`) → kardex → registra ajuste) + `estornar` (reverte o saldo p/ qtdeanterior; guarda saldo==qtdeatual; `estornado='S'` CAS) + `listar`. Tenant `idempresa`+operador fail-closed.
- **Motivos CRUD** declarativo (molde marcas; soft-delete INDR). **Schema** `ajustarEstoqueSchema` (qtde≥0; AUMENTAR/DIMINUIR exigem >0; SUBSTITUIR aceita 0=zerar). **Front** `AjusteEstoquePage` (vertical: produto/operação/qtde/motivo/destino/obs + histórico c/ estorno) + `MotivosOperacaoCadMaster` + rotas `/estoque/ajuste`, `/cadastro/motivos-operacao` + menu.

### Divergências CONSCIENTES (auditoria 2 agentes)
- **Saldo negativo PERMITIDO** — fiel ao legado (677 casos); removido o bloqueio inicial (ao contrário da NF, que bloqueia por gate). É a divergência que o auditor de paridade marcou ALTA e foi CORRIGIDA (allow).
- **DESTINO single-bucket** — o ajuste move o único `estoque.qtde` e guarda DESTINO como rótulo. Risco documentado: enquanto DESTINO for só rótulo, um ajuste de depósito ('ESTOQUE') mexe no saldo único (no legado afetaria o almoxarifado, não a loja). Split ESTOQUE_DEP = adiado.
- **Estorno via `estornado='S'`** + reverte saldo (guarda) — o legado é append-only (sem estorno formal); é recurso a mais (convenção monorepo), não infiel.
- **Kardex `origem='AJUSTE'`** + tipo E/S + saldo_anterior/novo — o legado deixa `origem_documento` vazio e usa `QTDE_ALTER` com sinal; convenção do monorepo (herdada da NF), diverge só no rótulo/forma, não no saldo.
- **Motivos seedados (codmotivoop 1–6, tipo_operacao='AJUSTE')** são um **re-seed NOVO** — o legado não tem taxonomia 'AJUSTE' (usa codmotivo 1=CANC_A + 999 órfão). **Risco de CUTOVER:** se importar AJUSTE_ESTOQUE histórico (codmotivo 1/999), o join daria descrição errada e 999 seria rejeitado pela FK → exigirá remap na migração de dados.

## 4. Adiado (com procedência)
- **Split loja/almoxarifado** (ESTOQUE.QTDE_ALMOXARIFADO + HISTORICO_PROD_DEP; DESTINO real) — depende do modelo multi-bucket de estoque.
- **CODOPERADOR_LIBERACAO / aprovação** (feature morta no legado — 0 linhas).
- **MINIMO/MAXIMO no ajuste** (editáveis via Produto; o ajuste do legado também os grava como snapshot).
- **Inventário (origem='I', FRMINVENTARIO)** — o AJUSTE_ESTOQUE unifica manual('A')+inventário('I'); o corte-1 faz só o manual.

## Corte "DATA e destino do legado" (25/09/2026) — auditoria de esqueletos §4.14

- Grava **DATA** (hora do servidor, UajusteEstoque.pas:414) — a coluna do legado e do histórico migrado; antes só `dtcadastro`,
  e a lista mostrava a data da carga nos migrados. A lista agora usa `coalesce(data, dtcadastro)`.
- **Destino como código**: 'E' loja (ESTOQUE), 'D' depósito (ESTOQUE_DEP) — a produção tem 'E' em 100% de 2025-26. O 'D' mexe
  no saldo do depósito (antes a opção "depósito" alterava a loja); o estorno reconhece 'D' e o 'DEPOSITO' do inventário rotativo.
- Histórico do kardex com o texto do trigger ESTOQUE_AJUSTE: "AJUSTE DE ESTOQUE LOJA <motivo> OPERADOR:<login>" (ajuste 23915).
- Smoke §209.

## A aba "Histórico" (01/10/2026)

Faltava a `TbsConsulta` do legado (`BtnFiltrarConsClick` → `QryConsulta`, UdmAjusteEstoque.dfm): os ajustes da loja do login com o
produto e o período opcionais (`FiltroData`: só com as duas datas; inicial maior que a final → "A data inicial não pode ser maior que a
final."), na ordem da data, com motivo, produto e operador. `GET cadastro/ajuste-estoque/consulta` e o "Imprimir"
(`consulta/impressao`): o AjusteEstoque.fr3 do cliente com o dataset FDBAjusteEstoque, PERIODO = "<inicial> à <final>" e EMPRESA entre
aspas; sem ajuste, "Não foram encontrados ajustes para imprimir". Os botões não têm Tag (o acesso à tela), e a aba também é a que o
"Detalhar" do kardex do produto abre (`?idproduto=&data=`; aceita o acesso ao FRMCADPRODUTO). O "Exportar" (Excel) fica com a
exportação genérica da grade. Smoke §285.

## Auditoria do `UajusteEstoque.dfm` (15/10/2026) — controle a controle

Produção 2025-26 (somente leitura): DIMINUIR 1.744 · AUMENTAR 912 · **SUBSTITUIR 19** (todos com QTDE = anterior = atual) — o binário novo
troca o SUBSTITUIR pela diferença e só grava SUBSTITUIR quando o informado é igual ao saldo; QTDE 0 em 9 SUBSTITUIR e 1 DIMINUIR.
TIPO_ESTOQUE = 'A' global e **'L' na loja 1** (específica).

| Controle do legado | Apollo |
|---|---|
| `edtCodProd` + F3 (`btnBuscaProduto`) + `edtCodProdExit` | Produto. **O filho vira o pai** (RetornarProdutoPai, :574): "Atenção este produto é filho, ajuste permitido apenas no pai" — a tela troca para o pai e a API recusa o filho (`AJUSTE_PRODUTO_FILHO`, com o pai no detalhe). |
| `lblEstLoja/lblEstMinLoja/lblEstMaxLoja`, `lblEstDep/…` (AbreSegs) | Os saldos da loja e do depósito ao escolher o produto (`GET cadastro/ajuste-estoque/saldos/:id`). A troca (`lblEstTroc`, ESTOQUETROCA) fica de fora: o combo do destino só tem LOJA e DEPOSITO e a tabela não tem saldo na produção. |
| `CBoperacao` (DIMINUIR/AUMENTAR/SUBSTITUIR) | **O SUBSTITUIR grava AUMENTAR/DIMINUIR pela diferença** (btnOkClick :311-325) e, igual ao saldo, fica SUBSTITUIR com anterior = atual (o fonte de 2020 recusava "Ajuste não realizado…"; a produção grava, para mudar só o mínimo/máximo). Antes o Apollo gravava SUBSTITUIR com o saldo absoluto. |
| `CBdestino` (LOJA/DEPOSITO) + `CBdestinoExit` | Destino; o mínimo e o máximo do destino abrem nos campos; **TIPO_ESTOQUE = 'L' bloqueia o depósito** ("Ajuste de estoque no depósito, bloqueado!", na tela e na API) — mig 426 traz a config. |
| `edtQtde` | Quantidade ≥ 0 em qualquer operação (antes o Apollo exigia > 0 em Aumentar/Diminuir). |
| `edtQtdeMinimo` / `edtQtdeMaximo` | Mínimo e máximo (já gravavam no saldo e no ajuste). |
| `edtCodmotivo` + F3 | Motivo; "Informe o motivo do ajuste!". |
| `MemObservacao` | Observação. |
| `btnOk` "Ajustar" (Tag 1) | **"Ajustar"** com BTNOK na tela (antes "Aplicar ajuste" sem a checagem; a rota já exigia). "Obrigatório informar destino."; "Ajuste realizado com sucesso! Estoque atual: X"; a tela limpa o produto, o motivo, a observação e as quantidades, como o legado. |
| Aba **Histórico**: produto, datas, Filtrar, grade (13 colunas), `BtnImprimir` | Já convertidos (01/10). |
| `BtnExportarExcel` "&Exportar" | **Novo**: a grade do Histórico em planilha (CSV para o Excel, "AjusteEstoque"). |
| `MniSalvarConfiguracao` / `MniRestaurarConfiguracoes` (o layout da grade) | Fora: preferência visual da estação. |
| Lista "Ajustes recentes" + Estornar | Recurso do Apollo (o legado é só inclusão); a lista passou a pedir o acesso à tela (era livre). |

Smoke §330 (o SUBSTITUIR pela diferença e o igual, o filho, os saldos, o depósito bloqueado, a lista sem acesso); §47.10 atualizado
(quantidade 0); jsdom `ajusteEstoquePage.spec.tsx`.
