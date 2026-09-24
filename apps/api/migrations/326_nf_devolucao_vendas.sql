-- 326 — NF DE ENTRADA DE DEVOLUÇÃO DE VENDAS: importar os itens devolvidos dos cupons (`btnAddPedidoClick` → `IniciarImportacaoEntrada(1)`,
-- uNF.pas:5900-6140; `IncluiProdDevoucaoVendas` :13816; situação 2 "DEVOLUCAO DE VENDAS", IMPORTACAO_AUTO_NF='DE'). Viva:
-- uma NF por ano (2021, 2023, 2024, 2025, 2026). A gravação liga a NF aos cupons em NF_CUPONS_REFERENCIA
-- (`InsereRefCuponsDevolucao`, udmNF.pas:10907) e marca VENDAS.IMPORTADO_DEVOLUCAO/CODNF_DEVOLUCAO; excluir a nota desfaz
-- (`RemoveRefCuponsDevolucao`, :10945). A tabela estava FORA do plano com o veredito "equivalente a nf.cupons_ref_devolucao"
-- — errado: a view GET_DEVOLUCAO_VENDAS acha a NF do cupom ECF por ela, e a importação grava nela.
CREATE TABLE IF NOT EXISTS nf_cupons_referencia (
  codnf      numeric NOT NULL,
  codvendas  numeric NOT NULL,          -- o CODVENDAS do legado = o cupom (vendas.codvendas_legado)
  nropedido  varchar(80) NOT NULL,
  nrocupom   numeric(10,0) NOT NULL,
  dtvenda    date NOT NULL,
  nroecf     numeric(10,0) NOT NULL,
  finalidade char(4),                   -- 'D' devolução
  venda_nfc  char(4),
  PRIMARY KEY (codnf, nrocupom, dtvenda, nroecf)
);
CREATE INDEX IF NOT EXISTS ix_nf_cupons_referencia_venda ON nf_cupons_referencia (codvendas, nrocupom);
