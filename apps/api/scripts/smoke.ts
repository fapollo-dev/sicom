import 'reflect-metadata';
import { Pool } from 'pg';
import { NestFactory } from '@nestjs/core';
import { chaveNfeValida } from '@apollo/shared';
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

    // 13b) LOTE FULL (legado-fiel): read ENRIQUECIDO — itens com colunas de exibição
    // (JOIN ARECEBER→PARCEIROS→PARCEIROS_END) + JUROS/TOTAL + RAZAO do cobrador.
    const aggRead = (await (await fetch(`${base}/cobranca/lotes-md/${aggId}`, { headers: H })).json()) as any;
    const it0 = aggRead?.itens?.[0] ?? {};
    check(
      'GET lote-md/:id traz itens com colunas de exibição (duplicata/valor/juros/total)',
      aggRead?.itens?.length === 2 && 'duplicata' in it0 && 'valor' in it0 && 'juros' in it0 && 'total' in it0,
      it0,
    );
    check('lote-md/:id expõe RAZAO do cobrador (JOIN parceiros)', typeof aggRead?.razao === 'string' && aggRead.razao.length > 0, aggRead?.razao);

    // 13c) Picker ARECEBER (multi-select da inclusão de item): títulos da empresa do contexto
    const arRes = await fetch(`${base}/cobranca/areceber`, { headers: H });
    const ar = (await arRes.json().catch(() => [])) as any[];
    check('GET /cobranca/areceber lista títulos da empresa (picker)', arRes.status === 200 && Array.isArray(ar) && ar.length > 0, ar?.length);

    // 13c.2) Lookup do Cobrador (parceiros FUN='S') — alimenta o SelectField da tela
    const cobRes = await fetch(`${base}/cobranca/cobradores`, { headers: H });
    const cob = (await cobRes.json().catch(() => [])) as any[];
    check(
      'GET /cobranca/cobradores lista só FUN=S (com razao)',
      cobRes.status === 200 && Array.isArray(cob) && cob.length > 0 && typeof cob[0]?.razao === 'string',
      cob?.length,
    );

    // 13d) Cobrador deve ser FUN='S' — codparceiro de CLIENTE (FUN='N') é REJEITADO em PT (nunca 500)
    const badCob = await fetch(`${base}/cobranca/lotes-md`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ codparceiro: 20, data: '2026-06-25', itens: [{ codrcb: 300 }] }),
    });
    const badCobBody = (await badCob.json().catch(() => ({}))) as any;
    check(
      'POST lote com cobrador FUN=N → erro PT (status ajustado, nunca 500)',
      badCob.status >= 400 && badCob.status !== 500 && typeof badCobBody.message === 'string',
      { status: badCob.status, body: badCobBody },
    );

    const aggDel = await fetch(`${base}/cobranca/lotes-md/${aggId}`, { method: 'DELETE', headers: H });
    check('DELETE /cobranca/lotes-md remove em cascata (204)', aggDel.status === 204, aggDel.status);
    const aggGone = await fetch(`${base}/cobranca/lotes-md/${aggId}`, { headers: H });
    const goneBody = await aggGone.json().catch(() => null);
    check('GET após delete → agregado sumiu', !goneBody || goneBody === '' || goneBody == null || Object.keys(goneBody).length === 0, goneBody);

    // 14) PARCEIROS — tela UNIFICADA multi-papel (mestre + endereços), via HTTP
    const parcPost = await fetch(`${base}/cadastro/parceiros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        razao: 'CLIENTE SMOKE LTDA',
        tipofj: 'J',
        cli: 'S',
        enderecos: [
          { endereco: 'RUA SMOKE', bairro: 'CENTRO', cidade: 'SAO PAULO', idcidade: 3550308, uf: 'SP', cnpj_cpf: '11444777000161', endereco_padrao: 'S' },
        ],
      }),
    });
    const parc = (await parcPost.json()) as any;
    check(
      'POST /cadastro/parceiros cria agregado (master + 1 endereço com CNPJ no endereço)',
      parcPost.status === 201 && Number.isFinite(Number(parc.codparceiro)) && parc.enderecos?.length === 1 && parc.enderecos[0].cnpj_cpf === '11444777000161',
      parc,
    );

    // 14b) "ao menos um papel" obrigatório (todas as flags 'N') → 400 VALIDACAO PT (não 500)
    const semPapel = await fetch(`${base}/cadastro/parceiros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ razao: 'SEM PAPEL', tipofj: 'J', enderecos: [] }),
    });
    const semPapelBody = (await semPapel.json().catch(() => ({}))) as any;
    check(
      'POST parceiro sem papel → 400 VALIDACAO (tipo obrigatório), nunca 500',
      semPapel.status === 400 && semPapelBody.code === 'VALIDACAO' && semPapel.status !== 500,
      { status: semPapel.status, code: semPapelBody.code },
    );

    // 14c) duplicidade de CNPJ (doc do seed codend1) → 409 DUPLICADO (ADR-015)
    const dupDoc = await fetch(`${base}/cadastro/parceiros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ razao: 'DUP SMOKE', tipofj: 'J', frn: 'S', enderecos: [{ cnpj_cpf: '11222333000181', endereco_padrao: 'S' }] }),
    });
    const dupBody = (await dupDoc.json().catch(() => ({}))) as any;
    check('POST parceiro com CNPJ duplicado → 409 DUPLICADO', dupDoc.status === 409 && dupBody.code === 'DUPLICADO', { status: dupDoc.status, code: dupBody.code });

    // 14d) lookup de VENDEDOR (FUN='S') — alimenta o SelectField da tela
    const vend = (await (await fetch(`${base}/cadastro/parceiros?campo=fun&operador=igual&valor=S`, { headers: H })).json()) as any[];
    check(
      'GET /cadastro/parceiros?campo=fun=S lista vendedores/funcionários',
      Array.isArray(vend) && vend.length >= 3 && vend.every((p) => p.fun === 'S'),
      vend?.length,
    );

    // 14e) filtro por PAPEL (a tela "Clientes" lista só CLI='S')
    const cli = (await (await fetch(`${base}/cadastro/parceiros?campo=cli&operador=igual&valor=S`, { headers: H })).json()) as any[];
    check('GET /cadastro/parceiros?campo=cli=S lista só clientes', Array.isArray(cli) && cli.length > 0 && cli.every((p) => p.cli === 'S'), cli?.length);

    // 14f) F2 — sub-recursos 1:N (bancos/pgtos/relacionamentos/vendedores) no caminho HTTP
    const f2Post = await fetch(`${base}/cadastro/parceiros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        razao: 'CLIENTE F2 SMOKE LTDA',
        tipofj: 'J',
        cli: 'S',
        bancos: [{ codbco: 1, agencia: '1', nrconta: '9' }],
        relacionamentos: [{ nome: 'CONTATO SMOKE', tiporel: 'FIN', telefone: '98988880001' }],
        vendedores: [{ codvendedor: 1 }],
        pgtos: [{ idpgto: 1, modalidade: 'A VISTA' }],
      }),
    });
    const f2 = (await f2Post.json()) as any;
    check(
      'POST /cadastro/parceiros cria agregado F2 (bancos+rel+vendedores+pgtos numa transação)',
      f2Post.status === 201 &&
        f2.bancos?.length === 1 &&
        f2.relacionamentos?.length === 1 &&
        f2.vendedores?.length === 1 &&
        f2.pgtos?.length === 1,
      f2,
    );

    // 14f.2) GET do parceiro 20 (seed F2) traz os sub-grids populados
    const seed20 = (await (await fetch(`${base}/cadastro/parceiros/20`, { headers: H })).json()) as any;
    check(
      'GET /cadastro/parceiros/20 traz bancos/pgtos/relacionamentos/vendedores do seed',
      Array.isArray(seed20?.bancos) && seed20.bancos.length >= 1 &&
        Array.isArray(seed20?.pgtos) && seed20.pgtos.length === 2 &&
        Array.isArray(seed20?.relacionamentos) && seed20.relacionamentos.length >= 1 &&
        Array.isArray(seed20?.vendedores) && seed20.vendedores.length === 2,
      { bancos: seed20?.bancos?.length, pgtos: seed20?.pgtos?.length, rel: seed20?.relacionamentos?.length, vend: seed20?.vendedores?.length },
    );

    // 14g) F3 — CONFIGURAÇÃO fiscal + validação de IE por UF (refine do zod) no caminho HTTP
    const f3Post = await fetch(`${base}/cadastro/parceiros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        razao: 'CLIENTE F3 SMOKE LTDA',
        tipofj: 'J',
        cli: 'S',
        contribuinte_icms: '1',
        classfiscal: 'SN',
        habilita_retencao_ir_nf: 'S',
        perc_aliquota_ir: 1.5,
        perc_aliquota_issqn: 2.0,
        envianfe: 'S',
        irrf: 'I',
        apuracao: 'M',
        classificacao: 'F',
        // endereço SEM cnpj_cpf (evita índice único por doc) + IE SP VÁLIDA em rg_insc.
        enderecos: [{ uf: 'SP', rg_insc: '110042490114', endereco_padrao: 'S' }],
      }),
    });
    const f3 = (await f3Post.json()) as any;
    check(
      'POST /cadastro/parceiros cria com config fiscal F3 + IE SP válida (201, round-trip)',
      f3Post.status === 201 && f3.contribuinte_icms === '1' && f3.habilita_retencao_ir_nf === 'S',
      { status: f3Post.status, body: f3 },
    );

    // 14g.2) IE INVÁLIDA p/ SP → 400 VALIDACAO PT (refine do zod), nunca 500
    const ieBad = await fetch(`${base}/cadastro/parceiros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        razao: 'IE INVALIDA SMOKE',
        tipofj: 'J',
        cli: 'S',
        enderecos: [{ uf: 'SP', rg_insc: '111', endereco_padrao: 'S' }],
      }),
    });
    const ieBadBody = (await ieBad.json().catch(() => ({}))) as any;
    check(
      'POST parceiro com IE SP inválida → 400 VALIDACAO (refine zod), nunca 500',
      ieBad.status === 400 && ieBadBody.code === 'VALIDACAO' && ieBad.status !== 500,
      { status: ieBad.status, code: ieBadBody.code },
    );

    // 14g.3) contribuinte_icms fora do enum (1/2/9) → 400 VALIDACAO PT
    const cicBad = await fetch(`${base}/cadastro/parceiros`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        razao: 'CICMS INVALIDO SMOKE',
        tipofj: 'J',
        cli: 'S',
        contribuinte_icms: '5',
      }),
    });
    const cicBadBody = (await cicBad.json().catch(() => ({}))) as any;
    check(
      'POST parceiro com contribuinte_icms inválido (5) → 400 VALIDACAO (enum 1/2/9)',
      cicBad.status === 400 && cicBadBody.code === 'VALIDACAO',
      { status: cicBad.status, code: cicBadBody.code },
    );
    // 15) PRODUTOS — tela de NÚCLEO (mestre + codauxiliar), GLOBAL, via HTTP
    const prodPost = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        codbarra: '7891000100103',
        descricao: 'PRODUTO SMOKE',
        unidade: 'UN',
        codunidade: 1,
        codfor: 2,
        aliquota: 'T01',
        codauxiliares: [{ codauxiliar: '7891000100103', codbarra: '7896000000017', fatoremb: 12, codunidade: 3 }],
      }),
    });
    const prod = (await prodPost.json()) as any;
    check(
      'POST /cadastro/produtos cria agregado (master + 1 codauxiliar)',
      prodPost.status === 201 && Number.isFinite(Number(prod.idproduto)) && prod.codauxiliares?.length === 1,
      prod,
    );

    // 15b) PRODUTO F2 — MULTI_PRECO (preço/custo POR EMPRESA na mesma form), via HTTP
    const prodPrecoPost = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        codbarra: '7890000001250', // EAN-13 com dígito verificador válido (zod valida na camada HTTP)
        descricao: 'PRODUTO F2 SMOKE',
        unidade: 'UN',
        codfor: 2,
        aliquota: 'T01',
        precos: [{ idempresa: 1, vrcusto: 8, markup: 25, vrvenda: 10, promocao: 'N', aliquotasaida: 'T01', ativo: 'S' }],
      }),
    });
    const prodPreco = (await prodPrecoPost.json()) as any;
    check(
      'POST /cadastro/produtos cria com precos por empresa (vrvenda 10 round-trip)',
      prodPrecoPost.status === 201 && prodPreco.precos?.length === 1 && Number(prodPreco.precos[0].vrvenda) === 10,
      prodPreco,
    );

    // 15b.2) GET /:id traz precos do seed (produto 1, empresa 1)
    const prod1 = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    check(
      'GET /cadastro/produtos/1 traz precos do seed (linha da empresa 1)',
      Array.isArray(prod1?.precos) && prod1.precos.some((p: any) => p.idempresa === 1),
      { precos: prod1?.precos?.length },
    );

    // 15b.3) EDIÇÃO: reenviar o registro carregado (numeric do pg vem como STRING, ex. '4.5500')
    // deve gravar (PUT 200) — prova a coerção string→número (antes reprovava no zod).
    const prod1Edit = await fetch(`${base}/cadastro/produtos/1`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify(prod1), // body com vrcusto/vrvenda/markup como strings, igual ao carregado
    });
    const prod1EditBody = (await prod1Edit.json().catch(() => ({}))) as any;
    check(
      'PUT /cadastro/produtos/1 reenviando numeric-string grava (edição não trava)',
      prod1Edit.status === 200 && Array.isArray(prod1EditBody?.precos) && Number(prod1EditBody.precos[0]?.vrvenda) === 4.55,
      { status: prod1Edit.status, vrvenda: prod1EditBody?.precos?.[0]?.vrvenda },
    );

    // 15c) CODFOR (fornecedor) obrigatório → 400 VALIDACAO PT (nunca 500)
    const semFor = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ codbarra: '7891000100103', descricao: 'SEM FORNECEDOR', unidade: 'UN', aliquota: 'T01' }),
    });
    const semForBody = (await semFor.json().catch(() => ({}))) as any;
    check(
      'POST produto sem CODFOR → 400 VALIDACAO (fornecedor obrigatório), nunca 500',
      semFor.status === 400 && semForBody.code === 'VALIDACAO' && semFor.status !== 500,
      { status: semFor.status, code: semForBody.code },
    );

    // 15d) DESCRICAO não pode conter ';' → 400 VALIDACAO PT
    const descBad = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ codbarra: '7891000100103', descricao: 'INVALIDO; AQUI', unidade: 'UN', codfor: 2, aliquota: 'T01' }),
    });
    const descBadBody = (await descBad.json().catch(() => ({}))) as any;
    check(
      "POST produto com ';' na descrição → 400 VALIDACAO, nunca 500",
      descBad.status === 400 && descBadBody.code === 'VALIDACAO',
      { status: descBad.status, code: descBadBody.code },
    );

    // 15e) ALIQUOTA 'STB' exige CEST (superRefine) → 400 VALIDACAO PT
    const cestBad = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ codbarra: '7891000100103', descricao: 'PRODUTO ST SEM CEST', unidade: 'UN', codfor: 2, aliquota: 'STB' }),
    });
    const cestBadBody = (await cestBad.json().catch(() => ({}))) as any;
    check(
      'POST produto STB sem CEST → 400 VALIDACAO (CEST obrigatório), nunca 500',
      cestBad.status === 400 && cestBadBody.code === 'VALIDACAO',
      { status: cestBad.status, code: cestBadBody.code },
    );

    // 15f) lookups de apoio do Produto (unidades / familias filtradas / aliquotas)
    const unidades = (await (await fetch(`${base}/cadastro/unidades`, { headers: H })).json()) as any[];
    check('GET /cadastro/unidades lista o seed (≥6)', Array.isArray(unidades) && unidades.length >= 6, unidades?.length);

    const grupos = (await (await fetch(`${base}/cadastro/familias?campo=tipo&operador=igual&valor=G`, { headers: H })).json()) as any[];
    check(
      'GET /cadastro/familias?tipo=G lista só grupos (G)',
      Array.isArray(grupos) && grupos.length >= 2 && grupos.every((g) => g.tipo === 'G'),
      grupos?.length,
    );

    const aliquotas = (await (await fetch(`${base}/cadastro/aliquotas`, { headers: H })).json()) as any[];
    check(
      'GET /cadastro/aliquotas lista o catálogo (tem T01)',
      Array.isArray(aliquotas) && aliquotas.some((a) => a.codigo === 'T01'),
      aliquotas?.length,
    );

    // 15h) PRODUTO F3 — ESTOQUE (saldo por empresa na mesma form), via HTTP
    // REGRA: qtde (saldo) é read-only no cadastro (movido por transação); só min/max/local editáveis.
    // 15h.1) CREATE com estoques (empresa 1, qtde 0; EAN-13 7890000002257 com DV válido, distinto)
    const prodEstPost = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        codbarra: '7890000002257', // EAN-13 com dígito verificador válido (zod valida na camada HTTP)
        descricao: 'PRODUTO F3 SMOKE',
        unidade: 'UN',
        codfor: 2,
        aliquota: 'T01',
        estoques: [{ idempresa: 1, qtde: 0, minimo: 7, maximo: 70, local: 'SMOKE' }],
      }),
    });
    const prodEst = (await prodEstPost.json()) as any;
    check(
      'POST /cadastro/produtos cria com estoques por empresa (minimo 7 round-trip)',
      prodEstPost.status === 201 && prodEst.estoques?.length === 1 && Number(prodEst.estoques[0].minimo) === 7,
      prodEst,
    );

    // 15h.2) GET /:id traz estoques do seed (produto 1, empresa 1, qtde 120)
    const prod1Est = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    const est1 = Array.isArray(prod1Est?.estoques) ? prod1Est.estoques.find((e: any) => e.idempresa === 1) : undefined;
    check(
      'GET /cadastro/produtos/1 traz estoques do seed (empresa 1, qtde 120)',
      !!est1 && Number(est1.qtde) === 120,
      { estoques: prod1Est?.estoques?.length, qtde: est1?.qtde },
    );

    // 15h.3) EDIÇÃO round-trip preserva saldo: muda minimo→11, mantém qtde como carregado (string).
    // PUT deve gravar (200) e re-GET mostra minimo 11 e qtde AINDA 120 (cadastro não mexe no saldo).
    if (est1) est1.minimo = 11; // só o min/max/local é editável; qtde fica a string carregada
    const prod1EstEdit = await fetch(`${base}/cadastro/produtos/1`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify(prod1Est),
    });
    const prod1EstEditBody = (await prod1EstEdit.json().catch(() => ({}))) as any;
    const prod1EstReget = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    const estReget = Array.isArray(prod1EstReget?.estoques)
      ? prod1EstReget.estoques.find((e: any) => e.idempresa === 1)
      : undefined;
    check(
      'PUT /cadastro/produtos/1 edita estoque (minimo 11) e PRESERVA saldo (qtde ainda 120)',
      prod1EstEdit.status === 200 && !!estReget && Number(estReget.minimo) === 11 && Number(estReget.qtde) === 120,
      { status: prod1EstEdit.status, minimo: estReget?.minimo, qtde: estReget?.qtde, putCode: prod1EstEditBody?.code },
    );

    // 15i) PRODUTO F4 — kit/BOM (COMPOSIÇÃO/DECOMPOSIÇÃO/RECEITA), via HTTP
    // 15i.1) GET do seed: produto 1 (kit) traz composicoes; produto 2 (partida) traz decomposicoes 100%
    const prod1Comp = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    check(
      'GET /cadastro/produtos/1 traz composicoes do seed (kit)',
      Array.isArray(prod1Comp?.composicoes) && prod1Comp.composicoes.length >= 1,
      { composicoes: prod1Comp?.composicoes?.length },
    );
    const prod2Dec = (await (await fetch(`${base}/cadastro/produtos/2`, { headers: H })).json()) as any;
    const dec0 = Array.isArray(prod2Dec?.decomposicoes) ? prod2Dec.decomposicoes[0] : undefined;
    check(
      'GET /cadastro/produtos/2 traz decomposicoes do seed (percentual 100)',
      !!dec0 && Number(dec0.percentual) === 100,
      { decomposicoes: prod2Dec?.decomposicoes?.length, percentual: dec0?.percentual },
    );

    // 15i.2) CREATE com composicoes → 201 e flag composicao='S' derivada (1 item)
    const prodKitPost = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        codbarra: '7890000003261', // EAN-13 com DV válido, distinto dos seeds/smoke
        descricao: 'PRODUTO F4 KIT SMOKE',
        unidade: 'UN',
        codfor: 2,
        aliquota: 'T01',
        composicoes: [{ idproduto_01: 2, qtde: 1, valor: 3 }],
      }),
    });
    const prodKit = (await prodKitPost.json()) as any;
    check(
      'POST /cadastro/produtos com composicoes → 201 e composicao=S derivada (1 item)',
      prodKitPost.status === 201 && prodKit.composicao === 'S' && prodKit.composicoes?.length === 1,
      { status: prodKitPost.status, composicao: prodKit.composicao, n: prodKit.composicoes?.length },
    );

    // 15i.3) DECOMPOSIÇÃO != 100% (soma 50) → 400 VALIDACAO PT (refine do zod), nunca 500
    const decBad = await fetch(`${base}/cadastro/produtos`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        codbarra: '7890000003278', // EAN-13 válido, distinto
        descricao: 'PRODUTO F4 DECOMP 50',
        unidade: 'UN',
        codfor: 2,
        aliquota: 'T01',
        decomposicoes: [{ idproduto_01: 1, percentual: 50 }],
      }),
    });
    const decBadBody = (await decBad.json().catch(() => ({}))) as any;
    check(
      'POST produto com decomposição != 100% (soma 50) → 400 VALIDACAO, nunca 500',
      decBad.status === 400 && decBadBody.code === 'VALIDACAO' && decBad.status !== 500,
      { status: decBad.status, code: decBadBody.code },
    );

    // 15i.4) BLOQUEIO desativar componente: produto 2 é COMPONENTE do kit 1 → PUT ativo='N' → 422 PT, nunca 500
    const prod2Full = (await (await fetch(`${base}/cadastro/produtos/2`, { headers: H })).json()) as any;
    prod2Full.ativo = 'N';
    const desativaComp = await fetch(`${base}/cadastro/produtos/2`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify(prod2Full),
    });
    const desativaCompBody = (await desativaComp.json().catch(() => ({}))) as any;
    check(
      'PUT desativar produto componente de kit → 422 PRODUTO_EM_COMPOSICAO, nunca 500',
      desativaComp.status === 422 && desativaCompBody.code === 'PRODUTO_EM_COMPOSICAO' && desativaComp.status !== 500,
      { status: desativaComp.status, code: desativaCompBody.code },
    );

    // 15j) NUTRICIONAL/LOGÍSTICA (F4b — campos do master): seed do produto 1 + round-trip de edição
    const prodNutri = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    check(
      'GET /cadastro/produtos/1 traz nutricional (valorenergetico=387, peso líq.)',
      Number(prodNutri.valorenergetico) === 387 && Number(prodNutri.pesoliq_produto) === 1,
      { ve: prodNutri.valorenergetico, peso: prodNutri.pesoliq_produto },
    );
    prodNutri.carboidrato = 50; // edita um campo nutricional
    const nutriPut = await fetch(`${base}/cadastro/produtos/1`, { method: 'PUT', headers: H, body: JSON.stringify(prodNutri) });
    const nutriBody = (await nutriPut.json().catch(() => ({}))) as any;
    check(
      'PUT produto/1 edita nutricional (carboidrato=50) e mantém valorenergetico=387',
      nutriPut.status === 200 && Number(nutriBody.carboidrato) === 50 && Number(nutriBody.valorenergetico) === 387,
      { status: nutriPut.status, carb: nutriBody.carboidrato },
    );
    // 16) NOTA FISCAL (tela-coroa) — F1 NÚCLEO CADASTRO, SEM EFEITOS. Header+itens+referências.
    // 16.1) saldo de estoque do produto 1 ANTES (prova de que a NF NÃO move estoque na F1)
    const estAntes = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    const qtdeAntes = Number((estAntes?.estoques ?? []).find((e: any) => e.idempresa === 1)?.qtde);

    // 16.2) CREATE entrada (fornecedor 22 FRN) com 2 itens + 1 referência → 201; totais derivados (Σ itens)
    const nfPost = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, nronf: '3001', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10',
        tipoemissao: '0', finalidade: '1', cfop: '1102', idsituacao_nf: 6, codparceiro: 22, codparceiro_end: 6,
        itens: [
          { codproduto: 1, quantidade: 10, vrvenda: 3.5, cfop: '1102', ncm: '17019900', aliquota: 'T01', icms: 18, origem_estoque: 'E' },
          { codproduto: 2, quantidade: 5, vrvenda: 6, cfop: '1102', ncm: '22021000', aliquota: 'T01', icms: 18, origem_estoque: 'E' },
        ],
        referencias: [{ codnf_ref: 1, valor_ref: 50 }],
      }),
    });
    const nf = (await nfPost.json()) as any;
    const nfId = Number(nf.codnf);
    check(
      'POST /fiscal/nf cria agregado entrada (header + 2 itens + 1 referência)',
      nfPost.status === 201 && Number.isFinite(nfId) && nf.itens?.length === 2 && nf.referencias?.length === 1,
      { status: nfPost.status, itens: nf.itens?.length, refs: nf.referencias?.length },
    );
    check(
      'NF totais DERIVADOS server-side (totalprod=65 = 10×3,5 + 5×6; totalnf=65 sem imposto)',
      Number(nf.totalprod) === 65 && Number(nf.totalnf) === 65,
      { totalprod: nf.totalprod, totalnf: nf.totalnf },
    );
    check('NF nasce com PROC=N e STATUSNFE vazio (digitação)', nf.proc === 'N' && (nf.statusnfe == null || nf.statusnfe === ''), { proc: nf.proc, statusnfe: nf.statusnfe });

    // 16.3) SEM EFEITO: o saldo de estoque do produto 1 NÃO mudou (F1 só armazena)
    const estDepois = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    const qtdeDepois = Number((estDepois?.estoques ?? []).find((e: any) => e.idempresa === 1)?.qtde);
    check(
      'F1 NÃO move estoque: saldo do produto 1 inalterado após gravar a NF de entrada',
      Number.isFinite(qtdeAntes) && qtdeAntes === qtdeDepois,
      { antes: qtdeAntes, depois: qtdeDepois },
    );

    // 16.4) round-trip de edição: reenviar o agregado carregado (numeric-string) → PUT 200 (idempotência)
    const nfRead = (await (await fetch(`${base}/fiscal/nf/${nfId}`, { headers: H })).json()) as any;
    const nfPut = await fetch(`${base}/fiscal/nf/${nfId}`, { method: 'PUT', headers: H, body: JSON.stringify(nfRead) });
    check('PUT /fiscal/nf/:id reenviando o registro carregado grava (edição não trava)', nfPut.status === 200, nfPut.status);

    // 16.5) CREATE saída (cliente 20 CLI) → 201
    const nfSaida = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'S', modelo: 55, nronf: '4001', serie: '1', dtemissao: '2026-06-11', dtcontabil: '2026-06-11',
        tipoemissao: '0', finalidade: '1', cfop: '5102', idsituacao_nf: 8, codparceiro: 20,
        itens: [{ codproduto: 1, quantidade: 2, vrvenda: 4.2, cfop: '5102', aliquota: 'T01', icms: 18 }],
      }),
    });
    check('POST /fiscal/nf cria agregado de saída (cliente)', nfSaida.status === 201, nfSaida.status);

    // 16.6) DUPLICIDADE: mesma chave (nronf 1001 + série + modelo + tipo + fornecedor 22 do seed) → 422 PT
    const nfDup = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, nronf: '1001', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', cfop: '1102', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 1, vrvenda: 1 }],
      }),
    });
    const nfDupBody = (await nfDup.json().catch(() => ({}))) as any;
    check(
      'POST NF com número+fornecedor duplicados → 422 NF_DUPLICADA (msg PT), nunca 500',
      nfDup.status === 422 && nfDupBody.code === 'NF_DUPLICADA' && nfDup.status !== 500,
      { status: nfDup.status, code: nfDupBody.code },
    );

    // 16.7) TERCEIROS Modelo 55 (tipoemissao=1 + modelo=55) → 400 VALIDACAO (bloqueio de digitação manual)
    const nfM55 = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, tipoemissao: '1', nronf: '7777', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 1, vrvenda: 1 }],
      }),
    });
    const nfM55Body = (await nfM55.json().catch(() => ({}))) as any;
    check(
      'POST NF terceiros Modelo 55 → 400 VALIDACAO (digitação manual bloqueada), nunca 500',
      nfM55.status === 400 && nfM55Body.code === 'VALIDACAO' && nfM55.status !== 500,
      { status: nfM55.status, code: nfM55Body.code },
    );

    // 16.8) NF sem itens → 400 VALIDACAO
    const nfSemItem = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ tipo: 'E', modelo: 1, nronf: '8001', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, itens: [] }),
    });
    const nfSemItemBody = (await nfSemItem.json().catch(() => ({}))) as any;
    check('POST NF sem itens → 400 VALIDACAO, nunca 500', nfSemItem.status === 400 && nfSemItemBody.code === 'VALIDACAO', { status: nfSemItem.status, code: nfSemItemBody.code });

    // 16.9) DTCONTABIL < DTEMISSAO → 400 VALIDACAO
    const nfData = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 1, nronf: '8101', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-01', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 1, vrvenda: 1 }],
      }),
    });
    const nfDataBody = (await nfData.json().catch(() => ({}))) as any;
    check('POST NF com data contábil < emissão → 400 VALIDACAO, nunca 500', nfData.status === 400 && nfDataBody.code === 'VALIDACAO', { status: nfData.status, code: nfDataBody.code });

    // 16.10) TRAVA DE ESTADO — PROC='S' bloqueia edição (NF já processada não pode ser modificada)
    const nfProc = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 1, nronf: '9001', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, proc: 'S',
        itens: [{ codproduto: 1, quantidade: 1, vrvenda: 1 }],
      }),
    });
    const nfProcBody = (await nfProc.json()) as any;
    const nfProcId = Number(nfProcBody.codnf);
    const nfProcPut = await fetch(`${base}/fiscal/nf/${nfProcId}`, {
      method: 'PUT', headers: H, body: JSON.stringify({ obs: 'tentando editar processada' }),
    });
    const nfProcPutBody = (await nfProcPut.json().catch(() => ({}))) as any;
    check(
      'PUT NF com PROC=S → 422 NF_PROCESSADA (trava de estado), nunca 500',
      nfProcPut.status === 422 && nfProcPutBody.code === 'NF_PROCESSADA' && nfProcPut.status !== 500,
      { status: nfProcPut.status, code: nfProcPutBody.code },
    );

    // 16.11) TRAVA DE ESTADO — STATUSNFE='P' (autorizada SEFAZ) bloqueia edição
    const nfEnv = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'S', modelo: 55, nronf: '9101', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 20, statusnfe: 'P',
        itens: [{ codproduto: 1, quantidade: 1, vrvenda: 1 }],
      }),
    });
    const nfEnvId = Number(((await nfEnv.json()) as any).codnf);
    const nfEnvPut = await fetch(`${base}/fiscal/nf/${nfEnvId}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'x' }) });
    const nfEnvPutBody = (await nfEnvPut.json().catch(() => ({}))) as any;
    check(
      'PUT NF com STATUSNFE=P → 422 NF_ENVIADA (trava de estado), nunca 500',
      nfEnvPut.status === 422 && nfEnvPutBody.code === 'NF_ENVIADA',
      { status: nfEnvPut.status, code: nfEnvPutBody.code },
    );

    // 16.12) lookups da NF (situações + CFOP) alimentam os selects da tela
    const sits = (await (await fetch(`${base}/cadastro/situacoes-nf`, { headers: H })).json()) as any[];
    check('GET /cadastro/situacoes-nf lista o seed (≥6)', Array.isArray(sits) && sits.length >= 6, sits?.length);
    const cfops = (await (await fetch(`${base}/cadastro/cfops`, { headers: H })).json()) as any[];
    check('GET /cadastro/cfops lista o catálogo (tem 5102)', Array.isArray(cfops) && cfops.some((c) => c.codcfop === '5102'), cfops?.length);

    // 16.13) DELETE em cascata (header + itens + referências)
    const nfDel = await fetch(`${base}/fiscal/nf/${nfId}`, { method: 'DELETE', headers: H });
    check('DELETE /fiscal/nf remove em cascata (204)', nfDel.status === 204, nfDel.status);

    // 18) NF F3 — PROCESSAMENTO (move estoque atômico). A fase mais perigosa.
    const saldoProd1 = async (): Promise<number> => {
      const p = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
      return Number((p?.estoques ?? []).find((e: any) => e.idempresa === 1)?.qtde);
    };
    const novaNf = async (body: Record<string, unknown>): Promise<number> => {
      const r = await fetch(`${base}/fiscal/nf`, { method: 'POST', headers: H, body: JSON.stringify(body) });
      return Number(((await r.json()) as any).codnf);
    };
    const itemP1 = (q: number) => ({ codproduto: 1, quantidade: q, vrvenda: 3.5, cfop: '1102', aliquota: 'T01' });
    const baseNf = (extra: Record<string, unknown>) => ({
      modelo: 55, serie: '1', dtemissao: '2026-06-12', dtcontabil: '2026-06-12', tipoemissao: '0', cfop: '1102', ...extra,
    });

    // 18.1) ENTRADA processada SOMA o saldo (120 -> +10) e trava a nota (proc='S').
    const s0 = await saldoProd1();
    const nfEnt = await novaNf(baseNf({ tipo: 'E', nronf: 'P3001', codparceiro: 22, itens: [itemP1(10)] }));
    const proc1 = await fetch(`${base}/fiscal/nf/${nfEnt}/processar`, { method: 'POST', headers: H });
    const s1 = await saldoProd1();
    const nfEntRead = (await (await fetch(`${base}/fiscal/nf/${nfEnt}`, { headers: H })).json()) as any;
    check(
      'POST /fiscal/nf/:id/processar (entrada) SOMA o estoque (+10) e seta proc=S',
      proc1.status === 200 && s1 === s0 + 10 && nfEntRead.proc === 'S',
      { status: proc1.status, s0, s1, proc: nfEntRead.proc },
    );

    // 18.2) processar 2x → 422 NF_JA_PROCESSADA (idempotência), saldo inalterado.
    const proc1b = await fetch(`${base}/fiscal/nf/${nfEnt}/processar`, { method: 'POST', headers: H });
    const proc1bBody = (await proc1b.json().catch(() => ({}))) as any;
    check(
      'processar nota já processada → 422 NF_JA_PROCESSADA (não move 2x), nunca 500',
      proc1b.status === 422 && proc1bBody.code === 'NF_JA_PROCESSADA' && (await saldoProd1()) === s1,
      { status: proc1b.status, code: proc1bBody.code },
    );

    // 18.3) REVERTER devolve o saldo (-10 de volta) e proc='N'.
    const rev1 = await fetch(`${base}/fiscal/nf/${nfEnt}/reverter`, { method: 'POST', headers: H });
    const s2 = await saldoProd1();
    const nfEntRead2 = (await (await fetch(`${base}/fiscal/nf/${nfEnt}`, { headers: H })).json()) as any;
    check(
      'POST /fiscal/nf/:id/reverter estorna o estoque (volta a ' + s0 + ') e seta proc=N',
      rev1.status === 200 && s2 === s0 && nfEntRead2.proc === 'N',
      { status: rev1.status, s2, proc: nfEntRead2.proc },
    );

    // 18.4) SAÍDA processada BAIXA o saldo (-2).
    const nfSai = await novaNf(baseNf({ tipo: 'S', nronf: 'P4001', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 2, vrvenda: 4.2, cfop: '5102', aliquota: 'T01' }] }));
    const procS = await fetch(`${base}/fiscal/nf/${nfSai}/processar`, { method: 'POST', headers: H });
    const s3 = await saldoProd1();
    check('processar (saída) BAIXA o estoque (−2)', procS.status === 200 && s3 === s0 - 2, { status: procS.status, s3, esperado: s0 - 2 });

    // 18.5) NEGATIVO — gate PERMITE_PROC_NF_ESTOQUE_NEG (F3b, udmNF.pas:11643; golden default 'S').
    const pgNeg = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // (a) override Empresa='N' → BLOQUEIA saída que deixaria negativo (422, rollback atômico, saldo intacto).
    await pgNeg.query(`INSERT INTO configuracoes_especificas (id,tipo,chave,valor) VALUES (84,'Empresa','1','N') ON CONFLICT (id,tipo,chave) DO UPDATE SET valor='N'`);
    const nfNegN = await novaNf(baseNf({ tipo: 'S', nronf: 'P4002', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 999999, vrvenda: 1, cfop: '5102', aliquota: 'T01' }] }));
    const procNeg = await fetch(`${base}/fiscal/nf/${nfNegN}/processar`, { method: 'POST', headers: H });
    const procNegBody = (await procNeg.json().catch(() => ({}))) as any;
    check(
      "F3b config 'N': saída que deixaria negativo → 422 NF_ESTOQUE_NEGATIVO, saldo INALTERADO (rollback)",
      procNeg.status === 422 && procNegBody.code === 'NF_ESTOQUE_NEGATIVO' && (await saldoProd1()) === s3 && procNeg.status !== 500,
      { status: procNeg.status, code: procNegBody.code, saldo: await saldoProd1(), s3 },
    );
    // (b) default 'S' (fiel ao legado) → PERMITE saldo negativo; processa e reverte p/ restaurar.
    await pgNeg.query(`DELETE FROM configuracoes_especificas WHERE id=84 AND tipo='Empresa' AND chave='1'`);
    const nfNegS = await novaNf(baseNf({ tipo: 'S', nronf: 'P4003', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 5, vrvenda: 1, cfop: '5102', aliquota: 'T01' }] }));
    const procNegS = await fetch(`${base}/fiscal/nf/${nfNegS}/processar`, { method: 'POST', headers: H });
    check(
      "F3b default 'S': saída PERMITE saldo negativo (fiel ao legado, udmNF:11643)",
      procNegS.status === 200 && (await saldoProd1()) === s3 - 5,
      { status: procNegS.status, saldo: await saldoProd1(), esperado: s3 - 5 },
    );
    await fetch(`${base}/fiscal/nf/${nfNegS}/reverter`, { method: 'POST', headers: H }); // restaura o saldo
    await pgNeg.end();
    check('F3b: reverter restaura o saldo após processamento negativo', (await saldoProd1()) === s3, { saldo: await saldoProd1(), s3 });

    // 18.6) REVERTER bloqueado se enviada à SEFAZ: processa NF com statusnfe='P' e tenta reverter.
    const nfEnvSef = await novaNf(baseNf({ tipo: 'E', nronf: 'P5001', codparceiro: 22, statusnfe: 'P', itens: [itemP1(1)] }));
    await fetch(`${base}/fiscal/nf/${nfEnvSef}/processar`, { method: 'POST', headers: H }); // proc -> 'S'
    const revEnv = await fetch(`${base}/fiscal/nf/${nfEnvSef}/reverter`, { method: 'POST', headers: H });
    const revEnvBody = (await revEnv.json().catch(() => ({}))) as any;
    check(
      'reverter NF enviada à SEFAZ (statusnfe=P) → 422 NF_ENVIADA, nunca 500',
      revEnv.status === 422 && revEnvBody.code === 'NF_ENVIADA',
      { status: revEnv.status, code: revEnvBody.code },
    );

    // 18.7) F1/F2 INTACTAS: gravar a NF (sem processar) NÃO move estoque.
    const s5 = await saldoProd1();
    await novaNf(baseNf({ tipo: 'E', nronf: 'P6001', codparceiro: 22, itens: [itemP1(50)] }));
    check('gravar NF (sem processar) NÃO move estoque (invariante F1/F2)', (await saldoProd1()) === s5, { s5, depois: await saldoProd1() });

    // 19) FIX lost-update: o cadastro de Produto NÃO clobbera o saldo movido pela NF.
    // O saldo (qtde) é OWNED pelo movimento; o substitute do agregado PRESERVA o valor do banco.
    // Simula um cliente obsoleto (qtde bogus) editando minimo → qtde preservada, minimo aplicado.
    const saldoReal = await saldoProd1();
    const prodReg = (await (await fetch(`${base}/cadastro/produtos/1`, { headers: H })).json()) as any;
    const estReg = (prodReg.estoques ?? []).find((e: any) => e.idempresa === 1);
    if (estReg) {
      estReg.qtde = 88888; // valor OBSOLETO/bogus do cliente — não pode vencer
      estReg.minimo = 33; // campo editável — deve ser aplicado
    }
    const putReg = await fetch(`${base}/cadastro/produtos/1`, { method: 'PUT', headers: H, body: JSON.stringify(prodReg) });
    const prodRegB = (await putReg.json().catch(() => ({}))) as any;
    const estRegB = (prodRegB.estoques ?? []).find((e: any) => e.idempresa === 1);
    check(
      'PUT produto PRESERVA o saldo movido pela NF (qtde do banco, ignora 88888) e aplica minimo=33',
      putReg.status === 200 && Number(estRegB?.qtde) === saldoReal && Number(estRegB?.minimo) === 33,
      { status: putReg.status, saldoReal, qtde: estRegB?.qtde, minimo: estRegB?.minimo },
    );

    // 17) NF F2 — RECÁLCULO fiscal por item (REUSO do motor precificacao). PURO (não grava).
    // 17.1) recalcular: parceiro 22 (UF=MA, seed 026), item T01 (ICMS próprio + IPI) + item STB/CFOP-ST.
    const recalc = await fetch(`${base}/fiscal/nf/recalcular`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22,
        itens: [
          { codproduto: 1, quantidade: 10, vrvenda: 3.5, aliquota: 'T01', cfop: '1102', ncm: '17019900', ipi: 5 },
          { codproduto: 3, quantidade: 2, vrvenda: 20, aliquota: 'STB', cfop: '1403', ncm: '04061010' },
        ],
      }),
    });
    const recalcBody = (await recalc.json().catch(() => ({}))) as any;
    const i0 = recalcBody?.itens?.[0] ?? {};
    const i1 = recalcBody?.itens?.[1] ?? {};
    check(
      'POST /fiscal/nf/recalcular calcula ICMS próprio do item T01/MA (base 35, ICMS 7,70, CST 0, IPI 1,75)',
      recalc.status === 200 &&
        Number(i0.vrbasecalculo) === 35 && Number(i0.vricm) === 7.7 &&
        Number(i0.cst) === 0 && Number(i0.icme) === 22 && Number(i0.bcr) === 100 && Number(i0.vripi) === 1.75,
      { status: recalc.status, i0 },
    );
    check(
      'recalcular calcula ICMS-ST do item STB/CFOP 1403 (reuso calcularIcmsSt: baseST 58, ST 3,24, CST 60)',
      Number(i1.cst) === 60 && Number(i1.vrbasest) === 58 && Number(i1.vricmst) === 3.24 && Number(i1.vrbasecalculo) === 0,
      i1,
    );

    // 17.1b) REDUÇÃO DE BASE: a redução vive 1× no BCR; o destaque usa a alíquota CHEIA
    // (não a efetiva) — senão a redução seria aplicada 2× (bug A1). T20/MA: icm 22, efetiva 12,
    // base 54,55. Item 100,00 → base 54,55 e ICMS 54,55·22% = 12,00 (com o bug daria 6,55).
    const recalcRed = await fetch(`${base}/fiscal/nf/recalcular`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'T20', cfop: '1102', ncm: '17019900' }],
      }),
    });
    const ir = ((await recalcRed.json().catch(() => ({}))) as any)?.itens?.[0] ?? {};
    check(
      'recalcular com redução de base (T20): BCR 54,55, ICMS 12,00 (alíquota CHEIA na base reduzida, não 2× redução)',
      recalcRed.status === 200 && Number(ir.bcr) === 54.55 && Number(ir.vrbasecalculo) === 54.55 &&
        Number(ir.vricm) === 12 && Number(ir.cst) === 20,
      ir,
    );

    // 17.2) alíquota não cadastrada p/ a UF da nota → 422 PT (resolverAtual), nunca 500
    const recalcBad = await fetch(`${base}/fiscal/nf/recalcular`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 1, vrvenda: 1, aliquota: 'T99', cfop: '1102' }],
      }),
    });
    const recalcBadBody = (await recalcBad.json().catch(() => ({}))) as any;
    check(
      'recalcular com alíquota inexistente p/ a UF → 422 ALIQUOTA_NAO_CADASTRADA, nunca 500',
      recalcBad.status === 422 && recalcBadBody.code === 'ALIQUOTA_NAO_CADASTRADA' && recalcBad.status !== 500,
      { status: recalcBad.status, code: recalcBadBody.code },
    );

    // 17.3) derivar soma os TOTAIS FISCAIS do header a partir dos valores por item (no create).
    const nfTot = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, nronf: '6001', serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10',
        tipoemissao: '0', cfop: '1102', codparceiro: 22,
        itens: [
          { codproduto: 1, quantidade: 10, vrvenda: 3.5, aliquota: 'T01', cfop: '1102', vrbasecalculo: 35, vricm: 7.7, vripi: 1.75, cst: 0 },
          { codproduto: 3, quantidade: 2, vrvenda: 20, aliquota: 'STB', cfop: '1403', vrbasecalculo: 0, vricm: 0, vrbasest: 58, vricmst: 3.24, cst: 60 },
        ],
      }),
    });
    const nfTotBody = (await nfTot.json().catch(() => ({}))) as any;
    check(
      'derivar soma totais fiscais no header (totalbaseicm 35, totalicm 7,70, totalipi 1,75, totalicm_st 3,24)',
      nfTot.status === 201 &&
        Number(nfTotBody.totalbaseicm) === 35 && Number(nfTotBody.totalicm) === 7.7 &&
        Number(nfTotBody.totalipi) === 1.75 && Number(nfTotBody.totalicm_st) === 3.24,
      { status: nfTot.status, totais: { tb: nfTotBody.totalbaseicm, ti: nfTotBody.totalicm, tipi: nfTotBody.totalipi, tst: nfTotBody.totalicm_st } },
    );

    // 17.4) F2b — ST PROFUNDO: MVA ajustado interestadual (empresa MG × destino MA) + redução BC-ST (REDCOM 70).
    // NCM 99999999: aliqDest 18, icmFonte 12, mva 40, redcom 70, fem 2. Espelha TIndexadorTributario (LR).
    const mvaAj = Math.round((((1 + 40 / 100) * (1 - 12 / 100) / (1 - (18 - 2) / 100)) - 1) * 100 * 1000) / 1000; // 46.667
    const baseStRaw = 100 * (70 / 100) * (1 + mvaAj / 100); // valor 100 × redcom × (1+mvaAj)
    const stEsperado = Math.round((baseStRaw * 18 / 100 - 100 * 12 / 100) * 100) / 100; // débito − crédito
    const baseStEsperado = Math.round(baseStRaw * 100) / 100;
    const recSt = await fetch(`${base}/fiscal/nf/recalcular`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'STB', cfop: '1403', ncm: '99999999' }],
      }),
    });
    const recStB = (await recSt.json().catch(() => ({}))) as any;
    const iSt = recStB.itens?.[0] ?? {};
    check(
      'F2b ST profundo: MVA ajustado (40→46,667) + REDCOM 70 → vrbasest/vricmst conferem (interestadual, LR)',
      recSt.status === 200 && Number(iSt.mva) === mvaAj && Number(iSt.vrbasest) === baseStEsperado && Number(iSt.vricmst) === stEsperado,
      { mva: iSt.mva, mvaAj, vrbasest: iSt.vrbasest, baseStEsperado, vricmst: iSt.vricmst, stEsperado },
    );

    // 17.5) F2b — ARREDONDA por item: 'N' TRUNCA (vricm 2,19) vs 'S'/default ARREDONDA (2,20).
    // T01/MA (icm 22, base 100), qtd 3 × 3,33 = 9,99 → vricm bruto 2,1978.
    const recTrunc = await fetch(`${base}/fiscal/nf/recalcular`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 3, vrvenda: 3.33, aliquota: 'T01', cfop: '1102', arredonda: 'N' }],
      }),
    });
    const recTruncB = (await recTrunc.json().catch(() => ({}))) as any;
    const itTrunc = recTruncB.itens?.[0] ?? {};
    check('F2b ARREDONDA=N TRUNCA o ICMS (2,1978 → 2,19, não 2,20)', recTrunc.status === 200 && Number(itTrunc.vricm) === 2.19, { vricm: itTrunc.vricm });
    const recRound = await fetch(`${base}/fiscal/nf/recalcular`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22,
        itens: [{ codproduto: 1, quantidade: 3, vrvenda: 3.33, aliquota: 'T01', cfop: '1102', arredonda: 'S' }],
      }),
    });
    const recRoundB = (await recRound.json().catch(() => ({}))) as any;
    const itRound = recRoundB.itens?.[0] ?? {};
    check('F2b ARREDONDA=S ARREDONDA o ICMS (2,1978 → 2,20)', recRound.status === 200 && Number(itRound.vricm) === 2.2, { vricm: itRound.vricm });

    // 20) NF F4 — FATURAMENTO (gera títulos financeiros ARECEBER/APAGAR). Dinheiro.
    // títulos de uma NF por IDNF (a duplicata agora é "<NRONF> - NNN/NNN", golden — não filtra por codnf).
    const titulosDaNf = async (cod: number): Promise<any[]> => {
      const pg = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
      const r = await pg.query(`SELECT * FROM areceber WHERE idnf=$1 ORDER BY nrodup, codrcb`, [cod]);
      await pg.end();
      return r.rows;
    };

    // 20.1) SAÍDA com itens (totalnf>0) → faturar 3 parcelas → títulos em ARECEBER, Σ == totalnf.
    const nfFat = await novaNf(baseNf({ tipo: 'S', nronf: 'F4001', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    const totalNf = Number(((await (await fetch(`${base}/fiscal/nf/${nfFat}`, { headers: H })).json()) as any).totalnf);
    const fatRes = await fetch(`${base}/fiscal/nf/${nfFat}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 3, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const fatBody = (await fatRes.json().catch(() => ({}))) as any;
    const titulos1 = await titulosDaNf(nfFat);
    const soma1 = titulos1.reduce((s, t) => s + Number(t.valor), 0);
    check(
      'POST /fiscal/nf/:id/faturar (saída) gera 3 títulos em ARECEBER com Σ == totalnf (ao centavo)',
      fatRes.status === 200 && fatBody.tabela === 'areceber' && titulos1.length === 3 && Math.abs(soma1 - totalNf) < 0.005,
      { status: fatRes.status, tabela: fatBody.tabela, n: titulos1.length, soma1, totalNf },
    );
    const nfFatRead = (await (await fetch(`${base}/fiscal/nf/${nfFat}`, { headers: H })).json()) as any;
    check('NF fica faturada=S após faturar', nfFatRead.faturada === 'S', { faturada: nfFatRead.faturada });

    // 20.2) faturar 2x → 422 NF_JA_FATURADA (idempotência).
    const fat2 = await fetch(`${base}/fiscal/nf/${nfFat}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const fat2Body = (await fat2.json().catch(() => ({}))) as any;
    check('faturar nota já faturada → 422 NF_JA_FATURADA, nunca 500', fat2.status === 422 && fat2Body.code === 'NF_JA_FATURADA', { status: fat2.status, code: fat2Body.code });

    // 20.3) ESTORNAR → títulos somem; faturada=N.
    const estRes = await fetch(`${base}/fiscal/nf/${nfFat}/estornar-faturamento`, { method: 'POST', headers: H });
    const titulosPosEstorno = await titulosDaNf(nfFat);
    const nfFatRead2 = (await (await fetch(`${base}/fiscal/nf/${nfFat}`, { headers: H })).json()) as any;
    check(
      'POST /fiscal/nf/:id/estornar-faturamento apaga os títulos e seta faturada=N',
      estRes.status === 200 && titulosPosEstorno.length === 0 && nfFatRead2.faturada === 'N',
      { status: estRes.status, n: titulosPosEstorno.length, faturada: nfFatRead2.faturada },
    );

    // 20.4) ENTRADA → faturar gera em APAGAR (modalidade A Pagar).
    const nfFatE = await novaNf(baseNf({ tipo: 'E', nronf: 'F4100', codparceiro: 22, itens: [itemP1(4)] }));
    const fatE = await fetch(`${base}/fiscal/nf/${nfFatE}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 2, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const fatEBody = (await fatE.json().catch(() => ({}))) as any;
    check('faturar (entrada) gera em APAGAR (2 parcelas)', fatE.status === 200 && fatEBody.tabela === 'apagar' && fatEBody.parcelas === 2, { status: fatE.status, body: fatEBody });

    // 20.5) totalnf=0 (item com vrvenda 0) → 422 NF_SEM_VALOR.
    const nfZero = await novaNf(baseNf({ tipo: 'S', nronf: 'F4200', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 0, cfop: '5102', aliquota: 'T01' }] }));
    const fatZero = await fetch(`${base}/fiscal/nf/${nfZero}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const fatZeroBody = (await fatZero.json().catch(() => ({}))) as any;
    check('faturar NF com total 0 → 422 NF_SEM_VALOR', fatZero.status === 422 && fatZeroBody.code === 'NF_SEM_VALOR', { status: fatZero.status, code: fatZeroBody.code });

    // 20.6) numParcelas inválido (0) → 400 VALIDACAO (zod).
    const fatBad = await fetch(`${base}/fiscal/nf/${nfZero}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 0, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const fatBadBody = (await fatBad.json().catch(() => ({}))) as any;
    check('faturar com numParcelas 0 → 400 VALIDACAO', fatBad.status === 400 && fatBadBody.code === 'VALIDACAO', { status: fatBad.status, code: fatBadBody.code });

    // 20.7) TRAVA de estorno: título QUITADO bloqueia (simula baixa via UPDATE direto no pg).
    const nfQuit = await novaNf(baseNf({ tipo: 'S', nronf: 'F4300', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 5, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfQuit}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 2, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const pool = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    await pool.query(`UPDATE areceber SET quitada='S' WHERE idnf=$1`, [nfQuit]);
    await pool.end();
    const estQuit = await fetch(`${base}/fiscal/nf/${nfQuit}/estornar-faturamento`, { method: 'POST', headers: H });
    const estQuitBody = (await estQuit.json().catch(() => ({}))) as any;
    const titulosQuit = await titulosDaNf(nfQuit);
    check(
      'estornar com título QUITADO → 422 TITULO_QUITADO e títulos INTACTOS (não apaga financeiro liquidado)',
      estQuit.status === 422 && estQuitBody.code === 'TITULO_QUITADO' && titulosQuit.length === 2,
      { status: estQuit.status, code: estQuitBody.code, n: titulosQuit.length },
    );

    // 20.8) INVARIANTE: faturar NÃO move estoque (F3 intacta).
    const sFat = await saldoProd1();
    const nfFatInv = await novaNf(baseNf({ tipo: 'S', nronf: 'F4400', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 3, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfFatInv}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    check('faturar NÃO move estoque (invariante F3)', (await saldoProd1()) === sFat, { sFat, depois: await saldoProd1() });

    // 21) REVIEW — locks de edição/exclusão + validações F1 reintroduzidas (gap-analysis).
    // 21.1) DELETE bloqueado em NF PROCESSADA (apagar deixaria estoque/kardex órfãos).
    const nfDelP = await novaNf(baseNf({ tipo: 'E', nronf: 'R7001', codparceiro: 22, itens: [itemP1(1)] }));
    await fetch(`${base}/fiscal/nf/${nfDelP}/processar`, { method: 'POST', headers: H });
    const delP = await fetch(`${base}/fiscal/nf/${nfDelP}`, { method: 'DELETE', headers: H });
    const delPB = (await delP.json().catch(() => ({}))) as any;
    check('DELETE NF processada → 422 NF_PROCESSADA (sem órfão de estoque)', delP.status === 422 && delPB.code === 'NF_PROCESSADA', { status: delP.status, code: delPB.code });

    // 21.2) DELETE bloqueado em NF FATURADA (apagar deixaria títulos órfãos).
    const nfDelF = await novaNf(baseNf({ tipo: 'S', nronf: 'R7002', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfDelF}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const delF = await fetch(`${base}/fiscal/nf/${nfDelF}`, { method: 'DELETE', headers: H });
    const delFB = (await delF.json().catch(() => ({}))) as any;
    check('DELETE NF faturada → 422 NF_TEM_FATURAMENTO (sem título órfão)', delF.status === 422 && delFB.code === 'NF_TEM_FATURAMENTO', { status: delF.status, code: delFB.code });

    // 21.3) EDIT bloqueado em NF CANCELADA.
    const nfCanc = await novaNf(baseNf({ tipo: 'S', nronf: 'R7003', cfop: '5102', codparceiro: 20, cancelada: 'S', itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    const editC = await fetch(`${base}/fiscal/nf/${nfCanc}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'tentando editar cancelada' }) });
    const editCB = (await editC.json().catch(() => ({}))) as any;
    check('PUT NF cancelada → 422 NF_CANCELADA', editC.status === 422 && editCB.code === 'NF_CANCELADA', { status: editC.status, code: editCB.code });

    // 21.4) DEVOLUÇÃO (finalidade '4') sem documento referenciado → 400 VALIDACAO.
    const devSemRef = await fetch(`${base}/fiscal/nf`, { method: 'POST', headers: H, body: JSON.stringify(baseNf({ tipo: 'S', nronf: 'R7004', cfop: '5102', finalidade: '4', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] })) });
    const devSemRefB = (await devSemRef.json().catch(() => ({}))) as any;
    check('POST devolução (finalidade 4) SEM referência → 400 VALIDACAO', devSemRef.status === 400 && devSemRefB.code === 'VALIDACAO', { status: devSemRef.status, code: devSemRefB.code });

    // 21.5) CFOP do item com 1º dígito ≠ do cabeçalho → 400 VALIDACAO.
    const cfopMix = await fetch(`${base}/fiscal/nf`, { method: 'POST', headers: H, body: JSON.stringify(baseNf({ tipo: 'E', nronf: 'R7005', cfop: '1102', codparceiro: 22, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] })) });
    const cfopMixB = (await cfopMix.json().catch(() => ({}))) as any;
    check('POST item com CFOP 1º dígito divergente do cabeçalho → 400 VALIDACAO', cfopMix.status === 400 && cfopMixB.code === 'VALIDACAO', { status: cfopMix.status, code: cfopMixB.code });

    // 21.6) DELETE de NF limpa (sem efeitos) continua permitido (não quebrou a exclusão normal).
    const nfDelOk = await novaNf(baseNf({ tipo: 'E', nronf: 'R7006', codparceiro: 22, itens: [itemP1(1)] }));
    const delOk = await fetch(`${base}/fiscal/nf/${nfDelOk}`, { method: 'DELETE', headers: H });
    check('DELETE NF limpa (proc=N/faturada=N) → 204 (exclusão normal preservada)', delOk.status === 204, delOk.status);

    // 21.7) REVERTER bloqueado em NF FATURADA (cert 2026-07-02): no legado `ReverteProcessamento`
    // (uNF:9000-9002) desfaz o financeiro junto com o estoque; no corte-1 faturar é ação SEPARADA, então
    // barramos para não deixar título ARECEBER/APAGAR órfão. Estornar o faturamento LIBERA o reverter.
    const nfRevFat = await novaNf(baseNf({ tipo: 'S', nronf: 'R7007', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfRevFat}/processar`, { method: 'POST', headers: H });
    await fetch(`${base}/fiscal/nf/${nfRevFat}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const revFat = await fetch(`${base}/fiscal/nf/${nfRevFat}/reverter`, { method: 'POST', headers: H });
    const revFatB = (await revFat.json().catch(() => ({}))) as any;
    check('reverter NF FATURADA → 422 NF_TEM_FATURAMENTO (sem título órfão)', revFat.status === 422 && revFatB.code === 'NF_TEM_FATURAMENTO', { status: revFat.status, code: revFatB.code });
    await fetch(`${base}/fiscal/nf/${nfRevFat}/estornar-faturamento`, { method: 'POST', headers: H });
    const revFat2 = await fetch(`${base}/fiscal/nf/${nfRevFat}/reverter`, { method: 'POST', headers: H });
    check('após estornar-faturamento, reverter é liberado (200)', revFat2.status === 200, revFat2.status);

    // 21.8) DELETE bloqueado em NF REFERENCIADA por outra (cert 2026-07-02, uNF:4145): a nota-origem de uma
    // devolução/complemento aponta p/ esta via nf_referencia.codnf_ref — apagar romperia a cadeia (órfão).
    const nfRefAlvo = await novaNf(baseNf({ tipo: 'S', nronf: 'R7008', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    const nfRefOrigem = await novaNf(baseNf({ tipo: 'S', nronf: 'R7009', cfop: '5102', codparceiro: 20, referencias: [{ codnf_ref: nfRefAlvo }], itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    const delRef = await fetch(`${base}/fiscal/nf/${nfRefAlvo}`, { method: 'DELETE', headers: H });
    const delRefB = (await delRef.json().catch(() => ({}))) as any;
    check('DELETE NF referenciada por outra → 422 NF_REFERENCIADA (cadeia devolução/complemento)', delRef.status === 422 && delRefB.code === 'NF_REFERENCIADA', { status: delRef.status, code: delRefB.code });
    const delOrigem = await fetch(`${base}/fiscal/nf/${nfRefOrigem}`, { method: 'DELETE', headers: H });
    const delAlvo = await fetch(`${base}/fiscal/nf/${nfRefAlvo}`, { method: 'DELETE', headers: H });
    check('removida a origem, DELETE do alvo referenciado é liberado (204)', delOrigem.status === 204 && delAlvo.status === 204, { origem: delOrigem.status, alvo: delAlvo.status });

    // 22) NF F5 — CONTÁBIL (rateio CODCONTABILNF por centro de custo). Config armazenada, SEM efeito.
    const itemS100 = { codproduto: 1, quantidade: 10, vrvenda: 10, cfop: '5102', aliquota: 'T01' }; // totalnf=100
    // 22.1) lookup PLC + criar NF saída com rateio que SOMA o total → 201 e GET traz 2 linhas.
    const plc = (await (await fetch(`${base}/cadastro/plc`, { headers: H })).json()) as any[];
    check('GET /cadastro/plc lista o catálogo (≥5)', Array.isArray(plc) && plc.length >= 5, plc?.length);
    const nfCtb = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(baseNf({ tipo: 'S', nronf: 'C8001', cfop: '5102', codparceiro: 20, itens: [itemS100], contabil: [{ idsituacao_nf: 8, codcc: 3, valor: 60 }, { idsituacao_nf: 8, codcc: 2, valor: 40 }] })),
    });
    const nfCtbBody = (await nfCtb.json().catch(() => ({}))) as any;
    check(
      'POST /fiscal/nf com rateio contábil (Σ = totalnf) → 201 e 2 linhas',
      nfCtb.status === 201 && nfCtbBody.contabil?.length === 2,
      { status: nfCtb.status, n: nfCtbBody.contabil?.length },
    );
    // 22.1b) SEM EFEITO: criar NF com rateio NÃO move estoque, NÃO contabiliza/fatura.
    check(
      'rateio contábil é CONFIG (não contabiliza/fatura)',
      (nfCtbBody.contabilizado == null || nfCtbBody.contabilizado === 'N') && (nfCtbBody.faturada == null || nfCtbBody.faturada === 'N'),
      { contabilizado: nfCtbBody.contabilizado, faturada: nfCtbBody.faturada },
    );

    // 22.2) soma ≠ total → ACEITA (201): a soma=TOTALNF é ADVISORY no legado (label, sem Abort) —
    // preview na UI; não bloqueia o save (paridade fiel; 172/22.014 NFs reais são desbalanceadas).
    const ctbDif = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(baseNf({ tipo: 'S', nronf: 'C8002', cfop: '5102', codparceiro: 20, itens: [itemS100], contabil: [{ idsituacao_nf: 8, codcc: 3, valor: 60 }, { idsituacao_nf: 8, codcc: 2, valor: 30 }] })),
    });
    const ctbDifB = (await ctbDif.json().catch(() => ({}))) as any;
    check('rateio com soma ≠ total → 201 ACEITO (soma é advisory, paridade legado)', ctbDif.status === 201 && ctbDifB.contabil?.length === 2, { status: ctbDif.status, n: ctbDifB.contabil?.length });

    // 22.3) linha sem centro de custo → 400 VALIDACAO.
    const ctbSemCC = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(baseNf({ tipo: 'S', nronf: 'C8003', cfop: '5102', codparceiro: 20, itens: [itemS100], contabil: [{ idsituacao_nf: 8, valor: 100 }] })),
    });
    const ctbSemCCB = (await ctbSemCC.json().catch(() => ({}))) as any;
    check('rateio sem centro de custo → 400 VALIDACAO', ctbSemCC.status === 400 && ctbSemCCB.code === 'VALIDACAO', { status: ctbSemCC.status, code: ctbSemCCB.code });

    // 22.4) par (situação, centro de custo) duplicado → 400 VALIDACAO.
    const ctbDup = await fetch(`${base}/fiscal/nf`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(baseNf({ tipo: 'S', nronf: 'C8004', cfop: '5102', codparceiro: 20, itens: [itemS100], contabil: [{ idsituacao_nf: 8, codcc: 3, valor: 50 }, { idsituacao_nf: 8, codcc: 3, valor: 50 }] })),
    });
    const ctbDupB = (await ctbDup.json().catch(() => ({}))) as any;
    check('rateio com par (situação,CC) duplicado → 400 VALIDACAO', ctbDup.status === 400 && ctbDupB.code === 'VALIDACAO', { status: ctbDup.status, code: ctbDupB.code });

    // 23) NF F6 — NFe mod.55 (transmissão/cancelamento/CCe) atrás da PORTA SEFAZ (simulador homolog).
    // Fluxo fiel ao legado (uNF.pas:8273: Transmitir só habilita com PROC='S'): digitar→processar→transmitir.
    const itemS = () => ({ codproduto: 1, quantidade: 10, vrvenda: 10, cfop: '5102', aliquota: 'T01' }); // totalnf=100
    const pg23 = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const processarOk = async (id: number) => { const r = await fetch(`${base}/fiscal/nf/${id}/processar`, { method: 'POST', headers: H }); return r.status; };

    // 23.0) buffer de estoque (entrada processada) p/ as saídas baixarem sem negativar.
    const nfBuf = await novaNf(baseNf({ tipo: 'E', nronf: 'N9000', codparceiro: 22, itens: [itemP1(100)] }));
    await processarOk(nfBuf);

    // 23.1) saída → PROCESSAR → transmitir → 200, statusnfe=P, chave 44+DV.
    const nfTx = await novaNf(baseNf({ tipo: 'S', nronf: 'N9001', cfop: '5102', codparceiro: 20, itens: [itemS()] }));
    await processarOk(nfTx);
    const saldoAposProc = await saldoProd1(); // estoque já baixado pelo processamento (não pela transmissão)
    const tx = await fetch(`${base}/fiscal/nf/${nfTx}/transmitir`, { method: 'POST', headers: H });
    const txBody = (await tx.json().catch(() => ({}))) as any;
    check(
      'POST /fiscal/nf/:id/transmitir (mod.55) → 200, statusnfe=P, chave 44+DV válida, simulado',
      tx.status === 200 && txBody.statusnfe === 'P' && typeof txBody.chave === 'string' && txBody.chave.length === 44 && chaveNfeValida(txBody.chave) && txBody.simulado === true,
      { status: tx.status, statusnfe: txBody.statusnfe, chave: txBody.chave, simulado: txBody.simulado },
    );
    const nfTxRead = (await (await fetch(`${base}/fiscal/nf/${nfTx}`, { headers: H })).json()) as any;
    check('NF fica statusnfe=P + chavenfe + protocolo_nfe após transmitir', nfTxRead.statusnfe === 'P' && nfTxRead.chavenfe === txBody.chave && !!nfTxRead.protocolo_nfe, { statusnfe: nfTxRead.statusnfe, chavenfe: nfTxRead.chavenfe, protocolo: nfTxRead.protocolo_nfe });

    // 23.1b) auditoria: grava nfe_xml (1) + historico_envio_nfe (tipo S).
    const xmlN = (await pg23.query(`SELECT count(*)::int n FROM nfe_xml WHERE codnf=$1`, [nfTx])).rows[0];
    const histN = (await pg23.query(`SELECT count(*)::int n, max(tipo) tipo FROM historico_envio_nfe WHERE codnf=$1`, [nfTx])).rows[0];
    check('transmitir grava nfe_xml + historico_envio_nfe (tipo S)', xmlN.n === 1 && histN.n === 1 && histN.tipo === 'S', { xml: xmlN.n, hist: histN });

    // 23.1c) INVARIANTE: a TRANSMISSÃO em si não move estoque (quem moveu foi o processamento).
    check('transmitir NÃO move estoque (o processamento moveu; transmitir é fiscal)', (await saldoProd1()) === saldoAposProc, { saldoAposProc, depois: await saldoProd1() });

    // 23.2) transmitir 2x → 422 NF_JA_TRANSMITIDA (idempotente CAS).
    const tx2 = await fetch(`${base}/fiscal/nf/${nfTx}/transmitir`, { method: 'POST', headers: H });
    const tx2Body = (await tx2.json().catch(() => ({}))) as any;
    check('transmitir nota já transmitida → 422 NF_JA_TRANSMITIDA, nunca 500', tx2.status === 422 && tx2Body.code === 'NF_JA_TRANSMITIDA', { status: tx2.status, code: tx2Body.code });

    // 23.3) NÃO processada → 422 NF_NAO_PROCESSADA (gate uNF.pas:8273).
    const nfNP = await novaNf(baseNf({ tipo: 'S', nronf: 'N9003', cfop: '5102', codparceiro: 20, itens: [itemS()] }));
    const txNP = await fetch(`${base}/fiscal/nf/${nfNP}/transmitir`, { method: 'POST', headers: H });
    const txNPBody = (await txNP.json().catch(() => ({}))) as any;
    check('transmitir NF não processada → 422 NF_NAO_PROCESSADA (gate PROC=S)', txNP.status === 422 && txNPBody.code === 'NF_NAO_PROCESSADA', { status: txNP.status, code: txNPBody.code });

    // 23.4) mod.65 (NFC-e = PDV) → 422 NF_MODELO_INVALIDO_PARA_TRANSMISSAO (checado antes do PROC).
    const nf65 = await novaNf(baseNf({ tipo: 'S', modelo: 65, nronf: 'N9002', cfop: '5102', codparceiro: 20, itens: [itemS()] }));
    const tx65 = await fetch(`${base}/fiscal/nf/${nf65}/transmitir`, { method: 'POST', headers: H });
    const tx65Body = (await tx65.json().catch(() => ({}))) as any;
    check('transmitir mod.65 → 422 NF_MODELO_INVALIDO_PARA_TRANSMISSAO', tx65.status === 422 && tx65Body.code === 'NF_MODELO_INVALIDO_PARA_TRANSMISSAO', { status: tx65.status, code: tx65Body.code });

    // 23.5) total 0 → 422 NF_SEM_VALOR (processada; codparceiro/itens são obrigatórios no create →
    // NF_SEM_DESTINATARIO/NF_SEM_ITENS/NF_TERCEIROS_NAO_TRANSMITE ficam defensivos, inalcançáveis).
    const nfSV = await novaNf(baseNf({ tipo: 'S', nronf: 'N9004', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 0, cfop: '5102', aliquota: 'T01' }] }));
    await processarOk(nfSV);
    const txSV = await fetch(`${base}/fiscal/nf/${nfSV}/transmitir`, { method: 'POST', headers: H });
    const txSVBody = (await txSV.json().catch(() => ({}))) as any;
    check('transmitir total 0 → 422 NF_SEM_VALOR', txSV.status === 422 && txSVBody.code === 'NF_SEM_VALOR', { status: txSV.status, code: txSVBody.code });

    // 23.6) cancelar NFe autorizada (xjust≥15) → 200, statusnfe=C, cancelada=S, protocolo, evento 110111.
    const sPreCancel = await saldoProd1();
    const can = await fetch(`${base}/fiscal/nf/${nfTx}/cancelar`, { method: 'POST', headers: H, body: JSON.stringify({ xjust: 'CANCELAMENTO POR ERRO DE DIGITACAO NO PEDIDO' }) });
    const canBody = (await can.json().catch(() => ({}))) as any;
    const nfCanRead = (await (await fetch(`${base}/fiscal/nf/${nfTx}`, { headers: H })).json()) as any;
    const evC = (await pg23.query(`SELECT count(*)::int n FROM nfe_evento WHERE codnf=$1 AND tipo_evento=110111`, [nfTx])).rows[0];
    check(
      'cancelar NFe autorizada → 200, statusnfe=C + cancelada=S + protocolo_cancelamento + evento 110111',
      can.status === 200 && canBody.statusnfe === 'C' && nfCanRead.statusnfe === 'C' && nfCanRead.cancelada === 'S' && !!nfCanRead.protocolo_cancelamento && evC.n === 1,
      { status: can.status, statusnfe: nfCanRead.statusnfe, cancelada: nfCanRead.cancelada, protocolo: nfCanRead.protocolo_cancelamento, eventos: evC.n },
    );
    // 23.6b) GOLDEN: cancelar uma NF PROCESSADA ESTORNA o estoque (saída baixou 10 → cancelar devolve +10)
    // + grava um kardex de estorno NF-CANC (movimento original preservado, net-0).
    const sPosCancel = await saldoProd1();
    const kCanc = (await pg23.query(`SELECT count(*)::int n FROM historico_prod WHERE codnf=$1 AND origem='NF-CANC'`, [nfTx])).rows[0];
    check(
      'cancelar NF processada ESTORNA o estoque (+10 de volta) + kardex NF-CANC (golden)',
      sPosCancel === sPreCancel + 10 && kCanc.n >= 1,
      { sPreCancel, sPosCancel, esperado: sPreCancel + 10, kardexCanc: kCanc.n },
    );

    // 23.7) cancelar NFe NÃO autorizada (statusnfe vazio) → 422 NF_NAO_AUTORIZADA.
    const nfNA = await novaNf(baseNf({ tipo: 'S', nronf: 'N9005', cfop: '5102', codparceiro: 20, itens: [itemS()] }));
    const canNA = await fetch(`${base}/fiscal/nf/${nfNA}/cancelar`, { method: 'POST', headers: H, body: JSON.stringify({ xjust: 'TENTATIVA DE CANCELAR NOTA NAO AUTORIZADA' }) });
    const canNABody = (await canNA.json().catch(() => ({}))) as any;
    check('cancelar NFe não-autorizada → 422 NF_NAO_AUTORIZADA', canNA.status === 422 && canNABody.code === 'NF_NAO_AUTORIZADA', { status: canNA.status, code: canNABody.code });

    // 23.8) cancelar com justificativa <15 → 400 VALIDACAO (schema).
    const canShort = await fetch(`${base}/fiscal/nf/${nfNA}/cancelar`, { method: 'POST', headers: H, body: JSON.stringify({ xjust: 'curta' }) });
    const canShortBody = (await canShort.json().catch(() => ({}))) as any;
    check('cancelar com justificativa <15 → 400 VALIDACAO', canShort.status === 400 && canShortBody.code === 'VALIDACAO', { status: canShort.status, code: canShortBody.code });

    // 23.9) CCe em NFe autorizada (processada+transmitida) → 200 seq=1; 2ª → seq=2.
    const nfCce = await novaNf(baseNf({ tipo: 'S', nronf: 'N9006', cfop: '5102', codparceiro: 20, itens: [itemS()] }));
    await processarOk(nfCce);
    await fetch(`${base}/fiscal/nf/${nfCce}/transmitir`, { method: 'POST', headers: H });
    const cce1 = await fetch(`${base}/fiscal/nf/${nfCce}/cce`, { method: 'POST', headers: H, body: JSON.stringify({ correcao: 'CORRECAO DO ENDERECO DE ENTREGA DO CLIENTE' }) });
    const cce1Body = (await cce1.json().catch(() => ({}))) as any;
    check('CCe em NFe autorizada → 200 seq=1', cce1.status === 200 && cce1Body.seq === 1, { status: cce1.status, seq: cce1Body.seq });
    const cce2 = await fetch(`${base}/fiscal/nf/${nfCce}/cce`, { method: 'POST', headers: H, body: JSON.stringify({ correcao: 'SEGUNDA CORRECAO DA TRANSPORTADORA INFORMADA' }) });
    const cce2Body = (await cce2.json().catch(() => ({}))) as any;
    check('2ª CCe → seq=2 (nSeqEvento incrementa)', cce2.status === 200 && cce2Body.seq === 2, { status: cce2.status, seq: cce2Body.seq });

    // 23.10) CCe com texto <15 → 400 VALIDACAO.
    const cceShort = await fetch(`${base}/fiscal/nf/${nfCce}/cce`, { method: 'POST', headers: H, body: JSON.stringify({ correcao: 'curta' }) });
    const cceShortBody = (await cceShort.json().catch(() => ({}))) as any;
    check('CCe com texto <15 → 400 VALIDACAO', cceShort.status === 400 && cceShortBody.code === 'VALIDACAO', { status: cceShort.status, code: cceShortBody.code });

    // 23.11) limite de 20 CCe/nota: seed seq 3..20 via pg (já há 2) → 21ª via API → 422 NF_CCE_LIMITE.
    await pg23.query(`INSERT INTO nfe_evento (codnf, idempresa, tipo_evento, seq_evento, descricao) SELECT $1, 1, 110110, g, 'seed-limite' FROM generate_series(3,20) g`, [nfCce]);
    const cce21 = await fetch(`${base}/fiscal/nf/${nfCce}/cce`, { method: 'POST', headers: H, body: JSON.stringify({ correcao: 'VIGESIMA PRIMEIRA CARTA DE CORRECAO DE TESTE' }) });
    const cce21Body = (await cce21.json().catch(() => ({}))) as any;
    check('21ª CCe (limite 20) → 422 NF_CCE_LIMITE', cce21.status === 422 && cce21Body.code === 'NF_CCE_LIMITE', { status: cce21.status, code: cce21Body.code });

    await pg23.end();

    // 24) EMPRESAS — cadastro da empresa/tenant (consolidou empresa_fiscal) + F4b txjuros de empresas.
    // 24.1) GET lista (seed empresa 1, LR/MG) + GET /1 com campos fiscais reais (golden Oracle).
    const emps = (await (await fetch(`${base}/cadastro/empresas`, { headers: H })).json()) as any[];
    check('GET /cadastro/empresas lista (seed empresa 1)', Array.isArray(emps) && emps.some((e) => Number(e.idempresa) === 1 && e.classfiscal === 'LR'), { n: emps?.length });
    const emp1 = (await (await fetch(`${base}/cadastro/empresas/1`, { headers: H })).json()) as any;
    check(
      'GET /cadastro/empresas/1 traz fiscal real (LR/MG/IBGE 3170206/DESPOPER 20/TXJURO 5)',
      emp1.classfiscal === 'LR' && emp1.uf === 'MG' && Number(emp1.idcidade) === 3170206 && Number(emp1.despoperacional) === 20 && Number(emp1.txjuropadrao) === 5,
      { classfiscal: emp1.classfiscal, uf: emp1.uf, idcidade: emp1.idcidade, despoper: emp1.despoperacional, txjuro: emp1.txjuropadrao },
    );

    // 24.2) POST cria empresa 2 (PK digitada, não-empresaScoped) → 201.
    const emp2 = await fetch(`${base}/cadastro/empresas`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ idempresa: 2, razao_social: 'EMPRESA DOIS LTDA', cnpj: '11444777000161', uf: 'MG', classfiscal: 'LR', despoperacional: 18, txjuropadrao: 3, figurafiscal: 'O' }),
    });
    const emp2Body = (await emp2.json().catch(() => ({}))) as any;
    check('POST /cadastro/empresas cria empresa 2 (idempresa digitado)', emp2.status === 201 && Number(emp2Body.idempresa) === 2, { status: emp2.status, id: emp2Body.idempresa });

    // 24.3) validações.
    const empCnpjBad = await fetch(`${base}/cadastro/empresas`, { method: 'POST', headers: H, body: JSON.stringify({ idempresa: 3, razao_social: 'X', cnpj: '11111111111111', uf: 'MG', classfiscal: 'LR' }) });
    check('POST empresa com CNPJ inválido → 400 VALIDACAO', empCnpjBad.status === 400 && ((await empCnpjBad.json().catch(() => ({}))) as any).code === 'VALIDACAO', empCnpjBad.status);
    const empSnBad = await fetch(`${base}/cadastro/empresas`, { method: 'POST', headers: H, body: JSON.stringify({ idempresa: 3, razao_social: 'X', cnpj: '11444777000161', uf: 'MG', classfiscal: 'SN' }) });
    check('POST empresa SN sem ALQSIMPLESNAC → 400 VALIDACAO', empSnBad.status === 400 && ((await empSnBad.json().catch(() => ({}))) as any).code === 'VALIDACAO', empSnBad.status);
    const empMargBad = await fetch(`${base}/cadastro/empresas`, { method: 'POST', headers: H, body: JSON.stringify({ idempresa: 3, razao_social: 'X', cnpj: '11444777000161', uf: 'MG', classfiscal: 'LR', margem_contribuicao: -1 }) });
    check('POST empresa com margem_contribuicao<0 → 400 VALIDACAO', empMargBad.status === 400 && ((await empMargBad.json().catch(() => ({}))) as any).code === 'VALIDACAO', empMargBad.status);

    // 24.4) F4b: faturar grava txjuros = empresas.txjuropadrao (5,0), não mais do parceiro.
    const nfTxj = await novaNf(baseNf({ tipo: 'S', nronf: 'E5001', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 5, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfTxj}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const pgTxj = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const titTxj = (await pgTxj.query(`SELECT txjuros FROM areceber WHERE idnf=$1`, [nfTxj])).rows[0];
    await pgTxj.end();
    check('F4b: faturar grava txjuros = empresas.txjuropadrao (5,0), não do parceiro', Number(titTxj?.txjuros) === 5, { txjuros: titTxj?.txjuros, esperado: 5 });

    // 25) Camada de config (APROVEITAMENTO_CREDITO_ICMSST_NF) + F2c (gate SN da empresa).
    const pgCfg = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // T01/MA (base 100, icm 22) + CFOP 1403 (fim '403' → zeraCreditoIcms). vrbasecalculo: 0 (default) / 100 (aproveita).
    const recalcCredito = async (): Promise<number> => {
      const r = await fetch(`${base}/fiscal/nf/recalcular`, { method: 'POST', headers: H, body: JSON.stringify({ tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'T01', cfop: '1403' }] }) });
      return Number(((await r.json().catch(() => ({}))) as any).itens?.[0]?.vrbasecalculo);
    };
    // 25.1) resolver: default 'N' zera o crédito; override Empresa='S' APROVEITA; remover volta ao default.
    check("config: default 'N' → zera o crédito de ST (base 0)", (await recalcCredito()) === 0, { base: await recalcCredito() });
    await pgCfg.query(`INSERT INTO configuracoes_especificas (id,tipo,chave,valor) VALUES (290,'Empresa','1','S') ON CONFLICT (id,tipo,chave) DO UPDATE SET valor='S'`);
    check("config: override Empresa='S' → APROVEITA o crédito (base 100)", (await recalcCredito()) === 100, { base: await recalcCredito() });
    await pgCfg.query(`DELETE FROM configuracoes_especificas WHERE id=290 AND tipo='Empresa' AND chave='1'`);
    check("config: removido o override → volta ao default 'N' (base 0)", (await recalcCredito()) === 0, { base: await recalcCredito() });

    // 25.2) F2c gate SN: empresa Simples NÃO destaca ICMS (DmOld/udmNF.pas:1869). T01/MA CFOP 1102 (não zera).
    const recalcIcm = async (): Promise<number> => {
      const r = await fetch(`${base}/fiscal/nf/recalcular`, { method: 'POST', headers: H, body: JSON.stringify({ tipo: 'S', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'T01', cfop: '1102' }] }) });
      return Number(((await r.json().catch(() => ({}))) as any).itens?.[0]?.vricm);
    };
    check('F2c: empresa LR destaca ICMS (vricm 22,00)', (await recalcIcm()) === 22, { vricm: await recalcIcm() });
    await pgCfg.query(`UPDATE empresas SET classfiscal='SN' WHERE idempresa=1`);
    check('F2c: empresa SN NÃO destaca ICMS (vricm 0) — DmOld:1869', (await recalcIcm()) === 0, { vricm: await recalcIcm() });
    await pgCfg.query(`UPDATE empresas SET classfiscal='LR' WHERE idempresa=1`);
    check('F2c: revertida p/ LR volta a destacar (vricm 22,00)', (await recalcIcm()) === 22, { vricm: await recalcIcm() });
    // 25.3) F2c-2 P1 — crédito de ENTRADA da empresa SN = base·ALQSIMPLESNAC/100 (udmNF.pas:4021).
    await pgCfg.query(`UPDATE empresas SET classfiscal='SN', alqsimplesnac=3 WHERE idempresa=1`);
    const recEntSn = await fetch(`${base}/fiscal/nf/recalcular`, { method: 'POST', headers: H, body: JSON.stringify({ tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'T01', cfop: '1102' }] }) });
    const itEntSn = ((((await recEntSn.json().catch(() => ({}))) as any).itens ?? [])[0] ?? {}) as any;
    check('F2c-2: entrada SN → crédito presumido base·ALQSIMPLESNAC/100 (vricm 3, base 100, ST 0)', Number(itEntSn.vricm) === 3 && Number(itEntSn.vrbasecalculo) === 100 && Number(itEntSn.vrbasest ?? 0) === 0, { vricm: itEntSn.vricm, base: itEntSn.vrbasecalculo, st: itEntSn.vrbasest });
    await pgCfg.query(`UPDATE empresas SET classfiscal='LR', alqsimplesnac=NULL WHERE idempresa=1`);
    // 25.4) F2c-2 P2 — figura fiscal: empresa 'O' + produto com codfigurafiscal resolve CST pela OPERAÇÃO
    // (R→20, udmNF.pas:10096) e ST pela figura (multi-chave MG→MA CFOP 6404, MVA 40). Empresa 'D' não usa.
    await pgCfg.query(`UPDATE empresas SET figurafiscal='O' WHERE idempresa=1`);
    await pgCfg.query(`UPDATE produtos SET codfigurafiscal=1 WHERE idproduto=1`);
    const recFig = await fetch(`${base}/fiscal/nf/recalcular`, { method: 'POST', headers: H, body: JSON.stringify({ tipo: 'S', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'T01', cfop: '6404' }] }) });
    const itFig = ((((await recFig.json().catch(() => ({}))) as any).itens ?? [])[0] ?? {}) as any;
    check('F2c-2: figura O → CST pela operação (R→20) + ST pela figura (vricmst>0)', Number(itFig.cst) === 20 && Number(itFig.vricmst) > 0, { cst: itFig.cst, vricmst: itFig.vricmst, mva: itFig.mva });
    await pgCfg.query(`UPDATE empresas SET figurafiscal='D' WHERE idempresa=1`);
    await pgCfg.query(`UPDATE produtos SET codfigurafiscal=NULL WHERE idproduto=1`);
    // 25.5) A1 — RETENÇÕES de serviço (entrada, situação E03=1031, CFOP 1102 dispara FUNRURAL). base=totalnf=100.
    await pgCfg.query(`UPDATE parceiros SET habilita_retencao_pis_nf='S', habilita_retencao_cofins_nf='S', habilita_retencao_csll_nf='S', habilita_retencao_ir_nf='S', habilita_retencao_inss_nf='S', habilita_retencao_issqn_nf='S', habilita_retencao_funrural_nf='S', perc_aliquota_issqn=2, perc_aliquota_ir=0 WHERE codparceiro=22`);
    const recRet = await fetch(`${base}/fiscal/nf/recalcular`, { method: 'POST', headers: H, body: JSON.stringify({ tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, idsituacao_nf: 1031, cfop: '1102', itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'T01', cfop: '1102' }] }) });
    const ret = (await recRet.json().catch(() => ({}))) as any;
    check('A1 retenções (base 100): PIS 0,65 · COFINS 3 · CSLL 1 · IR 1 · INSS 11 · ISSQN 2 · FUNRURAL 1', Number(ret.total_ret_pis) === 0.65 && Number(ret.total_ret_cofins) === 3 && Number(ret.total_ret_csll) === 1 && Number(ret.total_ret_ir) === 1 && Number(ret.total_ret_inss) === 11 && Number(ret.total_ret_issqn) === 2 && Number(ret.total_ret_funrural) === 1, { pis: ret.total_ret_pis, cofins: ret.total_ret_cofins, csll: ret.total_ret_csll, ir: ret.total_ret_ir, inss: ret.total_ret_inss, issqn: ret.total_ret_issqn, funrural: ret.total_ret_funrural });
    // não gera retenção quando a situação não é E03 (idsituacao 6).
    const recNoRet = await fetch(`${base}/fiscal/nf/recalcular`, { method: 'POST', headers: H, body: JSON.stringify({ tipo: 'E', modelo: 55, serie: '1', dtemissao: '2026-06-10', dtcontabil: '2026-06-10', codparceiro: 22, idsituacao_nf: 6, cfop: '5102', itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, aliquota: 'T01', cfop: '5102' }] }) });
    const noRet = (await recNoRet.json().catch(() => ({}))) as any;
    check('A1 retenções: situação não-E03 → zero retenção (só E03 gera)', Number(noRet.total_ret_pis) === 0 && Number(noRet.total_ret_inss) === 0, { pis: noRet.total_ret_pis, inss: noRet.total_ret_inss });
    await pgCfg.query(`UPDATE parceiros SET habilita_retencao_pis_nf=NULL, habilita_retencao_cofins_nf=NULL, habilita_retencao_csll_nf=NULL, habilita_retencao_inss_nf=NULL, habilita_retencao_issqn_nf=NULL, habilita_retencao_funrural_nf=NULL WHERE codparceiro=22`);
    await pgCfg.end();

    // 26) ISOLAMENTO MULTI-TENANT no WRITE-PATH (achado da auditoria de validação): update/remove
    //     do engine agora exigem POSSE por idempresa (pertenceAEmpresa). Empresa 1 NÃO pode
    //     alterar/excluir linha empresaScoped da empresa 2 (antes casava só por PK → IDOR cross-empresa).
    const H2 = { ...H, 'x-empresa-id': '2' };
    const pgMt = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // RBAC é por empresa: concede ao operador 7 gravar/excluir contas nas DUAS empresas, para que o
    // teste exercite a GUARDA DO ENGINE (posse por idempresa), não o RBAC.
    await pgMt.query(`INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
      ('FRMCADCONTASBANCARIAS','BTNGRAVAR',7,1),('FRMCADCONTASBANCARIAS','BTNEXCLUIR',7,1),
      ('FRMCADCONTASBANCARIAS','BTNGRAVAR',7,2),('FRMCADCONTASBANCARIAS','BTNEXCLUIR',7,2)`);
    await pgMt.end();
    const bancosMt = (await (await fetch(`${base}/cadastro/bancos`, { headers: H2 })).json()) as any[];
    const codbcoMt = Number(bancosMt?.[0]?.codigo); // a view get_bancos aliasa codbco AS codigo
    // empresa 2 cria uma conta (setup)
    const contaRes = await fetch(`${base}/cadastro/contas-bancarias`, {
      method: 'POST', headers: H2,
      body: JSON.stringify({ codbco: codbcoMt, titular: 'CONTA EMPRESA 2', nroconta: '111', ativo: 'S' }),
    });
    const contaId = Number(((await contaRes.json().catch(() => ({}))) as any).codconta);
    check('MT: empresa 2 cria conta bancária (setup)', contaRes.status === 201 && contaId > 0, { status: contaRes.status, id: contaId });
    // empresa 1 TENTA alterar a conta da empresa 2 → guarda fail-closed (no-op)
    await fetch(`${base}/cadastro/contas-bancarias/${contaId}`, { method: 'PUT', headers: H, body: JSON.stringify({ codbco: codbcoMt, titular: 'INVASOR EMPRESA 1', ativo: 'N' }) });
    const aposPut = (await (await fetch(`${base}/cadastro/contas-bancarias/${contaId}`, { headers: H2 })).json()) as any;
    check('MT: empresa 1 NÃO altera conta da empresa 2 (titular/ativo intactos)', aposPut?.titular === 'CONTA EMPRESA 2' && aposPut?.ativo === 'S', { titular: aposPut?.titular, ativo: aposPut?.ativo });
    // empresa 1 TENTA excluir a conta da empresa 2 → no-op
    await fetch(`${base}/cadastro/contas-bancarias/${contaId}`, { method: 'DELETE', headers: H });
    const aposDel = await fetch(`${base}/cadastro/contas-bancarias/${contaId}`, { headers: H2 });
    const aposDelBody = (await aposDel.json().catch(() => ({}))) as any;
    check('MT: empresa 1 NÃO exclui conta da empresa 2 (conta persiste)', aposDel.status === 200 && Number(aposDelBody?.codconta) === contaId, { status: aposDel.status, id: aposDelBody?.codconta });
    // controle positivo: a DONA (empresa 2) altera a própria conta normalmente
    await fetch(`${base}/cadastro/contas-bancarias/${contaId}`, { method: 'PUT', headers: H2, body: JSON.stringify({ codbco: codbcoMt, titular: 'DONA ALTEROU', ativo: 'S' }) });
    const aposDona = (await (await fetch(`${base}/cadastro/contas-bancarias/${contaId}`, { headers: H2 })).json()) as any;
    check('MT: a empresa DONA (2) altera a própria conta (controle positivo)', aposDona?.titular === 'DONA ALTEROU', { titular: aposDona?.titular });
    // cleanup: a dona exclui
    const delDona = await fetch(`${base}/cadastro/contas-bancarias/${contaId}`, { method: 'DELETE', headers: H2 });
    check('MT: a empresa DONA (2) exclui a própria conta (cleanup)', delDona.status === 204, { status: delDona.status });

    // 27) F4b — estorno do FINANCEIRO no CANCELAMENTO (ESTORNA_FINANCEIRO_NF; CancelaFaturamento uNF:6668).
    const pgFin = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // prepara uma NF de saída cancelável: processa (proc='S') → fatura (2 títulos ARECEBER) → transmite (statusnfe='P').
    const prepCancelavel = async (nronf: string): Promise<number> => {
      const id = await novaNf(baseNf({ tipo: 'S', nronf, cfop: '5102', codparceiro: 20, modelo: 55, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
      await fetch(`${base}/fiscal/nf/${id}/processar`, { method: 'POST', headers: H });
      await fetch(`${base}/fiscal/nf/${id}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 2, primeiroVencimento: '2026-08-10', intervaloDias: 30 }) });
      await fetch(`${base}/fiscal/nf/${id}/transmitir`, { method: 'POST', headers: H });
      return id;
    };
    const titulosDe = async (idnf: number): Promise<number> => Number((await pgFin.query(`SELECT count(*)::int n FROM areceber WHERE idnf=$1`, [idnf])).rows[0].n);
    // (a) default 'N' → cancelar MANTÉM os títulos (fiel: CancelaFaturamento gated por ESTORNA_FINANCEIRO_NF).
    await pgFin.query(`DELETE FROM configuracoes_especificas WHERE id=4 AND tipo='Empresa' AND chave='1'`);
    const nfFinN = await prepCancelavel('E7001');
    const canN = await fetch(`${base}/fiscal/nf/${nfFinN}/cancelar`, { method: 'POST', headers: H, body: JSON.stringify({ xjust: 'CANCELAMENTO TESTE F4B DEFAULT N MANTEM TITULOS' }) });
    check("F4b default 'N': cancelar MANTÉM os títulos (fiel ao legado)", canN.status === 200 && (await titulosDe(nfFinN)) === 2, { status: canN.status, titulos: await titulosDe(nfFinN) });
    // (b) override 'S' → cancelar ESTORNA (deleta títulos) e reabre faturada.
    await pgFin.query(`INSERT INTO configuracoes_especificas (id,tipo,chave,valor) VALUES (4,'Empresa','1','S') ON CONFLICT (id,tipo,chave) DO UPDATE SET valor='S'`);
    const nfFinS = await prepCancelavel('E7002');
    const canS = await fetch(`${base}/fiscal/nf/${nfFinS}/cancelar`, { method: 'POST', headers: H, body: JSON.stringify({ xjust: 'CANCELAMENTO TESTE F4B S ESTORNA FINANCEIRO' }) });
    const canSBody = (await canS.json().catch(() => ({}))) as any;
    const fatS = (await pgFin.query(`SELECT faturada FROM nf WHERE codnf=$1`, [nfFinS])).rows[0]?.faturada;
    check("F4b config 'S': cancelar ESTORNA os títulos e reabre faturada", canS.status === 200 && (await titulosDe(nfFinS)) === 0 && fatS === 'N' && canSBody.financeiro === 'estornado', { status: canS.status, titulos: await titulosDe(nfFinS), faturada: fatS, fin: canSBody.financeiro });
    // (c) 'S' mas título QUITADO → MANTÉM financeiro (VerificaExisteBaixas), sem abortar o cancelamento.
    const nfFinQ = await prepCancelavel('E7003');
    await pgFin.query(`UPDATE areceber SET quitada='S' WHERE idnf=$1 AND codempresa=1`, [nfFinQ]);
    const canQ = await fetch(`${base}/fiscal/nf/${nfFinQ}/cancelar`, { method: 'POST', headers: H, body: JSON.stringify({ xjust: 'CANCELAMENTO TESTE F4B QUITADO MANTEM FINANCEIRO' }) });
    const canQBody = (await canQ.json().catch(() => ({}))) as any;
    check("F4b 'S' com título quitado: MANTÉM financeiro e cancela mesmo assim (best-effort)", canQ.status === 200 && (await titulosDe(nfFinQ)) === 2 && canQBody.financeiro === 'mantido-quitado', { status: canQ.status, titulos: await titulosDe(nfFinQ), fin: canQBody.financeiro });
    await pgFin.query(`DELETE FROM configuracoes_especificas WHERE id=4 AND tipo='Empresa' AND chave='1'`);
    await pgFin.end();

    // 28) F3b — reconciliação no processar + tratamento de DENEGADA (statusnfe='D') + guarda de faturar.
    const pgF3b = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // 28.1) reconciliação de TOTAL: total adulterado → 422 (rollback, proc intacto); corrigido → processa.
    const nfRec = await novaNf(baseNf({ tipo: 'S', nronf: 'E8101', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 2, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await pgF3b.query(`UPDATE nf SET totalnf = totalnf + 1 WHERE codnf=$1`, [nfRec]);
    const procRec = await fetch(`${base}/fiscal/nf/${nfRec}/processar`, { method: 'POST', headers: H });
    const procRecBody = (await procRec.json().catch(() => ({}))) as any;
    const procRecState = (await pgF3b.query(`SELECT proc FROM nf WHERE codnf=$1`, [nfRec])).rows[0]?.proc;
    check('F3b reconciliação: total adulterado → 422 NF_TOTAL_DIVERGENTE, proc intacto (N)', procRec.status === 422 && procRecBody.code === 'NF_TOTAL_DIVERGENTE' && procRecState === 'N', { status: procRec.status, code: procRecBody.code, proc: procRecState });
    await pgF3b.query(`UPDATE nf SET totalnf = totalnf - 1 WHERE codnf=$1`, [nfRec]);
    const procRecOk = await fetch(`${base}/fiscal/nf/${nfRec}/processar`, { method: 'POST', headers: H });
    check('F3b reconciliação: total correto → processa (200)', procRecOk.status === 200, { status: procRecOk.status });
    // 28.2) reconciliação de ICMS-ST (empresa figurafiscal='D'): totalicm_st adulterado → 422 NF_ST_DIVERGENTE.
    const nfSt = await novaNf(baseNf({ tipo: 'S', nronf: 'E8102', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await pgF3b.query(`UPDATE nf SET totalicm_st = 5 WHERE codnf=$1`, [nfSt]);
    const procStF = await fetch(`${base}/fiscal/nf/${nfSt}/processar`, { method: 'POST', headers: H });
    const procStBody = (await procStF.json().catch(() => ({}))) as any;
    check("F3b reconciliação ST (figurafiscal='D'): totalicm_st adulterado → 422 NF_ST_DIVERGENTE", procStF.status === 422 && procStBody.code === 'NF_ST_DIVERGENTE', { status: procStF.status, code: procStBody.code });
    // 28.3) DENEGADA: transmitir cStat 110 → statusnfe='D' com estoque preso; faturar bloqueia; reverter estorna+limpa.
    const nfDen = await novaNf(baseNf({ tipo: 'S', nronf: 'E8201', cfop: '5102', codparceiro: 20, modelo: 55, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    const s0Den = await saldoProd1();
    await fetch(`${base}/fiscal/nf/${nfDen}/processar`, { method: 'POST', headers: H }); // proc='S' (saldo −1)
    process.env.SEFAZ_SIM_CSTAT = '110'; // força a SEFAZ simulada a DENEGAR só neste transmitir
    const txDen = await fetch(`${base}/fiscal/nf/${nfDen}/transmitir`, { method: 'POST', headers: H });
    delete process.env.SEFAZ_SIM_CSTAT;
    const stDen = (await pgF3b.query(`SELECT statusnfe, proc FROM nf WHERE codnf=$1`, [nfDen])).rows[0];
    check('F3b denegada: transmitir cStat 110 → statusnfe=D, proc=S (estoque preso)', txDen.status === 200 && stDen?.statusnfe === 'D' && stDen?.proc === 'S', { status: txDen.status, statusnfe: stDen?.statusnfe, proc: stDen?.proc });
    const fatDen = await fetch(`${base}/fiscal/nf/${nfDen}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-09-10', intervaloDias: 30 }) });
    const fatDenBody = (await fatDen.json().catch(() => ({}))) as any;
    check('F3b denegada: faturar → 422 NF_DENEGADA', fatDen.status === 422 && fatDenBody.code === 'NF_DENEGADA', { status: fatDen.status, code: fatDenBody.code });
    const revDen = await fetch(`${base}/fiscal/nf/${nfDen}/reverter`, { method: 'POST', headers: H });
    const stRev = (await pgF3b.query(`SELECT statusnfe, chavenfe, proc FROM nf WHERE codnf=$1`, [nfDen])).rows[0];
    check('F3b denegada: reverter estorna estoque + limpa status (statusnfe/chave null, proc N, saldo restaurado)', revDen.status === 200 && stRev?.statusnfe === null && stRev?.chavenfe === null && stRev?.proc === 'N' && (await saldoProd1()) === s0Den, { status: revDen.status, statusnfe: stRev?.statusnfe, chave: stRev?.chavenfe, proc: stRev?.proc, saldo: await saldoProd1(), s0Den });
    await pgF3b.end();

    // 29) F5b — CONTÁBIL / DIÁRIO (partida dobrada): contabilizar gera linhas no diario + estorno + guardas.
    const pgCon = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const diarioDe = async (codnf: number) => (await pgCon.query(`SELECT contadebito, contacredito, valor FROM diario WHERE codorigem=12 AND idorigem=$1 ORDER BY coddiario`, [codnf])).rows;
    // NF entrada processada + rateio contábil (situação 6 → IIC D=148/C=11141).
    const nfCon = await novaNf(baseNf({ tipo: 'E', nronf: 'E9001', cfop: '1102', codparceiro: 22, idsituacao_nf: 6, itens: [{ codproduto: 1, quantidade: 5, vrvenda: 10, cfop: '1102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfCon}/processar`, { method: 'POST', headers: H });
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,6,1,30),($1,6,1,20)`, [nfCon]); // Σ situação 6 = 50
    const conRes = await fetch(`${base}/fiscal/nf/${nfCon}/contabilizar`, { method: 'POST', headers: H });
    const linhas = await diarioDe(nfCon);
    const conFlag = (await pgCon.query(`SELECT contabilizado FROM nf WHERE codnf=$1`, [nfCon])).rows[0]?.contabilizado;
    check('F5b: contabilizar gera DIÁRIO (situação 6 → D148/C11141 valor 50) + contabilizado=S', conRes.status === 200 && linhas.length === 1 && Number(linhas[0].contadebito) === 148 && Number(linhas[0].contacredito) === 11141 && Number(linhas[0].valor) === 50 && conFlag === 'S', { status: conRes.status, linhas, flag: conFlag });
    const con2 = await fetch(`${base}/fiscal/nf/${nfCon}/contabilizar`, { method: 'POST', headers: H });
    check('F5b: contabilizar 2x → 422 NF_JA_CONTABILIZADA', con2.status === 422 && ((await con2.json().catch(() => ({}))) as any).code === 'NF_JA_CONTABILIZADA', { status: con2.status });
    const estCon = await fetch(`${base}/fiscal/nf/${nfCon}/estornar-contabilizacao`, { method: 'POST', headers: H });
    const flagE = (await pgCon.query(`SELECT contabilizado FROM nf WHERE codnf=$1`, [nfCon])).rows[0]?.contabilizado;
    check('F5b: estornar-contabilizacao deleta o DIÁRIO + reabre (contabilizado null)', estCon.status === 200 && (await diarioDe(nfCon)).length === 0 && flagE == null, { status: estCon.status, linhas: (await diarioDe(nfCon)).length, flag: flagE });
    // 29a2) CONSOLIDAÇÃO por situação (cert 2026-07-02): rateio com 2 centros de custo DIFERENTES na MESMA
    // situação 'F' (6 → D148/C11141) gera UMA linha no DIÁRIO com valor=Σ — fiel ao golden (CODNF 72296/
    // 84938/80589: N centros de custo → 1 linha consolidada, codcc nulo). Antes do fix eram 2 linhas
    // idênticas (fragmentação). O CODCC só quebraria a linha se o débito fosse automático 'A' por CC.
    const nfCons = await novaNf(baseNf({ tipo: 'E', nronf: 'E9100', cfop: '1102', codparceiro: 22, idsituacao_nf: 6, itens: [{ codproduto: 1, quantidade: 10, vrvenda: 10, cfop: '1102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfCons}/processar`, { method: 'POST', headers: H }); // proc=S (rateio entra depois → auto-disparo pula)
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,6,1,60),($1,6,2,40)`, [nfCons]); // 2 CC DIFERENTES, Σ situação 6 = 100
    const conCons = await fetch(`${base}/fiscal/nf/${nfCons}/contabilizar`, { method: 'POST', headers: H });
    const principais = ((await diarioDe(nfCons)) as any[]).filter((l) => Number(l.contadebito) === 148 && Number(l.contacredito) === 11141);
    check('F5b-cert: rateio multi-CC na MESMA situação F → 1 linha consolidada (valor Σ=100), sem fragmentar', conCons.status === 200 && principais.length === 1 && Number(principais[0].valor) === 100, { status: conCons.status, principais });
    // guarda: NF processada SEM rateio → 422 NF_SEM_RATEIO_CONTABIL.
    const nfSR = await novaNf(baseNf({ tipo: 'E', nronf: 'E9002', cfop: '1102', codparceiro: 22, idsituacao_nf: 6, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '1102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfSR}/processar`, { method: 'POST', headers: H });
    const srRes = await fetch(`${base}/fiscal/nf/${nfSR}/contabilizar`, { method: 'POST', headers: H });
    check('F5b: contabilizar sem rateio → 422 NF_SEM_RATEIO_CONTABIL', srRes.status === 422 && ((await srRes.json().catch(() => ({}))) as any).code === 'NF_SEM_RATEIO_CONTABIL', { status: srRes.status });
    // 29b) F5b-fase2: conta AUTOMÁTICA TIPO='A' (situação 900: débito=PLC[1]→148, crédito=parceiro[22]→11141).
    const nfA = await novaNf(baseNf({ tipo: 'E', nronf: 'E9003', cfop: '1102', codparceiro: 22, idsituacao_nf: 6, itens: [{ codproduto: 1, quantidade: 2, vrvenda: 10, cfop: '1102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfA}/processar`, { method: 'POST', headers: H });
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,900,1,20)`, [nfA]);
    const conA = await fetch(`${base}/fiscal/nf/${nfA}/contabilizar`, { method: 'POST', headers: H });
    const linA = await diarioDe(nfA);
    check('F5b-2: conta AUTOMÁTICA (débito=PLC→148, crédito=parceiro→11141, valor 20)', conA.status === 200 && linA.length === 1 && Number(linA[0].contadebito) === 148 && Number(linA[0].contacredito) === 11141 && Number(linA[0].valor) === 20, { status: conA.status, lin: linA });
    // 29c) F5b-fase4b: PIS/COFINS FIEL — base POR-ITEM (VRCUSTO×QTD, NÃO totalnf) × rate POR-PRODUTO
    // (PISCOFINS idpc13=1,65/7,6). Saída-específica CFOP 5202 → situação PIS 826/COFINS 827 (D235/C154, D236/C153).
    await pgCon.query(`UPDATE produtos SET idpiscofins=13 WHERE idproduto=1`);
    const nfPC = await novaNf(baseNf({ tipo: 'S', nronf: 'E9004', cfop: '5202', codparceiro: 20, modelo: 55, statusnfe: 'P', idsituacao_nf: 8, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 200, vrcusto: 100, cfop: '5202', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfPC}/processar`, { method: 'POST', headers: H });
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,8,1,200)`, [nfPC]);
    const conPC = await fetch(`${base}/fiscal/nf/${nfPC}/contabilizar`, { method: 'POST', headers: H });
    const linPC = await diarioDe(nfPC);
    const pisLine = (linPC as any[]).find((l) => Number(l.contadebito) === 235 && Number(l.contacredito) === 154);
    const cofinsLine = (linPC as any[]).find((l) => Number(l.contadebito) === 236 && Number(l.contacredito) === 153);
    // base = VRCUSTO×QTD = 100 (NÃO totalnf=200): PIS 100×1,65%=1,65; COFINS 100×7,6%=7,60 — prova a fórmula por-item.
    check('F5b-4b: PIS/COFINS FIEL por-item (base=custo 100 ≠ totalnf 200 → PIS 1,65 / COFINS 7,60, sit 826/827)', conPC.status === 200 && Number(pisLine?.valor) === 1.65 && Number(cofinsLine?.valor) === 7.6, { status: conPC.status, pis: pisLine?.valor, cofins: cofinsLine?.valor });
    await pgCon.query(`UPDATE produtos SET idpiscofins=NULL WHERE idproduto=1`);
    // 29g) F5b-fase4b: CMV — vl_custo CONGELADO de multi_preco no lançamento (snapshot não acompanha o MP).
    await pgCon.query(`INSERT INTO multi_preco (idproduto, idempresa, vrcusto) VALUES (1,1,5.57) ON CONFLICT (idproduto, idempresa) DO UPDATE SET vrcusto=5.57`);
    const nfCmv = await novaNf(baseNf({ tipo: 'S', nronf: 'E9008', cfop: '5102', codparceiro: 20, modelo: 55, statusnfe: 'P', idsituacao_nf: 8, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    const vlFrozen = (await pgCon.query(`SELECT vl_custo FROM nf_prod WHERE codnf=$1`, [nfCmv])).rows[0]?.vl_custo;
    await pgCon.query(`UPDATE multi_preco SET vrcusto=9.99 WHERE idproduto=1 AND idempresa=1`); // altera DEPOIS do lançamento
    await fetch(`${base}/fiscal/nf/${nfCmv}/processar`, { method: 'POST', headers: H });
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,8,1,10)`, [nfCmv]);
    const conCmv = await fetch(`${base}/fiscal/nf/${nfCmv}/contabilizar`, { method: 'POST', headers: H });
    const cmvLine = (await diarioDe(nfCmv) as any[]).find((l) => Number(l.contadebito) === 134 && Number(l.contacredito) === 147);
    check('F5b-4b: CMV = vl_custo congelado 5,57 (D134/C147); snapshot NÃO acompanha multi_preco (→9,99)', conCmv.status === 200 && Number(vlFrozen) === 5.57 && Number(cmvLine?.valor) === 5.57, { frozen: vlFrozen, cmv: cmvLine?.valor });
    // 29h) F5b-4b: arredondamento POR (situação, CFOP) — 2 CFOPs (1102+1403) → mesma sit 788; cada parcela
    // 50×1,65%=0,825→0,83; soma 1,66 (o bug de agrupar só por situação daria round(1,65)=1,65). Prova o fix do auditor.
    await pgCon.query(`UPDATE produtos SET idpiscofins=13 WHERE idproduto=1`);
    await pgCon.query(`UPDATE cfop SET situacao_pis_entradas_nf=788, situacao_cofins_entradas_nf=789 WHERE codcfop='1102'`);
    const nfMc = await novaNf(baseNf({ tipo: 'E', nronf: 'E9009', cfop: '1102', codparceiro: 22, idsituacao_nf: 6, itens: [
      { codproduto: 1, quantidade: 1, vrvenda: 10, vrcusto: 50, cfop: '1102', aliquota: 'T01' },
      { codproduto: 1, quantidade: 1, vrvenda: 10, vrcusto: 50, cfop: '1403', aliquota: 'T01' },
    ] }));
    await fetch(`${base}/fiscal/nf/${nfMc}/processar`, { method: 'POST', headers: H });
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,6,1,100)`, [nfMc]);
    const conMc = await fetch(`${base}/fiscal/nf/${nfMc}/contabilizar`, { method: 'POST', headers: H });
    const pisMc = (await diarioDe(nfMc) as any[]).find((l) => Number(l.contadebito) === 235 && Number(l.contacredito) === 154);
    check('F5b-4b: PIS multi-CFOP arredonda por CFOP (0,83+0,83=1,66; não round(1,65))', conMc.status === 200 && Number(pisMc?.valor) === 1.66, { pis: pisMc?.valor });
    await pgCon.query(`UPDATE produtos SET idpiscofins=NULL WHERE idproduto=1`);
    await pgCon.query(`UPDATE cfop SET situacao_pis_entradas_nf=NULL, situacao_cofins_entradas_nf=NULL WHERE codcfop='1102'`);
    // 29d) F5b-fase3: AUTO-DISPARO — processar uma ENTRADA (AUTOMATICA) COM rateio contabiliza sozinho;
    // reverter (AUTOMATICA) estorna o contábil e reverte o estoque.
    const nfAuto = await novaNf(baseNf({ tipo: 'E', nronf: 'E9005', cfop: '1102', codparceiro: 22, idsituacao_nf: 6, itens: [{ codproduto: 1, quantidade: 3, vrvenda: 10, cfop: '1102', aliquota: 'T01' }] }));
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,6,1,30)`, [nfAuto]); // rateio ANTES do processar
    await fetch(`${base}/fiscal/nf/${nfAuto}/processar`, { method: 'POST', headers: H }); // auto-contabiliza
    const autoF = (await pgCon.query(`SELECT contabilizado FROM nf WHERE codnf=$1`, [nfAuto])).rows[0]?.contabilizado;
    const autoLin = await diarioDe(nfAuto);
    check('F5b-3: auto-disparo — processar (AUTOMATICA+rateio) contabiliza sozinho (D148/C11141)', autoF === 'S' && autoLin.length === 1 && Number(autoLin[0].contadebito) === 148, { flag: autoF, n: autoLin.length });
    const revAuto = await fetch(`${base}/fiscal/nf/${nfAuto}/reverter`, { method: 'POST', headers: H });
    const autoF2 = (await pgCon.query(`SELECT contabilizado, proc FROM nf WHERE codnf=$1`, [nfAuto])).rows[0];
    check('F5b-3: reverter (AUTOMATICA) estorna o contábil e reverte (contabilizado null, proc N, diario vazio)', revAuto.status === 200 && autoF2?.contabilizado == null && autoF2?.proc === 'N' && (await diarioDe(nfAuto)).length === 0, { status: revAuto.status, flag: autoF2?.contabilizado, proc: autoF2?.proc });
    // 29e) F5b-fase3: linha de ICMS (golden saída: valor = nf.totalicm; cfop 5102 → sit791 D127/C232).
    const nfIcms = await novaNf(baseNf({ tipo: 'S', nronf: 'E9006', cfop: '5102', codparceiro: 20, modelo: 55, statusnfe: 'P', idsituacao_nf: 8, itens: [{ codproduto: 1, quantidade: 5, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfIcms}/processar`, { method: 'POST', headers: H }); // auto-contab barrado (sem rateio ainda)
    // ICMS do razão = Σ VRICM dos itens tributados ('T'), NÃO o header. Seta o VRICM do item T01.
    await pgCon.query(`UPDATE nf_prod SET vricm=52.25 WHERE codnf=$1`, [nfIcms]);
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,8,1,100)`, [nfIcms]);
    const conIcms = await fetch(`${base}/fiscal/nf/${nfIcms}/contabilizar`, { method: 'POST', headers: H });
    const linIcms = await diarioDe(nfIcms);
    const icmsLine = (linIcms as any[]).find((l) => Number(l.contadebito) === 127 && Number(l.contacredito) === 232);
    check('F5b-3: linha de ICMS (valor = Σ VRICM dos itens tributados 52,25, sit791 D127/C232)', conIcms.status === 200 && Number(icmsLine?.valor) === 52.25, { status: conIcms.status, icms: icmsLine?.valor, n: linIcms.length });
    // 29f) F5b-fase4: PERÍODO CONTÁBIL FECHADO (competência 01/2024, BLOQ_NF='S') barra a contabilização.
    const nfPer = await novaNf(baseNf({ tipo: 'E', nronf: 'E9007', cfop: '1102', codparceiro: 22, idsituacao_nf: 6, dtemissao: '2024-01-10', dtcontabil: '2024-01-15', itens: [{ codproduto: 1, quantidade: 2, vrvenda: 10, cfop: '1102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfPer}/processar`, { method: 'POST', headers: H });
    await pgCon.query(`INSERT INTO nf_contabil (codnf, idsituacao_nf, codcc, valor) VALUES ($1,6,1,20)`, [nfPer]);
    const perRes = await fetch(`${base}/fiscal/nf/${nfPer}/contabilizar`, { method: 'POST', headers: H });
    check('F5b-4: período contábil FECHADO → 422 PERIODO_FECHADO', perRes.status === 422 && ((await perRes.json().catch(() => ({}))) as any).code === 'PERIODO_FECHADO', { status: perRes.status });
    // guarda: empresa não-AUTOMATICA → 422 INTEGRACAO_NAO_AUTOMATICA.
    await pgCon.query(`UPDATE empresas SET integracao=NULL WHERE idempresa=1`);
    const naRes = await fetch(`${base}/fiscal/nf/${nfSR}/contabilizar`, { method: 'POST', headers: H });
    check('F5b: empresa não-AUTOMATICA → 422 INTEGRACAO_NAO_AUTOMATICA', naRes.status === 422 && ((await naRes.json().catch(() => ({}))) as any).code === 'INTEGRACAO_NAO_AUTOMATICA', { status: naRes.status });
    await pgCon.query(`UPDATE empresas SET integracao='AUTOMATICA' WHERE idempresa=1`);
    await pgCon.end();

    // 30) A2 — AUTO-NUMERAÇÃO de NRONF na emissão própria (SetaNroNF). Série '99' isolada (max=0 → 1,2).
    const pgNum = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const rdNronf = async (id: number) => (await pgNum.query(`SELECT nronf FROM nf WHERE codnf=$1`, [id])).rows[0]?.nronf;
    const nfN1 = await novaNf(baseNf({ tipo: 'S', modelo: 55, serie: '99', tipoemissao: '0', nronf: '', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    const nfN2 = await novaNf(baseNf({ tipo: 'S', modelo: 55, serie: '99', tipoemissao: '0', nronf: '', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    check('A2: auto-numeração emissão própria (série 99 isolada → 1, depois 2)', String(await rdNronf(nfN1)) === '1' && String(await rdNronf(nfN2)) === '2', { n1: await rdNronf(nfN1), n2: await rdNronf(nfN2) });
    // terceiros (tipoemissao '1', modelo 1) mantém o número digitado.
    const nfT = await novaNf(baseNf({ tipo: 'E', modelo: 1, serie: '99', tipoemissao: '1', nronf: '777777', codparceiro: 22, itens: [{ codproduto: 1, quantidade: 1, vrvenda: 10, cfop: '1102', aliquota: 'T01' }] }));
    check('A2: terceiros (tipoemissao 1) mantém o número digitado (777777)', String(await rdNronf(nfT)) === '777777', { n: await rdNronf(nfT) });
    await pgNum.end();

    // 31) CONTAS A RECEBER — corte-1 (cadastro/gestão). CRUD + travas de estado (quitada/agrupado/de-NF).
    const AR = 'cadastro/areceber';
    // 31.1) listagem (escopo empresa) traz os títulos seed; filtro situacao=abertos exclui quitado/agrupado.
    const arLista = (await (await fetch(`${base}/${AR}`, { headers: H })).json()) as any[];
    check('CR: GET lista títulos do escopo (≥8 seed)', Array.isArray(arLista) && arLista.length >= 8, { n: arLista?.length });
    const arAbertos = (await (await fetch(`${base}/${AR}?situacao=abertos`, { headers: H })).json()) as any[];
    const temQuitadoOuAgrupado = arAbertos.some((t) => t.codrcb === 999 || t.codrcb === 400);
    check('CR: situacao=abertos exclui quitado(999)/agrupado(400)', !temQuitadoOuAgrupado, { ids: arAbertos.map((t) => t.codrcb) });
    // a view calcula juro/total (título 300 vencido) — total ≥ valor.
    const t300 = (await (await fetch(`${base}/${AR}/300`, { headers: H })).json()) as any;
    check('CR: GET :id traz juro/total calculados (view)', t300 && Number(t300.total) >= Number(t300.valor), { valor: t300?.valor, total: t300?.total });

    // 31.2) criar título MANUAL → 201, quitada=N, cadastrado_manualmente=S.
    const arNovo = await fetch(`${base}/${AR}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2026-08-01', valor: 350.5, duplicata: 'CR-NOVA', tipodoc: 'DUPLICATA' }),
    });
    const arNovoBody = (await arNovo.json().catch(() => ({}))) as any;
    check('CR: POST cria título manual (201, quitada=N, manual=S)', arNovo.status === 201 && arNovoBody.quitada === 'N' && arNovoBody.cadastrado_manualmente === 'S' && Number(arNovoBody.valor) === 350.5, { status: arNovo.status, body: arNovoBody });
    const novoId = Number(arNovoBody.codrcb);

    // 31.3) validações: valor ≤ 0 → 400; venc < venda → 400.
    const arVal0 = await fetch(`${base}/${AR}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2026-08-01', valor: 0 }) });
    check('CR: POST valor 0 → 400 VALIDACAO', arVal0.status === 400 && ((await arVal0.json().catch(() => ({}))) as any).code === 'VALIDACAO', { status: arVal0.status });
    const arData = await fetch(`${base}/${AR}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-08-01', dtvenc: '2026-07-01', valor: 10 }) });
    check('CR: POST venc < venda → 400 VALIDACAO', arData.status === 400 && ((await arData.json().catch(() => ({}))) as any).code === 'VALIDACAO', { status: arData.status });

    // 31.4) editar o título manual → 200, valor atualizado.
    const arEdit = await fetch(`${base}/${AR}/${novoId}`, { method: 'PUT', headers: H, body: JSON.stringify({ valor: 400 }) });
    const arEditBody = (await arEdit.json().catch(() => ({}))) as any;
    check('CR: PUT edita título manual (valor 400)', arEdit.status === 200 && Number(arEditBody.valor) === 400, { status: arEdit.status, valor: arEditBody?.valor });

    // 31.5) TRAVAS de estado (editar): cada estado do legado → 422 com seu código PT.
    const putTrava = async (id: number) => {
      const r = await fetch(`${base}/${AR}/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ valor: 1 }) });
      return { status: r.status, code: ((await r.json().catch(() => ({}))) as any).code };
    };
    const tQ = await putTrava(999);
    check('CR: PUT título quitado → 422 TITULO_JA_BAIXADO', tQ.status === 422 && tQ.code === 'TITULO_JA_BAIXADO', tQ);
    const tA = await putTrava(400);
    check('CR: PUT título agrupado → 422 TITULO_AGRUPADO', tA.status === 422 && tA.code === 'TITULO_AGRUPADO', tA);
    const tN = await putTrava(300);
    check('CR: PUT título de NF → 422 TITULO_DE_NF', tN.status === 422 && tN.code === 'TITULO_DE_NF', tN);
    const tC = await putTrava(201);
    check('CR: PUT título contabilizado → 422 TITULO_CONTABILIZADO', tC.status === 422 && tC.code === 'TITULO_CONTABILIZADO', tC);
    const tO = await putTrava(102);
    check('CR: PUT título origem-auto (Q) → 422 TITULO_ORIGEM_AUTO', tO.status === 422 && tO.code === 'TITULO_ORIGEM_AUTO', tO);
    const tK = await putTrava(500);
    check('CR: PUT título conciliado não-manual → 422 TITULO_CONCILIADO', tK.status === 422 && tK.code === 'TITULO_CONCILIADO', tK);

    // 31.6) excluir: manual → 204; quitado(999) → 422 (mesma trava simétrica).
    const arDel = await fetch(`${base}/${AR}/${novoId}`, { method: 'DELETE', headers: H });
    check('CR: DELETE título manual → 204', arDel.status === 204, { status: arDel.status });
    const arDelQ = await fetch(`${base}/${AR}/999`, { method: 'DELETE', headers: H });
    check('CR: DELETE título quitado → 422 TITULO_JA_BAIXADO', arDelQ.status === 422 && ((await arDelQ.json().catch(() => ({}))) as any).code === 'TITULO_JA_BAIXADO', { status: arDelQ.status });

    // 31.7) RBAC: operador sem grant não cria.
    const arRbac = await fetch(`${base}/${AR}`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2026-08-01', valor: 10 }) });
    check('CR: POST sem grant RBAC → 403', arRbac.status === 403, { status: arRbac.status });

    // 31.8) IDOR multi-tenant: empresa 2 NÃO enxerga/edita título da empresa 1 (999).
    const H_EMP2 = { ...H, 'x-empresa-id': '2' };
    const idorRead = await (await fetch(`${base}/${AR}/999`, { headers: H_EMP2 })).json().catch(() => null);
    check('CR: GET :id cross-tenant não vaza (empresa 2 não lê título da empresa 1)', idorRead == null || Object.keys(idorRead).length === 0, { idorRead });
    const idorPut = await fetch(`${base}/${AR}/999`, { method: 'PUT', headers: H_EMP2, body: JSON.stringify({ valor: 1 }) });
    check('CR: PUT cross-tenant → 422 TITULO_NAO_ENCONTRADO (não edita título de outra empresa)', idorPut.status === 422 && ((await idorPut.json().catch(() => ({}))) as any).code === 'TITULO_NAO_ENCONTRADO', { status: idorPut.status });

    // 32) CONTAS A RECEBER — corte-2 (BAIXA/recebimento): areceber_bx (INDR estorno lógico) + guardas.
    const pgBx = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const bxDe = async (id: number) => (await pgBx.query(`SELECT indr, valorpg FROM areceber_bx WHERE codrcb=$1 ORDER BY codrcbbx`, [id])).rows as any[];
    const quitOf = async (id: number) => (await pgBx.query(`SELECT quitada FROM areceber WHERE codrcb=$1`, [id])).rows[0]?.quitada;
    const crNovo = async (extra: Record<string, unknown> = {}) => {
      const r = await fetch(`${base}/${AR}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 100, ...extra }) });
      return Number(((await r.json()) as any).codrcb);
    };

    // 32.1) baixar QUITA o título: 200, quitada=S, 1 linha areceber_bx INDR='I', valorpg=100 (a vencer → juro 0).
    const bxId = await crNovo();
    const bxRes = await fetch(`${base}/${AR}/${bxId}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ dtpgto: '2026-07-02' }) });
    const q1 = await quitOf(bxId);
    const bxRows = await bxDe(bxId);
    check('CR-baixa: baixar quita (200, quitada=S, areceber_bx INDR=I, valorpg=100)', bxRes.status === 200 && q1 === 'S' && bxRows.length === 1 && bxRows[0].indr === 'I' && Number(bxRows[0].valorpg) === 100, { status: bxRes.status, rows: bxRows });
    // 32.2) baixar 2x → 422 TITULO_JA_BAIXADO.
    const bx2 = await fetch(`${base}/${AR}/${bxId}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CR-baixa: baixar 2x → 422 TITULO_JA_BAIXADO', bx2.status === 422 && ((await bx2.json().catch(() => ({}))) as any).code === 'TITULO_JA_BAIXADO', { status: bx2.status });
    // 32.3) estorno LÓGICO: 200, quitada=N, a MESMA linha vira INDR='E' (não apaga — preserva histórico).
    const est = await fetch(`${base}/${AR}/${bxId}/estornar-baixa`, { method: 'POST', headers: H });
    const q2 = await quitOf(bxId);
    const bxRows2 = await bxDe(bxId);
    check('CR-baixa: estorno lógico (200, quitada=N, linha vira INDR=E, não apaga)', est.status === 200 && q2 === 'N' && bxRows2.length === 1 && bxRows2[0].indr === 'E', { status: est.status, rows: bxRows2 });
    // 32.4) estornar sem baixa ativa → 422 TITULO_NAO_BAIXADO.
    const est2 = await fetch(`${base}/${AR}/${bxId}/estornar-baixa`, { method: 'POST', headers: H });
    check('CR-baixa: estornar sem baixa → 422 TITULO_NAO_BAIXADO', est2.status === 422 && ((await est2.json().catch(() => ({}))) as any).code === 'TITULO_NAO_BAIXADO', { status: est2.status });
    // 32.5) juros/desconto compõem o valor pago: 100 + 10 − 5 = 105.
    const bxId2 = await crNovo();
    const bxJ = await fetch(`${base}/${AR}/${bxId2}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ juros: 10, desconto: 5 }) });
    const bxJBody = (await bxJ.json().catch(() => ({}))) as any;
    check('CR-baixa: juros/desconto compõem valorpg (100+10−5=105)', bxJ.status === 200 && Number(bxJBody.valorpg) === 105, { body: bxJBody });
    // 32.6) guarda: baixar AGRUPADO (400) → 422 TITULO_AGRUPADO.
    const bxAgr = await fetch(`${base}/${AR}/400/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CR-baixa: baixar agrupado → 422 TITULO_AGRUPADO', bxAgr.status === 422 && ((await bxAgr.json().catch(() => ({}))) as any).code === 'TITULO_AGRUPADO', { status: bxAgr.status });
    // 32.7) guarda: baixar título EM LOTE → 422 TITULO_EM_LOTE (não dessincroniza o lote).
    const bxId3 = await crNovo();
    const loteId = (await pgBx.query(`INSERT INTO lote_cobranca (codparceiro, data) VALUES (20, '2026-07-02') RETURNING codlotecob`)).rows[0].codlotecob;
    await pgBx.query(`INSERT INTO itens_lotecob (codlotecob, codrcb) VALUES ($1, $2)`, [loteId, bxId3]);
    const bxLote = await fetch(`${base}/${AR}/${bxId3}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CR-baixa: baixar título em lote → 422 TITULO_EM_LOTE', bxLote.status === 422 && ((await bxLote.json().catch(() => ({}))) as any).code === 'TITULO_EM_LOTE', { status: bxLote.status });
    // 32.8) IDOR: baixar cross-tenant (empresa 2 num título da empresa 1) → 422 TITULO_NAO_ENCONTRADO.
    const bxIdor = await fetch(`${base}/${AR}/${bxId2}/baixar`, { method: 'POST', headers: { ...H, 'x-empresa-id': '2' }, body: JSON.stringify({}) });
    check('CR-baixa: baixar cross-tenant → 422 TITULO_NAO_ENCONTRADO', bxIdor.status === 422 && ((await bxIdor.json().catch(() => ({}))) as any).code === 'TITULO_NAO_ENCONTRADO', { status: bxIdor.status });
    // 32.9) valorpg ≤ 0 barrado (ação de dinheiro): desconto ≥ valor → 422; valorpg 0 explícito → 400.
    const bxId4 = await crNovo();
    const bxNeg = await fetch(`${base}/${AR}/${bxId4}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ desconto: 200 }) });
    check('CR-baixa: valorpg ≤ 0 (desconto ≥ valor) → 422 TITULO_VALOR_INVALIDO', bxNeg.status === 422 && ((await bxNeg.json().catch(() => ({}))) as any).code === 'TITULO_VALOR_INVALIDO', { status: bxNeg.status });
    const bxZero = await fetch(`${base}/${AR}/${bxId4}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ valorpg: 0 }) });
    check('CR-baixa: valorpg 0 explícito → 400 VALIDACAO', bxZero.status === 400 && ((await bxZero.json().catch(() => ({}))) as any).code === 'VALIDACAO', { status: bxZero.status });
    // 32.10) estorno cross-tenant → 422 TITULO_NAO_ENCONTRADO (empresa 2 não estorna baixa da empresa 1).
    const bxId5 = await crNovo();
    await fetch(`${base}/${AR}/${bxId5}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    const estIdor = await fetch(`${base}/${AR}/${bxId5}/estornar-baixa`, { method: 'POST', headers: { ...H, 'x-empresa-id': '2' } });
    check('CR-baixa: estornar cross-tenant → 422 TITULO_NAO_ENCONTRADO', estIdor.status === 422 && ((await estIdor.json().catch(() => ({}))) as any).code === 'TITULO_NAO_ENCONTRADO', { status: estIdor.status });
    await pgBx.end();

    // 33) CONTAS A PAGAR (gêmea) — cadastro/gestão + baixa/pagamento. Espelha §31/§32 (tabela apagar).
    const AP = 'cadastro/apagar';
    const pgAp = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const apBxDe = async (id: number) => (await pgAp.query(`SELECT indr, valorpg FROM apagar_bx WHERE codapg=$1 ORDER BY codapgbx`, [id])).rows as any[];
    const apQuit = async (id: number) => (await pgAp.query(`SELECT quitada FROM apagar WHERE codapg=$1`, [id])).rows[0]?.quitada;
    const crAp = async (extra: Record<string, unknown> = {}) => {
      const r = await fetch(`${base}/${AP}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 100, ...extra }) });
      return Number(((await r.json()) as any).codapg);
    };
    // 33.1) listagem + filtro abertos (exclui pago 7003 / agrupado 7004).
    const apLista = (await (await fetch(`${base}/${AP}`, { headers: H })).json()) as any[];
    const apAb = (await (await fetch(`${base}/${AP}?situacao=abertos`, { headers: H })).json()) as any[];
    check('CP: lista (≥8) + abertos exclui pago(7003)/agrupado(7004)', apLista.length >= 8 && !apAb.some((t) => t.codapg === 7003 || t.codapg === 7004), { n: apLista.length });
    // 33.2) criar manual + validações.
    const apNovo = await fetch(`${base}/${AP}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2026-08-01', valor: 250, duplicata: 'AP-NOVA' }) });
    const apNovoBody = (await apNovo.json().catch(() => ({}))) as any;
    check('CP: POST cria título manual (201, quitada=N, manual=S)', apNovo.status === 201 && apNovoBody.quitada === 'N' && apNovoBody.cadastrado_manualmente === 'S' && Number(apNovoBody.valor) === 250, { status: apNovo.status });
    const apId = Number(apNovoBody.codapg);
    const apVal0 = await fetch(`${base}/${AP}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2026-08-01', valor: 0 }) });
    check('CP: POST valor 0 → 400 VALIDACAO', apVal0.status === 400 && ((await apVal0.json().catch(() => ({}))) as any).code === 'VALIDACAO', { status: apVal0.status });
    // 33.3) editar manual + TRAVAS de estado (7003 pago/7004 agrup/7005 NF/7006 contab/7007 origem/7008 concil).
    const apEdit = await fetch(`${base}/${AP}/${apId}`, { method: 'PUT', headers: H, body: JSON.stringify({ valor: 300 }) });
    check('CP: PUT edita manual (valor 300)', apEdit.status === 200 && Number(((await apEdit.json().catch(() => ({}))) as any).valor) === 300, { status: apEdit.status });
    const putAp = async (id: number) => { const r = await fetch(`${base}/${AP}/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ valor: 1 }) }); return { s: r.status, c: ((await r.json().catch(() => ({}))) as any).code }; };
    const g3 = await putAp(7003), g4 = await putAp(7004), g5 = await putAp(7005), g6 = await putAp(7006), g7 = await putAp(7007), g8 = await putAp(7008);
    check('CP: travas de estado editar (pago/agrup/NF/contab/origem/concil → 422)',
      g3.c === 'TITULO_JA_BAIXADO' && g4.c === 'TITULO_AGRUPADO' && g5.c === 'TITULO_DE_NF' && g6.c === 'TITULO_CONTABILIZADO' && g7.c === 'TITULO_ORIGEM_AUTO' && g8.c === 'TITULO_CONCILIADO',
      { g3, g4, g5, g6, g7, g8 });
    // 33.4) excluir manual → 204; pago(7003) → 422.
    const apDel = await fetch(`${base}/${AP}/${apId}`, { method: 'DELETE', headers: H });
    const apDelP = await fetch(`${base}/${AP}/7003`, { method: 'DELETE', headers: H });
    check('CP: DELETE manual → 204; pago → 422', apDel.status === 204 && apDelP.status === 422, { manual: apDel.status, pago: apDelP.status });
    // 33.5) RBAC sem grant → 403.
    const apRbac = await fetch(`${base}/${AP}`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2026-08-01', valor: 10 }) });
    check('CP: POST sem grant RBAC → 403', apRbac.status === 403, { status: apRbac.status });
    // 33.6) BAIXA: pagar quita (apagar_bx INDR=I, valorpg=100); estorno lógico (INDR=E, não apaga).
    const apBxId = await crAp();
    const apPag = await fetch(`${base}/${AP}/${apBxId}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ dtpgto: '2026-07-02' }) });
    const apQ1 = await apQuit(apBxId); const apRows = await apBxDe(apBxId);
    check('CP-baixa: pagar quita (200, quitada=S, apagar_bx INDR=I, valorpg=100)', apPag.status === 200 && apQ1 === 'S' && apRows.length === 1 && apRows[0].indr === 'I' && Number(apRows[0].valorpg) === 100, { status: apPag.status, rows: apRows });
    const apPag2 = await fetch(`${base}/${AP}/${apBxId}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CP-baixa: pagar 2x → 422 TITULO_JA_BAIXADO', apPag2.status === 422 && ((await apPag2.json().catch(() => ({}))) as any).code === 'TITULO_JA_BAIXADO', { status: apPag2.status });
    const apEst = await fetch(`${base}/${AP}/${apBxId}/estornar-baixa`, { method: 'POST', headers: H });
    const apQ2 = await apQuit(apBxId); const apRows2 = await apBxDe(apBxId);
    check('CP-baixa: estorno lógico (200, quitada=N, INDR=E, não apaga)', apEst.status === 200 && apQ2 === 'N' && apRows2.length === 1 && apRows2[0].indr === 'E', { status: apEst.status, rows: apRows2 });
    // 33.7) juros/desconto compõem valorpg; agrupado→422; valorpg≤0→422; IDOR cross-tenant→422.
    const apBxId2 = await crAp();
    const apJ = await fetch(`${base}/${AP}/${apBxId2}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ juros: 10, desconto: 5 }) });
    check('CP-baixa: juros/desconto compõem valorpg (105)', apJ.status === 200 && Number(((await apJ.json().catch(() => ({}))) as any).valorpg) === 105, {});
    const apAgr = await fetch(`${base}/${AP}/7004/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CP-baixa: pagar agrupado → 422 TITULO_AGRUPADO', apAgr.status === 422 && ((await apAgr.json().catch(() => ({}))) as any).code === 'TITULO_AGRUPADO', { status: apAgr.status });
    const apBxId3 = await crAp();
    const apNeg = await fetch(`${base}/${AP}/${apBxId3}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ desconto: 200 }) });
    check('CP-baixa: valorpg ≤ 0 → 422 TITULO_VALOR_INVALIDO', apNeg.status === 422 && ((await apNeg.json().catch(() => ({}))) as any).code === 'TITULO_VALOR_INVALIDO', { status: apNeg.status });
    const apIdor = await fetch(`${base}/${AP}/${apBxId3}/baixar`, { method: 'POST', headers: { ...H, 'x-empresa-id': '2' }, body: JSON.stringify({}) });
    check('CP-baixa: pagar cross-tenant → 422 TITULO_NAO_ENCONTRADO', apIdor.status === 422 && ((await apIdor.json().catch(() => ({}))) as any).code === 'TITULO_NAO_ENCONTRADO', { status: apIdor.status });
    // 33.8) estorno cross-tenant → 422 TITULO_NAO_ENCONTRADO (empresa 2 não estorna pagamento da empresa 1).
    const apBxId4 = await crAp();
    await fetch(`${base}/${AP}/${apBxId4}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    const apEstIdor = await fetch(`${base}/${AP}/${apBxId4}/estornar-baixa`, { method: 'POST', headers: { ...H, 'x-empresa-id': '2' } });
    check('CP-baixa: estornar cross-tenant → 422 TITULO_NAO_ENCONTRADO', apEstIdor.status === 422 && ((await apEstIdor.json().catch(() => ({}))) as any).code === 'TITULO_NAO_ENCONTRADO', { status: apEstIdor.status });
    // 33.9) excluir por-estado: agrupado(7004)→422 AGRUPADO; de-NF(7005)→422 DE_NF (trava simétrica ao editar).
    const apDelAgr = await fetch(`${base}/${AP}/7004`, { method: 'DELETE', headers: H });
    const apDelNf = await fetch(`${base}/${AP}/7005`, { method: 'DELETE', headers: H });
    check('CP: DELETE por-estado (agrupado→422 AGRUPADO, de-NF→422 DE_NF)',
      apDelAgr.status === 422 && ((await apDelAgr.json().catch(() => ({}))) as any).code === 'TITULO_AGRUPADO'
      && apDelNf.status === 422 && ((await apDelNf.json().catch(() => ({}))) as any).code === 'TITULO_DE_NF',
      { agr: apDelAgr.status, nf: apDelNf.status });
    await pgAp.end();

    // 34) PLANO DE CONTAS (contábil) — cadastro em árvore + validações + travas de exclusão.
    const PC = 'cadastro/plano-contas';
    const pgPc = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // 34.1) árvore seedada: lista traz o esqueleto (≥30) + a conta 148 tem máscara/classe/natureza/pai.
    const pcLista = (await (await fetch(`${base}/${PC}`, { headers: H })).json()) as any[];
    const c148 = (await (await fetch(`${base}/${PC}/148`, { headers: H })).json()) as any;
    check('PC: lista árvore (≥30) + 148 tem máscara/classe A/natureza/pai',
      pcLista.length >= 30 && c148.codiexpandido === '1.1.03.01.0002' && c148.classe === 'A' && Number(c148.natureza) === 1 && Number(c148.codpai) === 9008,
      { n: pcLista.length, c148 });
    // 34.2) criar analítica sob a sintética 9008 (1.1.03.01) → 201, nível 5 derivado.
    const pcNova = await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '1.1.03.01.9001', descricao: 'CONTA TESTE', classe: 'A', natureza: 1, codpai: 9008 }) });
    const pcNovaBody = (await pcNova.json().catch(() => ({}))) as any;
    check('PC: POST cria analítica (201, nível 5 derivado do código)', pcNova.status === 201 && Number(pcNovaBody.nivel) === 5 && pcNovaBody.classe === 'A', { status: pcNova.status, body: pcNovaBody });
    const pcId = Number(pcNovaBody.codplanocontas);
    // 34.3) validações: pai analítica → 422; prefixo incompatível → 422; código duplicado → 422; sem natureza → 400.
    const pcPaiA = await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '1.1.03.01.0002.1', descricao: 'X', classe: 'A', natureza: 1, codpai: 148 }) });
    check('PC: filha de conta ANALÍTICA → 422 CONTA_PAI_ANALITICA', pcPaiA.status === 422 && ((await pcPaiA.json().catch(() => ({}))) as any).code === 'CONTA_PAI_ANALITICA', { status: pcPaiA.status });
    const pcPref = await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '2.1.01.01.9002', descricao: 'X', classe: 'A', natureza: 2, codpai: 9008 }) });
    check('PC: prefixo incompatível com o pai → 422 CONTA_PREFIXO_INVALIDO', pcPref.status === 422 && ((await pcPref.json().catch(() => ({}))) as any).code === 'CONTA_PREFIXO_INVALIDO', { status: pcPref.status });
    const pcDup = await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '1.1.03.01.0002', descricao: 'X', classe: 'A', natureza: 1, codpai: 9008 }) });
    check('PC: código duplicado → 422 CONTA_CODIGO_DUPLICADO', pcDup.status === 422 && ((await pcDup.json().catch(() => ({}))) as any).code === 'CONTA_CODIGO_DUPLICADO', { status: pcDup.status });
    const pcSemNat = await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '1.1.03.01.9003', descricao: 'X', classe: 'A', codpai: 9008 }) });
    check('PC: sem natureza → 400 VALIDACAO', pcSemNat.status === 400 && ((await pcSemNat.json().catch(() => ({}))) as any).code === 'VALIDACAO', { status: pcSemNat.status });
    // 34.4) editar descrição → 200.
    const pcEdit = await fetch(`${base}/${PC}/${pcId}`, { method: 'PUT', headers: H, body: JSON.stringify({ descricao: 'CONTA TESTE EDIT' }) });
    check('PC: PUT edita descrição (200)', pcEdit.status === 200 && ((await pcEdit.json().catch(() => ({}))) as any).descricao === 'CONTA TESTE EDIT', { status: pcEdit.status });
    // 34.4b) CICLO: setar codpai de 9007 (1.1.03) para 9008 (1.1.03.01, seu descendente) → 422 CONTA_PAI_INVALIDO.
    const pcCiclo = await fetch(`${base}/${PC}/9007`, { method: 'PUT', headers: H, body: JSON.stringify({ codpai: 9008 }) });
    check('PC: reparent p/ descendente (ciclo) → 422 CONTA_PAI_INVALIDO', pcCiclo.status === 422 && ((await pcCiclo.json().catch(() => ({}))) as any).code === 'CONTA_PAI_INVALIDO', { status: pcCiclo.status });
    // 34.4c) código reduzido duplicado (reduzido '148' já existe) → 422 CONTA_REDUZIDO_DUPLICADO.
    const pcRed = await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '1.1.03.01.9020', descricao: 'X', classe: 'A', natureza: 1, codpai: 9008, codireduzido: '148' }) });
    check('PC: código reduzido duplicado → 422 CONTA_REDUZIDO_DUPLICADO', pcRed.status === 422 && ((await pcRed.json().catch(() => ({}))) as any).code === 'CONTA_REDUZIDO_DUPLICADO', { status: pcRed.status });
    // 34.5) TRAVAS de exclusão: com filhos (9008) → 422; com movimento no DIÁRIO → 422; em uso (parceiro) → 422.
    const pcFilhos = await fetch(`${base}/${PC}/9008`, { method: 'DELETE', headers: H });
    check('PC: DELETE conta com filhos → 422 CONTA_COM_FILHOS', pcFilhos.status === 422 && ((await pcFilhos.json().catch(() => ({}))) as any).code === 'CONTA_COM_FILHOS', { status: pcFilhos.status });
    // movimento: cria conta + lança 1 linha no diário apontando p/ ela.
    const pcMovId = Number(((await (await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '1.1.03.01.9010', descricao: 'MOV', classe: 'A', natureza: 1, codpai: 9008 }) })).json()) as any).codplanocontas);
    await pgPc.query(`INSERT INTO diario (datalan, contadebito, contacredito, valor, codorigem, idorigem, codempresa) VALUES ('2026-07-02',$1,11141,1,99,1,1)`, [pcMovId]);
    const pcMov = await fetch(`${base}/${PC}/${pcMovId}`, { method: 'DELETE', headers: H });
    check('PC: DELETE conta com movimento no DIÁRIO → 422 CONTA_COM_MOVIMENTO', pcMov.status === 422 && ((await pcMov.json().catch(() => ({}))) as any).code === 'CONTA_COM_MOVIMENTO', { status: pcMov.status });
    // em uso: cria conta + vincula a um parceiro.
    const pcUsoId = Number(((await (await fetch(`${base}/${PC}`, { method: 'POST', headers: H, body: JSON.stringify({ codiexpandido: '1.1.03.01.9011', descricao: 'USO', classe: 'A', natureza: 1, codpai: 9008 }) })).json()) as any).codplanocontas);
    await pgPc.query(`UPDATE parceiros SET codcontabil=$1 WHERE codparceiro=20`, [pcUsoId]);
    const pcUso = await fetch(`${base}/${PC}/${pcUsoId}`, { method: 'DELETE', headers: H });
    check('PC: DELETE conta em uso (parceiro) → 422 CONTA_EM_USO', pcUso.status === 422 && ((await pcUso.json().catch(() => ({}))) as any).code === 'CONTA_EM_USO', { status: pcUso.status });
    await pgPc.query(`UPDATE parceiros SET codcontabil=NULL WHERE codparceiro=20`);
    // 34.6) inativar + exclusão limpa: a conta teste (sem refs) inativa (status I) e depois exclui (204).
    const pcInat = await fetch(`${base}/${PC}/${pcId}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'I' }) });
    check('PC: inativar (status=I) → 200', pcInat.status === 200 && ((await pcInat.json().catch(() => ({}))) as any).status === 'I', { status: pcInat.status });
    const pcDel = await fetch(`${base}/${PC}/${pcId}`, { method: 'DELETE', headers: H });
    check('PC: DELETE conta limpa → 204', pcDel.status === 204, { status: pcDel.status });
    // 34.7) RBAC sem grant → 403.
    const pcRbac = await fetch(`${base}/${PC}`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ codiexpandido: '1.1.03.01.9099', descricao: 'X', classe: 'A', natureza: 1, codpai: 9008 }) });
    check('PC: POST sem grant RBAC → 403', pcRbac.status === 403, { status: pcRbac.status });
    await pgPc.end();

    // 35) DRE CONTÁBIL (relatório) — motor P/F/E sobre o DIÁRIO. Semeia lançamentos determinísticos.
    const pgDre = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // período 2030 ISOLADO (o §29 contabiliza NFs em 2026 → evita poluir 124/127/134):
    // crédito 124 = receita +1000; débito 127 = dedução −100; débito 134 = CMV −600.
    await pgDre.query(`INSERT INTO diario (datalan, contadebito, contacredito, valor, codorigem, idorigem, codempresa) VALUES
      ('2030-03-15', 11141, 124, 1000, 99, 1, 1),
      ('2030-03-15', 127, 11141, 100, 99, 1, 1),
      ('2030-03-15', 134, 147, 600, 99, 1, 1),
      ('2030-03-15', 232, 11141, 200, 99, 1, 1),
      ('2029-01-01', 11141, 124, 9999, 99, 1, 1)`); // 2029 → fora do período consultado
    const dreRes = await fetch(`${base}/cadastro/dre?dataInicio=2030-01-01&dataFim=2030-12-31`, { headers: H });
    const dre = (await dreRes.json().catch(() => ({}))) as any;
    const linha = (cod: string) => (dre.linhas ?? []).find((l: any) => l.codexpandido === cod);
    check('DRE: P — Receita Bruta (crédito 124) = 1000', Number(linha('01.001')?.valor) === 1000, { l: linha('01.001') });
    check('DRE: P — (-) Deduções (débito 127) = -100', Number(linha('01.002')?.valor) === -100, { l: linha('01.002') });
    check('DRE: F — Receita Líquida (roll-up 01.001+01.002) = 900', Number(linha('01')?.valor) === 900, { l: linha('01') });
    check('DRE: P — CMV (débito 134) = -600', Number(linha('03.001')?.valor) === -600, { l: linha('03.001') });
    // ramo de 3 NÍVEIS: aluguel (P, débito 232 = -200) → 04.001 (F) = -200 → 04 (F) = -200 (F-filha-de-F).
    check('DRE: P — Aluguéis nível 3 (débito 232) = -200', Number(linha('04.001.001')?.valor) === -200, { l: linha('04.001.001') });
    check('DRE: F — Despesas Adm. nível 2 (roll-up) = -200', Number(linha('04.001')?.valor) === -200, { l: linha('04.001') });
    check('DRE: F — Despesas Op. nível 1 (roll-up recursivo de F-filha-de-F) = -200', Number(linha('04')?.valor) === -200, { l: linha('04') });
    check('DRE: E — Lucro Bruto (<01>+<03>+<04> = 900-600-200) = 100', Number(linha('08')?.valor) === 100, { l: linha('08') });
    // filtro de período: consulta 2029 vê o lançamento de 9999 (fora de 2030) → receita 9999.
    const dre29 = (await (await fetch(`${base}/cadastro/dre?dataInicio=2029-01-01&dataFim=2029-12-31`, { headers: H })).json()) as any;
    const l29 = (dre29.linhas ?? []).find((l: any) => l.codexpandido === '01.001');
    check('DRE: filtro por DATALAN isola o período (2029 → receita 9999)', Number(l29?.valor) === 9999, { l: l29 });
    // período inválido (início > fim) → 422 DRE_PERIODO_INVALIDO.
    const drePer = await fetch(`${base}/cadastro/dre?dataInicio=2030-12-31&dataFim=2030-01-01`, { headers: H });
    check('DRE: início > fim → 422 DRE_PERIODO_INVALIDO', drePer.status === 422 && ((await drePer.json().catch(() => ({}))) as any).code === 'DRE_PERIODO_INVALIDO', { status: drePer.status });
    // RBAC do relatório.
    const dreRbac = await fetch(`${base}/cadastro/dre?dataInicio=2026-01-01&dataFim=2026-12-31`, { headers: H_SEM_ACESSO });
    check('DRE: GET sem grant RBAC → 403', dreRbac.status === 403, { status: dreRbac.status });
    await pgDre.end();

    // 36) CAIXA (sessão + movimento manual) — corte-1. Fluxo: abrir → movimentar → estornar → fechar,
    // com travas (1 aberto/operador, saldo≥0, só o dono fecha) + multi-tenant + RBAC.
    const CX = 'cobranca/caixa';
    // (empresa 2 = H_EMP2, já declarado acima) — teste de isolamento multi-tenant.
    // 36.1) sem caixa aberto → atual = null.
    const cxAtual0 = await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => null);
    check('CAIXA: atual SEM caixa aberto → null', cxAtual0 === null, { cxAtual0 });
    // 36.2) abrir (fundo 100) → 200, status A.
    const cxAbrRes = await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 100 }) });
    const cxAbr = (await cxAbrRes.json().catch(() => ({}))) as any;
    check('CAIXA: abrir → 200 status A saldoInicial 100', cxAbrRes.status === 200 && cxAbr.status === 'A' && Number(cxAbr.saldoInicial) === 100, { status: cxAbrRes.status, cxAbr });
    const codcaixa = Number(cxAbr.codcaixa);
    // 36.3) atual → sessão A, saldo corrente 100.
    const cxAtual1 = (await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => ({}))) as any;
    check('CAIXA: atual COM caixa → status A, saldo corrente 100', cxAtual1?.sessao?.status === 'A' && Number(cxAtual1?.sessao?.saldo_corrente) === 100, { s: cxAtual1?.sessao });
    // 36.4) abrir de novo → 422 CAIXA_JA_ABERTO (1 caixa por operador+empresa).
    const cxDup = await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 50 }) });
    check('CAIXA: abrir 2ª vez → 422 CAIXA_JA_ABERTO', cxDup.status === 422 && ((await cxDup.json().catch(() => ({}))) as any).code === 'CAIXA_JA_ABERTO', { status: cxDup.status });
    // 36.5) suprimento 50 → saldo 150 (entrada).
    const cxSup = await fetch(`${base}/${CX}/movimentar`, { method: 'POST', headers: H, body: JSON.stringify({ especie: 'SUPRIMENTO', valor: 50 }) });
    const cxSupJ = (await cxSup.json().catch(() => ({}))) as any;
    check('CAIXA: suprimento 50 → 200 tipo E saldo 150', cxSup.status === 200 && cxSupJ.tipo === 'E' && Number(cxSupJ.saldoCorrente) === 150, { status: cxSup.status, cxSupJ });
    // 36.6) sangria 30 → saldo 120 (saída).
    const cxSan = await fetch(`${base}/${CX}/movimentar`, { method: 'POST', headers: H, body: JSON.stringify({ especie: 'SANGRIA', valor: 30 }) });
    const cxSanJ = (await cxSan.json().catch(() => ({}))) as any;
    check('CAIXA: sangria 30 → 200 tipo S saldo 120', cxSan.status === 200 && cxSanJ.tipo === 'S' && Number(cxSanJ.saldoCorrente) === 120, { status: cxSan.status, cxSanJ });
    const codmovSangria = Number(cxSanJ.codmov);
    // 36.7) sangria além do saldo → 422 CAIXA_SALDO_INSUFICIENTE.
    const cxIns = await fetch(`${base}/${CX}/movimentar`, { method: 'POST', headers: H, body: JSON.stringify({ especie: 'SANGRIA', valor: 9999 }) });
    check('CAIXA: sangria > saldo → 422 CAIXA_SALDO_INSUFICIENTE', cxIns.status === 422 && ((await cxIns.json().catch(() => ({}))) as any).code === 'CAIXA_SALDO_INSUFICIENTE', { status: cxIns.status });
    // 36.8) valor 0 → 400 (schema positivo).
    const cxZero = await fetch(`${base}/${CX}/movimentar`, { method: 'POST', headers: H, body: JSON.stringify({ especie: 'ENTRADA', valor: 0 }) });
    check('CAIXA: movimento valor 0 → 400 (schema)', cxZero.status === 400, { status: cxZero.status });
    // 36.9) estornar a sangria (indr E) → saldo volta a 150.
    const cxEst = await fetch(`${base}/${CX}/mov/${codmovSangria}/estornar`, { method: 'POST', headers: H });
    check('CAIXA: estornar sangria → 200 indr E', cxEst.status === 200 && ((await cxEst.json().catch(() => ({}))) as any).indr === 'E', { status: cxEst.status });
    const cxAtual2 = (await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => ({}))) as any;
    check('CAIXA: após estorno, saldo corrente = 150', Number(cxAtual2?.sessao?.saldo_corrente) === 150, { s: cxAtual2?.sessao });
    // 36.10) estornar de novo → 422 CAIXA_MOV_ESTORNADO.
    const cxEst2 = await fetch(`${base}/${CX}/mov/${codmovSangria}/estornar`, { method: 'POST', headers: H });
    check('CAIXA: estornar 2ª vez → 422 CAIXA_MOV_ESTORNADO', cxEst2.status === 422 && ((await cxEst2.json().catch(() => ({}))) as any).code === 'CAIXA_MOV_ESTORNADO', { status: cxEst2.status });
    // 36.11) estornar movimento inexistente → 422 CAIXA_MOV_NAO_ENCONTRADO.
    const cxEstX = await fetch(`${base}/${CX}/mov/999999/estornar`, { method: 'POST', headers: H });
    check('CAIXA: estornar movimento inexistente → 422 CAIXA_MOV_NAO_ENCONTRADO', cxEstX.status === 422 && ((await cxEstX.json().catch(() => ({}))) as any).code === 'CAIXA_MOV_NAO_ENCONTRADO', { status: cxEstX.status });
    // 36.12) CAIXA_OUTRO_OPERADOR: semeia caixa aberto do operador 8 (empresa 1) e tenta fechar como op 7.
    const pgCx = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const cx8 = await pgCx.query(`INSERT INTO caixa_sessao (codempresa, codoperador, dtabertura, saldo_inicial, status) VALUES (1, 8, now(), 0, 'A') RETURNING codcaixa`);
    const codcaixa8 = Number(cx8.rows[0].codcaixa);
    const cxOutro = await fetch(`${base}/${CX}/${codcaixa8}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CAIXA: fechar caixa de outro operador → 422 CAIXA_OUTRO_OPERADOR', cxOutro.status === 422 && ((await cxOutro.json().catch(() => ({}))) as any).code === 'CAIXA_OUTRO_OPERADOR', { status: cxOutro.status });
    // 36.13) fechar caixa inexistente → 422 CAIXA_NAO_ENCONTRADO.
    const cxNF = await fetch(`${base}/${CX}/999999/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CAIXA: fechar caixa inexistente → 422 CAIXA_NAO_ENCONTRADO', cxNF.status === 422 && ((await cxNF.json().catch(() => ({}))) as any).code === 'CAIXA_NAO_ENCONTRADO', { status: cxNF.status });
    // 36.14) fechar o caixa do operador → 200, saldo final 150 (= saldo corrente).
    const cxFec = await fetch(`${base}/${CX}/${codcaixa}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ obs: 'fechamento smoke' }) });
    const cxFecJ = (await cxFec.json().catch(() => ({}))) as any;
    check('CAIXA: fechar → 200 status F saldoFinal 150', cxFec.status === 200 && cxFecJ.status === 'F' && Number(cxFecJ.saldoFinal) === 150, { status: cxFec.status, cxFecJ });
    // 36.15) fechar de novo → 422 CAIXA_JA_FECHADO.
    const cxFec2 = await fetch(`${base}/${CX}/${codcaixa}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CAIXA: fechar 2ª vez → 422 CAIXA_JA_FECHADO', cxFec2.status === 422 && ((await cxFec2.json().catch(() => ({}))) as any).code === 'CAIXA_JA_FECHADO', { status: cxFec2.status });
    // 36.16) após fechar: atual = null e movimentar → 422 CAIXA_NAO_ABERTO.
    const cxAtual3 = await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => null);
    check('CAIXA: após fechar, atual → null', cxAtual3 === null, { cxAtual3 });
    const cxMovFechado = await fetch(`${base}/${CX}/movimentar`, { method: 'POST', headers: H, body: JSON.stringify({ especie: 'ENTRADA', valor: 10 }) });
    check('CAIXA: movimentar sem caixa aberto → 422 CAIXA_NAO_ABERTO', cxMovFechado.status === 422 && ((await cxMovFechado.json().catch(() => ({}))) as any).code === 'CAIXA_NAO_ABERTO', { status: cxMovFechado.status });
    // 36.17) multi-tenant: empresa 2 abre caixa independente; empresa 1 (op 7) não vê a de empresa 2.
    const cxEmp2 = await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H_EMP2, body: JSON.stringify({ saldoInicial: 500 }) });
    check('CAIXA: empresa 2 abre caixa independente → 200', cxEmp2.status === 200, { status: cxEmp2.status });
    const cxEmp2Atual = (await (await fetch(`${base}/${CX}/atual`, { headers: H_EMP2 })).json().catch(() => ({}))) as any;
    check('CAIXA: empresa 2 vê seu caixa (saldo 500)', Number(cxEmp2Atual?.sessao?.saldo_corrente) === 500, { s: cxEmp2Atual?.sessao });
    const cxEmp1Atual = await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => null);
    check('CAIXA: empresa 1 NÃO vê o caixa da empresa 2 (isolamento) → null', cxEmp1Atual === null, { cxEmp1Atual });
    // 36.18) RBAC sem grant → 403.
    const cxRbac = await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ saldoInicial: 1 }) });
    check('CAIXA: abrir sem grant RBAC → 403', cxRbac.status === 403, { status: cxRbac.status });
    // 36.19) anti-corrida: 2 aberturas concorrentes (op 7 / empresa 1, sem caixa aberto) → exatamente
    // 1×200 e 1×422 CAIXA_JA_ABERTO. Cobre o caminho do índice parcial único traduzido (nunca 409 DUPLICADO).
    const [rc1, rc2] = await Promise.all([
      fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 10 }) }),
      fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 20 }) }),
    ]);
    const rcSt = [rc1.status, rc2.status].sort((a, b) => a - b);
    const rcBodies = (await Promise.all([rc1.json().catch(() => ({})), rc2.json().catch(() => ({}))])) as any[];
    check(
      'CAIXA: 2 aberturas concorrentes → 1×200 + 1×422 CAIXA_JA_ABERTO (anti-corrida, sem 409)',
      rcSt[0] === 200 && rcSt[1] === 422 && rcBodies.some((b) => b?.code === 'CAIXA_JA_ABERTO'),
      { rcSt, codes: rcBodies.map((b) => b?.code) },
    );
    await pgCx.end();

    // 37) WIRE da baixa A Receber / A Pagar → CAIXA (corte-2). Recurso DINHEIRO lança no caixa aberto.
    const wSaldo = async () => Number(((await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => ({}))) as any)?.sessao?.saldo_corrente);
    const wNovoAR = async (valor: number) =>
      Number(((await (await fetch(`${base}/${AR}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-01-01', dtvenc: '2030-01-01', valor }) })).json()) as any).codrcb);
    const wNovoAP = async (valor: number) =>
      Number(((await (await fetch(`${base}/${AP}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-01-01', dtvenc: '2030-01-01', valor }) })).json()) as any).codapg);
    // 37.0) setup: caixa aberto limpo (fecha o que sobrou do §36.19) com fundo 1000.
    const wPre = await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => null);
    if (wPre?.sessao?.codcaixa) await fetch(`${base}/${CX}/${wPre.sessao.codcaixa}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    const wAbr = (await (await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 1000 }) })).json()) as any;
    const wCaixa = Number(wAbr.codcaixa);
    check('WIRE: setup caixa aberto fundo 1000', (await wSaldo()) === 1000, { wCaixa });
    // 37.1) baixa A Receber (100) recurso DINHEIRO → RECEBIMENTO entrada; saldo 1000→1100.
    const wAr = await wNovoAR(100);
    const wArBx = await fetch(`${base}/${AR}/${wAr}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO' }) });
    check('WIRE: baixa AR dinheiro → 200 e caixa +100 (saldo 1100)', wArBx.status === 200 && (await wSaldo()) === 1100, { status: wArBx.status });
    const wMov = (await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => ({}))) as any;
    check('WIRE: caixa tem movimento RECEBIMENTO ligado ao codrcbbx', (wMov?.movimentos ?? []).some((m: any) => m.especie === 'RECEBIMENTO' && m.tipo === 'E' && Number(m.valor) === 100 && m.codrcbbx != null), { movs: wMov?.movimentos });
    // 37.2) baixa A Pagar (50) recurso DINHEIRO → PAGAMENTO saída; saldo 1100→1050.
    const wAp = await wNovoAP(50);
    const wApBx = await fetch(`${base}/${AP}/${wAp}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO' }) });
    check('WIRE: baixa AP dinheiro → 200 e caixa −50 (saldo 1050)', wApBx.status === 200 && (await wSaldo()) === 1050, { status: wApBx.status });
    // 37.3) A Pagar dinheiro ALÉM do saldo → 422 CAIXA_SALDO_INSUFICIENTE + rollback (título aberto).
    const wApBig = await wNovoAP(9999);
    const wApIns = await fetch(`${base}/${AP}/${wApBig}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO' }) });
    const wApBigRead = (await (await fetch(`${base}/${AP}/${wApBig}`, { headers: H })).json()) as any;
    check('WIRE: AP dinheiro > saldo → 422 CAIXA_SALDO_INSUFICIENTE + título NÃO baixado (rollback)', wApIns.status === 422 && ((await wApIns.json().catch(() => ({}))) as any).code === 'CAIXA_SALDO_INSUFICIENTE' && wApBigRead.quitada !== 'S' && (await wSaldo()) === 1050, { status: wApIns.status });
    // 37.4) estorno da baixa AR → RECEBIMENTO estornado; saldo 1050→950.
    const wArEst = await fetch(`${base}/${AR}/${wAr}/estornar-baixa`, { method: 'POST', headers: H });
    check('WIRE: estorno baixa AR → 200 e caixa −100 (saldo 950)', wArEst.status === 200 && (await wSaldo()) === 950, { status: wArEst.status });
    // 37.5) estorno da baixa AP → PAGAMENTO estornado; saldo 950→1000.
    const wApEst = await fetch(`${base}/${AP}/${wAp}/estornar-baixa`, { method: 'POST', headers: H });
    check('WIRE: estorno baixa AP → 200 e caixa +50 (saldo 1000)', wApEst.status === 200 && (await wSaldo()) === 1000, { status: wApEst.status });
    // 37.6) backward-compat: baixa SEM recurso não toca o caixa (saldo inalterado).
    const wArSem = await wNovoAR(30);
    const wArSemBx = await fetch(`${base}/${AR}/${wArSem}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('WIRE: baixa SEM recurso → 200 e caixa inalterado (saldo 1000)', wArSemBx.status === 200 && (await wSaldo()) === 1000, { status: wArSemBx.status });
    // 37.7) estorno de baixa-dinheiro com CAIXA FECHADO → 422 CAIXA_FECHADO + título segue quitado (rollback).
    const wArFec = await wNovoAR(60);
    await fetch(`${base}/${AR}/${wArFec}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO' }) }); // saldo 1060
    await fetch(`${base}/${CX}/${wCaixa}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) }); // fecha o caixa
    const wArFecEst = await fetch(`${base}/${AR}/${wArFec}/estornar-baixa`, { method: 'POST', headers: H });
    const wArFecRead = (await (await fetch(`${base}/${AR}/${wArFec}`, { headers: H })).json()) as any;
    check('WIRE: estorno baixa-dinheiro em caixa FECHADO → 422 CAIXA_FECHADO + título segue quitado', wArFecEst.status === 422 && ((await wArFecEst.json().catch(() => ({}))) as any).code === 'CAIXA_FECHADO' && wArFecRead.quitada === 'S', { status: wArFecEst.status });
    // 37.8) SEM caixa aberto: baixa dinheiro → 422 CAIXA_NAO_ABERTO + título NÃO baixado.
    const wArNoCx = await wNovoAR(40);
    const wArNoCxBx = await fetch(`${base}/${AR}/${wArNoCx}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO' }) });
    const wArNoCxRead = (await (await fetch(`${base}/${AR}/${wArNoCx}`, { headers: H })).json()) as any;
    check('WIRE: baixa dinheiro sem caixa aberto → 422 CAIXA_NAO_ABERTO + título NÃO baixado', wArNoCxBx.status === 422 && ((await wArNoCxBx.json().catch(() => ({}))) as any).code === 'CAIXA_NAO_ABERTO' && wArNoCxRead.quitada !== 'S', { status: wArNoCxBx.status });
    // 37.9) recurso inválido (schema) → 400.
    const wArBad = await wNovoAR(10);
    const wArBadBx = await fetch(`${base}/${AR}/${wArBad}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'CHEQUE' }) });
    check('WIRE: recurso inválido (CHEQUE, corte-3) → 400 (schema)', wArBadBx.status === 400, { status: wArBadBx.status });
    // 37.10) fidelidade da data: caixa aberto novo + baixa dinheiro com dtpgto retroativo → o
    // caixa_mov usa a DATA DA BAIXA (edtDataBaixa no legado), não now().
    await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 0 }) });
    const wArDt = await wNovoAR(20);
    await fetch(`${base}/${AR}/${wArDt}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO', dtpgto: '2027-05-05' }) });
    const wDtAtual = (await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => ({}))) as any;
    const wDtMov = (wDtAtual?.movimentos ?? []).find((m: any) => Number(m.valor) === 20 && m.especie === 'RECEBIMENTO');
    check('WIRE: caixa_mov usa a data da baixa (dtpgto), não now()', String(wDtMov?.data_operacao ?? '').startsWith('2027-05-05'), { data: wDtMov?.data_operacao });

    // 38) CONFERÊNCIA + QUEBRA/SOBRA no fechamento (corte-2b). diferença = contado − esperado(=saldo).
    const cfFresh = async (fundo: number): Promise<number> => {
      const a = await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => null);
      if (a?.sessao?.codcaixa) await fetch(`${base}/${CX}/${a.sessao.codcaixa}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
      const o = (await (await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: fundo }) })).json()) as any;
      return Number(o.codcaixa);
    };
    // 38.1) fechar SEM contagem = corte-1 (backward-compat): saldoFinal=100, sem conferência.
    const cf1 = await cfFresh(100);
    const cf1Res = (await (await fetch(`${base}/${CX}/${cf1}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) })).json()) as any;
    check('CONF: fechar sem contagem = corte-1 (saldoFinal 100, sem classificação)', Number(cf1Res.saldoFinal) === 100 && cf1Res.classificacao == null && cf1Res.diferenca == null, { cf1Res });
    // 38.2) conferência OK (contado = esperado).
    const cf2 = await cfFresh(100);
    const cf2Res = (await (await fetch(`${base}/${CX}/${cf2}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 100 }) })).json()) as any;
    check('CONF: contado = esperado → OK (diferença 0, sem título)', cf2Res.classificacao === 'OK' && Number(cf2Res.diferenca) === 0 && cf2Res.codrcbQuebra == null, { cf2Res });
    // 38.3) SOBRA (contado > esperado) — sem título.
    const cf3 = await cfFresh(100);
    const cf3Res = (await (await fetch(`${base}/${CX}/${cf3}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 130 }) })).json()) as any;
    check('CONF: contado > esperado → SOBRA +30, sem título financeiro', cf3Res.classificacao === 'SOBRA' && Number(cf3Res.diferenca) === 30 && cf3Res.codrcbQuebra == null, { cf3Res });
    // 38.4) QUEBRA (contado < esperado) → título A Receber contra o parceiro do operador.
    const cf4 = await cfFresh(100);
    const cf4Res = (await (await fetch(`${base}/${CX}/${cf4}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 70 }) })).json()) as any;
    check('CONF: contado < esperado → QUEBRA -30 + título gerado', cf4Res.classificacao === 'QUEBRA' && Number(cf4Res.diferenca) === -30 && Number(cf4Res.codrcbQuebra) > 0, { cf4Res });
    const cf4Tit = (await (await fetch(`${base}/${AR}/${cf4Res.codrcbQuebra}`, { headers: H })).json()) as any;
    check('CONF: título de quebra = ORIGEM Q, valor 30, codparceiro 20 (parceiro do op 7), quitada N, duplicata=codrcb', cf4Tit.origem === 'Q' && Number(cf4Tit.valor) === 30 && Number(cf4Tit.codparceiro) === 20 && cf4Tit.quitada !== 'S' && String(cf4Tit.duplicata) === String(cf4Res.codrcbQuebra), { cf4Tit });
    // 38.5) QUEBRA sem gerar título (gerarTituloQuebra=false) → só registra a diferença.
    const cf5 = await cfFresh(100);
    const cf5Res = (await (await fetch(`${base}/${CX}/${cf5}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 80, gerarTituloQuebra: false }) })).json()) as any;
    check('CONF: QUEBRA sem gerarTituloQuebra → diferença -20 registrada, SEM título', cf5Res.classificacao === 'QUEBRA' && Number(cf5Res.diferenca) === -20 && cf5Res.codrcbQuebra == null, { cf5Res });
    const cf5Read = (await (await fetch(`${base}/${CX}/${cf5}`, { headers: H })).json()) as any;
    check('CONF: sessão fechada guarda valor_contado 80 e diferenca -20', Number(cf5Read.valor_contado) === 80 && Number(cf5Read.diferenca) === -20, { cf5Read });
    // 38.6) OPERADOR_SEM_PARCEIRO: quebra sem parceiro do operador → 422 + rollback (caixa segue aberto).
    const pgCf = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    await pgCf.query(`UPDATE operadores SET codparceiro = NULL WHERE codoperador = 7`);
    const cf6 = await cfFresh(100);
    const cf6Res = await fetch(`${base}/${CX}/${cf6}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 90 }) });
    check('CONF: quebra sem parceiro do operador → 422 OPERADOR_SEM_PARCEIRO', cf6Res.status === 422 && ((await cf6Res.json().catch(() => ({}))) as any).code === 'OPERADOR_SEM_PARCEIRO', { status: cf6Res.status });
    const cf6Read = (await (await fetch(`${base}/${CX}/${cf6}`, { headers: H })).json()) as any;
    check('CONF: fechar abortado → caixa segue ABERTO (rollback)', cf6Read.status === 'A', { status: cf6Read.status });
    await pgCf.query(`UPDATE operadores SET codparceiro = 20 WHERE codoperador = 7`); // restaura
    await fetch(`${base}/${CX}/${cf6}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 90 }) }); // cleanup: fecha agora com parceiro
    await pgCf.end();
    // 38.7) o título de quebra é baixável (operador paga de volta).
    const cf7Bx = await fetch(`${base}/${AR}/${cf4Res.codrcbQuebra}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CONF: título de quebra é baixável (operador paga) → 200', cf7Bx.status === 200, { status: cf7Bx.status });

    // 39) REABERTURA do caixa (corte-2c). F→A, estorna o título de quebra, destrava estorno de baixa.
    const fecharCx = (cod: number, body: Record<string, unknown> = {}) => fetch(`${base}/${CX}/${cod}/fechar`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    // 39.1) reabertura simples (sem quebra): abre → fecha → reabre → status A e vira o caixa atual.
    const rb1 = await cfFresh(100);
    await fecharCx(rb1);
    const rb1Re = await fetch(`${base}/${CX}/${rb1}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    const rb1ReJ = (await rb1Re.json().catch(() => ({}))) as any;
    check('REAB: reabrir caixa fechado → 200 status A', rb1Re.status === 200 && rb1ReJ.status === 'A', { status: rb1Re.status, rb1ReJ });
    const rb1Atual = (await (await fetch(`${base}/${CX}/atual`, { headers: H })).json().catch(() => ({}))) as any;
    check('REAB: caixa reaberto vira o caixa aberto atual', Number(rb1Atual?.sessao?.codcaixa) === rb1 && rb1Atual?.sessao?.status === 'A', { s: rb1Atual?.sessao });
    // 39.2) reabrir caixa ABERTO → 422 CAIXA_NAO_FECHADO.
    const rb2 = await fetch(`${base}/${CX}/${rb1}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('REAB: reabrir caixa aberto → 422 CAIXA_NAO_FECHADO', rb2.status === 422 && ((await rb2.json().catch(() => ({}))) as any).code === 'CAIXA_NAO_FECHADO', { status: rb2.status });
    // 39.3) reabrir inexistente → 422 CAIXA_NAO_ENCONTRADO.
    const rb3 = await fetch(`${base}/${CX}/999999/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('REAB: reabrir caixa inexistente → 422 CAIXA_NAO_ENCONTRADO', rb3.status === 422 && ((await rb3.json().catch(() => ({}))) as any).code === 'CAIXA_NAO_ENCONTRADO', { status: rb3.status });
    // 39.4) CAIXA_JA_ABERTO: fecha rb1, abre outro, tenta reabrir rb1 com outro aberto.
    await fecharCx(rb1);
    const rb4b = Number(((await (await fetch(`${base}/${CX}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 0 }) })).json()) as any).codcaixa);
    const rb4 = await fetch(`${base}/${CX}/${rb1}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('REAB: reabrir com outro caixa já aberto → 422 CAIXA_JA_ABERTO', rb4.status === 422 && ((await rb4.json().catch(() => ({}))) as any).code === 'CAIXA_JA_ABERTO', { status: rb4.status });
    await fecharCx(rb4b); // cleanup
    // 39.5) reabertura ESTORNA (deleta) o título de quebra.
    const rb5 = await cfFresh(100);
    const rb5Fec = (await (await fecharCx(rb5, { valorContado: 70 })).json()) as any; // quebra -30
    const rb5codrcb = Number(rb5Fec.codrcbQuebra);
    check('REAB: fechamento com quebra gerou título', rb5codrcb > 0, { rb5Fec });
    const rb5Re = (await (await fetch(`${base}/${CX}/${rb5}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) })).json()) as any;
    check('REAB: reabrir estorna o título de quebra (quebraEstornada = codrcb)', Number(rb5Re.quebraEstornada) === rb5codrcb, { rb5Re });
    const rb5TitAfter = await (await fetch(`${base}/${AR}/${rb5codrcb}`, { headers: H })).json().catch(() => null);
    check('REAB: título de quebra some após reabrir', rb5TitAfter == null || Object.keys(rb5TitAfter).length === 0, { rb5TitAfter });
    await fecharCx(rb5); // cleanup
    // 39.6) reabertura BLOQUEADA se a quebra já foi baixada → 422 + caixa segue FECHADO.
    const rb6 = await cfFresh(100);
    const rb6Fec = (await (await fecharCx(rb6, { valorContado: 60 })).json()) as any; // quebra -40
    const rb6codrcb = Number(rb6Fec.codrcbQuebra);
    await fetch(`${base}/${AR}/${rb6codrcb}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) }); // baixa o título (quitada S)
    const rb6Re = await fetch(`${base}/${CX}/${rb6}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('REAB: reabrir com quebra baixada → 422 REABERTURA_QUEBRA_BAIXADA', rb6Re.status === 422 && ((await rb6Re.json().catch(() => ({}))) as any).code === 'REABERTURA_QUEBRA_BAIXADA', { status: rb6Re.status });
    const rb6Read = (await (await fetch(`${base}/${CX}/${rb6}`, { headers: H })).json()) as any;
    check('REAB: caixa segue FECHADO após bloqueio (rollback)', rb6Read.status === 'F', { status: rb6Read.status });
    // 39.7) reabertura DESTRAVA o estorno de baixa em caixa fechado (corte-2a §37.7).
    const rb7 = await cfFresh(0);
    const rb7ar = await wNovoAR(50);
    await fetch(`${base}/${AR}/${rb7ar}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO' }) }); // saldo 50
    await fecharCx(rb7);
    const rb7EstF = await fetch(`${base}/${AR}/${rb7ar}/estornar-baixa`, { method: 'POST', headers: H });
    check('REAB: estorno de baixa em caixa FECHADO → 422 CAIXA_FECHADO (antes de reabrir)', rb7EstF.status === 422 && ((await rb7EstF.json().catch(() => ({}))) as any).code === 'CAIXA_FECHADO', { status: rb7EstF.status });
    await fetch(`${base}/${CX}/${rb7}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    const rb7EstA = await fetch(`${base}/${AR}/${rb7ar}/estornar-baixa`, { method: 'POST', headers: H });
    check('REAB: após reabrir, estorno da baixa funciona → 200 (destravado)', rb7EstA.status === 200, { status: rb7EstA.status });
    await fecharCx(rb7); // cleanup
    // 39.8) RBAC sem grant → 403.
    const rb8 = await cfFresh(0);
    await fecharCx(rb8);
    const rb8Rbac = await fetch(`${base}/${CX}/${rb8}/reabrir`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({}) });
    check('REAB: reabrir sem grant RBAC → 403', rb8Rbac.status === 403, { status: rb8Rbac.status });
    const pgRb = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    // 39.9) reabrir caixa FECHADO de OUTRO operador → 422 CAIXA_OUTRO_OPERADOR.
    const rb9 = Number((await pgRb.query(`INSERT INTO caixa_sessao (codempresa, codoperador, dtabertura, dtfechamento, saldo_inicial, saldo_final, status) VALUES (1, 8, now(), now(), 0, 0, 'F') RETURNING codcaixa`)).rows[0].codcaixa);
    const rb9Re = await fetch(`${base}/${CX}/${rb9}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('REAB: reabrir caixa de outro operador → 422 CAIXA_OUTRO_OPERADOR', rb9Re.status === 422 && ((await rb9Re.json().catch(() => ({}))) as any).code === 'CAIXA_OUTRO_OPERADOR', { status: rb9Re.status });
    // 39.10) reabrir com título de quebra AGRUPADO → 422 TITULO_AGRUPADO + caixa segue FECHADO.
    const rb10 = await cfFresh(100);
    const rb10Fec = (await (await fecharCx(rb10, { valorContado: 55 })).json()) as any; // quebra -45
    await pgRb.query(`UPDATE areceber SET agrupado='S' WHERE codrcb=$1`, [Number(rb10Fec.codrcbQuebra)]);
    const rb10Re = await fetch(`${base}/${CX}/${rb10}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('REAB: reabrir com quebra agrupada → 422 TITULO_AGRUPADO', rb10Re.status === 422 && ((await rb10Re.json().catch(() => ({}))) as any).code === 'TITULO_AGRUPADO', { status: rb10Re.status });
    const rb10Read = (await (await fetch(`${base}/${CX}/${rb10}`, { headers: H })).json()) as any;
    check('REAB: caixa com quebra agrupada segue FECHADO (rollback)', rb10Read.status === 'F', { status: rb10Read.status });
    await pgRb.query(`UPDATE areceber SET agrupado='N' WHERE codrcb=$1`, [Number(rb10Fec.codrcbQuebra)]); // restaura p/ não afetar outras seções
    await pgRb.end();

    // 40) OPERADORES (uCadUsuarios) — corte-2: mestre-detalhe (empresas-permitidas) + supervisor + trava SICOM.
    const OP = 'cadastro/operadores';
    const pgOp = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const opEmpresas = async (cod: number) => (await pgOp.query(`SELECT codempresa FROM relacao_operador_empresa WHERE codoperador=$1 ORDER BY codempresa`, [cod])).rows.map((r: any) => Number(r.codempresa));
    // 40.1) lista traz o seed (op 7/8).
    const opList = (await (await fetch(`${base}/${OP}`, { headers: H })).json().catch(() => [])) as any[];
    check('OPER: GET lista inclui operadores semeados (op 7)', Array.isArray(opList) && opList.some((o) => Number(o.codoperador) === 7), { n: opList?.length });
    // 40.2) cria operador (PK digitada 500), tipo SUP → idgrupo DERIVADO 3 + empresas-permitidas [1].
    const opCreate = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 500, nome: 'TESTE OP', login: 'TESTEOP', tipoop: 'SUP', empresas: [{ codempresa: 1 }] }) });
    check('OPER: POST cria operador (PK digitada + empresas) → 201', opCreate.status === 201, { status: opCreate.status });
    const op500 = (await (await fetch(`${base}/${OP}/500`, { headers: H })).json().catch(() => ({}))) as any;
    check('OPER: tipo SUP deriva idgrupo 3 + empresas [1] no read do agregado', Number(op500.idgrupo) === 3 && op500.tipoop === 'SUP' && Array.isArray(op500.empresas) && op500.empresas.length === 1 && Number(op500.empresas[0].codempresa) === 1, { op500 });
    // grupo (nome) é da VIEW get_operadores (list), não do read cru da tabela.
    const opInList = ((await (await fetch(`${base}/${OP}`, { headers: H })).json().catch(() => [])) as any[]).find((o) => Number(o.codoperador) === 500);
    check('OPER: view get_operadores expõe grupo=Supervisor', opInList?.grupo === 'Supervisor', { opInList });
    // 40.3) LOGIN único (case-insensitive) → 409 (com empresas p/ passar o schema e chegar no índice).
    const opDup = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 501, nome: 'X', login: 'testeop', empresas: [{ codempresa: 1 }] }) });
    check('OPER: login duplicado (case-insensitive) → 409 LOGIN_DUPLICADO', opDup.status === 409 && ((await opDup.json().catch(() => ({}))) as any).code === 'LOGIN_DUPLICADO', { status: opDup.status });
    // 40.4) PUT edita e RE-DERIVA idgrupo (OPE→2); SEM empresas no body → mantém as existentes (substitute só quando enviado).
    const opPut = await fetch(`${base}/${OP}/500`, { method: 'PUT', headers: H, body: JSON.stringify({ nome: 'TESTE OP EDIT', tipoop: 'OPE' }) });
    const op500b = (await (await fetch(`${base}/${OP}/500`, { headers: H })).json().catch(() => ({}))) as any;
    check('OPER: PUT edita e re-deriva idgrupo (OPE→2); empresas preservadas (não enviadas)', opPut.status === 200 && op500b.nome === 'TESTE OP EDIT' && Number(op500b.idgrupo) === 2 && (await opEmpresas(500)).join(',') === '1', { op500b, emp: await opEmpresas(500) });
    // 40.5) empresas-permitidas SUBSTITUTE: [1,2] → grava 2; depois [2] → substitui (só empresa 2).
    const opE12 = await fetch(`${base}/${OP}/500`, { method: 'PUT', headers: H, body: JSON.stringify({ empresas: [{ codempresa: 1 }, { codempresa: 2 }] }) });
    check('OPER: empresas substitute [1,2] grava 2 vínculos', opE12.status === 200 && (await opEmpresas(500)).join(',') === '1,2', { emp: await opEmpresas(500) });
    const opE2 = await fetch(`${base}/${OP}/500`, { method: 'PUT', headers: H, body: JSON.stringify({ empresas: [{ codempresa: 2 }] }) });
    check('OPER: empresas substitute [2] REMOVE a empresa 1 (delete+insert)', opE2.status === 200 && (await opEmpresas(500)).join(',') === '2', { emp: await opEmpresas(500) });
    // 40.6) ≥1 empresa: POST sem empresas → 400; POST com empresas:[] → 400 (uCadUsuarios.pas:444).
    const opNoEmp = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 510, nome: 'SEM EMP', login: 'SEMEMP' }) });
    const opEmptyEmp = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 511, nome: 'EMP VAZIA', login: 'EMPVAZIA', empresas: [] }) });
    check('OPER: ≥1 empresa obrigatória (sem/vazia → 400)', opNoEmp.status === 400 && opEmptyEmp.status === 400, { sem: opNoEmp.status, vazia: opEmptyEmp.status });
    // 40.7) supervisor (idsupervisor) — lookup opcional (auto-relação; 0 dados reais, sem regra).
    const opSup = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 512, nome: 'COM SUP', login: 'COMSUP', idsupervisor: 7, empresas: [{ codempresa: 1 }] }) });
    const op512 = (await (await fetch(`${base}/${OP}/512`, { headers: H })).json().catch(() => ({}))) as any;
    check('OPER: idsupervisor gravado (lookup opcional)', opSup.status === 201 && Number(op512.idsupervisor) === 7, { op512 });
    // 40.8) TRAVA usuário-sistema (op 1 = ADMIN real): PUT e DELETE → 422 OPERADOR_PROTEGIDO.
    const opSicomPut = await fetch(`${base}/${OP}/1`, { method: 'PUT', headers: H, body: JSON.stringify({ nome: 'HACK' }) });
    const opSicomDel = await fetch(`${base}/${OP}/1`, { method: 'DELETE', headers: H });
    check('OPER: usuário-sistema (op 1 ADMIN) não edita nem exclui → 422 OPERADOR_PROTEGIDO',
      opSicomPut.status === 422 && ((await opSicomPut.json().catch(() => ({}))) as any).code === 'OPERADOR_PROTEGIDO'
      && opSicomDel.status === 422 && ((await opSicomDel.json().catch(() => ({}))) as any).code === 'OPERADOR_PROTEGIDO',
      { put: opSicomPut.status, del: opSicomDel.status });
    // 40.8b) não pode CRIAR nem RENOMEAR para um login protegido (checa dto.login, não só a PK).
    const opNovoSicom = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 520, nome: 'FAKE', login: 'SICOM', empresas: [{ codempresa: 1 }] }) });
    const opRenomeia = await fetch(`${base}/${OP}/500`, { method: 'PUT', headers: H, body: JSON.stringify({ login: 'ADMIN' }) });
    check('OPER: criar/renomear PARA login protegido (SICOM/ADMIN) → 422 OPERADOR_PROTEGIDO',
      opNovoSicom.status === 422 && ((await opNovoSicom.json().catch(() => ({}))) as any).code === 'OPERADOR_PROTEGIDO'
      && opRenomeia.status === 422 && ((await opRenomeia.json().catch(() => ({}))) as any).code === 'OPERADOR_PROTEGIDO',
      { novo: opNovoSicom.status, renomeia: opRenomeia.status });
    // 40.9) soft-delete (INDR=E) → some da lista + LIBERA o login + APAGA os vínculos de empresa (cascata).
    const opDel = await fetch(`${base}/${OP}/500`, { method: 'DELETE', headers: H });
    check('OPER: DELETE soft (INDR=E) → 204 + vínculos de empresa apagados (cascata)', opDel.status === 204 && (await opEmpresas(500)).length === 0, { status: opDel.status, emp: await opEmpresas(500) });
    const opGone = await fetch(`${base}/${OP}/500`, { headers: H });
    check('OPER: operador excluído some do GET :id', opGone.status === 404 || ((await opGone.json().catch(() => null)) == null), { status: opGone.status });
    const opReuse = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 502, nome: 'REUSO', login: 'testeop', empresas: [{ codempresa: 1 }] }) });
    check('OPER: login liberado após soft-delete → 201 (reuso)', opReuse.status === 201, { status: opReuse.status });
    // 40.10) validação: sem nome/login → 400.
    const opBad = await fetch(`${base}/${OP}`, { method: 'POST', headers: H, body: JSON.stringify({ codoperador: 503, empresas: [{ codempresa: 1 }] }) });
    check('OPER: POST sem nome/login → 400 (schema)', opBad.status === 400, { status: opBad.status });
    // 40.11) RBAC sem grant → 403.
    const opRbac = await fetch(`${base}/${OP}`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ codoperador: 504, nome: 'X', login: 'XRBAC', empresas: [{ codempresa: 1 }] }) });
    check('OPER: POST sem grant RBAC → 403', opRbac.status === 403, { status: opRbac.status });
    await pgOp.end();

    // 41) FORMAS DE PAGAMENTO (uCadFormaPgto) — engine empresaScoped (IDEMPRESA), PK sequence, únicos/empresa.
    const FP = 'cadastro/formas-pgto';
    // 41.1) lista empresa 1 traz o seed (DINHEIRO etc.).
    const fpList = (await (await fetch(`${base}/${FP}`, { headers: H })).json().catch(() => [])) as any[];
    check('FP: GET lista empresa 1 inclui DINHEIRO (seed)', Array.isArray(fpList) && fpList.some((f) => f.modalidade === 'DINHEIRO'), { n: fpList?.length });
    // 41.2) cria modalidade (PK sequence, idempresa carimbado) destino CXA.
    const fpCreate = await fetch(`${base}/${FP}`, { method: 'POST', headers: H, body: JSON.stringify({ modalidade: 'TESTE FP', atalho: 'Z', destino: 'CXA', recebe_pdv: 'S' }) });
    const fpNew = (await fpCreate.json().catch(() => ({}))) as any;
    check('FP: POST cria modalidade → 201 (idempresa carimbado)', fpCreate.status === 201 && Number(fpNew.idpgto) > 0, { status: fpCreate.status });
    const fpId = Number(fpNew.idpgto);
    const fpRead = (await (await fetch(`${base}/${FP}/${fpId}`, { headers: H })).json().catch(() => ({}))) as any;
    check('FP: criada = destino CXA, empresa 1', fpRead.destino === 'CXA' && Number(fpRead.idempresa) === 1, { fpRead });
    // 41.3) MODALIDADE única por empresa (case-insensitive) → 409.
    const fpDupMod = await fetch(`${base}/${FP}`, { method: 'POST', headers: H, body: JSON.stringify({ modalidade: 'dinheiro', atalho: 'X', destino: 'CXA' }) });
    check('FP: modalidade duplicada na empresa → 409', fpDupMod.status === 409, { status: fpDupMod.status });
    // 41.4) ATALHO único por empresa (case-insensitive) → 409 (D já é do DINHEIRO).
    const fpDupAt = await fetch(`${base}/${FP}`, { method: 'POST', headers: H, body: JSON.stringify({ modalidade: 'OUTRA X', atalho: 'd', destino: 'CXA' }) });
    check('FP: atalho duplicado na empresa → 409', fpDupAt.status === 409, { status: fpDupAt.status });
    // 41.5) DESTINO='QUE' + RECEBE_PDV='S' → 400 (regra QUE≠PDV); com 'N' → 201.
    const fpQueBad = await fetch(`${base}/${FP}`, { method: 'POST', headers: H, body: JSON.stringify({ modalidade: 'QUEBRA X', atalho: 'W', destino: 'QUE', recebe_pdv: 'S' }) });
    check('FP: QUE + recebe_pdv S → 400 (regra QUE≠PDV)', fpQueBad.status === 400, { status: fpQueBad.status });
    const fpQueOk = await fetch(`${base}/${FP}`, { method: 'POST', headers: H, body: JSON.stringify({ modalidade: 'QUEBRA X', atalho: 'W', destino: 'QUE', recebe_pdv: 'N' }) });
    check('FP: QUE + recebe_pdv N → 201', fpQueOk.status === 201, { status: fpQueOk.status });
    // 41.5b) DESTINO obrigatório no create (uCadFormaPgto.pas:324) → 400.
    const fpNoDest = await fetch(`${base}/${FP}`, { method: 'POST', headers: H, body: JSON.stringify({ modalidade: 'SEM DESTINO', atalho: 'Y' }) });
    check('FP: POST sem destino → 400 (destino obrigatório)', fpNoDest.status === 400, { status: fpNoDest.status });
    // 41.6) multi-tenant: empresa 2 cria seu conjunto; empresa 1 não vê.
    const fpE2 = await fetch(`${base}/${FP}`, { method: 'POST', headers: H_EMP2, body: JSON.stringify({ modalidade: 'NOVA E2', atalho: 'N', destino: 'CXA' }) });
    check('FP: empresa 2 cria modalidade → 201', fpE2.status === 201, { status: fpE2.status });
    const fpE1List = (await (await fetch(`${base}/${FP}`, { headers: H })).json().catch(() => [])) as any[];
    check('FP: empresa 1 NÃO vê modalidade da empresa 2 (isolamento)', !fpE1List.some((f) => f.modalidade === 'NOVA E2'), { n: fpE1List?.length });
    // 41.6b) inativar (inativo='S') carimba data_inativo (soft-delete legado INATIVO+DATA_INATIVO).
    await fetch(`${base}/${FP}/${fpId}`, { method: 'PUT', headers: H, body: JSON.stringify({ modalidade: 'TESTE FP', atalho: 'Z', destino: 'CXA', inativo: 'S' }) });
    const fpInat = (await (await fetch(`${base}/${FP}/${fpId}`, { headers: H })).json().catch(() => ({}))) as any;
    check('FP: inativar carimba data_inativo', fpInat.inativo === 'S' && fpInat.data_inativo != null, { fpInat });
    // 41.7) DELETE → 204.
    const fpDel = await fetch(`${base}/${FP}/${fpId}`, { method: 'DELETE', headers: H });
    check('FP: DELETE → 204', fpDel.status === 204, { status: fpDel.status });
    // 41.8) RBAC sem grant → 403.
    const fpRbac = await fetch(`${base}/${FP}`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ modalidade: 'X', atalho: 'X', destino: 'CXA' }) });
    check('FP: POST sem grant RBAC → 403', fpRbac.status === 403, { status: fpRbac.status });

    // 42) CAIXA corte-2d — CONTÁBIL da quebra/sobra do fechamento (situações 2019 sobra / 2002 quebra).
    const pgCx2 = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    await pgCx2.query(`UPDATE empresas SET integracao='AUTOMATICA' WHERE idempresa=1`); // gate
    const diarioCaixa = async (cod: number) => (await pgCx2.query(`SELECT contadebito, contacredito, valor, codoperacao FROM diario WHERE codorigem=17 AND idorigem=$1 AND codempresa=1`, [cod])).rows as any[];
    // 42.1) SOBRA → 2019 (D183 CAIXA CENTRAL / C541 SOBRA).
    const ct1 = await cfFresh(100);
    await fecharCx(ct1, { valorContado: 130 }); // sobra +30
    const ct1Con = await fetch(`${base}/${CX}/${ct1}/contabilizar`, { method: 'POST', headers: H });
    const ct1J = (await ct1Con.json().catch(() => ({}))) as any;
    check('CX-2d: SOBRA contabiliza → 200, situação 2019 D183/C541 valor 30', ct1Con.status === 200 && ct1J.situacao === 2019 && Number(ct1J.contadebito) === 183 && Number(ct1J.contacredito) === 541 && Number(ct1J.valor) === 30, { status: ct1Con.status, ct1J });
    const ct1D = await diarioCaixa(ct1);
    check('CX-2d: DIÁRIO da sobra gravado (1 linha D183/C541)', ct1D.length === 1 && Number(ct1D[0].contadebito) === 183 && Number(ct1D[0].contacredito) === 541, { ct1D });
    // 42.2) idempotente.
    const ct1Con2 = await fetch(`${base}/${CX}/${ct1}/contabilizar`, { method: 'POST', headers: H });
    check('CX-2d: contabilizar 2x → 422 CAIXA_JA_CONTABILIZADA', ct1Con2.status === 422 && ((await ct1Con2.json().catch(() => ({}))) as any).code === 'CAIXA_JA_CONTABILIZADA', { status: ct1Con2.status });
    // 42.3) estornar contábil → DIÁRIO removido.
    const ct1Est = await fetch(`${base}/${CX}/${ct1}/estornar-contabil`, { method: 'POST', headers: H });
    check('CX-2d: estornar-contábil → 200 e DIÁRIO removido', ct1Est.status === 200 && (await diarioCaixa(ct1)).length === 0, { status: ct1Est.status });
    // 42.4) QUEBRA-sem-título → 2002 (D148 / C183).
    const ct2 = await cfFresh(100);
    await fecharCx(ct2, { valorContado: 70, gerarTituloQuebra: false }); // quebra -30 sem título
    const ct2J = (await (await fetch(`${base}/${CX}/${ct2}/contabilizar`, { method: 'POST', headers: H })).json().catch(() => ({}))) as any;
    check('CX-2d: QUEBRA-sem-título → 2002 D148/C183 valor 30', ct2J.situacao === 2002 && Number(ct2J.contadebito) === 148 && Number(ct2J.contacredito) === 183 && Number(ct2J.valor) === 30, { ct2J });
    // 42.5) QUEBRA-com-título → bloqueado (785→AR contábil adiado).
    const ct3 = await cfFresh(100);
    await fecharCx(ct3, { valorContado: 70 }); // quebra -30 COM título (gerarTituloQuebra default)
    const ct3Con = await fetch(`${base}/${CX}/${ct3}/contabilizar`, { method: 'POST', headers: H });
    check('CX-2d: QUEBRA-com-título → 422 CAIXA_CONTABIL_QUEBRA_TITULO', ct3Con.status === 422 && ((await ct3Con.json().catch(() => ({}))) as any).code === 'CAIXA_CONTABIL_QUEBRA_TITULO', { status: ct3Con.status });
    // 42.6) sem diferença → nada a contabilizar.
    const ct4 = await cfFresh(100);
    await fecharCx(ct4, {}); // sem contagem
    const ct4Con = await fetch(`${base}/${CX}/${ct4}/contabilizar`, { method: 'POST', headers: H });
    check('CX-2d: fechar sem contagem → contabilizar 422 CAIXA_SEM_DIFERENCA', ct4Con.status === 422 && ((await ct4Con.json().catch(() => ({}))) as any).code === 'CAIXA_SEM_DIFERENCA', { status: ct4Con.status });
    // 42.7) REABRIR estorna o contábil (DIÁRIO removido, caixa volta a A).
    const ct5 = await cfFresh(100);
    await fecharCx(ct5, { valorContado: 130 });
    await fetch(`${base}/${CX}/${ct5}/contabilizar`, { method: 'POST', headers: H });
    const ct5Reab = await fetch(`${base}/${CX}/${ct5}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CX-2d: reabrir estorna o contábil (DIÁRIO removido, caixa reaberto)', ct5Reab.status === 200 && (await diarioCaixa(ct5)).length === 0, { status: ct5Reab.status });
    await fecharCx(ct5, {}); // cleanup
    // 42.8) RBAC sem grant → 403.
    const ct6 = await cfFresh(100);
    await fecharCx(ct6, { valorContado: 130 });
    const ct6Rbac = await fetch(`${base}/${CX}/${ct6}/contabilizar`, { method: 'POST', headers: H_SEM_ACESSO });
    check('CX-2d: contabilizar sem grant RBAC → 403', ct6Rbac.status === 403, { status: ct6Rbac.status });
    await pgCx2.end();

    // 43) AR/AP corte-3a — BAIXA/PAGAMENTO PARCIAL (valorpg < total → gera título-saldo ORIGEM='B').
    const pgPar = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const ARp = 'cadastro/areceber', APp = 'cadastro/apagar';
    const crParAR = async () => Number(((await (await fetch(`${base}/${ARp}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 100 }) })).json()) as any).codrcb);
    const crParAP = async () => Number(((await (await fetch(`${base}/${APp}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 100 }) })).json()) as any).codapg);
    const arRow = async (cod: number) => (await pgPar.query(`SELECT valor, origem, gerado, quitada, tipodoc, cadastrado_manualmente, to_char(dtvenc,'YYYY-MM-DD') dtvenc FROM areceber WHERE codrcb=$1 AND codempresa=1`, [cod])).rows[0] as any;
    const apRow = async (cod: number) => (await pgPar.query(`SELECT valor, origem, gerado, quitada, tipodoc, cadastrado_manualmente, to_char(dtvenc,'YYYY-MM-DD') dtvenc FROM apagar WHERE codapg=$1 AND codempresa=1`, [cod])).rows[0] as any;

    // 43.1) AR baixa PARCIAL: valorpg 60 (a vencer → juro 0, total 100) quita o original e gera saldo 40 (ORIGEM='B').
    // Saldo herda TIPODOC forçado 'DUPLICATA', cadastrado_manualmente NULL (paridade Oracle), DTVENC = data da baixa
    // (renegociada, NÃO o vencimento original 2027-01-01 → prova M2).
    const arPar = await crParAR();
    const arParRes = await fetch(`${base}/${ARp}/${arPar}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ valorpg: 60, dtpgto: '2026-07-04' }) });
    const arParBody = (await arParRes.json().catch(() => ({}))) as any;
    const arSaldo = Number(arParBody.saldoTitulo);
    const arSaldoRow = arParBody.saldoTitulo ? await arRow(arSaldo) : null;
    const arBxLink = (await pgPar.query(`SELECT codrcb_gerado FROM areceber_bx WHERE codrcb=$1 AND coalesce(indr,'I')='I'`, [arPar])).rows[0] as any;
    check('CR-parcial: valorpg<total quita original + gera saldo 40 (ORIGEM=B, GERADO=SISTEMA, quitada=N, bx.codrcb_gerado)',
      arParRes.status === 200 && arParBody.parcial === true && arSaldo > 0 && (await arRow(arPar)).quitada === 'S'
      && arSaldoRow && Number(arSaldoRow.valor) === 40 && arSaldoRow.origem === 'B' && arSaldoRow.gerado === 'SISTEMA' && arSaldoRow.quitada === 'N'
      && Number(arBxLink?.codrcb_gerado) === arSaldo,
      { status: arParRes.status, body: arParBody, saldo: arSaldoRow, link: arBxLink });
    // 43.1b) paridade do saldo: TIPODOC='DUPLICATA', cadastrado_manualmente='N' (SISTEMA; convenção monorepo 043:45),
    // DTVENC = data da baixa (renegociado ≠ vencimento original 2027-01-01).
    check('CR-parcial: saldo TIPODOC=DUPLICATA + cadastrado_manualmente=N (SISTEMA) + DTVENC renegociado (2026-07-04 ≠ 2027-01-01)',
      arSaldoRow && arSaldoRow.tipodoc === 'DUPLICATA' && arSaldoRow.cadastrado_manualmente === 'N' && arSaldoRow.dtvenc === '2026-07-04',
      { saldo: arSaldoRow });
    // 43.1c) valorpg > total (pagou a mais) → 422 TITULO_VALOR_EXCEDE (troco é corte-3; não grava fantasma).
    const arExc = await crParAR();
    const arExcRes = await fetch(`${base}/${ARp}/${arExc}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ valorpg: 150 }) });
    check('CR-parcial: valorpg > total → 422 TITULO_VALOR_EXCEDE', arExcRes.status === 422 && ((await arExcRes.json().catch(() => ({}))) as any).code === 'TITULO_VALOR_EXCEDE', { status: arExcRes.status });
    // 43.2) AR baixa TOTAL (sem valorpg): parcial=false, saldoTitulo=null (nenhum título extra).
    const arFull = await crParAR();
    const arFullBody = (await (await fetch(`${base}/${ARp}/${arFull}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) })).json().catch(() => ({}))) as any;
    check('CR-parcial: baixa total (sem valorpg) não gera saldo (parcial=false, saldoTitulo=null)', arFullBody.parcial === false && arFullBody.saldoTitulo == null, { body: arFullBody });
    // 43.3) AR estorno da parcial: reabre o original E remove o título-saldo (senão duplicaria a dívida).
    const arEstPar = await fetch(`${base}/${ARp}/${arPar}/estornar-baixa`, { method: 'POST', headers: H });
    const arSaldoGone = Number((await pgPar.query(`SELECT count(*)::int n FROM areceber WHERE codrcb=$1`, [arSaldo])).rows[0].n);
    check('CR-parcial: estorno reabre original (quitada=N) + REMOVE título-saldo', arEstPar.status === 200 && (await arRow(arPar)).quitada === 'N' && arSaldoGone === 0, { status: arEstPar.status, saldoGone: arSaldoGone });
    // 43.4) AR estorno BLOQUEADO se o título-saldo já foi baixado → 422 REVERSAO_PARCIAL_SALDO_BAIXADO.
    const arPar2 = await crParAR();
    const arPar2Body = (await (await fetch(`${base}/${ARp}/${arPar2}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ valorpg: 60 }) })).json().catch(() => ({}))) as any;
    await fetch(`${base}/${ARp}/${Number(arPar2Body.saldoTitulo)}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) }); // baixa o saldo
    const arEstBlk = await fetch(`${base}/${ARp}/${arPar2}/estornar-baixa`, { method: 'POST', headers: H });
    check('CR-parcial: estorno bloqueado se saldo já baixado → 422 REVERSAO_PARCIAL_SALDO_BAIXADO', arEstBlk.status === 422 && ((await arEstBlk.json().catch(() => ({}))) as any).code === 'REVERSAO_PARCIAL_SALDO_BAIXADO', { status: arEstBlk.status });

    // 43.5) AP pagamento PARCIAL: gêmeo do AR (valorpg 60 → saldo 40 ORIGEM='B', TIPODOC=DUPLICATA, DTVENC renegociado).
    const apPar = await crParAP();
    const apParRes = await fetch(`${base}/${APp}/${apPar}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ valorpg: 60, dtpgto: '2026-07-04' }) });
    const apParBody = (await apParRes.json().catch(() => ({}))) as any;
    const apSaldo = Number(apParBody.saldoTitulo);
    const apSaldoRow = apParBody.saldoTitulo ? await apRow(apSaldo) : null;
    const apBxLink = (await pgPar.query(`SELECT codapg_gerado FROM apagar_bx WHERE codapg=$1 AND coalesce(indr,'I')='I'`, [apPar])).rows[0] as any;
    check('CP-parcial: valorpg<total quita original + gera saldo 40 (ORIGEM=B, GERADO=SISTEMA, quitada=N, bx.codapg_gerado, TIPODOC=DUPLICATA, cad_manual NULL, DTVENC renegociado)',
      apParRes.status === 200 && apParBody.parcial === true && apSaldo > 0 && (await apRow(apPar)).quitada === 'S'
      && apSaldoRow && Number(apSaldoRow.valor) === 40 && apSaldoRow.origem === 'B' && apSaldoRow.gerado === 'SISTEMA' && apSaldoRow.quitada === 'N'
      && apSaldoRow.tipodoc === 'DUPLICATA' && apSaldoRow.cadastrado_manualmente === 'N' && apSaldoRow.dtvenc === '2026-07-04'
      && Number(apBxLink?.codapg_gerado) === apSaldo,
      { status: apParRes.status, body: apParBody, saldo: apSaldoRow, link: apBxLink });
    // 43.5b) AP valorpg > total → 422 TITULO_VALOR_EXCEDE.
    const apExc = await crParAP();
    const apExcRes = await fetch(`${base}/${APp}/${apExc}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ valorpg: 150 }) });
    check('CP-parcial: valorpg > total → 422 TITULO_VALOR_EXCEDE', apExcRes.status === 422 && ((await apExcRes.json().catch(() => ({}))) as any).code === 'TITULO_VALOR_EXCEDE', { status: apExcRes.status });
    // 43.6) AP pagamento TOTAL: parcial=false, saldoTitulo=null.
    const apFull = await crParAP();
    const apFullBody = (await (await fetch(`${base}/${APp}/${apFull}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) })).json().catch(() => ({}))) as any;
    check('CP-parcial: pagamento total não gera saldo (parcial=false, saldoTitulo=null)', apFullBody.parcial === false && apFullBody.saldoTitulo == null, { body: apFullBody });
    // 43.7) AP estorno da parcial: reabre original + remove título-saldo.
    const apEstPar = await fetch(`${base}/${APp}/${apPar}/estornar-baixa`, { method: 'POST', headers: H });
    const apSaldoGone = Number((await pgPar.query(`SELECT count(*)::int n FROM apagar WHERE codapg=$1`, [apSaldo])).rows[0].n);
    check('CP-parcial: estorno reabre original (quitada=N) + REMOVE título-saldo', apEstPar.status === 200 && (await apRow(apPar)).quitada === 'N' && apSaldoGone === 0, { status: apEstPar.status, saldoGone: apSaldoGone });
    // 43.8) AP estorno BLOQUEADO se o título-saldo já foi pago → 422 REVERSAO_PARCIAL_SALDO_BAIXADO.
    const apPar2 = await crParAP();
    const apPar2Body = (await (await fetch(`${base}/${APp}/${apPar2}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ valorpg: 60 }) })).json().catch(() => ({}))) as any;
    await fetch(`${base}/${APp}/${Number(apPar2Body.saldoTitulo)}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    const apEstBlk = await fetch(`${base}/${APp}/${apPar2}/estornar-baixa`, { method: 'POST', headers: H });
    check('CP-parcial: estorno bloqueado se saldo já pago → 422 REVERSAO_PARCIAL_SALDO_BAIXADO', apEstBlk.status === 422 && ((await apEstBlk.json().catch(() => ({}))) as any).code === 'REVERSAO_PARCIAL_SALDO_BAIXADO', { status: apEstBlk.status });
    await pgPar.end();

    // 44) AR/AP corte-3b — CONTÁBIL da baixa DINHEIRO (auto-disparo; CODORIGEM 16 AR / 15 AP). Empresa 1 = AUTOMATICA.
    const pgCtb = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const ARc = 'cadastro/areceber', APc = 'cadastro/apagar', CXc = 'cobranca/caixa';
    const diarioBx = async (codorigem: number, codbx: number) => (await pgCtb.query(`SELECT contadebito, contacredito, valor, codoperacao FROM diario WHERE codorigem=$1 AND idorigem=$2 AND codempresa=1`, [codorigem, codbx])).rows as any[];
    const bxAtivoAR = async (codrcb: number) => Number((await pgCtb.query(`SELECT codrcbbx, contabilizado FROM areceber_bx WHERE codrcb=$1 AND coalesce(indr,'I')='I'`, [codrcb])).rows[0]?.codrcbbx);
    const ctbFlagAR = async (codrcbbx: number) => (await pgCtb.query(`SELECT contabilizado FROM areceber_bx WHERE codrcbbx=$1`, [codrcbbx])).rows[0]?.contabilizado;
    const bxAtivoAP = async (codapg: number) => Number((await pgCtb.query(`SELECT codapgbx FROM apagar_bx WHERE codapg=$1 AND coalesce(indr,'I')='I'`, [codapg])).rows[0]?.codapgbx);
    // setup: caixa aberto limpo (fecha o que sobrou) com fundo 1000.
    const ctbPre = await (await fetch(`${base}/${CXc}/atual`, { headers: H })).json().catch(() => null);
    if ((ctbPre as any)?.sessao?.codcaixa) await fetch(`${base}/${CXc}/${(ctbPre as any).sessao.codcaixa}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    await fetch(`${base}/${CXc}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: 1000 }) });
    // precondição do teste: o cliente (parceiro 20) precisa de conta contábil (migração 055 seeda, mas
    // os testes de NF editam o parceiro 20 antes daqui) — garante explicitamente, como §42 faz p/ integracao.
    await pgCtb.query(`UPDATE parceiros SET codcontabil='211' WHERE codparceiro=20`);
    const crCtbAR = async () => Number(((await (await fetch(`${base}/${ARc}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 100 }) })).json()) as any).codrcb);
    const crCtbAP = async () => Number(((await (await fetch(`${base}/${APc}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 50 }) })).json()) as any).codapg);

    // 44.1) AR baixa DINHEIRO → DIÁRIO D183/C211 valor 100 codoperacao 2009 + areceber_bx.contabilizado='S'.
    const ctbAr = await crCtbAR();
    await fetch(`${base}/${ARc}/${ctbAr}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO', dtpgto: '2026-07-04' }) });
    const ctbArBx = await bxAtivoAR(ctbAr);
    const ctbArDia = await diarioBx(16, ctbArBx);
    check('CR-contábil: baixa DINHEIRO → DIÁRIO D183/C211 valor 100 (CODORIGEM 16, sit 2009) + contabilizado=S',
      ctbArDia.length === 1 && Number(ctbArDia[0].contadebito) === 183 && Number(ctbArDia[0].contacredito) === 211 && Number(ctbArDia[0].valor) === 100 && Number(ctbArDia[0].codoperacao) === 2009 && (await ctbFlagAR(ctbArBx)) === 'S',
      { dia: ctbArDia, flag: await ctbFlagAR(ctbArBx) });
    // 44.2) estorno da baixa AR → DIÁRIO removido + contabilizado null + título reaberto.
    const ctbArEst = await fetch(`${base}/${ARc}/${ctbAr}/estornar-baixa`, { method: 'POST', headers: H });
    check('CR-contábil: estorno reverte o DIÁRIO (removido) + contabilizado null + reabre',
      ctbArEst.status === 200 && (await diarioBx(16, ctbArBx)).length === 0 && (await ctbFlagAR(ctbArBx)) == null && (await pgCtb.query(`SELECT quitada FROM areceber WHERE codrcb=$1`, [ctbAr])).rows[0]?.quitada === 'N',
      { status: ctbArEst.status });

    // 44.3) AP pagamento DINHEIRO → DIÁRIO D11141/C183 valor 50 codoperacao 2004.
    const ctbAp = await crCtbAP();
    await fetch(`${base}/${APc}/${ctbAp}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO', dtpgto: '2026-07-04' }) });
    const ctbApBx = await bxAtivoAP(ctbAp);
    const ctbApDia = await diarioBx(15, ctbApBx);
    check('CP-contábil: pagamento DINHEIRO → DIÁRIO D11141/C183 valor 50 (CODORIGEM 15, sit 2004)',
      ctbApDia.length === 1 && Number(ctbApDia[0].contadebito) === 11141 && Number(ctbApDia[0].contacredito) === 183 && Number(ctbApDia[0].valor) === 50 && Number(ctbApDia[0].codoperacao) === 2004,
      { dia: ctbApDia });
    // 44.4) estorno da baixa AP → DIÁRIO removido + reaberto.
    const ctbApEst = await fetch(`${base}/${APc}/${ctbAp}/estornar-baixa`, { method: 'POST', headers: H });
    check('CP-contábil: estorno reverte o DIÁRIO + reabre', ctbApEst.status === 200 && (await diarioBx(15, ctbApBx)).length === 0, { status: ctbApEst.status });

    // 44.5) PERÍODO FECHADO → baixa DINHEIRO SUCEDE mas NÃO contabiliza (gate assertPeriodoAberto, best-effort).
    await pgCtb.query(`INSERT INTO periodo_contabil (codempresa, competencia_contabil, data_inicio, data_fim, status, bloq_nf) VALUES (1, '2026-07', '2026-07-01', '2026-07-31', 'S', 'S')`);
    const ctbArPf = await crCtbAR();
    const ctbArPfRes = await fetch(`${base}/${ARc}/${ctbArPf}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO', dtpgto: '2026-07-04' }) });
    const ctbArPfBx = await bxAtivoAR(ctbArPf);
    check('CR-contábil: período FECHADO → baixa OK (200) mas SEM DIÁRIO (contábil pulado best-effort)',
      ctbArPfRes.status === 200 && (await diarioBx(16, ctbArPfBx)).length === 0 && (await ctbFlagAR(ctbArPfBx)) == null,
      { status: ctbArPfRes.status });
    await pgCtb.query(`DELETE FROM periodo_contabil WHERE codempresa=1 AND competencia_contabil='2026-07'`);
    await fetch(`${base}/${ARc}/${ctbArPf}/estornar-baixa`, { method: 'POST', headers: H }); // cleanup

    // 44.6) empresa NÃO-AUTOMATICA → baixa DINHEIRO OK mas SEM contábil (gate INTEGRACAO). Restaura AUTOMATICA.
    await pgCtb.query(`UPDATE empresas SET integracao='MANUAL' WHERE idempresa=1`);
    const ctbArNa = await crCtbAR();
    await fetch(`${base}/${ARc}/${ctbArNa}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO', dtpgto: '2026-07-04' }) });
    const ctbArNaBx = await bxAtivoAR(ctbArNa);
    check('CR-contábil: empresa não-AUTOMATICA → baixa OK sem DIÁRIO (gate INTEGRACAO)', (await diarioBx(16, ctbArNaBx)).length === 0 && (await ctbFlagAR(ctbArNaBx)) == null, { flag: await ctbFlagAR(ctbArNaBx) });
    await pgCtb.query(`UPDATE empresas SET integracao='AUTOMATICA' WHERE idempresa=1`);
    // 44.7) guarda anti-armadilha (achado paridade #2): se a IIC 2009 ficar com as DUAS pernas TIPO='A'
    // (cenário legado recurso-driven reimportado), o contábil NÃO pode produzir D=cliente/C=cliente → pula.
    await pgCtb.query(`UPDATE itens_integracao_contabil SET tipo='A', codconta_contabil=NULL WHERE codoperacao=2009 AND natureza='D'`);
    const ctbArG = await crCtbAR();
    await fetch(`${base}/${ARc}/${ctbArG}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO', dtpgto: '2026-07-04' }) });
    const ctbArGBx = await bxAtivoAR(ctbArG);
    check('CR-contábil: IIC com 2 pernas TIPO=A → guarda pula o lançamento (sem DIÁRIO, não D=cliente/C=cliente)', (await diarioBx(16, ctbArGBx)).length === 0, { dia: await diarioBx(16, ctbArGBx) });
    await pgCtb.query(`UPDATE itens_integracao_contabil SET tipo='F', codconta_contabil=183 WHERE codoperacao=2009 AND natureza='D'`); // restaura
    await pgCtb.end();

    // 45) CAIXA corte-2d-b — TESOURARIA do dinheiro (fechamento move o saldo de 183 p/ o cofre; CODORIGEM 19 + MCB).
    const pgTes = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const CXt = 'cobranca/caixa', ARt = 'cadastro/areceber', APt = 'cadastro/apagar';
    await pgTes.query(`UPDATE empresas SET integracao='AUTOMATICA' WHERE idempresa=1`); // §44 deixou MANUAL; reafirma
    await pgTes.query(`UPDATE parceiros SET codcontabil='211' WHERE codparceiro=20`); // cliente com conta (p/ corte-3b postar 183)
    const tesDiario = async (cod: number) => (await pgTes.query(`SELECT contadebito, contacredito, valor, codoperacao, codhist FROM diario WHERE codorigem=19 AND idorigem=$1 AND codempresa=1`, [cod])).rows as any[];
    const divDiario = async (cod: number) => (await pgTes.query(`SELECT contadebito, contacredito, valor, codoperacao FROM diario WHERE codorigem=17 AND idorigem=$1 AND codempresa=1`, [cod])).rows as any[];
    const tesMcb = async (cod: number) => (await pgTes.query(`SELECT codconta, valor, tipomovimento, codopconta, idpgto, origem, contabilizado, codoperador FROM mov_contas_bancarias WHERE nropdv_fechamento=$1 AND idempresa=1`, [cod])).rows as any[];
    const abrirCx = async (fundo: number) => {
      const pre = await (await fetch(`${base}/${CXt}/atual`, { headers: H })).json().catch(() => null);
      if ((pre as any)?.sessao?.codcaixa) await fetch(`${base}/${CXt}/${(pre as any).sessao.codcaixa}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
      return Number(((await (await fetch(`${base}/${CXt}/abrir`, { method: 'POST', headers: H, body: JSON.stringify({ saldoInicial: fundo }) })).json()) as any).codcaixa);
    };
    const crART = async (v: number) => Number(((await (await fetch(`${base}/${ARt}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: v }) })).json()) as any).codrcb);
    const crAPT = async (v: number) => Number(((await (await fetch(`${base}/${APt}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: v }) })).json()) as any).codapg);
    const baixarDin = async (path: string, id: number) => fetch(`${base}/${path}/${id}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'DINHEIRO', dtpgto: '2026-07-06' }) });

    // 45.1) caixa com baixa AR dinheiro 100 → tesouraria WASH D183/C183 (codoperacao 2020, CODORIGEM 19) + MCB FCP.
    const tc1 = await abrirCx(0);
    await baixarDin(ARt, await crART(100));
    await fetch(`${base}/${CXt}/${tc1}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) }); // sem contagem → dif 0, netDin 100
    const tc1Con = await fetch(`${base}/${CXt}/${tc1}/contabilizar`, { method: 'POST', headers: H });
    const tc1J = (await tc1Con.json().catch(() => ({}))) as any;
    const tc1Dia = await tesDiario(tc1);
    check('CX-2d-b: tesouraria = transferência WASH D183/C183 (codoperacao 2020, codhist 86, CODORIGEM 19) valor 100',
      tc1Con.status === 200 && tc1Dia.length === 1 && Number(tc1Dia[0].contadebito) === 183 && Number(tc1Dia[0].contacredito) === 183 && Number(tc1Dia[0].valor) === 100 && Number(tc1Dia[0].codoperacao) === 2020 && Number(tc1Dia[0].codhist) === 86 && tc1J.tesouraria && Number(tc1J.tesouraria.valor) === 100,
      { status: tc1Con.status, dia: tc1Dia, body: tc1J });
    const tc1Mcb = await tesMcb(tc1);
    check('CX-2d-b: razão MOV_CONTAS_BANCARIAS (FCP, tipomov C, valor 100, codopconta 0, codoperador 7, contabilizado NULL)',
      tc1Mcb.length === 1 && tc1Mcb[0].origem === 'FCP' && tc1Mcb[0].tipomovimento === 'C' && Number(tc1Mcb[0].valor) === 100 && Number(tc1Mcb[0].codopconta) === 0 && Number(tc1Mcb[0].codoperador) === 7 && tc1Mcb[0].contabilizado == null,
      { mcb: tc1Mcb });
    // 45.2) estornar-contábil → tesouraria (19) + MCB removidos.
    const tc1Est = await fetch(`${base}/${CXt}/${tc1}/estornar-contabil`, { method: 'POST', headers: H });
    check('CX-2d-b: estornar-contábil remove tesouraria (DIÁRIO 19) + MCB', tc1Est.status === 200 && (await tesDiario(tc1)).length === 0 && (await tesMcb(tc1)).length === 0, { status: tc1Est.status });

    // 45.3) divergência (sobra) + tesouraria COEXISTEM: baixa AR 100 (saldo 100), fecha contado 130 (sobra 30).
    const tc2 = await abrirCx(0);
    await baixarDin(ARt, await crART(100));
    await fetch(`${base}/${CXt}/${tc2}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 130 }) });
    await fetch(`${base}/${CXt}/${tc2}/contabilizar`, { method: 'POST', headers: H });
    const tc2Div = await divDiario(tc2); const tc2Tes = await tesDiario(tc2);
    check('CX-2d-b: divergência (2019 D183/C541 val 30) + tesouraria (19 D183/C183 val 100) coexistem',
      tc2Div.length === 1 && Number(tc2Div[0].codoperacao) === 2019 && Number(tc2Div[0].valor) === 30
      && tc2Tes.length === 1 && Number(tc2Tes[0].contadebito) === 183 && Number(tc2Tes[0].contacredito) === 183 && Number(tc2Tes[0].valor) === 100 && Number(tc2Tes[0].codoperacao) === 2020,
      { div: tc2Div, tes: tc2Tes });

    // 45.4) net-payment (AP dinheiro > AR): netDin ≤ 0 → SEM tesouraria (legado FCP é 100% 'C'); só a divergência.
    // fundo 200, AR 30, AP 100 (saldo 130), fecha contado 140 (sobra 10). netDin=−70 → nenhuma linha 19/MCB.
    const tc3 = await abrirCx(200);
    await baixarDin(ARt, await crART(30));
    await baixarDin(APt, await crAPT(100));
    await fetch(`${base}/${CXt}/${tc3}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({ valorContado: 140 }) });
    await fetch(`${base}/${CXt}/${tc3}/contabilizar`, { method: 'POST', headers: H });
    const tc3Div = await divDiario(tc3); const tc3Tes = await tesDiario(tc3); const tc3Mcb = await tesMcb(tc3);
    check('CX-2d-b: net-payment (netDin≤0) → SEM tesouraria (0 linha 19, 0 MCB); só a divergência (2019 val 10)',
      tc3Div.length === 1 && Number(tc3Div[0].valor) === 10 && tc3Tes.length === 0 && tc3Mcb.length === 0,
      { div: tc3Div, tes: tc3Tes, mcb: tc3Mcb });

    // 45.5) REABERTURA estorna a tesouraria também (17 + 19 + MCB) e reabre o caixa.
    const tc4 = await abrirCx(0);
    await baixarDin(ARt, await crART(50));
    await fetch(`${base}/${CXt}/${tc4}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    await fetch(`${base}/${CXt}/${tc4}/contabilizar`, { method: 'POST', headers: H });
    const tc4Reab = await fetch(`${base}/${CXt}/${tc4}/reabrir`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    check('CX-2d-b: reabertura estorna tesouraria (DIÁRIO 19 + MCB removidos, caixa reaberto)',
      tc4Reab.status === 200 && (await tesDiario(tc4)).length === 0 && (await tesMcb(tc4)).length === 0,
      { status: tc4Reab.status });
    await fetch(`${base}/${CXt}/${tc4}/fechar`, { method: 'POST', headers: H, body: JSON.stringify({}) }); // cleanup
    await pgTes.end();

    // 46) AR/AP contábil-2 — baixa por recurso BANCO (money leg = contas_bancarias.codlanccontabil; NÃO toca o caixa).
    const pgBco = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const ARb = 'cadastro/areceber', APb = 'cadastro/apagar';
    await pgBco.query(`UPDATE empresas SET integracao='AUTOMATICA' WHERE idempresa=1`);
    await pgBco.query(`UPDATE parceiros SET codcontabil='211' WHERE codparceiro=20`);
    const bcoDiaAR = async (codrcbbx: number) => (await pgBco.query(`SELECT contadebito, contacredito, valor, codoperacao FROM diario WHERE codorigem=16 AND idorigem=$1 AND codempresa=1`, [codrcbbx])).rows as any[];
    const bcoDiaAP = async (codapgbx: number) => (await pgBco.query(`SELECT contadebito, contacredito, valor, codoperacao FROM diario WHERE codorigem=15 AND idorigem=$1 AND codempresa=1`, [codapgbx])).rows as any[];
    const bxAR = async (codrcb: number) => Number((await pgBco.query(`SELECT codrcbbx FROM areceber_bx WHERE codrcb=$1 AND coalesce(indr,'I')='I'`, [codrcb])).rows[0]?.codrcbbx);
    const bxAP = async (codapg: number) => Number((await pgBco.query(`SELECT codapgbx FROM apagar_bx WHERE codapg=$1 AND coalesce(indr,'I')='I'`, [codapg])).rows[0]?.codapgbx);
    const movDe = async (codrcbbx: number) => Number((await pgBco.query(`SELECT count(*)::int n FROM caixa_mov WHERE codrcbbx=$1`, [codrcbbx])).rows[0].n);
    const crBcoAR = async () => Number(((await (await fetch(`${base}/${ARb}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 20, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 100 }) })).json()) as any).codrcb);
    const crBcoAP = async () => Number(((await (await fetch(`${base}/${APb}`, { method: 'POST', headers: H, body: JSON.stringify({ codparceiro: 22, dtvenda: '2026-07-01', dtvenc: '2027-01-01', valor: 80 }) })).json()) as any).codapg);

    // 46.1) AR baixa BANCO (conta 1 → codlanccontabil 186) → DIÁRIO D186/C211 valor 100 (CODORIGEM 16, sit 2009); SEM caixa_mov.
    const bcoAr = await crBcoAR();
    const bcoArRes = await fetch(`${base}/${ARb}/${bcoAr}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'BANCO', codconta: 1, dtpgto: '2026-07-06' }) });
    const bcoArBx = await bxAR(bcoAr);
    const bcoArDia = await bcoDiaAR(bcoArBx);
    check('AR-banco: baixa BANCO → DIÁRIO D186(banco)/C211(cliente) valor 100 (sit 2009) + SEM caixa_mov',
      bcoArRes.status === 200 && bcoArDia.length === 1 && Number(bcoArDia[0].contadebito) === 186 && Number(bcoArDia[0].contacredito) === 211 && Number(bcoArDia[0].valor) === 100 && Number(bcoArDia[0].codoperacao) === 2009 && (await movDe(bcoArBx)) === 0,
      { status: bcoArRes.status, dia: bcoArDia });
    // 46.2) estorno da baixa BANCO → DIÁRIO removido + título reaberto.
    const bcoArEst = await fetch(`${base}/${ARb}/${bcoAr}/estornar-baixa`, { method: 'POST', headers: H });
    check('AR-banco: estorno remove o DIÁRIO + reabre', bcoArEst.status === 200 && (await bcoDiaAR(bcoArBx)).length === 0 && (await pgBco.query(`SELECT quitada FROM areceber WHERE codrcb=$1`, [bcoAr])).rows[0]?.quitada === 'N', { status: bcoArEst.status });
    // 46.3) recurso BANCO sem codconta → 400 (schema); codconta inexistente → 422 CONTA_BANCARIA_NAO_ENCONTRADA.
    const bcoNoConta = await fetch(`${base}/${ARb}/${await crBcoAR()}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'BANCO' }) });
    const bcoBadConta = await fetch(`${base}/${ARb}/${await crBcoAR()}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'BANCO', codconta: 99999 }) });
    check('AR-banco: BANCO sem codconta → 400; codconta inexistente → 422 CONTA_BANCARIA_NAO_ENCONTRADA',
      bcoNoConta.status === 400 && bcoBadConta.status === 422 && ((await bcoBadConta.json().catch(() => ({}))) as any).code === 'CONTA_BANCARIA_NAO_ENCONTRADA',
      { sem: bcoNoConta.status, bad: bcoBadConta.status });
    // 46.4) AP pagamento BANCO → DIÁRIO D11141(fornecedor)/C186(banco) valor 80 (CODORIGEM 15, sit 2004).
    const bcoAp = await crBcoAP();
    const bcoApRes = await fetch(`${base}/${APb}/${bcoAp}/baixar`, { method: 'POST', headers: H, body: JSON.stringify({ recurso: 'BANCO', codconta: 1, dtpgto: '2026-07-06' }) });
    const bcoApBx = await bxAP(bcoAp);
    const bcoApDia = await bcoDiaAP(bcoApBx);
    check('AP-banco: pagamento BANCO → DIÁRIO D11141(fornecedor)/C186(banco) valor 80 (sit 2004)',
      bcoApRes.status === 200 && bcoApDia.length === 1 && Number(bcoApDia[0].contadebito) === 11141 && Number(bcoApDia[0].contacredito) === 186 && Number(bcoApDia[0].valor) === 80 && Number(bcoApDia[0].codoperacao) === 2004,
      { status: bcoApRes.status, dia: bcoApDia });
    await pgBco.end();
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
