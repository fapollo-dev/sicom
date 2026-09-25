# FRMAPURACAOPISCOFINS — Apuração PIS/COFINS (recon)

`UapuracaoPISCOFINS.pas/.dfm` (1.160 linhas) + `UdmapuracaoPISCOFINS.pas/.dfm` + `UAjustaApuracaoPC.pas/.dfm`.
Quem consome: `UspedPisCofins.pas` + `UdmSpedPisCofins.dfm` (EFD-Contribuições, bloco M).
Tabelas: `APURACAO_PC` (18 linhas), `APURACAO_PC_DET` (193), `APURACAO_PC_AJUSTE_M` (0, nova), `PC_CONFIG` (18),
`PC_BASECREDITO` (18), `PC_TIPOCREDITO` (25), `PISCOFINS` (12).
Recon somente leitura em 25/09/2026: fonte de mai/2020 e Oracle de **produção** (`SET TRANSACTION READ ONLY`).

> ⚠️ **O fonte é mais velho que o binário.** O fonte de 2020 não conhece `IDEMPRESA`, `BASECALCULOAPURA`,
> `VALORPISAPURA`, `VALORCOFINSAPURA`, nem `APURACAO_PC_AJUSTE_M`. Onde fonte e dado discordam, **o dado decide**.
> As regras marcadas "dado" foram reproduzidas por SELECT; as marcadas "fonte" vêm só do Delphi.

---

## 1. Resumo das regras confirmadas

| # | Regra | Prova |
|---|---|---|
| R1 | Uma apuração = um cabeçalho por **período livre** (DATAINI/DATAFIM digitados). Não é mês. | 10 das 18 apurações não são um mês cheio (ex.: 61 = set–out/2022; 341 = 01/02–31/03/2026; 321 = 09/03–09/04/2026). |
| R2 | Mesmo período (igual, não sobreposto) → a tela **não refaz**: pergunta "já realizada, deseja carregar?" e só carrega. Para refazer, exclui antes. Sobreposição é permitida. | fonte `UapuracaoPISCOFINS.pas:676-689`; dado: 61 (01/09–31/10/2022) convive com 101 (out) e 102 (set). |
| R3 | Escopo = **raiz do CNPJ** da empresa logada: `SubStr(E.CNPJ,1,10)` sobre o CNPJ **formatado** = `'37.954.975'` = empresas 1 e 2 juntas. | fonte `UapuracaoPISCOFINS.pas:714`, `UdmapuracaoPISCOFINS.dfm:1528,1580,1728,1793`. |
| R4 | O ramo NFC-e **não filtra empresa** nenhuma. | fonte `UdmapuracaoPISCOFINS.dfm:1825-1886` (sem `RAIZCNPJ`). A empresa 51 (outro CNPJ) teve 18.327 NFC-e de 04/2023 a 02/2025; em set/2024 somam 568,89 de base — inconclusivo se entraram. |
| R5 | `IDEMPRESA` é **NULL nas 18**. A coluna nasceu com a config `SELECIONAR_EMPRESA_APURACAO_GERACAO_SPED_CONTRIB` (valor `N`). | `AUDIT_CONFIGURACOES`: config inserida em 25/11/2025 09:40; `APURACAO_PC.LAST_DDL_TIME` = 25/11/2025 16:47. Com `N`, a tela não pede empresa → não grava. |
| R6 | Crédito = itens de **NF de entrada** agrupados por (tipo de crédito, base de crédito, situação PIS/COFINS, alíquotas de entrada). | fonte `UdmapuracaoPISCOFINS.dfm:1491-1541`; dado: reproduzido (§4). |
| R7 | **A base do crédito tira o ICMS** do item: `CASE CFOP.PROC_CUPOM WHEN 'S' THEN 0 ELSE (VRICM se ALIQUOTA começa com 'T') END`. | dado: jul/2025 `101/2/13` 44.059,31 − 3.404,49 = **40.654,82** (gravado 40.654,82); `101/1/13` 362.783,92 − 9.198,23 = **353.585,69** (gravado 353.585,69). O CFOP 1403 (PROC_CUPOM='S') não abate: é o que fecha ao centavo. |
| R8 | Débito NFC-e = VENDAS ⋈ NFC, `VL_OPR` do item **menos o ICMS_VALOR dos itens 'T'**, agrupado por situação PIS/COFINS. | dado: jul/2025 `13` 638.019,82 − 30.279,45 = **607.740,37** (gravado 607.740,37); `11` = 3.103,13 ✓; `1` = 148,17 ✓. jul/2022 também exato nas 3 linhas. |
| R9 | O abatimento de ICMS (R7/R8) acontece **com `ABATER_ICMS_BASE_CALCULO_PIS_COFINS = N`**. | config = `N`; `AUDIT_CONFIGURACOES`/`AUDIT_CONFIG_ESPECIFICAS` sem nenhum evento dela desde 08/2020. O fonte só abate com `S` → o binário mudou. |
| R10 | `VALORPIS = round(BASECALCULO × ALIQPIS / 100, 2)`; idem COFINS. | fonte `:750-752`; dado: **175 das 193** linhas. As 18 que falham são **a última linha de cada apuração** (§3.3). |
| R11 | `ALIQPIS/ALIQCOFINS` do crédito = `PISCOFINS.ALIQ_*_ENT` (presumido: 0,198/0,912 e 0,66/3,04). Do débito = `ALIQ_*_SAI` (1,65/7,6). | dado: 5 pares distintos de alíquota nas 193. |
| R12 | `*_APURA` = versão "cheia": base **líquida de ICMS** e alíquota **básica 1,65/7,6 mesmo no crédito presumido**. | dado, §3.2. |
| R13 | Sem apuração com **DATAINI e DATAFIM exatos**, o SPED para: "Não existe apuração para o periodo informado!" + `Abort`. | fonte `UdmSpedPisCofins.dfm:6204-6206`, `UspedPisCofins.pas:2427-2432`. |
| R14 | O SPED de 2020 lê `BASECALCULO`, `ALIQ*`, `VALORPIS/COFINS` gravados (não recalcula). | fonte `UspedPisCofins.pas:2360-2418`. As colunas `*_APURA` não existem no fonte. |

