-- 218 — PREENCHER COTAÇÃO (`FRMCADCOTACAOFORN`). 137 acessos, 19 operadores.
--
-- O comprador monta a cotação (`COTACAO` + `COTACAO_PROD`, a lista de produtos) e **o fornecedor preenche os
-- preços**. É a única tela do sistema em que quem opera pode ser **de fora da empresa**.
--
-- Uso real (produção, 14/09/2026): 39 cotações, 97 cotações-fornecedor e 16.014 itens, de 24/02/2022 a
-- 16/03/2026. E o dado diz de quem é a tela: **85 das 97 foram preenchidas pelo FORNECEDOR**
-- (`CODOPERADOR = 0`), não por operador da loja.
--
-- ── ⚠️ A SENHA DO FORNECEDOR estava em TEXTO PURO, e não vamos copiar isso ───────────────────────────────
-- O login da tela (`uLoginCotacao.pas:170`) compara direto: `PARCEIROS.SENHA = :SENHA`, sem hash nenhum. São
-- **57 parceiros com senha** cadastrada, de 3 a 13 caracteres. Guardar credencial de terceiro em claro é
-- risco que não se herda: aqui a coluna nova é `senha_hash`, com o mesmo scrypt dos operadores.
--
-- **A carga hasheia a senha do legado na entrada** — o fornecedor continua entrando com a mesma senha que já
-- usa, e o Apollo nunca guarda o texto. Nenhum fornecedor precisa ser avisado, nenhuma senha se perde.
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS senha_hash text;

-- ── As colunas que faltavam ─────────────────────────────────────────────────────────────────────────────
-- `COTACAO_FORN` guarda QUEM preencheu e QUANDO, e é isso que separa o preenchimento do comprador do
-- preenchimento do fornecedor. Nenhuma delas vinha na carga.
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS data             date;
-- `codoperador` = 0 (ou nulo) quer dizer que quem preencheu foi o FORNECEDOR, não a loja
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS codoperador      integer;
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS datamanope       timestamp;
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS datamanpar       timestamp;
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS situacao         char(1);
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS usultalteracao   integer;
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS dtultimalteracao timestamp;
ALTER TABLE cotacao_forn ADD COLUMN IF NOT EXISTS dtcadastro       timestamp DEFAULT now();

-- o item: o "marcado" da grade, o último valor cotado (para o fornecedor ver o histórico) e o backup do
-- valor de embalagem antes da última alteração
ALTER TABLE cotacao_forn_itens ADD COLUMN IF NOT EXISTS marcado        char(1);
ALTER TABLE cotacao_forn_itens ADD COLUMN IF NOT EXISTS ultimo_valor   numeric(15,4);
ALTER TABLE cotacao_forn_itens ADD COLUMN IF NOT EXISTS valorembal_bk  numeric(15,4);

-- a cotação-mãe: o envio por e-mail e o vínculo com a lista de fornecedores
ALTER TABLE cotacao ADD COLUMN IF NOT EXISTS dtenvioemail  timestamp;
ALTER TABLE cotacao ADD COLUMN IF NOT EXISTS codctc_listaf integer;

-- um fornecedor preenche cada cotação UMA vez (`VerificarExistenciaFornCotacao:565`)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cotacao_forn_ctc_parceiro ON cotacao_forn (codctc, codparceiro);

INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMCADCOTACAOFORN', 'FRMCADCOTACAOFORN', 7, 1)
ON CONFLICT DO NOTHING;
