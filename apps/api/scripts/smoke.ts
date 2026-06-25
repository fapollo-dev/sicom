import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { startEmbeddedPg, PG_CONN } from '../test/embedded-db';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';


/**
 * Smoke "hello tenant" — sobe Postgres embarcado + a API NestJS REAL e exercita
 * o caminho HTTP: /healthz, roteamento de tenant fail-closed, e o CRUD do piloto.
 * Prova a fundação ponta a ponta (DI do Nest + middleware de tenant + módulo).
 */
const PORT = 3001;
const base = `http://127.0.0.1:${PORT}`;
const H = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};
// operador 999 não tem grant em PERMISSOES → deve ser negado (RBAC).
const H_SEM_ACESSO = { ...H, 'x-operador-id': '999' };

let ok = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    ok++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`, extra ?? '');
  }
}

async function main() {
  console.log('[smoke] iniciando Postgres embarcado...');
  const pg = await startEmbeddedPg();
  console.log('[smoke] Postgres pronto. Subindo NestJS...');
  process.env.PGHOST = PG_CONN.host;
  process.env.PGPORT = String(PG_CONN.port);
  process.env.PGUSER = PG_CONN.user;
  process.env.PGPASSWORD = PG_CONN.password;
  process.env.PG_TENANT_PREFIX = PG_CONN.databasePrefix;

  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(PORT);
  console.log(`[smoke] API no ar em ${base}`);

  try {
    // 1) health (sem tenant)
    const h = await fetch(`${base}/healthz`);
    check('GET /healthz = 200', h.status === 200);

    // 2) fail-closed: sem header de tenant → 403
    const noT = await fetch(`${base}/cadastro/bancos`);
    check('GET /cadastro/bancos SEM tenant → 403 (fail-closed)', noT.status === 403, noT.status);

    // 3) lista (seed = 15)
    const list = await fetch(`${base}/cadastro/bancos`, { headers: H });
    const rows = (await list.json()) as unknown[];
    check('GET lista retorna os 15 do seed', Array.isArray(rows) && rows.length === 15, rows?.length);

    // 4) cria (delta + sequence + carimbo + outbox)
    const post = await fetch(`${base}/cadastro/bancos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ agencia: '9999', banco: 'teste claude', cidade: 'teste' }),
    });
    const novo = (await post.json()) as any;
    check('POST cria banco (codbco gerado = 16)', post.status === 201 && novo.codbco === 16, novo);
    check('BR-04 uppercase aplicado (BANCO em maiúsculas)', novo.banco === 'TESTE CLAUDE', novo.banco);
    check('carimbo de operador (usultalteracao=7)', novo.usultalteracao === 7, novo.usultalteracao);

    // 5) edita (delta)
    const put = await fetch(`${base}/cadastro/bancos/16`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ cidade: 'teste2' }),
    });
    const editado = (await put.json()) as any;
    check('PUT edita cidade (delta)', editado.cidade === 'TESTE2' && editado.banco === 'TESTE CLAUDE', editado);

    // 6) valida obrigatório (BR-02): banco vazio → 400
    const bad = await fetch(`${base}/cadastro/bancos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ cidade: 'x' }),
    });
    check('POST sem BANCO → 400 (BR-02, validação antes do banco)', bad.status === 400, bad.status);
    // ADR-015: envelope padrão de validação (code VALIDACAO + campos[] em PT)
    const badBody = (await bad.json().catch(() => ({}))) as any;
    check(
      'erro de validação segue o envelope ErroResposta (code + message PT + campos)',
      badBody.code === 'VALIDACAO' && typeof badBody.message === 'string' && Array.isArray(badBody.campos),
      badBody,
    );

    // 7) RBAC: operador SEM grant em PERMISSOES → 403 (BR-01 real, não stub)
    const semAcesso = await fetch(`${base}/cadastro/bancos`, {
      method: 'POST',
      headers: H_SEM_ACESSO,
      body: JSON.stringify({ banco: 'X', cidade: 'Y' }),
    });
    check('POST com operador sem permissão → 403 (RBAC PERMISSOES)', semAcesso.status === 403, semAcesso.status);

    // 8) exclui (operador com permissão)
    const del = await fetch(`${base}/cadastro/bancos/16`, { method: 'DELETE', headers: H });
    check('DELETE remove banco (204)', del.status === 204);

    // 9) BAIRROS (1ª herdeira completa via engine) — caminho HTTP do controller factory
    const bairros = (await (await fetch(`${base}/cadastro/bairros`, { headers: H })).json()) as any[];
    check('GET /cadastro/bairros lista o seed (4)', Array.isArray(bairros) && bairros.length === 4, bairros?.length);
    const bairroNL = await fetch(`${base}/cadastro/bairros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ descricao: 'BAIRRO SMOKE', regiao: 'NL', ativo: 'S' }),
    });
    const nb = (await bairroNL.json()) as any;
    const nbId = Number(nb.idbairro ?? nb.id ?? nb);
    check('POST /cadastro/bairros cria com combo REGIAO (201)', bairroNL.status === 201 && Number.isFinite(nbId), nb);
    // a view decodifica REGIAO: 'NL' → 'NORDESTE'
    const novaLista = (await (await fetch(`${base}/cadastro/bairros?campo=regiao&operador=contem&valor=NORDESTE`, { headers: H })).json()) as any[];
    check('GET pesquisa por REGIAO decodificada (NORDESTE) acha o novo', novaLista.some((b) => b.idbairro === nbId), novaLista?.length);

    // 10) PRECO (palette completo) — número/moeda + checkbox via HTTP
    const precos = (await (await fetch(`${base}/cadastro/precos`, { headers: H })).json()) as any[];
    check('GET /cadastro/precos lista o seed (2)', Array.isArray(precos) && precos.length === 2, precos?.length);
    const np = await fetch(`${base}/cadastro/precos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ descricao: 'SMOKE PRECO', valor_reajuste: 9.99, reajuste: 'S', ativo: 'S' }),
    });
    const npBody = (await np.json()) as any;
    const npId = Number(npBody.id_preco ?? npBody.id ?? npBody);
    check('POST /cadastro/precos cria com número decimal (201)', np.status === 201 && Number.isFinite(npId), npBody);
    const lido = (await (await fetch(`${base}/cadastro/precos/${npId}`, { headers: H })).json()) as any;
    check('GET /:id relê o decimal com precisão (9.99)', Math.abs(Number(lido.valor_reajuste) - 9.99) < 0.001, lido?.valor_reajuste);

    // 11) NCM (CHAVE NATURAL + data + memo) — o código vem no corpo, não é gerado
    const ncms = (await (await fetch(`${base}/cadastro/ncm`, { headers: H })).json()) as any[];
    check('GET /cadastro/ncm lista o seed (3)', Array.isArray(ncms) && ncms.length === 3, ncms?.length);
    const postNcm = await fetch(`${base}/cadastro/ncm`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ codigo: 22021000, ncmsh: '22021000', descricao: 'Refrigerantes', vigencia_inicio: '2021-05-10' }),
    });
    const ncmBody = (await postNcm.json()) as any;
    check('POST /cadastro/ncm cria com CHAVE NATURAL (codigo digitado)', postNcm.status === 201 && ncmBody.codigo === 22021000, ncmBody);
    check('NCM relê a vigência (date 2021-05-10)', String(ncmBody.vigencia_inicio ?? '').includes('2021-05-10') || String(new Date(ncmBody.vigencia_inicio).getFullYear()) === '2021', ncmBody?.vigencia_inicio);

    // 12) LOOKUP/FK — Cidades (alvo) + Bairro referenciando idcidade
    const cidades = (await (await fetch(`${base}/cadastro/cidades`, { headers: H })).json()) as any[];
    check('GET /cadastro/cidades lista o seed (4)', Array.isArray(cidades) && cidades.length === 4, cidades?.length);
    const bairroFK = await fetch(`${base}/cadastro/bairros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ descricao: 'PINHEIROS', regiao: 'O', ativo: 'S', idcidade: 3550308 }),
    });
    check('POST bairro com idcidade VÁLIDA (FK ok) → 201', bairroFK.status === 201, bairroFK.status);
    const bairroBad = await fetch(`${base}/cadastro/bairros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ descricao: 'FANTASMA', regiao: 'N', idcidade: 9999999 }),
    });
    check('POST bairro com idcidade INEXISTENTE → erro (FK rejeita)', bairroBad.status >= 400, bairroBad.status);
    // ADR-015: FK do banco vira 409 PT (NÃO 500 genérico "erro no servidor")
    const fkBody = (await bairroBad.json().catch(() => ({}))) as any;
    check(
      'FK violada → 409 envelope PT (status ajustado, motivo real, nunca 500 genérico)',
      bairroBad.status === 409 && fkBody.code === 'REGISTRO_RELACIONADO_INEXISTENTE' && fkBody.statusCode !== 500,
      fkBody,
    );

    // 13) MESTRE-DETALHE declarativo — agregado (header+itens) numa transação + cascata
    const aggPost = await fetch(`${base}/cobranca/lotes-md`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ codparceiro: 1, data: '2026-06-25', itens: [{ codrcb: 201 }, { codrcb: 202 }] }),
    });
    const agg = (await aggPost.json()) as any;
    const aggId = Number(agg.codlotecob);
    check('POST /cobranca/lotes-md cria agregado (header+2 itens)', aggPost.status === 201 && agg.itens?.length === 2, agg);
    const aggDel = await fetch(`${base}/cobranca/lotes-md/${aggId}`, { method: 'DELETE', headers: H });
    check('DELETE /cobranca/lotes-md remove em cascata (204)', aggDel.status === 204, aggDel.status);
    const aggGone = await fetch(`${base}/cobranca/lotes-md/${aggId}`, { headers: H });
    const goneBody = await aggGone.json().catch(() => null);
    check('GET após delete → agregado sumiu', !goneBody || goneBody === '' || goneBody == null || Object.keys(goneBody).length === 0, goneBody);
  } finally {
    await app.close();
    await pg.stop();
  }

  console.log(`\n[smoke] ${ok} ok, ${fail} falhas`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('[smoke] erro', e);
  process.exitCode = 1;
});
