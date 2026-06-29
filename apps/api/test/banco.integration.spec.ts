import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type EmbeddedPostgres from 'embedded-postgres';
import { startEmbeddedPg, PG_CONN } from './embedded-db';
import { DatabaseProvider } from '../src/shared/database/database.provider';
import { BancoRepository } from '../src/modules/cadastro/banco.repository';
import { AcessoService } from '../src/shared/acesso/acesso.service';
import { operacoesContaCrudConfig } from '../src/modules/cadastro/operacoes-conta.crud';
import { contasBancariasCrudConfig } from '../src/modules/cadastro/contas-bancarias.crud';
import { LoteCobrancaRepository } from '../src/modules/cobranca/lote-cobranca.repository';
import { CrudEngineService } from '../src/shared/crud/crud-engine.service';
import { AggregateEngineService } from '../src/shared/crud/aggregate-engine.service';
import { loteCobrancaAggregateConfig } from '../src/modules/cobranca/lote-cobranca.aggregate';
import { parceiroAggregateConfig } from '../src/modules/cadastro/parceiro.aggregate';
import { produtoAggregateConfig } from '../src/modules/cadastro/produto.aggregate';
import { unidadeCrudConfig } from '../src/modules/cadastro/unidade.crud';
import { familiasCrudConfig } from '../src/modules/cadastro/familias.crud';
import { aliquotaCrudConfig } from '../src/modules/cadastro/aliquota.crud';
import { marcasCrudConfig } from '../src/modules/cadastro/marcas.crud';
import { bairroCrudConfig } from '../src/modules/cadastro/bairro.crud';
import { precoCrudConfig } from '../src/modules/cadastro/preco.crud';
import { ncmCrudConfig } from '../src/modules/cadastro/ncm.crud';
import { cidadeCrudConfig } from '../src/modules/cadastro/cidade.crud';
import { TributacaoRepository } from '../src/modules/precificacao/tributacao.repository';
import { PrecificacaoProdutoService } from '../src/modules/precificacao/precificacao-produto.service';
import { FiscalPricingService } from '../src/modules/precificacao/preco-fiscal.service';
import { runWithTenant } from '../src/shared/tenant/tenant-context';

/**
 * Integração contra Postgres REAL (embedded). Prova paridade de RESULTADO + o
 * efeito-fantasma do legado: cada escrita gera a linha no outbox (replicação),
 * e o carimbo de auditoria preenche USULTALTERACAO/DTULTIMALTERACAO/DTCADASTRO.
 */
let pg: EmbeddedPostgres;
let repo: BancoRepository;
let dbp: DatabaseProvider;

const withTenant = <T>(fn: () => Promise<T>) =>
  runWithTenant({ tenantId: 'pinheirao', operadorId: 7, empresaId: 1 }, fn);

beforeAll(async () => {
  pg = await startEmbeddedPg();
  dbp = new DatabaseProvider(PG_CONN);
  repo = new BancoRepository(dbp);
}, 120_000);

afterAll(async () => {
  await dbp?.closeAll();
  await pg?.stop();
});

describe('Integração — Cadastro de Bancos (Postgres real)', () => {
  it('seed carregou os 15 bancos reais + GET_BANCOS funciona', async () => {
    const lista = await withTenant(() => repo.list());
    expect(lista.length).toBe(15);
    // a view renomeia codbco→codigo, codbcoblt→codigo_banco
    expect(lista[0]).toHaveProperty('codigo');
    expect(lista[0]).toHaveProperty('codigo_banco');
  });

  it('CREATE: insere delta, gera codbco por sequence (16), carimba e gera outbox(INSERT)', async () => {
    const codbco = await withTenant(() =>
      repo.create({ agencia: '9999', banco: 'TESTE CLAUDE', cidade: 'TESTE', agencia_cedente: 1 }),
    );
    expect(codbco).toBe(16); // seed vai até 15 → sequence dá 16

    const row = await withTenant(() => repo.read(16));
    expect(row?.banco).toBe('TESTE CLAUDE');
    expect(row?.usultalteracao).toBe(7); // carimbo do operador
    expect(row?.dtcadastro).toBeTruthy(); // carimbo de data (insert)
    expect(row?.dtultimalteracao).toBeTruthy();

    const ob = await outbox(16, 'INSERT');
    expect(ob.length).toBe(1);
    expect(ob[0].instrucao).toBe('SELECT * FROM BANCOS WHERE CODBCO =16');
  });

  it('UPDATE: altera só CIDADE, recarimba e gera outbox(UPDATE)', async () => {
    await withTenant(() => repo.update(16, { cidade: 'TESTE2' }));
    const row = await withTenant(() => repo.read(16));
    expect(row?.cidade).toBe('TESTE2');
    expect(row?.banco).toBe('TESTE CLAUDE'); // intacto (delta)
    const ob = await outbox(16, 'UPDATE');
    expect(ob.length).toBe(1);
  });

  it('DELETE: remove fisicamente e gera outbox(DELETE)', async () => {
    await withTenant(() => repo.remove(16));
    const row = await withTenant(() => repo.read(16));
    expect(row).toBeUndefined();
    const ob = await outbox(16, 'DELETE');
    expect(ob.length).toBe(1);
  });

  it('replicação (PARCIAL nesta fatia): 1 evento por operação I/U/D para o codbco 16', async () => {
    // ⚠️ NÃO é paridade completa: o legado faz FAN-OUT por terminal (3 lojas → 3 linhas/op,
    // e o carimbo de auditoria também replica → 15 linhas no teste). Aqui emitimos 1 por op.
    // O fan-out por terminal é trilha de sync (Fase 4) — ver db-types.ts e o dossiê §6.
    const all = await runWithTenant({ tenantId: 'pinheirao' }, () =>
      dbp.dbFor('pinheirao').selectFrom('outbox').selectAll().where('chave', '=', 16).execute(),
    );
    const tipos = all.map((r) => r.tipo).sort();
    expect(tipos).toEqual(['DELETE', 'INSERT', 'UPDATE']);
  });

  it('editar PRESERVA dtcadastro e atualiza dtultimalteracao (carimbo correto)', async () => {
    const novo = await withTenant(() =>
      repo.create({ banco: 'BANCO X', cidade: 'CIDADE X' }),
    );
    const antes = await withTenant(() => repo.read(novo));
    expect(antes?.dtcadastro).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    await withTenant(() => repo.update(novo, { cidade: 'CIDADE Y' }));
    const depois = await withTenant(() => repo.read(novo));
    const ms = (v: unknown) => new Date(v as string).getTime();
    // dtcadastro intacto (edição não recarimba a data de cadastro)...
    expect(ms(depois?.dtcadastro)).toBe(ms(antes?.dtcadastro));
    // ...mas dtultimalteracao avançou.
    expect(ms(depois?.dtultimalteracao)).toBeGreaterThan(ms(antes?.dtultimalteracao));
  });
});

