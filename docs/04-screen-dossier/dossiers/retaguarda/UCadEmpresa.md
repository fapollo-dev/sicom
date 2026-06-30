# Dossiê — EMPRESAS (cadastro da empresa/tenant) · `UCadEmpresa`

> **Status:** `corte-1 verde` (núcleo + fiscal + precificação/financeiro). A empresa É o tenant — esta tela dá identidade real ao `idempresa` (antes só um número do header) e **consolida o stub `empresa_fiscal`** (F6), destravando resíduos fiscais da NF (regime, UF de origem, **TXJUROPADRAO** da F4b). Verde: shared 75, **API 123, web 25, smoke 137/0**. Recon por 3 agentes (Oracle + `UCadEmpresa` + monorepo). Tabela legada = **265 colunas**; corte-1 migra o subconjunto que dá identidade + o que a NF/precificação leem.

## 0. Recorte governante
EMPRESAS é a peça-mãe do `empresaScoped` (todas as 13 telas carimbam/filtram `idempresa`). O legado é um **kitchen-sink de 265 colunas** (fiscal + financeiro + dezenas de tokens de integração + TEF + e-mail + curvas ABC). O corte-1 NÃO migra tudo — migra: identidade/endereço (enderEmit), config fiscal (regime/figura/IE/série) e precificação/financeiro (os campos que a NF/precificação consomem). O resto é fase-2 (ver §10).

## 1. Identidade / herança
- Form legado `TfrmCadEmpresa` (herda `TfrmCadMaster`) — `Units/UCadEmpresa.pas` + `udmCadEmpresa.pas`. Tabela `EMPRESAS`, **PK `CODEMPRESA NUMBER(10)`** (digitado). 4 empresas reais (todas MG/Uberlândia).
- Migrado: CRUD declarativo (`empresas.crud.ts`, molde `contas-bancarias`), **`pkGerada:false`** (CODEMPRESA digitado), **`empresaScoped:false`** (a tabela É a empresa; o schema-per-tenant já isola — filtrar `WHERE idempresa=atual` esconderia as demais empresas do tenant).

## 2. Dados — modelo
- **Oracle `EMPRESAS`**: 265 col. NOT NULL núcleo: CODEMPRESA, RAZAOSOCIAL(150), FANTASIA(150), CNPJ(30), INSC(30), ENDERECO(100), BAIRRO(50), CIDADE(50), UF CHAR(2), **CLASSFISCAL CHAR(2)**, senhas de operação(30). Fiscal: `CLASSFISCAL` **'LR'(×3)/'SN'(×1)** (não 'L'/'S'!), `FIGURAFISCAL CHAR(1)` 'D'/'O', `ALQSIMPLESNAC` (NULL mesmo na SN), **sem coluna CRT** (derivar SN→1/LR→3), `CONTRIBUINTE_ICMS`, `IDCIDADE`=IBGE 7-díg do município (3170206=Uberlândia), `SERIE='001'`, `TIPONFE='D'`, `CSC`/`CERTIFICADO`(CLOB)+`CERTIFICADO_SENHA`(texto claro). Precificação/financeiro: `DESPOPERACIONAL=20`, `TXJUROPADRAO=5`(emp.1), `PISCONFIS=9.3/IMPRENDA=15/CONTSOCIAL=9/ALIQUOTA_ESTADO=17`(LR), `MARGEM_VENDA`/`MARGEM_CONTRIBUICAO`(NULL).
- **`empresas` migrada (corte-1)** — `032_empresas.sql`: identidade/endereço + fiscal + precificação/financeiro + auditoria; PK `idempresa`; UNIQUE `cnpj`; CHECK `classfiscal in ('LR','SN')`; view `get_empresas`. Seed empresa 1 com os valores reais do Oracle.
- **Camada de config chave-valor** (`CONFIGURACOES` 843 / `CONFIGURACOES_ESPECIFICAS` 330, escopo `Empresa`): onde o legado guarda **`AMBIENTE_NF`** (tpAmb; default 'P', emp.1='H'), `APROVEITAMENTO_CREDITO_ICMSST_NF`='N', `CONSIDERAR_DESCONTO_CALC_ST` etc. — **NÃO** ficam em EMPRESAS. → **epic próprio (adiado)**. No corte-1, `ambiente` foi **achatado** numa coluna de `empresas` (divergência consciente).

## 3. Regras de negócio (validações — UCadEmpresa.pas)
- **CNPJ válido** (`ExisteDocumento(dtCNPJ)`, :2276 / udmCadEmpresa:667) → schema `zCnpj` (DV + normaliza 14 díg).
- **ALQSIMPLESNAC obrigatória se Simples** (`cmbCLASSFISCALChange`:1438) → superRefine (classfiscal='SN').
- **MARGEM_CONTRIBUICAO ≥ 0** (`Preenchido(8)`:2383) → superRefine.
- **Curva ABC = 100%** (`Preenchido(1)`:2289), **CC-taxas-cartão = despesa** (:2373), **Cidade/UF×IBGE** (:1324), **contingência datas+motivo≥14** (:1460/1476) → **adiados** (campos/abas fora do corte-1).

