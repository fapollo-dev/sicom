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

-- A NOTA JÁ FATURADA (23/09/2026). O Apollo marca `nf.faturada='S'` ao gerar os títulos (F4) e exige o 'S' para o
-- ESTORNO do faturamento; o legado não tem o flag — a nota faturada é a que tem título (`IDNF` em ARECEBER/APAGAR).
-- A carga põe o padrão 'N' em todas: sem isto, nenhuma nota migrada poderia ter o faturamento estornado. Idempotente.
UPDATE nf SET faturada = 'S'
 WHERE coalesce(faturada, 'N') <> 'S'
   AND (EXISTS (SELECT 1 FROM areceber r WHERE r.idnf = nf.codnf)
        OR EXISTS (SELECT 1 FROM apagar p WHERE p.idnf = nf.codnf));

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
