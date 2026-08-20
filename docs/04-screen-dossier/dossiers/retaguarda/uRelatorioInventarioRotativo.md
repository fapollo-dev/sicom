# INVENTÁRIO ROTATIVO (`FRMRELINVENTARIOROTATIVO`) — recon

O vizinho que o épico do balanço revelou, e o **alvo mais recente de toda a varredura**: `INVENTARIO_ROTATIVO`
tem movimento até **31/07/2026** — mais recente que a `NFE_INUTILIZADA` (28/05/2026), que até aqui era a campeã.
82 lotes, 4 empresas, 1.399 linhas, janela 09/09/2020 → 31/07/2026.

Diferente do inventário geral (já migrado), este tem **máquina de estado** (abrir/fechar lote), **coletor** e duas
pontes de dinheiro: **NF de perdas** e **NF de sobras**.

## 1. Uma tabela, dois papéis

`INVENTARIO_ROTATIVO` guarda **cabeçalho de lote e movimento coletado na mesma tabela**, distinguidos por
`OPERACAO` (medido no golden):

| papel | `OPERACAO` | `TIPO` | linhas |
|---|---|---|---:|
| movimento coletado | `SUBSTITUIR` (destino LOJA) | — | 1.151 |
| movimento coletado | `AUMENTAR` (destino LOJA) | — | 128 |
| movimento coletado | `SUBSTITUIR` (destino `E`) | — | 25 |
| cabeçalho — lote aberto | `ABERTO` | `R` | 49 |
| cabeçalho — lote aberto | `ABERTO` | — | 24 |
| cabeçalho — lote fechado | `FECHADO` | — / `G` / `R` | 13 / 8 / 1 |

`TIPO` `R` = rotativo, `G` = geral. `DESTINO` = `LOJA` ou `E`. Colunas de quantidade: `QTD_ANTERIOR`,
`QTD_ATUAL`, `QTD_COLETADA`. Filtros do lote gravados no cabeçalho: `CODGRUPO`, `CODSUBGRUPO`, `CODSECAO`,
`CODFORN` (+ `INVENTARIO_ROTATIVO_DPTO`, 22 linhas, para vários departamentos por lote). Ainda:
`EXIGECONFIRMACAO`, `ALMOXARIFADO_PADRAO`, `PRODUTOINATIVO`/`PRODUTO_INATIVO`/`BUSCA_INATIVO`, `NOMELOTE`,
`DATA_FINALIZADA` (9 preenchidas).

## 2. Fechar inventário (`btnFecharInventarioClick`, uRelatorioInventarioRotativo.pas:227-339)

Confirma *"Fechamento do inventário rotativo da empresa X. Deseja continuar?"* e então segue **um de dois
caminhos**, nesta ordem:

- **lote 0 (coletas soltas)**: pega um número novo (`GetID('CODLOTE_INV_ROTATIVO')`), grava uma linha
  `OPERACAO='FECHADO'` com esse lote e a empresa, e depois **carimba as coletas órfãs**:
  `UPDATE INVENTARIO_ROTATIVO SET LOTE = <novo> WHERE LOTE IS NULL AND IDEMPRESA = <emp>`.
  ⚠️ este ramo **não abre transação** (o outro abre) — se o UPDATE falhar, a linha `FECHADO` fica sozinha.
- **lote > 0 (lote aberto)**: grava a linha `FECHADO` **copiando** `NOMELOTE` e os filtros
  (`CODGRUPO`/`CODSUBGRUPO`/`CODSECAO`) do registro `ABERTO` do mesmo lote, replica os departamentos de
  `INVENTARIO_ROTATIVO_DPTO` para o novo id, grava histórico (`SetaHistorico`, ação `Fechamento`) e comita —
  com `Rollback` no except.

⇒ **o estado do lote é uma LINHA NOVA, não um UPDATE**: o mesmo lote tem uma linha `ABERTO` e outra `FECHADO`
(event log). Qualquer consulta de "lotes abertos" tem de ser *existe ABERTO e não existe FECHADO*, não um campo.

## 3. As duas pontes de dinheiro: NF de perdas e de sobras

O carimbo **não é feito por esta tela** — é a **tela de NF** que fecha o ciclo (`uNF.pas:5267` e `:5280`):

```sql
UPDATE INVENTARIO_ROTATIVO SET IMPORTADO_PERDAS = 'S', CODNF_PERDAS = <codnf> WHERE …
UPDATE INVENTARIO_ROTATIVO SET IMPORTADO_SOBRAS = 'S', CODNF_SOBRAS = <codnf> WHERE …
```

- na NF, ao importar o inventário rotativo, `uNF.pas:12832-12834` **barra o reimporte**: *"O inventário rotativo
  de lote X já foi importado em nota fiscal de código Y"* — e a grade **colore** por `IMPORTADO_PERDAS`
  (`uNF.pas:12763`, `:12917` para sobras);
