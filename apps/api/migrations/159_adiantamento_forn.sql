-- 159 — ADIANTAMENTO A FORNECEDOR/PARCEIRO (FRMADIANTAMENTOFORNECEDOR, uCadAdiantamentoFornecedor.pas).
-- 699 acessos/11 operadores no legado. O registro produz DOIS fatos: (1) um movimento na conta corrente
-- (MOV_CONTAS_BANCARIAS) e (2) um TÍTULO — ARECEBER quando o dinheiro SAI (tipo 'D'), APAGAR quando ENTRA
-- (tipos 'C'/'E'). Golden: 563 linhas · 121 fornecedores · R$ 844.007,79 · 2020-05→2025-03 · TIPO D 554/C 9
-- (o 'E' NUNCA ocorreu e não há SITUACAO_NF com TIPO_OPERACAO='F21' ⇒ cópia-fiel-negativa, ver o dossiê).
-- CODMAPA (0/563 = morta) e OLD_CODPARCEIRO (resíduo de migração antiga) NÃO são copiadas.

CREATE SEQUENCE IF NOT EXISTS seq_adiantamento_forn;
CREATE TABLE IF NOT EXISTS adiantamento_forn (
  codadiantamento  integer PRIMARY KEY DEFAULT nextval('seq_adiantamento_forn'),
  idempresa        integer NOT NULL,                    -- escopo multi-tenant (carimbado no servidor)
  codparceiro      integer NOT NULL REFERENCES parceiros(codparceiro),
  codcontacorrente integer NOT NULL REFERENCES contas_bancarias(codconta),
  dtadiantamento   timestamptz NOT NULL,
  dtvencimento     timestamptz NOT NULL,                -- 563/563 no golden; validado >= dtadiantamento
  valor            numeric(13,2) NOT NULL,              -- SEM sinal (o sinal do dinheiro está no movimento)
  tipo             char(1) NOT NULL,                    -- 'C' (F19) | 'D' (F20) | 'E' (F21)
  quitada          char(1) NOT NULL DEFAULT 'N',        -- 'S' quando o título gerado é baixado
  codmovconta      integer NOT NULL,                    -- o movimento na conta corrente: a trigger VALIDA_ADIANTAMENTO
                                                        -- do Oracle levanta -20001 se vier nulo (563/563 no golden)
  obs              varchar(255),                        -- vira o HISTORICO do movimento (557/563 iguais no golden)
  idsituacao_nf    integer REFERENCES situacao_nf(idsituacao_nf), -- de onde vem o TIPO (TIPO_OPERACAO F19/F20/F21)
  contabilizado    char(1),                             -- 'S' = já integrado (bloqueia editar/excluir)
  iddocgerado      integer,                             -- gancho da integração contábil (2/563 — quase morta)
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz,
  CONSTRAINT ck_adto_tipo CHECK (tipo IN ('C', 'D', 'E')),
  CONSTRAINT ck_adto_quitada CHECK (quitada IN ('S', 'N')),
  CONSTRAINT ck_adto_venc CHECK (dtvencimento >= dtadiantamento) -- validação 4 do btnGravarClick, no schema
);
ALTER SEQUENCE seq_adiantamento_forn OWNED BY adiantamento_forn.codadiantamento;
CREATE INDEX IF NOT EXISTS ix_adto_forn_emp  ON adiantamento_forn (idempresa, dtadiantamento);
CREATE INDEX IF NOT EXISTS ix_adto_forn_parc ON adiantamento_forn (codparceiro);

-- ── A SITUAÇÃO DO DOCUMENTO define o TIPO (uCadAdiantamentoFornecedor.pas:99-147) ──────────────────────
-- `AnsiIndexStr(SituacaoNF.TipoOperacao, ['F19','F20','F21'])` → índice do radio → TIPO C/D/E, com o radio
-- DESABILITADO. Golden: 1011 'PAGAMENTO' = F20 (554 adiantamentos) e 1012 'RECEBIMENTO' = F19 (9). Não há F21.
-- a coluna já existe desde a mig 039 (varchar(4), criada para o gate de retenção 'E03') — este ALTER é no-op e
-- fica só como documentação de dependência; 'F19'/'F20'/'F21' cabem em 4.
ALTER TABLE situacao_nf ADD COLUMN IF NOT EXISTS tipo_operacao varchar(4);
INSERT INTO situacao_nf (idsituacao_nf, descricao, tipo, tipo_operacao) VALUES
  (1011, 'PAGAMENTO',   'S', 'F20'),
  (1012, 'RECEBIMENTO', 'E', 'F19')
ON CONFLICT (idsituacao_nf) DO UPDATE SET tipo_operacao = EXCLUDED.tipo_operacao;

-- SITUACAO_NF_PARCEIROS — restringe QUAIS parceiros a situação aceita (TfrmCadSituacaoNF.GetParceirosPermitidos:
-- 'SELECT DISTINCT S.CODPARCEIRO FROM SITUACAO_NF_PARCEIROS S WHERE S.IDSITUACAO_NF = %d'). Lista VAZIA = sem
-- restrição (só ATIVADO='S'), que é o caso de 1011/1012 no golden — 31 outras situações têm lista.
CREATE TABLE IF NOT EXISTS situacao_nf_parceiros (
  idsituacao_nf integer NOT NULL REFERENCES situacao_nf(idsituacao_nf),
  codparceiro   integer NOT NULL REFERENCES parceiros(codparceiro),
  PRIMARY KEY (idsituacao_nf, codparceiro)
);