---

## 2. A tela (fluxo)

Três abas (`UapuracaoPISCOFINS.dfm`):

| Aba | O que tem |
|---|---|
| **Apurações Realizadas** | grade CODAPURACAO_PC · DATAINI · DATAFIM (`SELECT * FROM APURACAO_PC ORDER BY DATAINI` — todas, sem empresa). **[DEL]** exclui (pede confirmação; apaga detalhe + cabeçalho, `:854-875`). **Duplo clique** reabre (`:843-852`). Grade só leitura. |
| **Apuração** | Período De/Até (`edtDataFinal` nasce = hoje + 1 mês). Sub-abas **Créditos**, **Débitos** (pai/filho) e **Resumo PIS COFINS**. |
| **Configuração Apuração** | CRUD de `PC_CONFIG` (base de crédito + CFOP), F3 em `GET_BASECREDITO`. Gravar = Post; Excluir = apaga o registro corrente (`:227-235, 660-666`). ⚠️ Entrar no campo código já faz `Append` (`:782-786`). |

Botões: **&Apurar** (`btnVendas`) e **&Imprimir**.

### 2.1 Apurar (`btnVendasClick`, `:668-762`)

1. Valida as datas.
2. Se já existe apuração com o mesmo DATAINI;DATAFIM (Locate por texto) → pergunta se carrega. Sim: carrega. Não: sai sem fazer nada.
3. Recria a tabela `VENDASAUXSPED` = cópia de VENDAS do período (DDL, `CriaTabelaEstruturaOutra`) e troca `VENDAS` por ela no SQL.
4. Abre `sqqCreditos` (D1, D2, raiz CNPJ). É um UNION ALL de ramos (§2.2).
5. `CalculaApuracao` monta `cdsDadosApuracao` — **código morto**: não é usado para gravar (`:1093-1156`).
6. Grava o cabeçalho (`GetID('CODAPURACAO_PC')`, sequence `ID_CODAPURACAO_PC`) e **uma linha de detalhe por linha do SQL** (`:728-758`), com VALORPIS/COFINS arredondados na hora. Um `ApplyUpdates` só no fim.

### 2.2 Ramos do SQL (`UdmapuracaoPISCOFINS.dfm:1422-1931`) × o que existe no dado

| APURACAO / TIPO | Fonte (fonte 2020) | Linhas no dado |
|---|---|---:|
| CREDITO / ENTRADA | NF_PROD de NF `TIPO='E'` | **118** |
| DEBITO / DEVOLUCAO FORN | NF `TIPO='S'` com NF.CFOP 5202/6202/5411/6411 | 0 |
| DEBITO / SAIDA ECF | VENDAS sem NFC-e (`NROPEDIDO NOT IN VENDAS_NFC`) | 0 |
| DEBITO / SAIDA NF | NF `TIPO='S'` fora de 5202/6202/5411/6411/5929/6929/5927 | **27** |
| DEBITO / NFC-e | VENDAS ⋈ NFC | **48** |

Ordem: `ORDER BY 1,2,3,4,5,6` (APURACAO, TIPO, ID_TIPOCREDITO, ID_BASECREDITO, DESCRICAOBASE, IDPISCOFINS).
A última linha gravada é sempre DEBITO / NFC-e / 106.