- e o **estorno existe**: `udmNF.pas:3418-3457` desfaz o carimbo quando a NF é excluída/cancelada
  (`SET IMPORTADO_PERDAS='N', CODNF_PERDAS=NULL` para os registros daquela NF; idem sobras).
- na tela do rotativo, as colunas `CODNF_PERDAS`/`CODNF_SOBRAS` são clicáveis e abrem a NF
  (`uRelatorioInventarioRotativo.pas:415-428`).

Golden: **1 lote com NF de perdas** gerada, nenhum com sobras. É pouco — mas é dinheiro e estoque, e o gate
anti-reimporte é regra dura.

## 4. ⛔ O elo com o BALANÇO existe no dado e **não** no fonte

`CODBALANCO_INICIAL` e `CODBALANCO_FINAL` estão preenchidos em **8 linhas** e apontam para as fotos
`BALANCO_GERAL_SALDO_ANTERIOR_28012026` (empresas 1 e 51) e `BALANCO_GERAL_SALDO_ANTERIOR_12032025` — exatamente
os pares "antes/depois" que o dossiê do balanço não conseguiu explicar. **Mas `CODBALANCO_INICIAL`/`_FINAL` não
aparecem em nenhum `.pas` nem `.dfm` do repo clonado.**

⇒ mesmo veredicto da lição 35 (e do `IMOV_ANALISE_CONCORRENTE`): **a regra que preenche o elo é de uma versão do
app mais nova que o fonte clonado (2020)**. Consequências para o corte:
1. está **explicado** de onde vêm as fotos `BALANCO_GERAL_*` do golden (é o inventário **geral**, `TIPO='G'`, do
   rotativo) — o comando "Gerar Balanço a partir do Inventário" que migramos grava outra descrição;
2. o Apollo **não deve inventar** o encadeamento automático foto-inicial/foto-final: as colunas entram para a
   carga não perder o vínculo, sem lógica, até haver fonte ou decisão do usuário.

## 5. Configurações próprias (todas medidas no golden)

| config | valor | o que decide |
|---|---|---|
| `INVENTARIO_ROTATIVO_ESTOQUE_DEPOSITO` | `N` | usar o estoque de depósito no rotativo |
| `USUARIOS_ZERAM_INVENTARIO_ROTATIVO` | `S` | quem pode zerar produtos não coletados (lista por usuário, `uInvRotativoGrid.pas`) |
| `COLETOR_INVENTARIO_BUSCA_COD_AUXILIAR` | `N` | busca por código auxiliar na coleta |
| `INVENTARIO_ROTATIVO_DIGITO_SEPARADOR` | `/` | separador na importação do arquivo do coletor |
| `INVENTARIO_GERAL_VALOR_QUANTIDADE` | (vazio) | teto de quantidade por leitura |

`INVENT_GERAL_LEITURA` (21 linhas) é a staging das leituras do arquivo do coletor
(`COD_ARQUIVO_INVENTARIO`, `CODBARRA`, `QUANTIDADE`, `QUANTIDADE_ALTERADA`, `DATA`).

## 6. RBAC e fontes

`FRMRELINVENTARIOROTATIVO` com 3 opções no golden, 34 linhas/15 operadores cada: o gate da tela,
**`BTNNOVOLOTE`** e **`BTNFECHARINVENTARIO`**. Fontes: `uRelatorioInventarioRotativo.pas` (1.424 linhas, a tela),
`UFrmLoteInventarioRotativo.pas` (407, o novo lote), `uInvRotativoGrid.pas` (448, a grade/coleta),
`UDMRelatorioInventarioRotativo.pas` (206) + os `.dfm`.

## 7. Proposta de cortes

1. **corte-1 — o lote e seu ciclo**: `inventario_rotativo` (+ `_dpto`), novo lote com os filtros
   (grupo/subgrupo/seção/fornecedor/departamentos + `exigeconfirmacao`/`almoxarifado`/inativos), lista de lotes
   com o estado derivado (`ABERTO` sem `FECHADO`), e o **fechar** nos dois caminhos — inclusive o carimbo das
   coletas órfãs (`LOTE IS NULL`), que aqui vai **dentro** de transação (a divergência fica registrada).
2. **corte-2 — coleta**: as quantidades (`qtd_anterior`/`qtd_atual`/`qtd_coletada`), `SUBSTITUIR` × `AUMENTAR`,
   `INVENT_GERAL_LEITURA` + importação do arquivo do coletor (com o separador da config) e o zerar-não-coletados
   com a lista de usuários autorizados.
3. **corte-3 — as pontes de NF**: importar perdas/sobras para NF com o gate anti-reimporte e o estorno no
   cancelamento da NF (`udmNF.pas:3418-3457`).
4. **fora do corte, declarado**: o encadeamento `CODBALANCO_INICIAL`/`_FINAL` (§4 — sem fonte auditável).