describe('2ª tela — Operações de Conta via ENGINE (combo TIPO; sem replicação)', () => {
  const eng = () => new CrudEngineService(dbp);
  const cfg = operacoesContaCrudConfig;
  it('seed (TRANSFERENCIA) + view decodifica TIPO C→CREDITO', async () => {
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    expect(lista.length).toBe(1);
    expect(lista[0].tipo).toBe('CREDITO'); // a view decodifica
  });
  it('CREATE: insere (descricao+tipo), gera codopconta=1, carimba; sem outbox', async () => {
    const cod = await withTenant(() => eng().create(cfg, { descricao: 'JUROS', tipo: 'D' }));
    expect(cod).toBe(1);
    const row = (await withTenant(() => eng().read(cfg, 1))) as any;
    expect(row.descricao).toBe('JUROS');
    expect(row.tipo).toBe('D');
    expect(row.usultalteracao).toBe(7);
    const ob = await runWithTenant({ tenantId: 'pinheirao' }, () =>
      dbp.dbFor('pinheirao').selectFrom('outbox').selectAll().where('tabela', '=', 'OPERACOES_CONTA').execute(),
    );
    expect(ob.length).toBe(0); // replica:false → sem outbox
  });
  it('UPDATE delta (tipo D→C) e DELETE (hard)', async () => {
    await withTenant(() => eng().update(cfg, 1, { tipo: 'C' }));
    expect(((await withTenant(() => eng().read(cfg, 1))) as any).tipo).toBe('C');
    await withTenant(() => eng().remove(cfg, 1));
    expect(await withTenant(() => eng().read(cfg, 1))).toBeUndefined();
  });
});

describe('3ª tela — Contas Bancárias via ENGINE (FK/lookup → bancos)', () => {
  const eng = () => new CrudEngineService(dbp);
  const cfg = contasBancariasCrudConfig;
  it('seed (3 contas, idempresa=1) + view traz o NOME do banco (lookup via JOIN)', async () => {
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    expect(lista.length).toBe(3); // tela completa: 3 contas semeadas (empresa 1)
    const matriz = lista.find((c) => c.titular === 'APOLLO MATRIZ LTDA');
    expect(matriz?.banco).toBe('BANCO DO BRASIL'); // JOIN na view (codbco=1)
  });
  it('CREATE com FK válido (codbco=2) funciona; carimba', async () => {
    const cod = await withTenant(() => eng().create(cfg, { codbco: 2, titular: 'NOVA', nroconta: '111', ativo: 'S' }));
    const row = (await withTenant(() => eng().read(cfg, cod))) as any;
    expect(row.codbco).toBe(2);
    expect(row.usultalteracao).toBe(7);
  });
  it('CREATE com FK inválido (banco inexistente) é REJEITADO pelo banco (FK)', async () => {
    await expect(
      withTenant(() => eng().create(cfg, { codbco: 99999, titular: 'X', ativo: 'S' })),
    ).rejects.toThrow();
  });
});

describe('4ª tela — Lote de Cobrança (MESTRE-DETALHE: agregado + cascata)', () => {
  const repo = () => new LoteCobrancaRepository(dbp);
  let cod: number;

  it('CREATE agregado: header + 2 itens numa transação', async () => {
    cod = await withTenant(() =>
      repo().create({ codparceiro: 10, data: '2026-06-24' }, [{ codrcb: 100 }, { codrcb: 200 }]),
    );
    const lote = await withTenant(() => repo().read(cod));
    expect(lote?.codparceiro).toBe(10);
    expect(lote?.itens.length).toBe(2);
    expect(lote?.itens.map((i) => i.codrcb).sort()).toEqual([100, 200]);
    expect(lote?.usultalteracao).toBe(7); // carimbo no header
  });

  it('UPDATE substitui os itens (3 novos no lugar dos 2)', async () => {
    await withTenant(() =>
      repo().update(cod, { codparceiro: 10, data: '2026-06-24' }, [
        { codrcb: 300 },
        { codrcb: 400 },
        { codrcb: 500 },
      ]),
    );
    const lote = await withTenant(() => repo().read(cod));
    expect(lote?.itens.length).toBe(3);
    expect(lote?.itens.map((i) => i.codrcb).sort()).toEqual([300, 400, 500]);
  });

  it('DELETE em cascata: header e itens somem juntos', async () => {
    await withTenant(() => repo().remove(cod));
    expect(await withTenant(() => repo().read(cod))).toBeUndefined();
    const itensOrfaos = await runWithTenant({ tenantId: 'pinheirao' }, () =>
      dbp.dbFor('pinheirao').selectFrom('itens_lotecob').selectAll().where('codlotecob', '=', cod).execute(),
    );
    expect(itensOrfaos.length).toBe(0); // cascata removeu os itens
  });

  it('listagem traz a contagem de itens (view com subselect)', async () => {
    const c = await withTenant(() => repo().create({ codparceiro: 1, data: '2026-06-24' }, [{ codrcb: 1 }]));
    const lista = await withTenant(() => repo().list());
    const novo = lista.find((l) => l.codlotecob === c);
    expect(Number(novo?.qtd_itens)).toBe(1);
  });
});

describe('5ª tela — Marcas via ENGINE CRUD (config declarativa; soft-delete herdado)', () => {
  // Sem repository/service por entidade: o engine genérico + a config marcasCrudConfig.
  const eng = () => new CrudEngineService(dbp);
  const cfg = marcasCrudConfig;
  it('seed: 3 marcas ativas na listagem', async () => {
    const lista = await withTenant(() => eng().list(cfg));
    expect(lista.length).toBe(3);
  });
  it('SOFT-DELETE herdado do engine: excluir NÃO apaga — INDR=E, some da listagem E não reabre por código', async () => {
    const cod = await withTenant(() => eng().create(cfg, { descricao: 'MARCA TESTE' }));
    expect((await withTenant(() => eng().list(cfg))).length).toBe(4);

    await withTenant(() => eng().remove(cfg, cod)); // soft-delete (via config)

    // PARIDADE BR-05/G-05: carregar por código NÃO reabre o excluído → read() esconde.
    const row = await withTenant(() => eng().read(cfg, cod));
    expect(row).toBeUndefined();

    // mas a linha CONTINUA na tabela (soft-delete): INDR=E + carimbo herdado.
    const persistido = (await withTenant(() =>
      (dbp.forTenantRead() as any).selectFrom(cfg.tabela).selectAll().where(cfg.pk, '=', cod).executeTakeFirst(),
    )) as any;
    expect(persistido).toBeDefined();
    expect(persistido.indr).toBe('E');
    expect(persistido.indr_usuario).toBe(7); // carimbo herdado
    expect(persistido.indr_data).toBeTruthy();

    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    expect(lista.length).toBe(3);
    expect(lista.find((m) => m.codigo === cod)).toBeUndefined();
  });
});

