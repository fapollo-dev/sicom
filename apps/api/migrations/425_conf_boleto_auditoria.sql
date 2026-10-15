-- 425 — a auditoria do Boleto/Remessa (uConfBoleto, FRMCONFBOLETO).
--
-- (1) rel_get_areceber: a GET_ARECEBER da produção (USER_VIEWS, lida em 15/10/2026, 66 colunas) — a Pesquisa do "Importar títulos"
-- (btnImportarTitulosClick, uConfBoleto.pas:1863: TfrmPesquisa 'GET_ARECEBER' com IDEMPRESA IN (lojas) AND ATIVADO = 'S' [AND CODBCO]).
-- Não é a GET_RCB (a do contas a receber): é a mais velha, só os abertos e não agrupados (WHERE R.QUITADA = 'N' AND COALESCE(AGRUPADO,'N')
-- = 'N'), com os dias como o Oracle conta CURRENT_DATE − CAST(DTVENC AS DATE) (com a hora, arredondado no CAST NUMERIC(10) — a mesma
-- leitura da mig 410) e a taxa diária do JURO arredondada a 2 casas. MES_ANO = SubStr(dtvenc,4,20) com o NLS de data da instância
-- (NLS_TERRITORY BRAZIL → 'DD/MM/RR'): 'MM/RR'.
DROP VIEW IF EXISTS rel_get_areceber;
CREATE VIEW rel_get_areceber AS
WITH base AS (
  SELECT r.*, extract(epoch FROM (localtimestamp - r.dtvenc::timestamp))::numeric / 86400 AS d_atraso
    FROM areceber r
)
SELECT c.razao                                                              AS cliente,
       r.dtvenc::date                                                       AS data_vencimento,
       r.dtvenda::date                                                      AS data_venda,
       c.codref                                                             AS referencia,
       r.valor,
       r.txjuros,
       r.duplicata,
       round(CASE WHEN r.d_atraso < 0 THEN 0 ELSE r.d_atraso END)::numeric(10) AS dias_atrazo,
       coalesce(c.tolerancia, 0)::numeric(10)                               AS dias_tolerancia,
       (CASE WHEN r.d_atraso < c.tolerancia THEN 0
             ELSE coalesce((r.txjuros / 30::numeric(13,8))::numeric(13,2) * round(CASE WHEN r.d_atraso < 0 THEN 0 ELSE r.d_atraso END) * r.valor / 100, 0)::numeric(13,2)
        END)::numeric(13,2)                                                 AS juro,
       (CASE WHEN r.d_atraso < c.tolerancia THEN r.valor
             ELSE coalesce(r.txjuros / 30::numeric(13,8), 0) * coalesce(round(CASE WHEN r.d_atraso < 0 THEN 0 ELSE r.d_atraso END) * r.valor / 100, 0) + r.valor
        END)::numeric(13,2)                                                 AS total,
       r.codrcb                                                             AS codigo,
       r.nrocupom                                                           AS nro_cupom,
       r.docnf                                                              AS nro_nf,
       r.obs,
       v.razao                                                              AS vendedor,
       co.razao                                                             AS cobrador,
       o.nome                                                               AS operador,
       l.login                                                              AS logado,
       r.nropedido                                                          AS nro_pedido,
       r.codempresa                                                         AS idempresa,
       r.gerado,
       r.tipodoc                                                            AS tipo_documento,
       c.codparceiro                                                        AS codigo_cliente,
       o.codoperador                                                        AS codigo_operador,
       co.codparceiro                                                       AS codigo_cobrador,
       v.codparceiro                                                        AS codigo_vendedor,
       r.codgrupo                                                           AS codigo_grupo,
       r.codpdv                                                             AS pdv,
       r.idpgto,
       c.codconvenio,
       x.razao                                                              AS desconvenio,
       r.lotecob                                                            AS lote_cobranca,
       r.codbco,
       r.quitada,
       r.idnf,
       r.nrodup,
       r.codoperadorman,
       r.nrodoc,
       r.parcela,
       r.codcx,
       r.antecipado,
       c.cli                                                                AS somente_cliente,
       c.fun                                                                AS somente_funcionario,
       e.endereco                                                           AS endereco_cobranca,
       e.bairro                                                             AS bairro_cobranca,
       e.cidade                                                             AS cidade_cobranca,
       e.uf                                                                 AS uf_cobranca,
       e.telefone,
       r.datalotcob::date                                                   AS data_lote_cobranca,
       r.registro_arq_remessa,
       r.nome_arq_remessa,
       r.login_arq_remessa,
       r.data_arq_remessa,
       c.ativado,
       r.codconta                                                           AS conta_transferencia,
       r.datatransf                                                         AS data_transferencia,
       r.lotetransf                                                         AS lote_transferencia,
       r.status_boleto,
       r.consiliado,
       (r.dtvenda::date - r.dtvenc::date)::numeric                          AS dias_intervalo,
       to_char(r.dtvenc, 'MM/YY')                                           AS mes_ano,
       r.agrupado,
       r.codadiantamento,
       r.dtagendamento::date                                                AS dtagendamento
  FROM base r
  LEFT JOIN parceiros v      ON v.codparceiro = r.codvendedor
  LEFT JOIN parceiros co     ON co.codparceiro = r.codcobrador
  LEFT JOIN operadores o     ON o.codoperador = r.codoperador
  LEFT JOIN parceiros c      ON c.codparceiro = r.codparceiro
  LEFT JOIN operadores l     ON l.codoperador = r.codoperadorman
  LEFT JOIN parceiros x      ON c.codconvenio = x.codparceiro
  LEFT JOIN parceiros_end e  ON e.codend = c.codend
 WHERE r.quitada = 'N'
   AND coalesce(r.agrupado, 'N') = 'N';
-- sem COMMENT: a GET_ARECEBER não está no catálogo do construtor de relatórios da produção (a `rel_` fora do catálogo fica sem rótulo)

-- (2) as configurações que a tela lê e o destino não tinha, com o valor GLOBAL da produção (a específica de cada cliente vem na carga):
-- CONTA_PADRAO_BOLETO (GetContaBancariaPadrao, FormCreate :893 — a conta que a tela já abre escolhida; na produção '' com a específica
-- do módulo Retaguarda) e GERA_REMESSA_AUTOMATICAMENTE (btnBoletoClick :3150 — S gera, P pergunta "Deseja gerar o arquivo remessa?",
-- N não; produção 'P').
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
SELECT v.id, v.codigo, v.valor, v.tipovalor, v.permitidas, v.descricao
  FROM (VALUES
    (306, 'CONTA_PADRAO_BOLETO', '', 'Integer', 'Modulo;Empresa;Grupo;Usuario', 'Conta bancária que a tela de boleto já abre escolhida (GetContaBancariaPadrao).'),
    (209, 'GERA_REMESSA_AUTOMATICAMENTE', 'P', 'String', 'Modulo;Empresa;Grupo;Usuario', 'Depois de emitir o boleto: S gera a remessa, P pergunta, N não gera (btnBoletoClick).')
  ) AS v(id, codigo, valor, tipovalor, permitidas, descricao)
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes c WHERE c.codigo = v.codigo OR c.id = v.id);