**Crédito (ENTRADA)** — filtros (fonte, confirmados pela reprodução):
`NF.TIPO='E'` · `TRUNC(DTCONTABIL)` no período · raiz CNPJ · `NRONF <> '0'` e não nulo · `NP.CFOP IN PC_CONFIG` ·
`CANCELADA='N'` · `PROC='S'` · `P.IDPISCOFINS > 0` · `ALIQ_PIS_ENT > 0` · parceiro **não** `F`/`R` ·
`CST_PIS_ENT IN (50..56, 60)` · `CFOP NOT IN (1407,1556,1653,1908,1910,2556,2910,1949)`.
Situação = `COALESCE(NP.IDPISCOFINS, P.IDPISCOFINS)`.
Base do item = `CAST((VRCUSTO×QTD − VRDESCPROD) + DEPSACESS + SEGURO%×(…)/100 + FRETE%×(…)/100 AS NUMERIC(15,2))`,
somada e **menos o ICMS fiscal** (R7).

> A lista de exclusão virou config no binário novo: `FILTRAR_CFOP_CALCULO_PIS_COFINS_BASE_ENT` = a mesma lista
> (inserida 14/10/2025). Há ainda `…_BASE_ENT2` (`1556,2556,3556,1922,2922,1949,2949,3949,1950,2950,3950`) e
> `FILTRAR_CFOP_CALCULO_PIS_COFINS` (nula). Uso das duas: não determinado.

**NFC-e** — `VENDAS V JOIN NFC N ON NROPEDIDO, IDEMPRESA, SERIE=NROSERIE, TRUNC(DTVENDA)=TRUNC(DTEMISSAO), NROCUPOM=NRONF`,
`CANCELADO='N'`. `VL_OPR` = item (`IAT='A'` → arredonda; senão trunca) + acréscimos positivos − (promoção + departamento + acréscimos negativos).
Elegível: `STATUSNFE='P' AND PROC='S'` (ou `STATUSNFE='G'` se `CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL='S'`; hoje `N`),
`CHAVENFE` não nula, não cancelada, `ALIQ_PIS_SAI > 0`. `V.IDPISCOFINS` não veio nulo em nenhum dos 77.863 itens elegíveis da situação 13 em jul/2025.

### 2.3 Créditos / Débitos / Resumo (exibição)

- **Pai** agrupa por `(ID_TIPOCREDITO, ALIQPIS)`; descrição de `PC_TIPOCREDITO`. **Recalcula** `pis = round(Σbase × aliq/100, 2)` (`:1034-1092`). Não usa o VALORPIS gravado.
- **Filho**: as linhas do detalhe daquele pai.
- **Resumo**: créditos do período anterior (campo **manual**, não gravado) + créditos + débitos → a recolher = débito − (anterior + crédito) (`:764-780`).

### 2.4 Ajuste manual de crédito (fonte `:890-986`, `UAjustaApuracaoPC.pas`)

- Na grade pai de Créditos, Enter na coluna **Tipo** (código de `PC_TIPOCREDITO`) abre "Ajusta Apuração".
- Campos: base de crédito (F3 `GET_BASECREDITO`), PIS/COFINS (traz descrição e `ALIQ_*_ENT`), base. Valor = base × aliq / 100 **sem arredondar** (o Oracle arredonda no NUMBER(15,2)).
- Grava na hora em `APURACAO_PC_DET` como `CREDITO`/`ENTRADA` — **indistinguível** da linha calculada.
- [DEL] no pai apaga o pai, os filhos e as linhas do detalhe (Locate pela 1ª que casa `ID_TIPOCREDITO;ID_BASECREDITO;IDPISCOFINS`).
- Editáveis na grade pai (só memória): Tipo, BASECALCULO, ALIQPIS, ALIQCOFINS. As grades filho e de débito não editam (`Options` sem `dgEditing`).
- **Nenhum `*_APURA` é editável na tela.**

### 2.5 Imprimir (`:237-651`)

`ApuracaoPis_Cofins.fr3` com ~30 totais lidos de `APURACAO_PC_DET` (SUM de BASECALCULO/VALORPIS/VALORCOFINS por TIPO)
e de NF_PROD (frete 2353, energia 1253, devolução de venda 1202 com `IDSITUACAO_NF=2`, devolução de compra `IDSITUACAO_NF=17`, alíquotas 1,65/7,6 fixas).
Defeitos do fonte: `TOTVALRECPIS` soma `TOTOUTCRECOF` (COFINS) (`:597`); `TOTDEVVENDAS` é zerado antes de imprimir (`:556`).
O relatório soma o VALORPIS gravado → herda o defeito da última linha (§3.3).

---

## 3. APURACAO_PC / APURACAO_PC_DET como o legado grava

### 3.1 Coluna a coluna

**APURACAO_PC**

| Coluna | Tipo | Como nasce |
|---|---|---|
| CODAPURACAO_PC | NUMBER(10) PK | `GetID` → sequence `ID_CODAPURACAO_PC` (last 361, cache 20) |
| DATAINI / DATAFIM | DATE | o período digitado |
| IDEMPRESA | NUMBER | NULL nas 18 (R5) |

Sem UNIQUE, sem FK, sem trigger (só as PKs).

**APURACAO_PC_DET**

