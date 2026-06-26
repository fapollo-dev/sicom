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
