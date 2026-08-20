# INVENTÁRIO — a metade que falta: **BALANÇO** (`BALANCO` / `BALANCOITENS`)

Recon disparado pela varredura por dado: `BALANCOITENS` tem **980.574 linhas** e nenhuma referência no
`apps/api`. O placar mandava "conferir contra o épico Inventário antes de qualquer coisa". Conferido: **não é o
inventário que já migramos** — é a outra metade da mesma tela.

O que migramos na mig 090 foi `INVENTARIO_LIVRO` + `INVENTARIO` (a folha de contagem) com três operações:
`importarProdutos` (= "Gerar Inventário"), `diferencas` (a coluna calculada do grid) e `aplicar`
(= "Atualiza Estoque à partir Inventário"). O popup da tela do legado (`uInventario.dfm:6351-6404`) tem **dez**
comandos. Sete não têm equivalente no Apollo, e **cinco deles giram em torno do balanço**:

| # | comando (caption literal) | handler | estado |
|---|---|---|---|
| 1 | Gerar Inventário | `Importarprodutos1Click` | ✅ `importarProdutos` |
| 2 | **Importar Balanço** | `btnImportarClick` → `ImportaBalancoInserindo` | ❌ |
| 3 | **Importar Balanço e Atualizar Estoque** | `btnImportarSincronizarClick` → `ImportaBalancoSincronizar` | ❌ |
| 4 | Zerar Qtde na Grade | `btnZerarQtdeClick` | ❌ (UI) |
| 5 | Atualizar Custo do Inventário à partir do Cadastro dos Produtos | `AtualizaCustodoInventriocomoProduto1Click` | ❌ |
| 6 | **Gerar Balanco à partir do Inventário** | `GerarBalanco1Click` | ❌ |
| 7 | Atualiza Estoque à partir Inventário | `AtualizaEstoque1Click` | ✅ `aplicar` |
| 8 | **Sincronizar Inventário (Entradas - Saídas)** | `SincronizarInventrio1Click` (usa `cdsMovimentos`) | ❌ |
| 9 | **Relatório Diferença do Balanço para Estoque** | `RelatorioDiferencaBalancoClick` | ❌ |
| 10 | Restituição de tributação | `Restituiodetributao1Click` | ❌ (fiscal, recon próprio) |

---

## 1. O que é o balanço, pelo dado

`BALANCO` = **24 cabeçalhos** `(CODBALANCO, DESCRICAO, DATA, CODOPERADOR, CODEMPRESA, ATIVO, auditoria)`;
`BALANCOITENS` = **980.574** itens `(CODBALANCOITENS, CODBALANCO, CODEMPRESA, IDPRODUTO, IDPRODUTO_FILHO, QTDE)`
— ≈ 40 mil itens por balanço, ou seja **a base inteira de produtos** por foto.

O golden mostra a rotina real (operador 1, empresas 1 e 51):

```
  1 INICIAL                                 20/08/2020
 21 POSICAO ANTERIOR / 22 ZERADO / 23 FINAL  14/09/2020
 41 CORRECAO ESTOQUE DUPLICAÇÃO / 42 ZERADO / 43 CORRECAO ESTOQUE   12/11/2021
 61 BALANCO_GERAL_SALDO_ANTERIOR_14032024    14/03/2024
 81 BALANCO_GERAL_18032024                   18/03/2024
101/102 BALANCO_GERAL_SALDO_ANTERIOR_02042024 · 103 BALANCO_GERAL_02042024   02/04/2024
121 BALANCO_GERAL_SALDO_ANTERIOR_12032025 · 122 BALANCO_GERAL_12032025       12/03/2025
161..170 dez balanços em 28/01/2026 (pares SALDO_ANTERIOR/GERAL nas empresas 1 e 51)
```

Três leituras: (a) o épico está **vivo** (última foto em 28/01/2026, a mais recente da tela); (b) o padrão de nome
`BALANCO_GERAL_SALDO_ANTERIOR_<ddmmyyyy>` / `BALANCO_GERAL_<ddmmyyyy>` é gerado por código, aos pares — a casa
tira uma foto **antes** e outra **depois** de efetivar o balanço geral; (c) `ATIVO` está **NULL nas 24 linhas** —
e o legado lê `WHERE (ATIVO IS NULL OR ATIVO = 'S')` (`sqqDataBalanco`), então NULL = ativo. Não inventar default 'S'.

