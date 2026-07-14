import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve(__dirname, '../.pgdata');
const PORT = 5433;
const TENANT_DB = 'apollo_tenant_pinheirao';

export const PG_CONN = {
  host: '127.0.0.1',
  port: PORT,
  user: 'apollo',
  password: 'apollo',
  databasePrefix: 'apollo_tenant_',
};

/** Sobe um Postgres real embarcado, cria o banco do tenant e aplica migrations + seed. */
export async function startEmbeddedPg(): Promise<EmbeddedPostgres> {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG_CONN.user,
    password: PG_CONN.password,
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(TENANT_DB);

  const pool = new Pool({
    host: PG_CONN.host,
    port: PORT,
    user: PG_CONN.user,
    password: PG_CONN.password,
    database: TENANT_DB,
  });
  const sql = (f: string) =>
    readFileSync(resolve(__dirname, '../migrations', f), 'utf8');
  await pool.query(sql('001_init.sql'));
  await pool.query(sql('002_permissoes.sql'));
  await pool.query(sql('003_operacoes_conta.sql'));
  await pool.query(sql('seed.sql'));
  await pool.query(sql('004_contas_bancarias.sql'));
  await pool.query(sql('005_lote_cobranca.sql'));
  await pool.query(sql('006_marcas.sql'));
  await pool.query(sql('007_tributacao.sql'));
  await pool.query(sql('008_indexador_tributario.sql'));
  await pool.query(sql('009_historico_dinamico.sql'));
  await pool.query(sql('010_bairro.sql'));
  await pool.query(sql('011_preco.sql'));
  await pool.query(sql('012_ncm.sql'));
  await pool.query(sql('013_cidades.sql'));
  await pool.query(sql('014_parceiros.sql'));
  await pool.query(sql('015_areceber.sql'));
  await pool.query(sql('016_lote_cobranca_full.sql'));
  await pool.query(sql('017_parceiros.sql'));
  await pool.query(sql('018_parceiros_f2.sql'));
  await pool.query(sql('019_parceiros_fiscal.sql'));
  await pool.query(sql('020_produtos.sql'));
  await pool.query(sql('021_multi_preco.sql'));
  await pool.query(sql('022_estoque.sql'));
  await pool.query(sql('023_produto_kit.sql'));
  await pool.query(sql('024_produto_nutri_logistica.sql'));
  await pool.query(sql('025_nf.sql'));
  await pool.query(sql('026_nf_fiscal.sql'));
  await pool.query(sql('027_nf_processamento.sql'));
  await pool.query(sql('028_nf_faturamento.sql'));
  await pool.query(sql('029_nf_contabil.sql'));
  await pool.query(sql('030_nf_nfe.sql'));
  await pool.query(sql('031_nf_fiscal_f2b.sql'));
  await pool.query(sql('032_empresas.sql'));
  await pool.query(sql('033_configuracoes.sql'));
  await pool.query(sql('034_figura_fiscal.sql'));
  await pool.query(sql('035_nf_contabil_diario.sql'));
  await pool.query(sql('036_nf_contabil_diario_f2.sql'));
  await pool.query(sql('037_nf_contabil_diario_f3.sql'));
  await pool.query(sql('038_periodo_contabil.sql'));
  await pool.query(sql('039_nf_retencoes.sql'));
  await pool.query(sql('040_nf_cmv.sql'));
  await pool.query(sql('041_nf_piscofins.sql'));
  await pool.query(sql('042_nf_chave_natural.sql'));
  await pool.query(sql('043_areceber_gestao.sql'));
  await pool.query(sql('044_areceber_bx.sql'));
  await pool.query(sql('045_apagar_gestao_bx.sql'));
  await pool.query(sql('046_plano_contas.sql'));
  await pool.query(sql('047_dre_contabil.sql'));
  await pool.query(sql('048_caixa.sql'));
  await pool.query(sql('049_caixa_conferencia.sql'));
  await pool.query(sql('050_caixa_reabertura.sql'));
  await pool.query(sql('051_operadores.sql'));
  await pool.query(sql('052_formas_pgto.sql'));
  await pool.query(sql('053_caixa_contabil.sql'));
  await pool.query(sql('054_baixa_parcial.sql'));
  await pool.query(sql('055_baixa_contabil.sql'));
  await pool.query(sql('056_operador_empresa.sql'));
  await pool.query(sql('057_caixa_tesouraria.sql'));
  await pool.query(sql('058_baixa_recurso_banco.sql'));
  await pool.query(sql('059_ajuste_estoque.sql'));
  await pool.query(sql('060_pedido_compra.sql'));
  await pool.query(sql('061_nf_pedido_compra.sql'));
  await pool.query(sql('062_nf_import_xml.sql'));
  await pool.query(sql('063_de_para_fornecedor.sql'));
  await pool.query(sql('064_nf_forma_pagamento.sql'));
  await pool.query(sql('065_nf_st_residual.sql'));
  await pool.query(sql('066_retencao_federal.sql'));
  await pool.query(sql('067_condicoes_pagto_parcelas.sql'));
  await pool.query(sql('068_pedidocompra_i_precificacao.sql'));
  await pool.query(sql('069_pedido_compra_final.sql'));
  await pool.query(sql('070_operadores_auth.sql'));
  await pool.query(sql('071_operadores_login_hardening.sql'));
  await pool.query(sql('072_devolucao_compra.sql'));
  await pool.query(sql('073_devolucao_compra_gerar_nf.sql'));
  await pool.query(sql('074_devolucao_compra_fiscal.sql'));
  await pool.query(sql('075_nf_perc_aliquota_ret.sql'));
  await pool.end();
  return pg;
}
