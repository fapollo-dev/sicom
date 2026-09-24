# Fechamento de caixa — especificação das impressões (d) Relatório de análise e (e) Fechamento de caixa

Recon **somente leitura** em 24/09/2026. Fontes: `retaguarda-master/fonte/Units` (snapshot de **mai/2020**) e
`retaguarda-master/Relatorios/*.fr3` (todos datados de 14/05/2020). A produção roda binário mais novo: **quando o fonte
e o dado vivo discordam, vale o dado vivo** — cada caso está marcado. Produção consultada apenas com SELECT
(`SET TRANSACTION READ ONLY`).

Legenda: **[P]** provado por linha de fonte / .fr3 / consulta em produção · **[I]** inferido (semântica Delphi/FastReport, não medido).

Abreviações de arquivo: `DM` = `uDmFechamentoCaixa.pas`, `DMdfm` = `uDmFechamentoCaixa.dfm`, `FC` = `uFechamentoCaixa.pas`,
`FCdfm` = `uFechamentoCaixa.dfm`, `CXA` = `Ucxaberto.pas`, `fr3` = `Relatorios/FechamentoCaixa.fr3`.

---

## (e) Relatório "Fechamento de caixa" (`MontaRel` + `FechamentoCaixa.fr3`)

### e.1 Pontos de entrada

| Entrada | Onde | Turnos | Datas |
|---|---|---|---|
| Tela principal › Imprimir (Alt+I, `ppmBotaoOutros`) › "Fechamento de caixa" (`FechamentoCaixa1`, Tag=1, RBAC `FECHAMENTOCAIXA1`) | `FC:1229-1443`; menu `FCdfm:1911-1915` | 1 (o turno da tela: `ChaveTurno`) | `edtDataIni..edtDataFim` (`FC:1363-1376`); `edtDataIniExit` força DataFim = DataIni (`FC:1170-1176`) |
| Caixas em aberto (`frmCXaberto`) › marcar "Selecionar caixas para relatório" (`ckRel`, tecla **T** marca/desmarca todos `CXA:592-600`, espaço marca um) › **Imprimir** | `CXA:157-360` | N (os marcados, `SEL`) | só `edtDataIni` (DATA1 = DATA2, `CXA:287-316`) |

`BtnImprimir` do diálogo só fica habilitado com `ckRel` marcado (`CXA` `ckRelClick`: `BtnImprimir.Enabled := ckRel.Checked`; `Ucxaberto.dfm:151-157` nasce `Enabled = False`) **[P]** — por isso o ramo "sem filtro" (ckRel desmarcado ⇒ nenhuma substituição, SQL sem filtro de turno) é inalcançável **[P]**.

### e.2 Validações e mensagens

| Mensagem | Quando | Fonte |
|---|---|---|
| (sai calado) | `cmbOpcao = 2` (OS) | `FC:1238-1239` |
| "Informe o operador." | `edtOperador = 0` (foco volta ao operador) | `FC:1241-1246` |
| "Informe o número do PDV." | `cmbOpcao = 0` (PDV) e `edtNroPDV = 0` | `FC:1248-1256` |
| "Informe o número do terminal." | `cmbOpcao = 1` (Balcão) e `edtNroPDV = 0` | idem |
| (sai calado) | diálogo: nenhum caixa marcado (`not Locate('SEL', True)`) | `CXA:165-166` |
| "O PDV %d não foi cadastrado para a empresa %d." | diálogo: algum marcado cujo `NROPDV` não existe em `PDV` com `CODEMPRESA = IDEMPRESA` da linha (`TDB.GetFirst<TPdvVO>`) | `CXA:641-676` (`ValidaPDVS`) |

Não há mensagem de "sem dados": com datasets vazios o relatório sai só com cabeçalho **[I]**.

### e.3 Variante Balcão (`cmbOpcao = 1`, CX_PEDIDOS) — quebrada no fonte e morta no dado

`FC:1303-1307` troca `cdsDoc/cdsCaixaRel` pelos SQLs de `GetSQLDocBalcao` (`DM:601-637`) e `GetSQLCaixaRelBalcao` (`DM:639-677`),
que **não devolvem** `CHAVE`, `VR_SUPRIMENTO`, `VR_SANGRIA` (cdsDoc) nem `CHAVE` (cdsCaixaRel), mas os ClientDataSets têm esses
campos persistentes (`DMdfm:1590-1638`, `1761-1798`) ⇒ o `Open` deve falhar com "Field 'CHAVE' not found" **[I]**. Além disso o
filtro de terminal não é aplicado (`/*CODPDV*/` não existe no SQL balcão; `FC:1341-1342`) **[P]**. Produção: **CX_PEDIDOS tem 1
linha em 2026** (09/03/2026) **[P]**. ⇒ **Não implementar a variante Balcão**; só PDV (`cmbOpcao = 0`, CX_VENDAS).

### e.4 Filtro de turno (texto `Chave`) — tela principal

`FC:1315-1326` **[P]**:

```
se há turnos no combo:
    ChaveTurno <> ''  ⇒ Chave = " AND (CHAVE = 'k')" + (FiltraData ? " AND (TRUNC(DATA) BETWEEN :DATA1 AND :DATA2) " : "")
    ChaveTurno = ''   ⇒ Chave = " AND (CHAVE IS NULL) AND (TRUNC(DATA) BETWEEN :DATA1 AND :DATA2) "
senão               ⇒ Chave = " AND (TRUNC(DATA) BETWEEN :DATA1 AND :DATA2) AND CHAVE IS NULL "
```

`FiltraData := ValorConfiguracao('FECHAMENTO_CAIXA_SOMENTE_CHAVE') = 'N'` (`DM:579`). Produção: `FECHAMENTO_CAIXA_SOMENTE_CHAVE = N`
⇒ **FiltraData = verdadeiro: turno = chave E dia** **[P]**. Em 2026, 51 de 3.832 chaves têm linhas em mais de um dia civil;
para essas o relatório só pega as linhas do dia escolhido (mesmo comportamento da tela, `turnoWhere` do Apollo) **[P]**.

