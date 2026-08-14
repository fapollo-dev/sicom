-- 145 — rel 40 (Vendas ICMS) e base das rel 43/50: o catálogo DET_ALIQUOTA (alíquota × UF → ICMS efetivo).
-- 240 linhas no golden (catálogo fiscal, não movimento). A rel 40 resolve o percentual pela UF DA EMPRESA
-- e zera as alíquotas de substituição/isenção ('STB','IST','NTB') — regra no CASE do serviço, fiel.
CREATE TABLE IF NOT EXISTS det_aliquota (
  aliquota          char(3) NOT NULL,
  uf                char(2) NOT NULL,
  icm               numeric(13,2),
  icm_efetivo       numeric(13,2),
  base              numeric(13,2),
  cst               integer,
  csosn             varchar(12),
  descricaoaliquota varchar(100),
  PRIMARY KEY (aliquota, uf)
);