-- ── O TÍTULO GERADO ────────────────────────────────────────────────────────────────────────────────────
-- ADFORNECEDOR='S' marca o título como "nascido de adiantamento a parceiro" (100% no golden); ADCREDITO='S'
-- só no tipo 'E'. CODADIANTAMENTO é o vínculo (o legado também repete o código em DUPLICATA — mantemos, fiel).
ALTER TABLE areceber
  ADD COLUMN IF NOT EXISTS codadiantamento integer,
  ADD COLUMN IF NOT EXISTS adfornecedor    char(1);
ALTER TABLE apagar
  ADD COLUMN IF NOT EXISTS codadiantamento integer,
  ADD COLUMN IF NOT EXISTS adfornecedor    char(1),
  ADD COLUMN IF NOT EXISTS adcredito       char(1);
CREATE INDEX IF NOT EXISTS ix_areceber_adto ON areceber (codadiantamento) WHERE codadiantamento IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_apagar_adto   ON apagar   (codadiantamento) WHERE codadiantamento IS NOT NULL;
-- ARECEBER.TOTAL do legado NÃO é copiada: no golden dos 552 títulos do adiantamento TOTAL = VALOR em 100%, e a
-- nossa get_areceber já deriva o total (valor + juros) — coluna espelho não vira coluna própria (lição 70).

-- ── O MOVIMENTO NA CONTA CORRENTE ──────────────────────────────────────────────────────────────────────
-- Coluna própria do vínculo (o legado grava MOV_CONTAS_BANCARIAS.CODADIANTAMENTO em 563/563) — o `origem`/
-- `idorigem` continuam sendo a chave genérica do razão ('ADTOFORN' + codadiantamento).
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS codadiantamento integer;

-- RBAC — as 5 opções REAIS do form no golden (`select opcao, count(*), count(distinct codoperador) from
-- permissoes where form='FRMADIANTAMENTOFORNECEDOR'`): o gate da tela, BTNADICIONARREGISTRO, BTNGRAVAR e
-- BTNEDITAR com 53 linhas/26 operadores cada, e BTNEXCLUIR com 40/19 — excluir é privilégio MENOR.
-- `permissoes` não tem índice único, então `ON CONFLICT DO NOTHING` não protegeria nada: a idempotência vem do
-- NOT EXISTS (fold auditoria).
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT v.form, v.opcao, v.codoperador, v.codempresa
FROM (VALUES
  ('FRMADIANTAMENTOFORNECEDOR', 'FRMADIANTAMENTOFORNECEDOR', 7, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNADICIONARREGISTRO',      7, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNGRAVAR',                 7, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNEDITAR',                 7, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNEXCLUIR',                7, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'FRMADIANTAMENTOFORNECEDOR', 1, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNADICIONARREGISTRO',      1, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNGRAVAR',                 1, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNEDITAR',                 1, 1),
  ('FRMADIANTAMENTOFORNECEDOR', 'BTNEXCLUIR',                1, 1)
) AS v(form, opcao, codoperador, codempresa)
WHERE NOT EXISTS (
  SELECT 1 FROM permissoes p
  WHERE p.form = v.form AND p.opcao = v.opcao AND p.codoperador = v.codoperador AND p.codempresa = v.codempresa
);

-- A config que liga a exigência da situação do documento. No golden o VALOR global é 'N' e existe um override
-- TIPO='Modulo' CHAVE='Retaguarda' VALOR='S' — a tela É da retaguarda, logo vale 'S' (e de fato IDSITUACAO_NF
-- está preenchido em 563/563). Copiamos os dois níveis para o resolver reproduzir a precedência.
-- id 122 = o ID REAL do legado (as chaves de `configuracoes` são copiadas com o id do Oracle, mig 033).
-- NOT EXISTS em vez de ON CONFLICT (codigo): a PK é o `id`, e um id 122 já ocupado por OUTRO código faria a
-- migration morrer com 23505 (fold auditoria).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas)
SELECT 122, 'INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS', 'N', 'String',
       'Obriga informar a situação do documento ao cadastrar um adiantamento à parceiros.', 'S;N|Sim;Não', 'Modulo;Empresa;Grupo;Usuario'
WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE id = 122 OR codigo = 'INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS');
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
SELECT id, 'Modulo', 'Retaguarda', 'S' FROM configuracoes WHERE codigo = 'INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS'
ON CONFLICT DO NOTHING;
-- `VALIDA_SALDO_PARCEIRO_ADIANTAMENTO` ('S' no golden, "valida o saldo de crédito do parceiro no adiantamento")
-- NÃO é implementada: zero call sites em TODO o fonte clonado da retaguarda (`grep -ril` na árvore inteira) — a
-- regra vive em módulo não clonado. Registrada aqui e no dossiê para não ser reinventada.

-- ── PERÍODO CONTÁBIL: a área desta tela tem FLAG PRÓPRIO ───────────────────────────────────────────────
-- `PERIODO_CONTABIL.BLOQ_ADIANTAMENTO_FORN` existe no Oracle e vale 'S' nos 2 períodos fechados do golden
-- (codperiodocontabil 21 e 61) — é o flag do adiantamento, não o de A Receber/A Pagar. Quem o LÊ não está no
-- fonte clonado (mesma situação do `ValidaPeriodoFechado`, que vive no submódulo `sicom/util`), mas o schema e o
-- dado provam a intenção: usamos este flag para criar/editar/excluir adiantamento.
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_adiantamento_forn char(1) DEFAULT 'N';

-- DTCHAVEAMENTO — gate "Caixa FECHADO não é permitida alteração dos documentos!" de udmPrincipal.pas:2183,
-- que roda ANTES de qualquer lançamento na conta. Golden: preenchida em 2 das 31 contas (2021-01-01) ⇒ regra
-- viva, rara. Fica NULL nas contas do seed (sem chaveamento = sem bloqueio).
ALTER TABLE contas_bancarias ADD COLUMN IF NOT EXISTS dtchaveamento date;
