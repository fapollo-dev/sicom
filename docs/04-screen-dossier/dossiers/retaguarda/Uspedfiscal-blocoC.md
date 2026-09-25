# Recon de paridade — EFD ICMS-IPI C100 / C170 / C190 (+ filhos) e EFD-Contribuições C170

Data: 25/09/2026 · Recon **somente leitura** (nenhuma edição no `/Library/Apollo`, nenhum comando git que altere algo; Oracle de produção só com `SET TRANSACTION READ ONLY` + `SELECT`).

## 0. Resumo (o que importa)

| # | Achado | Registro | Gravidade |
|---|---|---|---|
| 1 | `CST_ICMS` = `origem_estoque[0]` + CST de 2 dígitos → sai **`E00`, `E10`, `E60`…** (ORIGEM_ESTOQUE = `'E '` em 100% das 62.581 linhas de 2026; em 499.781 das 499.785 linhas mais recentes). O legado usa `FormatFloat('000', CST)` | C170, C190, C590 (ICMS-IPI) e C170 (Contribuições) | **O PVA rejeita** (fora da tabela 4.3.1) |
| 2 | O Apollo põe em C100 os **modelos 03, 07 e 08** (12 NFs de entrada jan-ago/2026: 1+1+10). O legado os tira do C100 (07/08 vão para **D100/D190**) | C100 | **O PVA rejeita** (COD_MOD inválido no C100) |
| 3 | O Apollo põe em C100 a **NF-e modelo 55 sem chave** (3 saídas próprias jan-ago/2026, uma de R$ 20.985,72). O legado as tira | C100 | **O PVA rejeita** (CHV_NFE obrigatório para o modelo 55) |
| 4 | **QTD sem `FATOREMBAL`**: o legado emite `QUANTIDADE*FATOREMBAL` na unidade do produto; o Apollo emite a quantidade da embalagem de compra com a unidade do produto. 49% dos itens de entrada têm fator ≠ 1; em ago/2026 foram 128.089 no Apollo contra 311.920 no legado | C170 | Quantidade fiscal errada (o PVA não rejeita) |
| 5 | **Zeragem de ICMS por item** que o Apollo não tem: PROC_CUPOM (CFOP 1403/1411/5929), x933/x556, x101/x102 com CST 40/90, e alíquota que não é `T%`/`STB`. Em 8 meses são **R$ 28.155,79 de crédito de ICMS** que o Apollo toma e o legado não | C170, C190, C100 → E110 | **Valor de imposto errado** |
| 6 | `ALIQ_ICMS` vem de `nf_prod.icms` (alíquota nominal) e não de `ICME` (a efetiva). Diverge em 19.974 dos 54.749 itens de entrada (1.845 deles com ICMS). Exemplo: T03 com ICMS=18 e ICME=1,86 | C170, chave do C190 | Valor/agrupamento errado; o PVA pode acusar BC×ALIQ≠VL_ICMS (não determinado) |
| 7 | `VL_OPR` do C190 = Σ qtd×vrcusto. O legado soma −desconto, +despesas acessórias, +IPI, +frete, +ICMS-ST e +FCP-ST. Σ VL_OPR ≠ VL_DOC em **317 de 703 NFs de entrada** (ago/2026) no Apollo; no legado são 40 | C190 | Registro analítico/valor contábil errado; consistência C100×C190 (erro ou aviso do PVA não determinado) |
| 8 | **Quando sai o C170**: o legado suprime o C170 de toda NF **modelo 55 de emissão própria** (entradas e saídas) com as opções padrão. O Apollo emite sempre (706 NFs em 8 meses) | C170 | Conteúdo diverge do legado e do Guia; o PVA não rejeita (não determinado) |
| 9 | **CST PIS/COFINS**: `nf_prod.cstpiscofins` é NULL em ~100% dos itens de 2026, então o Apollo cai na heurística `50`/`99`. O legado usa `PISCOFINS.CST_PIS_ENT`/`CST_PIS_SAI` (50, 73, 70, 98…). Na **Contribuições** de ago/2026: 433 itens CST 50 com R$ 4.728 de PIS no legado saem como CST 99 com PIS 0; 156 itens CST 74 no legado saem como CST 50 com PIS 705 | C170 (os dois arquivos) | Informativo no ICMS-IPI · **crédito errado na Contribuições** |
| 10 | Colateral: o **0150 do Apollo** busca o endereço com `endereco_padrao='S'`, mas em produção 329 dos 332 endereços usados nas NFs têm ENDERECO_PADRAO NULL. Resultado: 0150 **sem CNPJ/CPF/COD_MUN** para ~99% dos participantes. O legado usa `NF.CODPARCEIRO_END` | 0150 (COD_PART do C100) | **O PVA rejeita** (colateral, fora do escopo) |
| 11 | Colateral: o EFD ICMS-IPI do Apollo **não emite NFC-e (mod 65)** nem as inutilizações de NFC-e (21.807 números em 2026). O legado emite (GeraNFC / GeraNFInutilizadas). Em ago/2026 o ICMS de NFC-e foi ~R$ 27,2 mil contra ~R$ 1,5 mil das NF-e de saída | C100/C190 mod 65 | **Débito de ICMS ausente** (colateral) |
| 12 | Colateral: o docstring do Apollo diz que "o legado não emite bloco D". **Falso**: `GeraBlocoD` (Uspedfiscal.pas:516-672) emite D100/D190 para frete (modelos 7, 8, 9, 10, 11, 26, 27 e 57) e D500/D590 para telecom (21/22) | D100/D190 | Colateral (explica o achado 2) |

**Fonte de verdade adicional disponível:** `NFAUXSPED` em produção (DDL em 17/09/2026 22:22) contém as 293 NFs da **empresa 2, ago/2026**. É o **último SPED Fiscal gerado pelo legado**. Pedir ao usuário o `.txt` desse arquivo permite certificar byte a byte o que o ACBr grava de fato (formatações que este recon marca como "não determinado").

---

## 1. Fontes e método