Derivados (`FC:1328-1361`): `FiltroVenda` = Chave com `TRUNC(DATA)`→`TRUNC(DTVENDA)` + `AND V.NROPEDIDO LIKE 'pp%'` (pp = PDV com 2
dígitos) + `AND V.OPERADOR = op`; `FiltroCancelamento` = Chave + `AND V.CODPDV = pdv` + `AND V.CODOPERADORA = op`.
`CODOPERADOR_DOC` = operador da tela (`FC:1201-1219`).

### e.5 Datasets e SQL (Oracle, texto como está no .dfm) + substituições

#### sqqDoc / cdsDoc — venda por recurso (`DMdfm:1446-1583`) **[P]**

```sql
SELECT SUM(CUR.VALOR) VALOR, CUR.RECURSO, CUR.CODOPERADORA, CUR.NOME, CUR.OBS, CUR.NROPDV, CUR.CHAVE,
       (SELECT DESTINO FROM FORMAS_PGTO FP
         WHERE FP.MODALIDADE = CUR.RECURSO AND FP.IDEMPRESA = :IDEMPRESA AND ROWNUM = 1) DESTINO,
       SUM(CUR.VR_SUPRIMENTO) VR_SUPRIMENTO, SUM(CUR.VR_SANGRIA) VR_SANGRIA
FROM (
  SELECT SUM(V.VALOR - COALESCE(V.TROCO,0) - COALESCE(V.VENDA_BALCAO,0)) VALOR, upper(V.OPERACAO) RECURSO,
         V.CODOPERADORA, O.NOME, B.OBS, V.NROPDV, V.CHAVE,
         SUM((CASE WHEN V.OPERACAO = 'SANGRIA'    THEN V.VALOR ELSE 0 END)) VR_SANGRIA,
         SUM((CASE WHEN V.OPERACAO = 'SUPRIMENTO' THEN V.VALOR ELSE 0 END)) VR_SUPRIMENTO
  FROM CX_VENDAS V
  LEFT JOIN OPERADORES O ON O.CODOPERADOR = V.CODOPERADORA
  LEFT JOIN CAIXA_OBS B ON O.CODOPERADOR = B.CODOPERADOR AND TRUNC(B.DATA) = TRUNC(V.DATA) AND B.NROPDV = V.NROPDV
  WHERE IDEMPRESA = :IDEMPRESA
    AND ((OPERACAO <> 'DESCONTO') and (OPERACAO <> 'ACRESCIMO'))   -- SANGRIA/SUPRIMENTO entram; tratados no código
        /*FILTRO_NROPDV*/ /*OPERADOR*/ /*PDV*/ /*CHAVE*/
  GROUP BY V.CODOPERADORA, upper(V.OPERACAO), O.NOME, B.OBS, V.NROPDV, V.CHAVE
  UNION ALL
  SELECT RECARGA, 'RECARGA', V.CODOPERADORA, O.NOME, '' OBS, CODPDV NROPDV, CHAVE, 0, 0
  FROM CAIXA_PDV V LEFT JOIN OPERADORES O ON O.CODOPERADOR = V.CODOPERADORA
  WHERE 1 = 1 /*FILTRO_CODPDV*/ /*OPERADOR*/ /*PDV1*/ /*CHAVE*/
  UNION ALL
  SELECT CORRESPONDENTE, 'CORRESPONDENTE', ... (idem)
  UNION ALL
  SELECT VOUCHER, 'VOUCHER', ... (idem)
) CUR
GROUP BY CUR.RECURSO, CUR.CODOPERADORA, CUR.NOME, CUR.OBS, CUR.NROPDV, CUR.CHAVE
ORDER BY 3, 6
```

Notas **[P]**: os ramos CAIXA_PDV **não filtram empresa** (`WHERE 1 = 1`); o join com CAIXA_OBS também não (nem por chave).

#### sqqCaixaRel / cdsCaixaRel — o que o fechamento gravou no CAIXA + divergência (`DMdfm:1639-1754`) **[P]**

```sql
SELECT SUM(CUR.VALOR) VALOR, CUR.DIVERGENCIA, CUR.RECURSO, CUR.OPERADOR, CUR.CODPDV, CUR.CHAVE
FROM (
  SELECT SUM(C.VALOR) VALOR,
         ( SUM(C.VALOR) - ( SELECT SUM(V.VALOR - COALESCE(V.TROCO,0))          -- sem VENDA_BALCAO (≠ sqqDoc)
                              FROM /*TABELA*/ V                                   -- CX_VENDAS
                             WHERE V.CODOPERADORA = C.OPERADOR
                               and upper(V.operacao) = upper(C.tiporecurso) AND V.NROPDV = C.CODPDV
                               and ((UPPER(OPERACAO) <> 'DESCONTO') and (UPPER(OPERACAO) <> 'ACRESCIMO'))
                               and V.IDEMPRESA = :IDEMPRESA AND V.NROPDV = C.CODPDV AND V.CHAVE = C.CHAVE
                                   /*FILTRO_OPERADORA*/ /*OPERADOR*/ /*PDV*/ /*CHAVE*/
                             GROUP BY upper(V.OPERACAO) )) DIVERGENCIA,
         upper(C.TIPORECURSO) RECURSO, C.OPERADOR, CODPDV, CHAVE
  FROM CAIXA C
  left join plc p on (p.codplc = c.codplc)
  WHERE C.IDEMPRESA = :IDEMPRESA
    and p.tpconta = 0
        /*FILTRO_DATA*/ /*OPERADOR2*/ /*FILTRO_OPERADOR*/ /*PDV1*/ /*CHAVE*/
  GROUP BY C.OPERADOR, upper(C.TIPORECURSO), CODPDV, CHAVE
  UNION ALL
  SELECT 0, RECARGA * -1,        'RECARGA',        V.CODOPERADORA, CODPDV, '' CHAVE FROM CAIXA_PDV V WHERE 1 = 1 /*FILTRO_OPERADORA*/ /*OPERADOR*/ /*PDV1*/ /*CHAVE*/
  UNION ALL
  SELECT 0, CORRESPONDENTE * -1, 'CORRESPONDENTE', ... (idem)
  UNION ALL
  SELECT 0, VOUCHER * -1,        'VOUCHER',        ... (idem)
) CUR
GROUP BY CUR.DIVERGENCIA, CUR.RECURSO, CUR.OPERADOR, CUR.CODPDV, CUR.CHAVE
ORDER BY 4
```

