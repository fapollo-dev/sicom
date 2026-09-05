-- 194 — RBAC: adotar os NOMES DO LEGADO onde o ato é o mesmo (§7w do plano de carga).
--
-- O ensaio de ESCRITA sobre a base de produção mostrou que 91 dos 176 pares (formulário, opção) que os
-- controllers exigem não existem nas permissões do cliente: o app perguntava por `BTNPROCESSAR` e o cliente
-- concede `ENVIARNFE1`, `BTNFATURAMENTO`, `CANCELARNFE1`… Efeito: depois da virada o sistema abriria e quase
-- nenhuma escrita funcionaria, para os 284 operadores.
--
-- Esta migration trata só a parte MECÂNICA — o mesmo ato com outro nome, com prova: o `Caption` do componente
-- no `.dfm` do legado (o texto que o operador lê no botão) e a contagem de grants reais do cliente. O que é
-- decisão de privilégio (34 atos sem permissão própria no legado) e o que é tela nova (7) NÃO entram aqui;
-- estão em `tools/cutover/rbac-equivalencias.md` esperando decisão do dono do sistema.
--
-- Os decorators já foram renomeados no código; aqui o banco acompanha, para que o seed das migrations
-- anteriores e as bases já criadas fiquem coerentes com o que o app passa a perguntar.

-- ── OPÇÕES: mesmo ato, nome do componente Delphi ──────────────────────────────────────────────────────────
--   BTNTRANSMITIR → ENVIARNFE1        (Caption "Enviar NFe")
--   BTNCANCELAR   → CANCELARNFE1      (Caption "Cancelar NFe")
--   BTNCCE        → BTNCARTACORRECAO  (Caption "Carta Correção")
--   BTNFATURAR    → BTNFATURAMENTO    (Caption "Faturam.")
--   BTNAJUSTAR    → BTNOK             (Caption "Ajustar")
--   BTNFECHAR     → MNIFECHARPEDIDO   (Caption "Fechar pedido")
UPDATE permissoes SET opcao = 'ENVIARNFE1'       WHERE form = 'FRMNF'             AND opcao = 'BTNTRANSMITIR';
UPDATE permissoes SET opcao = 'CANCELARNFE1'     WHERE form = 'FRMNF'             AND opcao = 'BTNCANCELAR';
UPDATE permissoes SET opcao = 'BTNCARTACORRECAO' WHERE form = 'FRMNF'             AND opcao = 'BTNCCE';
UPDATE permissoes SET opcao = 'BTNFATURAMENTO'   WHERE form = 'FRMNF'             AND opcao = 'BTNFATURAR';
UPDATE permissoes SET opcao = 'BTNOK'            WHERE form = 'FRMAJUSTEESTOQUE'  AND opcao = 'BTNAJUSTAR';
UPDATE permissoes SET opcao = 'MNIFECHARPEDIDO'  WHERE form = 'FRMPEDIDOCOMPRA'   AND opcao = 'BTNFECHAR';

-- ── FORMULÁRIOS: a MESMA tela, batizada diferente por nós ─────────────────────────────────────────────────
-- (entre parênteses, os grants que cada renomeação devolve na base do cliente)
UPDATE permissoes SET form = 'FRMCADAGENDAPROMOCAO'    WHERE form = 'FRMAGENDAPROMOCAO';     -- 233
UPDATE permissoes SET form = 'FRMAGRUPACONTASAPAGAR'   WHERE form = 'FRMAGRUPAPAGAR';        -- 42
UPDATE permissoes SET form = 'FRMAGRUPACONTASARECEBER' WHERE form = 'FRMAGRUPARECEBER';      -- 51
UPDATE permissoes SET form = 'FRMAPAGAR'               WHERE form = 'FRMCADAPAGAR';          -- 576
UPDATE permissoes SET form = 'FRMCADFAMILIAPROD'       WHERE form = 'FRMCADFAMILIAS';        -- 83
UPDATE permissoes SET form = 'FRMCADMOTIVOOPERACOES'   WHERE form = 'FRMCADMOTIVOOPERACAO';  -- 83
UPDATE permissoes SET form = 'FRMCADDEVOLUCAO'         WHERE form = 'FRMDEVOLUCAOCOMPRA';    -- 222

-- a renomeação pode colidir com um grant que já existia sob o nome novo (o mesmo operador tinha os dois).
-- `permissoes` não tem unicidade declarada no legado, mas duplicata aqui é ruído: limpa por (form, opcao,
-- operador, empresa) mantendo uma.
DELETE FROM permissoes p USING permissoes q
 WHERE p.ctid > q.ctid AND p.form = q.form AND p.opcao = q.opcao
   AND p.codoperador IS NOT DISTINCT FROM q.codoperador
   AND p.codempresa IS NOT DISTINCT FROM q.codempresa;

