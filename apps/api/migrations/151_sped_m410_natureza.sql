-- 151 — SPED EFD-Contribuições corte-2: a NATUREZA REAL da receita não-tributada (M410/M810) + COD_CTA.
-- Substitui o NAT_REC='999' cutover-gated do corte-1 (mig 123) pela regra fiel do legado:
--   sqqBaseIsenta (UdmSpedPisCofins.dfm): a natureza vem de PC_TIPOCREDITOISENTO via PRODUTOS.IDTABELA,
--   VALIDADA contra as naturezas da situação do produto (P.IDPISCOFINS) e com FALLBACK para a 1ª natureza
--   da situação efetiva COALESCE(V.IDPISCOFINS, P.IDPISCOFINS); natureza nula + CST 08 → 999.
--   GeraRegistroM410/M810 (UspedPisCofins.pas:1667/1909): CST 08/09 → um único filho NAT_REC='999';
--   CST 04/06 → um filho por natureza (3 dígitos, pad-esquerda '0').
--
-- 1) PC_TIPOCREDITOISENTO — catálogo das naturezas de receita (Tabela 4.3.x do PVA, recortada por situação
--    PIS/COFINS). 373 linhas no golden, 9 IDPISCOFINS distintos; heap SEM PK no Oracle, mas IDTABELA é único
--    de fato (373/373) → PK aqui. Carga completa no cutover; a tela de manutenção do legado é o próprio
--    cadastro de PIS/COFINS (aba), fora deste corte.
CREATE TABLE IF NOT EXISTS pc_tipocreditoisento (
  idtabela            integer PRIMARY KEY,
  idpiscofins         integer,
  idbasecreditoisento integer,          -- o código NAT_REC do M410/M810 (pad-3 na emissão)
  descricao           varchar(500)
);
CREATE INDEX IF NOT EXISTS ix_pc_tipocredito_situacao ON pc_tipocreditoisento (idpiscofins, idtabela);

-- 2) CONFIGURACOES_SPED — COD_CTA do M400/M410/M800/M810 por EMPRESA: aponta PLANO_CONTAS e a emissão usa o
--    CODIEXPANDIDO da conta (QryConfiguracoesSPED no UdmSpedPisCofins.dfm: LEFT JOIN PLANO_CONTAS PM4xx ON
--    PM4xx.CODPLANOCONTAS = C.CODPLC_Mxxx_PC). No golden: 2 empresas configuradas (ex.: M400→183 'CAIXA
--    CENTRAL' 1.1.01.01.0001). Sem linha p/ a empresa → COD_CTA vazio (comportamento do corte-1).
CREATE TABLE IF NOT EXISTS configuracoes_sped (
  idempresa      integer PRIMARY KEY,
  codplc_m400_pc integer,
  codplc_m410_pc integer,
  codplc_m800_pc integer,
  codplc_m810_pc integer
);

-- 3) a natureza resolvida entra no DETALHE da apuração (tipo='I'), grupo (CST_PIS, CST_COFINS, natureza) —
--    espelha o dataset cdsBaseIsenta que o gerador itera. 999 já vem carimbado da apuração (caso nulo+CST08).
ALTER TABLE apuracao_pc_det ADD COLUMN IF NOT EXISTS id_basecreditoisento integer;
