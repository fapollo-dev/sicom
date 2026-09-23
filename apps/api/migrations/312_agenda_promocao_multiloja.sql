-- 312 — AGENDA DE PROMOÇÃO multi-loja e o ciclo de vida do status (dossiê uCadAgendaPromocao.md §5; FILA Achado 20).
--
-- 1) O STATUS. `FLAGPROMOCAO` é o combo `cbbStatus` do form: N = ABERTA · E = EXECUTANDO · J = FECHADA
--    (uCadAgendaPromocao.dfm:505-520). A produção confirma: em 2025-26, E = as 6 agendas vigentes (todas com
--    DATAEXECUCAO), J = as 1.142 passadas, N = a 1 futura. Agenda nova nasce 'N' (udmCadAgendaPromocao.pas:359).
--    A mig 080 leu 'J' como "agendada = norma" e pôs DEFAULT 'J': toda agenda criada no Apollo nascia FECHADA.
-- 2) AS LOJAS. Quem decide em que loja o preço promocional entra é a lista de lojas de cada ITEM
--    (`agenda_promocao_itens.empresas`, '1, 2' — AtualizaAtivo:232 percorre a lista; o multi_preco segue ela em
--    106 de 108 agendas desde jun/2026). A `agenda_promocao_empresa` (mig 311) é o filtro do app de gestão
--    (Controller.GestaoMobile.pas:10210) e é gravada junto. Em 2026, 185 de 468 agendas valem para mais de uma loja.
-- 3) AS FLAGS DE MÍDIA do item são 'T'/'F' no legado (15.865 de 15.865 itens desde 2025 = 'F'); a mig 080 pôs 'S'/'N'.

ALTER TABLE agenda_promocao ALTER COLUMN flagpromocao SET DEFAULT 'N';

ALTER TABLE agenda_promocao_itens ALTER COLUMN tv SET DEFAULT 'F';
ALTER TABLE agenda_promocao_itens ALTER COLUMN radio SET DEFAULT 'F';
ALTER TABLE agenda_promocao_itens ALTER COLUMN tabloide SET DEFAULT 'F';
ALTER TABLE agenda_promocao_itens ALTER COLUMN interno SET DEFAULT 'F';
-- o que o Apollo gravou em 'S'/'N' antes desta correção (a carga traz 'T'/'F')
UPDATE agenda_promocao_itens SET tv = CASE tv WHEN 'S' THEN 'T' ELSE 'F' END WHERE tv IN ('S', 'N');
UPDATE agenda_promocao_itens SET radio = CASE radio WHEN 'S' THEN 'T' ELSE 'F' END WHERE radio IN ('S', 'N');
UPDATE agenda_promocao_itens SET tabloide = CASE tabloide WHEN 'S' THEN 'T' ELSE 'F' END WHERE tabloide IN ('S', 'N');
UPDATE agenda_promocao_itens SET interno = CASE interno WHEN 'S' THEN 'T' ELSE 'F' END WHERE interno IN ('S', 'N');

CREATE INDEX IF NOT EXISTS ix_agenda_promocao_empresa_emp ON agenda_promocao_empresa (codempresa);

-- as lojas de uma agenda: as dos itens (o que vale para o preço); sem itens com lista, as da agenda; sem nada, a dona
CREATE OR REPLACE FUNCTION agenda_promocao_lojas(p_codagenda integer, p_idempresa integer) RETURNS integer[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT array_agg(DISTINCT x::integer ORDER BY x::integer)
       FROM agenda_promocao_itens i,
            unnest(string_to_array(replace(i.empresas, ' ', ''), ',')) AS x
      WHERE i.codagenda = p_codagenda AND x ~ '^[0-9]+$'),
    (SELECT array_agg(e.codempresa::integer ORDER BY e.codempresa) FROM agenda_promocao_empresa e WHERE e.codagenda = p_codagenda),
    ARRAY[p_idempresa]
  )
$$;

DROP VIEW IF EXISTS get_agenda_promocao;
CREATE VIEW get_agenda_promocao AS
SELECT
  ap.codagenda AS codigo,
  ap.codagenda,
  ap.idempresa,
  ap.nomepromo,
  ap.dtiniciopromocao,
  ap.dtfimpromocao,
  ap.flagpromocao,
  CASE ap.flagpromocao WHEN 'N' THEN 'ABERTA' WHEN 'E' THEN 'EXECUTANDO' WHEN 'J' THEN 'FECHADA' ELSE ap.flagpromocao END AS status,
  ap.dataexecucao,
  ap.opcoes,
  ap.obs,
  ap.dtencerramento,
  ap.codoperadorenc,
  ap.indr,
  CASE
    WHEN ap.dtencerramento IS NOT NULL THEN 'ENCERRADA'
    WHEN now() < ap.dtiniciopromocao THEN 'AGENDADA'
    WHEN now() > ap.dtfimpromocao THEN 'EXPIRADA'
    ELSE 'VIGENTE'
  END AS situacao,
  array_to_string(agenda_promocao_lojas(ap.codagenda, ap.idempresa), ', ') AS empresas,
  COALESCE((SELECT COUNT(*) FROM agenda_promocao_itens i WHERE i.codagenda = ap.codagenda), 0) AS qtde_itens
FROM agenda_promocao ap;
COMMENT ON VIEW get_agenda_promocao IS 'AGENDA PROMOCAO';
