# F5b — Contábil DIÁRIO / partida dobrada (NF) — SPEC do epic dedicado

> **Status:** `especificado, não implementado` (recon golden-backed concluída 2026-06-30). É um **epic de médio porte** porque **funda o razão contábil** (o `DIARIO`/partida-dobrada) que o ERP migrado ainda não tem — um subsistema cross-cutting, não uma refinação local da NF. A F5 (rateio `CODCONTABILNF` como config armazenada, SEM efeito) já está entregue e verde; F5b é o **efeito** (gravar o DIÁRIO + `CONTABILIZADO='S'`), gated por config (default inerte).

## Motor legado (procedência)
- **`UIntegracaoContabil.pas`** — `TIntegracaoContabilNotaFiscal.Integrar` (L703-1084) e `.Estornar` (L346-403). O motor de partida-dobrada `LancaDiarioContabil` vive em package externo (não clonado) → **reconstruir**, confrontando com o `DIARIO` real (888.243 linhas no PINHEIRAO).
- **Tabela alvo = `DIARIO`**: uma linha por (situação, imposto) — `CONTADEBITO`/`CONTACREDITO` (→`PLANO_CONTAS.CODPLANOCONTAS`), `VALOR`, `CODORIGEM`=12(NF), `IDORIGEM`=CODNF, `CODOPERACAO`=IDSITUACAO_NF, `CODEMPRESA`, `CODHIST`, `CODLOTE`(→`LOTE_CONTABIL`), `COMPLEMENTO`, `DATALAN`. Real: 1–7 linhas/NF.
- **Contas** (via `ITENS_INTEGRACAO_CONTABIL`, 214 linhas, exatamente 1 'D' + 1 'C' por CODOPERACAO): `TIPO='F'` (fixa) → `CODCONTA_CONTABIL`; `TIPO='A'` (automática) → crédito = conta do parceiro (`PARCEIROS.CODCONTABIL_FOR` entrada / `CODCONTABIL` saída); débito = ponte gerencial→formal `CODCONTABILNF.CODCC → PLC.CODPLC → PLC.CODCONTABIL → PLANO_CONTAS` (`GetSQLCodContabilNF` L446, só quando `SituacaoDebitoAutomatica` L1086).
- **Linhas de imposto:** ICMS (Σ VRICM dos itens ALIQUOTA 'T*'; situação de `CFOP.SITUACAO_ICMS_{ENTRADAS,SAIDAS}_NF`), PIS/COFINS por CFOP, CMV (só saída, Σ custo×fator×qtd).
- **Disparo:** entrada no **processar** (`udmNF.pas:7778`, se `EMPRESA.INTEGRACAO='AUTOMATICA' and TIPO='E'`); saída no **envio SEFAZ** (`uNF.pas:10946`, saída exige `STATUSNFE='P'`). Elegibilidade (`GetSQLNF` L500-507): `PROC='S'`, `CANCELADA<>'S'`, `TOTALNF>0`, `CONTABILIZADO<>'S'`, `NRONF<>'000000'`, `SITUACAO_NF.NAO_REALIZA_INTEGRACAO<>'S'`. Seta `NF.CONTABILIZADO='S'` (L1021) só se `Result=rOk`.
- **Estorno** (L346-403): `UPDATE NF SET CONTABILIZADO=NULL` + `DELETE FROM DIARIO WHERE CODORIGEM=12 AND IDORIGEM=:codnf`. Disparo: cancelar (`uNF.pas:6808`) e reverter (`uNF.pas:8949`; se `CONTABILIZADO='S'` e empresa NÃO-AUTOMATICA → bloqueia a reversão). `PeriodoFechado`/`CHAVEAMENTO_PERIODO` barra em período fechado.

## Pré-requisitos que NÃO existem no monorepo (o que torna isto um epic)
| Peça | Situação | Oracle real |
|---|---|---|
| `plano_contas` (razão formal) | **ausente** | 11.024 linhas |
| `diario` | **ausente** | 888.243 |
| `lote_contabil` (+`diario.codlote`) | **ausente** | — |
| `itens_integracao_contabil` | **ausente** | 214 (107 situações mapeadas) |
| ponte `plc.codcontabil` | **ausente** no 029 | 197/376 preenchidas |
| `parceiros.codcontabil`/`_for` | existe como `varchar(30)` placeholder (018), sem FK | 97%/69% preenchidas |
| `situacao_nf.nao_realiza_integracao` + `cfop.situacao_{icms,pis,cofins}_{ent,sai}_nf` | **ausentes** | — |

> **Correção ao dossiê:** o `PLANO_CONTAS` formal EXISTE e está cheio no Oracle (11k) — o bloqueio é de *migração p/ Postgres*, não de dado-fonte. Há golden (DIARIO por CODNF) para confrontar a reconstrução. **88/195 situações não têm mapeamento em IIC** → mesmo o legado só contabiliza as 107 mapeadas (o corte-1 herda: pular NF sem CC / abortar situação sem 2 contas — não inventar).

## Plano do corte-1 (quando executado): "DIÁRIO fiel, entrada, gated, reversível"
1. **Migration `035_nf_contabil_diario.sql`** (fundação): `plano_contas` (subset seedado do Oracle), `itens_integracao_contabil` (as ~107 mapeadas), `lote_contabil`, `diario` (colunas exatas do Oracle); `ALTER plc ADD codcontabil`; `ALTER parceiros` valida codcontabil/_for como FK; `ALTER situacao_nf/cfop` +colunas de situação; RBAC BTNCONTABILIZAR/BTNESTORNARCONTABIL.
2. **`NfContabilizacaoService`** (molde stateful F3/F4: transação única + forUpdate + CAS + currentTenant + BusinessRuleError→422): `POST /fiscal/nf/:id/contabilizar` e `/estornar-contabilizacao`. Gate por `empresas.integracao='AUTOMATICA'` (fonte-de-verdade legada) com `UTILIZA_INTEGRACAO_CONTABIL` (id 100, default 'N', já seedado em 033) como override. Reconstrói `LancaDiarioContabil` (linhas por situação de `nf_contabil` + impostos), resolve contas (IIC 'F'/'A' + ponte PLC + parceiro), 1 `lote_contabil`, `CONTABILIZADO='S'` via CAS. Invariante barata: Σdébitos=Σcréditos (advisory/log). Situação sem 2 contas → 422 CONTAS_NAO_INFORMADAS; parceiro sem conta → 422 CONTA_PARCEIRO_NAO_DEFINIDA.
3. **Wire nos efeitos:** processar(entrada)/transmitir(saída autorizada) → se gate → contabilizar; cancelar/reverter → estornar-contabilização (na reversão, bloquear se `contabilizado='S'` e empresa não-AUTOMATICA, uNF:8951).
4. **Smoke gated:** empresa AUTOMATICA + IIC seedado → contabilizar gera `diario` (Σ=Σ), `contabilizado='S'`; estornar deleta. Empresa default (não-AUTOMATICA/config 'N') → inerte (zero-regressão F1–F4/F6).

## Adiado dentro de F5b (documentar no dossiê §10 quando implementar)
`CHAVEAMENTO_PERIODO`/`PeriodoFechado` (trava de período), `LOTE_CONTABIL` como agregador de fechamento (1 lote/NF no corte-1), CMV reconciliado a MULTI_PRECO, PIS/COFINS com PC_CONFIG completo, situações sem IIC (88/195, seed incremental por golden), `TIntegracaoContabilNFCe` (PDV) e as outras subclasses (baixas/caixa/transferência) — fora do escopo NF. Motor `LancaDiarioContabil` permanece reconstruído (external), confrontado por golden.