⚠️ `IDPRODUTO_FILHO` existe na tabela, **nenhum dataset do inventário o preenche ou lê**, e no golden só
**131 das 980.574** linhas o têm preenchido — resíduo, não regra. Entra como coluna (para a carga não perder as
131), sem lógica.

### 1b. O que a medição do golden muda no desenho

| medida | valor | consequência |
|---|---:|---|
| itens | 980.574 em 24 balanços / 2 empresas | ≈ 43 mil por foto |
| itens por balanço (todos os de 2026) | **43.071**, idêntico em 161-170 | a foto é a **base inteira de produtos**, não uma contagem seletiva |
| `QTDE = 0` | **942.437 (96,1%)** | o balanço nasce zerado e recebe as contagens; qualquer "importar só o que tem quantidade" é invenção nossa |
| `QTDE < 0` | 3.742 | saldo negativo é normal aqui — nenhum piso em zero |
| `IDPRODUTO_FILHO` preenchido | 131 | resíduo |

Soma das quantidades por foto no golden: `161/emp 1 = −2.047,03` · `167/emp 1 = 15` · `163,164,165/emp 51 = 5` ·
`170/emp 51 = 20`. Fotos de mesma data e empresa com somas diferentes = repetição de tentativa no mesmo dia;
não existe unicidade por (data, empresa) no dado, apesar de o comando 6 tratar a data como chave.

### 1c. RBAC — cada comando do popup é uma opção própria

`FRMINVENTARIO` (34 linhas / 15 operadores por opção): `IMPORTARPRODUTOS1`, `GERARBALANCO1`,
`SINCRONIZARINVENTRIO1`, `ATUALIZAESTOQUE1`, `ATUALIZACUSTODOINVENTRIOCOMOPRODUTO1`, `BTNGRAVAR`, `BTNEDITAR`,
`BTNIMPRIMIR`, `EDTCODDPTO`, `EDTCODSUBGRUPO`. O CRUD do balanço é tela própria e **viva**: `FRMCADBALANCO` com
6 opções (35 linhas / **16** operadores — mais gente que o próprio inventário): `FRMCADBALANCO`,
`BTNADICIONARREGISTRO`, `BTNADICIONARI`, `BTNGRAVAR`, `BTNEDITAR`, `BTNLIMPARI`.

Vizinhos que a consulta de RBAC revelou e que também não estão no Apollo: **`FRMRELBALANCO`** (relatório do
balanço) e **`FRMRELINVENTARIOROTATIVO`** (inventário rotativo, com `BTNNOVOLOTE` e `BTNFECHARINVENTARIO` —
tem máquina de lote, ao contrário do inventário normal). Recon próprio; ficam registrados aqui para não sumirem.

O lookup do legado é a view **`GET_BALANCO`** (existe em `user_views`) — copiar em vez de reinventar a consulta.

## 2. "Importar Balanço" (`ImportaBalancoInserindo`, uInventario.pas:1343-1483)

A regra é contraintuitiva e nunca seria adivinhada: **não importa a quantidade do balanço.** O balanço entra como
**lista de produtos**, e a quantidade vem do estoque de HOJE:

```sql
SELECT P.IDPRODUTO, P.CODSUBGRUPO, P.ALIQUOTA, P.CODBARRA, P.DESCRICAO, M.VRCUSTO, M.VRVENDA,
       U.SIGLA AS UNIDADE, M.VRCUSTOFISCAL,
       COALESCE(COALESCE(E.QTDE,0) + COALESCE(D.QTDE,0), 0) QTDE,   -- ESTOQUE + ESTOQUE_DEP, não BALANCOITENS.QTDE
       F.DESCRICAO SUBGRUPO
  FROM BALANCO B
  JOIN BALANCOITENS BI ON BI.CODBALANCO = B.CODBALANCO
  JOIN PRODUTOS      P ON P.IDPRODUTO   = BI.IDPRODUTO
  JOIN MULTI_PRECO   M ON M.IDPRODUTO   = P.IDPRODUTO AND M.IDEMPRESA = B.CODEMPRESA
  LEFT JOIN UNIDADE U ON U.CODUNIDADE = P.CODUNIDADE
  LEFT JOIN FAMILIAS_PROD F ON F.CODFAMILIA = P.CODSUBGRUPO
  LEFT JOIN ESTOQUE     E ON E.IDPRODUTO = M.IDPRODUTO AND E.IDEMPRESA = M.IDEMPRESA
  LEFT JOIN ESTOQUE_DEP D ON D.IDPRODUTO = M.IDPRODUTO AND D.IDEMPRESA = M.IDEMPRESA
 WHERE B.CODBALANCO = :codbalanco
```

