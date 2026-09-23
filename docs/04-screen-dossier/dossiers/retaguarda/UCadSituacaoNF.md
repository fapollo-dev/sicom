# Dossiê de Tela — SITUAÇÃO DO DOCUMENTO — `FRMCADSITUACAONF` (`UCadSituacaoNF`)

| Campo | Valor |
|---|---|
| **Status** | RECON (23/09/2026). A tela não estava na fila nem no placar: o Apollo tinha só uma API de consulta com 2 campos (`situacao-nf.crud.ts`), sem tela. 656 acessos, usada até 17/09/2026. |
| **Fontes** | `UCadSituacaoNF.pas` (1.694) + `UdmCadSituacaoNF.pas/.dfm` + `uRdmCadSituacaoNF` (`TfrmCadSituacaoNF = class(TfrmCadMasterDet)`). |
| **Produção** | 194 situações (103 E · 90 S · 1 T, a 2020 F03), todas ATIVO='S'. |

## 1. A tela
Abas: Principal · Configurações de estoque · CFOP · Centro de custo · Parceiros · Outras configurações.
- **Principal**: Descrição, Tipo de operação, Tipo E/S; a grade "Plano de contas" é a ITENS_INTEGRACAO_CONTABIL (sempre 1 D + 1 C).
- **TIPO_OPERACAO tem 53 códigos** (dfm:124-231: E01-E03, F01-F28, O01, I01-I20, T01; a produção tem também A01, do binário
  novo, usado pela agenda de promoção) — a SITUACAO_NF é também o catálogo das operações contábeis (`DIARIO.CODOPERACAO`).
  `SetTipoOperacao` (pas:1445-1566) força o TIPO por operação, mostra/esconde as abas (CFOP/estoque só E01/E03, CFOP só T01;
  outras configurações só E01/F04/F05; CC/parceiros por operação) e força conta Fixa para O01/I*/F23/F24/F28/E02/E03.
- **Validações**: descrição e tipo de operação obrigatórios; itens contábeis = exatamente 2 (1 C + 1 D), com tipo, natureza,
  conta (salvo Automática) e histórico; CFOP existe, `CFOP.TIPO = situação.TIPO`, sem repetir na mesma situação (a checagem
  entre situações está comentada, :1652-1664); CC e parceiro obrigatórios, com DTCADASTRO/CODOPERADOR.
- **Excluir**: recusado se a situação está em DIARIO.CODOPERACAO, NF, ARECEBER, APAGAR ou SCRAP (`VinculadoDiario`
  :1668-1692); BTNEXCLUIR; exclusão física (sem INDR).
- **Lookups**: PLC por máscara + TIPO_CONTA (DESPESA se E02; RECEITA para S e DESPESA para E); parceiro FRN (F04) ou CLI/FRN
  (F05); situação financeira F04/F05; forma de pagamento por empresa (operadora só se destino POS/TEF/CRT); contas de baixa
  ANALITICA/EMPRESA; combo de importação por tipo (entrada DE/PD; saída DC/IN/PE/PP/PC/SC/TR/TO/VE).
- **IDs**: `ID_IDSITUACAO_NF` (último 3680, máx. id 3580), `ID_IDISITUACAO_NF` (3160), `ID_CODITEMOPERACAO` (1261). Padrões
  TIPO='E', NAO_REALIZA_INTEGRACAO='N'.
- **LOG**: cabeçalho + ISITUACAO_NF + SITUACAO_NF_PLC + SITUACAO_NF_PARCEIROS (não os itens contábeis) — 138 linhas.
- **RBAC** (produção): FRMCADSITUACAONF, BTNADICIONARREGISTRO, BTNEDITAR, BTNGRAVAR (55 linhas cada), BTNEXCLUIR (36).

## 2. Detalhes e campos na produção
| Tabela | Linhas | Nota |
|---|---:|---|
| ISITUACAO_NF | 148 | 61 situações, 105 CFOPs; 24 CFOPs em mais de uma situação; 4 linhas quebram a regra do tipo (303 com 5911/6911, 8 com 2922, 15 com 5927) |
| SITUACAO_NF_PLC | 333 | 45 situações têm exatamente 1 CC |
| SITUACAO_NF_PARCEIROS | 153 | |
| ITENS_INTEGRACAO_CONTABIL | 224 | 112 situações × 2 |

Campos mortos no dado (194/194 nulos ou nunca preenchidos): EXIGE_PEDIDO_COMPRA, VALIDA_ESTOQUE_DISPONIVEL,
TRANSFERENCIA_MERCADORIAS, PERMITE_BASECALC_MAIOR100 (⚠️ nulo = o bloqueio de BCR>100 está SEMPRE ligado), IDPGTO_NFE,
CODOPERADORAS_NFE, CRED_BAIXA_CR, IDSITUACAO_NF_FINANCEIRO. Vivos: NAO_REALIZA_INTEGRACAO (S em 17), IMPORTACAO_AUTO_NF
(2=DE, 9=VE, 90=SC), DEB_BAIXA_CP (7). Do binário novo: GERAR_CONTAS_RECEBER+DIAS_PRAZO (3220/A01, sem efeito no AR),
ESTOQUE='E ' (3000), EXIGE_SCRAP='N' (2), CODCLASS_TRIB=1 (8).

