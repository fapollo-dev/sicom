-- RELACAO_OPERADOR_PERFIL_COMPRA — a aba "Perfil de compras" do cadastro de usuários (uCadUsuarios / uRdmCadUsuarios.dfm:596-619),
-- as colunas da produção. O vínculo é o que o pedido de compra confere no `ValidaPerfilOperador` (uPedidoCompra.pas:3605) contra o
-- perfil de compra do fornecedor, do departamento e do produto. Produção 08/10/2026: 0 linhas (nunca usada), 1 perfil COMPRA ativo
-- e nenhum parceiro/produto/família com CODPERFIL_COMPRA — a regra está inerte; a tabela existe para a tela ser a do legado.
CREATE SEQUENCE IF NOT EXISTS seq_relacao_operador_perfil_compra;
CREATE TABLE IF NOT EXISTS relacao_operador_perfil_compra (
  codrelacao_compra integer PRIMARY KEY DEFAULT nextval('seq_relacao_operador_perfil_compra'),
  codoperador       integer NOT NULL REFERENCES operadores(codoperador),
  codperfil         integer NOT NULL REFERENCES perfil(codperfil),
  indr              varchar(1) DEFAULT 'I',
  indr_usuario      numeric(10,0),
  indr_data         timestamptz,
  usultalteracao    numeric(10,0),
  dtultimalteracao  timestamptz,
  dtcadastro        timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_relacao_operador_perfil_compra OWNED BY relacao_operador_perfil_compra.codrelacao_compra;
CREATE UNIQUE INDEX IF NOT EXISTS ux_relacao_operador_perfil_compra ON relacao_operador_perfil_compra (codoperador, codperfil) WHERE coalesce(indr, 'I') <> 'E';
CREATE INDEX IF NOT EXISTS ix_relacao_operador_perfil_compra_op ON relacao_operador_perfil_compra (codoperador);