| Coluna | Tipo | CREDITO/ENTRADA | DEBITO/SAIDA NF | DEBITO/NFC-e |
|---|---|---|---|---|
| CODAPURACAO_PC_DET | NUMBER(10) PK | sequence `ID_CODAPURACAO_PC_DET` | idem | idem |
| CODAPURACAO_PC | NUMBER(10) | o pai (sem FK) | idem | idem |
| APURACAO | VARCHAR2(15) | `'CREDITO'` | `'DEBITO'` | `'DEBITO'` |
| TIPO | VARCHAR2(20) | `'ENTRADA'` | `'SAIDA NF'` | `'NFC-e'` |
| ID_TIPOCREDITO | NUMBER(10) | `PISCOFINS.ID_TIPOCREDITO` (1→106, 11→106, 13→101) | idem | idem |
| ID_BASECREDITO | NUMBER(10) | `PC_CONFIG.ID_BASECREDITO` do CFOP **do item**; **0** quando nulo | **1 fixo** | `PC_CONFIG` do CFOP da venda → sempre nulo → **0** (48/48) |
| DESCRICAOBASE | VARCHAR2(200) | `PC_BASECREDITO.DESCRICAO`; nulo com base 0 | `'AQUISICAO DE BENS PARA REVENDA'` fixo | nulo (48/48) |
| IDPISCOFINS | NUMBER(10) | `COALESCE(NP.IDPISCOFINS, P.IDPISCOFINS)` | idem | `COALESCE(V.IDPISCOFINS, P.IDPISCOFINS)` |
| DESCRICAOPC | VARCHAR2(100) | `PISCOFINS.DESCRICAO` | idem | idem |
| BASECALCULO | NUMBER(15,2) | até jan/2025: base **bruta**; desde jul/2025: **líquida de ICMS** (R7) | bruta até 2024, líquida depois | VL_OPR **− ICMS** (R8), sempre |
| ALIQPIS / ALIQCOFINS | NUMBER(13,4) | `ALIQ_*_ENT` | `ALIQ_*_SAI` | `ALIQ_*_SAI` |
| VALORPIS / VALORCOFINS | NUMBER(15,2) | `round(BASECALCULO × ALIQ/100, 2)` | idem | idem, **exceto a última linha** (§3.3) |
| BASECALCULOAPURA | NUMBER(15,2) | base **líquida de ICMS** | idem | = BASECALCULO (48/48) |
| VALORPISAPURA | NUMBER(15,2) | 2022–jan/2025: `Σ_item round((base_item − ICMS_item) × 1,65/100, 2)`; desde jul/2025: `round(BASECALCULOAPURA × 1,65/100, 2)` | ≈ base × 1,65% (desvio ≤ 0,28) | ≈ base × 1,65% (desvio até 7,74) |
| VALORCOFINSAPURA | NUMBER(15,2) | idem com 7,6 | idem | idem |

Chave de agrupamento (uma linha por): ENTRADA `(ID_TIPOCREDITO, ID_BASECREDITO, DESCRICAOBASE, IDPISCOFINS, DESCRICAOPC, ALIQ_PIS_ENT, ALIQ_COFINS_ENT)`;
SAIDA NF `(NP.CFOP, …, ALIQ_PIS_SAI, ALIQ_COFINS_SAI, ALIQUOTA ICMS)`; NFC-e `(ID_TIPOCREDITO, ID_BASECREDITO, DESCRICAOBASE, IDPISCOFINS, DESCRICAOPC, ALIQ_*_SAI)` → 1 linha por situação (1, 11, 13).

### 3.2 `*_APURA` — o que é e a diferença para as colunas sem sufixo

| Caso | Sem sufixo | `*_APURA` | Prova |
|---|---|---|---|
| Crédito normal (101), 2022–2024 | base bruta × 1,65 | base − ICMS, 1,65 item a item | 22 `101/2/13`: 16.992,42 → **16.529,18** = −463,24 de ICMS; VPA 272,69 = Σ item ✓; VCA 1.256,16 ✓ |
| Crédito normal (101), 2025+ | base − ICMS × 1,65 | a mesma coisa | 261, 282, 301, 321, 341: **30/30** linhas ENTRADA com `APURA` exato |
| Crédito presumido (106) | base × **0,198/0,912** ou **0,66/3,04** | base × **1,65/7,6** | 341 `106/2/11`: 306,40 × 0,198% = **0,61** vs 306,40 × 1,65% = **5,06** |
| Débito NFC-e | round(base × 1,65) | ≈ Σ de arredondamentos menores | 341 `101/13`: 15.258,20 vs **15.260,09** |
| Última linha (NFC-e 106) | valor errado (§3.3) | valor coerente | 341 `106/11`: **15.428,89** vs **89,39** (5.421,41 × 1,65% = 89,45) |

Totais do débito (PIS), sem sufixo × APURA: 341 = **30.768,85 × 15.431,24**; 181 = 19.467,24 × 9.751,59; 61 = 21.336,25 × 11.049,68.
Quem somar a coluna sem sufixo no débito **dobra** o PIS/COFINS a recolher nesses períodos.

