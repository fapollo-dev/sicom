# RELATÓRIO DE TROCA DE MERCADORIAS (`FRMRELTROCAMERCADORIAFOR`) — completa

`uRelTrocaMercadoriaFor.pas` (685) + `.dfm` (969). Herda o `TFrmRelMaster`. **29 acessos.** Também aberto pelo "Imprimir" e pelo
"Filtros" da tela da troca (`TfrmTrocaMercadoriaFor.btnImprimirClick` / `Filtros1Click`).

Antes classificada "marginal" na FILA-CONVERSAO #51 (volume: 107 trocas, 309 itens, a última em 24/11/2025) — volume baixo não é
tela morta: convertida.

## 1. O SQL (`TRelatorio.create`)

```
TROCA T ⟕ ITENS_TROCA I ⟕ ITENS_TROCA_QTDE ITQ (CODITENSTROCA, CODEMPRESA = T.CODEMPRESA) ⟕ NF_PROD NP (CODITENSQTDE_TROCA = ITQ.CODITENSQTDE)
        ⟕ NF N ⟕ PRODUTOS ⟕ PARCEIROS P ⟕ EMPRESAS E
QTDE_EDICAO = COALESCE(ITQ.QTDE, 0);  TOTAL = QTDE_EDICAO × VRCUSTO;  VRVENDA = MULTI_PRECO do produto na loja da troca;
EMPRESA = COALESCE(FANTASIA, RAZAOSOCIAL)
```

### ITENS_TROCA_QTDE é ITENS_TROCA

Na produção (05/10/2026): CODITENSQTDE = CODITENSTROCA, CODEMPRESA = a da troca e QTDE iguais em **309/309**; STATUS 'F' ⟺
FECHADO 'S' (179/179) — `tools/cutover/conferir-tabelas-fora.py` a tem como EQUIVALENTE. O destino guarda só o item; o ITQ é o
item quando a loja dele é a da troca, e a nota de devolução (`NF_PROD.CODITENSQTDE_TROCA`, 45 itens ligados) liga pelo
CODITENSTROCA. O STATUS aberto do legado é nulo em 129 itens e 'A' em 1: tudo "Aberta" no `COALESCE(STATUS, 'A')`; aqui 'A'.
(Consequência mínima: o GROUP BY STATUS do sintético do legado separaria nulo de 'A' — uma linha a mais para o único item 'A'.)

## 2. Os filtros (`MontaFiltroSQL`)

- `TRUNC(T.DATA) BETWEEN` as datas; `T.CODEMPRESA IN` (as lojas do `GetMultiEmpresa`); `T.CODPARCEIRO`; `T.CODTROCA`;
- produto (`I.IDPRODUTO`), departamento, grupo, subgrupo (`PROD.*`);
- **status** (`RgpStatus`, padrão "Todos"): o status da troca é o do **primeiro item** — `(SELECT COALESCE(STATUS,'A') … WHERE
  Q.CODTROCA = T.CODTROCA AND ROWNUM = 1) <> 'F'` (aberto) / `= 'F'` (fechado). A troca sem item tem o subselect nulo e não entra em
  nenhum dos dois. O `ROWNUM = 1` sem ordem do Oracle vira o item de menor código.
- **aberto pela troca** (`FCodigo > 0`): só `T.CODTROCA`; nem data, nem lojas, nem fornecedor; `IDEmpresas` = a loja do login; o
  período do layout = a data da troca.
- sem data pelo menu: "Favor informar a data." (o `OnExitData` do TFrmRelMaster).

## 3. Os três tipos (`RgpTipoRelatorio`)

| tipo | impressão (DBDRelatorio) | grade (`AntesImprimir` → `TfrmRelGrid`) |
|---|---|---|
| **Analítico Agrupado** (padrão) | `TrocaMercadoria_Analitico_Agrup.fr3`, `ORDER BY T.DATA, P.RAZAO, T.CODTROCA`, grupo por CODPARCEIRO | a troca (CODTROCA, CODEMPRESA, DATA, CODIGO, FORNECEDOR, DESCRICAO_TROCA, Σ TOTAL, ORDER BY CODTROCA) com os itens como detalhe |
| **Analítico** | `TrocaMercadoria_Analitico.fr3` (sem ORDER BY no fonte; aqui troca, item) | item a item, com STATUS "Fechada"/"Aberta" |
| **Sintético** | `TrocaMercadoria_Sintetico.fr3` — **os registros do item** (o fonte não agrega a impressão; o layout lista) | Σ QTDE, Σ VRCUSTO, Σ TOTAL por CODBARRA, DESCRICAO, VRVENDA, STATUS |

O nome no fonte (`TrocaMercadoria_Analitico_Agrup.fr3`) e o da RELATORIOS (`TrocaMercadoria_analitico_agrup.fr3`) diferem na caixa —
o Windows não distingue, e o `modeloFr3` compara sem caixa. Layouts PERSONALIZADOS 1050/1051/1052; teste de renderização dos três.

## 4. A tela da troca

O "Imprimir" da troca abre este relatório preso nela (`/relatorios/troca-mercadoria?codtroca=N&daTroca=1`: data, troca e
fornecedor desabilitados, como o `SetAllEnabled([...], False)` do `FormShow`). RBAC: a tela do relatório **ou** a da troca.

## 5. Cobertura (smoke §296, 5 checks)

1. o agrupado: a troca com Σ(QTDE × VRCUSTO), os itens com status e o VRVENDA da loja; a troca sem item com total 0; a outra loja fora;
2. o status pelo primeiro item; a troca sem item fora de "Aberto" e "Fechado";
3. o sintético por status; os filtros por produto e lojas;
4. aberto pela troca; a data obrigatória pelo menu;
5. a impressão nos três layouts, a ordem do agrupado, o período da troca e a mensagem sem registro.
