import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';
import { gravarLog } from '../../shared/log/registro-log';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { zipSync, strToU8 } from 'fflate';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/** ConcatenaLeft do legado: left-pad com `ch` até `n`; mais longo → mantém os n PRIMEIROS chars. */
const padL = (s: string, n: number, ch: string) => (s.length >= n ? s.slice(0, n) : ch.repeat(n - s.length) + s);
/** ConcatenaRight do legado: right-pad com `ch` até `n`; mais longo → trunca mantendo os primeiros. */
const padR = (s: string, n: number, ch = ' ') => (s.length >= n ? s.slice(0, n) : s + ch.repeat(n - s.length));
/** RetiraVirgula(v,true): preço 2 casas SEM separador = CENTAVOS em dígitos. */
const centavos = (v: number) => String(Math.round((v + Number.EPSILON) * 100));
/**
 * `VerificaFormato('000.0', v)` do legado: dígitos com N casas decimais e **sem o separador** — o próprio
 * legado prova (mig 274): o guarda `copy(LinhaTab, 8, 38) = 38 zeros` só fecha se '000.0' render 4 dígitos.
 */
const dec = (v: number, inteiras: number, casas: number) => {
  const f = Math.round((num(v) + Number.EPSILON) * 10 ** casas);
  const total = inteiras + casas;
  return padL(String(Math.max(0, f)), total, '0').slice(-total);
};

/** MGV lê ANSI; o download web é texto → normaliza acentos p/ ASCII (divergência consciente, documentada). */
const ascii = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ');

export interface ArquivoBalanca { nome: string; conteudo: string; linhas: number }

/**
 * EXPORTAR PARA BALANÇA (FRMEXPORTABALANCA) — corte-1 TOLEDO. Seleção fiel (QryBusca): balanca='S' +
 * MULTI_PRECO.VRVENDA>0 + length(codbarra)<=6 (o PLU É o codbarra), descrição=COALESCE(descricao_balanca,descricao),
 * preço = promo-se-ativa (VRPROMO se PROMOCAO='S' senão VRVENDA — regra da Etiqueta) em CENTAVOS. SETOR de
 * codbalanca (CAMPO_SETOR='BALANCA') ou coddpto. Filtro ATIVO por config ATIVO_PELA_MULTIPRECO (vivo='S' →
 * MULTI_PRECO.ATIVO). Gera TXITENS.TXT + CADASTRO.TXT + ITENSMGV.TXT (tail Prix4-N = 26 espaços / Prix5-N = 63
 * zeros), layouts posicionais fiéis a UexportaBalanca.pas:155-234. Flag peso/unidade da UNIDADE.SIGLA (no Oracle o
 * CASE do legado sempre cai na sigla), POR LINHA: UN→'1', demais→'0' (o legado não resetava a var e vazava 'P' de
 * Filizola — corrigido conscientemente). Entrega = download (dir/bat do host ficam fora). ADIADO: Filizola,
 * TARA, config-UI (INFNUTRI saiu do adiado: é o corte-2 abaixo). Truncamento dos helpers (keep-first) = ASSUNÇÃO a certificar no
 * golden do MGV no cutover (FuncoesApollo não está no repo).
 *
 * ── Corte-2 (mig 274): INFNUTRI.TXT ───────────────────────────────────────────────────────────────────
 * A tabela nutricional da Toledo, para quem tem `expdadosnutricionais='S'` (2.774 produtos no cliente,
 * 1.474 com nutriente > 0). As três colunas da **medida caseira** (`inteiramedida`/`partedec`/
 * `usadamedida`, 1.8 mil produtos cada) não existiam no destino e entram na 274.
 * Os decimais vão **sem separador** — e isso não é suposição: o guarda do próprio legado
 * (`copy(LinhaTab, 8, 38) = 38 zeros`) só fecha a conta assim (a prova aritmética está na migration).
 * Os dois guardas ficam: linha toda zerada não é escrita, PLU '000000' também não.
 * TXINFO.TXT/REC_ASS.TXT (receita/informação extra) seguem fora: dependem de `RECEITAS`, que tem 0 linhas.
 */
