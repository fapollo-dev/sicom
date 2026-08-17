-- 150 — PENDÊNCIAS DO OPERADOR (FRMPENDENCIASOPERADOR, 3.653 acessos/12 operadores) — corte 1: a FILA.
-- A tela é uma lista de trabalho por operador: pendências de análise pedido×NF (APN), de refazer análise
-- (RPN) e de conferência (CFN), com status Aberta/Finalizada. Golden: 6.159 linhas — F/APN 3.617 ·
-- E/APN 1.239 · F/RPN 777 · A/APN 519 · A/CFN 7. Os escritores no legado são a própria tela e o MANIFESTO
-- (que acabamos de migrar) — o vínculo fecha.
--
-- ⚠️ O CASE da tela do legado SÓ rotula APN/RPN e A/F; os valores CFN e E existem no dado e saem SEM rótulo
-- na tela original (célula em branco com o código cru por trás). Copiado: rotulamos o que o legado rotula.
--
-- PO_COMPLEMENTO nas linhas carregadas do Oracle aponta p/ APN_ID de ANALISE_PEDIDO_NF — domínio que o app
-- novo calcula on-the-fly (mig 088) e NÃO persiste. O corte 1 traz a fila e as ações de fila (finalizar/
-- reabrir/criar); abrir a análise vinculada de uma pendência ANTIGA é o corte 2 (exigiria carregar uma
-- tabela-vínculo mínima da APN no cutover).
CREATE SEQUENCE IF NOT EXISTS seq_pendencia_operador;
CREATE TABLE IF NOT EXISTS pendencia_operador (
  po_id                      integer PRIMARY KEY DEFAULT nextval('seq_pendencia_operador'),
  codoperador                integer NOT NULL,       -- o DONO da pendência
  po_tipo_pendencia_operador varchar(3) NOT NULL,    -- APN | RPN | CFN
  po_status                  varchar(1) NOT NULL DEFAULT 'A',  -- A=Aberta · F=Finalizada · E (existe no golden)
  po_complemento             varchar(250),           -- vínculo (APN_ID nas carregadas; codnf nas novas)
  po_observacao              varchar(1000),
  po_data                    timestamptz DEFAULT now(),
  codempresa                 integer NOT NULL,
  codoperador_origem         integer                 -- quem CRIOU a pendência
);
ALTER SEQUENCE seq_pendencia_operador OWNED BY pendencia_operador.po_id;
CREATE INDEX IF NOT EXISTS ix_pendencia_operador_dono ON pendencia_operador (codoperador, po_status);
CREATE INDEX IF NOT EXISTS ix_pendencia_operador_emp  ON pendencia_operador (codempresa, po_data);

-- RBAC: a ÚNICA opção real do form no Oracle é o gate da tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPENDENCIASOPERADOR', 'FRMPENDENCIASOPERADOR', 7, 1)
ON CONFLICT DO NOTHING;
