import 'reflect-metadata';
import { Pool } from 'pg';
import { NestFactory } from '@nestjs/core';
import { startEmbeddedPg, PG_CONN } from '../test/embedded-db';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

/**
 * Servidor de DESENVOLVIMENTO persistente: sobe o Postgres embarcado (migrations +
 * seed de todas as telas) e a API NestJS real na porta 3000 (o BASE padrão do web),
 * com CORS ligado p/ o Vite (5173). Fica no ar até Ctrl+C. Não é produção.
 */
const PORT = Number(process.env.PORT ?? 3000);

/**
 * Provisiona um LOGIN DEV completo p/ validar as telas: op 7 (SMOKE/smoke123, senha já semeada na migration 070)
 * ganha o vínculo com a empresa 1 (login é empresa-scoped) + TODOS os grants de RBAC da empresa 1 (o smoke concede
 * isso em fixtures durante a corrida; aqui replicamos p/ o login web). SÓ roda no dev-embedded (o smoke chama
 * startEmbeddedPg direto e NÃO toca aqui) — zero impacto nos testes. Idempotente.
 */
async function provisionarLoginDev(): Promise<void> {
  // Forms CRUD (engine) — opções padrão do fluxo cadastral.
  const CRUD_FORMS = [
    'FRMCADALIQUOTA', 'FRMCADBAIRRO', 'FRMCADCENTROCUSTO', 'FRMCADCFOP', 'FRMCADCIDADES', 'FRMCADCLIENTES',
    'FRMCADCONDICOESPAGTO', 'FRMCADCONTASBANCARIAS', 'FRMCADEMPRESA', 'FRMCADFAMILIAS', 'FRMCADFORMAPGTO',
    'FRMCADLOTECOBRANCA', 'FRMCADMARCAS', 'FRMCADMOTIVOOPERACAO', 'FRMCADNCM', 'FRMCADOPERACOESCONTA',
    'FRMCADOPERADOR', 'FRMCADPERFILOPERADOR', 'FRMCADPRECO', 'FRMCADPRODUTO', 'FRMCADSITUACAONF', 'FRMCADUNIDADE',
    'FRMDEVOLUCAOCOMPRA', 'FRMNF', 'FRMPEDIDOCOMPRA', 'FRMAGENDAPROMOCAO',
  ];
  const CRUD_OPCOES = ['BTNGRAVAR', 'BTNEXCLUIR', 'BTNEDITAR', 'BTNADICIONARREGISTRO', 'BTNVISUALIZAR'];
  // Pares específicos dos controllers verticais (@RequerAcesso), enumerados do código.
  const PARES: Array<[string, string]> = [
    ['FRMAGENDAPROMOCAO', 'BTNAPLICARPRECO'], ['FRMAGENDAPROMOCAO', 'BTNENCERRAR'],
    ['FRMAJUSTEESTOQUE', 'BTNAJUSTAR'], ['FRMAJUSTEESTOQUE', 'BTNESTORNAR'],
    ['FRMCADAPAGAR', 'BTNBAIXAR'], ['FRMCADAPAGAR', 'BTNESTORNARBAIXA'], ['FRMCADAPAGAR', 'BTNEXCLUIR'], ['FRMCADAPAGAR', 'BTNGRAVAR'],
    ['FRMCADARECEBER', 'BTNBAIXAR'], ['FRMCADARECEBER', 'BTNESTORNARBAIXA'], ['FRMCADARECEBER', 'BTNEXCLUIR'], ['FRMCADARECEBER', 'BTNGRAVAR'],
    ['FRMCADEMPRESA', 'BTNSENHAOPERACAO'],
    ['FRMCADPERFILOPERADOR', 'BTNPERMISSOES'], ['FRMCADPERFILOPERADOR', 'BTNRELACAO'],
    ['FRMCADPLANOCONTAS', 'BTNEXCLUIR'], ['FRMCADPLANOCONTAS', 'BTNGRAVAR'],
    ['FRMCADPRODUTO', 'BTNEDITAR'],
    ['FRMCAIXA', 'BTNABRIR'], ['FRMCAIXA', 'BTNCONTABILIZAR'], ['FRMCAIXA', 'BTNESTORNAR'], ['FRMCAIXA', 'BTNESTORNARCONTABIL'], ['FRMCAIXA', 'BTNFECHAR'], ['FRMCAIXA', 'BTNMOVIMENTAR'], ['FRMCAIXA', 'BTNREABRIR'],
    ['FRMDEVOLUCAOCOMPRA', 'BTNCANCELAR'], ['FRMDEVOLUCAOCOMPRA', 'BTNFATURAR'], ['FRMDEVOLUCAOCOMPRA', 'BTNFINALIZAR'], ['FRMDEVOLUCAOCOMPRA', 'BTNGERARNF'], ['FRMDEVOLUCAOCOMPRA', 'BTNREABRIR'],
    ['FRMDRE', 'BTNVISUALIZAR'],
    ['FRMLIBERACOES', 'BTNCONSULTAR'], ['FRMLIBERACOES', 'BTNPERMISSOES'],
    ['FRMNF', 'BTNCANCELAR'], ['FRMNF', 'BTNCCE'], ['FRMNF', 'BTNCONTABILIZAR'], ['FRMNF', 'BTNESTORNARCONTABIL'], ['FRMNF', 'BTNESTORNARFATURAMENTO'], ['FRMNF', 'BTNFATURAR'], ['FRMNF', 'BTNPROCESSAR'], ['FRMNF', 'BTNREVERTER'], ['FRMNF', 'BTNTRANSMITIR'],
    ['FRMPEDIDOCOMPRA', 'BTNFECHAR'], ['FRMPEDIDOCOMPRA', 'BTNGERARNF'], ['FRMPEDIDOCOMPRA', 'BTNGRAVAR'], ['FRMPEDIDOCOMPRA', 'BTNIMPORTARXML'], ['FRMPEDIDOCOMPRA', 'BTNLIBERARCONFERENCIA'], ['FRMPEDIDOCOMPRA', 'BTNREABRIR'], ['FRMPEDIDOCOMPRA', 'BTNVINCULARPRODUTO'], ['FRMPEDIDOCOMPRA', 'LIBERAVALORMAX'],
  ];
  const grants = new Set<string>();
  for (const f of CRUD_FORMS) for (const o of CRUD_OPCOES) grants.add(`${f}|${o}`);
  for (const [f, o] of PARES) grants.add(`${f}|${o}`);

  const pool = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
  try {
    // vínculo op 7 → empresa 1 (login empresa-scoped; a empresa 1 vem das migrations).
    await pool.query(
      `INSERT INTO relacao_operador_empresa (codoperador, codempresa)
       SELECT 7, 1 WHERE NOT EXISTS (SELECT 1 FROM relacao_operador_empresa WHERE codoperador=7 AND codempresa=1)`,
    );
    // TODOS os grants p/ op 7 @ empresa 1 (idempotente).
    for (const g of grants) {
      const [form, opcao] = g.split('|');
      await pool.query(
        `INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ($1,$2,7,1) ON CONFLICT DO NOTHING`,
        [form, opcao],
      );
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('[dev] iniciando Postgres embarcado (migrations + seed)...');
  const pg = await startEmbeddedPg();
  process.env.PGHOST = PG_CONN.host;
  process.env.PGPORT = String(PG_CONN.port);
  process.env.PGUSER = PG_CONN.user;
  process.env.PGPASSWORD = PG_CONN.password;
  process.env.PG_TENANT_PREFIX = PG_CONN.databasePrefix;

  console.log('[dev] provisionando login de validação (op 7 SMOKE + empresa 1 + grants)...');
  await provisionarLoginDev();

  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(PORT);
  console.log(`[dev] API no ar em http://localhost:${PORT}`);
  console.log('[dev] ┌──────────────────────────────────────────────────────────┐');
  console.log('[dev] │  LOGIN de validação das telas (web):                       │');
  console.log('[dev] │    usuário: SMOKE    senha: smoke123    empresa: 1         │');
  console.log('[dev] │  (op 7, vinculado à empresa 1, com TODOS os grants RBAC)   │');
  console.log('[dev] └──────────────────────────────────────────────────────────┘');

  const parar = async () => {
    console.log('\n[dev] encerrando...');
    await app.close();
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}

main().catch((e) => {
  console.error('[dev] erro', e);
  process.exitCode = 1;
});