- Legado (fonte de mai/2020, latin1): `Uspedfiscal.pas`/`.dfm`, `UdmSpedFiscal.dfm` (ICMS-IPI), `UspedPisCofins.pas`/`.dfm`, `UdmSpedPisCofins.dfm` (Contribuições), em `/Library/SicomGit/retaguarda-master/fonte/Units`. A conversão para UTF-8 preserva a numeração de linhas.
- Apollo: `apps/api/src/modules/sped/sped-efd-icms-ipi.service.ts` (abreviado **ICMS.ts**) e `sped-efd-contribuicoes.service.ts` (abreviado **PC.ts**).
- Oracle de produção `pinheirao@hiperpinheirao…/apollo`, sessão `SET TRANSACTION READ ONLY`, só SELECT. Janela padrão: `DTCONTABIL` de 01/01 a 31/08/2026, `PROC='S'`. Os scripts estão em `…/scratchpad/recon-sped-c170/q/`.
- **Ausentes do fonte** (não determinado):
  - o código do **ACBr**: como o writer formata QTD, CST_PIS de 1 dígito, campos de documento cancelado e o mapeamento dos enums;
  - a procedure **`AjustaBaseDeDadosSPED`** (Uspedfiscal.pas:4315): só existe a chamada. Ela muta CFOP/CST no banco antes de gerar, conforme o hint em Uspedfiscal.dfm:1242-1263, e só roda com `ckbAjustaBaseDeDados`, desmarcado por padrão.
- **`GetCstIcms` está no fonte**, em UspedPisCofins.pas:2035-2145. É um `case` do inteiro NF_PROD.CST para o enum ACBr. 0→`sticmsTributadaIntegralmente` ("000"), 10→"010" … 90→"090", 100..890 (origem nas centenas), 101/102/103/201/202/203/900 (CSOSN) e 300/400/510 dependentes de SN. Na prática equivale a `FormatFloat('000', CST)`.

### 1.1 Opções da tela do legado (padrão do `.dfm`; **não são persistidas**: sem INI/registry, FormCreate/FormShow não as carregam, Uspedfiscal.pas:4424-4442)

| Opção | Padrão | Onde pesa |
|---|---|---|
| `ckbEntradas` / `ckbSaidas` | **marcadas** (dfm:258-276) | GeraNF processa só TIPO E/S (pas:2333-2335) |
| `rgCodigoProduto` | **ItemIndex=1 = PLU** (dfm:295-306) | COD_ITEM = CODPRODUTO |
| `ckbC170Saidas` "Gerar C170 notas de emissão própria" | desmarcada (dfm:775) | suprime o C170 da NF 55 própria (pas:2707-2709) |
| `chkCST49` | desmarcada (dfm:767) | CST_ICMS='049' fixo |
| `chk5929ZeradoC170` | desmarcada (dfm:735) | zera ICMS do x929 no C170 |
| `CkbTotalDocumentoZerado5929` | desmarcada (dfm:750) | C100/C190 zerados no x929 |
| `chkGerarICMSST` | desmarcada (dfm:814) | VL_ICMS_ST de C100/C170/C190 = 0 |
| `chkDestacarIPIICMSSTTotalItem` | desmarcada (dfm:829) | VL_ITEM/VL_MERC somam ST+IPI |
| `chkSomarIPIemOutrasDesp` / `…ICMSST…` / `…FCPSt…` | desmarcadas (dfm:659-690) | VL_OUT_DA e VL_IPI |
| `chkGerarC113C114` | **marcada** (dfm:371/391) | C113/C114 |
| `ckb140Saidas`, `chkGerarC176`, `chkC191` | desmarcadas (dfm:348/397/422); C176 é travado no clique (pas:4189-4196) | C140/C141, C176, C191 |
| `ckbAjustaBaseDeDados` | desmarcada (dfm:1242) | muta o banco antes de gerar |

> Não dá para saber o que o operador marca em produção: `CapturaTela` grava um print em disco, não no banco. O diff abaixo assume o **padrão do .dfm** e aponta onde cada opção muda o resultado.

---

## 2. Seleção das NFs (C100)

**Legado.** Primeiro, `PreProcessamento` cria `NFAUXSPED` = `NF INNER JOIN PARCEIROS_END PE ON PE.CODEND = NF.CODPARCEIRO_END`, com `TRUNC(DTCONTABIL)` no período e a empresa filtrada, e cria `NF_PRODAUXSPED` com os itens dessas NFs (Uspedfiscal.pas:4328-4339). Depois, a query `adqNF` (UdmSpedFiscal.dfm:2604-2685) e o laço `GeraNF` (Uspedfiscal.pas:2305-3210) aplicam os filtros da tabela.

| Critério | Legado (arquivo:linha) | Apollo `coletarEntrada` (ICMS.ts) | Dado de produção jan-ago/2026 | Gravidade |
|---|---|---|---|---|
| Data | `TRUNC(DTCONTABIL) BETWEEN :D1 AND :D2` (dfm:2660) | `dtcontabil >= dtini AND <= dtfim` (235-236; coluna `date`) | — | = |
| PROC | `N.PROC='S'` (dfm:2666) | `proc='S'` (234) | — | = |
| TIPO | só E/S, com ckbEntradas/ckbSaidas (pas:2333-2335) | `tipo IN ('E','S')` (233) | só existem E e S | = |
| Número | `NRONF NOT IN ('000000')` (dfm:2667) | + `IS NOT NULL` + `'0'` (237-238) | — | cosmético |
| **Modelo** | `(55 AND CHAVENFE NOT NULL AND status≠'I') OR (55 AND status='I') OR MODELO NOT IN (22,21,6,2,8,7,28,29,3,57,55)` (dfm:2662-2665). O 65 entra na query, mas GeraNF pula (pas:2337) e o GeraNFC trata | nenhum filtro; 6/28/29 vão para C500 e 21/22 são descartados (413-414) | E mod 1: 305 · **mod 3: 1 · mod 7: 1 · mod 8: 10** · mod 90: 1 | **O PVA rejeita** C100 com COD_MOD 03/07/08 |
| **Modelo 55 sem chave** | excluída (dfm:2662) | incluída; sai C100 com `CHV_NFE` vazio | **3** saídas próprias (1 com status P de R$ 20.985,72 e 2 com status NULL de R$ 122,50) | **O PVA rejeita** |
| CFOP "não gera SPED" | `JOIN CFOP ON C.CODCFOP = NP.CFOP AND NAO_GERA_SPED='N'` pelo **CFOP do item** (dfm:2658): a NF entra se ≥1 item passa | `NOT EXISTS cfop … nf.cfop` pelo **CFOP do cabeçalho** (242), mais o filtro por item (249) | só o CFOP 2949 tem a flag; 2 NFs, as duas "puras" (cabeçalho e item 2949) → mesmo resultado hoje | baixa (diverge em NF mista) |
| NF sem item | cai (JOIN acima) | entra, e sai C100 regular sem C190 | 0 NFs em 2026 | baixa hoje |
| Endereço do parceiro | NF sem `CODPARCEIRO_END` válido cai (INNER JOIN, pas:4330) | não filtra | 0 NFs em 2026 | = hoje |
| Cancelada/denegada/inutilizada | entra só com o cabeçalho (pas:2341-2375) | entra só com o cabeçalho (423-429) | S 55 `CANCELADA='S'/'C'`: 16 | = (ver campos no §6) |
| NFC-e (mod 65) | **GeraNFC** (pas:3212-…, QryNFC dfm:8824) + **GeraNFInutilizadas** (pas:2236-2303, `NFE_INUTILIZADA`, só `TIPONF='NFCE'`) | **não emite** (só lê a tabela `nf`; NFC-e mora em NFC/VENDAS) | ago/2026: 44.264 NFC-e autorizadas; inutilizações 2026: 21.807 números | **Colateral alto** (fora do escopo 55/1/1B) |
| Limite | — | `limit(5000)` (244), corte silencioso | ~750 NFs/mês | baixa (período longo trunca) |

