import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { condicaoPesquisa } from '../../shared/relatorios/condicao-pesquisa';
import { hojeNaLoja } from '../../shared/tempo/hoje';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;

export interface FiltroLancamentos {
  dataIni: string;
  dataFim: string;
  /** as origens marcadas; ausente = todas; `nenhumaOrigem` = nenhuma (o `AND 1 = 2` do legado) */
  origens?: number[] | null;
  nenhumaOrigem?: boolean;
  empresas?: number[] | null;
  nenhumaEmpresa?: boolean;
  /** `CkbSomentePartidasDobradas` — que, apesar do nome, isola as linhas de UM LADO SÓ */
  somenteUmLado?: boolean;
  /** o lote escolhido nas diferenças débito × crédito: com ele saem os filtros de origem, empresa e lado (`OutrosFiltros := CODLOTE`) */
  lote?: number | null;
  /** o filtro auxiliar (`grpFiltroAuxiliar`): campo × operação × valor(es) */
  campo?: string | null;
  operador?: string | null;
  valor?: string | null;
  valor2?: string | null;
}

/**
 * Os campos do `SQL_DIARIO` (UFrmRelLancamentosContabeis.pas:30), na ordem do SELECT, com o tipo que o `CarregaCampos` dá ao combo do
 * filtro auxiliar (NUMERIC / VARCHAR / DATE → número / texto / data). A conta reduzida é texto (`PLANO_CONTAS.CODIREDUZIDO`).
 */
export const CAMPOS_DIARIO: Array<{ campo: string; tipo: 'numero' | 'texto' | 'data' }> = [
  { campo: 'coddiario', tipo: 'numero' }, { campo: 'datalan', tipo: 'data' }, { campo: 'contadebito', tipo: 'texto' },
  { campo: 'contacredito', tipo: 'texto' }, { campo: 'valor', tipo: 'numero' }, { campo: 'documento', tipo: 'texto' },
  { campo: 'tipodoc', tipo: 'texto' }, { campo: 'codhist', tipo: 'numero' }, { campo: 'deschist', tipo: 'texto' },
  { campo: 'complemento', tipo: 'texto' }, { campo: 'desc_conta_credito', tipo: 'texto' }, { campo: 'codiexpandido_cre', tipo: 'texto' },
  { campo: 'desc_conta_debito', tipo: 'texto' }, { campo: 'codiexpandido_deb', tipo: 'texto' }, { campo: 'origem', tipo: 'texto' },
  { campo: 'operacao', tipo: 'numero' }, { campo: 'codcc', tipo: 'numero' }, { campo: 'codempresa', tipo: 'numero' },
  { campo: 'cod_interno_debito', tipo: 'numero' }, { campo: 'cod_interno_credito', tipo: 'numero' }, { campo: 'codorigem', tipo: 'numero' },
  { campo: 'idorigem', tipo: 'numero' },
];

/** "Filtra tanto no crédito quanto no débito" (`GetFiltroAuxiliar`): a conta procurada num lado também é procurada no outro */
const CAMPO_CONTRARIO: Record<string, string> = {
  contacredito: 'contadebito', contadebito: 'contacredito', codiexpandido_cre: 'codiexpandido_deb', codiexpandido_deb: 'codiexpandido_cre',
  desc_conta_credito: 'desc_conta_debito', desc_conta_debito: 'desc_conta_credito',
};

/** o `TTipoOrigemContabil` (UIntegracaoContabil.pas:17) — o que o "Detalhar" abre para cada origem */
const ORIGEM = {
  NF: 12, CP: 13, CR: 14, BX_CP: 15, BX_CR: 16, REDUCAO_Z: 18, BX_CARTAO: 51, BX_CHEQUE: 52, BX_CP_JURO: 53, BX_CP_ACRESCIMO: 54,
  BX_CP_DESCONTO: 55, BX_CR_JURO: 56, BX_CR_ACRESCIMO: 57, BX_CR_DESCONTO: 58, BX_CHEQUE_ACRESCIMO: 59, BX_CHEQUE_DESCONTO: 60,
  BX_CARTAO_TAXA: 61, BX_CARTAO_OUTRAS: 62, ADIANTAMENTO: 63, MOV_CAIXA: 64, CONVENIO: 65, IMPORTACAO: 66,
} as const;