A troca da regra (base bruta → líquida na coluna sem sufixo) aconteceu entre 242 (jan/2025) e 261 (jul/2025).

### 3.3 Defeito: a última linha de toda apuração

- Em **18 de 18** apurações, a linha de maior `CODAPURACAO_PC_DET` (sempre DEBITO / NFC-e / 106) tem `VALORPIS/VALORCOFINS ≠ round(base × aliq)`.
- A razão COFINS/PIS dela é 7,6/1,65 → é outra base × a alíquota certa. Às vezes o dobro do certo (201, 221, 241, 242, 321), às vezes muito mais (341: 15.428,89).
- As outras 175 linhas batem ao centavo.
- A tela não mostra o erro (recalcula o pai, §2.3). O relatório e o SPED de 2020 somam o gravado.
- Origem: não determinada (o fonte de 2020 grava sempre `RoundTo(base×aliq,-2)`).

---

## 4. Reprodução por SELECT (produção, só leitura)

Consultas no scratchpad (`cred*.sql`, `nfce*.sql`). ✓ = ao centavo.

**261 — jul/2025** (gerada depois do fim do mês)

| Linha | Gravado | Reproduzido |
|---|---:|---:|
| CREDITO 101 / base 1 / sit 13 | 353.585,69 | 362.783,92 − 9.198,23 = **353.585,69** ✓ |
| CREDITO 101 / 2 / 13 | 40.654,82 | 44.059,31 − 3.404,49 = **40.654,82** ✓ |
| CREDITO 101 / 4 / 13 (energia) | 18.661,67 | **18.661,67** ✓ |
| CREDITO 101 / 6 / 13 (aluguel) | 205.442,24 | **205.442,24** ✓ |
| CREDITO 106 / 1 / 1 | 48,16 | 50,16 − 2,00 = **48,16** ✓ |
| CREDITO 106 / 2 / 11 | 229,80 | **229,80** ✓ |
| CREDITO 106 / 1 / 11 | 882,69 | 882,75 (−0,06: 1 item com frete 2,1181% × `FRETE_NOTA` 0,99) |
| VALORPIS 101/1/13 | 5.834,16 | round(353.585,69 × 1,65%) = **5.834,16** ✓ |
| DEBITO NFC-e / 13 | 607.740,37 | 638.019,82 − 30.279,45 = **607.740,37** ✓ |
| DEBITO NFC-e / 1 | 148,17 | 178,55 − 30,38 = **148,17** ✓ |
| DEBITO NFC-e / 11 | 3.103,13 | 3.137,69 − 34,56 = **3.103,13** ✓ |
| VALORPIS NFC-e / 13 | 10.027,72 | round(607.740,37 × 1,65%) = **10.027,72** ✓ |

**22 — jul/2022**: 6 de 7 créditos ✓ na base bruta; `BASECALCULOAPURA` = bruta − ICMS ✓ (16.529,18; 3.055,06);
`VALORPISAPURA`/`VALORCOFINSAPURA` = Σ por item ✓ em 6 linhas (272,69/1.256,16; 1.374,91/6.332,84; 152,10/700,54; 50,40/232,18…).
NFC-e ✓ nas 3: 400.844,08 − 17.140,38 = **383.703,70**; 19.892,90; 311,83.

**181 — set/2024**: `BASECALCULO − BASECALCULOAPURA` = ICMS fiscal ✓ nas 4 linhas com ICMS (8.265,80; 700,94; 14,21; 18,21).

**341 — 01/02 a 31/03/2026**: foi **gerada em 24/03/2026, no meio do dia**, e nunca refeita.
- Créditos com NFs até `CODNF ≤ 148700`: 6 de 8 ✓ (56.492,96; 43.065,95; 208.936,79; 980,00; 144,31; 306,40). `106/1/11` +0,73; `101/1/13` não fecha (NFs alteradas depois).
- NFC-e: sit 1 até 23/03 = **341,71** ✓; sit 13 e 11 caem dentro do dia 24/03 (918.313,57 → 933.616,25 contém 924.739,46).
- Hoje, o mesmo período daria aluguel 393.807,79 (gravado 208.936,79).

**SAIDA NF: não reproduzido.** O SQL de 2020 só acha CFOP 5102 (22,36 em jul/2022; nada em jul/2025), contra 8.928,88 e 3.455,13 gravados. Nenhum subconjunto de CFOPs fecha.

**Linhas ENTRADA com base 0 (20, só 2022–2024)**: itens com CFOP **fora** do `PC_CONFIG` (1303, 1407, 1556, 1653, 1949, 2407, 2556 somam 35.082,65 em jul/2022; gravado 35.086,90). O binário da época não aplicava o filtro de CFOP — creditava uso e consumo. Não aparece desde 2025.

---

## 5. Consumo pelo EFD-Contribuições (`UspedPisCofins`)

