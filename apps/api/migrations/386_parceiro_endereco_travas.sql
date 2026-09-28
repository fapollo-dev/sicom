-- 386 — as regras do legado sobre o endereço do parceiro (uCadClientes; docs/…/uCadClientes.md, "travas do endereço").
--
-- 1. O CPF/CNPJ repetido: o legado (edtCNPJ_CPFExit) só RECUSA com BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE='S' (produção: 'N');
--    senão pergunta "Deseja continuar?" e grava — 1.042 grupos de parceiros diferentes com o mesmo documento, 14 criados em
--    2023-24. O índice único parcial da mig 178 barrava o que o legado deixa confirmar; a regra passa a ser do código
--    (parceiro-enderecos.ts, com `confirmarDocumentoRepetido`).
DROP INDEX IF EXISTS ux_parceiros_end_doc_novo;
CREATE INDEX IF NOT EXISTS ix_parceiros_end_cnpj_ativo ON parceiros_end (cnpj_cpf) WHERE ativado = 'S';

-- 2. A trava do endereço conta a NFC-e emitida para ele (CNPJLiberadoParaEdicao :4707). A NFC é do PDV e não migra: o
--    endereço dela vem na carga em `vendas`, pela ligação da mig 299 (pedido + loja + série + dia — tools/cutover/etl/extrair.py).
--    Produção: 749 endereços em NFC-e, 672 deles sem NF.
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS codparceiro_end_nfc integer;
CREATE INDEX IF NOT EXISTS ix_vendas_codparceiro_end_nfc ON vendas (codparceiro_end_nfc) WHERE codparceiro_end_nfc IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_nf_codparceiro_end ON nf (codparceiro_end) WHERE codparceiro_end IS NOT NULL;
