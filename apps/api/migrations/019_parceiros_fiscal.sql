-- PARCEIROS Fase 3: CONFIGURAÇÃO fiscal (a tela ARMAZENA config; NÃO calcula imposto —
-- o motor de cálculo vive a jusante em NF/financeiro). Só as colunas que a TELA expõe
-- (subconjunto do Oracle): flags de retenção de ENTRADA + 2 alíquotas + entidade ISSQN +
-- contribuinte ICMS (já em F2) + classificação fiscal (F2) + envia NFe + devolução zera ICMS-ST
-- + IRRF/Apuração/Classificação + estrangeiro. Doc: dossiers/retaguarda/uCadClientes.md §fiscal.
-- NÃO modelamos colunas de SAÍDA (*_SAI), SENAR, FUNRURAL-alíquota, LIBERA_DIGITAR_RETENCOES,
-- RETENCAO_COOPERATIVA, BASE_RETENCAO_INSS_DIF — existem no Oracle mas NÃO têm UI nesta tela.
-- Oracle: flags entrada CHAR(1) (NULL=off); a tela escreve 'S'/'N' (checkbox). Domínios sem
-- CHECK no legado — mantemos sem CHECK rígido (validação no zod).

ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS estrangeiro char(1) DEFAULT 'N';

-- Flags de retenção (ENTRADA NF) — checkbox S/N na aba "Retenções Nota fiscal".
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS habilita_retencao_pis_nf      char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS habilita_retencao_cofins_nf   char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS habilita_retencao_csll_nf     char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS habilita_retencao_ir_nf       char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS habilita_retencao_inss_nf     char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS habilita_retencao_issqn_nf    char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS habilita_retencao_funrural_nf char(1);

-- Alíquotas que a tela edita (entrada) — precisão fiel ao Oracle.
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS perc_aliquota_ir    numeric(13,2);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS perc_aliquota_issqn numeric(15,4);

-- Entidade ISSQN (FK lógica → parceiros TIPOFJ='E').
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS codparceiro_ent_issqn integer;

-- Combos fiscais "soft" (usados por NF a jusante; aqui só armazenados).
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS envianfe                        char(1); -- S/N
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS devolucao_zera_imposto_icmsst   char(1); -- S/N
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS irrf          char(1); -- ''/I/F/R (cmbClassIR)
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS apuracao      char(1); -- M/A (cmbApuracao)
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS classificacao char(1); -- F/I/C/S (cmbTpFigura)

-- Seed fiscal: dá uma config ao fornecedor (parceiro 1) p/ a tela/teste exibir.
UPDATE parceiros
   SET contribuinte_icms = '1',
       classfiscal = 'LR',
       habilita_retencao_ir_nf = 'S',
       habilita_retencao_issqn_nf = 'S',
       perc_aliquota_ir = 1.50,
       perc_aliquota_issqn = 5.0000,
       envianfe = 'S',
       irrf = 'I',
       apuracao = 'M',
       classificacao = 'F'
 WHERE codparceiro = 1;