@Injectable()
export class ExportaBalancaService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * A "Lista de empresas configuradas para exportação" (MostrarEmpresas, UexportaBalanca.pas): o legado lista a CONFIG_BALANCA de TODAS
   * as lojas com a razão social (`JOIN EMPRESAS`), por IDEMPRESA — o operador da loja 1 exporta a da loja 2 junto (227 vezes em 2026, duas
   * linhas da LOG no mesmo segundo). O Apollo não passa das lojas que o operador alcança.
   */
  async configs(): Promise<Record<string, unknown>[]> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await todasAsEmpresasDoOperador(db);
    return (await db.selectFrom('config_balanca as cb').leftJoin('empresas as e', 'e.idempresa', 'cb.idempresa')
      .selectAll('cb').select('e.razao_social').where('cb.idempresa', 'in', lojas).orderBy('cb.idempresa').orderBy('cb.id').execute()) as Record<string, unknown>[];
  }

  /** a config de uma das lojas do operador */
  private async configDoOperador(db: AnyDB, id: number): Promise<Record<string, unknown>> {
    const lojas = await todasAsEmpresasDoOperador(db);
    const cfg = (await db.selectFrom('config_balanca').selectAll().where('id', '=', id).where('idempresa', 'in', lojas).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!cfg) throw new BusinessRuleError('CONFIG_BALANCA_NAO_ENCONTRADA', { id });
    return cfg;
  }

  /**
   * O CONFIGURADOR (`TfrmConfExportaBalanca`, uConfigExportaBalanca.pas — o botão "Configurador", BTNCONFIGURABAL): a balança da
   * loja — diretório, tipo (TOLEDO / FILIZOLA / AMBAS), modelo (PRIX4-N, PRIX4 / PRIX4-R, REDE MGVIII, PRIX5-N), o campo do setor
   * ("Código do Departamento" / "Código da Balança"), tabela nutricional, receita e tara. As regras do `btnAddItemClick` (:96):
   * sem diretório → "Empresa/Diretório invalido!Tente novamente!"; a mesma loja com o mesmo diretório para modelo diferente → "NÃO
   * PERMITIDO!!…" (CheckConfigBalanca); Filizola não exporta tara. O legado grava a edição apagando e inserindo (novo ID); aqui a
   * linha é alterada no lugar — o ID é só a chave.
   */
  async gravarConfig(dto: {
    id?: number | null; idempresa?: number | null; dir_bal?: string; tipo_bal?: string; mod_bal?: string; campo_setor?: string;
    export_nutricional?: boolean; export_receita?: boolean; exporta_tara?: boolean; exporta_rdc429?: boolean;
  }) {
    // a Empresa do configurador (edtCODEMPRESA + a pesquisa): qualquer loja que o operador alcance; vazia, a da sessão
    const lojas = await todasAsEmpresasDoOperador(this.dbp.forTenantRead() as AnyDB);
    const emp = dto.idempresa == null ? this.emp() : Number(dto.idempresa);
    if (!lojas.includes(emp)) throw new BusinessRuleError('CONFIG_BALANCA_DIRETORIO', {}, 'Empresa/Diretório invalido!Tente novamente!');
    const dir = String(dto.dir_bal ?? '').trim();
    if (!dir) throw new BusinessRuleError('CONFIG_BALANCA_DIRETORIO', {}, 'Empresa/Diretório invalido!Tente novamente!');
    const tipo = String(dto.tipo_bal ?? '').toUpperCase();
    if (!['TOLEDO', 'FILIZOLA', 'AMBAS'].includes(tipo)) throw new BusinessRuleError('CONFIG_BALANCA_TIPO', { tipo_bal: dto.tipo_bal });
    const modelo = String(dto.mod_bal ?? '');
    if (!['PRIX4-N', 'PRIX4 / PRIX4-R', 'REDE MGVIII', 'PRIX5-N'].includes(modelo)) throw new BusinessRuleError('CONFIG_BALANCA_MODELO', { mod_bal: dto.mod_bal });
    const setor = String(dto.campo_setor ?? '');
    if (!['Código do Departamento', 'Código da Balança'].includes(setor)) throw new BusinessRuleError('CONFIG_BALANCA_SETOR', { campo_setor: dto.campo_setor });
    if (tipo === 'FILIZOLA' && dto.exporta_tara) throw new BusinessRuleError('CONFIG_BALANCA_FILIZOLA_TARA', {}, 'A balança Filizola não pode exportar tara.');
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const conflito = (await sql<{ id: number }>`SELECT id FROM config_balanca WHERE idempresa = ${emp} AND dir_bal = ${dir} AND mod_bal <> ${modelo}
                                                   AND id <> ${dto.id ?? -1} LIMIT 1`.execute(trx)).rows[0];
      if (conflito) throw new BusinessRuleError('CONFIG_BALANCA_DIRETORIO_MODELO', {}, 'NÃO PERMITIDO!! Empresa com mesmo diretório para modelo diferentes...!');
      const valores = {
        dir_bal: dir.slice(0, 200), tipo_bal: tipo, mod_bal: modelo, campo_setor: setor,
        export_nutricional: dto.export_nutricional ? 'S' : 'N', export_receita: dto.export_receita ? 'S' : 'N',
        exporta_tara: dto.exporta_tara ? 'S' : 'N', exporta_rdc429: dto.exporta_rdc429 ? 'S' : 'N',
      };
      if (dto.id != null) {
        // o legado apaga e insere (a loja pode mudar); aqui a linha muda no lugar, dentro das lojas do operador
        const r = await trx.updateTable('config_balanca').set({ idempresa: emp, ...valores }).where('id', '=', Number(dto.id)).where('idempresa', 'in', lojas).executeTakeFirst();
        if (!Number((r as any)?.numUpdatedRows ?? 0)) throw new BusinessRuleError('CONFIG_BALANCA_NAO_ENCONTRADA', { id: dto.id });
        return { id: Number(dto.id) };
      }
      await sql`SELECT setval('seq_config_balanca', greatest((SELECT last_value FROM seq_config_balanca), (SELECT coalesce(max(id), 0) FROM config_balanca))::bigint, true)`.execute(trx);
      const ins = (await trx.insertInto('config_balanca').values({ idempresa: emp, ...valores }).returning('id').executeTakeFirstOrThrow()) as { id: number };
      return { id: Number(ins.id) };
    });
  }

  /** "Excluir item" do configurador (DMConfExportaBalanca.Deletar) */
  async excluirConfig(id: number) {
    const lojas = await todasAsEmpresasDoOperador(this.dbp.forTenantRead() as AnyDB);
    const r = await (this.dbp.forTenant() as AnyDB).deleteFrom('config_balanca').where('id', '=', id).where('idempresa', 'in', lojas).executeTakeFirst();
    if (!Number((r as any)?.numDeletedRows ?? 0)) throw new BusinessRuleError('CONFIG_BALANCA_NAO_ENCONTRADA', { id });
    return { id, removida: true };
  }

  /**
   * O "Exportar" com as linhas marcadas (btnExportarClick): nenhuma → "Selecione os registros na grade á exportar e tente novamente!";
   * cada config gera os arquivos da LOJA DELA (`cdsBusca.Params[0] := CodEmpresa`), na ordem da grade (IDEMPRESA); a loja sem produto
   * avisa "Não foi encontrado produto para balança." e as outras seguem (o `Exit` sai só do GerarArquivosBalanca). O legado grava cada
   * loja no diretório dela; aqui, com mais de uma, sai um .zip com uma pasta por loja (a última pasta do diretório configurado).
   */
  async gerarLote(ids: number[]) {
    const lista = [...new Set(ids.filter((i) => Number.isInteger(i) && i > 0))];
    if (!lista.length) throw new BusinessRuleError('BALANCA_SEM_SELECAO', {}, 'Selecione os registros na grade á exportar e tente novamente!');
    const db = this.dbp.forTenantRead() as AnyDB;
    const cfgs = await Promise.all(lista.map((id) => this.configDoOperador(db, id)));
    cfgs.sort((a, b) => Number(a.idempresa) - Number(b.idempresa) || Number(a.id) - Number(b.id));
    const lotes: Array<{ config: number; idempresa: number; pasta: string; modelo: string | null; produtos: number; arquivos: ArquivoBalanca[]; aviso: string | null }> = [];
    const pastas = new Set<string>();
    for (const cfg of cfgs) {
      const dir = String(cfg.dir_bal ?? '').replace(/[\\/]+$/, '');
      let pasta = (dir.split(/[\\/]/).pop() ?? '').replace(/[^\w.-]+/g, '_') || `LOJA${cfg.idempresa}`;
      if (pastas.has(pasta)) pasta = `${pasta}_${cfg.id}`;
      pastas.add(pasta);
      try {
        const r = await this.gerar(Number(cfg.id));
        lotes.push({ config: Number(cfg.id), idempresa: Number(cfg.idempresa), pasta, modelo: r.modelo, produtos: r.produtos, arquivos: r.arquivos, aviso: null });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== 'BALANCA_SEM_PRODUTOS' && code !== 'BALANCA_TIPO_NAO_SUPORTADO') throw e;
        const aviso = code === 'BALANCA_SEM_PRODUTOS' ? 'Não foi encontrado produto para balança.' : `A balança ${String(cfg.tipo_bal)} ainda não é gerada pelo Apollo.`;
        lotes.push({ config: Number(cfg.id), idempresa: Number(cfg.idempresa), pasta, modelo: null, produtos: 0, arquivos: [], aviso });
      }
    }
    const comArquivos = lotes.filter((l) => l.arquivos.length);
    const zip = comArquivos.length > 1
      ? Buffer.from(zipSync(Object.fromEntries(comArquivos.flatMap((l) => l.arquivos.map((a) => [`${l.pasta}/${a.nome}`, strToU8(a.conteudo)]))))).toString('base64')
      : null;
    return { lotes, zip, nomeZip: zip ? 'Balanca.zip' : null };
  }

  /** gera os arquivos TOLEDO da config — da loja DELA (o `CodEmpresa` da linha). Devolve os .txt (nome+conteúdo) p/ o front baixar. */
  async gerar(configId: number): Promise<{ config: number; modelo: string; produtos: number; arquivos: ArquivoBalanca[]; nutricional: { linhas: number; pulados: number } }> {
    const sessao = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cfg = await this.configDoOperador(db, configId);
    const emp = Number(cfg.idempresa);
    if (String(cfg.tipo_bal).toUpperCase() !== 'TOLEDO') throw new BusinessRuleError('BALANCA_TIPO_NAO_SUPORTADO', { tipo: cfg.tipo_bal }); // Filizola = corte-2
    const modelo = String(cfg.mod_bal ?? 'PRIX5-N').toUpperCase();
    const setorDeDpto = String(cfg.campo_setor ?? 'BALANCA').toUpperCase().includes('DEPART'); // 0=coddpto / 1=codbalanca
    const exportaTabela = String(cfg.export_nutricional ?? 'N').toUpperCase() === 'S';

    // ramo do filtro ATIVO (fold auditoria [ALTA]): a config viva resolve 'S' → o legado filtra por MULTI_PRECO.ATIVO
    // (1196 produtos), não PRODUTOS.ATIVO (2278 = 1091 preços desativados voltariam à balança). Fiel a /*ATIVO*/
    // (UexportaBalanca.pas:90-95); mesma resolução do inventário.
    const ativoPelaMp = (await this.config.resolver('ATIVO_PELA_MULTIPRECO', { empresaId: emp })) === 'S';

    // seleção fiel à QryBusca (UexportaBalanca.dfm:494): balanca='S' + vrvenda>0 + len(codbarra)<=6; ORDER BY codbarra.
    // A flag peso/unidade vem de UNIDADE.SIGLA (fold auditoria [ALTA]): no Oracle `p.unidade <> ''` NUNCA é true
    // (''≡NULL) → o CASE do legado sempre cai em u.sigla — 7 produtos vivos têm p.unidade divergente da sigla.
    let q = db
      .selectFrom('produtos as p')
      .leftJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'p.idproduto').on('m.idempresa', '=', emp))
      .leftJoin('unidade as u', 'u.codunidade', 'p.codunidade')
      .select([
        'p.idproduto', 'p.codbarra', 'p.coddpto', 'p.codbalanca',
        sql`u.sigla`.as('un_sigla'),
        sql`coalesce(nullif(p.descricao_balanca,''), p.descricao)`.as('descricao'),
        sql`coalesce(p.validade,0)`.as('validade'),
        'm.vrvenda', 'm.vrpromo', sql`coalesce(m.promocao,'N')`.as('promocao'),
        // corte-2 (mig 274): a tabela nutricional (INFNUTRI.TXT)
        sql`coalesce(p.expdadosnutricionais,'N')`.as('expnutri'),
        sql`coalesce(p.qtde_porcao,0)`.as('qtde_porcao'), sql`coalesce(p.unporcao,0)`.as('unporcao'),
        sql`coalesce(p.inteiramedida,0)`.as('inteiramedida'), sql`coalesce(p.partedec,0)`.as('partedec'),
        sql`coalesce(p.usadamedida,0)`.as('usadamedida'),
        sql`coalesce(p.valorenergetico,0)`.as('valorenergetico'), sql`coalesce(p.carboidrato,0)`.as('carboidrato'),
        sql`coalesce(p.proteina,0)`.as('proteina'), sql`coalesce(p.gorduratotal,0)`.as('gorduratotal'),
        sql`coalesce(p.gordurasaturada,0)`.as('gordurasaturada'), sql`coalesce(p.gorduratrans,0)`.as('gorduratrans'),
        sql`coalesce(p.fibra,0)`.as('fibra'), sql`coalesce(p.sodio,0)`.as('sodio'),
      ])
      .where('p.balanca', '=', 'S')
      .where('m.vrvenda', '>', 0)
      .where(sql`char_length(trim(p.codbarra))`, '<=', 6);
    q = ativoPelaMp
      ? q.where(sql`coalesce(m.ativo,'S')`, '=', 'S') // COALESCE(M.ATIVO,'S')='S' (config 'S' — o vivo do tenant)
      : q.where(sql`coalesce(p.ativo,'S')`, '=', 'S'); // COALESCE(P.ATIVO,'S')='S' (default)
    const rows = (await q.orderBy('p.codbarra').execute()) as Record<string, unknown>[];
    if (!rows.length) throw new BusinessRuleError('BALANCA_SEM_PRODUTOS', { config: configId });

    const txitens: string[] = [];
    const cadastro: string[] = [];
    const itensmgv: string[] = [];
    const infnutri: string[] = [];
    let nutriPulados = 0;
    for (const r of rows) {
      const un = String(r.un_sigla ?? '').trim().toUpperCase(); // SIGLA da unidade (fold: fonte fiel ao Oracle)
      const flag = un === 'UN' ? '1' : '0'; // KG e demais = peso (fix do carry-over/'P' do legado, documentado)
      const preco = String(r.promocao) === 'S' && num(r.vrpromo) > 0 ? num(r.vrpromo) : num(r.vrvenda);
      const setor = setorDeDpto ? num(r.coddpto) : num(r.codbalanca);
      const plu = padL(String(r.codbarra ?? '').trim(), 6, '0');
      const preco6 = padL(centavos(preco), 6, '0');
      const val3 = padL(String(Math.trunc(num(r.validade))), 3, '0');
      const desc25 = padR(ascii(String(r.descricao ?? '')), 25);
      const setor2 = padL(String(setor), 2, '0');
      const head = setor2 + flag + plu + preco6 + val3 + desc25 + padR('', 25);

      // INFNUTRI.TXT (corte-2, mig 274): só quem tem `expdadosnutricionais='S'` (UexportaBalanca.pas:130-152).
      // 'N' + PLU(6) + reservado '0' + qtde(3) + un.porção(1) + medida caseira (2+1+2) + energético(4) +
      // carboidrato(4) + proteína(3) + gord.total(3) + saturada(3) + trans(3) + fibra(3) + sódio(5).
      // só com o "Ex.Tabela Nutricional" da config (`if (ExportaTabela) and (...)`, :130) — antes saía sempre
      if (exportaTabela && String(r.expnutri) === 'S') {
        const corpo =
          '0'
          + padL(String(Math.trunc(num(r.qtde_porcao))), 3, '0')
          + padL(String(Math.trunc(num(r.unporcao))), 1, '0').slice(0, 1)
          + padL(String(Math.trunc(num(r.inteiramedida))), 2, '0').slice(0, 2)
          + padL(String(Math.trunc(num(r.partedec))), 1, '0').slice(0, 1)
          + padL(String(Math.trunc(num(r.usadamedida))), 2, '0').slice(0, 2)
          + padL(String(Math.trunc(num(r.valorenergetico))), 4, '0')
          + dec(num(r.carboidrato), 3, 1) + dec(num(r.proteina), 2, 1) + dec(num(r.gorduratotal), 2, 1)
          + dec(num(r.gordurasaturada), 2, 1) + dec(num(r.gorduratrans), 2, 1) + dec(num(r.fibra), 2, 1)
          + dec(num(r.sodio), 4, 1);
        // os dois guardas do legado: linha inteiramente zerada não vai, PLU '000000' não vai
        if (/[^0]/.test(corpo) && plu !== '000000') infnutri.push('N' + plu + corpo);
        else nutriPulados += 1;
      }

      // TXITENS.TXT: setor2 + '01' + flag + plu + preco + val + desc25 + 25sp + 5×50sp (pas:180-192).
      txitens.push(setor2 + '01' + flag + plu + preco6 + val3 + desc25 + padR('', 25) + padR('', 50).repeat(5));
      // CADASTRO.TXT: head + tail literal '000000'+'000'+'0'+'01'+'0'+'01' (pas:194).
      cadastro.push(head + '000000' + '000' + '0' + '01' + '0' + '01');
      // ITENSMGV.TXT: head + CODRECEITA(6; sem receitas no app novo → 0) + '000' + codbarra(4) + '1'+'1'+'0000' + tail modelo.
      const mgvPrefix = head + padL('0', 6, '0') + '000' + padL(String(r.codbarra ?? '').trim(), 4, '0') + '1' + '1' + '0000';
      if (modelo.includes('PRIX4')) {
        itensmgv.push(mgvPrefix + padR('', 12) + padR('', 11) + padR('', 1) + padR('', 2)); // Prix4-N (pas:200-218)
      } else {
        itensmgv.push(mgvPrefix + '0'.repeat(63)); // Prix5-N (pas:219-233); modelos desconhecidos caem aqui (GetModelBal else)
      }
    }

    const crlf = (l: string[]) => l.join('\r\n') + '\r\n'; // Writeln = CRLF no Windows
    const arquivos: ArquivoBalanca[] = [
      { nome: 'TXITENS.TXT', conteudo: crlf(txitens), linhas: txitens.length },
      { nome: 'CADASTRO.TXT', conteudo: crlf(cadastro), linhas: cadastro.length },
      { nome: 'ITENSMGV.TXT', conteudo: crlf(itensmgv), linhas: itensmgv.length },
    ];
    // o arquivo nutricional só sai quando há produto com dado — o legado cria o .TXT vazio; aqui não
    // entregamos arquivo vazio para download (o conteúdo seria só o CRLF)
    if (infnutri.length) arquivos.push({ nome: 'INFNUTRI.TXT', conteudo: crlf(infnutri), linhas: infnutri.length });
    // a LOG de cada exportação (binário novo — não está no fonte de 2020; 4.057 em 2026): "Exportar para balança"/Inseriu, tabela
    // EXPBALANCA, chave BALANCA, valor 0, com as flags da config. ⚠️ O binário grava TIPO/MODELO/SETOR sempre 0 (4.056 de 4.057,
    // com a config TOLEDO / PRIX4-N / "Código da Balança") — o texto fica igual ao dele.
    const sn = (v: unknown) => (String(v ?? '').toUpperCase() === 'S' ? 'S' : String(v ?? '').toUpperCase() === 'N' ? 'N' : '');
    await (this.dbp.forTenant() as AnyDB).transaction().execute((trx: AnyDB) => gravarLog(trx, {
      // a LOG leva a loja da SESSÃO (na produção os pares do mesmo segundo repetem a loja do login: "1,1" 213 vezes)
      acao: 'Inseriu', formulario: 'Exportar para balança', tabela: 'EXPBALANCA', chave: 'BALANCA', valor: 0, idempresa: sessao,
      historico: [' - TIPO: 0', ' - MODELO: 0', ' - SETOR: 0', ` - EXPORTA TABELA NUTRICIONAL: ${sn(cfg.export_nutricional)}`,
        ` - EXPORTA RECEITA: ${sn(cfg.export_receita)}`, ` - EXPORTA TARA: ${sn(cfg.exporta_tara)}`].join('\r\n'),
    }));
    return { config: configId, modelo, produtos: rows.length, arquivos, nutricional: { linhas: infnutri.length, pulados: nutriPulados } };
  }
}