Prova com o último SPED real: das 293 NFs em `NFAUXSPED` (empresa 2, ago/2026), a lógica do `adqNF` seleciona 292. A excluída é a NF 161153 (CFOP 2949, item único 2949).

---

## 3. Quando o C170 é emitido

**Legado**, Uspedfiscal.pas:2707-2709:
```pascal
if (ckbC170Saidas.Checked) or
   (not((dmSpedFiscal.cdsNFMODELO.AsString = '55') and (dmSpedFiscal.cdsNFTIPOEMISSAO.AsInteger = 0))) then
```
Com o padrão, **nenhuma NF modelo 55 de emissão própria (TIPOEMISSAO=0) tem C170, seja entrada ou saída.** Dentro do bloco:
- ramo A (pas:2751-2835): `TIPOEMISSAO='1'` (terceiros) ou (`'0'` e saída);
- ramo B (pas:2838-2934): `TIPOEMISSAO='0'` e entrada (entrada própria não-55), com o C176 travado;
- TIPOEMISSAO diferente de 0/1: nenhum C170. Não ocorre em 2026: só há 0 e 1.

O C190 sai sempre (pas:3108-3193).

**Apollo**: emite C170 sempre (ICMS.ts:453). O docstring diz que só a saída própria é suprimida (ICMS.ts:67-69), mas a regra do legado **independe do TIPO**.

**Volume**: 695 saídas mod 55 próprias e **11 entradas mod 55 próprias** em jan-ago/2026 recebem C170 no Apollo e não no legado.

**Gravidade**: o conteúdo diverge do legado. O Guia Prático dispensa o C170 da NF-e de emissão própria; se o PVA rejeita não foi determinado. Com os bugs de CST/QTD/ALIQ, esses 706 C170 também saem errados.

---

## 4. C170 campo a campo (ICMS-IPI, opções padrão)

Os itens vêm de `adqNFprod` (UdmSpedFiscal.dfm:2867-3300), ramo não-decomposto dfm:2900-3021. `GET_CONFIG_DECOMPOSICAO` = **'N'** em produção, então o ramo de decomposição não participa. Campos gravados em Uspedfiscal.pas:2769-2834 (ramo A) e 2868-2933 (ramo B, idêntico). Apollo: ICMS.ts:453.

| # | Campo | Legado (fonte) | Apollo (ICMS.ts) | Dado / efeito | Gravidade |
|---|---|---|---|---|---|
| 2 | NUM_ITEM | contador por NF sobre cdsNFprod (pas:2705/2771), sem ordem garantida (dfm `ORDER BY NF.CODNF`) | `++nro` na ordem de `nroitem` (250/453) | — | cosmético |
| 3 | COD_ITEM | `CODPRODUTO` (PLU padrão; pas:2772-2773) | `codproduto` | — | = |
| 4 | DESCR_COMPL | `TRIM(NP.DESCRICAO)`, a descrição **da nota** (dfm:2909) | `produtos.descricao` | 638 itens diferem em 8 meses | cosmético |
| 5 | QTD | **`NP.QUANTIDADE * NP.FATOREMBAL`** (dfm:2910) | `quantidade` (3 casas) | 49% dos itens de entrada têm fator ≠ 1 (CX→UN ×6/×12/×24; KG ×20). Ago/2026: Σ 128.089 no Apollo contra 311.920 no legado | **quantidade errada** (alta; não rejeita) |
| 6 | UNID | `TRIM(P.UNIDADE)` do produto (dfm:2982) | `produtos.unidade` | = (mas incoerente com o QTD do Apollo) | = |
| 7 | VL_ITEM | `CAST(QTD×VRCUSTO AS NUMERIC(13,2))` (dfm:2912; pas:2784) | `r2(vrcusto×quantidade)` (445) | — | = |
| 8 | VL_DESC | `CAST(VRDESCPROD AS NUMERIC(13,4))` (dfm:2914; pas:2787) | `vrdescprod` | — | = |
| 9 | IND_MOV | `mfSim` | `'0'` | — | = |
| 10 | **CST_ICMS** | `FormatFloat('000', CST)` (pas:2789; `'049'` com chkCST49) | `origem_estoque[0] + pad2(cst)` (443) → `E00` | ORIGEM_ESTOQUE `'E '` 100%; CSTs 0/10/20/40/41/60/70/90/102/201 | **O PVA rejeita** |
| 11 | CFOP | `NP.CFOP` | `cfop` | — | = |
| 12 | COD_NAT | `''` | `''` | — | = |
| 13 | VL_BC_ICMS | `VRBASECALCULO` **zerado** se PROC_CUPOM='S', x933/x556, x101/x102 com CST 40/90, ou ALIQUOTA que não começa com `T` e ≠ `STB` (dfm:2961-2975). Mais: x929 só com chk5929ZeradoC170 (pas:2711-2723), e entrada de fornecedor `CLASSFISCAL='SN'` (pas:2725-2731) | `vrbasecalculo`, zerado só no x929, **sempre** (448-449) | ver §4.1 | **valor errado** |
| 14 | ALIQ_ICMS | **`ICME`** com a mesma zeragem (dfm:2918-2934) | **`icms`** (451) | ICMS≠ICME em 19.974 itens de entrada (1.845 com ICMS). Ex.: T03, ICMS 18, ICME 1,86, BC 886,23, ICMS 16,48 | **valor/agrupamento errado** |
| 15 | VL_ICMS | `VRICM` com a mesma zeragem (dfm:2941-2955) | `vricm` (x929=0) | §4.1 | **valor errado** |
| 16-18 | VL_BC_ICMS_ST / ALIQ_ST / VL_ICMS_ST | 0 / 0 / `VRICMST` só com chkGerarICMSST → **0** (pas:2795-2814) | 0 / 0 / 0 | — | = |
| 19 | IND_APUR | `iaMensal` | `'0'` | — | = |
| 20 | CST_IPI | `CstIpiToStr(stipiVazio)` → **vazio** (pas:2798) | `'49'` entrada / `'99'` saída (444) | — | cosmético (IND_ATIV=1) |
| 21-23 | COD_ENQ / VL_BC_IPI / ALIQ_IPI | `''` / 0 / 0 | `''` / 0 / 0 | — | = |
| 24 | VL_IPI | `VRCUSTO(total) × NP.IPI / 100` (pas:2810-2813) | `vripi` (= `NF_PROD.IPI_NOTA` pelo ETL, extrair.py:229-236) | o ETL prova que qtd×vrcusto×ipi/100 = IPI_NOTA | = (centavos) |
| 25 | CST_PIS | `CST_PIS_ENT` da query = entrada: `COALESCE(PC.CST_PIS_ENT,98)`, saída: `COALESCE(PC.CST_PIS_SAI,04)` da **PISCOFINS do produto** (dfm:2985-2987; pas:2817) | `nf_prod.cstpiscofins`, senão `vrpise>0 ? '50' : '99'` (440-441) | CSTPISCOFINS NULL em ~100%. Entradas no legado: 50 (24.140), 73 (21.607), 70 (8.019), 98 (900)… O Apollo emite 50/99 | informativo no ICMS-IPI (média) |
| 26 | VL_BC_PIS | entrada: `VRCUSTO − DESCONTO` (= qtd×vrcusto − vrdescprod); saída: **0** (pas:2736-2742, 2818) | `bcpiscofinse` (para E **e** S) | BC gravada Σ 2,50 mi contra 17,77 mi no legado (entradas, 8 meses); 1.500 itens de saída têm BC gravada | informativo |
| 27 | ALIQ_PIS | entrada: `PC.ALIQ_PIS_ENT`; saída: 0 (pas:2733/2819) | `aliqpise` | — | informativo |
| 29 | VL_PIS | entrada: base×alíq/100 (o ACBr arredonda); saída: 0 (pas:2744-2745/2822) | `vrpise` | Σ 36.642,28 gravado contra 83.267,46 recalculado pelo legado (entradas, 8 meses) | informativo |
| 30-35 | COFINS | espelho, com `CST_COFINS_ENT`/`ALIQ_COFINS_ENT` (dfm:2989-2991; pas:2823-2828) | espelho, com **o mesmo CST do PIS** (`cstPc`) | — | informativo |
| 36 | COD_CTA | `''` | `''` | — | = |
| 37 | VL_ABAT_NT | 0 (pas:2830) | `''` | — | cosmético |