describe('Fiscal — precificação REUSANDO regra do legado (DET_ALIQUOTA) + Reforma', () => {
  const svc = () => new PrecificacaoProdutoService(new TributacaoRepository(dbp), new FiscalPricingService());
  const base = { custo: 10, margem: 30, pis: 1.65, cofins: 7.6, despOperacional: 0 } as const;

  it("ATUAL T01/SP (ICMS 17% integral) → preço 'por dentro' ~22,86; CST 0", async () => {
    const r = await withTenant(() => svc().precificar({ ...base, aliquota: 'T01', uf: 'SP', regime: 'atual' }));
    expect(r.valorVenda).toBeCloseTo(22.86, 2);
    expect(r.cst).toBe(0);
    expect(r.icmEfetivo).toBe(17);
  });

  it('ATUAL T56/MG REUSA a REDUÇÃO DE BASE do legado (18%→8,4%, CST 20) → ~19,10', async () => {
    const r = await withTenant(() => svc().precificar({ ...base, aliquota: 'T56', uf: 'MG', regime: 'atual' }));
    expect(r.icmEfetivo).toBe(8.4); // veio da tabela legada, não reinventado
    expect(r.cst).toBe(20);
    expect(r.baseReduzida).toBe(true);
    expect(r.valorVenda).toBeCloseTo(19.1, 2);
  });

  it('ATUAL STB/SP é SUBSTITUIÇÃO TRIBUTÁRIA (CST 60, sem ICMS na saída) → ~16,46', async () => {
    const r = await withTenant(() => svc().precificar({ ...base, aliquota: 'STB', uf: 'SP', regime: 'atual' }));
    expect(r.cst).toBe(60);
    expect(r.icmEfetivo).toBe(0); // ST: ICMS já recolhido na cadeia (regra do legado)
    expect(r.valorVenda).toBeCloseTo(16.46, 2);
  });

  it('TRANSIÇÃO 2026 (T01/SP): legado + IBS/CBS-teste por fora; fonte traz EC 132', async () => {
    const r = await withTenant(() =>
      svc().precificar({ ...base, aliquota: 'T01', uf: 'SP', regime: 'transicao', dataRef: '2026-06-01' }),
    );
    expect(r.valorVenda).toBeCloseTo(23.09, 2); // 22.86 * 1.01
    expect(r.fonte).toContain('EC 132');
  });

  it('REFORMA plena (SP, 2033): IBS+CBS por fora → ~16,45', async () => {
    const r = await withTenant(() =>
      svc().precificar({ custo: 10, margem: 30, pis: 0, cofins: 0, aliquota: 'T01', uf: 'SP', regime: 'reforma', dataRef: '2033-06-01' }),
    );
    expect(r.valorVenda).toBeCloseTo(16.45, 2);
  });

  it('aliquota não cadastrada → erro tipado (não inventa alíquota)', async () => {
    await expect(
      withTenant(() => svc().precificar({ ...base, aliquota: 'XYZ', uf: 'SP', regime: 'atual' })),
    ).rejects.toThrow('ALIQUOTA_NAO_CADASTRADA');
  });

  it('ICMS-ST REUSA o MVA do legado (NCM 21032010, MVA 50%) → ST R$15 num produto R$100', async () => {
    const trib = new TributacaoRepository(dbp);
    const fiscal = new FiscalPricingService();
    const idx = await withTenant(() => trib.resolverIndexador('21032010'));
    expect(idx.mva).toBe(50); // veio do INDEXADOR_TRIBUTARIO legado
    // baseST=100*1.5=150 ; ICMS-ST = 150*18% - 100*12% = 27 - 12 = 15
    const st = fiscal.calcularIcmsSt(100, { aliquotaDest: idx.aliquotaDest, icmFonte: idx.icmFonte, mva: idx.mva }, 'atual');
    expect(st.baseSt).toBeCloseTo(150, 2);
    expect(st.icmsSt).toBeCloseTo(15, 2);
    expect(st.aplicavel).toBe(true);
  });

  it('DESENVOLVIDO: sob a Reforma a ST é EXTINTA → ICMS-ST = 0 / não aplicável', async () => {
    const fiscal = new FiscalPricingService();
    const st = fiscal.calcularIcmsSt(100, { aliquotaDest: 18, icmFonte: 12, mva: 50 }, 'reforma');
    expect(st.icmsSt).toBe(0);
    expect(st.aplicavel).toBe(false);
  });
});

describe('Pesquisa (engine.list com filtro campo+operador+valor + ordenação)', () => {
  const eng = () => new CrudEngineService(dbp);
  const cfg = marcasCrudConfig; // seed: NESTLE, UNILEVER, COCA-COLA
  it("contém: descricao contém 'COLA' → só COCA-COLA", async () => {
    const r = (await withTenant(() => eng().list(cfg, { campo: 'descricao', operador: 'contem', valor: 'cola' }))) as any[];
    expect(r.map((m) => m.descricao)).toEqual(['COCA-COLA']);
  });
  it("começa: descricao começa com 'UNI' → UNILEVER", async () => {
    const r = (await withTenant(() => eng().list(cfg, { campo: 'descricao', operador: 'comeca', valor: 'uni' }))) as any[];
    expect(r.map((m) => m.descricao)).toEqual(['UNILEVER']);
  });
  it('ordenação desc por descricao', async () => {
    const r = (await withTenant(() => eng().list(cfg, { orderBy: 'descricao', orderDir: 'desc' }))) as any[];
    expect(r.map((m) => m.descricao)).toEqual(['UNILEVER', 'NESTLE', 'COCA-COLA']);
  });
  it('campo fora da whitelist é ignorado (anti-injection)', async () => {
    const r = (await withTenant(() => eng().list(cfg, { campo: 'idmarca; drop table', operador: 'contem', valor: 'x' }))) as any[];
    expect(r.length).toBe(3); // filtro ignorado → lista normal
  });

  // rdgAtivo (F6): a 5ª tela deixou 'MARCA TESTE' soft-deletada (INDR=E)
  it("situação 'ativos' (default): só os 3 INDR='I'", async () => {
    const r = (await withTenant(() => eng().list(cfg, { situacao: 'ativos' }))) as any[];
    expect(r.length).toBe(3);
    expect(r.find((m) => m.descricao === 'MARCA TESTE')).toBeUndefined();
  });
  it("situação 'inativos': só os excluídos INDR='E' → MARCA TESTE", async () => {
    const r = (await withTenant(() => eng().list(cfg, { situacao: 'inativos' }))) as any[];
    expect(r.map((m) => m.descricao)).toEqual(['MARCA TESTE']);
  });
  it("situação 'todos': ativos + inativos → 4", async () => {
    const r = (await withTenant(() => eng().list(cfg, { situacao: 'todos' }))) as any[];
    expect(r.length).toBe(4);
  });
});