No Oracle `''` é NULL ⇒ os ramos RECARGA/… têm CHAVE nula e **nunca casam** no `Locate` por CHAVE (e.6 passo 3); o valor
equivalente sai pela regra "venda>0 e caixa=0 ⇒ −venda" **[P]** (texto) / **[I]** (efeito).

#### QryDescontos (`DMdfm:3005-3029`) **[P]**

```sql
SELECT SUBSTR(V.NROPEDIDO, 1, 2) AS PDV, V.OPERADOR,
       SUM(COALESCE(V.DESC_ACRE_MEDIO, 0) + COALESCE(V.DESC_ACRE_ITEM, 0)) AS TOTAL_DESCONTO
FROM VENDAS V
WHERE ((COALESCE(V.DESC_ACRE_MEDIO, 0) < 0) OR (COALESCE(V.DESC_ACRE_ITEM, 0) < 0))
  AND V.IDEMPRESA = :IDEMPRESA AND V.CANCELADO <> 'S'
      /*FILTRO_ADICIONAL*/
GROUP BY SUBSTR(V.NROPEDIDO, 1, 2), V.OPERADOR
```
Soma os dois campos inteiros da linha (se um for acréscimo positivo e o outro desconto, o positivo entra) — igual ao
`descontos()` já migrado (`fechamento-caixa.service.ts:274-281`).

#### QryCancelamentos (`DMdfm:3030-3051`) **[P]**

```sql
SELECT V.CODPDV as PDV, V.CODOPERADORA AS OPERADOR, SUM(COALESCE(V.CANCELAMENTOS, 0)) TOTAL_CANCELAMENTOS
FROM CAIXA_PDV V
WHERE COALESCE(V.CANCELAMENTOS, 0) > 0 AND V.IDEMPRESA = :IDEMPRESA
      /*FILTRO_ADICIONAL*/
GROUP BY V.CODPDV, V.CODOPERADORA
```

#### sqqTesourariaRel (`DMdfm:1799-1880`) — **MORTO** (TESOURARIA = 0 linhas em produção **[P]**)

`SUM(T.VALOR), upper(T.RECURSO), T.CODOPERADORCX CODOPERADOR, DIVERGENCIA (vs CAIXA tpconta=0), DIVERGENCIA_DOC (vs CX_VENDAS), CODPDV
FROM TESOURARIA T WHERE TRUNC(T.DATA) BETWEEN :DATA1 AND :DATA2 ...`. Só aberto no modo PDV (`FC:1396-1400`) e no diálogo.
Não implementar; ver e.7 (as colunas de tesouraria nem aparecem na folha).

#### Tabela de substituições (texto literal colado no SQL)

| Marcador | Tela principal (`FC:1330-1361`) | Diálogo, por turno marcado, unidos por OR (`CXA:207-285`) |
|---|---|---|
| `/*TABELA*/` | `CX_VENDAS` | `CX_VENDAS` |
| cdsDoc `/*PDV*/` · `/*PDV1*/` | `AND V.NROPDV = pdv` · `AND CODPDV = pdv` | — |
| cdsDoc `/*OPERADOR*/` | `AND (V.CODOPERADORA = op)` | — |
| cdsDoc `/*CHAVE*/` | `Chave` com `(DATA)`→`(V.DATA)` | — |
| cdsDoc `/*FILTRO_NROPDV*/` · `/*FILTRO_CODPDV*/` | — | `FiltroDoc` = `AND ( ((V.NROPDV = n) AND (CHAVE = 'k' \| CHAVE IS NULL) AND (V.CODOPERADORA = o) [AND (TRUNC(V.DATA) BETWEEN :DATA1 AND :DATA2)]) OR (...) )` · o mesmo com `V.NROPDV`→`CODPDV`; a data entra se `FiltraData` ou chave vazia |
| cdsCaixaRel `/*PDV*/` (subquery) · `/*PDV1*/` | `AND NROPDV = pdv` · `AND CODPDV = pdv` | — |
| cdsCaixaRel `/*OPERADOR*/` · `/*OPERADOR2*/` | `AND (V.CODOPERADORA = op)` · `AND C.OPERADOR = op` | — |
| cdsCaixaRel `/*CHAVE*/` | `Chave` (colunas sem alias ⇒ V.* na subquery, C.* no CAIXA) | — |
| cdsCaixaRel `/*FILTRO_OPERADOR*/` (CAIXA) | — | `FiltroDoc` com `V.DATA`→`C.DATA`, `V.NROPDV`→`CODPDV`, `V.CODOPERADORA`→`C.OPERADOR` |
| cdsCaixaRel `/*FILTRO_OPERADORA*/` (subquery e CAIXA_PDV) | — | `FiltroDoc` com `V.NROPDV`→`CODPDV` (na subquery, `CODPDV` sem alias resolve para `C.CODPDV`: CX_VENDAS não tem CODPDV **[P]**) |
| QryDescontos `/*FILTRO_ADICIONAL*/` | `FiltroVenda` | `AND ( ((V.NROPEDIDO LIKE 'nn%') AND (V.CHAVE = 'k' \| IS NULL) AND (V.OPERADOR = o) [AND TRUNC(V.DTVENDA) BETWEEN …]) OR … )` |
| QryCancelamentos `/*FILTRO_ADICIONAL*/` | `FiltroCancelamento` | `FiltroDoc` com `NROPDV`→`CODPDV` |