| Ponto | Legado (fonte 2020) |
|---|---|
| Qual apuração | `WHERE TRUNC(DATAINI) = :DATAINI AND TRUNC(DATAFIM) = :DATAFIM` — **igualdade exata** com o período do SPED (`UdmSpedPisCofins.dfm:6204-6206`). Não aceita sobreposição. Sem empresa. Se houver duas, vale a 1ª (master-detail). |
| Nenhuma | Mensagem + `Abort`: **não gera o arquivo** (`UspedPisCofins.pas:2427-2432`). |
| Bloco M ligado | só com "Gerar M100/810" marcado (padrão marcado, `:790`). Detalhe vazio → M001 IND_MOV=1. |
| Agrupamento | `MontaApuracao` do SPED: pai por `(ID_TIPOCREDITO, ALIQPIS)`, somando **VALORPIS/VALORCOFINS gravados** (`:2383-2386`) — diferente da tela, que recalcula. |
| M100 / M500 | COD_CRED = ID_TIPOCREDITO; VL_BC = Σ base; ALIQ = ALIQPIS; VL_CRED = VL_CRED_DISP = Σ VALORPIS; desconto "fill-first" do saldo credor; **omitido no regime cumulativo** (`cbbIncTrib=1`; LP força 1) (`:1436-1489`, `:1706-1763`). |
| M105 / M505 | NAT_BC_CRED = ID_BASECREDITO (1..18; **0 não tem case** → resultado indefinido); CST = `PISCOFINS.CST_PIS_ENT`/`CST_COFINS_ENT` **lido na hora**; VL_BC_TOT = VL_BC_NC = VL_BC = BASECALCULO; VL_BC_CUM = 0 (`:1491-1521`, `:1765-1795`). |
| M200 | LR: VL_TOT_CONT_NC_PER = Σ débito; **VL_TOT_CRED_DESC = crédito TOTAL** (não o mínimo); a recolher = max(débito − crédito, 0). Não-LR: variante cumulativa (`:1523-1613`). |
| M600 | igual, mas VL_TOT_CRED_DESC = **mínimo** (crédito, débito) — assimetria com o M200 (`:1804-1805`). |
| M210 / M610 | **um** registro COD_CONT 01; VL_REC_BRT = VL_BC_CONT = Σ base do débito; ALIQ = a do registro corrente do pai (`:1553-1566`, `:1853-1856`). |
| M205 / M605 | se a recolher > 0: NUM_CAMPO `'08'` (LR) ou `'12'`; COD_REC `810902` / `217201`. |
| M400/M800 | **não vêm** de APURACAO_PC_DET: `sqqBaseIsenta` calculado na geração. |
| `*_APURA` | não lidas (não existem no fonte). No binário atual: **não determinado**. |

---

## 6. O Apollo hoje × o legado

Arquivos: `sped-apuracao-pc.service.ts` (motor), `apuracao-pc-consulta.service.ts` (tela), `sped-efd-contribuicoes.service.ts:103-258` (bloco M),
migrations 098, 123, 151, 240, 290, 310, 320; tela `apps/web/src/features/apuracao-piscofins/ApuracaoPisCofinsPage.tsx`; ETL `tools/cutover/etl/extrair.py`.

