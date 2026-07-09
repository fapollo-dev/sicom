-- 066 — RECEBIMENTO corte-4c-b: RETENÇÃO FEDERAL (PIS/COFINS/CSLL/IR/INSS/ISSQN/FUNRURAL) → títulos A Pagar.
--
-- O motor `calcularRetencoes` (nf-fiscal, corte A1) já computa nf.total_ret_* no cabeçalho (só ENTRADA de
-- SERVIÇO, situação E03; FUNRURAL por CFOP). Este corte GERA os títulos separados no faturamento
-- (GerarAPagarDeRetencoes, udmNF.pas:8473) e ABATE o título do fornecedor (líquido = bruto − retenções).
-- DIVERGÊNCIA CONSCIENTE do abate: o legado abate TOTAL_RETENCOES = Σ dos 7 total_ret_* COMPUTADOS
-- (uFinanceiroNotaFiscal.pas:552); nós abatemos Σ dos títulos GERADOS → livro balanceado (Σ órgão+fornecedor
-- = totalnf). Idênticos no caso normal; diferem só quando um imposto é computado mas não gerado (órgão/dia off),
-- onde o legado desbalanceia (abate sem gerar). Gate E03 re-checado no faturamento (snapshot pode estar velho).
--
-- SHAPE (fiel a GeraApagar/InserirAPagar, udmNF.pas:8505-8528; golden confirma pelo 1 título SENAR existente):
--   TIPODOC='BOLETO', RETENCAO ∈ {PIS,COFINS,CSLL,IR,INSS,ISSQN,FUNRURAL} (IR, não IRRF), GERADO='SISTEMA',
--   ORIGEM='N', DTVENDA=DTCONTABIL, CODPARCEIRO = ÓRGÃO configurado (Receita/INSS/prefeitura, NÃO o fornecedor),
--   OBS='REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: <imp>\nNOTA FISCAL NRO: <nro>\nVALOR NOTA FISCAL: <total,dd>\n
--   ALIQUOTA <imp>: <aliq,dd>%'. 1 título por imposto quando total_ret_*>0 + órgão configurado + dia>0.
--
-- VENCIMENTO (MontarDataVencimento, udmNF.pas:8550): DIA_VENCIMENTO_RET_*>0 → DIA FIXO DO MÊS SEGUINTE
--   (dez → jan/ano+1); =0 → DTCONTABIL + 30 dias (mas o gate exige dia>0, então na prática é sempre dia-fixo).
--
-- HONESTIDADE (dossiê §10): a retenção federal é INÉDITA no golden (APAGAR.RETENCAO só tem ICMSST[205]+SENAR[1];
-- 0 dos 7 federais; 1 única NF com total_ret_* [zerado]). O 1 título SENAR (órgão≠fornecedor, abate 2,58+126,42=
-- 129, venc, OBS c/ vírgula, alíq 2%) valida o SHAPE do mecanismo. Config default OFF (fiel — a base tem off).
--   ISSQN: órgão vem de PARCEIROS.CODPARCEIRO_ENT_ISSQN (por fornecedor, já existe migration 019); alíquota de
--   PARCEIROS.PERC_ALIQUOTA_ISSQN. IR/demais: alíquota de ALIQUOTA_RETENCAO_* (039); IR prefere PERC_ALIQUOTA_IR.

-- Parceiro-órgão destinatário do título (config; default '' = não configurado → não gera). Escopo Modulo;Empresa.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (301, 'PARCEIRO_RETENCAO_PISCOFINS_CSLL', '', 'numero', 'Modulo;Empresa', 'CODPARCEIRO do órgão destinatário dos títulos de retenção de PIS/COFINS/CSLL (não o fornecedor). Vazio = não gera.'),
  (302, 'PARCEIRO_RETENCAO_INSS',           '', 'numero', 'Modulo;Empresa', 'CODPARCEIRO do órgão destinatário do título de retenção de INSS. Vazio = não gera.'),
  (303, 'PARCEIRO_RETENCAO_IR',             '', 'numero', 'Modulo;Empresa', 'CODPARCEIRO do órgão destinatário do título de retenção de IR (IRRF). Vazio = não gera.'),
  (304, 'PARCEIRO_RETENCAO_FUNRURAL',       '', 'numero', 'Modulo;Empresa', 'CODPARCEIRO do órgão destinatário do título de retenção de FUNRURAL. Vazio = não gera.'),
  -- Dia fixo de vencimento por imposto (>0 → dia do mês SEGUINTE; 0 → +30d, mas 0 também desliga a geração).
  (311, 'DIA_VENCIMENTO_RET_PIS',      '0', 'numero', 'Modulo;Empresa', 'Dia fixo de vencimento (mês seguinte) do título de retenção de PIS. 0 = não gera.'),
  (312, 'DIA_VENCIMENTO_RET_COFINS',   '0', 'numero', 'Modulo;Empresa', 'Dia fixo de vencimento (mês seguinte) do título de retenção de COFINS. 0 = não gera.'),
  (313, 'DIA_VENCIMENTO_RET_CSLL',     '0', 'numero', 'Modulo;Empresa', 'Dia fixo de vencimento (mês seguinte) do título de retenção de CSLL. 0 = não gera.'),
  (314, 'DIA_VENCIMENTO_RET_IR',       '0', 'numero', 'Modulo;Empresa', 'Dia fixo de vencimento (mês seguinte) do título de retenção de IR. 0 = não gera.'),
  (315, 'DIA_VENCIMENTO_RET_INSS',     '0', 'numero', 'Modulo;Empresa', 'Dia fixo de vencimento (mês seguinte) do título de retenção de INSS. 0 = não gera.'),
  (316, 'DIA_VENCIMENTO_RET_ISSQN',    '0', 'numero', 'Modulo;Empresa', 'Dia fixo de vencimento (mês seguinte) do título de retenção de ISSQN. 0 = não gera.'),
  (317, 'DIA_VENCIMENTO_RET_FUNRURAL', '0', 'numero', 'Modulo;Empresa', 'Dia fixo de vencimento (mês seguinte) do título de retenção de FUNRURAL. 0 = não gera.')
ON CONFLICT (id) DO NOTHING;
