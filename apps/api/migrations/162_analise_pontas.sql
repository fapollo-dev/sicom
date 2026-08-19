-- 162 — ANÁLISE PEDIDO×NF, as pontas soltas do épico: (1) quem pode liberar vem de `USUCADASTRO`, não de
-- `CODOPERADOR`; (2) excluir a conferência da NF; (3) o dossiê de impressão. Fonte: `UAnalisePedidosNF.pas`,
-- `UFrmAnalisePedidosNF.pas` e `UanalisaPedComp_NF.pas`.

-- ── (1) USUCADASTRO: a coluna que o legado usa para saber QUEM é o comprador ────────────────────────────
-- `OperadorLiberaAnalise` (UAnalisePedidosNF.pas:876-905) compara o operador logado com **`vPedido.UsuCadastro`**,
-- e `SelecionaOperadorComprador` (:915+) monta a lista de compradores com o MESMO campo — não com CODOPERADOR.
-- No golden as duas colunas divergem: `PEDIDOCOMPRA` tem 10.392 linhas, `USUCADASTRO` preenchido em 10.221,
-- `CODOPERADOR` em 100%, **iguais em 9.987 e DIFERENTES em 234** (2,3%) — ou seja, em 234 pedidos a permissão de
-- liberar muda dependendo da coluna. O corte-2c usava `codoperador`; passa a usar `usucadastro`.
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS usucadastro integer; -- quem CADASTROU o pedido (o "comprador")
-- backfill: nas nossas linhas quem cadastra é o operador do contexto, que é o que já está em CODOPERADOR.
UPDATE pedidocompra SET usucadastro = codoperador WHERE usucadastro IS NULL;
CREATE INDEX IF NOT EXISTS ix_pedidocompra_usucadastro ON pedidocompra (usucadastro);

-- ── (2) EXCLUIR A CONFERÊNCIA DA NF ────────────────────────────────────────────────────────────────────
-- `btnExcluirConferenciaClick` (UanalisaPedComp_NF.pas:1120) exige **senha administrativa ADM** e zera o vínculo
-- da NF com o pedido: `UPDATE <tabela> SET CODPEDCOMP=NULL, CODOPERADOR_LIBERACAO=NULL, STATUS_PEDCOMP=NULL,
-- STATUS_QTD_PEDCOMP=NULL WHERE <chave> [AND IDEMPRESA]`. A tabela é a NF (chave CODNF) ou a NFE_NAO_CADASTRADAS
-- (chave + empresa) — as duas pontas de onde a conferência nasce. As colunas já existem (migs 087/088/157);
-- o que faltava era o VERBO. Nada a criar aqui além do registro.

-- ── (3) o DOSSIÊ de impressão ──────────────────────────────────────────────────────────────────────────
-- `ImprimirAnalise` (UAnalisePedidosNF.pas:697) monta 3 consultas: o cabeçalho com `LISTAGG` das notas e dos
-- pedidos da análise, os itens divergentes e os itens que só existem em um dos lados. Tudo já está nas tabelas da
-- mig 152 — o corte expõe a projeção; a impressão em si usa a camada de impressão global do app.