/**
 * LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`, `UFrmRelLancamentosContabeis.pas`). Dossiê: `uRelLancamentosContabeis.md`.
 * 377 acessos, 19 operadores.
 *
 * O razão POR LANÇAMENTO: o `SQL_DIARIO` (cada linha do DIARIO com as duas contas — reduzida, expandida, descrição e o código interno —,
 * o histórico, o documento, a origem pelo nome, a operação, a empresa) num período escolhido na ÁRVORE DE DATAS (ano anterior e atual,
 * meses, dias; em verde o que tem lançamento), com as origens (`ORIGEM_CONTABIL.STATUS = 'S'`) e as empresas (TODAS as do cadastro —
 * a tela do legado não recorta pelas do operador) marcadas, o "só de um lado" e o filtro auxiliar sobre qualquer coluna. O menu traz os
 * totais débito × crédito, as diferenças por lote, as exportações e a importação de lançamentos (origem 66).
 */
@Injectable()
export class LancamentosContabeisService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * A ÁRVORE DE DATAS (`CriaArvore`): o ano anterior e o atual, com cada mês e cada dia; `datas` são os dias com lançamento (o
   * `SELECT DISTINCT DATALAN FROM DIARIO WHERE TRUNC(DATALAN) BETWEEN 01/01 do ano anterior AND 31/12 do atual`, sem filtro de empresa) —
   * o nó com movimento sai em verde, o sem em vermelho (`DtvDatasCustomDrawItem`). A tela abre no dia de hoje (`LocalizaDataArvore(Date)`).
   */
  async arvore(): Promise<{ hoje: string; anos: number[]; datas: string[] }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const hoje = hojeNaLoja();
    const ano = Number(hoje.slice(0, 4));
    const datas = (await sql<{ d: string }>`
      SELECT DISTINCT to_char(datalan, 'YYYY-MM-DD') AS d FROM diario
       WHERE datalan BETWEEN ${`${ano - 1}-01-01`}::date AND ${`${ano}-12-31`}::date
       ORDER BY 1`.execute(db)).rows.map((r) => r.d);
    return { hoje, anos: [ano - 1, ano], datas };
  }

  /** as origens do `CkbOrigemLancamento` (`AdicionaOrigens`): só as ativas (`STATUS = 'S'`), na ordem do código, todas marcadas */
  async origens(): Promise<Array<{ codorigem: number; descorigem: string }>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<{ codorigem: number; descorigem: string }>`
      SELECT codorigem, descorigem FROM origem_contabil WHERE status = 'S' ORDER BY codorigem`.execute(db)).rows
      .map((r) => ({ codorigem: Number(r.codorigem), descorigem: r.descorigem }));
  }

  /** as empresas do `CkbEmpresas` (`AdicionaEmpresas`): todas as do cadastro, todas marcadas */
  async empresas(): Promise<number[]> {
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<{ idempresa: number }>`SELECT idempresa FROM empresas ORDER BY idempresa`.execute(db)).rows.map((r) => Number(r.idempresa));
  }

  /** os campos do combo do filtro auxiliar (`CarregaCampos`) */
  campos() {
    return CAMPOS_DIARIO;
  }

  /** o `GetFiltroAuxiliar`: a condição sobre a coluna de SAÍDA do `SQL_DIARIO`; a conta, nos dois lados */
  private filtroAuxiliar(f: FiltroLancamentos): RawBuilder<unknown> | null {
    if (!f.campo || !f.operador) return null;
    const campo = f.campo.toLowerCase();
    const def = CAMPOS_DIARIO.find((c) => c.campo === campo);
    if (!def) throw new BusinessRuleError('CAMPO_NAO_EXISTE_NA_FONTE', { campo: f.campo });
    const valor = f.operador === 'entre' ? [f.valor ?? '', f.valor2 ?? ''] : (f.valor ?? '');
    const cond = (c: string) => condicaoPesquisa({ campo: c, operador: f.operador!, valor }, def.tipo);
    const contrario = CAMPO_CONTRARIO[campo];
    return contrario ? sql`(${cond(campo)} OR ${cond(contrario)})` : cond(campo);
  }

  async listar(f: FiltroLancamentos): Promise<{
    linhas: Linha[];
    totais: { registros: number; debito: number; credito: number };
    truncado: boolean;
  }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const LIMITE = 50000;
    // o FiltroData do nó da árvore; os "outros filtros" (origens, empresas, um lado só) — ou o lote das diferenças, que os substitui
    const onde: RawBuilder<unknown>[] = [sql`d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`];
    if (f.lote) onde.push(sql`d.codlote = ${f.lote}`);
    else {
      if (f.nenhumaOrigem) onde.push(sql`1 = 2`);
      else if (f.origens?.length) onde.push(sql`d.codorigem IN (${sql.join(f.origens)})`);
      if (f.nenhumaEmpresa) onde.push(sql`1 = 2`);
      else if (f.empresas?.length) onde.push(sql`d.codempresa IN (${sql.join(f.empresas)})`);
      if (f.somenteUmLado) {
        onde.push(sql`((d.contadebito IS NOT NULL AND d.contacredito IS NULL) OR (d.contadebito IS NULL AND d.contacredito IS NOT NULL))`);
      }
    }
    const aux = this.filtroAuxiliar(f);
    const linhas = (await sql<Linha>`
      SELECT * FROM (
        SELECT d.coddiario, to_char(d.datalan, 'YYYY-MM-DD') AS datalan, pc.codireduzido AS contadebito, p.codireduzido AS contacredito,
               d.valor, d.documento, d.tipodoc, d.codhist, d.deschist, d.complemento,
               p.descricao AS desc_conta_credito, p.codiexpandido AS codiexpandido_cre,
               pc.descricao AS desc_conta_debito, pc.codiexpandido AS codiexpandido_deb,
               o.descorigem AS origem, d.codoperacao AS operacao, d.codcc, d.codempresa,
               pc.codplanocontas AS cod_interno_debito, p.codplanocontas AS cod_interno_credito, d.codorigem, d.idorigem, d.codlote
          FROM diario d
          LEFT JOIN plano_contas p      ON d.contacredito = p.codplanocontas
          LEFT JOIN plano_contas pc     ON d.contadebito = pc.codplanocontas
          LEFT JOIN origem_contabil o   ON o.codorigem = d.codorigem
         WHERE ${sql.join(onde, sql` AND `)}
      ) x
      ${aux ? sql`WHERE ${aux}` : sql``}
      ORDER BY x.datalan, x.coddiario
      LIMIT ${LIMITE + 1}`.execute(db)).rows.map((l) => ({
      ...l, valor: l.valor == null ? null : Number(l.valor),
      ...Object.fromEntries(['coddiario', 'codhist', 'operacao', 'codcc', 'codempresa', 'cod_interno_debito', 'cod_interno_credito', 'codorigem', 'idorigem', 'codlote']
        .map((k) => [k, l[k] == null ? null : Number(l[k])])),
    }) as Linha);
    const truncado = linhas.length > LIMITE;
    if (truncado) linhas.length = LIMITE;
    // `MniTotaisDebitoCreditoClick`: o valor entra no crédito quando tem conta de crédito e no débito quando tem conta de débito
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
    const debito = r2(linhas.filter((l) => Number(l.cod_interno_debito) > 0).reduce((s, l) => s + Number(l.valor ?? 0), 0));
    const credito = r2(linhas.filter((l) => Number(l.cod_interno_credito) > 0).reduce((s, l) => s + Number(l.valor ?? 0), 0));
    return { linhas, totais: { registros: linhas.length, debito, credito }, truncado };
  }

  /**
   * As DIFERENÇAS ENTRE DÉBITO E CRÉDITO (`TFrmDiferencasDebitoCredito`, o `QryDiferencas`): por lote e dia, a soma das linhas só de débito
   * contra a das só de crédito, onde elas não fecham, no período do nó (sem filtro de empresa, como lá). Escolhido um lote, a tela lista
   * os lançamentos dele. Sem diferença: "Não foram encontradas diferenças no período selecionado.".
   */
  async diferencas(dataIni: string, dataFim: string): Promise<Array<{ codlote: number; datalan: string; valor_debito: number; valor_credito: number; diferenca: number }>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Linha>`
      SELECT codlote, datalan, sum(valor_debito) AS valor_debito, sum(valor_credito) AS valor_credito, sum(valor_debito) - sum(valor_credito) AS diferenca
        FROM (SELECT d.codlote, to_char(d.datalan, 'YYYY-MM-DD') AS datalan, sum(d.valor) AS valor_debito, 0 AS valor_credito
                FROM diario d
               WHERE d.contadebito IS NOT NULL AND d.contacredito IS NULL AND d.codlote IS NOT NULL
                 AND d.datalan BETWEEN ${dataIni}::date AND ${dataFim}::date
               GROUP BY d.codlote, d.datalan
              UNION ALL
              SELECT d.codlote, to_char(d.datalan, 'YYYY-MM-DD') AS datalan, 0 AS valor_debito, sum(d.valor) AS valor_credito
                FROM diario d
               WHERE d.contadebito IS NULL AND d.contacredito IS NOT NULL AND d.codlote IS NOT NULL
                 AND d.datalan BETWEEN ${dataIni}::date AND ${dataFim}::date
               GROUP BY d.codlote, d.datalan) x
       GROUP BY codlote, datalan
      HAVING sum(valor_debito) <> sum(valor_credito)
       ORDER BY datalan, codlote`.execute(db)).rows;
    if (!rows.length) throw new BusinessRuleError('SEM_DIFERENCAS', {}, 'Não foram encontradas diferenças no período selecionado.');
    return rows.map((r) => ({ codlote: Number(r.codlote), datalan: String(r.datalan), valor_debito: Number(r.valor_debito), valor_credito: Number(r.valor_credito), diferenca: Number(r.diferenca) }));
  }

  /**
   * O "Detalhar" (`BtnDetalharDiarioClick`, :418): o documento de cada origem pelo `TTipoOrigemContabil` — a NF pelo IDORIGEM; o título
   * (cadastro, juro, acréscimo, desconto) pelo COMPLEMENTO e a BAIXA pelo DOCUMENTO (o que estiver preenchido, senão o IDORIGEM); cheque,
   * cartão e adiantamento pelo COMPLEMENTO ou IDORIGEM; o movimento de caixa e a redução Z pelo IDORIGEM; o convênio pelo DOCUMENTO no a
   * receber (TIPODOC 'CONTA A RECEBER') ou no a pagar. As outras origens: "Não foi possível encontrar o detalhe.".
   */
  async origemDoLancamento(coddiario: number): Promise<{ coddiario: number; codorigem: number; tipo: string; codigo: number; rota: string | null }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const d = (await sql<Linha>`SELECT coddiario, codorigem, idorigem, documento, complemento, tipodoc FROM diario WHERE coddiario = ${coddiario}`.execute(db)).rows[0];
    if (!d) throw new BusinessRuleError('LANCAMENTO_NAO_ENCONTRADO', { coddiario }, 'Nenhum registro está selecionado para detalhar.');
    const cod = Number(d.codorigem);
    const id = d.idorigem == null ? 0 : Number(d.idorigem);
    // o `StrToIntDef(…, 0)` do legado: texto que não é número vira 0
    const int = (v: unknown) => { const s = String(v ?? '').trim(); return /^\d+$/.test(s) ? Number(s) : 0; };
    const doc = (v: unknown) => (String(v ?? '') !== '' ? int(v) : id);
    const naoAchou = () => new BusinessRuleError('DETALHE_NAO_ENCONTRADO', { coddiario, codorigem: cod }, 'Não foi possível encontrar o detalhe.');
    const r = (tipo: string, codigo: number, rota: string | null) => {
      if (!codigo) throw naoAchou();
      return { coddiario, codorigem: cod, tipo, codigo, rota };
    };
    if (cod === ORIGEM.NF) {
      const nf = (await sql<{ tipo: string }>`SELECT tipo FROM nf WHERE codnf = ${id}`.execute(db)).rows[0];
      if (!nf) throw naoAchou();
      return r('NF', id, `/fiscal/notas/${nf.tipo === 'S' ? 'saida' : 'entrada'}?codigo=${id}`);
    }
    if ([ORIGEM.CP, ORIGEM.BX_CP, ORIGEM.BX_CP_JURO, ORIGEM.BX_CP_ACRESCIMO, ORIGEM.BX_CP_DESCONTO].includes(cod as never)) {
      const c = cod === ORIGEM.BX_CP ? doc(d.documento) : doc(d.complemento);
      return r('APAGAR', c, `/cadastro/apagar?codigo=${c}`);
    }
    if ([ORIGEM.CR, ORIGEM.BX_CR, ORIGEM.BX_CR_JURO, ORIGEM.BX_CR_ACRESCIMO, ORIGEM.BX_CR_DESCONTO].includes(cod as never)) {
      const c = cod === ORIGEM.BX_CR ? doc(d.documento) : doc(d.complemento);
      return r('ARECEBER', c, `/cadastro/areceber?codigo=${c}`);
    }
    if (cod === ORIGEM.MOV_CAIXA) return r('CAIXA', id, `/cobranca/lancamento-caixa?codigo=${id}`);
    if ([ORIGEM.BX_CHEQUE, ORIGEM.BX_CHEQUE_ACRESCIMO, ORIGEM.BX_CHEQUE_DESCONTO].includes(cod as never)) return r('CHEQUE', doc(d.complemento), null);
    if ([ORIGEM.BX_CARTAO, ORIGEM.BX_CARTAO_TAXA, ORIGEM.BX_CARTAO_OUTRAS].includes(cod as never)) {
      const c = doc(d.complemento);
      return r('CARTAO', c, `/financeiro/cartoes?codigo=${c}`);
    }
    if (cod === ORIGEM.ADIANTAMENTO) {
      const c = doc(d.complemento);
      return r('ADIANTAMENTO', c, `/financeiro/adiantamentos?codigo=${c}`);
    }
    if (cod === ORIGEM.CONVENIO) {
      const c = int(d.documento);
      return d.tipodoc === 'CONTA A RECEBER' ? r('ARECEBER', c, `/cadastro/areceber?codigo=${c}`) : r('APAGAR', c, `/cadastro/apagar?codigo=${c}`);
    }
    if (cod === ORIGEM.REDUCAO_Z) return r('REDUCAO_Z', id, null);
    throw naoAchou();
  }

  /**
   * A IMPORTAÇÃO DE LANÇAMENTOS (`MniImportarArquivoClick` → `TIntegracaoImportacao.ImportaLancamentoDiario`, UIntegracaoContabil.pas:4471):
   * cada linha do TXT, separada por vírgula, é `[empresa,]data,conta débito,conta crédito,valor,(campo ignorado),"histórico"` — a empresa é
   * opcional (primeiro campo numérico; sem ela, a MENOR do cadastro), as contas pelo CÓDIGO REDUZIDO (vazio ou 0 = sem aquele lado), o
   * valor com ponto ou vírgula. Grava no DIARIO com DOCUMENTO 'Importação', CODORIGEM 66, o operador e a hora. Tudo ou nada: conta que não
   * existe → "A conta contábil para o código X não foi encontrada." e nada é gravado.
   */
  async importar(conteudo: string): Promise<{ importados: number }> {
    const op = currentTenant().operadorId ?? null;
    this.emp();
    const linhas = conteudo.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (!linhas.length) throw new BusinessRuleError('ARQUIVO_VAZIO', {}, 'Selecione um arquivo txt para importar.');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const empresaPadrao = Number((await sql<{ m: number }>`SELECT min(idempresa) AS m FROM empresas`.execute(trx)).rows[0]?.m ?? 1);
      const conta = async (reduzido: string) => {
        const c = (await sql<{ codplanocontas: number }>`SELECT codplanocontas FROM plano_contas WHERE codireduzido = ${reduzido} LIMIT 1`.execute(trx)).rows[0];
        if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codigo: reduzido }, `A conta contábil para o código ${reduzido} não foi encontrada.`);
        return Number(c.codplanocontas);
      };
      let n = 0;
      for (const linha of linhas) {
        // o `ExtractDelimited(…, [','])` do Delphi: separa em toda vírgula (o histórico com vírgula fica só com o primeiro pedaço)
        const campos = linha.split(',');
        let i = 0;
        let codempresa = empresaPadrao;
        if (/^\d+$/.test((campos[0] ?? '').trim())) { codempresa = Number(campos[0].trim()); i += 1; }
        const dataTxt = (campos[i] ?? '').trim();
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(dataTxt);
        if (!m) throw new BusinessRuleError('DATA_INVALIDA', { linha: n + 1, data: dataTxt }, `'${dataTxt}' is not a valid date`);
        const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        const datalan = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        const deb = (campos[i + 1] ?? '').trim();
        const cre = (campos[i + 2] ?? '').trim();
        const contadebito = deb !== '' && deb !== '0' ? await conta(deb) : null;
        const contacredito = cre !== '' && cre !== '0' ? await conta(cre) : null;
        const valorTxt = (campos[i + 3] ?? '').trim();
        // `StrToFloat(ReplaceStr(…, '.', ','))` com a vírgula decimal: ponto ou vírgula valem como decimal; mais de um separador é erro
        const comVirgula = valorTxt.replace(/\./g, ',');
        const valor = valorTxt === '' || comVirgula.split(',').length > 2 ? NaN : Number(comVirgula.replace(',', '.'));
        if (!Number.isFinite(valor)) throw new BusinessRuleError('VALOR_INVALIDO', { linha: n + 1, valor: valorTxt }, `'${valorTxt}' is not a valid floating point value`);
        let hist = campos[i + 5] ?? '';
        if (hist.startsWith('"')) hist = hist.slice(1);
        if (hist.endsWith('"')) hist = hist.slice(0, -1);
        await sql`INSERT INTO diario (datalan, contadebito, contacredito, valor, codorigem, idorigem, codempresa, documento, deschist, usultalteracao, dtcadastro)
                  VALUES (${datalan}::date, ${contadebito}, ${contacredito}, ${valor}, ${ORIGEM.IMPORTACAO}, NULL, ${codempresa}, 'Importação', ${hist}, ${op}, now())`.execute(trx);
        n += 1;
      }
      return { importados: n };
    });
  }
}
