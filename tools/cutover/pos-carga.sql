-- PÓS-CARGA — o que o Apollo precisa ter no banco e o LEGADO não tem.
--
-- O carregador TRUNCA cada tabela antes de carregar (o ensaio parte do vazio), e com isso leva junto as linhas que
-- as nossas migrations semeiam. Quase tudo que semeamos o legado também tem (vem na carga). O que fica aqui é a
-- exceção declarada: dado que o legado NÃO tem e o Apollo exige — reaplicado no fim da carga, idempotente.
-- Este arquivo é lido por `apps/api/scripts/carregar-cutover.ts` depois da última tabela e ANTES da conferência de
-- órfãos, para o que ele semeia contar como pai.

-- motivo 999: o legado grava CODMOTIVO = 999 em milhares de ajustes de estoque (4.874 em produção) e não tem a
-- linha em MOTIVOS_OPERACAO — lá não há FK. Aqui `ajuste_estoque.codmotivo` REFERENCES motivos_operacao, então a
-- linha precisa existir (é a mesma da mig 171, que a carga apaga ao truncar a tabela).
INSERT INTO motivos_operacao (codmotivoop, descricao)
SELECT 999, 'AJUSTE DE INVENTARIO (codigo 999 do legado)'
WHERE NOT EXISTS (SELECT 1 FROM motivos_operacao WHERE codmotivoop = 999);