Parâmetros: `IDEMPRESA` = empresa logada; `DATA1/DATA2` = DataIni/DataFim na tela (QryDescontos/QryCancelamentos recebem
DataIni nos dois, `FC:1378-1387`), DataIni/DataIni no diálogo **[P]**.

### e.6 Algoritmo `MontaRel` (`DM:760-996`) **[P]**

Entrada: `cdsOrdenacao` (grade da tela ou `cdsCXaberto`), `DataI`, `DataF`, `FiltroChaves`. Saída: `cdsRelCaixa` (linhas por
turno × recurso, `DMdfm:1944-2030`) e `cdsCxTotais` (totais por recurso, `DMdfm:2318-2370`).

1. **INDICE** (`:803-808`): lista dos `CODOPERADORA` de `cdsOrdenacao` na ordem; `INDICE = posição do operador` (`:858`).
   **Não é usado** em nenhuma ordenação nem no .fr3 (índices `FC:1435`, `CXA:351`; 0 ocorrências de INDICE no fr3) **[P]** — não migrar.
2. **Linhas de venda** — percorre `cdsDoc` por `CODOPERADORA;NROPDV;RECURSO` (`:810`; CHAVE fora do índice):
   - `RECURSO = 'SANGRIA'` ou `'SUPRIMENTO'` (`:814-821`): **não gera linha**; soma `VR_SANGRIA`/`VR_SUPRIMENTO` na linha
     corrente de `cdsRelCaixa` (a última gravada). Efeito: vai para o mesmo grupo operador+PDV (os totais saem por soma no
     rodapé). Defeito latente: se SANGRIA/SUPRIMENTO fosse o 1º recurso de um grupo, iria para o grupo anterior — **medido: 0 de
     3.865 grupos de 2026** (o PDV grava linhas zeradas de BOLETO/CARTOES/… antes) **[P]**.
   - demais (`:822-867`): `Append` com `CODOPERADORA, NOME, RECURSO_VENDA = RECURSO, VALOR_VENDA = VALOR, CHAVE, NROPDV`,
     `OPERADORA_NROPDV = StrToInt(op ‖ pdv)` (chave do grupo no .fr3), `OPERADORA_NROPDV_CHAVE = op‖pdv‖chave` (sem uso no fr3),
     `RECURSO_CAIXA = RECURSO` (sempre igual ao da venda), `VALOR_CAIXA = 0`, `DIV_VENDA_CAIXA = 0`, `RECURSO_TES = RECURSO`,
     `VALOR_TES/DIV_TES_* = 0`, `ORDEM = 1`.
     - `CX_OBS`: a 1ª OBS não vazia do grupo operador+PDV, repetida nas linhas seguintes do grupo (`:828-836`, `:855`).
     - `TOTAL_DESCONTO` = `QryDescontos.Locate('PDV;OPERADOR', [ZeroEsquerda(NROPDV,2), op])` (`:861-862`); `TOTAL_CANCELAMENTOS`
       = `QryCancelamentos.Locate('PDV;OPERADOR', [NROPDV, op])` (`:864-865`); sem achado = 0 (`OnNewRecord`, `DM:560-564`).
       Mesmo valor em todas as linhas do grupo.
   - **DEVOLUÇÃO EM DINHEIRO** (`:869-911`): se `DESTINO` da forma = `'DEV'` e ainda não há a linha no grupo, acrescenta
     `RECURSO_VENDA = 'DEVOLUÇÃO EM DINHEIRO'`, `VALOR_VENDA = −GetDevolucao(...)` (HIST_DEVOLUCAO `CONCILIADO='S'` e
     `TIPO_DEVOLUCAO='D'`, `:762-775`), `RECURSO_CAIXA = ''`, `ORDEM = 2`, sem CHAVE. **MORTO duas vezes**: nenhuma
     `FORMAS_PGTO.DESTINO = 'DEV'` (DEVOLUCAO é `RCB` nas 4 empresas) e **HIST_DEVOLUCAO = 0 linhas** **[P]**. Não migrar.
3. **Casamento com o CAIXA** (`:916-929`): para cada linha de `cdsCaixaRel`, `Locate('RECURSO_VENDA;CODOPERADORA;NROPDV;CHAVE',
   [RECURSO, OPERADOR, CODPDV, CHAVE])`; achou ⇒ `VALOR_CAIXA = VALOR`, `DIV_VENDA_CAIXA = DIVERGENCIA`. **Não achou ⇒ descarta**
   (não cria linha). Produção 2026: **QUEBRA DE CAIXA** no CAIXA (tpconta 0) nunca tem CX_VENDAS correspondente ⇒ **176 lançamentos,
   R$ 14.231,14, ficam fora do relatório** (e da divergência) — defeito vivo **[P]**. Todos os demais recursos do CAIXA de 2026
   (DINHEIRO, CARTOES, CONVENIO, POS, PIX, DEVOLUCAO, PIX POS) casam **[P]**.
4. **Regra da venda sem caixa** (`:931-940`): `VALOR_VENDA > 0 e VALOR_CAIXA = 0 e DIV_VENDA_CAIXA = 0 ⇒ DIV_VENDA_CAIXA = −VALOR_VENDA`.
5. **Tesouraria** (`:943-956`): só se `cdsTesourariaRel.Active`; `Locate` sem testar o resultado (edita a linha corrente se não
   achar) e compara `CODPDV` da TESOURARIA (= `PDV.CODPDV`, ≠ NROPDV em produção: ex. NROPDV 64 → CODPDV 402) com NROPDV. Morto (0 linhas).
