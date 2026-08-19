-- 163 — ANÁLISE PEDIDO×NF, folds da auditoria do corte de pontas (mig 162).
--
-- (1) ⚠️ CORREÇÃO da mig 162: o comentário afirmava que as 4 colunas da conferência "já existem" nas duas pontas.
-- Falso para a NOTA NÃO CADASTRADA — a mig 087 só alterou `nf`. O `btnExcluirConferenciaClick` do legado atua nas
-- DUAS tabelas (`fTabela` = NF com chave CODNF, ou NFE_NAO_CADASTRADAS com chave CHAVENFE,
-- UanalisaPedComp_NF.pas:898-900/1126-1132), então sem estas colunas aquele ramo é um erro 42703 garantido.
ALTER TABLE nfe_nao_cadastradas
  ADD COLUMN IF NOT EXISTS codpedcomp            integer,      -- vínculo com o pedido de compra (a conferência)
  ADD COLUMN IF NOT EXISTS codoperador_liberacao integer,      -- quem liberou a divergência
  ADD COLUMN IF NOT EXISTS status_pedcomp        varchar(50),  -- 'LIBERADO COM/SEM DIVERGENCIA' | 'NAO LIBERADO'
  ADD COLUMN IF NOT EXISTS status_qtd_pedcomp    varchar(10);  -- 'Total' | 'Parcial'
CREATE INDEX IF NOT EXISTS ix_nfe_nao_cad_pedcomp ON nfe_nao_cadastradas (codpedcomp) WHERE codpedcomp IS NOT NULL;

-- (2) o `usucadastro` do pedido é o "comprador" que decide quem libera a análise, e o app novo **não o gravava** —
-- a coluna nascia nula em todo pedido criado aqui, o dono real não era reconhecido e liberar virava privilégio de
-- master. O serviço passou a gravá-lo; este backfill fecha as linhas já existentes (idempotente).
UPDATE pedidocompra SET usucadastro = codoperador WHERE usucadastro IS NULL AND codoperador IS NOT NULL;