-- CONFIGURAÇÕES QUE SÃO NOSSAS: o legado não tem estas cinco chaves (medido em produção, §7u do plano), elas são
-- semeadas por migration — e o TRUNCATE de `configuracoes` na carga apaga. Sem elas o app pós-virada fica sem
-- lockout de login, sem lockout da senha de operação e **sem fuso horário** (o `FUSO_HORARIO_ACESSO` governa a
-- janela de acesso do operador e todo balde de data por dia — lição 17). Reaplicadas com os mesmos valores das
-- migrations 071/096/107. `ON CONFLICT DO NOTHING` por id E por código: se o cliente um dia criar a chave no
-- legado, o valor dele prevalece.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
SELECT * FROM (VALUES
  (328, 'AUTH_MAX_TENTATIVAS_LOGIN',            '5',                 'numero', 'Modulo', 'Falhas consecutivas de login que bloqueiam o operador (0 = sem lockout).'),
  (329, 'AUTH_BLOQUEIO_LOGIN_MINUTOS',          '15',                'numero', 'Modulo', 'Minutos de bloqueio do operador após exceder AUTH_MAX_TENTATIVAS_LOGIN.'),
  (333, 'AUTH_MAX_TENTATIVAS_SENHA_OPERACAO',   '5',                 'numero', 'Modulo', 'Falhas consecutivas na senha de operação (por empresa+tipo) que bloqueiam (0 = sem lockout).'),
  (334, 'AUTH_BLOQUEIO_SENHA_OPERACAO_MINUTOS', '15',                'numero', 'Modulo', 'Minutos de bloqueio da senha de operação após exceder AUTH_MAX_TENTATIVAS_SENHA_OPERACAO.'),
  (335, 'FUSO_HORARIO_ACESSO',                  'America/Sao_Paulo', 'texto',  'Modulo', 'Fuso IANA para avaliar a janela de horário de acesso do operador (OPERADORES_RESTRICAO_ACESSO) no login/refresh.')
) AS c(id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
WHERE NOT EXISTS (SELECT 1 FROM configuracoes x WHERE x.id = c.id OR x.codigo = c.codigo);

-- O CARIMBO DE "RECEBIDO" DO PEDIDO DE COMPRA (23/09/2026). No legado `PEDIDOCOMPRA.DTFATURAMENTO` é a data DIGITADA
-- (a base das parcelas) e a carga a leva para `data_faturamento` (RENOMEIA do `extrair.py`); o `dtfaturamento` do
-- Apollo é outra coisa — o carimbo da PRIMEIRA nota de entrada do pedido, que trava a edição (mig 060/087). O legado
-- não tem esse carimbo: ele sai da nota vinculada (`NF.CODPEDCOMP`: 3.269 notas, 3.193 pedidos; a outra perna da
-- `GET_PEDIDO_NF`, `PEDIDO_NF` tipo 'P', tem 1 linha). Sem isto, ou todo pedido chegaria travado (a data digitada
-- no carimbo — 100% dos pedidos a têm) ou nenhum (o pedido já recebido voltaria editável). Idempotente.
UPDATE pedidocompra p
   SET dtfaturamento = x.primeira
  FROM (SELECT codpedcomp, min(coalesce(dtcontabil, dtemissao)) AS primeira
          FROM nf
         WHERE codpedcomp IS NOT NULL AND coalesce(cancelada, 'N') <> 'S'
         GROUP BY codpedcomp) x
 WHERE x.codpedcomp = p.codpedcomp
   AND p.dtfaturamento IS NULL;

-- (o `nf.faturada` do Apollo saiu no corte D do faturamento, mig 343: a nota com financeiro é a que tem título pela IDNF, como no legado)

-- O TURNO DO PDV QUE O LEGADO JÁ CONTABILIZOU (recon do fechamento de caixa, 23/09/2026). A contabilização do legado marca os
-- lançamentos de CAIXA do fechamento (ORIGEM 'FECHAMENTO', mesmo CODGRUPO do turno) e nunca o CX_VENDAS — CONTABILIZADO vem
-- nulo em 100% dos 474.750 registros de 2026. A contabilização do PDV do Apollo seleciona o turno "não contabilizado" pelo
-- CX_VENDAS: sem isto, repostaria no razão todos os turnos migrados (R$ 19,9 mi em 2026, já no DIÁRIO pela origem 17).
-- Idempotente. (O serviço tem a mesma guarda, para a carga incremental.)
UPDATE cx_vendas cv SET contabilizado = 'S'
 WHERE coalesce(cv.contabilizado, 'N') <> 'S'
   AND cv.codgrupo IS NOT NULL
   AND EXISTS (SELECT 1 FROM caixa c WHERE c.codgrupo = cv.codgrupo AND c.origem = 'FECHAMENTO' AND c.contabilizado = 'S');

-- O GRUPO DO CAIXA (mig 319): a sequência do legado (ID_CODGRUPO) é uma só para CAIXA, CX_VENDAS e CX_APAGAR — a carga a
-- reposiciona pelo CAIXA; aqui, pelo maior dos três (produção: caixa 107.111, cx_apagar 107.111, cx_vendas 107.089).
SELECT setval('seq_caixa_codgrupo', greatest(
  coalesce((SELECT max(codgrupo) FROM caixa), 0),
  coalesce((SELECT max(codgrupo) FROM cx_vendas), 0),
  coalesce((SELECT max(codgrupo) FROM cx_apagar), 0))::bigint + 1, false);

-- O LOTE DE BAIXA (mig 323): `seq_idlote` é o ID_IDLOTE do legado — um só para as baixas de A Pagar/A Receber, cartão,
-- cheque e o fechamento. Não é OWNED por coluna (a carga não o reposiciona sozinha): aqui, depois do maior lote carregado,
-- fora as faixas altas próprias do Apollo (reversão 900.000.000, desconto de título 800.000.000).
SELECT setval('seq_idlote', greatest(
  coalesce((SELECT max(idlote) FROM apagar_bx WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM areceber_bx WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM apagar WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM areceber WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM caixa WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlotebxcartao) FROM caixa WHERE idlotebxcartao < 800000000), 0),
  coalesce((SELECT max(idlote) FROM cartao WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM cartao_bx WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM cheque WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM chq_proprio WHERE idlote < 800000000), 0),
  coalesce((SELECT max(idlote) FROM mov_contas_bancarias WHERE idlote < 800000000), 0))::bigint + 1, false);

-- A GRADE FINANCEIRA DO MANIFESTO (mig 329): a sequência do ID_ID_FM depois das parcelas carregadas.
SELECT setval('seq_nfe_financeiro_manifesto', coalesce((SELECT max(id_fm) FROM nfe_financeiro_manifesto), 0)::bigint + 1, false);

