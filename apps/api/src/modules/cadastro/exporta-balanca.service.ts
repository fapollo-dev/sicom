import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';

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

  /** configs de balança da empresa. */
  async configs(): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    return (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('config_balanca').selectAll().where('idempresa', '=', emp).orderBy('id').execute()) as Record<string, unknown>[];
  }

  /** gera os arquivos TOLEDO da config. Devolve os .txt (nome+conteúdo) p/ o front baixar. */
  async gerar(configId: number): Promise<{ config: number; modelo: string; produtos: number; arquivos: ArquivoBalanca[]; nutricional: { linhas: number; pulados: number } }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cfg = (await db.selectFrom('config_balanca').selectAll().where('id', '=', configId).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!cfg) throw new BusinessRuleError('CONFIG_BALANCA_NAO_ENCONTRADA', { id: configId });
    if (String(cfg.tipo_bal).toUpperCase() !== 'TOLEDO') throw new BusinessRuleError('BALANCA_TIPO_NAO_SUPORTADO', { tipo: cfg.tipo_bal }); // Filizola = corte-2
    const modelo = String(cfg.mod_bal ?? 'PRIX5-N').toUpperCase();
    const setorDeDpto = String(cfg.campo_setor ?? 'BALANCA').toUpperCase().includes('DEPART'); // 0=coddpto / 1=codbalanca

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
      if (String(r.expnutri) === 'S') {
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
    return { config: configId, modelo, produtos: rows.length, arquivos, nutricional: { linhas: infnutri.length, pulados: nutriPulados } };
  }
}