describe('HISTORICO_DINAMICO (SetaHistorico_Dinamico — auditoria por campo, mesma transação)', () => {
  const eng = () => new CrudEngineService(dbp);
  const cfg = marcasCrudConfig;
  const hist = (valorChave: string) =>
    withTenant(() =>
      (dbp.forTenantRead() as any)
        .selectFrom('historico_dinamico')
        .selectAll()
        .where('tabela', '=', 'MARCAS')
        .where('valor_chave', '=', valorChave)
        .orderBy('codhistorico')
        .execute(),
    ) as Promise<any[]>;

  let cod: number;
  it('CREATE grava 1 linha por campo: DESCRICAO null→valor, historico=INSERT', async () => {
    cod = await withTenant(() => eng().create(cfg, { descricao: 'HIST CREATE' }));
    const ins = (await hist(String(cod))).filter((r) => r.historico === 'INSERT');
    expect(ins.length).toBe(1);
    expect(ins[0]).toMatchObject({
      campo: 'DESCRICAO',
      valor_anterior: null,
      valor_atual: 'HIST CREATE',
      chave: 'IDMARCA',
      codoperador: 7,
      origem: 'FRMCADMARCAS',
    });
  });
  it('UPDATE grava o diff: DESCRICAO anterior→atual, historico=UPDATE', async () => {
    await withTenant(() => eng().update(cfg, cod, { descricao: 'HIST UPDATE' }));
    const upd = (await hist(String(cod))).filter((r) => r.historico === 'UPDATE');
    expect(upd.length).toBe(1);
    expect(upd[0]).toMatchObject({ campo: 'DESCRICAO', valor_anterior: 'HIST CREATE', valor_atual: 'HIST UPDATE' });
  });
  it('UPDATE sem mudança real NÃO grava histórico (diff vazio)', async () => {
    const antes = (await hist(String(cod))).length;
    await withTenant(() => eng().update(cfg, cod, { descricao: 'HIST UPDATE' })); // mesmo valor
    expect((await hist(String(cod))).length).toBe(antes);
  });
  it('DELETE grava marca única historico=DELETE', async () => {
    await withTenant(() => eng().remove(cfg, cod));
    expect((await hist(String(cod))).filter((r) => r.historico === 'DELETE').length).toBe(1);
  });
});

describe('HISTORICO_DINAMICO no vertical BANCOS (piloto — mesmo caminho do engine)', () => {
  const hist = (valorChave: string) =>
    withTenant(() =>
      (dbp.forTenantRead() as any)
        .selectFrom('historico_dinamico')
        .selectAll()
        .where('tabela', '=', 'BANCOS')
        .where('valor_chave', '=', valorChave)
        .orderBy('codhistorico')
        .execute(),
    ) as Promise<any[]>;

  let codbco: number;
  it('CREATE grava histórico por campo (INSERT) com chave CODBCO', async () => {
    codbco = await withTenant(() =>
      repo.create({ agencia: '1234', banco: 'BANCO HIST', cidade: 'SP', agencia_cedente: 1 }),
    );
    const ins = (await hist(String(codbco))).filter((r) => r.historico === 'INSERT');
    expect(ins.length).toBeGreaterThanOrEqual(1);
    expect(ins.find((r) => r.campo === 'BANCO')).toMatchObject({ valor_atual: 'BANCO HIST', chave: 'CODBCO' });
  });
  it('UPDATE grava o diff (só o campo que mudou)', async () => {
    await withTenant(() => repo.update(codbco, { agencia: '1234', banco: 'BANCO HIST 2', cidade: 'SP', agencia_cedente: 1 }));
    const upd = (await hist(String(codbco))).filter((r) => r.historico === 'UPDATE');
    expect(upd.find((r) => r.campo === 'BANCO')).toMatchObject({ valor_anterior: 'BANCO HIST', valor_atual: 'BANCO HIST 2' });
    // cidade/agencia não mudaram → não geram linha
    expect(upd.find((r) => r.campo === 'CIDADE')).toBeUndefined();
  });
  it('DELETE grava marca única historico=DELETE', async () => {
    await withTenant(() => repo.remove(codbco));
    expect((await hist(String(codbco))).filter((r) => r.historico === 'DELETE').length).toBe(1);
  });
});

describe('RBAC — AcessoService (espelha PossuiAcessoForm, tabela PERMISSOES)', () => {
  const acesso = () => new AcessoService(dbp);
  it('operador 7 (empresa 1) TEM BTNGRAVAR em FRMCADBANCOS', async () => {
    const ok = await runWithTenant({ tenantId: 'pinheirao', operadorId: 7, empresaId: 1 }, () =>
      acesso().possuiAcesso('FRMCADBANCOS', 'BTNGRAVAR'),
    );
    expect(ok).toBe(true);
  });
  it('operador 999 NÃO tem acesso (sem grant) → nega', async () => {
    const ok = await runWithTenant({ tenantId: 'pinheirao', operadorId: 999, empresaId: 1 }, () =>
      acesso().possuiAcesso('FRMCADBANCOS', 'BTNGRAVAR'),
    );
    expect(ok).toBe(false);
  });
  it('sem operador/empresa no contexto → fail-closed (nega)', async () => {
    const ok = await runWithTenant({ tenantId: 'pinheirao' }, () =>
      acesso().possuiAcesso('FRMCADBANCOS', 'BTNGRAVAR'),
    );
    expect(ok).toBe(false);
  });
});

describe('6ª tela — BAIRROS (1ª HERDEIRA COMPLETA via engine: texto+combo+flag)', () => {
  const eng = () => new CrudEngineService(dbp);
  const cfg = bairroCrudConfig;

  it('seed: 4 bairros ativos; a view DECODIFICA REGIAO (C→CENTRO, S→SUL...)', async () => {
    const lista = (await withTenant(() => eng().list(cfg, { orderBy: 'idbairro', orderDir: 'asc' }))) as any[];
    expect(lista.length).toBe(4);
    expect(lista[0]).toMatchObject({ descricao: 'CENTRO', regiao: 'CENTRO' }); // 'C' decodificado
    expect(lista.find((b) => b.descricao === 'JARDIM AMERICA')?.regiao).toBe('SUL'); // 'S' decodificado
  });

  it('READ traz o CÓDIGO CRU de REGIAO (p/ o combo do form), não o decode', async () => {
    const row = (await withTenant(() => eng().read(cfg, 1))) as any;
    expect(row.regiao).toBe('C'); // tabela = código cru; a view é que decodifica
    expect(row.ativo).toBe('S');
  });

  it('PESQUISA por REGIAO decodificada (contém "SUL") → JARDIM AMERICA', async () => {
    const r = (await withTenant(() => eng().list(cfg, { campo: 'regiao', operador: 'contem', valor: 'sul' }))) as any[];
    expect(r.map((b) => b.descricao)).toContain('JARDIM AMERICA');
  });

  it('CREATE com combo: grava REGIAO crua + ATIVO; aparece na lista decodificada', async () => {
    const id = await withTenant(() => eng().create(cfg, { descricao: 'BAIRRO NOVO', regiao: 'NL', ativo: 'S' }));
    const row = (await withTenant(() => eng().read(cfg, id))) as any;
    expect(row).toMatchObject({ regiao: 'NL', ativo: 'S' });
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    expect(lista.find((b) => b.idbairro === id)?.regiao).toBe('NORDESTE'); // 'NL' decodificado
  });

  it('SOFT-DELETE (INDR=E) some da Pesquisa; F6 situação=inativos o reencontra', async () => {
    const id = await withTenant(() => eng().create(cfg, { descricao: 'A EXCLUIR', regiao: 'N' }));
    await withTenant(() => eng().remove(cfg, id));
    const ativos = (await withTenant(() => eng().list(cfg))) as any[];
    expect(ativos.find((b) => b.idbairro === id)).toBeUndefined();
    const inativos = (await withTenant(() => eng().list(cfg, { situacao: 'inativos' }))) as any[];
    expect(inativos.find((b) => b.idbairro === id)).toBeDefined();
  });

  it('HISTORICO_DINAMICO por campo: UPDATE de REGIAO grava diff (crú→crú)', async () => {
    const id = await withTenant(() => eng().create(cfg, { descricao: 'HIST BAIRRO', regiao: 'C', ativo: 'S' }));
    await withTenant(() => eng().update(cfg, id, { descricao: 'HIST BAIRRO', regiao: 'S', ativo: 'S' }));
    const h = (await withTenant(() =>
      (dbp.forTenantRead() as any)
        .selectFrom('historico_dinamico')
        .selectAll()
        .where('tabela', '=', 'BAIRRO')
        .where('valor_chave', '=', String(id))
        .where('historico', '=', 'UPDATE')
        .execute(),
    )) as any[];
    expect(h.find((r) => r.campo === 'REGIAO')).toMatchObject({ valor_anterior: 'C', valor_atual: 'S' });
    expect(h.find((r) => r.campo === 'DESCRICAO')).toBeUndefined(); // descrição não mudou
  });
});

