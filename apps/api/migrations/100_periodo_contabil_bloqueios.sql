-- PERIODO_CONTABIL — flags de bloqueio POR ÁREA (fiel ao Oracle: BLOQ_NF/BLOQ_RCB/BLOQ_BAIXA_RCB/BLOQ_APG/
-- BLOQ_BAIXA_APG/BLOQ_MOV_CAIXA/…). A mig 038 só tinha STATUS+BLOQ_NF (a NF já usava). A trava de período
-- fechado da A Receber/Pagar precisa dos flags específicos: gravar/editar/excluir AR = BLOQ_RCB (na DTVENDA);
-- baixar AR = BLOQ_BAIXA_RCB (na DTPGTO); idem AP com BLOQ_APG/BLOQ_BAIXA_APG. Default 'N' (aberto).
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_rcb       char(1) NOT NULL DEFAULT 'N';
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_baixa_rcb char(1) NOT NULL DEFAULT 'N';
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_apg       char(1) NOT NULL DEFAULT 'N';
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_baixa_apg char(1) NOT NULL DEFAULT 'N';