- `JOIN MULTI_PRECO` (não `PRODUTOS`) é o que dá custo/preço **por empresa** — o `INNER` faz produto sem
  multi_preco da empresa **sair do inventário** (mesmo padrão de outras telas: o join interno é filtro).
- custo: `VRCUSTO`, exceto quando a config `VlrcustoInventario = 'FISCAL'` → `VRCUSTOFISCAL` **com fallback** para
  `VRCUSTO` quando o fiscal é nulo (linhas 1419-1427). A mesma regra reaparece no comando 3 (linhas 1568-1576).
- antes de importar: se o inventário tem linhas, confirma *"O inventário atual será excluído"* e executa
  `DELETE FROM INVENTARIO WHERE CODINVENT=…` (linhas 616 e 1378) — destrutivo e por livro.
- a escolha do balanço é um lookup `GET_BALANCO` filtrado por `IDEMPRESA` (linha 623-625).
- `QTDE`, `ESTOQUE_QTD` e `QTDE_IST` recebem **o mesmo valor** (o saldo atual), e `STATUS='I'`, `IDUNICO` = um
  `GetID('IDUNICO')` por lote — colunas que o nosso `inventario` **não tem**.

## 3. "Importar Balanço e Atualizar Estoque" (`ImportaBalancoSincronizar`, uInventario.pas:1485-…)

Este é o cálculo de verdade: reconstruir o saldo **a partir de uma foto** somando o movimento do intervalo.
O SQL (`udmInventario.dfm`, `sqqImportaSincroniza`) é um `UNION ALL` de quatro pernas agregadas por produto:

| perna | fonte | quantidade | filtros |
|---|---|---|---|
| saldo inicial | `BALANCOITENS` | `QTDE` | `CODBALANCO = :CODBALANCO` |
| entradas | `NF` + `NF_PROD` | `Σ QUANTIDADE × FATOREMBAL` | `TRUNC(DTCONTABIL) BETWEEN :DTINI AND :DTFIM`, `TIPO='E'`, `PROC='S'`, `CANCELADA='N'`, **CFOP IN (1102,2102,1403,2403,1910,2910,1152,1409,1157,1556,1652,1949,1202,1405)** |
| saídas (nota) | `NF` + `NF_PROD` | `Σ QUANTIDADE × FATOREMBAL` | idem datas/empresa, `TIPO='S'`, `PROC='S'`, `CANCELADA='N'`, **CFOP NOT IN (5929,6929)** |
| saídas (cupom) | `VENDAS` | `Σ QTDE` | `TRUNC(DTVENDA) BETWEEN :DTINI AND :DTFIM`, `CANCELADO='N'` |

E o saldo é montado nos dois sentidos (uInventario.pas:1506-1529), substituindo o placeholder `/*SALDO*/`:

- **para a frente** (`dataInventario > dataUltimoBalanco`): `SALDO = Σ saldo_inicial + Σ entradas − Σ saídas`,
  intervalo `[dataUltimoBalanco + 1, dataInventario]`;
- **para trás** (`dataUltimoBalanco > dataInventario`): `SALDO = Σ saldo_inicial − Σ entradas + Σ saídas`,
  intervalo `[dataInventario, dataUltimoBalanco − 1]`.

Quirks a copiar **com registro** (não inventar correção):

1. **datas iguais → nada acontece**: nenhum dos dois ramos executa, o dataset não é reaberto e a importação
   percorre o que estiver em memória (o inventário já foi apagado na linha 1502).