6. **Totais por recurso** (`:958-994`): `cdsCxTotais` chaveado só por `RECURSO_VENDA` (todos os turnos/grupos juntos):
   soma `VALOR_VENDA, VALOR_CAIXA, DIV_VENDA_CAIXA, VALOR_SUPRIMENTO, VALOR_SANGRIA`; `CODOPERADORA = 1` (constante);
   `ORDEM = 1` (2 só p/ DEVOLUÇÃO EM DINHEIRO); campos TES só copiados da 1ª linha (não somados — irrelevante, morto).
7. **Ordem de impressão**: `cdsRelCaixa` por `NROPDV;CODOPERADORA;ORDEM;RECURSO_VENDA` (tela, `FC:1435`) ou
   `NROPDV;CODOPERADORA;CHAVE;ORDEM;RECURSO_VENDA` (diálogo, `CXA:351`); `cdsCxTotais` por `ORDEM;RECURSO_VENDA`. `NROPDV` é
   string(3) ⇒ ordem textual (coincide com a numérica para os PDVs existentes, 2..91) **[P]**.

### e.7 Layout `FechamentoCaixa.fr3` (A4 retrato, 210 mm, margem 10) **[P]**

Carregado de `Relatorios\FechamentoCaixa.fr3` (`FC:1412`, `CXA:326`); variável `DATA` = DataIni `dd/mm/yyyy`. Datasets:
`frxDBDatasetDoc` = `cdsRelCaixa`, `frxDBDatasetTotais` = `cdsCxTotais`, `frxDBDataset2` = empresa (`FCdfm:2933-3042`).

**Página 1**
- *PageHeader*: logo (`images\logorel.jpg`), "Fechamento de Caixa", data de emissão, Razão social, Fantasia, "CNPJ:", "INSC:",
  "Fone:", "Caixa(s) do dia: [DATA]". O script esconde o cabeçalho depois do 1º grupo e só o reexibe após o último
  (`GroupFooter4OnAfterPrint`) ⇒ na prática sai na 1ª página **[I]**.
- *GroupHeader4* — condição `OPERADORA_NROPDV` (operador‖PDV, **sem chave**: no diálogo, 2 turnos do mesmo operador no mesmo PDV
  ficam num grupo só), KeepTogether: "Operador(a): [CODOPERADORA] - [NOME] - PDV: [NROPDV]"; blocos "Vendas" (Recursos | Valor)
  e "Caixa" (Recursos | Valor | Div. p/ vendas).
- *MasterData2* (uma linha por `cdsRelCaixa`): `RECURSO_VENDA` | `VALOR_VENDA` | `RECURSO_CAIXA` | `VALOR_CAIXA` | `DIV_VENDA_CAIXA`
  (formato `%2.2n`). As 3 colunas de caixa ficam invisíveis quando `RECURSO_CAIXA = ''` (só a linha de devolução, morta).
  Linhas com valor 0 **são impressas** (ex.: BOLETO 0,00, RECARGA 0,00).
- *GroupFooter4*: Σ`VALOR_VENDA` (sob Vendas) e Σ`VALOR_CAIXA` (sob Caixa); "Suprimento:" Σ`VALOR_SUPRIMENTO`; "Sangria:"
  **−**Σ`VALOR_SANGRIA`; "Divergência Vendas p/ Caixa" = **Σ(`VALOR_CAIXA` − `VALOR_VENDA`)** (não a soma da coluna DIV);
  "Desconto:" `TOTAL_DESCONTO`; "Cancelamentos:" `TOTAL_CANCELAMENTOS`; "Obs. de divergência" + `CX_OBS`.
- *ReportSummary1* (nova página, visível se > 1 grupo): Σ`VALOR_TES`, "Divergencia Caixa p/ Tesouraria" Σ`DIV_TES_CAIXA`,
  Σ`DIV_TES_VENDA` — todos em `Left ≥ 799` numa banda de 718 ⇒ **fora da folha**; resultado: página em branco quando há mais
  de um grupo **[P]** (posições) / **[I]** (efeito). Não migrar.

**Página 2 — "Totais"** (`cdsCxTotais`, um grupo só): Recursos | Valor (vendas) | Recursos | Valor (caixa) | Div. p/ vendas;
rodapé Σvenda, Σcaixa, "Suprimento:"/"Sangria:" (fórmulas apontam para `MasterData2` da página 1 — valor impresso **não
comprovado** [I]; o equivalente correto é a soma de todos os grupos, que `cdsCxTotais` já tem), "Divergência Vendas p/ Caixa"
Σ(caixa − venda), "Desconto:" / "Cancelamentos:" = soma dos valores de cada grupo (variáveis `TotalDesconto`/`TotalCancelamento`
acumuladas em `GroupFooter4OnBeforePrint`).

**Defeito de rótulo (tela principal)**: `FC:1423-1425` troca o texto de `Memo37` por "Divergência Vendas p/ Tesouraria", mas no
.fr3 de 2020 `Memo37` é o rótulo **"Sangria:"** ⇒ pela tela principal o valor da sangria sai rotulado "Divergência Vendas p/
Tesouraria"; pelo diálogo sai "Sangria:" (`CXA` não mexe no Memo37) **[P]** (fonte+fr3 de 2020; o .fr3 de produção pode ser
outro). Recomendo o rótulo "Sangria:".

### e.8 Vivo ou morto (produção, 24/09/2026) **[P]**