Formatação do ACBr (casas de QTD; CST_PIS de 1 dígito, já que o CAST para `NUMERIC(10)` + `.AsString` gera `'4'` para 04): **não determinado**, sem o fonte do ACBr. Conferir no `.txt` real de ago/2026.

### 4.1 O ICMS que o legado zera (itens de NF ≠ 65, não canceladas, jan-ago/2026)

| Motivo (ordem do CASE, dfm:2920-2930) | Entradas: itens / Σ VRICM | Saídas: itens / Σ VRICM |
|---|---|---|
| mantém (`T%` ou `STB`) | 10.935 / 155.920,23 | 4.519 / 5.583,16 |
| 1 PROC_CUPOM (CFOP 1403, 1411, 5929 em produção) | 35.093 / **1.095,04** (todos 1403) | 2.052 / 3,07 (5929) |
| 2 x933/x556 | 1.859 / **12.445,67** | — |
| 3 x101/x102 com CST 40/90 | 6.691 / **5.356,96** | 2 / 0 |
| 4 alíquota que não é T/STB (IST: 100 itens; NTB: 1) | 171 / **9.258,12** | 1.122 / 202,03 |

**Σ zerado nas entradas: R$ 28.155,79 em 8 meses.** É o crédito que o Apollo lança a mais no C170/C190 e, se não houver `apuracao_icms` gravada, no E110 derivado (ICMS.ts:156-166). Se houver apuração gravada, o E110 deixa de bater com o Σ C190 das entradas; se o PVA acusa essa consistência não foi determinado.

`NF.STEXTERNO` é `'N'` ou NULL em 100% de 2026, então a regra `VRICMST=0 se STEXTERNO='S'` (dfm:2979) é inócua no dado atual. Fornecedores SN: 7 NFs, todas com ICMS 0, então a regra SN é inócua hoje.

---

## 5. C190

**Legado**: `adqAnaliticoNF` (UdmSpedFiscal.dfm:3301-3476) mais a gravação em Uspedfiscal.pas:3108-3193.
- **Chave** = `CODNF, CST, CFOP, ICME` (o ICME **já zerado** pelas mesmas regras), dfm:3476.
- Tem `JOIN CFOP … NAO_GERA_SPED='N'` (dfm:3435-3436). Atenção: o C170 **não** tem esse filtro (o ramo 1 do adqNFprod usa `LEFT JOIN CFOP`, dfm:3010), então no legado um item 2949 de NF mista sai no C170 e não no C190.

**Apollo**: chave `cstIcms|cfop|aliq(icms, 0 se x929)` (ICMS.ts:454), gravação em 464.

