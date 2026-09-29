-- GET_NF_MANIFESTO lê os eventos de NFE_EVENTOS (CHAVE_ACESSO), como a view da produção. A mig 397 lia `nfe_evento` — a
-- tabela da emissão de NF-e do Apollo (mig 030), que a carga enche com uma cópia do NFE_EVENTOS mas que o manifesto NÃO
-- grava: depois da virada, a ciência/confirmação enviada pelo Apollo (gravada em nfe_eventos, como o legado) não
-- apareceria nas colunas CONFIRMACAO/CIENCIA/... da view. A grade do manifesto passa a ser esta view (o legado:
-- `SELECT * FROM GET_NF_MANIFESTO /*FILTRO*/ ORDER BY DATA_EMISSAO DESC, RAZAO`, uDMManifestoDFe.dfm).
CREATE OR REPLACE VIEW get_nf_manifesto (numero_nf, data_emissao, total_nf, chave, cadastrada, codigo, cnpj_cpf, razao, importacao, processada, tipo,
                                         confirmacao, ciencia, naorealizada, desconhecimento, cancelamento, outros_eventos, idempresa, status_nfe, obs_nf,
                                         cnpj_emitente, processo_atual, contingencia, cfop, serie, vincula_ent_dev, cod_vincula_ent_dev, tipoemissao,
                                         data_contabil) AS
WITH janela AS (
  SELECT current_date - coalesce((SELECT ce.valor FROM configuracoes_especificas ce
                                   WHERE ce.id = (SELECT c.id FROM configuracoes c WHERE c.codigo = 'DIAS_RETROATIVOS_FILTRO_MANIFESTO' LIMIT 1)
                                   LIMIT 1), '90')::integer AS de,
         current_date AS ate
),
ev AS (
  SELECT chave_acesso AS chavenfe,
         bool_or(tipo_evento = 210200) AS confirmacao, bool_or(tipo_evento = 210210) AS ciencia, bool_or(tipo_evento = 210240) AS naorealizada,
         bool_or(tipo_evento = 210220) AS desconhecimento, bool_or(tipo_evento = 110111) AS cancelamento,
         bool_or(tipo_evento NOT IN (210200, 210210, 210240, 210220, 110111)) AS outros
    FROM nfe_eventos GROUP BY chave_acesso
)
SELECT n.nronf, n.dtemissao, n.totalnf, n.chavenfe, 'SIM'::char(3), n.codnf::numeric(10), e.cnpj_cpf, upper(p.razao), n.nf_importacao_nfe,
       CASE WHEN n.proc = 'S' THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN n.tipo = 'E' THEN 'ENTRADA' ELSE 'SAIDA' END,
       CASE WHEN ev.confirmacao THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.ciencia THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.naorealizada THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.desconhecimento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.cancelamento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.outros THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       n.idempresa::numeric(10),
       CASE WHEN n.statusnfe = 'P' AND n.tpemissao = 1 THEN 'NFE ENVIADA A RECEITA'
            WHEN n.statusnfe = 'P' AND n.tpemissao IN (6, 7) THEN 'NFE ENVIADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'C' AND n.tpemissao = 1 THEN 'NFE CANCELADA NA RECEITA'
            WHEN n.statusnfe = 'C' AND n.tpemissao IN (6, 7) THEN 'NFE CANCELADA EM CONTINGENCIA'
            WHEN n.statusnfe = 'D' THEN 'NFE DENEGADA NA RECEITA' ELSE n.statusnfe::varchar END,
       nullif(n.obsnf, ''), em.cnpj,
       CASE WHEN n.codnfstatuspro IS NULL THEN ' - '
            ELSE (SELECT concat(nsp.processo_desc, ' - ', CASE nsp.status WHEN 'P' THEN 'Pendente' WHEN 'A' THEN 'Andamento' WHEN 'R' THEN 'Realizado' END)
                    FROM nf_status_processo nsp WHERE nsp.codnfstatuspro = n.codnfstatuspro) END,
       CASE WHEN n.statusnfe = 'P' AND n.tpemissao IN (6, 7) THEN 'SIM' ELSE 'NAO' END,
       CASE WHEN n.cfop ~ '^\d+$' THEN n.cfop::numeric END, n.serie,
       CASE WHEN nr.chavenfe_dev IS NOT NULL THEN 'SIM' ELSE 'NAO' END, nr.chavenfe_dev,
       CASE WHEN n.tipoemissao ~ '^\d+$' THEN n.tipoemissao::numeric END, n.dtcontabil
  FROM nf n
  CROSS JOIN janela j
  LEFT JOIN parceiros p                  ON p.codparceiro = n.codparceiro
  LEFT JOIN parceiros_end e              ON e.codparceiro = p.codparceiro AND e.ativado = 'S'
                                        AND e.codend = (SELECT max(b.codend) FROM parceiros_end b WHERE b.codparceiro = p.codparceiro)
  LEFT JOIN empresas em                  ON em.idempresa = n.idempresa
  LEFT JOIN nfe_ref_dev_ent_vinculo nr   ON nr.chavenfe = n.chavenfe
  LEFT JOIN ev                           ON ev.chavenfe = n.chavenfe
 WHERE n.chavenfe IS NOT NULL AND n.dtemissao BETWEEN j.de AND j.ate
UNION ALL
SELECT n.nronf, n.dtemissao, n.totalnf, n.chavenfe, 'NAO'::char(3), n.codnfe_naocad::numeric(10), n.cnpj, n.razao, 'N'::char(1), 'NAO'::char(3),
       CASE WHEN n.tipo = 'E' THEN 'ENTRADA' ELSE 'SAIDA' END,
       CASE WHEN ev.confirmacao THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.ciencia THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.naorealizada THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.desconhecimento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       CASE WHEN ev.cancelamento THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END, CASE WHEN ev.outros THEN 'SIM'::char(3) ELSE 'NAO'::char(3) END,
       n.idempresa::numeric(10),
       CASE n.situacao WHEN 1 THEN 'NFE ENVIADA A RECEITA' WHEN 2 THEN 'NFE DENEGADA NA RECEITA' WHEN 3 THEN 'NFE CANCELADA NA RECEITA' ELSE 'DESCONHECIDO' END,
       NULL::varchar(4000), coalesce(n.cnpj_destinatario, n.cnpj),
       CASE WHEN n.codnfstatuspro IS NULL THEN ' - '
            ELSE (SELECT concat(nsp.processo_desc, ' - ', CASE nsp.status WHEN 'P' THEN 'Pendente' WHEN 'A' THEN 'Andamento' WHEN 'R' THEN 'Realizado' END)
                    FROM nf_status_processo nsp WHERE nsp.codnfstatuspro = n.codnfstatuspro) END,
       CASE WHEN coalesce(n.importacao_manual, 'N') = 'S' THEN 'SIM' ELSE 'NAO' END, 0, substr(n.chavenfe, 23, 3),
       CASE WHEN nr.chavenfe_dev IS NOT NULL THEN 'SIM' ELSE 'NAO' END, nr.chavenfe_dev, 0, n.dtemissao::date
  FROM nfe_nao_cadastradas n
  CROSS JOIN janela j
  LEFT JOIN nfe_ref_dev_ent_vinculo nr   ON nr.chavenfe = n.chavenfe
  LEFT JOIN ev                           ON ev.chavenfe = n.chavenfe
 WHERE coalesce(n.nfe_importada_sistema, 'N') = 'N' AND n.dtemissao::date BETWEEN j.de AND j.ate;
COMMENT ON VIEW get_nf_manifesto IS 'NFE MANIFESTO DEST.';
