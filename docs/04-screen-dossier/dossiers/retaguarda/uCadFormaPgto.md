# Dossiê de Tela — FORMAS DE PAGAMENTO (modalidades) — `uCadFormaPgto`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (cadastro: núcleo + integração + flags) EM ANDAMENTO, 2026-07-04. Recon 3 agentes (Oracle FORMAS_PGTO + tela legada `uCadFormaPgto` + monorepo). **Prerequisito** do Caixa corte-2d (contábil por modalidade + tesouraria). |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadFormaPgto.pas`/`.dfm` (TfrmCadMaster) · `uRdmCadFormaPgto.pas`/`.dfm` (DataModule) |
| **Golden** | Oracle PINHEIRAO: FORMAS_PGTO **42 col / 36 linhas** (empresa 1 = 12 modalidades); PK IDPGTO (seq ID_IDPGTO); UNIQUE (IDEMPRESA,MODALIDADE) + (IDEMPRESA,ATALHO,IDPGTO_PAI); FK CODCONTACORRENTE→CONTAS_BANCARIAS. |

## 1. Modelo (Oracle real)
- **Multi-tenant por IDEMPRESA** (cada empresa cadastra suas modalidades; UNIQUE por empresa). PK `IDPGTO` (sequence).
- **Núcleo:** `MODALIDADE`(30, NOT NULL, único/empresa), `ATALHO`(20, NOT NULL, único/empresa — tecla no PDV), `DESTINO` CHAR(3) — **chave de roteamento financeiro** do fechamento.
- **DESTINO domínio** (combo legado `uCadFormaPgto.dfm:237`: TEF/CHQ/CHP/RCB/CXA/CRT/DEV/QUE) + valores no dado real (PIX/VTR). União usada: **CXA**(caixa/dinheiro)·**RCB**(a receber)·**CHQ**(cheque)·**CHP**(cheque-pré)·**CRT**(cartão)·**TEF**(cartão TEF)·**PIX**·**QUE**(quebra)·**DEV**(devolução)·**VTR**(vale-troco). Sem check no banco (validação aplicacional).
- **3 vínculos de integração (100% resolvidos no Oracle — destravam o corte-2d):**
  - `CODCONTACORRENTE` → **CONTAS_BANCARIAS.CODCONTA** (tesouraria; FK real). Ex.: 21 TESOURARIA, 1 CONTA CARTAO, 23 CONTA CHEQUE.
  - `PLCCOFRE` → **PLC.CODPLC** (plano gerencial/cofre; soft ref). Ex.: 188 VENDAS DINHEIRO, 191 VENDAS CARTAO, 2084 QUEBRA.
  - `CODPLANOCONTAS` → **PLANO_CONTAS.CODPLANOCONTAS** (contábil, débito; soft ref). Ex.: 183 CAIXA CENTRAL, 213 CARTOES A RECEBER, 211 CLIENTES DIVERSOS. **NÃO confundir com PLC** (ids colidem por acaso — o alvo é PLANO_CONTAS).
- **Status:** `INATIVO`('S')+`DATA_INATIVO` (soft-delete real). `ATIVO`, `CODCONTABIL`, `CODCONTABIL_DEB/CRED`, `CFOP*` = **colunas MORTAS** (100% NULL) → descartar.
- **Flags PDV:** `RECEBE_PDV`(default 'S'), `PERMITE_SANGRIA_PDV`, `LANC_MOVIMENT_INDIVIDUAL`, `TIPO`(E entrega/N).
- **Validações (btnGravar, uCadFormaPgto.pas:274):** ATALHO obrigatório + único/empresa (:295); **DESTINO obrigatório** (`ValidaObrigatorio(cbbDestino)`, :324); **DESTINO='QUE' + RECEBE_PDV='S' → bloqueia** (:274) ("Quebra não recebe no PDV"); CODCONTACORRENTE Required no dataset.
- **Amostra empresa 1:** DINHEIRO(D,CXA,plc188,cc21,pc183) · CHEQUE(C,CHQ,189,23,187) · CARTOES(K,TEF,191,1,213) · CONVENIO(V,RCB,96,22,211) · PIX(G,PIX,-,221,183) · QUEBRA DE CAIXA(Q,QUE,2084,21,-, RECEBE_PDV=N).
- **Consumo:** fechamento de caixa (`UfinalizaFechamento` — classifica por DESTINO), integração contábil (`UIntegracaoContabilFechamentoCaixa` — conta por PLCCOFRE/CODPLANOCONTAS), tesouraria (CODCONTACORRENTE), PDV (ATALHO/RECEBE_PDV).

## 2. Monorepo
Usa **IDEMPRESA** → encaixa no engine declarativo `empresaScoped:true` (que carimba/filtra `idempresa`) — como `contas_bancarias`. Lookups já existem: `contas_bancarias` (crud), `plc` (crud, NF F5), `plano_contas` (vertical). PK digitada? Não — IDPGTO é sequence → `pkGerada:true`.