-- A SUGESTÃO DE PROMOÇÃO (mig 330): a sequência depois das sugestões carregadas.
SELECT setval('seq_sugest_promo_prod', coalesce((SELECT max(idsugest_promo_prod) FROM sugest_promo_prod), 0)::bigint + 1, false);
-- mig 339: a fila do manifesto (NFE_NAO_CADASTRADAS) e a esteira da nota (NF_STATUS_PROCESSO) depois da carga
SELECT setval('seq_nfe_nao_cadastradas', coalesce((SELECT max(codnfe_naocad) FROM nfe_nao_cadastradas), 0)::bigint + 1, false);
SELECT setval('seq_nf_status_processo', coalesce((SELECT max(codnfstatuspro) FROM nf_status_processo), 0)::bigint + 1, false);
-- mig 334: o cabeçalho do lançamento provisório do fechamento de caixa (DADOSCX, 133 linhas na produção)
SELECT setval('seq_dadoscx', coalesce((SELECT max(coddadoscx) FROM dadoscx), 0)::bigint + 1, false);
-- as PARCELAS da nota (FATURAMENTO, mig 246): a partir do corte A do faturamento a nota grava as parcelas — a sequência
-- não é OWNED pela coluna (o setval genérico do carregador não a acha), então vai aqui, depois das 47 mil carregadas
SELECT setval('seq_faturamento', coalesce((SELECT max(codfaturamento) FROM faturamento), 0)::bigint + 1, false);
-- o código do centro de custo (mig 349): depois do maior carregado
SELECT setval('seq_plc', coalesce((SELECT max(codplc) FROM plc), 0)::bigint + 1, false);
-- o sequencial GLOBAL da remessa por banco (GetID('NRSEQREMESSAITAU'/'NRSEQREMESSABB'): o BB o imprime no header 101-107, e repetir
-- um número já enviado faz o banco recusar o arquivo). As migs 153/154 começam em 3132/705 (o golden); a produção já está em 6822/1682
-- (auditoria de esqueletos §4.18). Reposiciona pelo maior número gravado em REMESSAS_BOLETOS, sem voltar para trás.
SELECT setval('seq_remessa_banco_itau', greatest((SELECT last_value FROM seq_remessa_banco_itau),
  coalesce((SELECT max(codremessabanco) FROM remessas_boletos WHERE nomebanco IN ('BANCO ITAU SA', 'Banco Itau')), 0))::bigint);
SELECT setval('seq_remessa_banco_bb', greatest((SELECT last_value FROM seq_remessa_banco_bb),
  coalesce((SELECT max(codremessabanco) FROM remessas_boletos WHERE nomebanco = 'Banco do Brasil'), 0))::bigint);

-- A DATA DO TÍTULO A PAGAR (mig 327): o legado só tem DTCOMPRA; a tela do Apollo lê `dtvenda`. A trigger da mig 327
-- sincroniza as duas a cada gravação — aqui para o caso de a carga ter rodado com as triggers desligadas. Idempotente.
UPDATE apagar SET dtvenda = (dtcompra::timestamp AT TIME ZONE 'America/Sao_Paulo') WHERE dtvenda IS NULL AND dtcompra IS NOT NULL;

-- O CENTRO DE CUSTO E A DATA DE PAGAMENTO DO TÍTULO A PAGAR (colunas só do Apollo, 24/09/2026). No legado o CC do título
-- mora no rateio CX_APAGAR (por grupo) e a data de pagamento na baixa (APAGAR_BX); a tela do Apollo lê `apagar.codplc` e
-- `apagar.dtpgto`, que a carga não preenche — o título migrado apareceria sem CC e, pago, sem data de pagamento. O CC é o
-- da 1ª linha de valor do rateio do grupo (a grade do legado mostra essa); a data, a da última baixa ativa. Idempotente.
UPDATE apagar a SET codplc = x.codcc
  FROM (SELECT DISTINCT ON (codgrupo) codgrupo, codcc FROM cx_apagar
         WHERE coalesce(tipo, 'V') = 'V' AND codcc IS NOT NULL ORDER BY codgrupo, codcxapagar) x
 WHERE a.codgrupo = x.codgrupo AND a.codplc IS NULL;
UPDATE apagar a SET dtpgto = b.dt
  FROM (SELECT codapg, max(dtpgto) AS dt FROM apagar_bx WHERE coalesce(indr, 'I') <> 'E' GROUP BY codapg) b
 WHERE a.codapg = b.codapg AND a.quitada = 'S' AND a.dtpgto IS NULL;