| Peça | Medida | Veredito |
|---|---|---|
| CX_VENDAS por recurso | set/2026: ~42 mil linhas, 0 sem chave, `VENDA_BALCAO ≠ 0` em 0 linhas no ano | **vivo** |
| SANGRIA em CX_VENDAS | set/2026: 254 (emp 1) + 358 (emp 2) | **vivo** |
| SUPRIMENTO em CX_VENDAS | 2026: 1.170 (emp 1) + 2 (emp 2); nenhum em set/2026 | **vivo** |
| CAIXA `plc.tpconta = 0` | set/2026: 938 lançamentos com PDV, **todos** tpconta 0 | **vivo** (filtro inócuo hoje, manter) |
| CAIXA_PDV.CANCELAMENTOS | 2026: 3.380 de 3.914 turnos > 0, R$ 2.416.811,47 | **vivo** |
| VENDAS com desconto (`DESC_ACRE_* < 0`) | existe em 20/09/2026 | **vivo** |
| CAIXA_PDV RECARGA/CORRESPONDENTE/VOUCHER | 2026: 0 turnos ≠ 0 | morto — mas gera 3 linhas "0,00" por turno |
| CAIXA_OBS (coluna Obs.) | 18 linhas em 2020, 3 em 2025, 0 em 2026 | quase morto |
| TESOURARIA | 0 linhas | **morto** |
| HIST_DEVOLUCAO / destino `DEV` | 0 linhas / nenhuma forma `DEV` | **morto** |
| CX_PEDIDOS (variante Balcão) | 1 linha em 2026 | **morto** (e quebrado no fonte) |

### e.9 Exemplo-ouro (produção) — turno fechado 64220926141131, PDV 64, operador 2503, 22/09/2026, empresa 1 **[P]**

cdsDoc (recurso: venda): BOLETO 0 · CARTOES 5.383,03 · CHEQUE 0 · CONVENIO 107,61 · DEVOLUCAO 0 · DINHEIRO 1.764,26 · IFOOD 0 ·
PIX 483,06 · PIX POS 0 · POS 0 · SANGRIA (VR_SANGRIA 1.753,70) · TICKETS 0 (+ RECARGA/CORRESPONDENTE/VOUCHER do CAIXA_PDV).
cdsCaixaRel (recurso: caixa / divergência): PIX 483,06 / 0 · CARTOES 5.383,03 / 0 · CONVENIO 107,61 / 0 · DEVOLUCAO 10,99 / 10,99 ·
DINHEIRO 1.753,70 / −10,56. QryDescontos: nenhuma linha (0). QryCancelamentos: 314,86.
Rodapé esperado: Σvenda 7.737,96 · Σcaixa 7.738,39 · Divergência 0,43 · Sangria −1.753,70 · Suprimento 0 · Desconto 0 ·
Cancelamentos 314,86.

### e.10 Como implementar no Apollo (Postgres)

API `GET /cobranca/fechamento-caixa/relatorio?data=AAAA-MM-DD&turnos=[{nropdv,codoperadora,chave|null}]` (1 turno = tela; N =
Caixas em aberto; validar cada NROPDV em `pdv` da empresa com a mensagem literal de e.2). Reusar `contexto/noDia/daChave`
(`fechamento-caixa.service.ts:96-128`). JSON: `grupos[] {codoperadora, nome, nropdv, obs, linhas[{recurso, venda, recursoCaixa,
caixa, div}], sangria, suprimento, desconto, cancelamentos}`, `totais[{recurso, venda, caixa, div}]`, `totalDesconto`,
`totalCancelamentos`, `sangria`, `suprimento`.

```sql
-- venda por recurso (turnos passados como unnest de arrays; empresa :emp; dia no fuso da loja)
SELECT cx.codoperadora, o.nome, cx.nropdv, cx.chave, upper(cx.operacao) AS recurso,
       sum(cx.valor - coalesce(cx.troco,0) - coalesce(cx.venda_balcao,0))          AS venda,
       sum(cx.valor - coalesce(cx.troco,0))                                        AS venda_div,  -- base da divergência (sem venda_balcao, como o legado)
       sum(CASE WHEN cx.operacao = 'SANGRIA'    THEN cx.valor ELSE 0 END)          AS sangria,
       sum(CASE WHEN cx.operacao = 'SUPRIMENTO' THEN cx.valor ELSE 0 END)          AS suprimento
  FROM cx_vendas cx LEFT JOIN operadores o ON o.codoperador = cx.codoperadora
 WHERE cx.idempresa = :emp AND cx.operacao <> 'DESCONTO' AND cx.operacao <> 'ACRESCIMO'
   AND <turno: cx.nropdv, cx.codoperadora, daChave(cx.chave), noDia(cx.data)>
 GROUP BY 1,2,3,4,5
UNION ALL   -- as 3 linhas do CAIXA_PDV (paridade: saem 0,00); legado não filtra empresa aqui
SELECT cp.codoperadora, o.nome, cp.codpdv, cp.chave, r.recurso, sum(r.valor), sum(r.valor), 0, 0
  FROM caixa_pdv cp LEFT JOIN operadores o ON o.codoperador = cp.codoperadora
 CROSS JOIN LATERAL (VALUES ('RECARGA', cp.recarga), ('CORRESPONDENTE', cp.correspondente), ('VOUCHER', cp.voucher)) r(recurso, valor)
 WHERE <turno: cp.codpdv, cp.codoperadora, daChave(cp.chave), noDia(cp.data)>
 GROUP BY 1,2,3,4,5;

-- caixa por recurso
SELECT c.operador, c.codpdv, c.chave, upper(c.tiporecurso) AS recurso, sum(c.valor) AS caixa
  FROM caixa c JOIN plc p ON p.codplc = c.codplc AND p.tpconta = 0
 WHERE c.idempresa = :emp AND <turno: c.codpdv, c.operador, daChave(c.chave), noDia(c.data)>
 GROUP BY 1,2,3,4;
```