## 3. Plano de cortes
- **Corte-1 (ESTE) — cadastro (núcleo + integração + flags):** migration cria `formas_pgto` (idpgto PK seq, idempresa, modalidade, atalho, destino, **plccofre/codcontacorrente/codplanocontas** [os 3 vínculos], recebe_pdv, permite_sangria_pdv, lanc_movimento_individual, tipo, inativo/data_inativo, auditoria) + UNIQUE (idempresa,upper(modalidade)) e (idempresa,upper(atalho)) + view `get_formas_pgto` (LEFT JOIN conta/PLC/plano_contas p/ nomes) + RBAC FRMCADFORMAPGTO + seed empresa 1/2 (modalidades reais). CRUD **engine** (`empresaScoped:true`, `pkGerada:true`; `derivar` carimba `data_inativo` no inativar). Validações: **DESTINO obrigatório** (create); MODALIDADE/ATALHO únicos (índice→409); **DESTINO='QUE'+RECEBE_PDV='S'→400** (regra do legado via **zod superRefine**, back+front). Front `FormasPgtoCadMaster` (`<CadMaster>`): modalidade/atalho/destino(combo)/conta-corrente(lookup)/cofre PLC(lookup)/conta contábil(lookup)/RECEBE_PDV/PERMITE_SANGRIA/inativo. Lookups reusam contas_bancarias/plc/plano_contas.
- **Corte-2 (adiado) — PDV/adquirência avançado:** COMISSAO/ACRE_DESC (+UPDATE-em-massa peculiar), CARTAO_BIN, SMART_TEF/TIPO_TRANSACAO (TEF), TROCO_LIMITE (só TEF/CRT), parcelamento (PARCELA*/PARCELADO*/CODCONPAGTO/VALOR_MINIMO_FV), CFOP dentro/fora estado, condições de pagamento N:N (REL_FORMA_PAGAMENTO_CONDICAO), EXIGE_PERMISSAO, BAIXA_DOCUMENTO_AUTOMATICO, IDPGTO_PAI (hierarquia). Colunas mortas (ATIVO/CODCONTABIL*/CFOP) NÃO migradas.
- **Destrava:** Caixa corte-2d — o contábil do fechamento por modalidade (CODPLANOCONTAS/PLCCOFRE) e a tesouraria (CODCONTACORRENTE) passam a ter a config de onde ler.

## 3b. Auditoria do corte-1 (2026-07-04)
Dois auditores adversariais (paridade vs. legado/Oracle; regressão/segurança/multi-tenant). Veredito: **0 ALTA**; corte fiel e seguro para merge. Confirmados: DESTINO combo (superconjunto combo∪dado), os 2 únicos por empresa (IDPGTO_PAI 100% NULL → omissão equivalente), QUE≠PDV (create+update), os 3 vínculos apontando às tabelas certas (**codplanocontas→plano_contas**, evitando a colisão de ids com PLC), soft-delete INATIVO fiel, **seed 100% fiel ao Oracle** (incl. RECEBE_PDV='N' na QUEBRA), colunas mortas (ATIVO/CODCONTABIL*/CFOP*) confirmadas 100% NULL e descartadas. **Correções aplicadas:** (MÉDIA) DESTINO tornado **obrigatório** no create (era opcional; o legado exige, :324) — é a chave do fechamento; (MÉDIA) citações corrigidas (:274 QUE≠PDV / :324 DESTINO obrig., eram :257/:321); (BAIXA) `derivar` passou a **carimbar `data_inativo`** ao inativar/limpar (soft-delete fiel INATIVO+DATA_INATIVO). **Divergências CONSCIENTES registradas:** únicos **case-INsensitive** (`upper()`) vs. legado case-sensitive (mais estrito, sem colisão nos dados reais); brecha do superRefine em PATCH parcial (mitigada — o `<CadMaster>` envia o form completo); `LANC_MOVIMENT_INDIVIDUAL` é coluna real (tesouraria) **sem binding na tela legada** (migrada como campo p/ o corte-2d); seed RBAC sem ON CONFLICT (padrão pré-existente do projeto).

## 4. Riscos
Soft-delete legado é `INATIVO` (não INDR) — o engine soft-delete assume INDR; corte-1 modela `inativo` como campo editável + hard-delete (como `contas_bancarias.ativo`), documentado. Vínculos plccofre/codplanocontas são soft-refs (sem FK, como no Oracle); codcontacorrente é FK no legado mas corte-1 usa soft-ref p/ não acoplar ao seed de contas_bancarias (documentado). DESTINO sem check no banco (enum na aplicação). A regra DESTINO='QUE'≠PDV é cross-field (fora do CRUD puro) → hook/validação dedicada.