| Campo | Legado | Apollo | Gravidade |
|---|---|---|---|
| CST_ICMS | `FormatFloat('000', CST)` (pas:3158) | `E`+pad2 | **O PVA rejeita** |
| CFOP | `CFOP` | `cfop` | = |
| ALIQ_ICMS | `ICME` zerado; x929 → 0 (pas:3111-3127) | `icms` (x929 → 0) | **valor/agrupamento errado** |
| VL_OPR | `Σ[(VRCUSTO − VRCUSTO×DESCONTO%/100)×QTD + DEPSACESS + IPI%×base + FRETE%×base + VRICMST(0 se STEXTERNO) + FCP_VALOR_ST]` (dfm:3307-3342). No x929, VALOR (zerado só com CkbTotalDocumentoZerado5929, pas:3118-3121) | `Σ r2(vrcusto×qtd)` (445/456) | **alta**: ago/2026, Σ VL_OPR ≠ VL_DOC em 317/703 entradas no Apollo contra 40/703 no legado |
| VL_BC_ICMS | Σ VRBASECALCULO zerado (dfm:3408-3427) | Σ `vrbasecalculo` (x929 = 0) | **valor errado** (§4.1) |
| VL_ICMS | Σ VRICM zerado (dfm:3388-3406) | Σ `vricm` | **valor errado** |
| VL_BC_ICMS_ST / VL_ICMS_ST | 0 / `ICMSST` só com chkGerarICMSST → 0 (pas:3164-3173) | 0 / 0 | = |
| VL_RED_BC | CST 20/70 com 0<BCR<100: `BASERED/(BCR/100) − BASERED`; CST 10/60/90: 0 (pas:3128-3142) | **0** | média. Ago/2026 no legado: ≈ R$ 25.397 (E CST 20), 6.110 (S CST 20), 93 (E 70), 97 (S 70) |
| VL_IPI | `Σ CAST(IPI% × (VRCUSTO − desc%)×QTD, 2)` (dfm:3364-3367), exceto com chkSomarIPIemOutrasDesp | Σ `vripi` (IPI_NOTA) | baixa (desconto) |
| COD_OBS | `''` | `''` | = |
| Entrada SN | zera BC/ICMS/ALIQ/RED (pas:3146-3154) | não trata | nula hoje |

⚠️ **Bug do legado a NÃO copiar sem decisão**: `vBcrT` não é zerado para CST fora de {10,60,90,20,70} (pas:3128-3142). Um C190 de CST 00/40/41 **herda o VL_RED_BC do grupo anterior**, inclusive de outra NF: a variável é local do `btnOkClick` e persiste no laço.

---

## 6. C100 campo a campo

**Legado**: ramo regular em Uspedfiscal.pas:2483-2538; ramo x929 zerado em 2447-2480 (só com CkbTotalDocumentoZerado5929); cancelado/denegado/inutilizado em 2341-2375. **Apollo**: regular em ICMS.ts:433; cancelado em 427.

| Campo | Legado | Apollo | Dado / gravidade |
|---|---|---|---|
| IND_OPER | E→0, senão 1 (pas:2485) | `tipo='S'?1:0` (416) | = |
| IND_EMIT | `TIPOEMISSAO` (coalesce '0') ='0' → 0, senão 1 (pas:2486; dfm:2624-2625) | idem (417) | = · no cancelado o legado força **0** (pas:2348); o Apollo calcula |
| COD_PART | **`PE.CODEND`** (endereço da NF, dfm:2650), igual ao 0150 do legado (sqqParceiros `E.CODEND AS COD_PART`) | `codparceiro` (433), igual ao 0150 do Apollo (364) | numeração diferente, mas coerente dentro do arquivo · ver colateral 0150 no §9 |
| COD_MOD | ≠90 → `FormatFloat('00')`, 90 → `'1B'` (pas:2488) | idem (418) | = |
| COD_SIT | `GetCodSit` (pas:2149-2170): CANCELADA='S'→02; STATUSNFE D→04; I→05; **série 890-899 → 08** (sobrepõe as anteriores) | `cancelada='S' ou statusnfe='C'`→02; D→04; I→05; senão 00 (423) | **23 entradas série 890** em 8 meses: 08 no legado, 00 no Apollo (média; exigência do PVA para NF-e avulsa não determinada). `statusnfe='C'` sem `CANCELADA='S'`: 0 casos hoje |
| SER | `ConcatenaLeft(Trim(SERIE),3,'0')` (pas:2490) | `trim(serie)` (419) | SERIE é CHAR(3) já com zeros ('001') em produção → = no dado migrado; NF nascida no Apollo com '1' sai diferente (baixa) |
| NUM_DOC | `NRONF` | `nronf` | = |
| CHV_NFE | `CHAVENFE` | `chavenfe` | = |
| DT_DOC / DT_E_S | `DTEMISSAO` / `DTCONTABIL` (pas:2493-2494) | idem | = |
| VL_DOC | `TOTALNF` (pas:2495) | `totalnf` | = |
| IND_PGTO | CFOP do **cabeçalho** em (1910, 2910, 5929, 6929) → `tpOutros`, senão `tpPrazo` (pas:2421-2427, 2496) | `'1'` fixo | 510 NFs em 8 meses (161×1910, 11×2910, 333×5929, 5×6929). Supõe-se `tpOutros`='2', mas o enum do ACBr **não foi determinado** · baixa |
| VL_DESC | `TOTALDESC + ABS(TOTALDESCFINAL)` (dfm:2612) | `totaldesc` | 2 NFs / R$ 10,27 · baixa |
| VL_ABAT_NT | 0 | 0 | = |
| VL_MERC | `Σ CAST(VRCUSTO×QTD,2)` dos itens com CFOP que gera SPED (dfm:2615); +ST+IPI só com chkDestacar… (pas:2501-2506) | `nf.totalprod` | difere em 6 NFs de entrada e 60 de saída (centavos) · baixa |
| IND_FRT | `TIPOFRETE` 0/1/2/3/4/9 (pas:2508-2515); fora disso fica o default do ACBr (não determinado) | `tipofrete ?? '9'` | 1 entrada com TIPOFRETE NULL · baixa |
| VL_FRT / VL_SEG | `TOTALFRETE` / `TOTALSEGURO` | idem | = |
| VL_OUT_DA | `TOTALACESSORIAS` (+IPI/ST/FCP-ST com as flags, desligadas) (pas:2431-2445) | `totalacessorias` | = |
| VL_BC_ICMS | `SUM(VRBASECALCULO)` agregado (`TAggregateField`, dfm:636-647) sobre os itens **já zerados**; 0 se o 1º item for x929; 0 se entrada SN (pas:2383-2402, 2519) | Σ `vrbasecalculo` **cru** (433), enquanto o C190 do Apollo zera o x929 | **valor errado** (§4.1). O Apollo quebra C100=ΣC190 na 1 NF 5929 com ICMS (R$ 3,07) |
| VL_ICMS | idem, `SUM(VRICM)` (pas:2520) | Σ `vricm` cru | idem |
| VL_BC_ICMS_ST | 0 | 0 | = |
| VL_ICMS_ST | `TOTALICM_ST` (0 se STEXTERNO) só com chkGerarICMSST → 0 (pas:2530) | 0 | = |
| VL_IPI | `N.TOTALIPI` (pas:2531) | Σ `vripi` | Σ bate em 3.469/3.471 NFs (ETL) · baixa |
| VL_PIS / VL_COFINS | `Σ CAST((qtd×vrcusto − qtd×vrcusto×DESCONTO%/100) × PC.ALIQ_PIS_ENT/100, 2)` para **qualquer TIPO**, inclusive saída com alíquota de **entrada** (dfm:2636-2646) | Σ `vrpise`/`vrcofinse` | informativo · legado incoerente (C170 de saída = 0) |
| VL_PIS_ST / VL_COFINS_ST | 0 | 0 | = |
| **Cancelado/denegado/inutilizado** | IND_EMIT=0, COD_PART='', `DT_DOC=DT_E_S=DT_INI`, valores 0, `IND_PGTO=tpNenhum`, `IND_FRT=9`; CHV sempre, porque `vTipoSitucao` nunca vale '05' (pas:2345-2374, 2354). O que o ACBr grava (se esvazia os campos) é **não determinado** | só REG…DT_DOC; **DT_DOC = dtemissao** preenchido; demais vazios (427) | o Guia manda DT_DOC vazio para 02/03/04 · média (16 canceladas em 8 meses) |

