-- 064 — RECEBIMENTO corte-4b: forma de pagamento do XML (<pag>) + gate CFOP do financeiro automático.
--
-- (A) NF_FORMA_PAGAMENTO — o <pag><detPag> do XML (COMO foi pago), informativo, por NF. Fiel ao legado
-- (NFe.pas:3477-3527 → cdsPagamento). NÃO afeta o título A Pagar (esse vem do <cobr><dup>, TIPODOC='BOLETO').
-- tPag → DESTINO (single-code, escopado à empresa, fallback CXA) → IDPGTO de FORMAS_PGTO. No legado dinheiro→CXA
-- e crédito-loja→RCB resolvem (single-code), mas cartão/cheque/outros iam como listas 'TEF, CRT' que NUNCA casam
-- a coluna CHAR(3) → caíam em CXA (na base entrada: ~98% CXA, resto RCB/VTR). Aqui mapeamos single-code, e como
-- MELHORIA consciente resolvemos cartão→TEF e PIX→PIX quando o DESTINO existe na empresa (campo informativo).
--
-- (B) Gate CFOP do A Pagar automático (CFOPGeraFinanceiroAutomatico, udmNF.pas:9902): o legado só gera A Pagar
-- automático quando CFOP.GERA_FINANCEIRO_AUTO='S'. No golden SÓ o 1102 (compra p/ comercialização dentro do
-- estado) está ligado — os demais CFOPs faturam MANUALMENTE (tela de faturamento). Semeamos 1102='S'; o dono
-- do ERP liga outros (ex.: 2102) pelo flag. (PROC_FINANCEIRO do legado é amplo — o discriminador é este flag.)

-- (A) NF_FORMA_PAGAMENTO
CREATE SEQUENCE IF NOT EXISTS seq_nf_forma_pagamento;
CREATE TABLE IF NOT EXISTS nf_forma_pagamento (
  codnforpgto    integer PRIMARY KEY DEFAULT nextval('seq_nf_forma_pagamento'),
  codnf          integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  idempresa      integer,
  idpgto         integer,           -- → formas_pgto.idpgto (soft-ref; NULL se não resolveu)
  tpag           char(2),           -- <detPag><tPag> cru do XML (01/03/04/15/17/99…)
  vrpgto         numeric(13,2),     -- <detPag><vPag>
  vrtroco        numeric(13,2),     -- <detPag><vTroco> (raro em entrada)
  codoperadoras  integer,           -- bandeira do cartão (informativo; NULL no import)
  numero_aut     varchar(20),       -- <card><cAut> (NULL no import)
  integrado      char(1) DEFAULT 'N',
  codoperador    integer,
  dtcadastro     timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_nf_forma_pagamento OWNED BY nf_forma_pagamento.codnforpgto;
CREATE INDEX IF NOT EXISTS ix_nf_forma_pagamento_nf ON nf_forma_pagamento (codnf);

-- (B) Gate CFOP: default 'N' (não auto-gera); só o 1102 ligado (fiel ao golden).
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS gera_financeiro_auto char(1) DEFAULT 'N';
UPDATE cfop SET gera_financeiro_auto = 'S' WHERE codcfop = '1102';