NFs de 2026: 7.219 em 31 situações; itens 68.745 (68.624 com situação; em 701 linhas de 203 NFs a do item difere da do cabeçalho).

## 3. Quem usa — e o que falta no Apollo
| Regra | Legado | Dado vivo | Apollo |
|---|---|---|---|
| lista de situações da NF só do TIPO e com CFOP | uConsultaSitucaoDocumento.dfm:923-945 | — | FALTA |
| pesquisa de CFOP filtrada pela situação | uNF.pas:2955-2977 | — | FALTA |
| `validaCFOP_SituacaoNF` (cabeçalho; itens se E ou config) | udmNF.pas:7900; uNF.pas:4543, 9563, 14921 | cabeçalho fora: 0 de 7.205 | FALTA |
| situação do item = a do cabeçalho | uNF.pas:1594, 5724, 13699, 16043 | 99,5% | FALTA (`nf_prod.idsituacao_nf` não é gravado) |
| devolução: situação do item pelo CFOP | uNF.pas:7250; uPedidoDevolucaoCompra.pas:362 | 4 CFOPs → 17 | PARCIAL (mig 076) |
| transferência (5152, CFOP.PROC_TRANSF) | uNF.pas:1423; uProcessaNotaFiscal.pas:1636 | 6 situações | FALTA |
| bonificação = CFOP 1910/2910/5910/6910 | udmNF.pas:5325; uLancamentoContabilNF.pas:762 | 5 e 24 | FALTA |
| rateio pré-preenchido pelo CC da situação | udmNF.pas:11027 (uNF.pas:5036/2912); uLancamentoContabilNF.pas:673 | 5.353 de 6.449 NFs de entrada | FALTA |
| CCs permitidos por situação; situação do rateio = cabeçalho/itens | uLancamentoContabilNF.pas:148/230/314 | 6.531/6.531 dentro | FALTA |
| **lançamentos de CAIXA da NF** (F3) e a reversão | udmNF.pas:9266 (:7776), :5011 | **1.011 em 2026, 903 NFs, R$ 764.054,09** | FALTA |
| CC restrito em AP/AR/caixa/scrap | uAPagar.pas:763…; uCadAReceber.pas:538…; uMovCaixa.pas:540; uCadSCRAP.pas:421 | CX_APAGAR: 0 fora | FALTA |
| parceiro restrito em AP/AR/caixa/adiantamento | uAPagar.pas:3555… | AP: 1 fora de 613 | adiantamento ✅; resto FALTA |
| pesquisa por TIPO_OPERACAO (AP F04, AR F05, caixa F06, scrap E02, CFOP I*…) | uAPagar.pas:6506… | — | adiantamento ✅; resto FALTA |
| retenções E03 | udmNF.pas:5356… | 1 situação | ✅ |
| NAO_REALIZA_INTEGRACAO | udmNF.pas:5338; UIntegracaoContabil.pas | S em 17 | PARCIAL |
| editor dos itens contábeis | a grade da tela | 224 | FALTA (só leitura) |
| bloqueio BCR>100 | uItensNF.pas:1563 → udmNF.pas:11593 | sempre ligado | FALTA |
| IMPORTACAO_AUTO_NF | uNF.pas:14396 | 9 (383 NFs), 90, 2 | FALTA |

## 4. Cortes
- **C1 — a tela**: agregado com os 27 campos + os 4 detalhes, a matriz do `SetTipoOperacao`, validações, lookups, guarda
  de exclusão, LOG, RBAC, sequências acima do legado, TIPO 'T', CFOP-tipo validado só em linha nova/alterada; um lookup
  comum com filtros (tipo, tipo_operacao, com_cfop).
- **C2 — NF × CFOP**: pesquisa de situação e de CFOP filtradas, `validaCFOP_SituacaoNF`, `nf_prod.idsituacao_nf`,
  devolução pela ISITUACAO_NF, 5152.
- **C3 — rateio**: pré-preenchimento, CCs permitidos, ADICIONAL da bonificação.
- **C4 — caixa da NF**: `GerarLancamentosDeCaixa` e a reversão (golden: 1.011 linhas / R$ 764.054,09 de 2026).
- **C5 — pesquisas fora da NF**: TIPO_OPERACAO, CC e parceiro em AP/AR/caixa/scrap/CFOP/empresa/pedido.
- **C6 — regras pequenas**: BCR>100, importação automática; declarar mortos os campos acima.

## 5. Riscos
Editar os itens contábeis mexe no motor contábil vivo; `RetornarValores` pega a primeira linha (24 CFOPs em várias
situações; `GerarLancamentosDeCaixa` pega o primeiro CODPLC); udmNF.pas:8300 passa IDNF como IDSITUACAO_NF (defeito);
a nota "CC do faturamento, 396 NFs" da FILA precisa ser reconciliada (o caminho AP-da-NF do fonte não bate com o dado).
