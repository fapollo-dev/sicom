import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { configNaTrx } from '../compras/pedido-heranca';
import { relatorioMestre } from '../../shared/relatorios/relatorio-mestre';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;

export interface FiltroDre {
  dataIni: string;
  dataFim: string;
  empresas?: number[] | null;
  /** o "Filtro de plano de contas" (as contas escolhidas e as analíticas abaixo delas — o CONNECT BY do legado) */
  planos?: number[] | null;
  /** "Não exibir zerados" */
  naoExibirZerados?: boolean;
  niveis?: number | null;
}

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const r2 = (x: number) => Math.round((x + (x >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/** a expressão das linhas E (`TEvaluator`): + − × ÷ e parênteses, sem eval; erro → 0, como o `except vValor := 0` */
function avaliar(expr: string): number {
  let i = 0;
  const ws = () => { while (i < expr.length && /\s/.test(expr[i])) i++; };
  const fator = (): number => {
    ws();
    if (expr[i] === '(') { i++; const v = soma(); ws(); if (expr[i] !== ')') throw new Error('expr'); i++; return v; }
    if (expr[i] === '-') { i++; return -fator(); }
    if (expr[i] === '+') { i++; return fator(); }
    const j = i;
    while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
    if (i === j) throw new Error('expr');
    return Number(expr.slice(j, i));
  };
  const termo = (): number => { let v = fator(); ws(); while (expr[i] === '*' || expr[i] === '/') { const op = expr[i++]; const r = fator(); v = op === '*' ? v * r : v / r; ws(); } return v; };
  const soma = (): number => { let v = termo(); ws(); while (expr[i] === '+' || expr[i] === '-') { const op = expr[i++]; const r = termo(); v = op === '+' ? v + r : v - r; ws(); } return v; };
  try { const v = soma(); ws(); if (i < expr.length) return 0; return Number.isFinite(v) ? v : 0; } catch { return 0; }
}

/**
 * O RELATÓRIO DO DRE CONTÁBIL como o legado o imprime (`TFrmRelDREContabil`, UFrmRelDREContabil.pas — herda o TFrmRelMaster; layout
 * `DRE Contabil.fr3`). A estrutura é a CONFIG_DRE_CONTABIL (`dre_estrutura`) achatada pela máscara MASCARA_CONFIGURACAO_DRE_CONTABIL
 * (o nível máximo = pontos + 1): uma linha por conta do último nível com os ancestrais em CFGDRE_*_NIVELn, mais as linhas E do nível 1
 * (`GetSQLConfigDRE`). Os lançamentos são o DIÁRIO a crédito e a débito com o vínculo da conta (`VINCULO_PLC_CFG_DRE` = `dre_conta`,
 * `GetSQLLancamentos`). `AntesImprimir`:
 *  · P: cada linha da estrutura vira uma linha por lançamento vinculado (VALOR = crédito +, débito −; DATA_LANCAMENTO, HISTORICO =
 *    DESCHIST, CODEMPRESA) — sem lançamento, uma linha zerada;
 *  · F: do penúltimo nível ao 1º, o ancestral F recebe a soma do VALOR dos seus em VALOR_NIVELn;
 *  · E: a expressão (`<01>+<03>+<04>`) com o VALOR_NIVEL1 de cada raiz;
 *  · lançamento de conta sem vínculo: conta de resultado (natureza 4) bloqueia, as outras só avisam (a guia Observações);
 *  · "Não exibir zerados": `(VALOR <> 0) OR (CFGDRE_TIPO_CALCULO = 'E')`; vazio → "Não foram encontrados lançamentos para o filtro informado.".
 * ⚠️ O `GetSQLLancamentos` do fonte não filtra a empresa (o `GetMultiEmpresa` pergunta as lojas e o SQL as ignora); aqui vale a intenção:
 * as lojas escolhidas — todas marcadas dá o consolidado. O checklist de natureza é invisível no legado (todas marcadas): sem filtro.
 */
@Injectable()
export class DreRelatorioService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: FiltroDre): Promise<{ relatorio: Linha[]; semVinculo: Array<{ conta: string; natureza: number }>; aviso: string | null; nivelMaximo: number; empresas: number[] }> {
    if (!f.dataIni || !f.dataFim) throw new BusinessRuleError('DRE_PERIODO_OBRIGATORIO', {}, 'A data inicial deve ser informada.');
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DRE_PERIODO_INVALIDO', {}, 'A data inicial não pode ser maior que a final.');
    if ((f.planos ?? []).length > 1000) throw new BusinessRuleError('DRE_PLANOS_EXCEDIDOS', {}, 'O número máximo de planos de contas permitidos no filtro foi ultrapassado (1000).');
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const empresas = await empresasDoOperador(db, f.empresas ?? null);
    const mascara = String((await configNaTrx(db, 'MASCARA_CONFIGURACAO_DRE_CONTABIL', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? '');
    const maxNivelEstrutura = num((await sql<{ m: unknown }>`SELECT max(nivel) AS m FROM dre_estrutura WHERE coalesce(ativo, 'S') = 'S'`.execute(db)).rows[0]?.m) || 1;
    const nivelMaximo = mascara ? (mascara.match(/\./g)?.length ?? 0) + 1 : maxNivelEstrutura;

    // a estrutura achatada (GetSQLConfigDRE): as linhas do último nível com os ancestrais, e as E do nível 1
    const est = (await sql<Linha>`SELECT codestrutura, codexpandido, descricao, tipo_calculo, classe, expressao, nivel, codpai FROM dre_estrutura WHERE coalesce(ativo, 'S') = 'S'`.execute(db)).rows;
    const porCod = new Map(est.map((e) => [num(e.codestrutura), e]));
    const cfg = (e: Linha, n?: number): Linha => {
      const s = n == null ? '' : `_NIVEL${n}`;
      return {
        [`CFGDRE_CODIGO${s}`]: num(e.codestrutura), [`CFGDRE_CODEXPANDIDO${s}`]: e.codexpandido ?? null, [`CFGDRE_DESCRICAO${s}`]: e.descricao ?? null,
        [`CFGDRE_TIPO_CALCULO${s}`]: e.tipo_calculo ?? null, [`CFGDRE_EXPRESSAO${s}`]: e.expressao ?? null,
      };
    };
    const config: Linha[] = [];
    for (const e of est.filter((x) => num(x.nivel) === nivelMaximo)) {
      const l: Linha = { ...cfg(e), CFGDRE_CLASSE: e.classe ?? null, CFGDRE_NIVEL: num(e.nivel), CFGDRE_CODPAI: e.codpai == null ? null : num(e.codpai), VALOR: 0 };
      let anc: Linha | undefined = e;
      for (let n = nivelMaximo - 1; n >= 1; n--) {
        anc = anc?.codpai != null ? porCod.get(num(anc.codpai)) : undefined;
        Object.assign(l, anc ? cfg(anc, n) : cfg({}, n), { [`VALOR_NIVEL${n}`]: 0 });
      }
      config.push(l);
    }
    for (const e of est.filter((x) => num(x.nivel) === 1 && x.tipo_calculo === 'E')) {
      const l: Linha = { ...cfg(e), CFGDRE_CLASSE: e.classe ?? null, CFGDRE_NIVEL: 1, CFGDRE_CODPAI: e.codpai == null ? null : num(e.codpai), VALOR: 0 };
      for (let n = nivelMaximo - 1; n >= 1; n--) Object.assign(l, cfg(e, n), { [`VALOR_NIVEL${n}`]: 0 });
      config.push(l);
    }
    const chaveOrdem = (l: Linha) => [...Array.from({ length: Math.max(0, nivelMaximo - 1) }, (_, i) => String(l[`CFGDRE_CODEXPANDIDO_NIVEL${i + 1}`] ?? '')), String(l.CFGDRE_CODEXPANDIDO ?? '')];
    config.sort((a, b) => { const ka = chaveOrdem(a); const kb = chaveOrdem(b); for (let i = 0; i < ka.length; i++) { const c = ka[i].localeCompare(kb[i]); if (c) return c; } return 0; });

    // os lançamentos (GetSQLLancamentos), com o filtro de plano de contas (as analíticas abaixo das escolhidas)
    const planos = f.planos?.length ? f.planos : null;
    const lanc = (await sql<Linha>`
      WITH RECURSIVE arvore AS (
        SELECT codplanocontas, classe FROM plano_contas WHERE ${planos ? sql`codplanocontas = ANY(${planos}::int[])` : sql`false`}
        UNION SELECT p.codplanocontas, p.classe FROM plano_contas p JOIN arvore a ON p.codpai = a.codplanocontas
      ), filtro AS (SELECT DISTINCT codplanocontas FROM arvore WHERE classe = 'A')
      SELECT d.* FROM (
        SELECT d.datalan, p.codplanocontas, p.codiexpandido, p.codireduzido, p.descricao, d.valor, d.deschist, v.codestrutura AS cfgdre_codigo, 'C' AS tipo, d.codempresa, p.natureza
          FROM diario d JOIN plano_contas p ON p.codplanocontas = d.contacredito LEFT JOIN dre_conta v ON v.codplanocontas = p.codplanocontas
         WHERE d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date AND d.codempresa = ANY(${empresas}::int[])
        UNION ALL
        SELECT d.datalan, p.codplanocontas, p.codiexpandido, p.codireduzido, p.descricao, d.valor, d.deschist, v.codestrutura, 'D', d.codempresa, p.natureza
          FROM diario d JOIN plano_contas p ON p.codplanocontas = d.contadebito LEFT JOIN dre_conta v ON v.codplanocontas = p.codplanocontas
         WHERE d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date AND d.codempresa = ANY(${empresas}::int[])
      ) d
      ${planos ? sql`JOIN filtro x ON x.codplanocontas = d.codplanocontas` : sql``}
      ORDER BY d.codiexpandido, d.datalan, d.codempresa`.execute(db)).rows;

    // as contas sem vínculo (a guia Observações): resultado (natureza 4) bloqueia
    const vistas = new Set<number>();
    const semVinculo: Array<{ conta: string; natureza: number }> = [];
    for (const l of lanc) {
      if (l.cfgdre_codigo != null || vistas.has(num(l.codplanocontas))) continue;
      vistas.add(num(l.codplanocontas));
      semVinculo.push({ conta: `${l.codiexpandido ?? ''} - ${l.descricao ?? ''} (${l.codireduzido ?? ''})`, natureza: num(l.natureza) });
    }
    if (semVinculo.some((s) => s.natureza === 4)) {
      throw new BusinessRuleError('DRE_CONTAS_SEM_VINCULO', { contas: semVinculo }, 'Existem planos de contas de resultado sem vinculação.\nVerifique a guia observações.');
    }
    const aviso = semVinculo.length ? 'Existem planos de contas sem vinculação.\nVerifique a guia observações.' : null;

    // P: uma linha por lançamento vinculado (ou zerada)
    const porLinha = new Map<number, Linha[]>();
    for (const l of lanc) if (l.cfgdre_codigo != null) porLinha.set(num(l.cfgdre_codigo), [...(porLinha.get(num(l.cfgdre_codigo)) ?? []), l]);
    const dia = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}T00:00:00` : v ? `${String(v).slice(0, 10)}T00:00:00` : null);
    let rel: Linha[] = [];
    for (const c of config) {
      const ls = porLinha.get(num(c.CFGDRE_CODIGO)) ?? [];
      if (!ls.length) rel.push({ ...c, VALOR: 0, DATA_LANCAMENTO: '1899-12-30T00:00:00', HISTORICO: '', CODEMPRESA: 0 });
      else for (const l of ls) rel.push({ ...c, VALOR: r2(num(l.valor) * (l.tipo === 'C' ? 1 : -1)), DATA_LANCAMENTO: dia(l.datalan), HISTORICO: l.deschist ?? '', CODEMPRESA: num(l.codempresa) });
    }
    // F: do penúltimo nível ao primeiro
    for (let n = nivelMaximo - 1; n >= 1; n--) {
      const somas = new Map<number, number>();
      for (const l of rel) if (l[`CFGDRE_TIPO_CALCULO_NIVEL${n}`] === 'F') somas.set(num(l[`CFGDRE_CODIGO_NIVEL${n}`]), r2((somas.get(num(l[`CFGDRE_CODIGO_NIVEL${n}`])) ?? 0) + num(l.VALOR)));
      for (const l of rel) if (somas.has(num(l[`CFGDRE_CODIGO_NIVEL${n}`]))) l[`VALOR_NIVEL${n}`] = somas.get(num(l[`CFGDRE_CODIGO_NIVEL${n}`]));
    }
    // E: a expressão com o VALOR_NIVEL1 das raízes
    const raizes = est.filter((e) => num(e.nivel) === 1).sort((a, b) => num(a.codexpandido) - num(b.codexpandido));
    for (const e of est.filter((x) => x.tipo_calculo === 'E' && num(x.nivel) === 1).sort((a, b) => String(a.codexpandido).localeCompare(String(b.codexpandido)))) {
      let formula = String(e.expressao ?? '');
      let valor = 0;
      if (formula) {
        for (const r of raizes) {
          const achou = rel.find((l) => String(l.CFGDRE_CODEXPANDIDO_NIVEL1 ?? '') === String(r.codexpandido));
          if (achou) formula = formula.split(`<${r.codexpandido}>`).join(num(achou.VALOR_NIVEL1).toFixed(2));
        }
        valor = r2(avaliar(formula));
      }
      for (const l of rel) if (num(l.CFGDRE_CODIGO_NIVEL1) === num(e.codestrutura)) l.VALOR_NIVEL1 = valor;
    }
    if (f.naoExibirZerados) rel = rel.filter((l) => num(l.VALOR) !== 0 || l.CFGDRE_TIPO_CALCULO === 'E');
    if (!rel.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não foram encontrados lançamentos para o filtro informado.');
    return { relatorio: rel, semVinculo, aviso, nivelMaximo, empresas };
  }

  /** o "Imprimir": o DRE Contabil.fr3 com o DBDRelatorio e o DBDVariaveisAdicionais (os níveis expandidos: o padrão do combo é o 2) */
  async impressao(f: FiltroDre) {
    const r = await this.gerar(f);
    const db = this.dbp.forTenantRead() as AnyDB;
    return relatorioMestre(db, {
      arquivo: 'DRE Contabil.fr3', titulo: 'DRE contábil', relatorio: r.relatorio,
      variaveis: { empresas: r.empresas, dataIni: f.dataIni, dataFim: f.dataFim, niveis: f.niveis ?? 2, tabela: 0 },
    });
  }
}