describe('7ª tela — PRECO (palette completo: número/moeda + 2 checkbox via engine)', () => {
  const eng = () => new CrudEngineService(dbp);
  const cfg = precoCrudConfig;

  it('seed: 2 linhas reais; VALOR_REAJUSTE preservado (numeric 13,2)', async () => {
    const lista = (await withTenant(() => eng().list(cfg, { orderBy: 'id_preco', orderDir: 'asc' }))) as any[];
    expect(lista.length).toBe(2);
    // pg devolve numeric como string — comparar por valor numérico
    expect(Number(lista.find((p) => p.descricao === 'PIZZARIA')?.valor_reajuste)).toBeCloseTo(10.0, 2);
    expect(lista.find((p) => p.descricao === 'PIZZARIA')?.ativo).toBe('S');
  });

  it('CREATE com número decimal + flags: persiste e relê com precisão', async () => {
    const id = await withTenant(() =>
      eng().create(cfg, { descricao: 'REAJUSTE 7,25', valor_reajuste: 7.25, reajuste: 'S', ativo: 'N' }),
    );
    const row = (await withTenant(() => eng().read(cfg, id))) as any;
    expect(Number(row.valor_reajuste)).toBeCloseTo(7.25, 2);
    expect(row).toMatchObject({ reajuste: 'S', ativo: 'N' });
  });

  it('UPDATE do número grava histórico do campo (10.00→12.50)', async () => {
    const id = await withTenant(() => eng().create(cfg, { descricao: 'P', valor_reajuste: 10, reajuste: 'N', ativo: 'S' }));
    await withTenant(() => eng().update(cfg, id, { descricao: 'P', valor_reajuste: 12.5, reajuste: 'N', ativo: 'S' }));
    const h = (await withTenant(() =>
      (dbp.forTenantRead() as any)
        .selectFrom('historico_dinamico')
        .selectAll()
        .where('tabela', '=', 'PRECO')
        .where('valor_chave', '=', String(id))
        .where('historico', '=', 'UPDATE')
        .execute(),
    )) as any[];
    const linha = h.find((r) => r.campo === 'VALOR_REAJUSTE');
    expect(linha).toBeDefined();
    expect(Number(linha.valor_anterior)).toBeCloseTo(10, 2);
    expect(Number(linha.valor_atual)).toBeCloseTo(12.5, 2);
  });

  it('PESQUISA por valor (igual 5.5) → TESTE', async () => {
    const r = (await withTenant(() => eng().list(cfg, { campo: 'valor_reajuste', operador: 'igual', valor: '5.50' }))) as any[];
    expect(r.map((p) => p.descricao)).toContain('TESTE');
  });
});

describe('8ª tela — NCM (CHAVE NATURAL + data + memo via engine; hard-delete)', () => {
  const eng = () => new CrudEngineService(dbp);
  const cfg = ncmCrudConfig;
  // pg devolve `date` como Date (meia-noite local) ou string — normaliza tz-safe p/ 'YYYY-MM-DD'.
  const ymd = (v: any): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v.slice(0, 10);
    const d = v as Date;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('seed: 3 NCMs; view casta DESCRICAO e traz vigência', async () => {
    const lista = (await withTenant(() => eng().list(cfg, { orderBy: 'codigo', orderDir: 'asc' }))) as any[];
    expect(lista.length).toBe(3);
    const ketchup = lista.find((n) => n.codigo === 21032010);
    expect(ketchup.descricao).toContain('ketchup');
    expect(ymd(ketchup.vigencia_inicio)).toBe('2017-01-01');
  });

  it('CREATE com CHAVE NATURAL: o CODIGO vem do dto (não sequence)', async () => {
    const id = await withTenant(() =>
      eng().create(cfg, {
        codigo: 84713012,
        ncmsh: '84713012',
        descricao: 'Máquinas de processamento de dados',
        ipi: '0',
        vigencia_inicio: '2020-01-01',
        observacao: 'memo de teste',
      }),
    );
    expect(id).toBe(84713012); // a PK é a que digitamos
    const row = (await withTenant(() => eng().read(cfg, 84713012))) as any;
    expect(row).toMatchObject({ codigo: 84713012, ncmsh: '84713012', observacao: 'memo de teste' });
    expect(ymd(row.vigencia_inicio)).toBe('2020-01-01');
  });

  it('PESQUISA por descricao (contém "cavalos") e por codigo', async () => {
    const r = (await withTenant(() => eng().list(cfg, { campo: 'descricao', operador: 'contem', valor: 'cavalos' }))) as any[];
    expect(r.length).toBeGreaterThanOrEqual(1);
    const porCod = (await withTenant(() => eng().list(cfg, { campo: 'codigo', operador: 'igual', valor: '1012100' }))) as any[];
    expect(porCod.map((n) => n.codigo)).toEqual([1012100]);
  });

  it('HARD-DELETE: NCM não tem INDR → some de verdade da tabela', async () => {
    const id = await withTenant(() => eng().create(cfg, { codigo: 99999999, ncmsh: '99999999', descricao: 'TEMP' }));
    await withTenant(() => eng().remove(cfg, id));
    const row = await withTenant(() => eng().read(cfg, 99999999));
    expect(row).toBeUndefined(); // apagado fisicamente
  });

  it('HISTORICO do memo: UPDATE de OBSERVACAO grava diff', async () => {
    await withTenant(() => eng().update(cfg, 21032010, { observacao: 'NCM do ketchup — revisado' }));
    const h = (await withTenant(() =>
      (dbp.forTenantRead() as any)
        .selectFrom('historico_dinamico')
        .selectAll()
        .where('tabela', '=', 'NCM')
        .where('valor_chave', '=', '21032010')
        .where('campo', '=', 'OBSERVACAO')
        .execute(),
    )) as any[];
    expect(h.length).toBeGreaterThanOrEqual(1);
    // VALOR_* trunca em 20 → 'NCM do ketchup — rev' (prefixo)
    expect(h[0].valor_atual).toContain('NCM do ketchup');
  });
});