---

## 7. Registros filhos do C100 no legado

| Registro | Condição no legado | Produção 2026 | Apollo |
|---|---|---|---|
| C101 (DIFAL/FCP) | NF em `sqqC101` com `vTotICMSUFDest>0 AND vTotICMSUFRemet>0` (dfm:8083-…; pas:2542-2551) | **0 NFs** | não emite → = |
| C110 (+0450) | NF com OBS não vazia, ou entrada com ST>0 (`sqqObsNF_Reg0450`, dfm:4134-4210; pas:2553-2569) | ago/2026: 609/705 entradas e 56/56 saídas com OBS | **não emite** · média (informação complementar) |
| C113 | dentro do bloco do C110, com `chkGerarC113C114` (**marcada**): `NF_REFERENCIA` (dfm:7877-…; pas:2572-2599) | ago/2026: 25 E e 27 S com referência | **não emite** · média (a devolução exige o documento referenciado) |
| C114 | cupom referenciado na OBS / devoluções (pas:2601-2662) | não medido | não emite |
| C140/C141 | `ckb140Saidas` (desmarcada) | — | = |
| C176 | travado (pas:4189-4196) | — | = |
| C191 | `chkC191` (desmarcada) | 45 entradas com FCP-ST em ago/2026 | = (no padrão) |
| C195/C197 | só entrada com C170, `EMPRESAS.COD_AJUS_SN/IPI/ICMS_ST > 0` (pas:2977-3103) | **COD_AJUS_* NULL em todas as empresas** (1, 2, 50, 51, 52) | não emite → = (confirma o docstring ICMS.ts:48). As colunas `COD_AJ_SN/COD_AJ_IPI/COD_AJ_ICMSST` usadas no fonte **não existem** na EMPRESAS de produção (ORA-00904), sinal de que o binário novo mudou esse trecho |

---

## 8. EFD-Contribuições C170 (UspedPisCofins.pas × PC.ts)

**Legado**: `FDqNF` (UdmSpedPisCofins.dfm:1758-1990), `FDqNFprod` (dfm:2210-2856), C100 em UspedPisCofins.pas:882-916, C170 em 933-986.

| Ponto | Legado | Apollo (PC.ts) | Gravidade |
|---|---|---|---|
| CST_ICMS | `GetCstIcms(CST, empresa SN)` (pas:958; função em 2035-2145), equivalente a `FormatFloat('000',CST)` | `origem_estoque[0] + pad2(cst)` (426) → `E00` | **erro de leiaute** (valor fora da tabela) |
| QTD | **`NP.QUANTIDADE` sem fator** (dfm:2295; pas:953), com `UNID = P.UNIDADE` (dfm:2519) | `quantidade` | **= legado** (os dois têm incoerência de unidade; aqui não mexer) |
| VL_ITEM | `CAST(QTD×VRCUSTO,2)` (dfm:2296) | `r2(vrcusto×qtd)` (409/411) | = |
| VL_DESC | **`NP.DESCONTO`, o percentual** (dfm:2297; pas:956). Bug do legado: ex. NF 159457 com 54,93 em vez de R$ 6.689,76 | `vrdescprod` (429) | Apollo "certo" × legado com bug → **decisão do usuário** |
| CST_PIS/CST_COFINS | um único `vCstPisCofins` = saída `CST_COFINS_SAI` / entrada `CST_COFINS_ENT`, usado nos **dois** (pas:946/973/977), com CASE: entrada, CFOP devolução/bonificação → 74; 1202/2202/1411/2411 com CST_PIS_ENT 60 → 50; PF/produtor com CST de crédito ou CFOP fora de `PC_CONFIG` (18 CFOPs) → 74; senão PISCOFINS. Saída: 5927/5929 → 08; CFOP de venda ou em PC_CONFIG → PISCOFINS; senão 08 (dfm:2375-2454) | `cstpiscofins` (NULL) → `'50'`/`'01'`/`'99'` (424-425) | **alta**: ago/2026 entradas, legado×Apollo: 73×99 (2.699), 50×50 (2.217), 70×99 (888), 74×99 (434), **50×99 (433; PIS 4.728→0)**, **74×50 (156; PIS 0→705)** |
| VL_BC_PIS / VL_PIS | `BASECOFINS` = (qtd×vrcusto − vrdescprod) + desp. acessórias + seguro% + frete% − ICMS (se `GET_CONFIG_ABATER_ICMS_PC='S'` e saída) (dfm:2496-2507); `VL_BC=0` se alíq 0; `VL_PIS = round(base×alíq/100,2)` (pas:974-976) | entrada: `bcpiscofinse`/`vrpise` gravados; saída: recalculado de `aliqpiss` (403-412) | **alta** (valor do crédito) |
| ICME/VRICM/BC | só PROC_CUPOM e `ALIQUOTA` que não começa com `T` zeram. **STB não mantém**, ao contrário do ICMS-IPI (dfm:2455-2490); x929 → 0 (pas:961-963) | crus (429) | média |
| CST_IPI | 49/99 pelo 1º dígito do CFOP (pas:968) | 49/99 (427) | = |
| VL_IPI | 0 (pas:972) | 0 | = |
| COD_CTA | `PLANO_CONTAS.CODIEXPANDIDO` do CFOP (pas:982) | `''` | média (o legado preenche; se o PVA aceita vazio não foi determinado) |
| Seleção | `MODELO NOT IN (22,21,6,2,57,7,8,3)` (dfm:1900; inclui 28/29!); `NRONF<>'0'`; com `ckbGera5929` (**desmarcada**), `AND NP.CFOP NOT IN (5929,6929)` (pas:710-711) | entrada de qualquer modelo + saída 55 (271) → **entram mod 3/7/8** e as NFs **5929/6929** (338 NFs em 8 meses) | **o PVA rejeita** COD_MOD 03/07/08 no C100 · 5929/6929 duplicam receita já escriturada no C175 (média-alta) |
| C100 COD_PART | **`PE.CNPJ_CPF`** (pas:888), igual ao 0150 do legado Contribuições (`COD_PART := CNPJ_CPF`, pas:478) | `codparceiro` | coerente dentro do arquivo · cosmético |
| C100 COD_SIT | `GetCodSitNF`: 1º item com '929' ou `FISCO_EMIT_CNPJ` preenchido → `sdfEspecial` (08) (pas:1974-1985) | 00 | média |