Montagem em TS (espelho de e.6): SANGRIA/SUPRIMENTO viram totais do grupo (sem linha); casar caixa por
recurso+operador+PDV+chave; `div = casou ? caixa − venda_div : (venda > 0 ? −venda : 0)`; recurso só no caixa ⇒ **descartado,
como o legado** (QUEBRA DE CAIXA; ver pendência); obs = `caixa_obs` do operador+PDV+dia (1ª não vazia); desconto/cancelamentos
= as consultas QryDescontos/QryCancelamentos com o filtro do turno (já existe `descontos()`; cancelamentos: `caixa_pdv`
`sum(cancelamentos)` com `cancelamentos > 0`); grupo = operador+PDV; ordenar grupos por NROPDV, operador; linhas por recurso
(ordem alfabética, sem ORDEM 2 porque a devolução é morta). Totais = soma por recurso de todos os grupos, ordenados por recurso.
Web: HTML próprio (não o `imprimirPagina` genérico, porque o layout é por grupo) com cabeçalho da empresa + "Caixa(s) do dia",
um bloco por grupo (tabela Vendas | Caixa | Div. + rodapé Suprimento, Sangria (−), Divergência Vendas p/ Caixa = Σ(caixa − venda),
Desconto, Cancelamentos, Obs. de divergência), `page-break-before` e a página "Totais"; `window.print` (janela aberta no clique).
Sem tesouraria, sem devolução em dinheiro, sem variante Balcão.

**Pendências para decisão do usuário** (regra viva não se desliga em silêncio): (1) reproduzir a omissão da QUEBRA DE CAIXA
(R$ 14,2 mil em 2026) ou mostrá-la como linha só-caixa; (2) rótulo "Sangria:" vs o texto trocado da tela principal;
(3) manter as 3 linhas zeradas RECARGA/CORRESPONDENTE/VOUCHER.

---

## (d) "Relatório de análise" (Totalizado / Descritivo)

### d.1 Entrada e fluxo (`FC:2024-2072`) **[P]**

Imprimir › "Relatório de análise" (`Relatriodeanalise1`, `FCdfm:1907-1910`, sem RBAC próprio). Rádio `rbtTotalizado` (padrão,
`Checked = True`, `FCdfm:819-830`) / `rbtDescritivo` (`FCdfm:831-841`). Fluxo: chama `ProcessaSQL` (o mesmo que carrega a grade);
depois, conforme `cmbOpcao`:

| cmbOpcao | Dataset | Ordenação | .fr3 |
|---|---|---|---|
| 0 PDV | `cdsCX_Vendas` (`frxDBDatasetDados`, `FCdfm:1036-1062`) | `IndexFieldNames = 'OPERACAO;DATA;CODOPERADORA;NROPDV'` (solicitação 2933, `FC:2033`) | `fec_Fechamento_Caixa_Descritivo_Vendas.fr3` / `..._Totalizado_Vendas.fr3` (`FC:2042-2045`) |
| 1 Balcão | `cdsCX_PEDIDOS` (`frxDBDatasetPedidos`, `FCdfm:1827-1843`) | a do SQL: `CAST(CX.DATA), CX.CODOPERADORA, CX.OPERACAO` | `..._Descritivo_Pedidos.fr3` / `..._Totalizado_Pedidos.fr3` (`FC:2056-2059`) |
| 2 OS | — (nenhum ramo) | — | imprime o `frxReportDados` como estiver carregado **[I]** |

Mensagem "Não foi possivel encontrar Vendas com os Filtros informados, Verifique" (tmAlerta) quando o dataset está vazio
(`FC:2036-2040`, `2050-2054`; a mesma frase no Balcão). As validações de `ProcessaSQL` ("Informe o operador!", "Informe o PDV!",
"Informe o turno!" se há turnos e nenhum escolhido, `FC:1789-1812`) dão `Exit` só do ProcessaSQL; o relatório segue com o dataset
anterior **[P]** (fluxo) / efeito **[I]**. No Apollo: validar e parar.

Variante Pedidos: morta (CX_PEDIDOS 1 linha em 2026 **[P]**) — não implementar.

### d.2 SQL (`ProcessaSQL`, `FC:1785-1990`) **[P]**

Base `sqqCX_Vendas` (`DMdfm:2568-2596`):
```sql
select CX.CODCXVENDAS, DATA, CX.NROPDV, CX.CODOPERADORA, CX.NROPEDIDO, UPPER(CX.OPERACAO) OPERACAO, CX.DEBITO_CREDITO,
       CX.VALOR VALORB, (CX.VALOR - COALESCE(CX.TROCO,0)) VALOR, CX.STATUS, CX.CODGRUPO, CX.SANGRIAS, CX.SUPRIMENTOS,
       CX.TESOURARIA, CX.IDEMPRESA, O.NOME, CX.CODGRUPO, TRUNC(DATA) DATA_MOV, CX.TROCO, CX.COO, CX.CHAVE,
       coalesce(CX.VENDA_BALCAO, 0) VENDA_BALCAO
from CX_VENDAS CX
left join OPERADORES O on (O.CODOPERADOR = CX.CODOPERADORA)
```
+ WHERE montado (modo PDV):
- data, **só se** não há turno com chave **ou** `FiltraData` (produção: sempre): `DATA between 'DataIni HoraIni' and 'DataIni HoraFinal'`
  — usa **DataIni nas duas pontas** (`FC:1831-1832`); horas padrão `00:00` / `23:59` (`FCdfm:862-883`) ⇒ exclui 23:59:01–23:59:59
  (medido 2026: nenhuma chave com venda nesse minuto);
- turno: `CX.CHAVE IS NULL` (há turnos e nenhum escolhido) ou `CX.CHAVE = 'k'` (`FC:1845-1852`);
- `CX.CODOPERADORA = op` (`FC:1877-1878`); `OPERACAO = '<modalidade>'` se o combo de operação ≠ "0 - TODAS" (`FC:1880-1885`);
  `CX.NROPDV = pdv` (`FC:1889-1891`);
