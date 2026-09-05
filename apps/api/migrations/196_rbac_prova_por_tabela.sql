-- 196 — RBAC: quatro correções achadas pelo caminho INVERSO, e provadas pela TABELA que a tela manipula.
--
-- O §7w olhou "o que o app pede e o cliente não tem". Faltava o outro lado: **o que o cliente USA e o app não
-- tem**. Cruzando os 313 formulários do cliente com os 69 do app: 253 sem correspondente, somando 11.170 dos
-- 22.459 grants. Boa parte é tela que não migramos (esperado), mas o topo da lista revelou tela NOSSA com nome
-- errado — e um erro meu da rodada anterior.
--
-- A prova aqui não é o nome nem o Caption: é a **TABELA** que o data module do legado consulta. É o critério
-- mais duro dos três, e foi ele que pegou o erro.
--
-- 1) `FRMCADDEVOLUCAO` → `FRMCADPEDIDODEVOLUCAOCOMPRAS` (243 grants) — CORREÇÃO da mig 194. Ontem casei por
--    radical de nome e errei: `udmCadDevolucao.dfm` consulta `DEVOLUCAO`/`I_DEVOLUCAO` (outra tela, devolução de
--    venda), enquanto `uDMCadPedidoDevolucaoCompra.dfm` consulta **`PEDIDO_DEVOLUCAO_COMPRA` +
--    `PEDIDO_DEVOLUCAO_COMPRA_ITENS`**, que é exatamente o agregado da nossa tela.
UPDATE permissoes SET form = 'FRMCADPEDIDODEVOLUCAOCOMPRAS' WHERE form = 'FRMCADDEVOLUCAO';

-- 2) `FRMCADOPERADOR` → `FRMCADUSUARIOS` (249 grants). `FRMCADOPERADOR` **não existe** no cliente; quem cadastra
--    operador lá é o `uCadUsuarios`, cujo data module consulta `OPERADORES` + `RELACAO_OPERADOR_EMPRESA`.
--    (Na rodada anterior eu descartei `FRMCADOPERADORAS` — operadoras de CARTÃO — mas não procurei "usuários".)
UPDATE permissoes SET form = 'FRMCADUSUARIOS' WHERE form = 'FRMCADOPERADOR';

-- 3 e 4) BAIXA de título é TELA PRÓPRIA no legado — `FRMBAIXAAPAGAR` (287 grants) e `FRMBAIXAARECEBER` (209),
--    com o botão `BTNGRAVAR` de Caption **"Gravar baixa"**. As nossas ações de baixa/estorno respondiam ao
--    formulário do TÍTULO, onde o cliente nunca concedeu nada disso. Isto sai do balde "decisão de privilégio":
--    não é ato novo, é ato que já tem dono — 287 e 209 pessoas.
--    (Só o seed precisa acompanhar; no cliente os grants já existem sob os nomes certos.)
UPDATE permissoes SET form = 'FRMBAIXAAPAGAR',   opcao = 'BTNGRAVAR' WHERE form = 'FRMAPAGAR'      AND opcao IN ('BTNBAIXAR', 'BTNESTORNARBAIXA');
UPDATE permissoes SET form = 'FRMBAIXAARECEBER', opcao = 'BTNGRAVAR' WHERE form = 'FRMCADARECEBER' AND opcao IN ('BTNBAIXAR', 'BTNESTORNARBAIXA');

DELETE FROM permissoes p USING permissoes q
 WHERE p.ctid > q.ctid AND p.form = q.form AND p.opcao = q.opcao
   AND p.codoperador IS NOT DISTINCT FROM q.codoperador
   AND p.codempresa IS NOT DISTINCT FROM q.codempresa;

-- ⚠️ o que NÃO virou renomeação, e por quê:
--   · `FRMCADBALANCO` (147 grants) é o CRUD do balanço, tela que **não migramos** — os comandos de balanço que
--     temos vivem no popup do inventário e respondem a `FRMINVENTARIO`, que é onde o legado os tem;
--   · os outros 250 formulários do cliente sem correspondente são telas fora do escopo (PDV, cheque, ordem de
--     serviço, transferência, contábil) — a lista completa e o peso de cada uma estão no plano de carga (§7x).