---

## 9. Colaterais (fora do escopo C100/C170/C190, mas bloqueantes)

1. **0150 sem documento** (ICMS.ts:257-263, 364; PC.ts:293-299, 358): o join `parceiros_end.endereco_padrao='S'` não encontra nada em 329 dos 332 endereços usados nas NFs de 2026 (Oracle ENDERECO_PADRAO NULL; só 3 com 'S'). O 0150 sai com CNPJ/CPF, COD_MUN, ENDEREÇO e BAIRRO vazios, e o PVA rejeita. Correção mínima: pegar o endereço **da NF** (`nf.codparceiro_end`), como o legado (sqqParceiros `LEFT JOIN PARCEIROS_END E ON E.CODEND = NFAUXSPED.CODPARCEIRO_END`); como fallback, o menor `codend` do parceiro. Em produção cada parceiro tem 1 endereço (331/332), então COD_PART por `codend` ou por `codparceiro` não muda o conteúdo.
2. **Bloco D existe no legado** (Uspedfiscal.pas:516-672, chamado em 4149): D100/D190 para os modelos 7/8/9/10/11/26/27/57 (sqqNFfrete, UdmSpedFiscal.dfm:6751-6773, **sem filtro de PROC**) e D500/D590 para os modelos 21/22 (sqqNFtelecomunicacao, dfm:5268-5288). O docstring de ICMS.ts:57-59 e 407-411 está errado. Em 2026 há 11 NFs mod 7/8.
3. **NFC-e e inutilizações de NFC-e ausentes no EFD ICMS-IPI** do Apollo (§2). Com a apuração gravada, o E110 (débitos) não bate com Σ C190; sem ela, o débito fica ~95% menor.

---

## 10. Divergências em que o legado está errado (decisão do usuário, não copiar em silêncio)

- `vBcrT` herdado entre grupos do C190 (pas:3128-3142).
- Item com CFOP `NAO_GERA_SPED` sai no C170 e não no C190 (dfm:3010 × 3435). No C100, `VL_MERC` o exclui e `VL_BC_ICMS` o inclui.
- C100 `VL_PIS/VL_COFINS` de saída calculado com alíquota de **entrada** (dfm:2636-2646), enquanto o C170 de saída sai com 0 (pas:2818-2828).
- C190 `VL_OPR` trata `NP.FRETE` e `NP.DESCONTO` como **percentuais** (dfm:3321-3336). Na NF 159881 o frete somado pela fórmula (≈ R$ 346) não bate com `TOTALFRETE` = 68,28; é provável causa de parte dos 40/703 C190≠VL_DOC do próprio legado.
- Contribuições: `VL_DESC` = percentual (pas:956).
- Contribuições: CST_PIS recebe o CST de **COFINS** (pas:946/973).

---

## 11. Cortes propostos (do menor para o maior risco)

| Corte | Mudança no Apollo | Risco | Efeito |
|---|---|---|---|
| **A — formatação** | A1 `CST_ICMS = String(nn(it.cst)).padStart(3,'0')` em ICMS.ts:443 e :495 e PC.ts:426 (ignorar `origem_estoque`, como o legado; decidir à parte a NF nascida no Apollo, onde `nfe-item-importacao.ts:109` grava a origem do XML em `origem_estoque`) · A2 `SER` com `padStart(3,'0')` (419/427) · A3 `DESCR_COMPL = trim(nf_prod.descricao)` (incluir `descricao` no select 248) · A4 ICMS-IPI `CST_IPI = ''` (444) · A5 C100 cancelado/denegado com `DT_DOC` vazio (427), conforme o Guia | mínimo | tira o bloqueio nº 1 do PVA |
| **B — colaterais de cadastro** | 0150 pelo endereço da NF (`nf.codparceiro_end`), ICMS.ts:257-263 e PC.ts:293-299 | baixo | tira a rejeição do 0150 |
| **C — seleção** | C1 C100 só com `modelo NOT IN (2,3,7,8,57)` (além de 6/28/29 e 21/22), nos dois arquivos · C2 excluir modelo 55 com `chavenfe IS NULL AND coalesce(statusnfe,'P')<>'I'` · C3 filtro CFOP pelo **item** (`EXISTS nf_prod ⋈ cfop gera`) em vez do cabeçalho · C4 Contribuições: excluir itens 5929/6929 por padrão (flag = `ckbGera5929`) | baixo-médio | tira as rejeições de COD_MOD/CHV |
| **D — quando sai o C170** | não emitir C170 se `modelo=55 AND tipoemissao='0'` (E e S), com flag de configuração "C170 emissão própria" desligada por padrão (`ckbC170Saidas`) | baixo-médio | 706 NFs em 8 meses deixam de ter C170 |
| **E — C100 derivados** | E1 `IND_PGTO='2'` se o CFOP do cabeçalho ∈ {1910, 2910, 5929, 6929} (confirmar no `.txt`) · E2 `VL_DESC = totaldesc + abs(totaldescfinal)` · E3 `COD_SIT='08'` para série 890-899 · E4 `VL_MERC = Σ round(qtd×vrcusto,2)` dos itens que geram SPED · E5 `VL_BC_ICMS/VL_ICMS = Σ` dos itens **após** a regra do corte F | médio | valores do cabeçalho iguais aos do legado |
| **F — ICMS por item** | F1 zeragem (PROC_CUPOM → x933/x556 → x101/x102 com CST 40/90 → mantém se `aliquota LIKE 'T%' OR ='STB'`, senão 0) em BC/ALIQ/VL_ICMS do C170, C190 e C100 · F2 `ALIQ_ICMS = icme` (C170 e chave do C190) · F3 x929 no C170 só com flag (padrão: não zera) · F4 `VL_RED_BC` para CST 20/70 com 0<bcr<100 (sem herdar o vBcrT) · F5 entrada de fornecedor SN zera ICMS | **médio-alto** | −R$ 28,1 mil de crédito em 8 meses; muda E110 derivado |
| **G — QTD** | ICMS-IPI `QTD = quantidade × coalesce(fatorembal,1)` (a Contribuições **não**, para ficar igual ao legado) | médio-alto | 49% dos itens de entrada; reflexo em 0220/bloco H/K a revisar |
| **H — VL_OPR do C190** | fórmula do legado (dfm:3307-3342), ou uma que feche com VL_DOC (decisão do usuário, já que o legado erra em 5,7%) | alto | Σ C190 = VL_DOC |
| **I — PIS/COFINS no C170 do ICMS-IPI** | CST pela PISCOFINS do produto (E: `cst_pis_ent` default 98; S: `cst_pis_sai` default 04), 2 dígitos; base/alíquota/valor recalculados só na entrada, 0 na saída; COFINS com o próprio CST | médio (campo informativo) | informativo |
| **J — Contribuições C170** | CST pelo CASE de CFOP/PC_CONFIG/TIPOFJ (dfm:2375-2454); `BASECOFINS` + `round(base×alíq/100,2)`; `COD_CTA` do CFOP; decisão sobre `VL_DESC` (% do legado × valor) | **alto** (crédito de PIS/COFINS) | valor de crédito |
| **K — completude** (colaterais) | NFC-e mod 65 + inutilizações no ICMS-IPI (GeraNFC/GeraNFInutilizadas); D100/D190 para 7/8/57 | alto (épico próprio) | débito de ICMS / bloco D |

