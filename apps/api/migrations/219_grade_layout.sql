-- 219 — LAYOUT DA GRADE POR OPERADOR ("Salvar Configurações do Grid [F8]" / "Carregar Originais [F9]").
--
-- ── O que o legado faz, e por que não copiamos o mecanismo ──────────────────────────────────────────────
-- `cxgridProdutosTableViewProd.StoreToIniFile(DirConfiguracoesGrid + 'GridPrecificacaoNF_Operador<N>.ini')`
-- (`uPrecificacaoNF.pas:1113`): grava um **arquivo .ini no disco da estação**, um por operador e por tela.
-- São **16 units** do legado com esse recurso.
--
-- O arquivo local resolve enquanto o operador usa sempre a mesma máquina — e deixa de resolver no dia em que
-- ele senta noutro caixa, ou em que a estação é reinstalada: o layout some sem aviso. Aqui a configuração
-- vive no **banco, por operador e empresa**, e segue a pessoa. O navegador continua guardando uma cópia
-- local (o `persistId` do DataTable), então a grade abre instantânea mesmo antes de a resposta chegar.
--
-- Uma linha por (operador, empresa, tela, view). A "Default" é o layout corrente; as demais são visões
-- nomeadas que o operador salva — o legado não tem isso, e é o que o `.ini` nunca conseguiu dar.
CREATE TABLE IF NOT EXISTS grade_layout (
  id               bigserial PRIMARY KEY,
  codoperador      integer NOT NULL,
  idempresa        integer NOT NULL,
  -- o `persistId` da tela (ex.: 'precificacao-nf'), estável entre versões
  tela             varchar(80) NOT NULL,
  -- o id da visão dentro da tela; 'default' é o layout corrente
  view_id          varchar(80) NOT NULL DEFAULT 'default',
  nome             varchar(120),
  publica          char(1) NOT NULL DEFAULT 'N',
  -- o snapshot do DataTable: colunas visíveis, ordem, larguras, ordenação, filtros, densidade
  estado           jsonb NOT NULL,
  dtcadastro       timestamp DEFAULT now(),
  dtultimalteracao timestamp,
  CONSTRAINT ux_grade_layout UNIQUE (codoperador, idempresa, tela, view_id)
);

CREATE INDEX IF NOT EXISTS ix_grade_layout_tela ON grade_layout (idempresa, tela);

-- ⚠️ sem RBAC próprio: salvar o layout da PRÓPRIA grade não é privilégio, é preferência. O legado também
-- não pede permissão — o item está no menu de contexto da grade, disponível a quem abriu a tela. O escopo
-- é o operador da sessão, e o serviço nunca lê nem escreve o layout de outro.