| Aspecto | Legado | Apollo | Gravidade |
|---|---|---|---|
| Escopo | raiz CNPJ (empresas 1+2 juntas); NFC-e sem filtro; IDEMPRESA NULL | por `idempresa` do tenant, NOT NULL | **ALTA** — o EFD-Contribuições é por raiz |
| Carga das 18 | IDEMPRESA NULL | ETL faz `nvl(idempresa,1)` (`extrair.py:480-484`) → tudo vira "empresa 1"; a empresa 2 não vê | ALTA |
| Unicidade | nenhuma; mesmo período → só carrega; sobreposição ok | `UNIQUE(idempresa,dataini,datafim)` + delete-then-insert (refaz calado) | MÉDIA |
| APURACAO / TIPO | `'CREDITO'/'DEBITO'` + `'ENTRADA'/'SAIDA NF'/'NFC-e'` | `tipo` char `'C'/'D'/'I'` + `tipo_origem`; coluna `apuracao` existe (mig 310) e o motor **não grava** | MÉDIA |
| ID_TIPOCREDITO | `PISCOFINS.ID_TIPOCREDITO` (101/106) | `'101'` fixo, varchar(3) | ALTA — some o 106 (presumido) |
| ID_BASECREDITO | `PC_CONFIG` pelo CFOP do item (1,2,4,6,7,12); 1 na saída; 0 na NFC-e | `1` fixo no crédito; nulo no débito | ALTA — M105 com natureza errada |
| IDPISCOFINS / DESCRICAOPC / DESCRICAOBASE | gravados | `idpiscofins` nulo; as descrições existem (mig 310) e não são gravadas | MÉDIA |
| Chave do crédito | (tipo, base, situação, alíquotas de ENTRADA do catálogo) | (CST, `aliqpise`, `aliqcofinse` do item) | ALTA |
| Base do crédito | fórmula do item − ICMS fiscal | Σ `nf_prod.bcpiscofinse` (base do XML) | **ALTA**: jul/2025 energia + aluguel = 224.103,91 de base com `bcpiscofinse = 0` e `vrpise = 0` → filtro `vrpise>0` **descarta**. No mesmo conjunto de itens de jul/2025, Σ `bcpiscofinse` ≈ 354.968 contra 619.505,07 de base do legado |
| Filtros do crédito | 12 filtros (§2.2), PC_CONFIG, CST 50–56/60, parceiro PJ | `vrpise>0 or vrcofinse>0`, `statusnfe<>'C'` | ALTA |
| Valor do crédito | round(base × ALIQ_ENT) — presumido 0,198/0,66 | Σ `vrpise` do item | ALTA |
| Débito NFC-e | VL_OPR − ICMS 'T'; por situação | Σ `vendas.pis_bcalculo`, por (CST, alíquotas), sem abater ICMS | ALTA: jul/2025 sit 13 Σ PIS_BCALCULO 642.971,74 × legado 607.740,37 |
| Débito NF | ramo SAIDA NF (não reproduzido) | NF mod 55, qtd×vrcusto − vrdescprod, sem ICMS | não determinado |
| `*_APURA` | preenchidas | colunas existem (mig 290/310); motor não grava; bloco M não lê | ALTA (todos os campos) |
| Linhas de receita não tributada | não ficam em APURACAO_PC_DET | gravadas como `tipo='I'` | BAIXA (decisão do novo) |
| Ajuste manual de crédito | sim (§2.4) | não existe | MÉDIA |
| Crédito do período anterior | campo manual no Resumo | não existe | BAIXA |
| Aba Configuração (PC_CONFIG) | sim | tabela existe (mig 041); sem tela aqui | MÉDIA |
| Imprimir | `ApuracaoPis_Cofins.fr3` | não existe | BAIXA |
| Pai/filho Créditos e Débitos | agrupado por (tipo de crédito, alíquota), pai recalculado | lista plana ordenada por tipo/CST | MÉDIA |
| Totais da tela | recalcula pelo pai | soma `valorpis` gravado → nas 18 migradas herda o defeito da última linha (341: débito PIS 30.768,85 em vez de ~15.431) | ALTA pós-carga |
| `APURACAO_PC_AJUSTE_M` | tabela nova (M110/M115/M220/M225/M510/M515/M620/M625), 0 linhas | não existe no destino nem no plano de carga | MÉDIA (todos os campos) |
| SPED: busca | igualdade exata, sem empresa | igualdade exata **por idempresa** | ALTA (escopo) |
| SPED: sem apuração | aborta, sem arquivo | M001 IND_MOV=1, gera arquivo | MÉDIA — decisão |
| M100 | por (ID_TIPOCREDITO, ALIQPIS), Σ VALORPIS | por (id_tipocredito, alíq), Σ valorpis — igual na forma | ok |
| M105 CST | `PISCOFINS.CST_PIS_ENT` ao vivo | `cst_pis` da linha ou `'50'` | MÉDIA |
| M200 crédito descontado | total do crédito (PIS) / mínimo (COFINS) | mínimo nos dois | BAIXA (Apollo mais correto; documentar) |
| M210/M610 | 1 registro | 1 por alíquota | BAIXA |
| M205 NUM_CAMPO | `'08'` LR / `'12'` outro | `'08'` fixo | BAIXA (cliente é LR) |
| Regime cumulativo | suportado (sem M100) | só não-cumulativo | BAIXA (empresas 1/2 são LR) |

---

## 7. Não determinado

1. **Qual coluna o SPED do binário atual lê** (`VALORPIS` ou `VALORPISAPURA`). O fonte de 2020 lê `VALORPIS`. O defeito da última linha sugere que `*_APURA` existe para corrigir — mas é hipótese.
2. **Se o EFD-Contribuições sai deste sistema.** Só 8 meses cheios têm apuração em 4 anos (jun–out/2022, ago–set/2024, jul/2025). Com o `Abort` do fonte, nenhum outro mês geraria o arquivo. Pode ser feito fora (contador) ou o binário novo não exigir mais a apuração.
3. **Origem do valor errado da última linha** (18/18).
4. Granularidade exata de `VALORPISAPURA` na NFC-e e na SAIDA NF. Testados item, documento, documento+CFOP, documento+alíquota, dia+empresa: nenhum fecha (desvio de centavos a 7,74).
5. **O conjunto de itens da SAIDA NF** no binário atual.
6. Por que o ICMS é abatido com `ABATER_ICMS_BASE_CALCULO_PIS_COFINS = N` (regra fixa no binário novo ou outra config).
7. De onde vem o 1,65/7,6 do `*_APURA`: `PISCOFINS.ALIQ_*_SAI`, `NF_PROD.ALIQPISE` ou constante (no dado os três coincidem).
8. Uso de `FILTRAR_CFOP_CALCULO_PIS_COFINS` (nula) e `…_BASE_ENT2`.
9. O que a tela faz com `IDEMPRESA` quando `SELECIONAR_EMPRESA_… = S`.
10. Se a empresa 51 entrou na NFC-e das apurações de 04/2023 a 02/2025.
11. A tela/regra de `APURACAO_PC_AJUSTE_M` (criada 09/06/2026, vazia).
12. Se o ajuste manual (§2.4) grava `*_APURA` no binário atual.

