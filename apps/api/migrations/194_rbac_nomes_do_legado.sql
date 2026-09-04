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