- fixo (`FC:1914-1915`): `and ((OPERACAO <> 'DESCONTO') and (OPERACAO <> 'ACRESCIMO') and (OPERACAO <> 'SANGRIA') and (OPERACAO <> 'SUPRIMENTO')) AND IDEMPRESA = :emp`;
- status (`cbbStatus`, `FC:1917-1921`): 1 ABERTO `STATUS IS NULL AND TESOURARIA IS NULL`; 2 FECHADO CAIXA `STATUS = 'F' AND TESOURARIA IS NULL`;
  3 FECHADO TESOURARIA `TESOURARIA = 'S'`; vazio = sem filtro;
- `order by DATA, OPERACAO, CODOPERADORA, NROPDV` (reordenado no cliente, d.1).

É exatamente a grade da tela: o Apollo já tem `grade()` (`fechamento-caixa.service.ts:188-197`: `turnoWhere` + `status`, mesmas colunas).

### d.3 Layouts **[P]**

**Totalizado Vendas** (A4, sem script): PageHeader "RELATÓRIO DE FECHAMENTO DE CAIXA", data/hora, Razão, Fantasia, CNPJ, INSC,
Endereço, Fone; PageFooter "APOLLO - Automação Comercial Ltda." / "Fone : (64) 3613 1577" / "Página x de y". Grupos aninhados:
`DATA_MOV` ("Fechamento do dia : dd/mm/yyyy") › `CODOPERADORA` ("Operador : NOME") › `NROPDV` ("Nº do PDV : 000" + títulos
"Operação" / "Total") › `OPERACAO`. **MasterData vazio** (sem campos): uma linha por operação no rodapé do grupo OPERACAO =
`OPERACAO` + Σ`VALOR` (`%2.2m`, moeda). Rodapés: "Total do operador no PDV :" / "Total do operador:" / "Total do dia:" / "Total Geral:"
cada um com Σ`VALOR` + "Suprimentos:" Σ`SUPRIMENTOS` + "Sangrias:" Σ`SANGRIAS`. Os dados vêm ordenados por OPERACAO primeiro;
como data, operador e PDV são fixos pelos filtros (um dia, um operador, um PDV), os grupos de fora não se quebram **[P]**.
`SANGRIAS`/`SUPRIMENTOS` de CX_VENDAS: **nulos em 100% das linhas de set/2026** e o filtro exclui as linhas SANGRIA/SUPRIMENTO
⇒ Suprimentos/Sangrias saem **sempre 0,00** **[P]**.

**Descritivo Vendas**: PageHeader "FECHAMENTO DE CAIXA" + data (`DD/MMM/YYYY`) e hora; grupos `CODOPERADORA` ("Operador: cod - nome")
› `NROPDV` ("Caixa: n") › `OPERACAO` (nome da operação); detalhe = **`VALOR` e `DATA` (dd/mm/yyyy)** de cada lançamento (sem pedido,
sem hora); rodapé de operação só uma linha divisória (**sem subtotal**); ReportSummary "Total: Σ`VALOR`" (`%2.2n`). Há um memo
"Total:" solto fora de banda (`Memo1`, top 294) — resíduo de design; no FastReport objeto fora de banda sai em toda página **[I]**; não migrar.

**Pedidos** (mortos, só registro): Totalizado agrupa por `DATA` com hora (quebra a cada lançamento) › operador › operação, sem PDV
e sem sangria/suprimento; Descritivo agrupa operador › operação com subtotal `%2.2f`.

### d.4 Como implementar no Apollo

Sem endpoint novo: a web já tem a grade do turno (`grade()`); o relatório é HTML gerado no cliente a partir dela, respeitando os
filtros da tela (operação, status). Ordenar por `operacao, data, codoperadora, nropdv`.
- **Totalizado**: cabeçalho da empresa; "Fechamento do dia : dd/mm/aaaa"; "Operador : NOME"; "Nº do PDV : 000"; tabela Operação | Total
  (Σvalor por operação, R$); rodapés Total do operador no PDV / do operador / do dia / Geral (todos iguais com um turno) com
  Suprimentos e Sangrias = Σ`suprimentos`/`sangrias` da grade (dão 0,00 — manter por paridade ou omitir, decisão do usuário).
- **Descritivo**: "Operador: cod - nome", "Caixa: n", por operação a lista Valor | Data (dd/mm/aaaa); "Total:" geral.
- Vazio ⇒ mensagem literal "Não foi possivel encontrar Vendas com os Filtros informados, Verifique". `window.print`.

---

## Resumo

1. (e) usa 4 datasets vivos: venda por recurso (CX_VENDAS), CAIXA com `plc.tpconta = 0` + divergência, descontos de VENDAS e
   cancelamentos de CAIXA_PDV (R$ 2,4 mi em 2026). Tesouraria, HIST_DEVOLUCAO/"DEVOLUÇÃO EM DINHEIRO" (nenhuma forma `DEV`),
   CAIXA_PDV recarga/correspondente/voucher e a variante Balcão estão mortos.
2. Defeito vivo: recurso que só existe no CAIXA não casa e some — **QUEBRA DE CAIXA, 176 lançamentos / R$ 14.231,14 em 2026 fora do relatório**.
3. Defeitos de layout: rótulo "Sangria:" trocado por "Divergência Vendas p/ Tesouraria" na tela principal; bloco de tesouraria fora
   da folha (página em branco com > 1 grupo); a divergência do rodapé é Σ(caixa − venda), não a soma da coluna.
4. (d) é a grade da tela reordenada por operação; Totalizado = Σ por operação, Descritivo = valor+data por lançamento;
   Suprimentos/Sangrias sempre 0 (colunas nulas); o intervalo usa DataIni nas duas pontas e horas 00:00–23:59.
5. O .fr3 é de mai/2020 e a produção roda binário mais novo: o layout do .fr3 atual de produção não foi visto.