2. **`TOTALCUSTO`/`TOTALVENDA` usam sempre a fórmula "para frente"**, mesmo no modo retroativo — no caminho
   invertido os totais não correspondem ao `SALDO` exibido.
3. o `StringReplace` sem `rfReplaceAll` **mutila o `SQL.Text` do dataset**: depois da primeira execução o
   placeholder `/*SALDO*/` não existe mais, então a segunda sincronização da mesma sessão reusa a fórmula da
   primeira. É bug de estado de tela; no nosso desenho (query montada por chamada) ele desaparece — registrar
   como divergência consciente.
4. o `HAVING (Σ + entradas − saídas) > 0` está **comentado** no SQL ⇒ produto com saldo zero ou negativo **entra**.
5. `LEFT JOIN MULTI_PRECO` aqui (contra o `INNER` do comando 2) ⇒ produto sem preço na empresa entra com custo nulo.

## 4. "Gerar Balanço à partir do Inventário" (`GerarBalanco1Click`, uInventario.pas:1218-1299)

O caminho inverso: a contagem vira foto. Chave do balanço = **(DATA, CODEMPRESA)** (`sqqBalanco`).

- **já existe balanço nessa data** → *"Existe um balanço lançado para essa data, deseja substituir?"* (default NO)
  e então, para cada item do inventário, **`Locate` no balanço e só ATUALIZA a `QTDE` do que já existe lá**;
  produto novo **não é inserido**. O "substituir" é parcial — quirk, e vale um aviso na tela.
- **não existe** → *"Deseja realmente gerar o balanço das informações do inventário?"* (default NO), cria o
  cabeçalho com `DESCRICAO = 'GERACAO DE INVENTARIO DATA: dd/mm/aaaa'`, `CODOPERADOR` = operador logado,
  `DATA` = data do inventário, e insere um item por linha do inventário (`QTDE` = contado).
- ids por `GetID('CODBALANCO')` / `GetID('CODBALANCOITENS')` — no Apollo, sequences.

Note que a descrição gerada aqui (`GERACAO DE INVENTARIO DATA: …`) **não aparece nas 24 linhas do golden**: as
fotos de produção vieram do padrão `BALANCO_GERAL_…`, isto é, de outro caminho (a tela `uCadBalanco`
/`FRMCADBALANCO`, CRUD do balanço, ou uma rotina externa). Antes do corte, decidir se o CRUD entra — e não
afirmar que este comando é o que produziu o golden.

## 5. "Relatório Diferença do Balanço para Estoque" (`RelatorioDiferencaBalancoClick`, uInventario.pas:1981-2035)

⚠️ **Há DUAS fórmulas de diferença no legado, e elas não são a mesma.** A do grid (que já migramos fiel em
`diferencas`, `udmInventario.dfm`) é:

```
sistema<0 e contado>0 → sistema+contado ; sistema<0 e contado<0 → 0 ; senão → sistema−contado
```

A do relatório é uma cascata por sinal, calculada em memória com `RoundTo(…, -3)` e **só para as linhas
`ALTERADO='T'`** (as que o operador digitou):

| `iEst` (sistema) | `iQtd` (contado) | DIFERENCA |
|---|---|---|
| < 0 | < 0 | `iEst + iQtd` |
| > 0 | > 0 e `iEst > iQtd` | `(iEst − iQtd) × −1` |
| > 0 | > 0 e `iQtd > iEst` | `iQtd − iEst` |
| > 0 | > 0 e iguais | `iEst − iQtd` (= 0) |
| = 0 | > 0 | `iQtd` |
| > 0 | = 0 | `iEst` |
| < 0 | > 0 | `(iEst − iQtd) × −1` |
| > 0 | < 0 | `iQtd + iEst` |
| — | = 0 | `iEst × −1` |

E nas linhas **não alteradas** o relatório zera a diferença, joga `QTDE` para `QTDE_IST` e **zera `QTDE`**
(linhas 2024-2029) — ou seja, o relatório só mostra o que foi efetivamente contado.

Consequência de schema: para migrar este relatório precisamos de **`alterado`** (e `qtde_ist`) em `inventario`, e
o **escritor** de `alterado` é a digitação na grade (lição: coluna nova de regra sem escritor é coluna morta).

## 6. Onde o balanço mais aparece