---

## 8. Cortes propostos (menor risco primeiro)

| Corte | Conteúdo | Golden |
|---|---|---|
| ✅ **A — dado fiel** | `apuracao_pc.idempresa` aceita nulo (ou coluna de escopo "raiz"); ETL carrega NULL como NULL; tirar/relaxar o UNIQUE; motor e carga gravam `apuracao`, `descricaobase`, `descricaopc`, `basecalculoapura`, `valorpisapura`, `valorcofinsapura`; `id_tipocredito` numérico; criar `apuracao_pc_ajuste_m` (todos os campos). | as 193 linhas carregadas ao centavo |
| ✅ **B — tela de consulta fiel** | Apurações Realizadas (todas do escopo), abrir, excluir; Créditos/Débitos pai/filho por (tipo de crédito, alíquota) com pai recalculado; `*_APURA` lado a lado; Resumo com crédito anterior manual; mesmo período → "carregar?" em vez de refazer. Mostrar o total pelo recálculo (não pela soma gravada). | 341, 261, 22 abertas iguais ao legado |
| ✅ **C — motor do crédito** | fórmula do item, PC_CONFIG pelo CFOP do item, 12 filtros, ICMS fiscal (T e PROC_CUPOM), alíquota ENT, tipo de crédito do catálogo, `*_APURA` com 1,65/7,6 (regra 2025+). Escopo raiz CNPJ. | 261 (6/7 ✓), 22 (6/7 ✓), 181 (ICMS 4/4 ✓) |
| ✅ **D — motor do débito NFC-e** | VENDAS⋈NFC com as 5 chaves, VL_OPR com IAT, − ICMS dos itens 'T', 1 linha por situação, contingência por config. | 261 e 22: 3/3 ✓ cada |
| **E — acessórios** | ajuste manual de crédito, aba Configuração (PC_CONFIG), impressão, seleção de empresa por config. | — |
| **F — SPED bloco M** | só depois de decidir §7.1 e §7.2 com o usuário: coluna lida, abortar ou não sem apuração, M105 (natureza pelo `id_basecredito`, CST do catálogo). | arquivo de um mês com apuração (jul/2025) |
| **G — SAIDA NF** | novo recon com o binário/dado; fica fora até fechar §7.5. | 22, 261 |

---

## Estado da conversão (25/09/2026)

- ✅ **A** (mig 363): `apuracao_pc.idempresa` aceita nulo e sem UNIQUE (a carga passa a trazer o NULL — o `nvl(idempresa, 1)` automático só
  vale para coluna NOT NULL); `id_tipocredito` inteiro; `piscofins.id_tipocredito`; `pc_basecredito` com as 18 linhas;
  `apuracao_pc_ajuste_m` (todos os campos); as configs 820 (seleção de empresa), 811 (a lista de CFOPs fora da base) e 293.
- ✅ **C/D** (`sped-apuracao-pc.service.ts`): o escopo da raiz do CNPJ (IDEMPRESA nulo; por empresa só com a config 820 = S), o crédito
  pela fórmula do item com o ICMS fora (menos PROC_CUPOM) e os 12 filtros, o frete pelo VRFRETE do item (a fatia — é o que fecha a
  106/1/11 da 261), o débito da NFC-e pelo VL_OPR menos o ICMS sem filtro de empresa, a SAIDA NF do fonte (ramo não reproduzido), as
  colunas APURACAO/TIPO do legado, tipo e base de crédito do catálogo, as descrições e os `*_APURA` (alíquota cheia = a de saída do
  catálogo). O mesmo período volta a existente (`existente: true`).
- ✅ **B**: a consulta no escopo, os pais (tipo de crédito × alíquota) recalculados — o total não herda o defeito da última linha —, os
  `*_APURA` lado a lado; o "Apurar" de um período já feito carrega a existente.
- O bloco M passou a achar a apuração de IDEMPRESA nulo (o período exato, a primeira se houver duas). O resto do **F** (qual coluna ler,
  abortar sem apuração) e o **E** (ajuste manual, crédito anterior, aba PC_CONFIG, impressão) e o **G** seguem pendentes.
- Smoke §88/§90c (o dado de teste passou a ter a situação PIS/COFINS e o ICMS que a regra do legado usa), §117 (totais pelo pai) e
  §259 (crédito, NFC-e, *_APURA, escopo e período repetido).
