-- 343 — FATURAMENTO DA NOTA, corte D: sai o `nf.faturada` (mig 028). O Oracle não tem a coluna (a NF só tem PROC e CANCELA_FATURAMENTO):
-- a verdade do legado é "tem título pela IDNF" (`ExisteFinanceiro`, udmNF.pas:11787) e "tem parcela pendente"
-- (`ExisteFaturamentoAGerarFinanceiro`, :11766). O flag divergia sozinho — título apagado na tela de Contas a Pagar deixava 'S' sem título,
-- título lançado por fora deixava 'N' com título — e travava a edição da nota, o que o `btnEditarClick` do legado não faz. Sem perda de
-- dado ("todos os campos" é sobre as colunas do legado; esta era só do Apollo).
ALTER TABLE nf DROP COLUMN IF EXISTS faturada;