## 12. Não determinado (e por quê)

- Formatação do writer ACBr (QTD, CST_PIS de 1 dígito, esvaziamento dos campos de documento cancelado, valor dos enums `tpOutros`/`tfNenhum`): o fonte do ACBr não está no disco. Resolver com o `.txt` de ago/2026 da empresa 2, gerado em 17/09/2026.
- Opções que o operador marca de fato: não são persistidas.
- `AjustaBaseDeDadosSPED`: fonte ausente, só o hint.
- Se o PVA trata como **erro** ou **aviso**: Σ C190.VL_OPR ≠ VL_DOC, C100.VL_ICMS ≠ Σ C190, COD_SIT 08 da série 890, C170 em NF-e própria e VL_RED_BC=0 com CST 20.
- Se o binário novo passou a usar `NF_PROD.VRPISE/BCPISCOFINSE/CSTPISCOFINS` no SPED: o fonte de 2020 não usa (esses campos só aparecem em uNF.pas:12182-12188, na devolução). CSTPISCOFINS vazio em ~100% sugere que não.

## Status (25/09/2026)

| Corte | Status |
|---|---|
| A — formatação (CST 3 dígitos, SER 3 dígitos, DESCR_COMPL da nota, CST_IPI vazio, cancelado só com o cabeçalho) | ✅ ICMS-IPI (`sped-c-legado.ts`) · ✅ Contribuições |
| B — 0150 pelo endereço da NF | ✅ ICMS-IPI · ✅ Contribuições (COD_PART = CNPJ/CPF, como o legado; sem endereço na nota, o primeiro do parceiro) |
| C — seleção (02/03/07/08/57 fora, 55 sem chave fora, CFOP pelo item) | ✅ ICMS-IPI · ✅ Contribuições (modelos 22/21/6/2/57/7/8/3 fora, nota só com 5929/6929 fora, entrada e saída de todos os tipos) |
| D — C170 fora da NF-e própria | ✅ |
| E — C100 derivados (IND_PGTO, VL_DESC, COD_SIT 08 série 890, VL_MERC, VL_BC/VL_ICMS dos itens zerados, VL_PIS/COFINS) | ✅ |
| F — ICMS por item (zeragem, ICME, x929 só no C190, VL_RED_BC sem herdar, SN) | ✅ |
| G — QTD × FATOREMBAL (só ICMS-IPI) | ✅ |
| H — VL_OPR do C190 (fórmula do legado) | ✅ |
| I — PIS/COFINS no C170 do ICMS-IPI (PISCOFINS do produto) | ✅ |
| J — Contribuições C100/C170 (`sped-pc-legado.ts`: CST e alíquota pelo CASE de CFOP/PC_CONFIG/TIPOFJ, BASECOFINS, ICMS só 'T…' fora do PROC_CUPOM, x929, COD_CTA do CFOP, PIS/COFINS do C100 pela conta do cabeçalho, COD_SIT 08, VL_DESC do C100 com o desconto final; mig 358 com ABATER_ICMS_BASE_CALCULO_PIS_COFINS e CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL) | ✅ smoke §252 + unit. **Não copiado** (§10): o VL_DESC do C170 em % (bug do legado) — sai o valor do desconto |
| K1 — NFC-e (C100 65 sem participante + C190, das VENDAS — a NFC do PDV não migra; NRONF = cupom e TOTALNF = produtos − descontos + acréscimos em 100% na produção) e as inutilizações (NFE_INUTILIZADA, um C100 05 por número, 65/55) no ICMS-IPI; o E110 derivado soma o débito da NFC-e; mig 359 | ✅ smoke §253 |
| K2 — bloco D (D100/D190 do frete 7/8/9/10/11/26/27/57, sem filtro de processada; D500/D590 da telecomunicação 21/22, processadas; os participantes no 0150). **Não copiado** (§10): o VL_RED_BC = média do BCR (percentual no campo de valor) — D190 com a regra do C190, D590 0. COD_PART = codparceiro (como o 0150 do Apollo; o legado usa o CODEND) | ✅ smoke §254 (+ §240 com o 07 no D100) |

Decisões registradas (legado errado, não copiado): VL_RED_BC herdado do grupo anterior → 0. Copiado com nota: C100 VL_PIS/VL_COFINS
com a alíquota de ENTRADA em qualquer tipo (dfm:2636-2646); item com CFOP que não gera SPED sai no C170 e não no C190.