describe('9ª tela — CIDADES + LOOKUP/FK em Bairros (FK real Bairro→Cidades)', () => {
  const eng = () => new CrudEngineService(dbp);

  it('CIDADES: seed 4 (chave natural, sem auditoria); pesquisa por nome', async () => {
    const lista = (await withTenant(() => eng().list(cidadeCrudConfig, { orderBy: 'cidade', orderDir: 'asc' }))) as any[];
    expect(lista.length).toBe(4);
    const r = (await withTenant(() => eng().list(cidadeCrudConfig, { campo: 'cidade', operador: 'contem', valor: 'paulo' }))) as any[];
    expect(r.map((c) => c.idcidade)).toContain(3550308);
  });

  it('Bairro com idcidade VÁLIDA grava (lookup ok); pesquisa não quebra', async () => {
    const id = await withTenant(() =>
      eng().create(bairroCrudConfig, { descricao: 'MOEMA', regiao: 'S', ativo: 'S', idcidade: 3550308 }),
    );
    const row = (await withTenant(() => eng().read(bairroCrudConfig, id))) as any;
    expect(row.idcidade).toBe(3550308); // FK satisfeita
  });

  it('Bairro com idcidade INEXISTENTE → FK rejeita (integridade referencial)', async () => {
    await expect(
      withTenant(() => eng().create(bairroCrudConfig, { descricao: 'FANTASMA', regiao: 'N', idcidade: 9999999 })),
    ).rejects.toThrow();
  });
});