-- ── Achado 21 (24/09/2026): colunas só do Apollo que a tela/serviço lê e a carga não preenche ─────────────────────────────
-- O SALDO DA BAIXA PARCIAL: o estorno da baixa do Apollo apaga o título de saldo pelo vínculo `codapg_gerado`/`codrcb_gerado`,
-- que o legado não tem. No A Pagar o saldo (ORIGEM 'B') aponta o título pai (CODAPG_PAI) e o lote (604 de 604 casam).
UPDATE apagar_bx b SET codapg_gerado = s.codapg
  FROM apagar s
 WHERE b.codapg_gerado IS NULL AND s.origem = 'B' AND s.codapg_pai = b.codapg AND s.idlote = b.idlote;
-- No A Receber não há CODRCB_PAI: o pai vem da OBS ("…baixa parcial do título Nº:151…") ou, na forma "…do lote: N", do lote
-- com um só título baixado do mesmo cliente (256 de 293); o que fica ambíguo segue sem vínculo (o estorno não o apaga).
UPDATE areceber_bx b SET codrcb_gerado = s.codrcb
  FROM areceber s
 WHERE b.codrcb_gerado IS NULL AND s.origem = 'B' AND s.idlote = b.idlote AND s.obs ~ 'Nº:[0-9]+'
   AND substring(s.obs from 'Nº:([0-9]+)')::int = b.codrcb;
UPDATE areceber_bx b SET codrcb_gerado = s.codrcb
  FROM areceber s, areceber p
 WHERE b.codrcb_gerado IS NULL AND coalesce(b.indr, 'I') = 'I' AND p.codrcb = b.codrcb
   AND s.origem = 'B' AND s.idlote = b.idlote AND s.codparceiro = p.codparceiro AND s.obs !~ 'Nº:[0-9]+'
   AND NOT EXISTS (SELECT 1 FROM areceber_bx b2 JOIN areceber p2 ON p2.codrcb = b2.codrcb
                    WHERE b2.idlote = b.idlote AND p2.codparceiro = p.codparceiro AND coalesce(b2.indr, 'I') = 'I' AND b2.codrcbbx <> b.codrcbbx)
   AND (SELECT count(*) FROM areceber s2 WHERE s2.origem = 'B' AND s2.idlote = b.idlote AND s2.codparceiro = p.codparceiro) = 1
   AND NOT EXISTS (SELECT 1 FROM areceber_bx b3 WHERE b3.codrcb_gerado = s.codrcb);

-- O Nº DO PEDIDO DO A RECEBER: a tela do Apollo usa `nroped`; o legado grava NROPEDIDO (12.656 títulos em 2026).
UPDATE areceber SET nroped = nropedido WHERE nroped IS NULL AND nropedido IS NOT NULL;

-- O CÓDIGO IBGE DA UF DA EMPRESA (`cuf`): a emissão da NF-e exige, o legado não tem a coluna (deriva da UF).
UPDATE empresas SET cuf = CASE upper(trim(uf))
    WHEN 'RO' THEN 11 WHEN 'AC' THEN 12 WHEN 'AM' THEN 13 WHEN 'RR' THEN 14 WHEN 'PA' THEN 15 WHEN 'AP' THEN 16 WHEN 'TO' THEN 17
    WHEN 'MA' THEN 21 WHEN 'PI' THEN 22 WHEN 'CE' THEN 23 WHEN 'RN' THEN 24 WHEN 'PB' THEN 25 WHEN 'PE' THEN 26 WHEN 'AL' THEN 27
    WHEN 'SE' THEN 28 WHEN 'BA' THEN 29 WHEN 'MG' THEN 31 WHEN 'ES' THEN 32 WHEN 'RJ' THEN 33 WHEN 'SP' THEN 35 WHEN 'PR' THEN 41
    WHEN 'SC' THEN 42 WHEN 'RS' THEN 43 WHEN 'MS' THEN 50 WHEN 'MT' THEN 51 WHEN 'GO' THEN 52 WHEN 'DF' THEN 53 END
 WHERE cuf IS NULL AND uf IS NOT NULL;
