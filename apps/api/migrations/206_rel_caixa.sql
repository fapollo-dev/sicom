-- 206 — RELATÓRIOS DE CAIXA (`FRMRELCAIXA`, `URelCaixa.pas` + `UCaixa.pas`). Dossiê: `uRelCaixa.md`.
-- 505 acessos, 11 operadores, o último **ontem (08/09/2026 16:44)** — a tela está viva.
--
-- ⚠️ **O achado é maior que a tela.** Para montar o relatório de divergências fui olhar `CAIXA_PDV` e
-- `CX_VENDAS` e a carga estava **descartando quase tudo**:
--
-- | tabela | colunas no legado | tínhamos | perdidas | linhas |
-- |---|---|---|---|---|
-- | `CAIXA_PDV` | 33 | 8 | **25** | 26.907 |
-- | `CX_VENDAS` | 36 | 21 | **15** | 3.352.924 |
--
-- E as 25 de `CAIXA_PDV` são **exatamente as de dinheiro**: sangria, troco, fundo de caixa, descontos,
-- acréscimos, cancelamentos, contravale, voucher, recarga, correspondente e os "INI_" (o que o operador
-- declarou na abertura). Sem elas não existe conferência de caixa nenhuma — é a declaração do PDV que se
-- compara com o apurado.
--
-- Em `CX_VENDAS` a que faz falta imediata é **TESOURARIA**: é ela que diz se o caixa já foi recolhido, e é o
-- filtro do relatório de "caixas abertos".
-- CAIXA_PDV
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS vendab_inicial             numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS vendab_final               numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS cancelamentos_item         numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS cancelamentos              numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS descontos                  numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS acrescimos                 numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS sangria                    numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS fundocaixa                 numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS troco                      numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS contravale                 numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS idrds                      integer;
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS recarga                    numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS correspondente             numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_cancelamento           numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_cancelamento_nf        numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_desconto               numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_desconto_nf            numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_acrescimo              numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_acrescimo_nf           numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_troco                  numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_sangria                numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS ini_suprimento             numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS voucher                    numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS cancelamentos_aberto       numeric(13,2);
ALTER TABLE caixa_pdv ADD COLUMN IF NOT EXISTS areceber_bx                numeric(15,2);

-- CX_VENDAS
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS gnf                        integer;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS codfiscalcaixa             integer;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS gt                         numeric(15,2);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS tesouraria                 char(1);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS hashpaf                    varchar(32);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS sequencia                  integer;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS troco_solidario            numeric(13,2);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS crescevendas               char(1);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS lanc_provisorio            char(1);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS lanc_provisorio_usuario    integer;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS lanc_provisorio_data       timestamptz;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS baixarcb                   char(1);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS idclubedesconto            integer;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS idlote_baixa               integer;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS vale_troco                 numeric(13,2);
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS idintegracao               varchar(40);
-- ── `plc.tpconta` — o que separa conta de CAIXA de conta contábil ────────────────────────────────────────────
-- O relatório de divergências só soma os lançamentos de `CAIXA` cujo centro de custo tem `TPCONTA = 0`
-- (`UCaixa.pas:177`). No cliente: 47 PLCs com 0, 324 com 1 e 16 com 2 — sem a coluna, a apuração somaria
-- lançamento que não é de caixa.
ALTER TABLE plc ADD COLUMN IF NOT EXISTS tpconta integer;

-- ⛔ `HIST_DEVOLUCAO` NÃO entra: a consulta soma dela um ajuste no recurso DINHEIRO (`UCaixa.pas:141`), mas a
-- tabela tem **ZERO linhas** em produção. A regra fica registrada no serviço como ajuste inócuo, medido.

-- RBAC: gate de tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMRELCAIXA', 'FRMRELCAIXA', 7, 1)
ON CONFLICT DO NOTHING;
