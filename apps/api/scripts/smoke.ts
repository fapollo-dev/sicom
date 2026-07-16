import 'reflect-metadata';
import { Pool } from 'pg';
import { NestFactory } from '@nestjs/core';
import { chaveNfeValida, montarChaveNfe } from '@apollo/shared';
import { startEmbeddedPg, PG_CONN } from '../test/embedded-db';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { dedupCodref, type RawCodref } from './cutover/dedup-codref';
import { loadCodref } from './cutover/load-codref';


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

    // 54) corte-4c — ST RESIDUAL (ICMS-ST a recolher pela loja) → título A Pagar 'RESIDUAL ST'.
    // golden PINHEIRAO: ICMS_ST_APAGAR = TOTALICM_STEXTERNO − ICMS_ST_PAGO_FONTE; título TIPODOC='RESIDUAL ST',
    // RETENCAO='ICMSST', GERADO='SISTEMA', ORIGEM='N', à vista (DTVENC=DTEMISSAO), 1 por NF.
    const stResidualDaNf = async (cod: number): Promise<any[]> => {
      const pg = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
      const r = await pg.query(`SELECT valor, tipodoc, retencao, origem, gerado, duplicata, to_char(dtvenc,'YYYY-MM-DD') AS dtvenc, obs, idnf FROM apagar WHERE idnf=$1 AND tipodoc='RESIDUAL ST'`, [cod]);
      await pg.end();
      return r.rows;
    };

    // 54.1) derivar computa icms_st_apagar do cabeçalho (externo 316,91 − pago_fonte 0 = 316,91).
    // dtemissao ≠ dtcontabil DE PROPÓSITO: o golden usa DTCONTABIL no vencimento (não emissão).
    const nfStr1 = await novaNf(baseNf({ tipo: 'E', nronf: 'STR001', codparceiro: 22, dtemissao: '2026-06-10', dtcontabil: '2026-06-15', total_icmst_externo: 316.91, itens: [itemP1(4)] }));
    const nfStr1Read = (await (await fetch(`${base}/fiscal/nf/${nfStr1}`, { headers: H })).json()) as any;
    check('4c: derivar calcula icms_st_apagar = total_icmst_externo − icms_st_pago_fonte (316,91)', Number(nfStr1Read.icms_st_apagar) === 316.91, { icms_st_apagar: nfStr1Read.icms_st_apagar });

    // 54.2) faturar (entrada) gera o título RESIDUAL ST golden-exato (à vista = DTCONTABIL, não DTEMISSAO)
    // + OBS byte-a-byte com VÍRGULA decimal ('VALOR NOTA FISCAL: 14,00') + duplicata=NRONF.
    const fatSt = await fetch(`${base}/fiscal/nf/${nfStr1}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-15', intervaloDias: 30 }) });
    const strTit = await stResidualDaNf(nfStr1);
    const obsEsperada = 'REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: ICMSST\n'
      + 'NOTA FISCAL NRO: STR001\n'
      + `VALOR NOTA FISCAL: ${Number(nfStr1Read.totalnf).toFixed(2).replace('.', ',')}\n`
      + 'ALIQUOTA ICMSST: 0,00%';
    check('4c: faturar (entrada) gera 1 título RESIDUAL ST (valor 316,91, RETENCAO=ICMSST, GERADO=SISTEMA, ORIGEM=N)',
      fatSt.status === 200 && strTit.length === 1
      && Number(strTit[0].valor) === 316.91 && strTit[0].tipodoc === 'RESIDUAL ST' && strTit[0].retencao === 'ICMSST'
      && strTit[0].gerado === 'SISTEMA' && strTit[0].origem === 'N',
      { status: fatSt.status, strTit });
    check('4c: RESIDUAL ST à vista usa DTCONTABIL (dtvenc=2026-06-15, não a emissão 2026-06-10) + duplicata=NRONF',
      strTit.length === 1 && strTit[0].dtvenc === '2026-06-15' && strTit[0].duplicata === 'STR001',
      { dtvenc: strTit[0]?.dtvenc, duplicata: strTit[0]?.duplicata });
    check('4c: OBS do RESIDUAL ST byte-a-byte (vírgula decimal, formato do legado)',
      strTit.length === 1 && strTit[0].obs === obsEsperada,
      { obs: strTit[0]?.obs, esperada: obsEsperada });

    // 54.3) ICMS_ST_PAGO_FONTE abate o residual (100 − 30 = 70).
    const nfSt2 = await novaNf(baseNf({ tipo: 'E', nronf: 'STR002', codparceiro: 22, dtemissao: '2026-06-16', dtcontabil: '2026-06-16', total_icmst_externo: 100, icms_st_pago_fonte: 30, itens: [itemP1(4)] }));
    const nfSt2Read = (await (await fetch(`${base}/fiscal/nf/${nfSt2}`, { headers: H })).json()) as any;
    await fetch(`${base}/fiscal/nf/${nfSt2}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-16', intervaloDias: 30 }) });
    const strTit2 = await stResidualDaNf(nfSt2);
    check('4c: icms_st_pago_fonte abate o residual (externo 100 − pago 30 = 70)', Number(nfSt2Read.icms_st_apagar) === 70 && strTit2.length === 1 && Number(strTit2[0].valor) === 70, { icms_st_apagar: nfSt2Read.icms_st_apagar, strTit2 });

    // 54.4) sem ST externo → 0 títulos RESIDUAL ST (gate `if TOTALICM_STEXTERNO>0`).
    const nfSt3 = await novaNf(baseNf({ tipo: 'E', nronf: 'STR003', codparceiro: 22, dtemissao: '2026-06-17', dtcontabil: '2026-06-17', itens: [itemP1(4)] }));
    await fetch(`${base}/fiscal/nf/${nfSt3}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-17', intervaloDias: 30 }) });
    const strTit3 = await stResidualDaNf(nfSt3);
    check('4c: NF sem ST externo → 0 título RESIDUAL ST', strTit3.length === 0, { strTit3 });

    // 54.5) estornar-faturamento remove o RESIDUAL ST junto (delete por idnf).
    await fetch(`${base}/fiscal/nf/${nfStr1}/estornar-faturamento`, { method: 'POST', headers: H });
    const strTitPos = await stResidualDaNf(nfStr1);
    check('4c: estornar-faturamento remove o título RESIDUAL ST (por idnf)', strTitPos.length === 0, { strTitPos });

    // 54.6) SAÍDA com total_icmst_externo → NÃO gera RESIDUAL ST (só entrada recolhe).
    const nfStS = await novaNf(baseNf({ tipo: 'S', nronf: 'STR004', cfop: '5102', codparceiro: 20, total_icmst_externo: 50, itens: [{ codproduto: 1, quantidade: 5, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfStS}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-18', intervaloDias: 30 }) });
    const strTitS = await stResidualDaNf(nfStS);
    check('4c: SAÍDA com total_icmst_externo → 0 RESIDUAL ST (só entrada recolhe)', strTitS.length === 0, { strTitS });

    // 54.7) PUT parcial que NÃO reenvia os inputs de ST NÃO pode zerar o icms_st_apagar persistido.
    const nfStrPut = await novaNf(baseNf({ tipo: 'E', nronf: 'STR005', codparceiro: 22, dtemissao: '2026-06-20', dtcontabil: '2026-06-20', total_icmst_externo: 200, itens: [itemP1(4)] }));
    const putParcial = await fetch(`${base}/fiscal/nf/${nfStrPut}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'edicao parcial' }) });
    const nfStrPutRead = (await (await fetch(`${base}/fiscal/nf/${nfStrPut}`, { headers: H })).json()) as any;
    check('4c: PUT parcial (só obs) preserva icms_st_apagar (200) — não zera o derivado',
      (putParcial.status === 200 || putParcial.status === 204) && Number(nfStrPutRead.icms_st_apagar) === 200,
      { status: putParcial.status, icms_st_apagar: nfStrPutRead.icms_st_apagar });

    // 55) corte-4c-b — RETENÇÃO FEDERAL (PIS/COFINS/CSLL/IR/INSS/ISSQN/FUNRURAL) → títulos A Pagar ao ÓRGÃO,
    // abatendo o título do fornecedor (líquido). Config default OFF; ligamos PIS+INSS p/ o teste (órgão=parceiro 20).
    const pgRet = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    await pgRet.query(`UPDATE configuracoes SET valor='20' WHERE codigo='PARCEIRO_RETENCAO_PISCOFINS_CSLL'`);
    await pgRet.query(`UPDATE configuracoes SET valor='21' WHERE codigo='DIA_VENCIMENTO_RET_PIS'`);
    await pgRet.query(`UPDATE configuracoes SET valor='20' WHERE codigo='PARCEIRO_RETENCAO_INSS'`);
    await pgRet.query(`UPDATE configuracoes SET valor='21' WHERE codigo='DIA_VENCIMENTO_RET_INSS'`);
    const apagarDaNf = async (cod: number): Promise<any[]> =>
      (await pgRet.query(`SELECT codparceiro, valor, tipodoc, retencao, origem, gerado, duplicata, to_char(dtvenc,'YYYY-MM-DD') AS dtvenc, obs FROM apagar WHERE idnf=$1 ORDER BY retencao NULLS FIRST, valor`, [cod])).rows;

    // NF entrada de serviço E03 (idsituacao_nf 1031, seed da 039) com retenções JÁ calculadas: PIS 10 + INSS 110
    // = 120 retidos. Item 40×3,50 = 140 (totalnf). Fornecedor=22; órgão=20. Líquido ao fornecedor = 140 − 120 = 20.
    const nfRet = await novaNf(baseNf({ tipo: 'E', nronf: 'RET001', codparceiro: 22, idsituacao_nf: 1031, dtemissao: '2026-06-10', dtcontabil: '2026-06-15', total_ret_pis: 10, total_ret_inss: 110, total_ret_cofins: 5, itens: [itemP1(40)] }));
    const fatRet = await fetch(`${base}/fiscal/nf/${nfRet}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const titsRet = await apagarDaNf(nfRet);
    const retPis = titsRet.find((t) => t.retencao === 'PIS');
    const retInss = titsRet.find((t) => t.retencao === 'INSS');
    const retCofins = titsRet.find((t) => t.retencao === 'COFINS');
    const forn = titsRet.filter((t) => !t.retencao);
    check('4c-b: retenção federal gera títulos ao ÓRGÃO (PIS 10 + INSS 110, codparceiro=20≠fornecedor 22, BOLETO, GERADO=SISTEMA)',
      fatRet.status === 200 && !!retPis && !!retInss
      && Number(retPis.valor) === 10 && Number(retInss.valor) === 110
      && Number(retPis.codparceiro) === 20 && Number(retInss.codparceiro) === 20
      && retPis.tipodoc === 'BOLETO' && retPis.gerado === 'SISTEMA' && retPis.origem === 'N',
      { status: fatRet.status, titsRet });
    check('4c-b: ABATE o fornecedor — título do fornecedor = líquido (140 − 120 = 20), codparceiro=22',
      forn.length === 1 && Number(forn[0].valor) === 20 && Number(forn[0].codparceiro) === 22 && !forn[0].retencao,
      { forn });
    check('4c-b: vencimento = MontarDataVencimento (dia 21 do MÊS SEGUINTE → 2026-07-21)',
      !!retPis && retPis.dtvenc === '2026-07-21',
      { dtvenc: retPis?.dtvenc });
    check('4c-b: OBS byte-a-byte com alíquota real (PIS 0,65%, vírgula decimal)',
      !!retPis && retPis.obs === 'REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: PIS\nNOTA FISCAL NRO: RET001\nVALOR NOTA FISCAL: 140,00\nALIQUOTA PIS: 0,65%',
      { obs: retPis?.obs });
    check('4c-b: imposto sem DIA_VENCIMENTO configurado (COFINS) → NÃO gera título (gate fiel)',
      !retCofins, { retCofins });

    // 55.2) estornar-faturamento remove os títulos de retenção + o do fornecedor (por idnf).
    await fetch(`${base}/fiscal/nf/${nfRet}/estornar-faturamento`, { method: 'POST', headers: H });
    const titsRetPos = await apagarDaNf(nfRet);
    check('4c-b: estornar-faturamento remove retenção + fornecedor (por idnf)', titsRetPos.length === 0, { titsRetPos });

    // 55.3) SAÍDA com total_ret_* → NÃO gera retenção (só entrada de serviço recolhe).
    const nfRetS = await novaNf(baseNf({ tipo: 'S', nronf: 'RET002', cfop: '5102', codparceiro: 20, total_ret_pis: 10, itens: [{ codproduto: 1, quantidade: 5, vrvenda: 10, cfop: '5102', aliquota: 'T01' }] }));
    await fetch(`${base}/fiscal/nf/${nfRetS}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const titsRetS = (await pgRet.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1 AND retencao IS NOT NULL`, [nfRetS])).rows[0]?.n;
    check('4c-b: SAÍDA com total_ret_* → 0 título de retenção (só entrada)', Number(titsRetS) === 0, { titsRetS });

    // 55.4) gate E03 no FATURAMENTO: total_ret_* órfão numa NF que NÃO é E03 (sem idsituacao_nf) → NÃO gera
    // (o snapshot pode estar velho; SituacaoGeraRetencao re-checado). FUNRURAL é exceção (gate por CFOP).
    const nfRetNaoE03 = await novaNf(baseNf({ tipo: 'E', nronf: 'RET003', codparceiro: 22, dtcontabil: '2026-06-15', total_ret_pis: 10, itens: [itemP1(40)] }));
    await fetch(`${base}/fiscal/nf/${nfRetNaoE03}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const titsN = (await pgRet.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1 AND retencao='PIS'`, [nfRetNaoE03])).rows[0]?.n;
    check('4c-b: gate E03 — PIS órfão em NF não-E03 → 0 título (SituacaoGeraRetencao re-checado no faturamento)', Number(titsN) === 0, { titsN });

    // 55.5) resíduo (e) — SNAPSHOT da alíquota (perc_aliquota_ret_*): a OBS usa a % gravada no F2, NÃO a config
    // relida no F4. Prova o drift: snapshot 0,99% ≠ config ALIQUOTA_RETENCAO_PIS (0,65%). Antes do corte a OBS
    // mostraria 0,65 (config); agora mostra 0,99 (snapshot congelado). Config PARCEIRO/DIA já ligados no §55.
    const nfSnap = await novaNf(baseNf({ tipo: 'E', nronf: 'RET004', codparceiro: 22, idsituacao_nf: 1031, dtemissao: '2026-06-10', dtcontabil: '2026-06-15', total_ret_pis: 10, perc_aliquota_ret_pis: 0.99, itens: [itemP1(40)] }));
    await fetch(`${base}/fiscal/nf/${nfSnap}/faturar`, { method: 'POST', headers: H, body: JSON.stringify({ numParcelas: 1, primeiroVencimento: '2026-07-10', intervaloDias: 30 }) });
    const titSnap = (await apagarDaNf(nfSnap)).find((t) => t.retencao === 'PIS');
    check('4c-b/(e): OBS usa a alíquota SNAPSHOT do F2 (0,99%), não a config relida no F4 (0,65%) — fecha o drift',
      !!titSnap && titSnap.obs === 'REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: PIS\nNOTA FISCAL NRO: RET004\nVALOR NOTA FISCAL: 140,00\nALIQUOTA PIS: 0,99%',
      { obs: titSnap?.obs });
    await pgRet.end();

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

    // 47) AJUSTE DE ESTOQUE (FRMAJUSTEESTOQUE) — move o saldo de estoque + kardex; sem contábil.
    const pgAj = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const AJ = 'cadastro/ajuste-estoque', MOT = 'cadastro/motivos-operacao';
    const saldoDe = async (idproduto: number) => Number((await pgAj.query(`SELECT qtde FROM estoque WHERE idproduto=$1 AND idempresa=1`, [idproduto])).rows[0]?.qtde);
    const kardexAj = async (idproduto: number) => (await pgAj.query(`SELECT tipo, qtde, saldo_anterior, saldo_novo, origem FROM historico_prod WHERE idproduto=$1 AND origem='AJUSTE' ORDER BY codmov DESC`, [idproduto])).rows as any[];
    const ajustar = async (body: Record<string, unknown>) => fetch(`${base}/${AJ}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const PRD = 1; // produto do seed

    // 47.1) SUBSTITUIR 100 → saldo=100 (baseline) + kardex + ajuste registra qtdeanterior/qtdeatual.
    const aj1 = await ajustar({ idproduto: PRD, operacao: 'SUBSTITUIR', qtde: 100, codmotivo: 1 });
    const aj1J = (await aj1.json().catch(() => ({}))) as any;
    check('AJUSTE: SUBSTITUIR 100 → saldo=100 + qtdeatual=100 + kardex(origem AJUSTE)',
      aj1.status === 200 && (await saldoDe(PRD)) === 100 && Number(aj1J.qtdeatual) === 100 && (await kardexAj(PRD))[0]?.origem === 'AJUSTE' && Number((await kardexAj(PRD))[0]?.saldo_novo) === 100,
      { status: aj1.status, body: aj1J, saldo: await saldoDe(PRD) });
    // 47.2) AUMENTAR 10 → saldo=110.
    const aj2 = await ajustar({ idproduto: PRD, operacao: 'AUMENTAR', qtde: 10, codmotivo: 1 });
    const aj2J = (await aj2.json().catch(() => ({}))) as any;
    check('AJUSTE: AUMENTAR 10 → saldo=110', aj2.status === 200 && (await saldoDe(PRD)) === 110 && Number(aj2J.qtdeanterior) === 100 && Number(aj2J.qtdeatual) === 110, { saldo: await saldoDe(PRD) });
    // 47.3) DIMINUIR 30 → saldo=80.
    const aj3 = await ajustar({ idproduto: PRD, operacao: 'DIMINUIR', qtde: 30, codmotivo: 2 });
    const aj3J = (await aj3.json().catch(() => ({}))) as any;
    check('AJUSTE: DIMINUIR 30 → saldo=80', aj3.status === 200 && (await saldoDe(PRD)) === 80, { saldo: await saldoDe(PRD) });
    // 47.4) estornar o DIMINUIR-30 (saldo atual=80=qtdeatual) → saldo volta a 110 + estornado.
    const aj5 = await fetch(`${base}/${AJ}/${aj3J.codajuste}/estornar`, { method: 'POST', headers: H });
    check('AJUSTE: estornar reverte o saldo (80→110) + estornado=S', aj5.status === 200 && (await saldoDe(PRD)) === 110 && (await pgAj.query(`SELECT estornado FROM ajuste_estoque WHERE codajuste=$1`, [aj3J.codajuste])).rows[0]?.estornado === 'S', { status: aj5.status, saldo: await saldoDe(PRD) });
    // 47.5) estornar 2x → 422 AJUSTE_JA_ESTORNADO.
    const aj6 = await fetch(`${base}/${AJ}/${aj3J.codajuste}/estornar`, { method: 'POST', headers: H });
    check('AJUSTE: estornar 2x → 422 AJUSTE_JA_ESTORNADO', aj6.status === 422 && ((await aj6.json().catch(() => ({}))) as any).code === 'AJUSTE_JA_ESTORNADO', { status: aj6.status });
    // 47.6) estornar o SUBSTITUIR-100 (qtdeatual=100 ≠ saldo atual 110) → 422 AJUSTE_ESTORNO_SALDO_MUDOU.
    const aj7 = await fetch(`${base}/${AJ}/${aj1J.codajuste}/estornar`, { method: 'POST', headers: H });
    check('AJUSTE: estornar com saldo mudado → 422 AJUSTE_ESTORNO_SALDO_MUDOU', aj7.status === 422 && ((await aj7.json().catch(() => ({}))) as any).code === 'AJUSTE_ESTORNO_SALDO_MUDOU', { status: aj7.status });
    // 47.7) saldo NEGATIVO é PERMITIDO (fiel ao legado): DIMINUIR 200 (saldo 110 → −90) → 200.
    const aj8n = await ajustar({ idproduto: PRD, operacao: 'DIMINUIR', qtde: 200, codmotivo: 2 });
    check('AJUSTE: saldo negativo é PERMITIDO (DIMINUIR 200 → −90, fiel ao legado)', aj8n.status === 200 && (await saldoDe(PRD)) === -90, { status: aj8n.status, saldo: await saldoDe(PRD) });
    // 47.8) SUBSTITUIR 0 (zerar o saldo) → 200, saldo=0.
    const aj0 = await ajustar({ idproduto: PRD, operacao: 'SUBSTITUIR', qtde: 0, codmotivo: 1 });
    check('AJUSTE: SUBSTITUIR 0 zera o saldo (−90 → 0)', aj0.status === 200 && (await saldoDe(PRD)) === 0, { status: aj0.status, saldo: await saldoDe(PRD) });
    // 47.9) produto inexistente → 422; motivo inexistente → 422.
    const aj9p = await ajustar({ idproduto: 999999, operacao: 'AUMENTAR', qtde: 1, codmotivo: 1 });
    const aj9m = await ajustar({ idproduto: PRD, operacao: 'AUMENTAR', qtde: 1, codmotivo: 99999 });
    check('AJUSTE: produto inexistente → 422 PRODUTO_NAO_ENCONTRADO; motivo inexistente → 422 MOTIVO_NAO_ENCONTRADO',
      aj9p.status === 422 && ((await aj9p.json().catch(() => ({}))) as any).code === 'PRODUTO_NAO_ENCONTRADO'
      && aj9m.status === 422 && ((await aj9m.json().catch(() => ({}))) as any).code === 'MOTIVO_NAO_ENCONTRADO',
      { prod: aj9p.status, mot: aj9m.status });
    // 47.10) validação: sem motivo → 400; AUMENTAR qtde 0 → 400 (mover 0 é no-op).
    const aj10a = await ajustar({ idproduto: PRD, operacao: 'AUMENTAR', qtde: 5 });
    const aj10b = await ajustar({ idproduto: PRD, operacao: 'AUMENTAR', qtde: 0, codmotivo: 1 });
    check('AJUSTE: sem motivo → 400; AUMENTAR qtde 0 → 400', aj10a.status === 400 && aj10b.status === 400, { semMotivo: aj10a.status, qtdeZero: aj10b.status });
    // 47.11) RBAC sem grant → 403.
    const aj11 = await fetch(`${base}/${AJ}`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ idproduto: PRD, operacao: 'AUMENTAR', qtde: 1, codmotivo: 1 }) });
    check('AJUSTE: POST sem grant RBAC → 403', aj11.status === 403, { status: aj11.status });
    // 47.11) MOTIVOS_OPERACAO (lookup): GET lista traz o seed; POST cria; DELETE soft.
    const motList = (await (await fetch(`${base}/${MOT}`, { headers: H })).json().catch(() => [])) as any[];
    const motNovo = await fetch(`${base}/${MOT}`, { method: 'POST', headers: H, body: JSON.stringify({ descricao: 'MOTIVO TESTE', tipo_operacao: 'AJUSTE' }) });
    const motNovoId = Number(((await motNovo.json().catch(() => ({}))) as any).codmotivoop);
    const motDel = await fetch(`${base}/${MOT}/${motNovoId}`, { method: 'DELETE', headers: H });
    check('AJUSTE: motivos-operacao lista(seed ≥6)+cria(201)+DELETE soft(204)', motList.length >= 6 && motNovo.status === 201 && motDel.status === 204, { n: motList.length, novo: motNovo.status, del: motDel.status });
    await pgAj.end();

    // 48) PEDIDO DE COMPRA (FRMPEDIDOCOMPRA) — a MAIOR tela: agregado header+itens (sem efeitos) + workflow FECHADO.
    const pgPed = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const PED = 'compras/pedidos';
    const crPed = async (body: Record<string, unknown>, headers = H) => fetch(`${base}/${PED}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const itensBase = [
      { idproduto: 1, fatorembalagem: 10, vrcusto: 5 },   // vlrembalagem 50
      { idproduto: 2, fatorembalagem: 3, vrcusto: 2.5 },  // vlrembalagem 7,5
    ];

    // 48.1) criar (fornecedor 22 FRN='S', 2 itens) → 201; VLREMBALAGEM derivado (fator×custo); codoperador=7; fechado=N.
    const p1 = await crPed({ codparceiro: 22, data: '2026-07-07', itens: itensBase });
    const p1J = (await p1.json().catch(() => ({}))) as any;
    const ped1 = Number(p1J.codpedcomp);
    const it1 = (p1J.itens ?? []) as any[];
    check('PEDIDO: criar (forn 22, 2 itens) → 201 + VLREMBALAGEM derivado (50 / 7,5) + codoperador=7 + fechado=N',
      p1.status === 201 && Number(it1[0]?.vlrembalagem) === 50 && Number(it1[1]?.vlrembalagem) === 7.5 && Number(p1J.codoperador) === 7 && (p1J.fechado ?? 'N') === 'N',
      { status: p1.status, itens: it1, op: p1J.codoperador, fechado: p1J.fechado });

    // 48.2) VLREMBALAGEM é server-authoritative: valor forjado no payload é ignorado (fator 4 × custo 3 = 12).
    const p2 = await crPed({ codparceiro: 22, data: '2026-07-07', itens: [{ idproduto: 1, fatorembalagem: 4, vrcusto: 3, vlrembalagem: 99999 }] });
    const p2J = (await p2.json().catch(() => ({}))) as any;
    const ped2 = Number(p2J.codpedcomp);
    check('PEDIDO: VLREMBALAGEM server-authoritative (forjado 99999 → 12)', p2.status === 201 && Number(p2J.itens?.[0]?.vlrembalagem) === 12, { v: p2J.itens?.[0]?.vlrembalagem });

    // 48.3) total = Σ VLREMBALAGEM na view (o cabeçalho NÃO persiste total) + fornecedor via JOIN.
    const lista = (await (await fetch(`${base}/${PED}?campo=codpedcomp&operador=igual&valor=${ped1}`, { headers: H })).json().catch(() => [])) as any[];
    const row1 = lista.find((r) => Number(r.codpedcomp) === ped1);
    check('PEDIDO: total na view = Σ TOTALCUSTO (57,5, QTDE=1 default) + fornecedor (JOIN)', Number(row1?.total) === 57.5 && !!row1?.fornecedor, { total: row1?.total, forn: row1?.fornecedor });

    // 48.3b) 078 FLIP — QTDE>1: item qtde 3, fator 10, custo 5 → vlrembalagem=50 (custo/caixa), qtdtotal=30
    // (unidades), totalcusto=150 (=3×50). Total do pedido = 150 (Σ TOTALCUSTO), NÃO 50 (Σ VLREMBALAGEM). É o bug do golden.
    const pQt = await crPed({ codparceiro: 22, data: '2026-07-07', itens: [{ idproduto: 1, qtde: 3, fatorembalagem: 10, vrcusto: 5 }] });
    const pQtJ = (await pQt.json().catch(() => ({}))) as any;
    const pQtId = Number(pQtJ.codpedcomp);
    const pQtIt = (pQtJ.itens ?? [])[0] as any;
    const pQtRow = ((await (await fetch(`${base}/${PED}?campo=codpedcomp&operador=igual&valor=${pQtId}`, { headers: H })).json().catch(() => [])) as any[]).find((r) => Number(r.codpedcomp) === pQtId);
    check('PEDIDO 078 FLIP: QTDE=3 → vlrembalagem 50 + qtdtotal 30 + totalcusto 150; total do pedido = 150 (Σ TOTALCUSTO, não 50)',
      pQt.status === 201 && Number(pQtIt?.vlrembalagem) === 50 && Number(pQtIt?.qtde) === 3 && Number(pQtIt?.qtdtotal) === 30 && Number(pQtIt?.totalcusto) === 150 && Number(pQtRow?.total) === 150,
      { item: pQtIt, total: pQtRow?.total });

    // 48.4) fornecedor não-FRN (parceiro 20) → 422 PEDIDO_FORNECEDOR_INVALIDO.
    const p4 = await crPed({ codparceiro: 20, data: '2026-07-07', itens: itensBase });
    check('PEDIDO: fornecedor não-FRN (20) → 422 PEDIDO_FORNECEDOR_INVALIDO', p4.status === 422 && ((await p4.json().catch(() => ({}))) as any).code === 'PEDIDO_FORNECEDOR_INVALIDO', { status: p4.status });

    // 48.5) sem itens → 400; sem fornecedor → 400 (schema).
    const p5a = await crPed({ codparceiro: 22, data: '2026-07-07', itens: [] });
    const p5b = await crPed({ data: '2026-07-07', itens: itensBase });
    check('PEDIDO: sem itens → 400; sem fornecedor → 400', p5a.status === 400 && p5b.status === 400, { semItens: p5a.status, semForn: p5b.status });

    // 48.6) editar rascunho (PUT): substitui itens → VLREMBALAGEM recomputado (fator 2 × custo 8 = 16) + obs.
    const p6 = await fetch(`${base}/${PED}/${ped1}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'editado', itens: [{ idproduto: 1, fatorembalagem: 2, vrcusto: 8 }] }) });
    const p6J = (await p6.json().catch(() => ({}))) as any;
    check('PEDIDO: editar rascunho substitui itens + VLREMBALAGEM recomputado (16) + obs', p6.status === 200 && p6J.itens?.length === 1 && Number(p6J.itens[0].vlrembalagem) === 16 && p6J.obs === 'editado', { status: p6.status, itens: p6J.itens });

    // 48.7) fechar (N→S) → 200 fechado=S.
    const p7 = await fetch(`${base}/${PED}/${ped1}/fechar`, { method: 'POST', headers: H });
    check('PEDIDO: fechar (N→S) → 200 fechado=S', p7.status === 200 && ((await p7.json().catch(() => ({}))) as any).fechado === 'S', { status: p7.status });

    // 48.8) editar/excluir pedido FECHADO → 422 PEDIDO_FECHADO.
    const p8a = await fetch(`${base}/${PED}/${ped1}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'x' }) });
    const p8b = await fetch(`${base}/${PED}/${ped1}`, { method: 'DELETE', headers: H });
    check('PEDIDO: editar/excluir FECHADO → 422 PEDIDO_FECHADO', p8a.status === 422 && ((await p8a.json().catch(() => ({}))) as any).code === 'PEDIDO_FECHADO' && p8b.status === 422, { put: p8a.status, del: p8b.status });

    // 48.9) fechar 2x → 422 PEDIDO_JA_FECHADO.
    const p9 = await fetch(`${base}/${PED}/${ped1}/fechar`, { method: 'POST', headers: H });
    check('PEDIDO: fechar 2x → 422 PEDIDO_JA_FECHADO', p9.status === 422 && ((await p9.json().catch(() => ({}))) as any).code === 'PEDIDO_JA_FECHADO', { status: p9.status });

    // 48.10) reabrir (S→N) → 200 + editar volta a funcionar.
    const p10 = await fetch(`${base}/${PED}/${ped1}/reabrir`, { method: 'POST', headers: H });
    const p10e = await fetch(`${base}/${PED}/${ped1}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'reaberto' }) });
    check('PEDIDO: reabrir (S→N) → 200 + editar volta a funcionar', p10.status === 200 && p10e.status === 200 && ((await p10e.json().catch(() => ({}))) as any).obs === 'reaberto', { reabrir: p10.status, put: p10e.status });

    // 48.11) reabrir um NÃO-fechado → 422 PEDIDO_NAO_FECHADO.
    const p11 = await fetch(`${base}/${PED}/${ped1}/reabrir`, { method: 'POST', headers: H });
    check('PEDIDO: reabrir não-fechado → 422 PEDIDO_NAO_FECHADO', p11.status === 422 && ((await p11.json().catch(() => ({}))) as any).code === 'PEDIDO_NAO_FECHADO', { status: p11.status });

    // 48.12) fechar SEM itens → 422 PEDIDO_SEM_ITENS (esvazia via PUT itens:[] e tenta fechar).
    const p12v = await fetch(`${base}/${PED}/${ped1}`, { method: 'PUT', headers: H, body: JSON.stringify({ itens: [] }) });
    const p12 = await fetch(`${base}/${PED}/${ped1}/fechar`, { method: 'POST', headers: H });
    check('PEDIDO: fechar sem itens → 422 PEDIDO_SEM_ITENS', p12v.status === 200 && p12.status === 422 && ((await p12.json().catch(() => ({}))) as any).code === 'PEDIDO_SEM_ITENS', { esvazia: p12v.status, fechar: p12.status });

    // 48.13) excluir rascunho → 204 (soft-delete INDR='E') + some da lista.
    const p13 = await fetch(`${base}/${PED}/${ped1}`, { method: 'DELETE', headers: H });
    const indr13 = (await pgPed.query(`SELECT indr FROM pedidocompra WHERE codpedcomp=$1`, [ped1])).rows[0]?.indr;
    const listaPos = (await (await fetch(`${base}/${PED}?campo=codpedcomp&operador=igual&valor=${ped1}`, { headers: H })).json().catch(() => [])) as any[];
    check('PEDIDO: excluir rascunho → 204 soft-delete (INDR=E) + some da lista', p13.status === 204 && indr13 === 'E' && !listaPos.find((r) => Number(r.codpedcomp) === ped1), { del: p13.status, indr: indr13 });

    // 48.13b) editar pedido EXCLUÍDO (soft-delete) → 422 PEDIDO_NAO_ENCONTRADO (anti-ressurreição de estado).
    const p13b = await fetch(`${base}/${PED}/${ped1}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'zumbi' }) });
    check('PEDIDO: editar pedido excluído → 422 PEDIDO_NAO_ENCONTRADO', p13b.status === 422 && ((await p13b.json().catch(() => ({}))) as any).code === 'PEDIDO_NAO_ENCONTRADO', { status: p13b.status });

    // 48.14) RBAC: criar sem grant → 403; fechar sem grant → 403.
    const p14a = await crPed({ codparceiro: 22, data: '2026-07-07', itens: itensBase }, H_SEM_ACESSO);
    const p14b = await fetch(`${base}/${PED}/${ped2}/fechar`, { method: 'POST', headers: H_SEM_ACESSO });
    check('PEDIDO: criar/fechar sem grant RBAC → 403', p14a.status === 403 && p14b.status === 403, { criar: p14a.status, fechar: p14b.status });

    // 48.15) multi-tenant: pedido da empresa 1 não é lido pela empresa 2.
    const p15 = await fetch(`${base}/${PED}/${ped2}`, { headers: { ...H, 'x-empresa-id': '2' } });
    const p15B = await p15.json().catch(() => null);
    check('PEDIDO: multi-tenant — pedido da emp 1 não é lido pela emp 2', p15.status === 404 || p15B == null, { status: p15.status, body: p15B });

    // 48.16) teto de quantidade (evita overflow de VLREMBALAGEM): fatorembalagem absurdo → 400.
    const p16 = await crPed({ codparceiro: 22, data: '2026-07-07', itens: [{ idproduto: 1, fatorembalagem: 99_999_999, vrcusto: 5 }] });
    check('PEDIDO: quantidade acima do teto → 400 (bound anti-overflow)', p16.status === 400, { status: p16.status });

    // 48.17) guarda de FATURAMENTO (coerente com o reabrir): pedido faturado é read-only na edição E exclusão.
    // dtfaturamento vem da NF de entrada (corte futuro) — aqui simulado por DML no PG de TESTE (descartável).
    await pgPed.query(`UPDATE pedidocompra SET dtfaturamento=now() WHERE codpedcomp=$1`, [ped2]);
    const p17e = await fetch(`${base}/${PED}/${ped2}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'x' }) });
    const p17d = await fetch(`${base}/${PED}/${ped2}`, { method: 'DELETE', headers: H });
    check('PEDIDO: faturado (dtfaturamento) → editar/excluir 422 PEDIDO_FATURADO', p17e.status === 422 && ((await p17e.json().catch(() => ({}))) as any).code === 'PEDIDO_FATURADO' && p17d.status === 422, { put: p17e.status, del: p17d.status });

    await pgPed.end();

    // 49) RECEBIMENTO — gerar NF de entrada a partir do pedido (delega o FATO ao F3/F4 da NF).
    const pgRec = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const gerarNf = async (id: number, body: Record<string, unknown> = {}, headers = H) =>
      fetch(`${base}/${PED}/${id}/gerar-nf`, { method: 'POST', headers, body: JSON.stringify(body) });
    const estoqueDe = async (idproduto: number) =>
      Number((await pgRec.query(`SELECT qtde FROM estoque WHERE idproduto=$1 AND idempresa=1`, [idproduto])).rows[0]?.qtde ?? 0);

    const rp = await crPed({ codparceiro: 22, data: '2026-07-08', itens: [{ idproduto: 1, fatorembalagem: 10, vrcusto: 5 }, { idproduto: 2, fatorembalagem: 3, vrcusto: 2.5 }] });
    const rpId = Number(((await rp.json().catch(() => ({}))) as any).codpedcomp);

    // 49.1) gerar-nf de pedido RASCUNHO (não fechado) → 422 PEDIDO_NAO_FECHADO.
    const r1 = await gerarNf(rpId);
    check('RECEB: gerar-nf de rascunho → 422 PEDIDO_NAO_FECHADO', r1.status === 422 && ((await r1.json().catch(() => ({}))) as any).code === 'PEDIDO_NAO_FECHADO', { status: r1.status });

    await fetch(`${base}/${PED}/${rpId}/fechar`, { method: 'POST', headers: H });
    // 49.2) gerar-nf do pedido FECHADO → 200 {codnf}; NF tipo=E, vinculada, terceiros modelo 1.
    const r2 = await gerarNf(rpId);
    const r2J = (await r2.json().catch(() => ({}))) as any;
    const codnf = Number(r2J.codnf);
    const nfRow = (await pgRec.query(`SELECT tipo, modelo, tipoemissao, codpedcomp, codparceiro, proc FROM nf WHERE codnf=$1`, [codnf])).rows[0] as any;
    check('RECEB: gerar-nf (pedido fechado) → 200 + NF tipo=E, codpedcomp vinculado, terceiros modelo 1, proc=N',
      r2.status === 200 && codnf > 0 && nfRow?.tipo === 'E' && Number(nfRow?.codpedcomp) === rpId && nfRow?.tipoemissao === '1' && Number(nfRow?.modelo) === 1 && Number(nfRow?.codparceiro) === 22 && nfRow?.proc === 'N',
      { status: r2.status, nf: nfRow });

    // 49.3) itens mapeados: qtde=fatorembalagem, vrvenda=vrcusto, aliquota/ncm do PRODUTO.
    const nfItens = (await pgRec.query(`SELECT codproduto, quantidade, vrvenda, aliquota, ncm, cfop FROM nf_prod WHERE codnf=$1 ORDER BY nroitem`, [codnf])).rows as any[];
    check('RECEB: itens mapeados (qtde=fatorembalagem 10/3, vrvenda=vrcusto 5/2,5, NCM/aliquota DISTINTOS do produto, cfop 1102)',
      nfItens.length === 2 && Number(nfItens[0].quantidade) === 10 && Number(nfItens[0].vrvenda) === 5 && nfItens[0].aliquota === 'T01' && nfItens[0].ncm === '17019900' && nfItens[0].cfop === '1102' && Number(nfItens[1].quantidade) === 3 && Number(nfItens[1].vrvenda) === 2.5 && nfItens[1].ncm === '22021000',
      { itens: nfItens });

    // 49.3b) 078 FLIP: pedido com QTDE>1 → gerar-nf mapeia quantidade = QTDTOTAL (qtde×fator), não o fator.
    // qtde 4 × fator 6 = 24 unidades. (Antes do flip a NF traria 6, subcontando as unidades a receber.)
    const rpQ = await crPed({ codparceiro: 22, data: '2026-07-08', itens: [{ idproduto: 1, qtde: 4, fatorembalagem: 6, vrcusto: 5 }] });
    const rpQId = Number(((await rpQ.json().catch(() => ({}))) as any).codpedcomp);
    await fetch(`${base}/${PED}/${rpQId}/fechar`, { method: 'POST', headers: H });
    const rpQNf = Number(((await (await gerarNf(rpQId)).json().catch(() => ({}))) as any).codnf);
    const rpQItem = (await pgRec.query(`SELECT quantidade FROM nf_prod WHERE codnf=$1 ORDER BY nroitem LIMIT 1`, [rpQNf])).rows[0] as any;
    check('RECEB 078 FLIP: gerar-nf com QTDE>1 → quantidade da NF = QTDTOTAL (4×6=24 unidades), não o fator (6)',
      Number(rpQItem?.quantidade) === 24, { quantidade: rpQItem?.quantidade });

    // 49.4) pedido marcado RECEBIDO (dtfaturamento) → reabrir/editar bloqueados (PEDIDO_FATURADO).
    const r4r = await fetch(`${base}/${PED}/${rpId}/reabrir`, { method: 'POST', headers: H });
    const r4e = await fetch(`${base}/${PED}/${rpId}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'x' }) });
    check('RECEB: pedido recebido → reabrir/editar 422 PEDIDO_FATURADO', r4r.status === 422 && ((await r4r.json().catch(() => ({}))) as any).code === 'PEDIDO_FATURADO' && r4e.status === 422, { reabrir: r4r.status, put: r4e.status });

    // 49.5) gerar-nf 2x → 422 PEDIDO_JA_RECEBIDO; e SÓ 1 NF vinculada existe (CAS + UNIQUE ux_nf_codpedcomp).
    const r5 = await gerarNf(rpId);
    const nCount = Number((await pgRec.query(`SELECT count(*)::int AS n FROM nf WHERE codpedcomp=$1`, [rpId])).rows[0]?.n);
    check('RECEB: gerar-nf 2x → 422 PEDIDO_JA_RECEBIDO + apenas 1 NF vinculada (anti-duplo-recebimento)', r5.status === 422 && ((await r5.json().catch(() => ({}))) as any).code === 'PEDIDO_JA_RECEBIDO' && nCount === 1, { status: r5.status, nCount });

    // 49.6) RBAC: gerar-nf sem grant → 403.
    const rp6 = await crPed({ codparceiro: 22, data: '2026-07-08', itens: [{ idproduto: 1, fatorembalagem: 1, vrcusto: 1 }] });
    const rp6Id = Number(((await rp6.json().catch(() => ({}))) as any).codpedcomp);
    await fetch(`${base}/${PED}/${rp6Id}/fechar`, { method: 'POST', headers: H });
    const r6 = await gerarNf(rp6Id, {}, H_SEM_ACESSO);
    check('RECEB: gerar-nf sem grant RBAC → 403', r6.status === 403, { status: r6.status });

    // 49.7) end-to-end: processar (F3) a NF gerada MOVE o estoque (+10 / +3) — o FATO delega à NF.
    const est1a = await estoqueDe(1); const est2a = await estoqueDe(2);
    const proc = await fetch(`${base}/fiscal/nf/${codnf}/processar`, { method: 'POST', headers: H });
    const est1b = await estoqueDe(1); const est2b = await estoqueDe(2);
    check('RECEB: processar (F3) a NF gerada move estoque (+10 / +3) — FATO delegado à NF', proc.status === 200 && est1b - est1a === 10 && est2b - est2a === 3, { proc: proc.status, d1: est1b - est1a, d2: est2b - est2a });

    await pgRec.end();

    // 48P) PEDIDO corte-2 — CONDIÇÃO DE PAGAMENTO + PARCELAS.
    const COND = 'compras/condicoes-pagto';
    // 48P.1) CRUD condições: seed (161='30/60/90') existe; criar nova; CD1 obrigatório.
    const condLista = (await (await fetch(`${base}/${COND}?campo=codconpagto&operador=igual&valor=161`, { headers: H })).json().catch(() => [])) as any[];
    const cond161 = condLista.find((c) => Number(c.codconpagto) === 161);
    const condNova = await fetch(`${base}/${COND}`, { method: 'POST', headers: H, body: JSON.stringify({ descricao: '15/30', cd1: 15, cd2: 30 }) });
    const condSemCd1 = await fetch(`${base}/${COND}`, { method: 'POST', headers: H, body: JSON.stringify({ descricao: 'ruim' }) });
    check('4c-2: condicoes_pagto — seed 161 (30/60/90) + criar (15/30) 201 + CD1 obrigatório (400)',
      !!cond161 && Number(cond161.cd1) === 30 && Number(cond161.cd2) === 60 && Number(cond161.cd3) === 90
      && condNova.status === 201 && condSemCd1.status === 400,
      { cond161, nova: condNova.status, semCd1: condSemCd1.status });

    // 48P.2) gerar-parcelas pela CONDIÇÃO (161=30/60/90): total 100 → 3 parcelas, sobra na 1ª. Sem data_faturamento
    // → base = data do pedido (fallback), venc=data+CDn.
    const pcA = await crPed({ codparceiro: 22, data: '2026-07-01', codconpagto: 161, itens: [{ idproduto: 1, fatorembalagem: 10, vrcusto: 10 }] });
    const pcAId = Number(((await pcA.json().catch(() => ({}))) as any).codpedcomp);
    const genA = await fetch(`${base}/${PED}/${pcAId}/gerar-parcelas`, { method: 'POST', headers: H });
    const genAJ = (await genA.json().catch(() => ({}))) as any;
    const pcARead = (await (await fetch(`${base}/${PED}/${pcAId}`, { headers: H })).json()) as any;
    const parcA = ((pcARead.parcelas ?? []) as any[]).slice().sort((a, b) => a.parcela - b.parcela);
    const somaA = parcA.reduce((s, p) => s + Number(p.valor), 0);
    check('4c-2: gerar-parcelas pela condição 30/60/90 → 3 parcelas, sobra na 1ª (33,34/33,33/33,33), Σ=100',
      genA.status === 200 && genAJ.parcelas === 3 && parcA.length === 3
      && Number(parcA[0].valor) === 33.34 && Number(parcA[1].valor) === 33.33 && Number(parcA[2].valor) === 33.33
      && Math.abs(somaA - 100) < 0.005,
      { status: genA.status, parcA });
    check('4c-2: parcela venc = data_pedido + CDn (2026-07-31 / +60 / +90) + qtdedias 30/60/90',
      parcA.length === 3 && String(parcA[0].data).slice(0, 10) === '2026-07-31' && Number(parcA[0].qtdediasaposfaturamento) === 30
      && String(parcA[1].data).slice(0, 10) === '2026-08-30' && Number(parcA[2].qtdediasaposfaturamento) === 90,
      { datas: parcA.map((p) => String(p.data).slice(0, 10)), dias: parcA.map((p) => p.qtdediasaposfaturamento) });

    // 48P.3) CD1..CD8 do PEDIDO (override local) tem prioridade sobre a condição (7/14 → 2 parcelas de 50).
    const pcB = await crPed({ codparceiro: 22, data: '2026-07-01', codconpagto: 161, cd1: 7, cd2: 14, itens: [{ idproduto: 1, fatorembalagem: 10, vrcusto: 10 }] });
    const pcBId = Number(((await pcB.json().catch(() => ({}))) as any).codpedcomp);
    await fetch(`${base}/${PED}/${pcBId}/gerar-parcelas`, { method: 'POST', headers: H });
    const pcBRead = (await (await fetch(`${base}/${PED}/${pcBId}`, { headers: H })).json()) as any;
    const parcB = ((pcBRead.parcelas ?? []) as any[]).slice().sort((a, b) => a.parcela - b.parcela);
    check('4c-2: CD1-8 do pedido (7/14) SOBREPÕE a condição (161) → 2 parcelas de 50, venc +7/+14',
      parcB.length === 2 && Number(parcB[0].valor) === 50 && Number(parcB[1].valor) === 50
      && String(parcB[0].data).slice(0, 10) === '2026-07-08' && String(parcB[1].data).slice(0, 10) === '2026-07-15',
      { parcB });

    // 48P.4) gerar-parcelas sem condição nem CD → 422 PEDIDO_SEM_CONDICAO_PAGTO.
    const pcC = await crPed({ codparceiro: 22, data: '2026-07-01', itens: [{ idproduto: 1, fatorembalagem: 5, vrcusto: 10 }] });
    const pcCId = Number(((await pcC.json().catch(() => ({}))) as any).codpedcomp);
    const genC = await fetch(`${base}/${PED}/${pcCId}/gerar-parcelas`, { method: 'POST', headers: H });
    check('4c-2: gerar-parcelas sem condição/CD → 422 PEDIDO_SEM_CONDICAO_PAGTO', genC.status === 422 && ((await genC.json().catch(() => ({}))) as any).code === 'PEDIDO_SEM_CONDICAO_PAGTO', { status: genC.status });

    // 48P.5) parcelas EDITÁVEIS via PUT (2º detalhe) — o operador ajusta valores/datas.
    const putParc = await fetch(`${base}/${PED}/${pcAId}`, { method: 'PUT', headers: H, body: JSON.stringify({ parcelas: [{ parcela: 1, valor: 100, data: '2026-12-01', qtdediasaposfaturamento: 0 }] }) });
    const pcAread2 = (await (await fetch(`${base}/${PED}/${pcAId}`, { headers: H })).json()) as any;
    check('4c-2: parcelas editáveis via PUT (2º detalhe) → substitui (1 parcela de 100)',
      (putParc.status === 200 || putParc.status === 201) && (pcAread2.parcelas ?? []).length === 1 && Number(pcAread2.parcelas[0].valor) === 100,
      { status: putParc.status, parcelas: pcAread2.parcelas });

    // 48P.6) gerar-parcelas em pedido FECHADO → 422 PEDIDO_FECHADO (é uma edição; reabra antes).
    await fetch(`${base}/${PED}/${pcBId}/fechar`, { method: 'POST', headers: H });
    const genFech = await fetch(`${base}/${PED}/${pcBId}/gerar-parcelas`, { method: 'POST', headers: H });
    check('4c-2: gerar-parcelas em pedido FECHADO → 422 PEDIDO_FECHADO', genFech.status === 422 && ((await genFech.json().catch(() => ({}))) as any).code === 'PEDIDO_FECHADO', { status: genFech.status });

    // 48P.7) DATA_FATURAMENTO é a base do vencimento (legado DTFATURAMENTO, golden 99,2%): data_faturamento
    // (2026-07-05) ≠ data do pedido (2026-07-01) → venc = data_faturamento + CDn, NÃO data + CDn.
    const pcD = await crPed({ codparceiro: 22, data: '2026-07-01', data_faturamento: '2026-07-05', codconpagto: 41, itens: [{ idproduto: 1, fatorembalagem: 10, vrcusto: 10 }] });
    const pcDId = Number(((await pcD.json().catch(() => ({}))) as any).codpedcomp);
    await fetch(`${base}/${PED}/${pcDId}/gerar-parcelas`, { method: 'POST', headers: H });
    const pcDRead = (await (await fetch(`${base}/${PED}/${pcDId}`, { headers: H })).json()) as any;
    const parcD = ((pcDRead.parcelas ?? []) as any[]);
    check('4c-2: vencimento baseia em DATA_FATURAMENTO (2026-07-05 + 30 = 2026-08-04), não na data do pedido (2026-07-01)',
      parcD.length === 1 && String(parcD[0].data).slice(0, 10) === '2026-08-04',
      { data_pedido: '2026-07-01', data_faturamento: pcDRead.data_faturamento, venc: parcD[0]?.data });

    // 57) PEDIDO — CORTES FINAIS da tela: propagação de preço ao catálogo, limite de compra + liberação,
    // duplicar/bonificado, importar itens, gates do gravar, situação-NF.
    const pgF57 = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });

    // 57.1) PROPAGAÇÃO: item vrvenda=9,99 ≠ catálogo 4,55 → atualiza MULTI_PRECO + histórico + dtultprecoalterado.
    await pgF57.query(`INSERT INTO multi_preco (idproduto, idempresa, vrcusto, markup, vrvenda, promocao, ativo, ativo_compra)
      VALUES (1, 1, 3.5, 30, 4.55, 'N', 'S', 'S')
      ON CONFLICT (idproduto, idempresa) DO UPDATE SET vrvenda=4.55, promocao='N', dtultprecoalterado=NULL`);
    const f57PF1 = await crPed({ codparceiro: 22, data: '2026-07-01', itens: [{ idproduto: 1, fatorembalagem: 5, vrcusto: 5, vrvenda: 9.99, markup: 30 }] });
    const f57PF1Id = Number(((await f57PF1.json().catch(() => ({}))) as any).codpedcomp);
    const f57Ap1 = await fetch(`${base}/${PED}/${f57PF1Id}/atualizar-precos`, { method: 'POST', headers: H });
    const f57Ap1J = (await f57Ap1.json().catch(() => ({}))) as any;
    const f57Mp1 = (await pgF57.query(`SELECT vrvenda, dtultprecoalterado FROM multi_preco WHERE idproduto=1 AND idempresa=1`)).rows[0] as any;
    const f57H1 = (await pgF57.query(`SELECT count(*)::int AS n FROM historico_dinamico WHERE tabela='MULTI_PRECO' AND valor_chave='1' AND historico LIKE '%pedido de compra Nro: ${f57PF1Id}%'`)).rows[0] as any;
    check('FINAL: atualizar-precos propaga VRVENDA ao catálogo (4,55→9,99) + dtultprecoalterado + histórico',
      f57Ap1.status === 200 && Number(f57Ap1J.atualizados) === 1 && Number(f57Mp1?.vrvenda) === 9.99 && f57Mp1?.dtultprecoalterado != null && Number(f57H1?.n) >= 1,
      { status: f57Ap1.status, f57Ap1J, mp: f57Mp1 });

    // 57.2) idempotência (sem diferença) + gate de PROMOÇÃO (promocao='S' não sobrescreve).
    const f57Ap2 = await fetch(`${base}/${PED}/${f57PF1Id}/atualizar-precos`, { method: 'POST', headers: H });
    const f57Ap2J = (await f57Ap2.json().catch(() => ({}))) as any;
    await pgF57.query(`UPDATE multi_preco SET promocao='S' WHERE idproduto=1 AND idempresa=1`);
    const f57PF2 = await crPed({ codparceiro: 22, data: '2026-07-01', itens: [{ idproduto: 1, fatorembalagem: 2, vrcusto: 5, vrvenda: 11.5 }] });
    const f57PF2Id = Number(((await f57PF2.json().catch(() => ({}))) as any).codpedcomp);
    const f57Ap3 = await fetch(`${base}/${PED}/${f57PF2Id}/atualizar-precos`, { method: 'POST', headers: H });
    const f57Ap3J = (await f57Ap3.json().catch(() => ({}))) as any;
    const f57Mp2 = (await pgF57.query(`SELECT vrvenda FROM multi_preco WHERE idproduto=1 AND idempresa=1`)).rows[0] as any;
    await pgF57.query(`UPDATE multi_preco SET promocao='N' WHERE idproduto=1 AND idempresa=1`);
    check('FINAL: atualizar-precos é idempotente (sem_diferenca) e PULA produto em promoção (gate; preço intacto 9,99)',
      Number(f57Ap2J.atualizados) === 0 && Number(f57Ap2J.sem_diferenca) === 1
      && f57Ap3.status === 200 && Number(f57Ap3J.pulados_promocao) === 1 && Number(f57Ap3J.atualizados) === 0 && Number(f57Mp2?.vrvenda) === 9.99,
      { f57Ap2J, f57Ap3J, mp: f57Mp2 });

    // 57.3) LIMITE SEMANAL + LIBERAÇÃO + REARME (M1): limite 100; A (60, semana out/04-10) fecha; B (60, mesma
    // semana=120) → 422; liberar-limite (grant LIBERAVALORMAX) → fechar ok + operador gravado. M1: reabrir B
    // rearma o gate (flag→NULL) → fechar B volta a validar (120>100) → 422 de novo (liberação não é eterna).
    await pgF57.query(`UPDATE configuracoes SET valor='100' WHERE codigo='VALOR_MAXIMO_SEMANAL_PC'`);
    const f57MkLim = async (nro: string) => {
      const r = await crPed({ codparceiro: 22, data: '2026-10-01', data_faturamento: '2026-10-05', cd1: 2, pc_nronf_cruzamento: nro, itens: [{ idproduto: 1, fatorembalagem: 6, vrcusto: 10 }] });
      const id = Number(((await r.json().catch(() => ({}))) as any).codpedcomp);
      await fetch(`${base}/${PED}/${id}/gerar-parcelas`, { method: 'POST', headers: H });
      return id;
    };
    const f57LimA = await f57MkLim('LIM-A');
    const f57FLimA = await fetch(`${base}/${PED}/${f57LimA}/fechar`, { method: 'POST', headers: H });
    const f57LimB = await f57MkLim('LIM-B');
    const f57FLimB = await fetch(`${base}/${PED}/${f57LimB}/fechar`, { method: 'POST', headers: H });
    const f57FLimBJ = (await f57FLimB.json().catch(() => ({}))) as any;
    const f57Lib = await fetch(`${base}/${PED}/${f57LimB}/liberar-limite`, { method: 'POST', headers: H });
    const f57FLimB2 = await fetch(`${base}/${PED}/${f57LimB}/fechar`, { method: 'POST', headers: H });
    const f57LimBRow = (await pgF57.query(`SELECT operador_ult_lib_valor_max, fechado FROM pedidocompra WHERE codpedcomp=$1`, [f57LimB])).rows[0] as any;
    // M1: reabrir rearma (flag→NULL) → fechar volta a barrar.
    const f57ReabB = await fetch(`${base}/${PED}/${f57LimB}/reabrir`, { method: 'POST', headers: H });
    const f57LimBRow2 = (await pgF57.query(`SELECT operador_ult_lib_valor_max FROM pedidocompra WHERE codpedcomp=$1`, [f57LimB])).rows[0] as any;
    const f57FLimB3 = await fetch(`${base}/${PED}/${f57LimB}/fechar`, { method: 'POST', headers: H });
    const f57FLimB3J = (await f57FLimB3.json().catch(() => ({}))) as any;
    check('FINAL: limite semanal (100) — A(60) fecha; B(120) → 422; liberar → fecha; M1: reabrir rearma (flag NULL) → fechar → 422 de novo',
      f57FLimA.status === 200 && f57FLimB.status === 422 && f57FLimBJ.code === 'PEDIDO_LIMITE_EXCEDIDO'
      && f57Lib.status === 200 && f57FLimB2.status === 200 && Number(f57LimBRow?.operador_ult_lib_valor_max) === 7 && f57LimBRow?.fechado === 'S'
      && f57ReabB.status === 200 && f57LimBRow2?.operador_ult_lib_valor_max == null
      && f57FLimB3.status === 422 && f57FLimB3J.code === 'PEDIDO_LIMITE_EXCEDIDO',
      { A: f57FLimA.status, B: f57FLimB.status, lib: f57Lib.status, B2: f57FLimB2.status, reab: f57ReabB.status, flag2: f57LimBRow2?.operador_ult_lib_valor_max, B3: [f57FLimB3.status, f57FLimB3J.code] });

    // 57.3b) A1: pedido com CDs mas SEM gerar-parcelas — o fechar PROJETA o fluxo das CDs (não é burlável não
    // gerando parcelas). Semana ISOLADA (out/11-17), limite 50, total 60 → 422.
    await pgF57.query(`UPDATE configuracoes SET valor='50' WHERE codigo='VALOR_MAXIMO_SEMANAL_PC'`);
    const f57ProjR = await crPed({ codparceiro: 22, data: '2026-10-01', data_faturamento: '2026-10-14', cd1: 1, pc_nronf_cruzamento: 'PROJ', itens: [{ idproduto: 1, fatorembalagem: 6, vrcusto: 10 }] });
    const f57ProjId = Number(((await f57ProjR.json().catch(() => ({}))) as any).codpedcomp);
    const f57FProj = await fetch(`${base}/${PED}/${f57ProjId}/fechar`, { method: 'POST', headers: H }); // SEM gerar-parcelas
    const f57FProjJ = (await f57FProj.json().catch(() => ({}))) as any;
    await pgF57.query(`UPDATE configuracoes SET valor='0' WHERE codigo='VALOR_MAXIMO_SEMANAL_PC'`);
    check('FINAL A1: pedido com CDs mas SEM parcelas geradas → fechar PROJETA o fluxo → 422 (limite não burlável)',
      f57FProj.status === 422 && f57FProjJ.code === 'PEDIDO_LIMITE_EXCEDIDO',
      { status: f57FProj.status, code: f57FProjJ.code });

    // 57.3c) M8 (migration 077) — TIPO_FLUXO_CAIXA_PC EXCLUSIVO (diário xor semanal). Semanas isoladas (nov),
    // pedido total 60. Prova: modo='D' IGNORA o semanal (mesmo tripwire=1); modo='S' IGNORA o diário; modo='D'
    // com diário=1 DISPARA (o modo selecionado vale). Reseta os configs ao fim.
    const f57Xor = async (data: string, nro: string) => {
      const r = await crPed({ codparceiro: 22, data: '2026-11-01', data_faturamento: data, cd1: 1, pc_nronf_cruzamento: nro, itens: [{ idproduto: 1, fatorembalagem: 6, vrcusto: 10 }] });
      const id = Number(((await r.json().catch(() => ({}))) as any).codpedcomp);
      await fetch(`${base}/${PED}/${id}/gerar-parcelas`, { method: 'POST', headers: H });
      return fetch(`${base}/${PED}/${id}/fechar`, { method: 'POST', headers: H });
    };
    // A) modo='D', SEMANAL=1 (tripwire), DIÁRIO=0 → o semanal é ignorado → fecha OK.
    await pgF57.query(`UPDATE configuracoes SET valor='D' WHERE codigo='TIPO_FLUXO_CAIXA_PC'`);
    await pgF57.query(`UPDATE configuracoes SET valor='1' WHERE codigo='VALOR_MAXIMO_SEMANAL_PC'`);
    await pgF57.query(`UPDATE configuracoes SET valor='0' WHERE codigo='VALOR_MAXIMO_DIARIO_PC'`);
    const xorA = await f57Xor('2026-11-02', 'XOR-A');
    // B) modo='S', DIÁRIO=1 (tripwire), SEMANAL=0 → o diário é ignorado → fecha OK.
    await pgF57.query(`UPDATE configuracoes SET valor='S' WHERE codigo='TIPO_FLUXO_CAIXA_PC'`);
    await pgF57.query(`UPDATE configuracoes SET valor='1' WHERE codigo='VALOR_MAXIMO_DIARIO_PC'`);
    await pgF57.query(`UPDATE configuracoes SET valor='0' WHERE codigo='VALOR_MAXIMO_SEMANAL_PC'`);
    const xorB = await f57Xor('2026-11-09', 'XOR-B');
    // C) modo='D', DIÁRIO=1 (tripwire) → o modo selecionado DISPARA → 422.
    await pgF57.query(`UPDATE configuracoes SET valor='D' WHERE codigo='TIPO_FLUXO_CAIXA_PC'`);
    const xorC = await f57Xor('2026-11-16', 'XOR-C');
    const xorCJ = (await xorC.json().catch(() => ({}))) as any;
    // reset (modo default 'S', limites 0).
    await pgF57.query(`UPDATE configuracoes SET valor='S' WHERE codigo='TIPO_FLUXO_CAIXA_PC'`);
    await pgF57.query(`UPDATE configuracoes SET valor='0' WHERE codigo IN ('VALOR_MAXIMO_DIARIO_PC','VALOR_MAXIMO_SEMANAL_PC')`);
    check('FINAL M8: TIPO_FLUXO_CAIXA_PC exclusivo — modo D ignora o semanal (OK); modo S ignora o diário (OK); modo D c/ diário=1 dispara (422)',
      xorA.status === 200 && xorB.status === 200 && xorC.status === 422 && xorCJ.code === 'PEDIDO_LIMITE_EXCEDIDO',
      { A: xorA.status, B: xorB.status, C: [xorC.status, xorCJ.code] });

    // 57.3d) E8 c3 WIRE: liberar-limite com OVERRIDE de SUPERVISOR (login+senha) → grava o CÓDIGO DO SUPERVISOR
    // (op 8) em operador_ult_lib_valor_max, não o da sessão (op 7). Setup: op 8 c/ senha 'smoke123' + grant.
    await pgF57.query(`UPDATE operadores SET senha_hash=(SELECT senha_hash FROM operadores WHERE codoperador=7), desabilitado=NULL WHERE codoperador=8`);
    await pgF57.query(`INSERT INTO configuracoes_especificas (id, tipo, chave, valor) VALUES (104,'Usuario','8','S') ON CONFLICT (id,tipo,chave) DO UPDATE SET valor='S'`);
    const f57SupR = await crPed({ codparceiro: 22, data: '2026-12-01', data_faturamento: '2026-12-05', cd1: 1, pc_nronf_cruzamento: 'SUP-LIB', itens: [{ idproduto: 1, fatorembalagem: 6, vrcusto: 10 }] });
    const f57SupId = Number(((await f57SupR.json().catch(() => ({}))) as any).codpedcomp);
    const f57SupLib = await fetch(`${base}/${PED}/${f57SupId}/liberar-limite`, { method: 'POST', headers: H, body: JSON.stringify({ login: 'OP8', senha: 'smoke123' }) });
    const f57SupRow = (await pgF57.query(`SELECT operador_ult_lib_valor_max FROM pedidocompra WHERE codpedcomp=$1`, [f57SupId])).rows[0] as any;
    // credencial errada → 422 LIBERACAO_NAO_AUTORIZADA
    const f57SupBad = await fetch(`${base}/${PED}/${f57SupId}/liberar-limite`, { method: 'POST', headers: H, body: JSON.stringify({ login: 'OP8', senha: 'errada' }) });
    check('FINAL E8-c3 WIRE: liberar-limite c/ login+senha do supervisor (op 8) → operador_ult_lib_valor_max=8 (não a sessão 7); senha errada → 422',
      f57SupLib.status === 200 && Number(f57SupRow?.operador_ult_lib_valor_max) === 8 && f57SupBad.status === 422 && ((await f57SupBad.json().catch(() => ({}))) as any).code === 'LIBERACAO_NAO_AUTORIZADA',
      { lib: f57SupLib.status, operador: f57SupRow?.operador_ult_lib_valor_max, bad: f57SupBad.status });

    // 57.4) DUPLICAR: novo rascunho com itens clonados, sem parcelas, data de hoje.
    const f57Dup = await fetch(`${base}/${PED}/${f57PF1Id}/duplicar`, { method: 'POST', headers: H });
    const f57DupJ = (await f57Dup.json().catch(() => ({}))) as any;
    const f57DupRead = (await (await fetch(`${base}/${PED}/${Number(f57DupJ.codpedcomp)}`, { headers: H })).json()) as any;
    check('FINAL: duplicar → novo rascunho (fechado=N, bonificacao=N), itens clonados, sem parcelas',
      f57Dup.status === 200 && Number(f57DupJ.codpedcomp) !== f57PF1Id && f57DupRead.fechado === 'N' && (f57DupRead.bonificacao ?? 'N') === 'N'
      && (f57DupRead.itens ?? []).length === 1 && Number(f57DupRead.itens[0].idproduto) === 1 && (f57DupRead.parcelas ?? []).length === 0,
      { status: f57Dup.status, novo: f57DupJ.codpedcomp, itens: (f57DupRead.itens ?? []).length });

    // 57.5) BONIFICADO: espelho com BONIFICACAO='S', OBS de vínculo e itens 100% bonificados (:7033).
    const f57Bon = await fetch(`${base}/${PED}/${f57PF1Id}/gerar-bonificado`, { method: 'POST', headers: H });
    const f57BonJ = (await f57Bon.json().catch(() => ({}))) as any;
    const f57BonRead = (await (await fetch(`${base}/${PED}/${Number(f57BonJ.codpedcomp)}`, { headers: H })).json()) as any;
    check('FINAL: gerar-bonificado → espelho BONIFICACAO=S + OBS de vínculo + itens bonificacao=100',
      f57Bon.status === 200 && f57BonRead.bonificacao === 'S' && String(f57BonRead.obs ?? '').startsWith('BONIFICAÇÃO REFERENTE AO PEDIDO')
      && Number(f57BonRead.itens?.[0]?.bonificacao) === 100,
      { status: f57Bon.status, obs: f57BonRead.obs, item: f57BonRead.itens?.[0]?.bonificacao });

    // 57.6) IMPORTAR ITENS (associados por CODFOR): produto 3 associado ao forn 22 + custo do catálogo.
    await pgF57.query(`UPDATE produtos SET codfor=22 WHERE idproduto=3`);
    await pgF57.query(`INSERT INTO multi_preco (idproduto, idempresa, vrcusto, vrvenda, ativo, ativo_compra)
      VALUES (3, 1, 18, 24.3, 'S', 'S') ON CONFLICT (idproduto, idempresa) DO UPDATE SET vrcusto=18, ativo_compra='S'`);
    const f57PImp = await crPed({ codparceiro: 22, data: '2026-07-01', itens: [{ idproduto: 1, fatorembalagem: 1, vrcusto: 5 }] });
    const f57PImpId = Number(((await f57PImp.json().catch(() => ({}))) as any).codpedcomp);
    const f57Imp1 = await fetch(`${base}/${PED}/${f57PImpId}/importar-itens`, { method: 'POST', headers: H, body: JSON.stringify({ origem: 'associados' }) });
    const f57Imp1J = (await f57Imp1.json().catch(() => ({}))) as any;
    const f57PImpRead = (await (await fetch(`${base}/${PED}/${f57PImpId}`, { headers: H })).json()) as any;
    const f57It3 = (f57PImpRead.itens ?? []).find((i: any) => Number(i.idproduto) === 3);
    await pgF57.query(`UPDATE produtos SET codfor=2 WHERE idproduto=3`);
    check('FINAL: importar-itens (associados) traz o produto do fornecedor com custo do catálogo (18) e não duplica os existentes',
      f57Imp1.status === 200 && Number(f57Imp1J.importados) >= 1 && !!f57It3 && Number(f57It3.vrcusto) === 18 && Number(f57It3.fatorembalagem) >= 1,
      { status: f57Imp1.status, f57Imp1J, f57It3 });

    // 57.7) GATES do gravar: condição obrigatória (config) / prazo máx do fornecedor / pendências B.
    await pgF57.query(`UPDATE configuracoes SET valor='S' WHERE codigo='OBRIGA_INFORMAR_CONDICOES_PAGAMENTO'`);
    const f57GCond = await crPed({ codparceiro: 22, data: '2026-07-01', itens: [{ idproduto: 1, fatorembalagem: 1, vrcusto: 5 }] });
    const f57GCondJ = (await f57GCond.json().catch(() => ({}))) as any;
    await pgF57.query(`UPDATE configuracoes SET valor='N' WHERE codigo='OBRIGA_INFORMAR_CONDICOES_PAGAMENTO'`);
    await pgF57.query(`UPDATE parceiros SET qtde_dias_maximo_fp_pc=30 WHERE codparceiro=22`);
    const f57GDias = await crPed({ codparceiro: 22, data: '2026-07-01', cd1: 60, itens: [{ idproduto: 1, fatorembalagem: 1, vrcusto: 5 }] });
    const f57GDiasJ = (await f57GDias.json().catch(() => ({}))) as any;
    await pgF57.query(`UPDATE parceiros SET qtde_dias_maximo_fp_pc=NULL WHERE codparceiro=22`);
    await pgF57.query(`INSERT INTO areceber (codparceiro, codempresa, dtvenda, dtvenc, valor, quitada, consiliado) VALUES (22, 1, now(), now(), 10, 'N', 'N')`);
    await pgF57.query(`UPDATE configuracoes SET valor='B' WHERE codigo='AVISA_PENDENCIAS_FORNECEDOR'`);
    const f57GPend = await crPed({ codparceiro: 22, data: '2026-07-01', itens: [{ idproduto: 1, fatorembalagem: 1, vrcusto: 5 }] });
    const f57GPendJ = (await f57GPend.json().catch(() => ({}))) as any;
    await pgF57.query(`UPDATE configuracoes SET valor='N' WHERE codigo='AVISA_PENDENCIAS_FORNECEDOR'`);
    await pgF57.query(`DELETE FROM areceber WHERE codparceiro=22 AND valor=10 AND quitada='N'`);
    check('FINAL: gates do gravar — condição obrigatória → 422; prazo 60 > máx 30 do fornecedor → 422; pendências (B) → 422',
      f57GCond.status === 422 && f57GCondJ.code === 'PEDIDO_SEM_CONDICAO_OBRIGATORIA'
      && f57GDias.status === 422 && f57GDiasJ.code === 'PEDIDO_PRAZO_EXCEDE_FORNECEDOR'
      && f57GPend.status === 422 && f57GPendJ.code === 'PEDIDO_FORNECEDOR_PENDENCIAS',
      { cond: [f57GCond.status, f57GCondJ.code], dias: [f57GDias.status, f57GDiasJ.code], pend: [f57GPend.status, f57GPendJ.code] });

    // 57.8) SITUAÇÃO-NF: classificada no pedido (1031) é carregada à NF de entrada no gerar-nf.
    const f57PSit = await crPed({ codparceiro: 22, data: '2026-07-01', idsituacao_nf: 1031, itens: [{ idproduto: 1, fatorembalagem: 2, vrcusto: 5 }] });
    const f57PSitId = Number(((await f57PSit.json().catch(() => ({}))) as any).codpedcomp);
    await fetch(`${base}/${PED}/${f57PSitId}/fechar`, { method: 'POST', headers: H });
    const f57GnfSit = await fetch(`${base}/${PED}/${f57PSitId}/gerar-nf`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    const f57GnfSitJ = (await f57GnfSit.json().catch(() => ({}))) as any;
    const f57NfSitRow = (await pgF57.query(`SELECT idsituacao_nf FROM nf WHERE codnf=$1`, [Number(f57GnfSitJ.codnf)])).rows[0] as any;
    check('FINAL: situação-NF do pedido (1031) é carregada à NF de entrada no gerar-nf',
      f57GnfSit.status === 200 && Number(f57NfSitRow?.idsituacao_nf) === 1031,
      { status: f57GnfSit.status, nf: f57GnfSitJ.codnf, sit: f57NfSitRow?.idsituacao_nf });

    // 57.9) DATAS (ValidaDatas): vencimento/faturamento anteriores à data do pedido → 400 (schema).
    const f57GData = await crPed({ codparceiro: 22, data: '2026-07-10', dt_vencimento: '2026-07-01', itens: [{ idproduto: 1, fatorembalagem: 1, vrcusto: 5 }] });
    check('FINAL: dt_vencimento < data do pedido → 400 VALIDACAO (ValidaDatas)', f57GData.status === 400, { status: f57GData.status });

    await pgF57.end();

    // 48Q) PRECIFICAÇÃO do ITEM do pedido — o comprador forma o preço (markup/venda/margem/custo-líq/PMZ
    // armazenados no item; reuso do motor no front). Aqui só o round-trip da persistência (2º detalhe).
    // vrvenda (PRATICADO=15,90) ≠ vrvendasug (SUGERIDO=16,50) — no legado são campos distintos. margeml2 (%) + margeml2v (R$).
    const pcPrec = await crPed({ codparceiro: 22, data: '2026-07-01', itens: [
      { idproduto: 1, fatorembalagem: 10, vrcusto: 10, markup: 30, vrvenda: 15.90, vrvendasug: 16.50, margeml2: 9.68, margeml2v: 1.22, vrcustoliquido: 10, pmz: 12.2 },
    ] });
    const pcPrecId = Number(((await pcPrec.json().catch(() => ({}))) as any).codpedcomp);
    const pcPrecRead = (await (await fetch(`${base}/${PED}/${pcPrecId}`, { headers: H })).json()) as any;
    const itPrec = (pcPrecRead.itens ?? [])[0] ?? {};
    check('precificação item: persiste markup/vrvenda≠vrvendasug/margeml2(+v)/vrcustoliquido/pmz (round-trip; vlrembalagem intacto)',
      pcPrec.status === 201 && Number(itPrec.markup) === 30
      && Number(itPrec.vrvenda) === 15.9 && Number(itPrec.vrvendasug) === 16.5 // praticado ≠ sugerido
      && Number(itPrec.margeml2) === 9.68 && Number(itPrec.margeml2v) === 1.22
      && Number(itPrec.vrcustoliquido) === 10 && Number(itPrec.pmz) === 12.2
      && Number(itPrec.vlrembalagem) === 100, // vlrembalagem segue derivado (fator×custo), independente da venda
      { status: pcPrec.status, itPrec });

    // 50) RECEBIMENTO corte-2 — IMPORT do XML da NFe do fornecedor → NF de entrada VALORADA.
    const pgImp = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const IMP = 'compras/recebimento/importar-xml';
    const importar = async (xml: string, codpedcomp?: number, headers = H) =>
      fetch(`${base}/${IMP}`, { method: 'POST', headers, body: JSON.stringify({ xml, ...(codpedcomp != null ? { codpedcomp } : {}) }) });
    const CNPJ_F1 = '11222333000181'; // fornecedor 1 (COBRADOR PADRAO LTDA, FRN='S') — seed parceiros_end codend1
    const mkChave = (nnf: number, cnpj = CNPJ_F1) => montarChaveNfe({ cuf: 31, aamm: '2607', cnpj, modelo: 55, serie: 1, numero: nnf, tpEmis: 1, cnf: 12345678 });
    // NFe 4.00 mínima: 2 itens casando produtos 2 (EAN 7894900011517) e 3 (2000001000005) por EAN — EANs ÚNICOS
    // (o 7891000100103 do produto 1 é duplicado pelos testes de Produto → ambíguo de propósito). Valores reais.
    // Totais: vProd=62, vST=1,44, vNF=63,44 (= derivar: 62 − 0 + 0 + 1,44).
    const mkXml = (chave: string, nnf: number, cnpj = CNPJ_F1, ean1 = '7894900011517', cobr = '', fin = '1', cfop1 = '5102', pag = '<pag><detPag><tPag>01</tPag><vPag>63.44</vPag></detPag></pag>') => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00">
<ide><cUF>31</cUF><nNF>${nnf}</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-07-08T10:00:00-03:00</dhEmi><tpNF>0</tpNF><finNFe>${fin}</finNFe><tpAmb>2</tpAmb></ide>
<emit><CNPJ>${cnpj}</CNPJ><xNome>FORNECEDOR TESTE</xNome></emit>
<det nItem="1"><prod><cProd>FA</cProd><cEAN>${ean1}</cEAN><xProd>REFRI</xProd><NCM>22021000</NCM><CFOP>${cfop1}</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>5.00</vUnCom><vProd>50.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>50.00</vBC><pICMS>18.00</pICMS><vICMS>9.00</vICMS></ICMS00></ICMS></imposto></det>
<det nItem="2"><prod><cProd>FB</cProd><cEAN>2000001000005</cEAN><xProd>QUEIJO</xProd><NCM>04061010</NCM><CFOP>5403</CFOP><uCom>UN</uCom><qCom>4.0000</qCom><vUnCom>3.00</vUnCom><vProd>12.00</vProd></prod><imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>12.00</vBC><pICMS>18.00</pICMS><vICMS>2.16</vICMS><vBCST>20.00</vBCST><vICMSST>1.44</vICMSST></ICMS10></ICMS></imposto></det>
<total><ICMSTot><vProd>62.00</vProd><vNF>63.44</vNF><vICMS>11.16</vICMS><vBC>62.00</vBC><vST>1.44</vST><vIPI>0.00</vIPI><vDesc>0.00</vDesc><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vBCST>20.00</vBCST></ICMSTot></total>${cobr}${pag}
</infNFe></NFe><protNFe><infProt><nProt>131260000000001</nProt></infProt></protNFe></nfeProc>`;

    // 50.1) import válido standalone → 200 + NF valorada (tipo E, chave, mod 55, terceiros) + reconciliação OK.
    const nnf1 = 900001;
    const imp1 = await importar(mkXml(mkChave(nnf1), nnf1));
    const imp1J = (await imp1.json().catch(() => ({}))) as any;
    const cnfImp = Number(imp1J.codnf);
    const nfImp = (await pgImp.query(`SELECT tipo, modelo, tipoemissao, chavenfe, totalnf, codpedcomp, proc FROM nf WHERE codnf=$1`, [cnfImp])).rows[0] as any;
    check('IMPORT: XML válido → 200 + NF valorada (E, mod 55, terceiros, chave 44) + totalnf 63,44 = vNF (divergência=false)',
      imp1.status === 200 && cnfImp > 0 && nfImp?.tipo === 'E' && Number(nfImp?.modelo) === 55 && nfImp?.tipoemissao === '1' && (nfImp?.chavenfe || '').length === 44 && Number(nfImp?.totalnf) === 63.44 && imp1J.divergencia === false && Number(imp1J.itens) === 2 && nfImp?.proc === 'N',
      { status: imp1.status, body: imp1J, nf: nfImp });

    // 50.2) itens valorados com os impostos REAIS do XML + CFOP ajustado saída→entrada (5102→1102, 5403→1403).
    const itImp = (await pgImp.query(`SELECT codproduto, quantidade, vrvenda, vricm, vricmst, cfop, codprodnota FROM nf_prod WHERE codnf=$1 ORDER BY nroitem`, [cnfImp])).rows as any[];
    check('IMPORT: itens com ICMS/ST reais do XML (vricm 9,00 / vricmst 1,44) + CFOP entrada (1102/1403) + codprodnota=cProd',
      itImp.length === 2 && Number(itImp[0].codproduto) === 2 && Number(itImp[0].vricm) === 9 && itImp[0].cfop === '1102' && itImp[0].codprodnota === 'FA' && Number(itImp[1].codproduto) === 3 && Number(itImp[1].vricmst) === 1.44 && itImp[1].cfop === '1403',
      { itens: itImp });

    // 50.3) XML cru guardado em nfe_xml (vínculo por codnf + chave).
    const xmlRow = (await pgImp.query(`SELECT chavenfe, length(xml) AS n FROM nfe_xml WHERE codnf=$1`, [cnfImp])).rows[0] as any;
    check('IMPORT: XML cru guardado em nfe_xml (chave + conteúdo)', (xmlRow?.chavenfe || '').length === 44 && Number(xmlRow?.n) > 100, { xmlRow });

    // 50.4) produto não casado (EAN inexistente) → 422 NFE_PRODUTOS_NAO_CASADOS (bloqueia o import inteiro).
    const nnf2 = 900002;
    const imp4 = await importar(mkXml(mkChave(nnf2), nnf2, CNPJ_F1, '0000000000000'));
    const imp4J = (await imp4.json().catch(() => ({}))) as any;
    check('IMPORT: produto sem EAN casado → 422 NFE_PRODUTOS_NAO_CASADOS (com lista de pendências)', imp4.status === 422 && imp4J.code === 'NFE_PRODUTOS_NAO_CASADOS', { status: imp4.status, code: imp4J.code });

    // 50.5) fornecedor (CNPJ) desconhecido → 422 NFE_FORNECEDOR_NAO_ENCONTRADO.
    const nnf3 = 900003;
    const imp5 = await importar(mkXml(mkChave(nnf3, '99888777000166'), nnf3, '99888777000166'));
    check('IMPORT: CNPJ desconhecido → 422 NFE_FORNECEDOR_NAO_ENCONTRADO', imp5.status === 422 && ((await imp5.json().catch(() => ({}))) as any).code === 'NFE_FORNECEDOR_NAO_ENCONTRADO', { status: imp5.status });

    // 50.6) chave com DV inválido → 422 NF_CHAVE_INVALIDA; XML lixo → 422 NFE_XML_INVALIDO.
    const nnf4 = 900004;
    const chaveRuim = mkChave(nnf4).slice(0, 43) + (((Number(mkChave(nnf4)[43]) + 1) % 10)); // corrompe o DV
    const imp6 = await importar(mkXml(chaveRuim, nnf4));
    const imp6b = await importar('<isto não é uma nfe/>');
    check('IMPORT: chave DV inválido → 422 NF_CHAVE_INVALIDA; XML lixo → 422 NFE_XML_INVALIDO',
      imp6.status === 422 && ((await imp6.json().catch(() => ({}))) as any).code === 'NF_CHAVE_INVALIDA' && imp6b.status === 422 && ((await imp6b.json().catch(() => ({}))) as any).code === 'NFE_XML_INVALIDO',
      { chave: imp6.status, lixo: imp6b.status });

    // 50.7) reimport (mesma nronf/fornecedor) → 422 NF_DUPLICADA (dedup natural da NF).
    const imp7 = await importar(mkXml(mkChave(nnf1), nnf1));
    check('IMPORT: reimport (mesma NF) → 422 NF_DUPLICADA', imp7.status === 422 && ((await imp7.json().catch(() => ({}))) as any).code === 'NF_DUPLICADA', { status: imp7.status });

    // 50.8) vínculo ao pedido: pedido fechado (fornecedor 1) + import com codpedcomp → NF vinculada + pedido recebido.
    const ped8 = Number(((await (await crPed({ codparceiro: 1, data: '2026-07-08', itens: [{ idproduto: 1, fatorembalagem: 10, vrcusto: 5 }] })).json().catch(() => ({}))) as any).codpedcomp);
    await fetch(`${base}/${PED}/${ped8}/fechar`, { method: 'POST', headers: H });
    const nnf8 = 900008;
    const imp8 = await importar(mkXml(mkChave(nnf8), nnf8), ped8);
    const imp8J = (await imp8.json().catch(() => ({}))) as any;
    const ped8Row = (await pgImp.query(`SELECT dtfaturamento FROM pedidocompra WHERE codpedcomp=$1`, [ped8])).rows[0] as any;
    const nf8Ped = (await pgImp.query(`SELECT codpedcomp FROM nf WHERE codnf=$1`, [Number(imp8J.codnf)])).rows[0] as any;
    check('IMPORT: com codpedcomp → NF vinculada + pedido recebido (dtfaturamento)', imp8.status === 200 && Number(nf8Ped?.codpedcomp) === ped8 && ped8Row?.dtfaturamento != null, { status: imp8.status, nfPed: nf8Ped, ped: ped8Row });

    // 50.9) fornecedor do XML diverge do fornecedor do pedido → 422 NFE_FORNECEDOR_DIVERGE_PEDIDO (pedido intacto).
    const ped9 = Number(((await (await crPed({ codparceiro: 22, data: '2026-07-08', itens: [{ idproduto: 1, fatorembalagem: 1, vrcusto: 1 }] })).json().catch(() => ({}))) as any).codpedcomp);
    await fetch(`${base}/${PED}/${ped9}/fechar`, { method: 'POST', headers: H });
    const nnf9 = 900009;
    const imp9 = await importar(mkXml(mkChave(nnf9), nnf9), ped9); // XML fornecedor 1 ≠ pedido fornecedor 22
    const ped9Row = (await pgImp.query(`SELECT dtfaturamento FROM pedidocompra WHERE codpedcomp=$1`, [ped9])).rows[0] as any;
    check('IMPORT: fornecedor XML ≠ pedido → 422 NFE_FORNECEDOR_DIVERGE_PEDIDO (pedido não marcado)', imp9.status === 422 && ((await imp9.json().catch(() => ({}))) as any).code === 'NFE_FORNECEDOR_DIVERGE_PEDIDO' && ped9Row?.dtfaturamento == null, { status: imp9.status, ped: ped9Row });

    // 50.10) RBAC sem grant → 403.
    const nnf10 = 900010;
    const imp10 = await importar(mkXml(mkChave(nnf10), nnf10), undefined, H_SEM_ACESSO);
    check('IMPORT: sem grant RBAC → 403', imp10.status === 403, { status: imp10.status });

    // 50.11) end-to-end: processar (F3) a NF importada move o estoque (produto 2 +10 / produto 3 +4) — FATO delega à NF.
    const estDe = async (id: number) => Number((await pgImp.query(`SELECT qtde FROM estoque WHERE idproduto=$1 AND idempresa=1`, [id])).rows[0]?.qtde ?? 0);
    const e1a = await estDe(2); const e2a = await estDe(3);
    const procImp = await fetch(`${base}/fiscal/nf/${cnfImp}/processar`, { method: 'POST', headers: H });
    const e1b = await estDe(2); const e2b = await estDe(3);
    check('IMPORT: processar (F3) a NF importada move estoque (prod 2 +10 / prod 3 +4) — FATO delegado à NF', procImp.status === 200 && e1b - e1a === 10 && e2b - e2a === 4, { proc: procImp.status, d1: e1b - e1a, d2: e2b - e2a });

    // 51) DE-PARA de fornecedor (CODREFERENCIA_FOR) — resolve pendências do import por vínculo (corte-3).
    const vincular = async (body: Record<string, unknown>, headers = H) =>
      fetch(`${base}/compras/recebimento/vincular-produto`, { method: 'POST', headers, body: JSON.stringify(body) });
    const EAN_DESC = '7899999999994'; // EAN que não casa nenhum produto → item bloqueia até vincular
    const nnfDp = 900051;
    const xmlDp = mkXml(mkChave(nnfDp), nnfDp, CNPJ_F1, EAN_DESC); // item1 EAN desconhecido (bloqueia); item2 produto 3 (casa)

    // 51.1) import com item não-casado → 422 + o ENVELOPE carrega detalhe.itens (pendências) + detalhe.codparceiro.
    const dp1 = await importar(xmlDp);
    const dp1J = (await dp1.json().catch(() => ({}))) as any;
    check('DE-PARA: import com item não-casado → 422 + detalhe.itens (pendência) + detalhe.codparceiro=1',
      dp1.status === 422 && dp1J.code === 'NFE_PRODUTOS_NAO_CASADOS' && Array.isArray(dp1J.detalhe?.itens) && dp1J.detalhe.itens.length === 1 && dp1J.detalhe.itens[0].cEAN === EAN_DESC && Number(dp1J.detalhe.codparceiro) === 1,
      { status: dp1.status, detalhe: dp1J.detalhe });

    // 51.2) vincular (E+P) o código do fornecedor → produto 2; reimporta o MESMO XML → agora casa via de-para.
    const dp2v = await vincular({ codfor: 1, vinculos: [{ idproduto: 2, cEAN: EAN_DESC, cProd: 'FA' }] });
    const dp2vJ = (await dp2v.json().catch(() => ({}))) as any;
    const dp2 = await importar(xmlDp);
    const dp2J = (await dp2.json().catch(() => ({}))) as any;
    const dpItem1 = (await pgImp.query(`SELECT codproduto FROM nf_prod WHERE codnf=$1 ORDER BY nroitem LIMIT 1`, [Number(dp2J.codnf)])).rows[0] as any;
    check('DE-PARA: vincular (2 registros E+P) → reimporta casa via de-para (item1→produto 2)',
      dp2v.status === 200 && Number(dp2vJ.gravados) === 2 && dp2.status === 200 && Number(dpItem1?.codproduto) === 2,
      { vinc: dp2v.status, gravados: dp2vJ.gravados, imp: dp2.status, item1: dpItem1 });

    // 51.3) upsert idempotente: vincular de novo (mesma codfor,codref) → 200 (atualiza, não duplica).
    const dp3 = await vincular({ codfor: 1, vinculos: [{ idproduto: 2, cEAN: EAN_DESC }] });
    const dp3n = Number((await pgImp.query(`SELECT count(*)::int AS n FROM codreferencia_for WHERE codfor=1 AND codref=$1`, [EAN_DESC])).rows[0]?.n);
    check('DE-PARA: re-vincular (mesma codfor,codref) → upsert idempotente (200, 1 linha)', dp3.status === 200 && dp3n === 1, { status: dp3.status, n: dp3n });

    // 51.4) RBAC sem grant → 403.
    const dp4 = await vincular({ codfor: 1, vinculos: [{ idproduto: 2, cEAN: '7899999999987' }] }, H_SEM_ACESSO);
    check('DE-PARA: vincular sem grant RBAC → 403', dp4.status === 403, { status: dp4.status });

    // 51.5) fornecedor não-FRN (cliente 20) → 422; produto inexistente → 422.
    const dp5a = await vincular({ codfor: 20, vinculos: [{ idproduto: 2, cEAN: '7899999999970' }] });
    const dp5b = await vincular({ codfor: 1, vinculos: [{ idproduto: 999999, cEAN: '7899999999963' }] });
    check('DE-PARA: fornecedor não-FRN → 422 PEDIDO_FORNECEDOR_INVALIDO; produto inexistente → 422 PRODUTO_NAO_ENCONTRADO',
      dp5a.status === 422 && ((await dp5a.json().catch(() => ({}))) as any).code === 'PEDIDO_FORNECEDOR_INVALIDO' && dp5b.status === 422 && ((await dp5b.json().catch(() => ({}))) as any).code === 'PRODUTO_NAO_ENCONTRADO',
      { forn: dp5a.status, prod: dp5b.status });

    // 51.6) GTIN-14 com zero à esquerda casa o GTIN-13 do produto (strip fiel ao legado uNF.pas:12308).
    const nnfG = 900052;
    const impG = await importar(mkXml(mkChave(nnfG), nnfG, CNPJ_F1, '07894900011517')); // 14 díg → produto 2 (EAN 7894900011517)
    const impGJ = (await impG.json().catch(() => ({}))) as any;
    const gItem = (await pgImp.query(`SELECT codproduto FROM nf_prod WHERE codnf=$1 ORDER BY nroitem LIMIT 1`, [Number(impGJ.codnf)])).rows[0] as any;
    check('IMPORT: GTIN-14 com zero à esquerda casa o GTIN-13 do produto (strip fiel ao legado)', impG.status === 200 && Number(gItem?.codproduto) === 2, { status: impG.status, item: gItem });

    // 52) DUPLICATAS do XML (<cobr><dup>) → A Pagar (corte-4): 1 título por dup, valores/vencimentos reais.
    const COBR = '<cobr><fat><nFat>F900061</nFat><vOrig>63.44</vOrig><vLiq>63.44</vLiq></fat>'
      + '<dup><nDup>PARC-A</nDup><dVenc>2026-08-10</dVenc><vDup>30.00</vDup></dup>'
      + '<dup><nDup>PARC-B</nDup><dVenc>2026-09-10</dVenc><vDup>33.44</vDup></dup></cobr>';
    const nnfD1 = 900061;
    const impD1 = await importar(mkXml(mkChave(nnfD1), nnfD1, CNPJ_F1, '7894900011517', COBR));
    const impD1J = (await impD1.json().catch(() => ({}))) as any;
    const codnfD1 = Number(impD1J.codnf);
    const aps = (await pgImp.query(`SELECT valor, to_char(dtvenc,'YYYY-MM-DD') AS dtvenc, duplicata, nrodup, tipodoc, idnf FROM apagar WHERE idnf=$1 ORDER BY dtvenc`, [codnfD1])).rows as any[];
    const nfD1 = (await pgImp.query(`SELECT faturada FROM nf WHERE codnf=$1`, [codnfD1])).rows[0] as any;
    check('DUP: import c/ <cobr> gera 2 A Pagar (1 por dup, valor/venc reais, tipodoc BOLETO, idnf, faturada=S)',
      impD1.status === 200 && Number(impD1J.titulosApagar) === 2 && aps.length === 2
      && Number(aps[0].valor) === 30 && aps[0].dtvenc === '2026-08-10' && aps[0].duplicata === 'PARC-A' && Number(aps[0].nrodup) === 2 && aps[0].tipodoc === 'BOLETO'
      && Number(aps[1].valor) === 33.44 && aps[1].dtvenc === '2026-09-10' && aps[1].duplicata === 'PARC-B'
      && aps.every((a) => Number(a.idnf) === codnfD1) && nfD1?.faturada === 'S',
      { status: impD1.status, titulos: impD1J.titulosApagar, aps });

    // 52.2) à vista (sem <cobr>) → 0 títulos A Pagar (o legado só gera de <dup>; sem fallback).
    const nnfD2 = 900062;
    const impD2 = await importar(mkXml(mkChave(nnfD2), nnfD2)); // sem cobr
    const impD2J = (await impD2.json().catch(() => ({}))) as any;
    const apsD2 = Number((await pgImp.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1`, [Number(impD2J.codnf)])).rows[0]?.n);
    check('DUP: à vista (sem <cobr>) → 0 A Pagar (sem fallback)', impD2.status === 200 && Number(impD2J.titulosApagar) === 0 && apsD2 === 0, { titulos: impD2J.titulosApagar, aps: apsD2 });

    // 52.3) estornar-faturamento (F4) apaga os títulos por idnf + faturada=N (os títulos do XML são idênticos aos do F4).
    const estD = await fetch(`${base}/fiscal/nf/${codnfD1}/estornar-faturamento`, { method: 'POST', headers: H });
    const apsAfter = Number((await pgImp.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1`, [codnfD1])).rows[0]?.n);
    const nfD1b = (await pgImp.query(`SELECT faturada FROM nf WHERE codnf=$1`, [codnfD1])).rows[0] as any;
    check('DUP: estornar-faturamento apaga os títulos (idnf) + faturada=N', (estD.status === 200 || estD.status === 204) && apsAfter === 0 && nfD1b?.faturada === 'N', { status: estD.status, apsAfter });

    // 52.4) finalidade devolução (finNFe=4) COM <cobr> → NF criada mas 0 A Pagar (gate de finalidade fiel).
    const nnfD4 = 900064;
    const impD4 = await importar(mkXml(mkChave(nnfD4), nnfD4, CNPJ_F1, '7894900011517', COBR.replace('900061', '900064'), '4'));
    const impD4J = (await impD4.json().catch(() => ({}))) as any;
    const apsD4 = Number((await pgImp.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1`, [Number(impD4J.codnf)])).rows[0]?.n);
    check('DUP: devolução (finNFe=4) c/ <cobr> → NF criada, 0 A Pagar (gate de finalidade)', impD4.status === 200 && Number(impD4J.titulosApagar) === 0 && apsD4 === 0, { status: impD4.status, titulos: impD4J.titulosApagar, aps: apsD4 });

    // 52.5) resíduo (b) — REFATURAR do XML: import com auto-gate OFF (CFOP 5910→1910) + <cobr> → NF criada,
    // 0 A Pagar, XML guardado. O operador refatura (ação manual, RBAC BTNFATURAR) → regenera os títulos EXATOS
    // do <dup>. 2ª refatura → NF_JA_FATURADA (trava do F4). Refaturar à-vista (sem <cobr>) → NF_SEM_DUPLICATAS.
    const nnfR = 900065;
    const impR = await importar(mkXml(mkChave(nnfR), nnfR, CNPJ_F1, '7894900011517', COBR.replace('900061', '900065'), '1', '5910')); // 1910 não auto-gera
    const codnfR = Number(((await impR.json().catch(() => ({}))) as any).codnf);
    const apsRpre = Number((await pgImp.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1`, [codnfR])).rows[0]?.n);
    const refat1 = await fetch(`${base}/compras/recebimento/${codnfR}/refaturar-xml`, { method: 'POST', headers: H });
    const refat1J = (await refat1.json().catch(() => ({}))) as any;
    const apsR = (await pgImp.query(`SELECT valor, to_char(dtvenc,'YYYY-MM-DD') AS dtvenc, duplicata, tipodoc FROM apagar WHERE idnf=$1 ORDER BY dtvenc`, [codnfR])).rows as any[];
    const nfR = (await pgImp.query(`SELECT faturada FROM nf WHERE codnf=$1`, [codnfR])).rows[0] as any;
    check('DUP/(b): refaturar-xml regenera os títulos EXATOS do <dup> (0→2, valor 30+33,44, BOLETO, faturada=S)',
      apsRpre === 0 && refat1.status === 200 && Number(refat1J.parcelas) === 2 && apsR.length === 2
      && Number(apsR[0].valor) === 30 && apsR[0].duplicata === 'PARC-A' && Number(apsR[1].valor) === 33.44 && apsR[1].tipodoc === 'BOLETO'
      && nfR?.faturada === 'S',
      { pre: apsRpre, status: refat1.status, body: refat1J, aps: apsR });
    const refat2 = await fetch(`${base}/compras/recebimento/${codnfR}/refaturar-xml`, { method: 'POST', headers: H });
    check('DUP/(b): 2ª refatura → NF_JA_FATURADA (trava do F4 reusada)',
      refat2.status !== 200 && ((await refat2.json().catch(() => ({}))) as any).code === 'NF_JA_FATURADA', { status: refat2.status });
    const refatAv = await fetch(`${base}/compras/recebimento/${Number(impD2J.codnf)}/refaturar-xml`, { method: 'POST', headers: H });
    check('DUP/(b): refaturar à-vista (sem <cobr>) → NF_SEM_DUPLICATAS',
      refatAv.status !== 200 && ((await refatAv.json().catch(() => ({}))) as any).code === 'NF_SEM_DUPLICATAS', { status: refatAv.status });
    // 52.6) FOLD auditoria — refaturar uma NF finNFe=4 (devolução) c/ <cobr> → NF_FINALIDADE_SEM_FINANCEIRO + 0 A Pagar
    // (o gate de finalidade que o import aplica NÃO pode ser furado pelo refaturar). impD4 = finNFe=4 c/ <cobr>.
    const refatFin = await fetch(`${base}/compras/recebimento/${Number(impD4J.codnf)}/refaturar-xml`, { method: 'POST', headers: H });
    const apsFin = Number((await pgImp.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1`, [Number(impD4J.codnf)])).rows[0]?.n);
    check('DUP/(b) FOLD: refaturar NF finNFe=4 (devolução) → NF_FINALIDADE_SEM_FINANCEIRO + 0 A Pagar (gate de finalidade não furável)',
      refatFin.status !== 200 && ((await refatFin.json().catch(() => ({}))) as any).code === 'NF_FINALIDADE_SEM_FINANCEIRO' && apsFin === 0,
      { status: refatFin.status, aps: apsFin });

    // 53) corte-4b — forma de pagamento (<pag>) → NF_FORMA_PAGAMENTO + gate CFOP do A Pagar automático.
    // 53.1) o <pag> do XML (tPag=01) virou NF_FORMA_PAGAMENTO com idpgto resolvido por DESTINO=CXA.
    const fp = (await pgImp.query(`SELECT tpag, vrpgto, idpgto FROM nf_forma_pagamento WHERE codnf=$1`, [codnfD1])).rows as any[];
    check('4b: <pag> do XML → NF_FORMA_PAGAMENTO (tPag=01 → DESTINO CXA → idpgto resolvido)',
      fp.length === 1 && fp[0].tpag === '01' && Number(fp[0].vrpgto) === 63.44 && Number(fp[0].idpgto) === 1,
      { fp });

    // 53.2) gate CFOP: header CFOP 1910 (GERA_FINANCEIRO_AUTO='N') COM <cobr> → NF criada, 0 A Pagar.
    const nnfCf = 900071;
    const impCf = await importar(mkXml(mkChave(nnfCf), nnfCf, CNPJ_F1, '7894900011517', COBR.replace('900061', '900071'), '1', '5910')); // 5910→1910 ('N')
    const impCfJ = (await impCf.json().catch(() => ({}))) as any;
    const apsCf = Number((await pgImp.query(`SELECT count(*)::int AS n FROM apagar WHERE idnf=$1`, [Number(impCfJ.codnf)])).rows[0]?.n);
    const nfCf = (await pgImp.query(`SELECT cfop FROM nf WHERE codnf=$1`, [Number(impCfJ.codnf)])).rows[0] as any;
    check('4b: CFOP sem GERA_FINANCEIRO_AUTO (1910) c/ <cobr> → NF criada, 0 A Pagar (gate CFOP)',
      impCf.status === 200 && nfCf?.cfop === '1910' && Number(impCfJ.titulosApagar) === 0 && apsCf === 0,
      { status: impCf.status, cfop: nfCf?.cfop, titulos: impCfJ.titulosApagar, aps: apsCf });

    await pgImp.end();

    // 56) PRECIFICAÇÃO — motor completo (custo líquido + PMZ + margem líquida) via POST /precificacao/produto.
    // Produto seed usa aliquota T01 (ICMS efetivo conhecido no det_aliquota). custo 10, markup 30, despop 20.
    const precar = async (body: any) => {
      const r = await fetch(`${base}/precificacao/produto`, { method: 'POST', headers: H, body: JSON.stringify(body) });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
    };
    const precBaseBody = { custo: 10, margem: 30, aliquota: 'T01', uf: 'MA', pis: 1.65, cofins: 7.6, despOperacional: 20, irpj: 15, csll: 9, regime: 'atual' };
    const prec = await precar(precBaseBody);
    // custo líquido sem componentes = custo (10); PMZ e margem líquida derivam do icmEfetivo do det + saídas.
    check('precificação: /produto retorna motor completo (valorVenda + custoLiquido=10 + PMZ>custoLiq + margemLiquida + lucro)',
      (prec.status === 200 || prec.status === 201) && Number(prec.json.custoLiquido) === 10 && Number(prec.json.valorVenda) > 0
      && Number(prec.json.pmz) > Number(prec.json.custoLiquido) && typeof prec.json.margemLiquida === 'number' && typeof prec.json.lucroLiquido === 'number',
      { status: prec.status, json: prec.json });
    // custo LÍQUIDO é a BASE do preço (fold ALTA): ST=5 compõe o custo (10→15) → custoLiquido 15 E valorVenda MAIOR.
    const precSt = await precar({ ...precBaseBody, st: 5 });
    check('precificação: custo líquido é a BASE do preço (ST 5 → custoLiquido 15 + valorVenda > sem ST)',
      Number(precSt.json.custoLiquido) === 15 && Number(precSt.json.valorVenda) > Number(prec.json.valorVenda),
      { custoLiq: precSt.json.custoLiquido, vendaComSt: precSt.json.valorVenda, vendaSemSt: prec.json.valorVenda });
    // PMZ TOLERANTE (fold): saídas ≥ 100% → NÃO derruba a resposta (pmz=0, valorVenda ainda vem). Fiel ao legado.
    const precBad = await precar({ custo: 10, margem: 30, aliquota: 'T01', uf: 'MA', pis: 50, cofins: 50, despOperacional: 20, regime: 'atual' });
    check('precificação: PMZ saídas ≥ 100% → pmz=0 tolerante (valorVenda preservado, nunca 500/422)',
      (precBad.status === 200 || precBad.status === 201) && Number(precBad.json.pmz) === 0 && Number(precBad.json.valorVenda) !== 0,
      { status: precBad.status, pmz: precBad.json.pmz, venda: precBad.json.valorVenda });

    // ===== §71) OPERADORES corte-3a — AUTH (login/hash-scrypt/JWT/troca-de-senha/auditoria) =====
    const pgAuth = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    const HT = { 'content-type': 'application/json', 'x-tenant-id': 'pinheirao' }; // sem operador (o login é público)
    const authPost = async (path: string, body: unknown, extraH: Record<string, string> = {}) => {
      const r = await fetch(`${base}/auth/${path}`, { method: 'POST', headers: { ...HT, ...extraH }, body: JSON.stringify(body) });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
    };

    // 71.1) login com senha errada → 401 CREDENCIAIS_INVALIDAS (não vaza se o usuário existe).
    const aWrong = await authPost('login', { login: 'SMOKE', senha: 'errada', empresa: 1 });
    check('AUTH: login senha errada → 401 CREDENCIAIS_INVALIDAS',
      aWrong.status === 401 && aWrong.json.code === 'CREDENCIAIS_INVALIDAS', aWrong);

    // 71.2) backdoor eliminado: ADMIN/APOLLOSG (dev do legado) NÃO loga (sem hash seedado → 401).
    const aBackdoor = await authPost('login', { login: 'ADMIN', senha: 'APOLLOSG', empresa: 1 });
    check('AUTH: backdoor do legado eliminado — ADMIN/APOLLOSG → 401 (não há senha-mestra)',
      aBackdoor.status === 401 && aBackdoor.json.code === 'CREDENCIAIS_INVALIDAS', aBackdoor);

    // 71.3) login OK (SMOKE/smoke123 + empresa 1) → 200 + token + mustChangePassword=false + auditoria LOGON.
    const aOk = await authPost('login', { login: 'SMOKE', senha: 'smoke123', empresa: 1 });
    const token = aOk.json.token as string;
    const logonRow = (await pgAuth.query(`SELECT tipo, codempresa FROM operadores_acessos WHERE codoperador=7 AND tipo='LOGON' ORDER BY id DESC LIMIT 1`)).rows[0] as any;
    check('AUTH: login OK → 200 + token JWT + mustChange=false + operador + auditoria LOGON gravada',
      aOk.status === 200 && typeof token === 'string' && token.split('.').length === 3
      && aOk.json.mustChangePassword === false && Number(aOk.json.operador?.codoperador) === 7
      && logonRow?.tipo === 'LOGON' && Number(logonRow?.codempresa) === 1,
      { status: aOk.status, hasToken: !!token, must: aOk.json.mustChangePassword, logon: logonRow });

    // 71.4) o token (Bearer) É a identidade: GET /auth/me devolve o operador do JWT.
    const meR = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    const meJ = (await meR.json().catch(() => ({}))) as any;
    check('AUTH: Bearer → /auth/me devolve o operador do JWT (identidade vem do token, não de header)',
      meR.status === 200 && Number(meJ.operador?.codoperador) === 7 && Number(meJ.empresa) === 1, { status: meR.status, me: meJ });

    // 71.5) o Bearer autoriza rota protegida (op 7 tem grants) — POST cria condição de pagamento via token.
    const bearerWrite = await fetch(`${base}/compras/condicoes-pagto`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ descricao: 'AUTH VIA TOKEN', cd1: 30 }),
    });
    check('AUTH: Bearer autoriza rota protegida (RBAC lê o operador do token) → cria condição', bearerWrite.status === 201, { status: bearerWrite.status });

    // 71.6) SELEÇÃO de empresa: op 90 (AUTHTEST) tem 2 empresas → login sem empresa responde needsEmpresa + lista.
    const aNeeds = await authPost('login', { login: 'AUTHTEST', senha: 'smoke123' });
    check('AUTH: operador multi-empresa sem empresa → needsEmpresa + lista (sem token)',
      aNeeds.status === 200 && aNeeds.json.needsEmpresa === true && !aNeeds.json.token && (aNeeds.json.empresas ?? []).length === 2,
      { status: aNeeds.status, needs: aNeeds.json.needsEmpresa, empresas: (aNeeds.json.empresas ?? []).length });
    // escolhendo uma empresa fora das permitidas → 403 OPERADOR_SEM_EMPRESA.
    const aWrongEmp = await authPost('login', { login: 'AUTHTEST', senha: 'smoke123', empresa: 999 });
    check('AUTH: empresa fora das permitidas → 403 OPERADOR_SEM_EMPRESA', aWrongEmp.status === 403 && aWrongEmp.json.code === 'OPERADOR_SEM_EMPRESA', aWrongEmp);

    // 71.7) operador DESABILITADO → 403 (fixture temporária via SQL no op 90).
    await pgAuth.query(`UPDATE operadores SET desabilitado='S' WHERE codoperador=90`);
    const aDisabled = await authPost('login', { login: 'AUTHTEST', senha: 'smoke123', empresa: 1 });
    await pgAuth.query(`UPDATE operadores SET desabilitado='N' WHERE codoperador=90`);
    check('AUTH: operador desabilitado → 403 OPERADOR_DESABILITADO', aDisabled.status === 403 && aDisabled.json.code === 'OPERADOR_DESABILITADO', aDisabled);

    // 71.8) TROCA DE SENHA (fluxo do 1º acesso): força a flag no op 90, loga (mustChange=true, token `chg`),
    // o token `chg` BARRA rota protegida (fold M2), troca via Bearer, e re-loga (mustChange=false, flag zerada).
    await pgAuth.query(`UPDATE operadores SET solicitar_alteracao_senha='S' WHERE codoperador=90`);
    const aMust = await authPost('login', { login: 'AUTHTEST', senha: 'smoke123', empresa: 1 });
    const tok90 = aMust.json.token as string;
    // fold M2: o token de troca-obrigatória NÃO opera nada além de /auth/* → GET protegido = 403.
    const chgBlockedR = await fetch(`${base}/cadastro/operadores`, { headers: { authorization: `Bearer ${tok90}` } });
    const chgBlockedJ = (await chgBlockedR.json().catch(() => ({}))) as any;
    const trChangeWrong = await authPost('trocar-senha', { senhaAtual: 'ERRADA', senhaNova: 'novaSenha1', confirmacao: 'novaSenha1' }, { authorization: `Bearer ${tok90}` });
    const trChange = await authPost('trocar-senha', { senhaAtual: 'smoke123', senhaNova: 'novaSenha1', confirmacao: 'novaSenha1' }, { authorization: `Bearer ${tok90}` });
    const aReLogin = await authPost('login', { login: 'AUTHTEST', senha: 'novaSenha1', empresa: 1 });
    const flag90 = (await pgAuth.query(`SELECT solicitar_alteracao_senha FROM operadores WHERE codoperador=90`)).rows[0] as any;
    check('AUTH: troca 1º acesso — mustChange=true; token chg BARRA rota protegida (M2, 403); atual errada→422; troca OK→re-login + flag zerada',
      aMust.status === 200 && aMust.json.mustChangePassword === true && typeof tok90 === 'string'
      && chgBlockedR.status === 403 && chgBlockedJ.code === 'SENHA_TROCA_OBRIGATORIA'
      && trChangeWrong.status === 422 && trChangeWrong.json.code === 'SENHA_ATUAL_INVALIDA'
      && trChange.status === 200 && aReLogin.status === 200 && aReLogin.json.mustChangePassword === false
      && flag90?.solicitar_alteracao_senha === 'N',
      { must: aMust.json.mustChangePassword, chgBlock: [chgBlockedR.status, chgBlockedJ.code], wrong: [trChangeWrong.status, trChangeWrong.json.code], change: trChange.status, relogin: aReLogin.status, flag: flag90 });

    // 71.9) senha nova fraca (< 6) → 400 VALIDACAO (schema).
    const aWeak = await authPost('trocar-senha', { senhaAtual: 'novaSenha1', senhaNova: '123', confirmacao: '123' }, { authorization: `Bearer ${tok90}` });
    check('AUTH: nova senha < 6 caracteres → 400 VALIDACAO (endurecimento do corte)', aWeak.status === 400, { status: aWeak.status, code: aWeak.json.code });

    // 71.10) sem tenant → 403 TENANT_FORBIDDEN (fail-closed, mesmo no login público).
    const aNoTenant = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'SMOKE', senha: 'smoke123' }) });
    check('AUTH: login sem x-tenant-id → 403 TENANT_FORBIDDEN (fail-closed)', aNoTenant.status === 403, { status: aNoTenant.status });

    // 71.11) fold ALTA (regressão): senha_hash NUNCA sai no read/echo do operador (a 070 adicionou a coluna).
    const opReadR = await fetch(`${base}/cadastro/operadores/7`, { headers: H });
    const opReadJ = (await opReadR.json().catch(() => ({}))) as any;
    check('AUTH: senha_hash NÃO vaza no GET /cadastro/operadores/:id (colunasOcultasLeitura)',
      opReadR.status === 200 && Number(opReadJ.codoperador) === 7 && !('senha_hash' in opReadJ),
      { status: opReadR.status, temHash: 'senha_hash' in opReadJ, keys: Object.keys(opReadJ).length });

    // 71.12) fold M1: sem identidade (header-identity segue ON no smoke, mas SEM x-operador-id) → rota
    // protegida exige operador → 401 NAO_AUTENTICADO (antes a leitura passava só com tenant).
    const semOpR = await fetch(`${base}/cadastro/operadores`, { headers: { 'content-type': 'application/json', 'x-tenant-id': 'pinheirao' } });
    check('AUTH: rota protegida sem operador (só tenant) → 401 NAO_AUTENTICADO (fold M1 fecha leitura anônima)',
      semOpR.status === 401, { status: semOpR.status });

    // ===== §72) corte-3c — ENDURECIMENTO: lockout por tentativas + auditoria de login DESCONHECIDO =====
    // 72.1) LOCKOUT (op 92 LOCKTEST): max=3 → 3 falhas bloqueiam; login CORRETO durante o bloqueio → 403.
    await pgAuth.query(`UPDATE configuracoes SET valor='3' WHERE codigo='AUTH_MAX_TENTATIVAS_LOGIN'`);
    const l72f1 = await authPost('login', { login: 'LOCKTEST', senha: 'errada', empresa: 1 });
    const l72f2 = await authPost('login', { login: 'LOCKTEST', senha: 'errada', empresa: 1 });
    const l72f3 = await authPost('login', { login: 'LOCKTEST', senha: 'errada', empresa: 1 });
    const l72LockRow = (await pgAuth.query(`SELECT tentativas_login, bloqueado_ate FROM operadores WHERE codoperador=92`)).rows[0] as any;
    const l72Locked = await authPost('login', { login: 'LOCKTEST', senha: 'smoke123', empresa: 1 }); // senha CERTA, mas bloqueado
    check('AUTH 3c: 3 falhas bloqueiam o operador; login correto durante o bloqueio → 403 OPERADOR_BLOQUEADO',
      l72f1.status === 401 && l72f2.status === 401 && l72f3.status === 401
      && Number(l72LockRow?.tentativas_login) === 3 && l72LockRow?.bloqueado_ate != null
      && l72Locked.status === 403 && l72Locked.json.code === 'OPERADOR_BLOQUEADO',
      { fails: [l72f1.status, l72f2.status, l72f3.status], row: l72LockRow, locked: [l72Locked.status, l72Locked.json.code] });

    // 72.2) RESET: desbloqueia; 2 falhas (t=2, sem lock); login correto → 200 + contador ZERADO.
    await pgAuth.query(`UPDATE operadores SET bloqueado_ate=NULL, tentativas_login=0 WHERE codoperador=92`);
    await authPost('login', { login: 'LOCKTEST', senha: 'errada', empresa: 1 });
    await authPost('login', { login: 'LOCKTEST', senha: 'errada', empresa: 1 });
    const l72Ok = await authPost('login', { login: 'LOCKTEST', senha: 'smoke123', empresa: 1 });
    const l72ResetRow = (await pgAuth.query(`SELECT tentativas_login, bloqueado_ate FROM operadores WHERE codoperador=92`)).rows[0] as any;
    await pgAuth.query(`UPDATE configuracoes SET valor='5' WHERE codigo='AUTH_MAX_TENTATIVAS_LOGIN'`);
    check('AUTH 3c: login correto ZERA o contador de tentativas (t=2 → 0) e não bloqueia',
      l72Ok.status === 200 && typeof l72Ok.json.token === 'string' && Number(l72ResetRow?.tentativas_login) === 0 && l72ResetRow?.bloqueado_ate == null,
      { ok: l72Ok.status, row: l72ResetRow });

    // 72.3) AUDITORIA de login DESCONHECIDO (o 3a não auditava): grava LOGON_FAIL com login_tentativa + codoperador NULL.
    const l72Unk = await authPost('login', { login: 'NAOEXISTE123', senha: 'x', empresa: 1 });
    const l72UnkRow = (await pgAuth.query(`SELECT codoperador, login_tentativa FROM operadores_acessos WHERE tipo='LOGON_FAIL' AND login_tentativa='NAOEXISTE123'`)).rows[0] as any;
    check('AUTH 3c: login desconhecido → 401 + auditoria LOGON_FAIL (login_tentativa gravado, codoperador NULL)',
      l72Unk.status === 401 && l72Unk.json.code === 'CREDENCIAIS_INVALIDAS' && !!l72UnkRow && l72UnkRow.codoperador == null && l72UnkRow.login_tentativa === 'NAOEXISTE123',
      { status: l72Unk.status, row: l72UnkRow });

    await pgAuth.end();

    // ===== §73) DEVOLUÇÃO DE COMPRA corte-1 — NÚCLEO do documento (picker de saldo + agregado, SEM efeitos) =====
    const DEV = 'compras/devolucao-compra';
    const pgDev = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    try {
    // NF de ENTRADA fresca do fornecedor 22 (CFOP 1102→5202), item produto 1 qtd 10, custo 5. Item extra cfop '1949' (sem CFOP_DEVOLUCAO).
    const d73Nf = Number((await pgDev.query(`INSERT INTO nf (idempresa,tipo,modelo,serie,dtemissao,dtcontabil,tipoemissao,finalidade,cfop,codparceiro,proc,totalnf,totalprod) VALUES (1,'E',55,'1',now(),now(),'0','1','1102',22,'N',0,0) RETURNING codnf`)).rows[0].codnf);
    const d73It = Number((await pgDev.query(`INSERT INTO nf_prod (codnf,nroitem,codproduto,quantidade,fatorembal,unidade,vrcusto,cfop) VALUES ($1,1,1,10,1,'UN',5,'1102') RETURNING codnfprod`, [d73Nf])).rows[0].codnfprod);
    await pgDev.query(`INSERT INTO cfop (codcfop,descricao) VALUES ('1949','OUTRAS ENTRADAS (SEM DEVOLUCAO)') ON CONFLICT (codcfop) DO NOTHING`);
    const d73ItSemCfop = Number((await pgDev.query(`INSERT INTO nf_prod (codnf,nroitem,codproduto,quantidade,fatorembal,unidade,vrcusto,cfop) VALUES ($1,3,1,5,1,'UN',5,'1949') RETURNING codnfprod`, [d73Nf])).rows[0].codnfprod);
    const d73ItCfopNull = Number((await pgDev.query(`INSERT INTO nf_prod (codnf,nroitem,codproduto,quantidade,fatorembal,unidade,vrcusto,cfop) VALUES ($1,4,1,5,1,'UN',5,NULL) RETURNING codnfprod`, [d73Nf])).rows[0].codnfprod);

    const crDev = (dto: any) => fetch(`${base}/${DEV}`, { method: 'POST', headers: H, body: JSON.stringify(dto) });
    const itemDto = (qtd: number, over: any = {}) => ({ codnf: d73Nf, codnfprod: d73It, idproduto: 1, qtd_nota_fiscal: 10, qtd_devolvida: qtd, valor_custo: 5, cfop: '5202', ...over });

    // 73.1) PICKER: itens de entrada do fornecedor 22 com saldo. O item novo tem saldo 10 + CFOP devolução 5202.
    const d73Pick = await (await fetch(`${base}/${DEV}/itens-disponiveis?codparceiro=22&codnf=${d73Nf}`, { headers: H })).json() as any[];
    const d73Row = (d73Pick ?? []).find((r) => Number(r.codnfprod) === d73It);
    check('DEVOLUÇÃO: picker traz item da NF de entrada com saldo=10 + cfop_devolucao=5202 + custo=5',
      Array.isArray(d73Pick) && !!d73Row && Number(d73Row.saldo) === 10 && d73Row.cfop_devolucao === '5202' && Number(d73Row.valor_custo) === 5,
      { n: d73Pick?.length, row: d73Row });

    // 73.2) CRIAR devolução PARCIAL (qtd 4) → 201 + total_produto_devolvido = 20 (custo×qtd).
    const d73C1 = await crDev({ codparceiro: 22, itens: [itemDto(4)] });
    const d73C1J = (await d73C1.json().catch(() => ({}))) as any;
    const d73Id1 = Number(d73C1J.codpeddevcompra ?? d73C1J.codigo);
    const d73Read1 = await (await fetch(`${base}/${DEV}/${d73Id1}`, { headers: H })).json() as any;
    check('DEVOLUÇÃO: cria parcial (qtd 4) → 201, status EM_DIGITACAO, total_produto_devolvido=20 (custo×qtd)',
      d73C1.status === 201 && d73Read1.status === 'EM_DIGITACAO' && (d73Read1.itens ?? []).length === 1 && Number(d73Read1.itens[0].total_produto_devolvido) === 20,
      { status: d73C1.status, read: { status: d73Read1.status, tot: d73Read1.itens?.[0]?.total_produto_devolvido } });

    // 73.3) SALDO decresce: picker agora mostra saldo 6; devolver 7 → 422 QTDE_EXCEDE; devolver 6 (exato) → 201.
    const d73Pick2 = await (await fetch(`${base}/${DEV}/itens-disponiveis?codparceiro=22&codnf=${d73Nf}`, { headers: H })).json() as any[];
    const d73Saldo2 = Number((d73Pick2 ?? []).find((r) => Number(r.codnfprod) === d73It)?.saldo);
    const d73Excede = await crDev({ codparceiro: 22, itens: [itemDto(7)] });
    const d73ExcedeJ = (await d73Excede.json().catch(() => ({}))) as any;
    const d73C2 = await crDev({ codparceiro: 22, itens: [itemDto(6)] });
    const d73C2J = (await d73C2.json().catch(() => ({}))) as any;
    const d73Id2 = Number(d73C2J.codpeddevcompra ?? d73C2J.codigo);
    check('DEVOLUÇÃO: saldo decresce (10→6); qtd 7 > saldo → 422 DEVOLUCAO_QTDE_EXCEDE; qtd 6 (exato) → 201',
      d73Saldo2 === 6 && d73Excede.status === 422 && d73ExcedeJ.code === 'DEVOLUCAO_QTDE_EXCEDE' && d73C2.status === 201,
      { saldo: d73Saldo2, excede: [d73Excede.status, d73ExcedeJ.code], exato: d73C2.status });

    // 73.4) WORKFLOW: finalizar id1 (→DIGITADO); editar (PUT) finalizado → 422 NAO_EDITAVEL; cancelar id2 → saldo volta a 6.
    const d73Fin = await fetch(`${base}/${DEV}/${d73Id1}/finalizar`, { method: 'POST', headers: H });
    const d73FinJ = (await d73Fin.json().catch(() => ({}))) as any;
    const d73PutFin = await fetch(`${base}/${DEV}/${d73Id1}`, { method: 'PUT', headers: H, body: JSON.stringify({ obs: 'X' }) });
    const d73PutFinJ = (await d73PutFin.json().catch(() => ({}))) as any;
    const d73Canc = await fetch(`${base}/${DEV}/${d73Id2}/cancelar`, { method: 'POST', headers: H });
    const d73Pick3 = await (await fetch(`${base}/${DEV}/itens-disponiveis?codparceiro=22&codnf=${d73Nf}`, { headers: H })).json() as any[];
    const d73Saldo3 = Number((d73Pick3 ?? []).find((r) => Number(r.codnfprod) === d73It)?.saldo);
    check('DEVOLUÇÃO: finalizar→DIGITADO; PUT em finalizado → 422 DEVOLUCAO_NAO_EDITAVEL; cancelar libera o saldo (→6)',
      d73Fin.status === 200 && d73FinJ.status === 'DIGITADO' && d73PutFin.status === 422 && d73PutFinJ.code === 'DEVOLUCAO_NAO_EDITAVEL'
      && d73Canc.status === 200 && d73Saldo3 === 6,
      { fin: [d73Fin.status, d73FinJ.status], put: [d73PutFin.status, d73PutFinJ.code], canc: d73Canc.status, saldo: d73Saldo3 });

    // 73.5) GATES: CFOP de origem sem CFOP_DEVOLUCAO → 422; CFOP de origem VAZIO → 422 (M4); fornecedor não-FRN → 422; RBAC → 403.
    const d73Cfop = await crDev({ codparceiro: 22, itens: [itemDto(1, { codnfprod: d73ItSemCfop, cfop: null, qtd_nota_fiscal: 5 })] });
    const d73CfopJ = (await d73Cfop.json().catch(() => ({}))) as any;
    const d73CfopNull = await crDev({ codparceiro: 22, itens: [itemDto(1, { codnfprod: d73ItCfopNull, cfop: null, qtd_nota_fiscal: 5 })] });
    const d73CfopNullJ = (await d73CfopNull.json().catch(() => ({}))) as any;
    const d73Forn = await crDev({ codparceiro: 20, itens: [itemDto(1)] }); // 20 é CLIENTE (não FRN)
    const d73FornJ = (await d73Forn.json().catch(() => ({}))) as any;
    const d73Rbac = await fetch(`${base}/${DEV}`, { method: 'POST', headers: H_SEM_ACESSO, body: JSON.stringify({ codparceiro: 22, itens: [itemDto(1)] }) });
    check('DEVOLUÇÃO: gates — CFOP sem devolução → 422; CFOP origem VAZIO → 422 (M4); não-FRN → 422; sem grant → 403',
      d73Cfop.status === 422 && d73CfopJ.code === 'DEVOLUCAO_CFOP_NAO_CONFIGURADO'
      && d73CfopNull.status === 422 && d73CfopNullJ.code === 'DEVOLUCAO_CFOP_ORIGEM_AUSENTE'
      && d73Forn.status === 422 && d73FornJ.code === 'DEVOLUCAO_FORNECEDOR_INVALIDO'
      && d73Rbac.status === 403,
      { cfop: [d73Cfop.status, d73CfopJ.code], cfopNull: [d73CfopNull.status, d73CfopNullJ.code], forn: [d73Forn.status, d73FornJ.code], rbac: d73Rbac.status });

    // 73.6) corte-2 — GERAR NF de devolução (d73Id1 está DIGITADO, 1 item qtd 4): NF saída finalidade=4 CFOP 5202
    // + refNFe (codnf_ref) + vínculo + status; re-gerar → 422.
    const d73Gnf = await fetch(`${base}/${DEV}/${d73Id1}/gerar-nf`, { method: 'POST', headers: H });
    const d73GnfJ = (await d73Gnf.json().catch(() => ({}))) as any;
    const codnfDev = Number(d73GnfJ.codnf);
    const nfHdr = (await pgDev.query(`SELECT tipo, finalidade, cfop, codparceiro, cod_ped_dev_compra, serie, idsituacao_nf FROM nf WHERE codnf=$1`, [codnfDev])).rows[0] as any;
    const nfItm = (await pgDev.query(`SELECT quantidade, cfop FROM nf_prod WHERE codnf=$1 ORDER BY nroitem LIMIT 1`, [codnfDev])).rows[0] as any;
    const nfRef = (await pgDev.query(`SELECT codnf_ref FROM nf_referencia WHERE codnf=$1 LIMIT 1`, [codnfDev])).rows[0] as any;
    const devLink = (await pgDev.query(`SELECT status, codnf_emitida FROM pedido_devolucao_compra WHERE codpeddevcompra=$1`, [d73Id1])).rows[0] as any;
    const d73GnfAgain = await fetch(`${base}/${DEV}/${d73Id1}/gerar-nf`, { method: 'POST', headers: H });
    const d73GnfAgainJ = (await d73GnfAgain.json().catch(() => ({}))) as any;
    check('DEVOLUÇÃO corte-2: gerar-NF → NF saída finalidade=4 CFOP 5202 + refNFe + item(qtd 4) + vínculo IN-ROW + status; re-gerar → 422',
      d73Gnf.status === 200 && codnfDev > 0
      && nfHdr?.tipo === 'S' && nfHdr?.finalidade === '4' && nfHdr?.cfop === '5202' && Number(nfHdr?.codparceiro) === 22
      && Number(nfHdr?.cod_ped_dev_compra) === d73Id1 // vínculo IN-ROW (fold anti-duplo)
      && Number(nfItm?.quantidade) === 4 && nfItm?.cfop === '5202' && Number(nfRef?.codnf_ref) === d73Nf
      && Number(nfHdr?.idsituacao_nf) === 17 // corte SPED c1: situação operacional do CFOP de saída (golden 17)
      && devLink?.status === 'NOTA_FISCAL_EMITIDA' && Number(devLink?.codnf_emitida) === codnfDev
      && d73GnfAgain.status === 422 && d73GnfAgainJ.code === 'DEVOLUCAO_NF_JA_EMITIDA',
      { gnf: [d73Gnf.status, codnfDev], nf: nfHdr, item: nfItm, ref: nfRef, link: devLink, again: [d73GnfAgain.status, d73GnfAgainJ.code] });

    // 73.7) corte-3 — FATURAR (d73Id1 em NOTA_FISCAL_EMITIDA): A Receber contra o fornecedor 22, venc = emissão + 15.
    const d73Fat = await fetch(`${base}/${DEV}/${d73Id1}/faturar`, { method: 'POST', headers: H });
    const d73FatJ = (await d73Fat.json().catch(() => ({}))) as any;
    const d73Ar = (await pgDev.query(`SELECT codparceiro, valor, tipodoc, to_char(dtvenc,'YYYY-MM-DD') AS dtvenc FROM areceber WHERE idnf=$1`, [codnfDev])).rows[0] as any;
    const d73NfE = (await pgDev.query(`SELECT to_char(dtemissao,'YYYY-MM-DD') AS e, totalnf FROM nf WHERE codnf=$1`, [codnfDev])).rows[0] as any;
    const d73Exp = (() => { const b = new Date(`${d73NfE?.e}T00:00:00Z`); b.setUTCDate(b.getUTCDate() + 15); return b.toISOString().slice(0, 10); })();
    check('DEVOLUÇÃO corte-3: faturar → A Receber contra o fornecedor 22 (valor=totalnf, tipodoc BOLETO), venc = emissão + 15 dias',
      d73Fat.status === 200 && Number(d73Ar?.codparceiro) === 22 && Number(d73Ar?.valor) === Number(d73NfE?.totalnf) && Number(d73Ar?.valor) > 0
      && d73Ar?.tipodoc === 'BOLETO' && d73Ar?.dtvenc === d73Exp && d73FatJ.vencimento === d73Exp,
      { fat: d73Fat.status, ar: d73Ar, exp: d73Exp, fatVenc: d73FatJ.vencimento });

    // 73.8) corte-3 — ParceiroZera: fornecedor com DEVOLUCAO_ZERA_IMPOSTO_ICMSST='S' + NF entrada CFOP 1403 (ST)
    // → a NF de devolução ZERA ICMS+ST e força CST 060.
    await pgDev.query(`UPDATE parceiros SET devolucao_zera_imposto_icmsst='S' WHERE codparceiro=22 AND idempresa=1`);
    const zNf = Number((await pgDev.query(`INSERT INTO nf (idempresa,tipo,modelo,serie,dtemissao,dtcontabil,tipoemissao,finalidade,cfop,codparceiro,proc,totalnf,totalprod) VALUES (1,'E',55,'1',now(),now(),'0','1','1403',22,'N',0,0) RETURNING codnf`)).rows[0].codnf);
    const zIt = Number((await pgDev.query(`INSERT INTO nf_prod (codnf,nroitem,codproduto,quantidade,fatorembal,unidade,vrcusto,cfop,icms,vrbasecalculo,vricm,vrbasest,vricmst,cst) VALUES ($1,1,1,10,1,'UN',5,'1403',18,100,18,150,27,10) RETURNING codnfprod`, [zNf])).rows[0].codnfprod);
    const zCJ = (await (await crDev({ codparceiro: 22, itens: [{ codnf: zNf, codnfprod: zIt, idproduto: 1, qtd_nota_fiscal: 10, qtd_devolvida: 10, valor_custo: 5, cfop: '5411' }] })).json().catch(() => ({}))) as any;
    const zId = Number(zCJ.codpeddevcompra ?? zCJ.codigo);
    await fetch(`${base}/${DEV}/${zId}/finalizar`, { method: 'POST', headers: H });
    const zGnf = await fetch(`${base}/${DEV}/${zId}/gerar-nf`, { method: 'POST', headers: H });
    const zGnfJ = (await zGnf.json().catch(() => ({}))) as any;
    const zNfItem = (await pgDev.query(`SELECT icms, vricm, vrbasest, vricmst, cst FROM nf_prod WHERE codnf=$1 ORDER BY nroitem LIMIT 1`, [Number(zGnfJ.codnf)])).rows[0] as any;
    await pgDev.query(`UPDATE parceiros SET devolucao_zera_imposto_icmsst=NULL WHERE codparceiro=22 AND idempresa=1`);
    check('DEVOLUÇÃO corte-3: ParceiroZera (flag S + CFOP origem 1403) → NF de devolução ZERA ICMS+ST e CST=60',
      zGnf.status === 200 && Number(zNfItem?.icms) === 0 && Number(zNfItem?.vricm) === 0 && Number(zNfItem?.vrbasest) === 0 && Number(zNfItem?.vricmst) === 0 && Number(zNfItem?.cst) === 60,
      { gnf: zGnf.status, item: zNfItem });

    // 73.9) corte SPED c2 — IPI% RECOMPUTADO: entrada item qtd 10, custo 5, vripi 20. Devolver 5 → vripi rateado
    // = 10; VRTOTALPRODUTOS = 5×5 = 25; ipi% = 10×100/25 = 40 (não a % copiada da entrada).
    const ipiNf = Number((await pgDev.query(`INSERT INTO nf (idempresa,tipo,modelo,serie,dtemissao,dtcontabil,tipoemissao,finalidade,cfop,codparceiro,proc,totalnf,totalprod) VALUES (1,'E',55,'1',now(),now(),'0','1','1102',22,'N',0,0) RETURNING codnf`)).rows[0].codnf);
    const ipiIt = Number((await pgDev.query(`INSERT INTO nf_prod (codnf,nroitem,codproduto,quantidade,fatorembal,unidade,vrcusto,cfop,ipi,vripi) VALUES ($1,1,1,10,1,'UN',5,'1102',7,20) RETURNING codnfprod`, [ipiNf])).rows[0].codnfprod);
    const ipiCJ = (await (await crDev({ codparceiro: 22, itens: [{ codnf: ipiNf, codnfprod: ipiIt, idproduto: 1, qtd_nota_fiscal: 10, qtd_devolvida: 5, valor_custo: 5, cfop: '5202' }] })).json().catch(() => ({}))) as any;
    const ipiId = Number(ipiCJ.codpeddevcompra ?? ipiCJ.codigo);
    await fetch(`${base}/${DEV}/${ipiId}/finalizar`, { method: 'POST', headers: H });
    const ipiGnf = (await (await fetch(`${base}/${DEV}/${ipiId}/gerar-nf`, { method: 'POST', headers: H })).json().catch(() => ({}))) as any;
    const ipiOut = (await pgDev.query(`SELECT ipi, vripi FROM nf_prod WHERE codnf=$1 ORDER BY nroitem LIMIT 1`, [Number(ipiGnf.codnf)])).rows[0] as any;
    check('DEVOLUÇÃO SPED c2: IPI% recomputado da saída (vripi 20→10 rateado; ipi% = 10×100/25 = 40, não copia a % da entrada)',
      Number(ipiOut?.vripi) === 10 && Number(ipiOut?.ipi) === 40, { ipiOut });

    // 73.10) corte SPED c4 — VENCIMENTO ANCORADO na entrada: entrada com A Pagar de venc FUTURO (2027-01-01).
    // Devolução de 1 única entrada → boleto venc = 2027-01-01 + 15 = 2027-01-16 (ancorado), não hoje+15.
    const ancNf = Number((await pgDev.query(`INSERT INTO nf (idempresa,tipo,modelo,serie,dtemissao,dtcontabil,tipoemissao,finalidade,cfop,codparceiro,proc,totalnf,totalprod) VALUES (1,'E',55,'1',now(),now(),'0','1','1102',22,'N',0,0) RETURNING codnf`)).rows[0].codnf);
    const ancIt = Number((await pgDev.query(`INSERT INTO nf_prod (codnf,nroitem,codproduto,quantidade,fatorembal,unidade,vrcusto,cfop) VALUES ($1,1,1,10,1,'UN',5,'1102') RETURNING codnfprod`, [ancNf])).rows[0].codnfprod);
    await pgDev.query(`INSERT INTO apagar (codparceiro,codempresa,idnf,dtvenda,dtvenc,duplicata,nrodup,valor) VALUES (22,1,$1,now(),'2027-01-01','ANC001',1,50)`, [ancNf]);
    // fold auditoria: um RESIDUAL ST (retencao='ICMSST') com venc ANTERIOR (2026-08-01) NÃO pode ancorar o boleto
    // (a âncora usa só as duplicatas do fornecedor, retencao IS NULL) — o venc deve seguir a duplicata (2027-01-01).
    await pgDev.query(`INSERT INTO apagar (codparceiro,codempresa,idnf,dtvenda,dtvenc,duplicata,nrodup,valor,tipodoc,retencao) VALUES (22,1,$1,now(),'2026-08-01','ANCST',1,10,'RESIDUAL ST','ICMSST')`, [ancNf]);
    const ancCJ = (await (await crDev({ codparceiro: 22, itens: [{ codnf: ancNf, codnfprod: ancIt, idproduto: 1, qtd_nota_fiscal: 10, qtd_devolvida: 3, valor_custo: 5, cfop: '5202' }] })).json().catch(() => ({}))) as any;
    const ancId = Number(ancCJ.codpeddevcompra ?? ancCJ.codigo);
    await fetch(`${base}/${DEV}/${ancId}/finalizar`, { method: 'POST', headers: H });
    await fetch(`${base}/${DEV}/${ancId}/gerar-nf`, { method: 'POST', headers: H });
    const ancFat = (await (await fetch(`${base}/${DEV}/${ancId}/faturar`, { method: 'POST', headers: H })).json().catch(() => ({}))) as any;
    check('DEVOLUÇÃO SPED c4: venc ancorado na DUPLICATA da entrada (2027-01-01 + 15 = 2027-01-16); RESIDUAL ST (venc 2026-08-01) NÃO ancora (fold auditoria)',
      ancFat.vencimento === '2027-01-16', { venc: ancFat.vencimento });
    } finally {
      await pgDev.end();
    }

    // ===== §74) CUTOVER do de-para (CODREFERENCIA_FOR) — motor de de-dup + loader idempotente (verificação) =====
    const pgCut = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    try {
      // fixture cru (produtos 1/2 e fornecedor 22 existem no seed): singleton + colisão auto-resolve + suja + SEM GTIN.
      const raw: RawCodref[] = [
        { codreferencia_for: 1, idproduto: 1, codref: 'ABC.123', codfor: 22, tiporef: null, fator_embalagem: null, produto_existe: true, produto_ativo: true, produto_codbarra_norm: null, fornecedor_valido: true },
        { codreferencia_for: 2, idproduto: 1, codref: '7896029021798', codfor: 22, tiporef: 'E', fator_embalagem: null, produto_existe: true, produto_ativo: true, produto_codbarra_norm: '7896029021781', fornecedor_valido: true },
        { codreferencia_for: 3, idproduto: 2, codref: '7896029021798', codfor: 22, tiporef: 'E', fator_embalagem: null, produto_existe: true, produto_ativo: true, produto_codbarra_norm: '7896029021798', fornecedor_valido: true }, // dono (codbarra) → vence
        { codreferencia_for: 4, idproduto: 1, codref: 'SEM GTIN', codfor: 22, tiporef: 'E', fator_embalagem: null, produto_existe: true, produto_ativo: true, produto_codbarra_norm: null, fornecedor_valido: true },
        { codreferencia_for: 5, idproduto: 1, codref: 'XYZ', codfor: null, tiporef: 'E', fator_embalagem: null, produto_existe: true, produto_ativo: true, produto_codbarra_norm: null, fornecedor_valido: false },
      ];
      const { keep, report } = dedupCodref(raw);
      const cutMotor = keep.length === 2 && report.descartadas.sujas === 1 && report.descartadas.semGtin === 1
        && report.colisoes.autoResolvidas === 1 && report.descartadas.colisaoExcedente === 1
        && keep.some((k) => k.codref === 'ABC123' && k.idproduto === 1 && k.tiporef === 'E' && k.fator_embalagem === 1)
        && keep.some((k) => k.codref === '7896029021798' && k.idproduto === 2); // o dono do codbarra venceu
      check('CUTOVER de-para: motor de-dup — singleton normalizado + colisão auto-resolve (codbarra) + suja/SEM GTIN fora', cutMotor,
        { keep: keep.map((k) => [k.codref, k.idproduto]), report });

      // loader idempotente: 1ª carga insere; 2ª carga atualiza (não duplica).
      const l1 = await loadCodref(pgCut, keep, 7);
      const cnt1 = Number((await pgCut.query(`SELECT count(*)::int AS n FROM codreferencia_for WHERE codfor=22`)).rows[0].n);
      const l2 = await loadCodref(pgCut, keep, 7);
      const cnt2 = Number((await pgCut.query(`SELECT count(*)::int AS n FROM codreferencia_for WHERE codfor=22`)).rows[0].n);
      check('CUTOVER de-para: loader idempotente — 1ª carga insere 2; 2ª atualiza 2 (0 inseridos); tabela estável em 2',
        l1.inseridos === 2 && l1.atualizados === 0 && cnt1 === 2 && l2.inseridos === 0 && l2.atualizados === 2 && cnt2 === 2,
        { l1, l2, cnt1, cnt2 });
    } finally {
      await pgCut.end();
    }

    // ===== §75) OPERADORES — LIBERAÇÃO por supervisor (LOG_LIBERACOES) corte-1 (consulta) =====
    const pgLib = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    try {
      // seed 2 eventos com MARCADOR único (SMOKE75) — o corte-3 (wire do limite) também loga; o marcador isola
      // estes eventos da poluição de outros testes. O registrar interno é exercitado no §75.3/§57.3d.
      await pgLib.query(`INSERT INTO log_liberacoes (usuario_sistema, usuario_liberou, liberacao, computador, data_liberacao) VALUES
        (7, '3462', 'SMOKE75 VALOR MAXIMO', 'PDV01', '2026-07-10 09:00:00-03'),
        (7, '0',    'NEGADO: SMOKE75 DESCONTO', 'PDV01', '2026-07-11 10:00:00-03')`);
      const libAll = await fetch(`${base}/operadores/liberacoes`, { headers: H });
      const libAllJ = (await libAll.json().catch(() => [])) as any[];
      check('LIBERAÇÃO §75: GET /operadores/liberacoes lista os eventos (usuario_liberou = código string)',
        libAll.status === 200 && libAllJ.some((r) => r.liberacao?.includes('SMOKE75 DESCONTO')) && libAllJ.some((r) => r.usuario_liberou === '3462'),
        { status: libAll.status, n: libAllJ.length });
      const libFiltro = await fetch(`${base}/operadores/liberacoes?liberacao=SMOKE75%20VALOR`, { headers: H });
      const libFiltroJ = (await libFiltro.json().catch(() => [])) as any[];
      check('LIBERAÇÃO §75: filtro por ação (ilike) retorna só o evento marcado',
        libFiltro.status === 200 && libFiltroJ.length === 1 && libFiltroJ[0].usuario_liberou === '3462',
        { n: libFiltroJ.length });
      const libSem = await fetch(`${base}/operadores/liberacoes`, { headers: H_SEM_ACESSO });
      check('LIBERAÇÃO §75: sem grant RBAC → 403', libSem.status === 403, { status: libSem.status });

      // 75.2) corte-2 — GRANTS por-usuário (quem-libera-o-quê). chaves + matriz + set + reflexo em usuariosPermitidos.
      const CHAVE = 'USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO';
      const chaves = (await (await fetch(`${base}/operadores/liberacoes/chaves`, { headers: H })).json().catch(() => [])) as any[];
      check('LIBERAÇÃO §75.2: GET chaves → lista as chaves de liberação seedadas (inclui VALOR_MAX_EXCEDIDO)',
        Array.isArray(chaves) && chaves.some((c) => c.codigo === CHAVE), { n: chaves.length });
      const permAntes = (await (await fetch(`${base}/operadores/liberacoes/permissoes?codigo=${CHAVE}`, { headers: H })).json().catch(() => ({}))) as any;
      const op7Antes = (permAntes.operadores ?? []).find((o: any) => Number(o.codoperador) === 7);
      // concede ao operador 7
      const setOn = await fetch(`${base}/operadores/liberacoes/permissoes`, { method: 'PUT', headers: H, body: JSON.stringify({ codigo: CHAVE, codoperador: 7, concedido: true }) });
      const permDepois = (await (await fetch(`${base}/operadores/liberacoes/permissoes?codigo=${CHAVE}`, { headers: H })).json().catch(() => ({}))) as any;
      const op7Depois = (permDepois.operadores ?? []).find((o: any) => Number(o.codoperador) === 7);
      // grava na configuracoes_especificas (tipo Usuario, chave 7, valor S)?
      const ce = (await pgLib.query(`SELECT ce.valor FROM configuracoes_especificas ce JOIN configuracoes c ON c.id=ce.id WHERE c.codigo=$1 AND ce.tipo='Usuario' AND ce.chave='7'`, [CHAVE])).rows[0] as any;
      check('LIBERAÇÃO §75.2: PUT concede grant → matriz reflete concedido=true + grava configuracoes_especificas(Usuario,7,S)',
        setOn.status === 200 && op7Antes?.concedido === false && op7Depois?.concedido === true && ce?.valor === 'S',
        { antes: op7Antes?.concedido, depois: op7Depois?.concedido, ce: ce?.valor });
      // revoga
      const setOff = await fetch(`${base}/operadores/liberacoes/permissoes`, { method: 'PUT', headers: H, body: JSON.stringify({ codigo: CHAVE, codoperador: 7, concedido: false }) });
      const ceOff = (await pgLib.query(`SELECT count(*)::int AS n FROM configuracoes_especificas ce JOIN configuracoes c ON c.id=ce.id WHERE c.codigo=$1 AND ce.tipo='Usuario' AND ce.chave='7'`, [CHAVE])).rows[0] as any;
      check('LIBERAÇÃO §75.2: PUT revoga grant → apaga a linha (0)', setOff.status === 200 && Number(ceOff?.n) === 0, { n: ceOff?.n });
      // chave inválida → 422; PUT sem grant → 403
      const setBad = await fetch(`${base}/operadores/liberacoes/permissoes`, { method: 'PUT', headers: H, body: JSON.stringify({ codigo: 'CHAVE_QUE_NAO_EXISTE', codoperador: 7, concedido: true }) });
      const setSem = await fetch(`${base}/operadores/liberacoes/permissoes`, { method: 'PUT', headers: H_SEM_ACESSO, body: JSON.stringify({ codigo: CHAVE, codoperador: 7, concedido: true }) });
      check('LIBERAÇÃO §75.2: chave inválida → 422 LIBERACAO_CHAVE_INVALIDA; sem grant → 403',
        setBad.status === 422 && ((await setBad.json().catch(() => ({}))) as any).code === 'LIBERACAO_CHAVE_INVALIDA' && setSem.status === 403,
        { bad: setBad.status, sem: setSem.status });

      // 75.3) corte-3 — VALIDAR (ChamaLiberacaoLogin): supervisor op 8 (senha = a do op 7 'smoke123') COM grant.
      await pgLib.query(`UPDATE operadores SET senha_hash=(SELECT senha_hash FROM operadores WHERE codoperador=7), desabilitado=NULL WHERE codoperador=8`);
      await fetch(`${base}/operadores/liberacoes/permissoes`, { method: 'PUT', headers: H, body: JSON.stringify({ codigo: CHAVE, codoperador: 8, concedido: true }) });
      const valOk = await fetch(`${base}/operadores/liberacoes/validar`, { method: 'POST', headers: H, body: JSON.stringify({ codigo: CHAVE, login: 'OP8', senha: 'smoke123', liberacao: 'TESTE LIBERACAO' }) });
      const valOkJ = (await valOk.json().catch(() => ({}))) as any;
      const logSup = (await pgLib.query(`SELECT usuario_sistema, usuario_liberou FROM log_liberacoes WHERE liberacao='TESTE LIBERACAO' ORDER BY id DESC LIMIT 1`)).rows[0] as any;
      check('LIBERAÇÃO §75.3: validar supervisor (login+senha OK + grant) → {liberado:true,codOperador:8} + LOG (usuario_sistema=7, usuario_liberou=8)',
        valOk.status === 200 && valOkJ.liberado === true && Number(valOkJ.codOperador) === 8 && Number(logSup?.usuario_sistema) === 7 && logSup?.usuario_liberou === '8',
        { body: valOkJ, log: logSup });
      // senha errada → liberado:false + log NEGADO
      const valBad = await fetch(`${base}/operadores/liberacoes/validar`, { method: 'POST', headers: H, body: JSON.stringify({ codigo: CHAVE, login: 'OP8', senha: 'errada', liberacao: 'TENTATIVA X' }) });
      const valBadJ = (await valBad.json().catch(() => ({}))) as any;
      const logNeg = (await pgLib.query(`SELECT liberacao FROM log_liberacoes WHERE liberacao LIKE 'NEGADO:%TENTATIVA X' ORDER BY id DESC LIMIT 1`)).rows[0] as any;
      check('LIBERAÇÃO §75.3: senha errada → {liberado:false} + LOG de negação (NEGADO:)', valBad.status === 200 && valBadJ.liberado === false && !!logNeg, { body: valBadJ, neg: logNeg?.liberacao });
      // supervisor SEM grant (revoga op 8) → liberado:false
      await fetch(`${base}/operadores/liberacoes/permissoes`, { method: 'PUT', headers: H, body: JSON.stringify({ codigo: CHAVE, codoperador: 8, concedido: false }) });
      const valNoGrant = await fetch(`${base}/operadores/liberacoes/validar`, { method: 'POST', headers: H, body: JSON.stringify({ codigo: CHAVE, login: 'OP8', senha: 'smoke123', liberacao: 'SEM GRANT' }) });
      check('LIBERAÇÃO §75.3: supervisor sem grant → {liberado:false}', valNoGrant.status === 200 && ((await valNoGrant.json().catch(() => ({}))) as any).liberado === false, { status: valNoGrant.status });
    } finally {
      await pgLib.end();
    }

    // ===== §76) AGENDA DE PROMOÇÃO (uCadAgendaPromocao) corte-1 — cadastro + validações + workflow =====
    const pgPromo = new Pool({ host: PG_CONN.host, port: PG_CONN.port, user: PG_CONN.user, password: PG_CONN.password, database: `${PG_CONN.databasePrefix}pinheirao` });
    try {
      const AP = 'cadastro/agenda-promocao';
      const crPromo = (body: Record<string, unknown>, headers = H) => fetch(`${base}/${AP}`, { method: 'POST', headers, body: JSON.stringify(body) });
      // produto inativo dedicado p/ o teste de gate.
      await pgPromo.query(`INSERT INTO produtos (idproduto, codbarra, descricao, unidade, codfor, aliquota, ativo) VALUES (990001,'7000000000019','PROD INATIVO PROMO','UN',1,'T01','N') ON CONFLICT (idproduto) DO UPDATE SET ativo='N'`);

      // 76.1) criar agenda (nome + período data+hora + 2 itens) → 201; view traz situacao + qtde_itens.
      const p1 = await crPromo({ nomepromo: 'FDS SEVEN BOYS', dtiniciopromocao: '2026-09-01T08:00', dtfimpromocao: '2026-09-03T22:00', itens: [
        { idproduto: 1, vlrpromocao: 1.29, vrvenda: 2.89 },
        { idproduto: 2, vlrpromocao: 3.5, vrvenda: 5.0, vrclube_fidelidade: 3.2, maximo: 6 },
      ] });
      const p1J = (await p1.json().catch(() => ({}))) as any;
      const codag = Number(p1J.codagenda);
      const itAg = (await pgPromo.query(`SELECT idproduto, vlrpromocao, ativo, nroitem, dtativo FROM agenda_promocao_itens WHERE codagenda=$1 ORDER BY nroitem`, [codag])).rows as any[];
      const viewRow = ((await (await fetch(`${base}/${AP}?campo=codagenda&operador=igual&valor=${codag}`, { headers: H })).json().catch(() => [])) as any[])[0];
      check('PROMO 76.1: criar agenda + 2 itens → 201; itens ATIVO=S default + nroitem 1/2 + dtativo; view situacao VIGENTE-ish + qtde_itens 2',
        p1.status === 201 && codag > 0 && itAg.length === 2 && itAg[0].ativo === 'S' && Number(itAg[0].nroitem) === 1 && itAg[0].dtativo != null
        && Number(viewRow?.qtde_itens) === 2 && ['AGENDADA', 'VIGENTE', 'EXPIRADA'].includes(viewRow?.situacao),
        { status: p1.status, itens: itAg.length, situacao: viewRow?.situacao, qtde: viewRow?.qtde_itens });

      // 76.2) período inválido (fim <= início) → 400; preço promocional <= 0 → 400 (schema).
      const p2a = await crPromo({ nomepromo: 'X', dtiniciopromocao: '2026-09-05T10:00', dtfimpromocao: '2026-09-05T09:00', itens: [{ idproduto: 1, vlrpromocao: 1 }] });
      const p2b = await crPromo({ nomepromo: 'X', dtiniciopromocao: '2026-09-05T10:00', dtfimpromocao: '2026-09-06T10:00', itens: [{ idproduto: 1, vlrpromocao: 0 }] });
      check('PROMO 76.2: período fim<=início → 400; ambos preços zero → 400 (schema)', p2a.status === 400 && p2b.status === 400, { periodo: p2a.status, preco: p2b.status });
      // 76.2b) FOLD: preço promo=0 COM preço clube>0 → 201 (fiel ao legado: rejeita só quando AMBOS zero).
      const p2c = await crPromo({ nomepromo: 'CLUBE', dtiniciopromocao: '2029-03-01T00:00', dtfimpromocao: '2029-03-02T00:00', itens: [{ idproduto: 2, vlrpromocao: 0, vrclube_fidelidade: 5 }] });
      check('PROMO 76.2b FOLD: preço promo=0 + preço clube>0 → 201 (não-ambos-zero, uCadAgendaPromocao:651)', p2c.status === 201, { status: p2c.status });

      // 76.3) ANTI-SOBREPOSIÇÃO gated por PERMITE_PRODUTO_MAIS_UMA_AGENDA (FOLD MÉDIA). Default 'S' = permissivo (fiel legado).
      await crPromo({ nomepromo: 'BASE 2029', dtiniciopromocao: '2029-01-01T00:00', dtfimpromocao: '2029-01-31T00:00', itens: [{ idproduto: 2, vlrpromocao: 1.5 }] });
      const p3perm = await crPromo({ nomepromo: 'SOBRE OK', dtiniciopromocao: '2029-01-15T00:00', dtfimpromocao: '2029-02-15T00:00', itens: [{ idproduto: 2, vlrpromocao: 1.6 }] });
      check('PROMO 76.3 FOLD: default (config S) → sobreposição PERMITIDA (201, fiel ao legado permissivo)', p3perm.status === 201, { status: p3perm.status });
      // 76.3b) com config='N' → sobreposição BLOQUEADA (422). Depois reseta p/ 'S'.
      await pgPromo.query(`UPDATE configuracoes SET valor='N' WHERE codigo='PERMITE_PRODUTO_MAIS_UMA_AGENDA'`);
      const p3block = await crPromo({ nomepromo: 'SOBRE NAO', dtiniciopromocao: '2029-01-20T00:00', dtfimpromocao: '2029-02-20T00:00', itens: [{ idproduto: 2, vlrpromocao: 1.7 }] });
      const p3blockJ = (await p3block.json().catch(() => ({}))) as any;
      await pgPromo.query(`UPDATE configuracoes SET valor='S' WHERE codigo='PERMITE_PRODUTO_MAIS_UMA_AGENDA'`);
      check('PROMO 76.3b FOLD: config N → sobreposição BLOQUEADA (422 PROMOCAO_PRODUTO_SOBREPOSTO)', p3block.status === 422 && p3blockJ.code === 'PROMOCAO_PRODUTO_SOBREPOSTO', { status: p3block.status, code: p3blockJ.code });

      // 76.4) produto INATIVO → 422 PROMOCAO_PRODUTO_INATIVO.
      const p4 = await crPromo({ nomepromo: 'INATIVO', dtiniciopromocao: '2026-11-01T00:00', dtfimpromocao: '2026-11-02T00:00', itens: [{ idproduto: 990001, vlrpromocao: 1 }] });
      const p4J = (await p4.json().catch(() => ({}))) as any;
      check('PROMO 76.4: produto inativo → 422 PROMOCAO_PRODUTO_INATIVO', p4.status === 422 && p4J.code === 'PROMOCAO_PRODUTO_INATIVO', { status: p4.status, code: p4J.code });

      // 76.5) workflow: encerrar → situacao ENCERRADA; editar encerrada → 422; reabrir → ABERTA.
      const enc = await fetch(`${base}/${AP}/${codag}/encerrar`, { method: 'POST', headers: H });
      const encSit = (await pgPromo.query(`SELECT dtencerramento FROM agenda_promocao WHERE codagenda=$1`, [codag])).rows[0] as any;
      const putEnc = await fetch(`${base}/${AP}/${codag}`, { method: 'PUT', headers: H, body: JSON.stringify({ nomepromo: 'EDIT', dtiniciopromocao: '2026-09-01T08:00', dtfimpromocao: '2026-09-03T22:00', itens: [{ idproduto: 1, vlrpromocao: 1.29 }] }) });
      const putEncJ = (await putEnc.json().catch(() => ({}))) as any;
      const reab = await fetch(`${base}/${AP}/${codag}/reabrir`, { method: 'POST', headers: H });
      check('PROMO 76.5: encerrar → dtencerramento; editar encerrada → 422 PROMOCAO_ENCERRADA; reabrir → 200',
        enc.status === 200 && encSit?.dtencerramento != null && putEnc.status === 422 && putEncJ.code === 'PROMOCAO_ENCERRADA' && reab.status === 200,
        { enc: enc.status, put: [putEnc.status, putEncJ.code], reab: reab.status });

      // 76.6) RBAC: criar sem grant → 403.
      const p6 = await crPromo({ nomepromo: 'X', dtiniciopromocao: '2027-01-01T00:00', dtfimpromocao: '2027-01-02T00:00', itens: [{ idproduto: 1, vlrpromocao: 1 }] }, H_SEM_ACESSO);
      check('PROMO 76.6: criar sem grant RBAC → 403', p6.status === 403, { status: p6.status });

      // 76.7) corte-2 — APLICAR: cria agenda (produto 1, período 2028 p/ não sobrepor) → aplicar grava
      // multi_preco.promocao='S'+vrpromo+codagenda; encerrar REVERTE (promocao='N', vrpromo null, codagenda null).
      await pgPromo.query(`UPDATE multi_preco SET promocao='N', vrpromo=NULL, codagenda=NULL WHERE idproduto=1 AND idempresa=1`);
      const pa = await crPromo({ nomepromo: 'APLICAR 2028', dtiniciopromocao: '2028-01-01T00:00', dtfimpromocao: '2028-01-31T23:59', itens: [{ idproduto: 1, vlrpromocao: 4.44 }] });
      const paId = Number(((await pa.json().catch(() => ({}))) as any).codagenda);
      const apl = await fetch(`${base}/${AP}/${paId}/aplicar`, { method: 'POST', headers: H });
      const aplJ = (await apl.json().catch(() => ({}))) as any;
      const mpApos = (await pgPromo.query(`SELECT promocao, vrpromo, codagenda FROM multi_preco WHERE idproduto=1 AND idempresa=1`)).rows[0] as any;
      check('PROMO 76.7a: aplicar → multi_preco.promocao=S + vrpromo 4,44 + codagenda vinculado (1 aplicado)',
        apl.status === 200 && Number(aplJ.aplicados) === 1 && mpApos?.promocao === 'S' && Number(mpApos?.vrpromo) === 4.44 && Number(mpApos?.codagenda) === paId,
        { status: apl.status, aplicados: aplJ.aplicados, mp: mpApos });
      const enc2 = await fetch(`${base}/${AP}/${paId}/encerrar`, { method: 'POST', headers: H });
      const mpRev = (await pgPromo.query(`SELECT promocao, vrpromo, codagenda FROM multi_preco WHERE idproduto=1 AND idempresa=1`)).rows[0] as any;
      check('PROMO 76.7b: encerrar REVERTE o multi_preco (promocao=N, vrpromo null, codagenda null) — só as linhas desta agenda',
        enc2.status === 200 && mpRev?.promocao === 'N' && mpRev?.vrpromo == null && mpRev?.codagenda == null,
        { status: enc2.status, mp: mpRev });
      // 76.7c: aplicar em agenda encerrada → 422 PROMOCAO_ENCERRADA.
      const aplEnc = await fetch(`${base}/${AP}/${paId}/aplicar`, { method: 'POST', headers: H });
      check('PROMO 76.7c: aplicar em agenda encerrada → 422 PROMOCAO_ENCERRADA', aplEnc.status === 422 && ((await aplEnc.json().catch(() => ({}))) as any).code === 'PROMOCAO_ENCERRADA', { status: aplEnc.status });

      // 76.8) FOLD BAIXA: produto REPETIDO na mesma agenda → 422 PROMOCAO_PRODUTO_DUPLICADO (dedup, uCadAgendaPromocao:951).
      const p8 = await crPromo({ nomepromo: 'DUP', dtiniciopromocao: '2030-01-01T00:00', dtfimpromocao: '2030-01-02T00:00', itens: [{ idproduto: 1, vlrpromocao: 1 }, { idproduto: 1, vlrpromocao: 2 }] });
      const p8J = (await p8.json().catch(() => ({}))) as any;
      check('PROMO 76.8 FOLD: produto repetido na mesma agenda → 422 PROMOCAO_PRODUTO_DUPLICADO', p8.status === 422 && p8J.code === 'PROMOCAO_PRODUTO_DUPLICADO', { status: p8.status, code: p8J.code });

      // 76.9) FOLD ALTA: anti-sobreposição NÃO burlável por PUT parcial. Com config N: A(prod 3, 2031-01) + B(prod 3,
      // 2031-06 não sobrepõe) criadas OK; PUT em B mudando SÓ o período p/ sobrepor A (sem enviar itens) → validar faz
      // fallback aos itens PERSISTIDOS de B (prod 3) + novo período → detecta a sobreposição com A → 422.
      await pgPromo.query(`UPDATE configuracoes SET valor='N' WHERE codigo='PERMITE_PRODUTO_MAIS_UMA_AGENDA'`);
      const p9a = await crPromo({ nomepromo: 'A31', dtiniciopromocao: '2031-01-01T00:00', dtfimpromocao: '2031-01-31T00:00', itens: [{ idproduto: 3, vlrpromocao: 1 }] });
      const p9b = await crPromo({ nomepromo: 'B31', dtiniciopromocao: '2031-06-01T00:00', dtfimpromocao: '2031-06-30T00:00', itens: [{ idproduto: 3, vlrpromocao: 1 }] });
      const p9bId = Number(((await p9b.json().catch(() => ({}))) as any).codagenda);
      const p9put = await fetch(`${base}/${AP}/${p9bId}`, { method: 'PUT', headers: H, body: JSON.stringify({ dtiniciopromocao: '2031-01-10T00:00', dtfimpromocao: '2031-01-20T00:00' }) });
      const p9putJ = (await p9put.json().catch(() => ({}))) as any;
      await pgPromo.query(`UPDATE configuracoes SET valor='S' WHERE codigo='PERMITE_PRODUTO_MAIS_UMA_AGENDA'`);
      check('PROMO 76.9 FOLD ALTA: PUT parcial (só período) NÃO burla a anti-sobreposição (fallback aos itens persistidos) → 422',
        p9a.status === 201 && p9b.status === 201 && p9put.status === 422 && p9putJ.code === 'PROMOCAO_PRODUTO_SOBREPOSTO',
        { a: p9a.status, b: p9b.status, put: [p9put.status, p9putJ.code] });
    } finally {
      await pgPromo.end();
    }
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
