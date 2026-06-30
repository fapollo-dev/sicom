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

    // 18.5) NEGATIVO bloqueia: saída maior que o saldo → 422, saldo INALTERADO (rollback atômico).
    const nfNeg = await novaNf(baseNf({ tipo: 'S', nronf: 'P4002', cfop: '5102', codparceiro: 20, itens: [{ codproduto: 1, quantidade: 999999, vrvenda: 1, cfop: '5102', aliquota: 'T01' }] }));
    const procNeg = await fetch(`${base}/fiscal/nf/${nfNeg}/processar`, { method: 'POST', headers: H });
    const procNegBody = (await procNeg.json().catch(() => ({}))) as any;
    const s4 = await saldoProd1();
    check(
      'processar saída que deixaria saldo negativo → 422 NF_ESTOQUE_NEGATIVO, saldo INALTERADO (rollback)',
      procNeg.status === 422 && procNegBody.code === 'NF_ESTOQUE_NEGATIVO' && s4 === s3 && procNeg.status !== 500,
      { status: procNeg.status, code: procNegBody.code, s4, s3 },
    );

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