describe('10ª — MESTRE-DETALHE DECLARATIVO (AggregateEngineService espelha o vertical)', () => {
  const eng = () => new AggregateEngineService(dbp);
  const cfg = loteCobrancaAggregateConfig;

  let cod: number;
  it('CREATE do agregado: header + 2 itens numa transação; read traz os itens', async () => {
    cod = await withTenant(() =>
      eng().createAggregate(cfg, { codparceiro: 1, data: '2026-06-25', itens: [{ codrcb: 101 }, { codrcb: 102 }] }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.codparceiro).toBe(1);
    expect(agg.itens.map((i: any) => i.codrcb).sort()).toEqual([101, 102]);
    expect(agg.usultalteracao).toBe(7); // carimbo do master herdado
  });

  it('UPDATE substitui os itens (delete+insert) e atualiza o header', async () => {
    await withTenant(() =>
      eng().updateAggregate(cfg, cod, { codparceiro: 2, data: '2026-06-26', itens: [{ codrcb: 999 }] }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.codparceiro).toBe(2);
    expect(agg.itens.map((i: any) => i.codrcb)).toEqual([999]); // substituídos
  });

  it('LIST usa a view do master com a contagem de itens', async () => {
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    const linha = lista.find((l) => l.codlotecob === cod);
    expect(Number(linha.qtd_itens)).toBe(1);
  });

  it('DELETE em CASCATA: itens somem antes do header (transação)', async () => {
    await withTenant(() => eng().removeAggregate(cfg, cod));
    expect(await withTenant(() => eng().readAggregate(cfg, cod))).toBeUndefined();
    const itensOrfaos = (await withTenant(() =>
      (dbp.forTenantRead() as any).selectFrom('itens_lotecob').selectAll().where('codlotecob', '=', cod).execute(),
    )) as any[];
    expect(itensOrfaos.length).toBe(0); // cascata em código removeu os itens
  });
});

describe('11ª — PARCEIROS unificado (multi-papel + endereços; empresaScoped; dup CNPJ)', () => {
  const eng = () => new AggregateEngineService(dbp);
  const cfg = parceiroAggregateConfig;

  it('seed: 6 parceiros da empresa 1 na listagem (empresaScoped; canônico em 014)', async () => {
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    expect(lista.length).toBe(6); // 1/2/10 (cobradores) + 20/21/22 (clientes)
  });

  let cod: number;
  it('CREATE agregado: parceiro CLI + 1 endereço (CNPJ no endereço); carimba idempresa', async () => {
    cod = await withTenant(() =>
      eng().createAggregate(cfg, {
        razao: 'NOVO CLIENTE TESTE',
        tipofj: 'J',
        cli: 'S',
        enderecos: [
          {
            endereco: 'RUA X',
            bairro: 'CENTRO',
            cidade: 'SAO PAULO',
            idcidade: 3550308,
            uf: 'SP',
            cnpj_cpf: '11444777000161',
            endereco_padrao: 'S',
            ativado: 'S',
          },
        ],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.razao).toBe('NOVO CLIENTE TESTE');
    expect(agg.idempresa).toBe(1); // carimbo multi-tenant no caminho do agregado
    expect(agg.enderecos.length).toBe(1);
    expect(agg.enderecos[0].cnpj_cpf).toBe('11444777000161');
  });

  it('LIST traz o novo com cnpj/cidade/uf do endereço padrão (view LATERAL)', async () => {
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    const linha = lista.find((p) => p.codparceiro === cod);
    expect(linha?.cnpj_cpf).toBe('11444777000161');
    expect(linha?.uf).toBe('SP');
  });

  it('empresaScoped: outra empresa NÃO enxerga os parceiros da empresa 1', async () => {
    const lista = (await runWithTenant({ tenantId: 'pinheirao', operadorId: 7, empresaId: 2 }, () =>
      eng().list(cfg),
    )) as any[];
    expect(lista.length).toBe(0);
  });

  it('DUP de CNPJ é rejeitada pelo índice único (vira 409 DUPLICADO no HTTP)', async () => {
    await expect(
      withTenant(() =>
        eng().createAggregate(cfg, {
          razao: 'DUPLICADO',
          tipofj: 'J',
          frn: 'S',
          enderecos: [{ cnpj_cpf: '11222333000181', endereco_padrao: 'S' }], // doc do seed parceiro 1
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('12ª — PARCEIROS F2 (sub-recursos + colunas por papel)', () => {
  const eng = () => new AggregateEngineService(dbp);
  const cfg = parceiroAggregateConfig;

  it('READ do seed (parceiro 20): bancos/pgtos/relacionamentos/vendedores populados', async () => {
    const agg = (await withTenant(() => eng().readAggregate(cfg, 20))) as any;
    expect(agg.bancos.length).toBeGreaterThanOrEqual(1);
    expect(agg.pgtos.length).toBe(2);
    expect(agg.relacionamentos.length).toBeGreaterThanOrEqual(1);
    expect(agg.vendedores.length).toBe(2);
  });

  let cod: number;
  it('CREATE com sub-recursos + colunas por papel: tudo numa transação; round-trip', async () => {
    // sem `enderecos` → evita o índice único em parceiros_end.cnpj_cpf (a dup é por doc).
    cod = await withTenant(() =>
      eng().createAggregate(cfg, {
        razao: 'CLIENTE F2 TESTE',
        tipofj: 'J',
        cli: 'S',
        classfornecedor: 3,
        contribuinte_icms: 'S',
        bancos: [{ codbco: 1, agencia: '1', nrconta: '9' }],
        relacionamentos: [{ nome: 'X', tiporel: 'FIN' }],
        vendedores: [{ codvendedor: 1 }],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.bancos.length).toBe(1);
    expect(agg.bancos[0].codbco).toBe(1);
    expect(agg.relacionamentos.length).toBe(1);
    expect(agg.relacionamentos[0].nome).toBe('X');
    expect(agg.vendedores.length).toBe(1);
    expect(agg.vendedores[0].codvendedor).toBe(1);
    // colunas do master por papel + fiscal fazem round-trip
    expect(agg.classfornecedor).toBe(3);
    expect(agg.contribuinte_icms).toBe('S');
  });

  it('UPDATE substitui um detalhe (delete+insert): bancos → [codbco 2]', async () => {
    await withTenant(() =>
      eng().updateAggregate(cfg, cod, {
        razao: 'CLIENTE F2 TESTE',
        tipofj: 'J',
        cli: 'S',
        bancos: [{ codbco: 2 }],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.bancos.length).toBe(1); // substituição (não acréscimo)
    expect(agg.bancos[0].codbco).toBe(2);
  });
});

describe('13ª — PARCEIROS F3 (config fiscal)', () => {
  // engine-direct (sem zod): prova o round-trip das colunas fiscais do master.
  // A validação de IE por UF é um refine do zod → coberta no smoke (camada HTTP).
  const eng = () => new AggregateEngineService(dbp);
  const cfg = parceiroAggregateConfig;

  it('READ do seed (parceiro 1): colunas fiscais semeadas na 019 fazem round-trip', async () => {
    const agg = (await withTenant(() => eng().readAggregate(cfg, 1))) as any;
    expect(agg.contribuinte_icms).toBe('1');
    expect(agg.classfiscal).toBe('LR');
    expect(agg.habilita_retencao_ir_nf).toBe('S');
    expect(Number(agg.perc_aliquota_ir)).toBe(1.5); // numeric volta como string do pg
    expect(agg.envianfe).toBe('S');
    expect(agg.irrf).toBe('I');
  });

  it('CREATE com config fiscal completa: persiste e relê todas as colunas (incl. numeric)', async () => {
    const cod = await withTenant(() =>
      eng().createAggregate(cfg, {
        razao: 'CLIENTE F3 TESTE',
        tipofj: 'J',
        cli: 'S',
        contribuinte_icms: '9',
        habilita_retencao_pis_nf: 'S',
        perc_aliquota_issqn: 3.25,
        classificacao: 'C',
        codparceiro_ent_issqn: 1,
        enderecos: [{ endereco: 'RUA F3', uf: 'SP', endereco_padrao: 'S', ativado: 'S' }],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.contribuinte_icms).toBe('9');
    expect(agg.habilita_retencao_pis_nf).toBe('S');
    expect(Number(agg.perc_aliquota_issqn)).toBe(3.25); // numeric(15,4) volta como string
    expect(agg.classificacao).toBe('C');
    expect(agg.codparceiro_ent_issqn).toBe(1);
    expect(agg.enderecos.length).toBe(1);
  });
});

describe('14ª — PRODUTO núcleo (MESTRE-DETALHE: produtos + codauxiliar; GLOBAL) + lookups', () => {
  const eng = () => new AggregateEngineService(dbp);
  const crud = () => new CrudEngineService(dbp);
  const cfg = produtoAggregateConfig;

  it('seed: 3 produtos na listagem (GLOBAL — sem escopo de empresa)', async () => {
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    expect(lista.length).toBe(3);
  });

  let cod: number;
  it('CREATE agregado: produto + 1 codauxiliar numa transação; round-trip', async () => {
    cod = await withTenant(() =>
      eng().createAggregate(cfg, {
        codbarra: '7891000053508',
        descricao: 'PRODUTO TESTE INTEGRACAO',
        unidade: 'UN',
        codunidade: 1,
        codfor: 2,
        aliquota: 'T01',
        balanca: 'N',
        ativo: 'S',
        codauxiliares: [{ codauxiliar: '7891000053508', codbarra: '7896000000123', fatoremb: 6, codunidade: 3 }],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.descricao).toBe('PRODUTO TESTE INTEGRACAO');
    expect(agg.codfor).toBe(2);
    expect(agg.codauxiliares.length).toBe(1);
    expect(agg.codauxiliares[0].codbarra).toBe('7896000000123');
    expect(agg.usultalteracao).toBe(7); // carimbo de auditoria no master
  });

  it('LIST traz o novo com marca/fornecedor decodificados (view com JOINs)', async () => {
    const lista = (await withTenant(() => eng().list(cfg))) as any[];
    const linha = lista.find((p) => p.idproduto === cod);
    expect(linha?.descricao).toBe('PRODUTO TESTE INTEGRACAO');
    expect(linha?.fornecedor).toBeTruthy(); // razao do fornecedor (codfor=2)
  });

  it('lookups: unidades ≥ 6; familias tipo=G (≥ 2); aliquota tem T01', async () => {
    const unidades = (await withTenant(() => crud().list(unidadeCrudConfig))) as any[];
    expect(unidades.length).toBeGreaterThanOrEqual(6);

    const grupos = (await withTenant(() =>
      crud().list(familiasCrudConfig, { campo: 'tipo', operador: 'igual', valor: 'G' }),
    )) as any[];
    expect(grupos.length).toBeGreaterThanOrEqual(2);
    expect(grupos.every((g) => g.tipo === 'G')).toBe(true);

    const aliquotas = (await withTenant(() => crud().list(aliquotaCrudConfig))) as any[];
    expect(aliquotas.find((a) => a.codigo === 'T01')).toBeDefined();
  });
});

describe('15ª — PRODUTO F2 (MULTI_PRECO por empresa)', () => {
  // F2: preço/custo POR EMPRESA na MESMA form do produto — detalhe `precos` (1:N) do
  // agregado, 1 linha por idempresa, substituído (delete+insert) na gravação como os outros.
  const eng = () => new AggregateEngineService(dbp);
  const cfg = produtoAggregateConfig;

  it('READ do seed (produto 1): precos populado; empresa-1 com vrvenda 4.55 e aliquotasaida T01', async () => {
    const agg = (await withTenant(() => eng().readAggregate(cfg, 1))) as any;
    expect(agg.precos.length).toBeGreaterThanOrEqual(1);
    const e1 = agg.precos.find((p: any) => p.idempresa === 1);
    expect(e1).toBeDefined();
    expect(Number(e1.vrvenda)).toBe(4.55); // numeric volta como string do pg
    expect(e1.aliquotasaida).toBe('T01');
  });

  let cod: number;
  it('CREATE agregado com precos: produto + 1 preço da empresa 1; round-trip', async () => {
    cod = await withTenant(() =>
      eng().createAggregate(cfg, {
        codbarra: '7891000099991',
        descricao: 'PRODUTO F2 MULTI_PRECO',
        unidade: 'UN',
        codfor: 2,
        aliquota: 'T01',
        codauxiliares: [],
        precos: [
          { idempresa: 1, vrcusto: 10, markup: 50, vrvenda: 15, promocao: 'N', aliquotasaida: 'T01', ativo: 'S' },
        ],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.precos.length).toBe(1);
    expect(agg.precos[0].idempresa).toBe(1);
    expect(Number(agg.precos[0].vrvenda)).toBe(15);
  });

  it('UPDATE substitui precos (delete+insert): vrvenda 15 → 19.9', async () => {
    await withTenant(() =>
      eng().updateAggregate(cfg, cod, { precos: [{ idempresa: 1, vrvenda: 19.9, aliquotasaida: 'T01' }] }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.precos.length).toBe(1); // substituição (não acréscimo)
    expect(Number(agg.precos[0].vrvenda)).toBe(19.9);
  });
});

describe('PRODUTO F3 (ESTOQUE por empresa)', () => {
  // F3: saldo por empresa na MESMA form do produto — detalhe `estoques` (1:N), 1 linha por
  // idempresa, substituído (delete+insert) na gravação como os outros. REGRA: qtde (saldo) é
  // movido por transação — READ-ONLY no cadastro; só minimo/maximo/local são editáveis. qtde
  // entra no payload só p/ PRESERVAR o saldo no substitute (round-trip).
  const eng = () => new AggregateEngineService(dbp);
  const cfg = produtoAggregateConfig;

  it('READ do seed (produto 1): estoques populado; empresa-1 com qtde 120, min 10, max 500, local COR-A1', async () => {
    const agg = (await withTenant(() => eng().readAggregate(cfg, 1))) as any;
    expect(agg.estoques.length).toBeGreaterThanOrEqual(1);
    const e1 = agg.estoques.find((e: any) => e.idempresa === 1);
    expect(e1).toBeDefined();
    expect(Number(e1.qtde)).toBe(120); // numeric volta como string do pg
    expect(Number(e1.minimo)).toBe(10);
    expect(Number(e1.maximo)).toBe(500);
    expect(e1.local).toBe('COR-A1');
  });

  let cod: number;
  it('CREATE agregado com estoques: produto + 1 estoque da empresa 1 (qtde 0); round-trip', async () => {
    cod = await withTenant(() =>
      eng().createAggregate(cfg, {
        codbarra: '7890000002233',
        descricao: 'PRODUTO F3 ESTOQUE',
        unidade: 'UN',
        codfor: 2,
        aliquota: 'T01',
        codauxiliares: [],
        estoques: [{ idempresa: 1, qtde: 0, minimo: 5, maximo: 50, local: 'X1' }],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.estoques.length).toBe(1);
    expect(agg.estoques[0].idempresa).toBe(1);
    expect(Number(agg.estoques[0].minimo)).toBe(5);
    expect(Number(agg.estoques[0].qtde)).toBe(0);
  });

  it('UPDATE preserva saldo (regra): só min/max/local mudam; qtde reenviado 0 fica 0', async () => {
    await withTenant(() =>
      eng().updateAggregate(cfg, cod, {
        estoques: [{ idempresa: 1, qtde: 0, minimo: 9, maximo: 90, local: 'X2' }],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.estoques.length).toBe(1); // substituição (não acréscimo)
    expect(Number(agg.estoques[0].minimo)).toBe(9);
    expect(agg.estoques[0].local).toBe('X2');
    expect(Number(agg.estoques[0].qtde)).toBe(0); // saldo inalterado pelo cadastro
  });
});

describe('PRODUTO F4 (kit/BOM)', () => {
  // F4: 3 sub-grids na MESMA form — COMPOSIÇÃO (kit), DECOMPOSIÇÃO (1→N), RECEITA (ficha
  // técnica). Detalhes 1:N do agregado, substituídos (delete+insert) na gravação. Flags
  // COMPOSICAO/DECOMPOSICAO/RECEITA do master DERIVADAS server-side (derivar) da presença de
  // itens. REGRA (validar): não desativar produto que é COMPONENTE de algum kit.
  // (a regra "decomposição soma 100%" é zod/HTTP → coberta no smoke, não no engine-direct.)
  const eng = () => new AggregateEngineService(dbp);
  const cfg = produtoAggregateConfig;

  it('READ do seed (produto 1): composicoes 1 item (idproduto_01=2, qtde 2, valor 5); flag composicao=S', async () => {
    const agg = (await withTenant(() => eng().readAggregate(cfg, 1))) as any;
    expect(agg.composicoes.length).toBe(1);
    expect(agg.composicoes[0].idproduto_01).toBe(2);
    expect(Number(agg.composicoes[0].qtde)).toBe(2);
    expect(Number(agg.composicoes[0].valor)).toBe(5);
    expect(agg.composicao).toBe('S'); // flag derivada do seed
  });

  it('READ do seed: produto 2 tem decomposicoes (percentual 100, flag=S); produto 3 tem receitas (flag=S)', async () => {
    const p2 = (await withTenant(() => eng().readAggregate(cfg, 2))) as any;
    expect(p2.decomposicoes.length).toBe(1);
    expect(Number(p2.decomposicoes[0].percentual)).toBe(100);
    expect(p2.decomposicao).toBe('S');

    const p3 = (await withTenant(() => eng().readAggregate(cfg, 3))) as any;
    expect(p3.receitas.length).toBe(1);
    expect(p3.receita).toBe('S');
  });

  let cod: number;
  it('CREATE com composicoes deriva flag composicao=S; UPDATE com [] deriva =N e zera o sub-grid', async () => {
    cod = await withTenant(() =>
      eng().createAggregate(cfg, {
        codbarra: '7890000003254', // EAN-13 com DV válido, distinto dos seeds/smoke
        descricao: 'PRODUTO F4 KIT',
        unidade: 'UN',
        codfor: 2,
        aliquota: 'T01',
        composicoes: [{ idproduto_01: 2, qtde: 1, valor: 3 }],
      }),
    );
    const agg = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg.composicoes.length).toBe(1);
    expect(agg.composicoes[0].idproduto_01).toBe(2);
    expect(agg.composicao).toBe('S'); // derivada da presença de itens

    // gravar com composicoes vazio → flag deriva 'N' e o substitute limpa o sub-grid
    await withTenant(() => eng().updateAggregate(cfg, cod, { composicoes: [] }));
    const agg2 = (await withTenant(() => eng().readAggregate(cfg, cod))) as any;
    expect(agg2.composicoes.length).toBe(0);
    expect(agg2.composicao).toBe('N');
  });

  it('BLOQUEIO: desativar produto que é COMPONENTE de kit (produto 2) é rejeitado; kit (produto 1) não', async () => {
    // produto 2 é componente do kit 1 (composicao.idproduto_01=2) → validar() barra ativo='N'.
    await expect(withTenant(() => eng().updateAggregate(cfg, 2, { ativo: 'N' }))).rejects.toThrow();
    // produto 1 é o KIT (não é componente de ninguém) → desativar é permitido (resolve sem erro).
    await expect(withTenant(() => eng().updateAggregate(cfg, 1, { ativo: 'N' }))).resolves.not.toThrow();
    // reativa para não afetar outros testes do mesmo arquivo.
    await withTenant(() => eng().updateAggregate(cfg, 1, { ativo: 'S' }));
  });
});

function outbox(chave: number, tipo: 'INSERT' | 'UPDATE' | 'DELETE') {
  return runWithTenant({ tenantId: 'pinheirao' }, () =>
    dbp
      .dbFor('pinheirao')
      .selectFrom('outbox')
      .selectAll()
      .where('chave', '=', chave)
      .where('tipo', '=', tipo)
      .execute(),
  );
}
