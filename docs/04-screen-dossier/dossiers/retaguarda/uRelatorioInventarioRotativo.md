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

1. **corte-1 — ENTREGUE** (mig 170): `inventario_rotativo` (+ `_dpto`) com as 29 colunas do golden, abrir lote
   (nome obrigatório, número de lote em sequência PRÓPRIA, filtros **NULL quando vazios** — no golden nunca são 0,
   apesar do `StrToIntDef(...,0)` do fonte —, N departamentos e histórico de "Abertura"), alterar **só o
   cabeçalho** (o legado não recria os departamentos), lista com o estado **derivado** (`ABERTO` sem `FECHADO`) e o
   **fechar** nos dois caminhos. Sete checks no smoke (§87). Decisões registradas:
   - o carimbo das coletas órfãs (`LOTE IS NULL AND IDEMPRESA = emp`) vai **dentro** de transação — o legado roda
     esse ramo sem transação, e uma linha `FECHADO` órfã não interessa a ninguém (divergência consciente);
   - **fechar duas vezes é permitido** (o legado não checa e cria outra linha `FECHADO`): copiado, mas o retorno
     traz `ja_fechado: true` para a tela avisar;
   - o histórico do legado (`SetaHistorico`, que grava na tabela `LOG` do Oracle — inexistente aqui) foi mapeado
     em `historico_dinamico` com `tabela='INVENTARIO_ROTATIVO'`, `chave='LOTE'` e `origem` do form.
   Front pendente (declarado): a tela entra junto com o corte-2, que é onde a coleta aparece.
2. **corte-2 — PARCIALMENTE ENTREGUE** (mig 171): o **zerar estoque pela grade** (`BtnZerarEstoqueClick` +
   `ZeraEstoque`, uInvRotativoGrid.pas:146-446) — a parte de dinheiro. Gate duplo (quais estoques + **liberação
   por login** contra a lista da config `USUARIOS_ZERAM_ESTOQUE_INVENTARIO`, id 46, que no golden está **vazia**:
   sem grant, ninguém zera) e os **três fatos** por produto × bucket: zera `estoque`/`estoque_dep`, grava a coleta
   (`SUBSTITUIR`, `DESTINO` LOJA/DEPOSITO, `QTD_ANTERIOR` = saldo, `QTD_ATUAL`/`QTD_COLETADA` = 0) e grava o rastro
   em `ajuste_estoque` (`CODMOTIVO` 999, `ORIGEM='I'`, `IDORIGEM` = a coleta, `OPERACAO` = `AUMENTAR` quando o
   saldo era negativo). Mais a **tela** (`/estoque/inventario-rotativo`): abrir/renomear/fechar nos dois caminhos
   e o zerar com liberação. Dois checks no smoke (§87.8/87.9).
   ⚠️ **achado de cutover**: o legado grava `CODMOTIVO = 999` e **o motivo 999 não existe em `MOTIVOS_OPERACAO`**
   no golden — ainda assim **2.638 ajustes** o usam (1.312 com `ORIGEM='I'`). O Oracle não tem FK que barre; a
   nossa tem, então a migration cria a linha 999 para a carga não quebrar.
   **Falta do corte-2**: a coleta propriamente dita (leitura do coletor em `INVENT_GERAL_LEITURA`, importação do
   arquivo com o separador da config `INVENTARIO_ROTATIVO_DIGITO_SEPARADOR`) e o zerar-não-coletados
   (`USUARIOS_ZERAM_INVENTARIO_ROTATIVO`, que é config diferente da usada aqui).
3. **corte-3 — as pontes de NF**: importar perdas/sobras para NF com o gate anti-reimporte e o estorno no
   cancelamento da NF (`udmNF.pas:3418-3457`).
4. **fora do corte, declarado**: o encadeamento `CODBALANCO_INICIAL`/`_FINAL` (§4 — sem fonte auditável).

## 8. CORTE-3 ENTREGUE — as duas pontes de NF (2026-09-01)

O ciclo fecha. O que entrou, com a procedência de cada metade:

**A diferença por produto** (`diferencasDoLote`) é a `sqqInventarioRotativo` do legado (`udmNF.dfm:19003-19086`),
e ela não é "contado − sistema":

| campo | como sai |
|---|---|
| `QTD_ANT` | `qtd_anterior` da coleta de **MENOR** id com operação `'SUBSTITUIR'` |
| `QTD_ATUAL` | `qtd_atual` da coleta de **MAIOR** id com operação em (`'SUBSTITUIR'`,`'AUMENTAR'`) |
| `QTD_DIFERENCA` | `QTD_ATUAL − QTD_ANT` — negativo é PERDA, positivo é SOBRA |