- `sqqSincUltimoBalanco` (`udmInventario.dfm`): último balanço por empresa — `A.CODEMPRESA = :IDEMPRESA` **mas**
  `A.DATA = (SELECT MAX(E.DATA) FROM BALANCO E)` **sem filtro de empresa no subselect** ⇒ se outra empresa tem
  balanço mais recente, a consulta volta vazia. Quirk de multi-empresa a registrar.
- `sqqDataBalanco`: `SELECT MAX(DATA) FROM BALANCO WHERE (ATIVO IS NULL OR ATIVO='S')` — alimenta a data inicial
  do sincronismo (`uInventario.pas:1156-1158`), também **sem empresa**.
- `uCadBalanco.pas` / `udmCadBalanco.*`: o CRUD do balanço (`FRMCADBALANCO`) — grade mestre-detalhe com
  destaque de cor (`clMoneyGreen`) por linha; recon próprio quando o corte incluir a manutenção da foto.
- `UDMProdutosRel.dfm`: relatórios de produto também leem `BALANCOITENS` — conferir quais, para não deixar
  relatório migrado com fonte vazia.

## 7. Cortes

1. **corte-1 — ENTREGUE** (mig 166): tabelas `balanco`/`balancoitens` (`ativo` NULL = ativo, índice em vez de
   UNIQUE por (data, empresa) — o golden tem 5 fotos no mesmo dia), `estoque_dep`, `multi_preco.vrcustofiscal`,
   a config `VRCUSTO_INVENTARIO` (id 468 do golden, valor 'PRODUTO'), a view `get_balanco`, os endpoints
   `POST :id/gerar-balanco` (RBAC `GERARBALANCO1`) e `POST :id/importar-balanco` + `GET cadastro/balanco` (gate da
   tela, que é como o golden trata esses dois itens do popup), e os dois comandos na tela do inventário.
   Sete checks no smoke (§83b). **Dois folds de paridade no épico já migrado**, achados no caminho:
   (a) as opções de RBAC da mig 090 eram **inventadas** (`BTNIMPORTARPRODUTOS`/`BTNAPLICARESTOQUE`) e agora usam
   os nomes do golden (`IMPORTARPRODUTOS1`/`ATUALIZAESTOQUE1`) — sem isso, no cutover os grants reais dos 15
   operadores não casariam com os decorators; (b) `importarProdutos` ignorava a config `VRCUSTO_INVENTARIO`
   (uInventario.pas:1754 faz o mesmo teste dos outros quatro pontos da tela) — agora honra `FISCAL` com fallback.
2. **corte-2 — ENTREGUE** (mig 167): "Importar Balanço e Atualizar Estoque" (4 pernas, os dois sentidos com o
   intervalo espelhado, a lista literal de 14 CFOPs, `multi_preco` em LEFT e **sem piso em zero** — o `HAVING`
   comentado) e "Sincronizar Inventário (Entradas − Saídas)" (gate `cfop.proc_qtde='S'` **estrito**, recalcula só
   as linhas existentes, negativo e sem-movimento viram 0). `cfop.proc_qtde` é coluna nova de carga (golden:
   366 'S' / 17 'N' / 12 NULL). Datas iguais devolvem folha vazia **com aviso**, que é o que o legado faz.
   O `MAX(DATA)` do balanço é global (sem empresa, `sqqDataBalanco`) — copiado, com aviso quando a data mais
   recente é de outra empresa (aí o saldo inicial entra zero). Seis checks no smoke (§83c) e os dois comandos na
   tela. Nota de fuso: a perna de `vendas` usa `dtvenda AT TIME ZONE <FUSO_HORARIO_ACESSO>` (lição 17) — o legado
   usa `TRUNC(V.DTVENDA)` porque no Oracle a coluna é `DATE` sem fuso.
3. **corte-3 — relatório e bordas**: "Relatório Diferença do Balanço para Estoque" (exige `alterado`/`qtde_ist`),
   "Atualizar Custo a partir do Cadastro", "Zerar Qtde na Grade".
4. fora do escopo deste épico: "Restituição de tributação" (fiscal) e o CRUD `FRMCADBALANCO`, se o usuário
   preferir manter a foto só como subproduto do inventário.