-- ⚠️ NÃO tratados aqui, de propósito (ver tools/cutover/rbac-equivalencias.md):
--   · 34 atos que o legado não tem como permissão própria — processar/reverter/contabilizar a NF, baixar e
--     estornar título, abrir/fechar caixa… No Delphi eram efeito de outro botão. Conceder por conta própria
--     ELEVA privilégio: quem só consultava passaria a mover estoque e dinheiro.
--   · 7 telas que o legado não tinha (FRMCAIXA com 9 opções, FRMDRE, 4 cadastros, conferência de nota).
--   Pista forte para a conversa sobre o caixa: o cliente tem `FRMFECHAMENTOCAIXA` (417 grants, com BTNABRIR,
--   BTNREABRIR, BTNFECHA) e `FRMMOVCAIXA` (227) — a nossa tela única junta as duas do legado.

-- ── SEGUNDA RODADA (mesma migration, ver §7w): as "telas novas" que na verdade existem no legado ───────────
-- O balde C tinha 7 formulários "que o cliente não tem". Investigando por DOMÍNIO (não por nome), quatro deles
-- são tela conhecida do legado com outro batismo — e um é a nossa tela única que lá são DUAS:
--   FRMCADCENTROCUSTO → FRMCADPLC          o nosso "centro de custo" é o Plano de Contas Gerencial (218 grants)
--   FRMDRE            → FRMRELDRECONTABIL  a nossa DRE é o relatório contábil (21)
--   FRMCADPRECO       → FRMCADTABELAPRECO  "Tabela de Reajuste"; o UDmCadTabelaPreco.dfm lê a tabela PRECO (45)
--   FRMCAIXA          → FRMFECHAMENTOCAIXA (417: abrir/fechar/reabrir) + FRMMOVCAIXA (227: movimento)
-- O caixa não vira UPDATE de nome: a permissão do legado é por TELA e a nossa tela junta as duas, então cada
-- AÇÃO passou a responder à sua (no controller). Aqui só as três renomeações diretas.
UPDATE permissoes SET form = 'FRMCADPLC'         WHERE form = 'FRMCADCENTROCUSTO';
UPDATE permissoes SET form = 'FRMRELDRECONTABIL' WHERE form = 'FRMDRE';
UPDATE permissoes SET form = 'FRMCADTABELAPRECO' WHERE form = 'FRMCADPRECO';

DELETE FROM permissoes p USING permissoes q
 WHERE p.ctid > q.ctid AND p.form = q.form AND p.opcao = q.opcao
   AND p.codoperador IS NOT DISTINCT FROM q.codoperador
   AND p.codempresa IS NOT DISTINCT FROM q.codempresa;

-- CAIXA: as migrations semearam os grants sob `FRMCAIXA` (048 e seguintes). Como cada AÇÃO passou a responder
-- ao formulário do legado, o seed precisa acompanhar — senão o operador de teste perde abrir/fechar/movimentar.
-- (No cliente esses grants já existem sob os nomes certos: 417 + 227.)
UPDATE permissoes SET form = 'FRMFECHAMENTOCAIXA'                     WHERE form = 'FRMCAIXA' AND opcao = 'BTNABRIR';
UPDATE permissoes SET form = 'FRMFECHAMENTOCAIXA', opcao = 'BTNFECHA' WHERE form = 'FRMCAIXA' AND opcao = 'BTNFECHAR';
UPDATE permissoes SET form = 'FRMFECHAMENTOCAIXA'                     WHERE form = 'FRMCAIXA' AND opcao = 'BTNREABRIR';
UPDATE permissoes SET form = 'FRMMOVCAIXA', opcao = 'BTNGRAVAR'       WHERE form = 'FRMCAIXA' AND opcao = 'BTNMOVIMENTAR';

DELETE FROM permissoes p USING permissoes q
 WHERE p.ctid > q.ctid AND p.form = q.form AND p.opcao = q.opcao
   AND p.codoperador IS NOT DISTINCT FROM q.codoperador
   AND p.codempresa IS NOT DISTINCT FROM q.codempresa;

-- Os três que SOBRAM do balde C, e por quê:
--   · FRMCADCIDADES — o legado não tem cadastro de cidades com permissão (a tabela vem do IBGE);
--   · FRMCADOPERACOESCONTA — a tela EXISTE no legado (`uCadOperacoesConta.dfm` → frmCadOperacoesConta), mas
--     **nenhum operador tem grant nela** no cliente. Manter sem grant é o fiel: lá também ninguém tem;
--   · FRMCONFERENCIANOTA — o form do legado é `FrmanalisaPedComp_NF`, que igualmente não aparece em PERMISSOES.