## 4. Efeitos colaterais
- Inserir empresa nova no legado **cria estoque/depósito** (`SetaEstoque`) + recarrega `dmPrincipal.Empresa*` → **adiado** (corte-1 só persiste o cadastro).
- Replicação `REM_*`/HASH_PAF → adiado.

## 5. O que a NF/precificação consome de EMPRESAS (a justificativa de migrar agora)
Repontado de `empresa_fiscal` → `empresas` (consolidação): `nf-fiscal.service.resolverUfOrigem` (UF origem do MVA ajustado interestadual), `nf-nfe.service` transmitir/cancelar/cce (cnpj/uf/cuf/serie_nfe/ambiente da chave/eventos). **F4b corrigido:** `nf-faturamento.service` grava `txjuros = empresas.txjuropadrao` (era proxy em `parceiros.txjuro`; udmCadAReceber.pas:214). Precificação (`despOperacional`/`simplesNacional`/`regime`) fica pronta para ler de `empresas` (hoje ainda via DTO; wiring completo = F2c).

## 6. Corte-1 ENTREGUE
- Migration `032_empresas.sql` (tabela + view + seed empresa 1 + **DROP `empresa_fiscal`** após repontar + RBAC `FRMCADEMPRESA`).
- `empresa.schema.ts` (cnpj/uf validados; classfiscal enum LR/SN; superRefine SN/margem); `empresas.crud.ts` (pkGerada:false, empresaScoped:false); `EmpresasCadMaster.tsx` (seções Identificação/Endereço/Fiscal/Precificação) + rota `/cadastro/empresas` + menu.
- **Reconciliação `empresa_fiscal`→`empresas`** (Opção A, precedente 014_parceiros): os 4 reads da NFe repontados; stub dropado. **F4b txjuros** de `empresas`. Smoke seção 24 (CRUD + validações + golden empresa 1 + txjuros=5). 2 auditores adversariais.

## 10. Adiado (documentado, nada perdido)
- **Certificado** (CERTIFICADO CLOB + CERTIFICADO_SENHA em texto claro → vault), **NFC-e** (CSC/CSC_ID + teste/NFCE_AUTENTICACAO), **CTe/MDFe** (séries/certificados próprios).
- **Integrações/tokens** (Cielo/Redecard/Tricard/Izio/Mercafácil/FGF/Scanntech/STEF/CresceVendas/WL/AlertaFiscal), **TEF**, **e-mail/SMTP**.
- **Contingência** (`AMBIENTE_CONTINGENCIA` + `btnVirarAmbiente`), **contábil/centros-de-custo** (PLC/MASCARAPLC/CC_* — depende de PLANO_CONTAS), **master-details** (contabilista, rede estabelecimento, códigos de ajuste SN/IPI/ICMS-ST), **curvas ABC**, **senhas de operação** (ADMIN/DESC/CANCEL/GAVETA — criptografia JvCaesar/CryptApollo).
- **Camada de config chave-valor** (`CONFIGURACOES`/`CONFIGURACOES_ESPECIFICAS`) — `AMBIENTE_NF`, `APROVEITAMENTO_CREDITO_ICMSST_NF`, etc. = **epic próprio** (subsistema genérico de config por empresa/usuário/módulo).
- **NF F2c** (caminho-SN do ICMS-ST + seleção de figura fiscal completa) — esta tela só ENTREGA o dado (CLASSFISCAL/FIGURAFISCAL); o cálculo é fase-2.
- Validações adiadas (com procedência): curva ABC=100% (:2289), CC-taxas-cartão=despesa (:2373), Cidade/UF×IBGE (:1324), contingência (:1460/1476), efeito cria-estoque na inserção (:1349).

## Riscos / notas
- **`ambiente` achatado** (legado: `AMBIENTE_NF` na config chave-valor) — divergência consciente; migrar p/ a camada de config quando o subsistema existir. **Mapeamento de valor no cutover:** legado usa `'H'`/`'P'` (Homologação/Produção); o migrado usa o `tpAmb` da SEFAZ `'2'`/`'1'` → mapear **H→2, P→1**.
- **Seed da empresa 1**: IDENTIDADE fictícia de homologação (razão/CNPJ fictícios — CNPJ `11222333000181`, DV válido); os PARÂMETROS FISCAIS espelham 1:1 a empresa 1 real (LR/MG/IBGE 3170206/DESPOPERACIONAL 20/TXJUROPADRAO 5). Auditoria pegou o CNPJ antigo `03923857000155` (herdado do stub F6) com DV inválido — corrigido.
- **CRT** derivável (SN→1/LR→3) — não é coluna no legado.
- **`empresas` não-empresaScoped** — cuidado para o engine não filtrar por `idempresa`.
- **Oracle read-only**; nenhuma DML em homolog.