**Prévia** (`POST itens-nf`): agrega por produto (produto repetido entre lotes vira UMA linha, com o custo em
**média ponderada** `total/quantidade`, `uNF.pas:14174`), custo de `MULTI_PRECO.VRCUSTO`, alíquota do produto
com vazio virando `'0'` (`:14213`), `fatorembal` 1. CFOP da **nota** 5927/6927 (perdas) e 1949/2949 (sobras)
conforme a UF; **CFOP do ITEM fixo** em 5927 / 1949 (`:14189`, `:14284`) — quirk copiado, mesmo quando a nota é
interestadual. Observação literal do legado (`:12886`).

**Gate anti-reimporte** (`uNF.pas:12832`): é **por lote e por lado** — o lote já importado é PULADO com aviso e
os outros seguem; o legado não aborta a importação inteira. Roda na prévia e **de novo dentro da transação** do
vincular (o legado carimba fora de transação e tem essa corrida em aberto).

**Carimbo** (`POST vincular-nf`, `uNF.pas:5267`/`:5280`): `IMPORTADO_x='S'` + `CODNF_x` **só na linha
`OPERACAO='FECHADO'`**. Recusa o par errado com `NF_TIPO_INCOMPATIVEL` — perdas exige nota de saída e sobras
nota de entrada, porque é o TIPO que o estorno usa para escolher o lado.

**Estorno** (`udmNF.pas:3406-3463`): o legado trata `taExcluir` e `taCancelar` na MESMA rotina, então a regra
vive num módulo só (`inventario-rotativo-nf.ts`) com dois chamadores — o cancelamento da NF-e e o hook
`aoRemover` do agregado de NF (hook novo no engine, para não gravar dentro de um `validarRemocao`).

### Divergências conscientes

1. **Fold de segurança**: as subconsultas de QTD_ANT/QTD_ATUAL do legado **não filtram `IDEMPRESA`**. Como o
   `lote` é sequência por empresa, dois tenants com o mesmo número se contaminariam — aqui elas filtram.
2. **Quirk copiado, com aviso**: o `GROUP BY` do legado inclui `TRUNC(I.DATA)` sem selecioná-la, então um
   produto coletado em dois dias no mesmo lote rende duas linhas com a MESMA diferença, e a inclusão soma por
   produto ⇒ quantidade dobrada. É dinheiro, então ficou fiel; a resposta devolve `linhas_duplicadas` para a
   tela avisar.
3. **O cálculo fiscal fica no motor da NF**: a prévia devolve os parâmetros (alíquota, ICMS/ICME/CST/BCR de
   `det_aliquota` pela UF, como o `cdsAliquota` do legado em `:14216-14226`), não o imposto calculado —
   duplicar o `CalcValorNota` seria criar uma segunda verdade sobre o mesmo número.

Smoke §88.11 a §88.16 (seis checks): prévia de perdas e de sobras, CFOP interno × interestadual, tipo de nota
incompatível, carimbo só no FECHADO, gate por lote e por lado, estorno no cancelamento e estorno na exclusão.

### ⛔ O resto do corte-2 NÃO tem fonte — veredicto (2026-09-01)

A seção 5 deste dossiê listava a coleta pelo coletor e o zerar-não-coletados como "falta do corte-2", presumindo
que a lógica estivesse no fonte. Fui buscar para implementar e **ela não está**: a varredura de TODO o
`/Library/SicomGit/` (não só `Units/`, `.pas` e `.dfm`, com `grep -a`) devolve **zero ocorrências** de

- `INVENT_GERAL_LEITURA` (a staging das leituras — existe no golden com 21 linhas),
- `INVENTARIO_ROTATIVO_DIGITO_SEPARADOR` (a config do separador do arquivo),
- `USUARIOS_ZERAM_INVENTARIO_ROTATIVO` (a config de quem zera não-coletados),
- `COLETOR_INVENTARIO_BUSCA_COD_AUXILIAR`.

O único "zerar" em `uInvRotativoGrid.pas` é o **zerar-estoque** já migrado (config
`USUARIOS_ZERAM_ESTOQUE_INVENTARIO`, `:189`). As configs e a staging são DADO — vivem no Oracle porque outro
binário (o aplicativo do coletor, que não está no clone) as lê e grava. É o mesmo caso de `PIX_TRANSACAO`,
`IMOV_ANALISE_CONCORRENTE` e `CARTAO_SELECAO`: tabela viva, fonte ausente ⇒ **bloqueado pela lição 35**, e o
dossiê estava errado ao prometer esse pedaço.

Com isso o épico do inventário rotativo está **completo no que tem fonte**: lote (abrir/alterar/fechar nos dois
caminhos), zerar-estoque pela grade com liberação por login, e as duas pontes de NF com gate, carimbo e estorno.
Se o fonte do coletor aparecer, a staging `INVENT_GERAL_LEITURA` entra pela carga e a rotina entra por recon
próprio.

### O que ainda falta (com fonte)

O **front das pontes**: a tela de NF precisa consumir a prévia (`itens-nf`) e chamar o `vincular-nf` ao gravar,
mostrando os lotes recusados e o aviso de `linhas_duplicadas`.
