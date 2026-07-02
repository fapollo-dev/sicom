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
  await pool.end();
  return pg;
}
