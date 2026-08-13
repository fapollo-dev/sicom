import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroVendasDepartamento {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
  canceladas?: 'N' | 'S' | 'T';
  promocao?: 'S' | 'N' | 'T';
  produto?: string; fornecedor?: string;
  departamentos?: number[]; grupos?: number[]; subgrupos?: number[]; secoes?: number[];
  aliquota?: string;
}

/**
 * VENDAS DATA / DEPARTAMENTO — rel 38 do hub FRMRELVENDAS. São **TRÊS** queries no legado, todas portadas:
 *   1. `VendasDataDepartamento` (GetSQL case 38)        → a GRADE: dia × departamento
 *   2. `VendasDepartamento`     (GetSQLSubConsulta 38)  → o MESMO agregado SEM a dimensão de dia (departamento
 *      no período inteiro). No legado alimenta `dbdSubConsulta`, um dataset do **frx** — é a banda de resumo do
 *      IMPRESSO, não uma coluna da grade. Entregue aqui como 2ª tabela da tela.
 *   3. `GetTicketMedio`         (GetSQLAuxiliar 38)     → um único valor MEDIA p/ o período.
 *
 * Dois níveis obrigatórios (o de baixo é o CUPOM, o de cima CONTA cupons — lição 32). ⚠️ O nível do cupom aqui
 * agrupa por `(dia, empresa, NROCUPOM, coddpto, descricao)` — **SEM `NROPEDIDO`**, ao contrário da rel 02. Dois
 * cupons de PDVs diferentes com o mesmo número no mesmo dia/departamento viram UM. Copiado como está.
 *
 * ⚠️ QUATRO MEDIDAS QUE NÃO SÃO O QUE O NOME DIZ — todas conferidas no SQL, nenhuma "corrigida":
 *
 *  · `MARGEM` = `SUM(TOTAL_CUSTO) / SUM(TOTAL_VENDA) × 100`. É a **participação do CUSTO** na venda, NÃO o
 *    markup das rel 01/02 (`venda/custo − 1`). Em departamento com 30% de lucro esta coluna mostra ~70.
 *  · `VR_TICKET_MEDIO` = `AVG(CALCVLRMEDIO)`, onde `CALCVLRMEDIO = AVG(trunc(qtde × vrvenda × 100)/100)` no
 *    nível do cupom: é **média de médias** — a média, entre cupons, do valor médio do ITEM. Não é faturamento
 *    ÷ cupons (esse é o da query 3). E o `AVG` interno **ignora o IAT**: trunca sempre, enquanto o
 *    `TOTAL_VENDA` da mesma query respeita `IAT='A'` → arredonda. Duas contas do mesmo valor na mesma query.
 *  · `RENTABILIDADE` divide por **`NULLIF(...,0)`** ⇒ BRANCO quando a venda é 0 — ao contrário da rel 02, que
 *    tem `CASE ... THEN 0` e mostra 0,00. Fidelidade é por relatório (lição 46).
 *  · `DESC_ACRE` = `SUM(CAST(DESC_ACRE_MEDIO,2))` — só a coluna `desc_acre_medio`, **assinada e sem separar
 *    sinal**, embora a MESMA query decomponha essa coluna em ACRESCIMO (parte +) e DESC_PROMOCAO (parte −).
 *    É a soma crua, e pode ser negativa.
 *
 * ⚠️ A query 3 (ticket médio do período) agrupa o cupom **COM `NROPEDIDO`**, e a query 1 sem. Logo o nº de
 * cupons de uma NÃO é o da outra quando há colisão de número entre PDVs — a média do rodapé pode não fechar
 * com as colunas da grade. Divergência do legado, preservada e sinalizada na resposta (`cupons_ticket`).
 *
 * `TOTAL_CUSTO_ESTOQUE`, `TOTAL_CUSTO_ESTOQUE_REP` e `COBERTURA` da query 2 são **literais 0 no fonte** —
 * cópia-fiel-negativa: existem no leiaute e o legado nunca os calcula.
 *
 * Departamento nulo vira `'GRUPO NAO DEFINIDO'` (CASE do legado). `TRUNC(A.DTVENDA)` resolve no fuso da sessão
 * ⇒ balde e limites com `FUSO_HORARIO_ACESSO`.
 */
@Injectable()
export class RelVendasDepartamentoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroVendasDepartamento): Promise<{
    linhas: Record<string, unknown>[];
    departamentos: Record<string, unknown>[];
    totais: Record<string, unknown>;
    filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const db = this.dbp.forTenantRead() as AnyDB;
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const fimExcl = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fimExcl.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fimExcl.setUTCDate(fimExcl.getUTCDate() + 1);
    const ate = fimExcl.toISOString().slice(0, 10);

    // fórmulas por ITEM — as mesmas do resto do hub
    const bruto = sql`case when coalesce(a.iat,'') = 'A'
      then round((coalesce(a.qtde,0) * coalesce(a.vrvenda,0))::numeric, 2)
      else trunc((coalesce(a.qtde,0) * coalesce(a.vrvenda,0))::numeric * 100) / 100 end`;
    // ⚠️ o CALCVLRMEDIO do legado NÃO usa o IAT: trunca sempre. Mantido diferente do `bruto` de propósito.
    const brutoTrunc = sql`trunc((coalesce(a.qtde,0) * coalesce(a.vrvenda,0))::numeric * 100) / 100`;
    const acresc = sql`greatest(coalesce(a.desc_acre_medio,0),0) + greatest(coalesce(a.desc_acre_item,0),0)`;
    const desc = sql`coalesce(a.desc_promocao,0) + coalesce(a.desc_departamento,0)
      + abs(least(coalesce(a.desc_acre_medio,0),0)) + abs(least(coalesce(a.desc_acre_item,0),0))`;
    const custoItem = sql`round((coalesce(a.qtde,0) * coalesce(a.vrcusto,0))::numeric, 2)`;
    const dpto = sql`coalesce(d.descricao, 'GRUPO NAO DEFINIDO')`;

    /** o nível do CUPOM, com ou sem a dimensão de dia (a query 1 tem, a 2 não). */
    const nivelCupom = (comDia: boolean) => {
      let q = db
        .selectFrom('vendas as a')
        .leftJoin('produtos as p', 'p.idproduto', 'a.codproduto')
        .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          'a.idempresa', 'p.coddpto', sql`${dpto}`.as('departamento'), 'a.nrocupom',
          ...(comDia ? [sql`to_char(a.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia')] : []),
          sql`round(sum(${custoItem})::numeric, 2)`.as('total_custo'),
          sql`sum(${bruto})`.as('total_venda'),
          sql`round(sum(coalesce(a.desc_acre_medio,0))::numeric, 2)`.as('desc_acre'),
          sql`sum(${acresc})`.as('acrescimo'),
          sql`sum(${desc})`.as('desc_promocao'),
          // média do valor do ITEM dentro do cupom (o AVG interno do legado, sem IAT)
          sql`avg(${brutoTrunc})`.as('calcvlrmedio'),
        ])
        .where('a.idempresa', '=', emp);
      if (f.filtrarHora && f.horaIni && f.horaFim) {
        q = q.where('a.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
          .where('a.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
      } else {
        q = q.where('a.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
          .where('a.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
      }
      const canc = f.canceladas ?? 'N';
      if (canc === 'N') q = q.where(sql<boolean>`coalesce(a.cancelado,'N') = 'N'`);
      else if (canc === 'S') q = q.where(sql<boolean>`coalesce(a.cancelado,'N') = 'S'`);
      if (f.promocao === 'S') q = q.where('a.promocao', '=', 'S');
      if (f.promocao === 'N') q = q.where('a.promocao', '=', 'N');
      if (f.produto) q = q.where(sql<boolean>`upper(p.descricao) like ${`%${f.produto.toUpperCase()}%`}`);
      if (f.fornecedor) q = q.where(sql<boolean>`upper(forn.razao) like ${`%${f.fornecedor.toUpperCase()}%`}`);
      if (f.departamentos?.length) q = q.where('p.coddpto', 'in', f.departamentos.map(Number));
      if (f.grupos?.length) q = q.where('p.codgrupo', 'in', f.grupos.map(Number));
      if (f.subgrupos?.length) q = q.where('p.codsubgrupo', 'in', f.subgrupos.map(Number));
      if (f.secoes?.length) q = q.where('p.codsecao', 'in', f.secoes.map(Number));
      if (f.aliquota) q = q.where(sql<boolean>`a.aliquota like ${`%${f.aliquota}%`}`);
      // o balde de dia é expressão COM PARÂMETRO (o fuso) e `departamento` tem coalesce: agrupar pelo ORDINAL
      // evita o "must appear in the GROUP BY" que placeholders distintos provocam (lição 29).
      return comDia
        ? q.groupBy(['a.idempresa', 'p.coddpto', sql`3`, 'a.nrocupom', sql`5`])
        : q.groupBy(['a.idempresa', 'p.coddpto', sql`3`, 'a.nrocupom']);
    };

    /** as medidas do nível de cima, iguais nas queries 1 e 2. */
    const medidas = [
      sql`round(sum(c.total_custo)::numeric, 2)`.as('total_custo'),
      sql`sum(c.total_venda + c.acrescimo - c.desc_promocao)`.as('total_venda'),
      sql`sum(c.desc_acre)`.as('desc_acre'),
      sql`sum(c.desc_promocao)`.as('desc_promocao'),
      sql`sum(c.acrescimo)`.as('acrescimo'),
      // média de médias, arredondada a 2 (CAST(AVG(CALCVLRMEDIO) AS NUMERIC(13,2)))
      sql`round(avg(c.calcvlrmedio)::numeric, 2)`.as('vr_ticket_medio'),
      sql`round(sum((c.total_venda + c.acrescimo - c.desc_promocao) - c.total_custo)::numeric, 2)`.as('total_lucro'),
      // MARGEM = participação do CUSTO na venda (não é markup) — 0 quando a venda não é positiva, fiel ao CASE
      sql`case when sum(c.total_venda + c.acrescimo - c.desc_promocao) > 0
        then round(((sum(c.total_custo) / sum(c.total_venda + c.acrescimo - c.desc_promocao)) * 100)::numeric, 2)
        else 0 end`.as('margem'),
      // RENTABILIDADE com NULLIF ⇒ NULL (branco) quando a venda é 0
      sql`round(((sum((c.total_venda + c.acrescimo - c.desc_promocao) - c.total_custo)
        / nullif(sum(c.total_venda + c.acrescimo - c.desc_promocao), 0)) * 100)::numeric, 2)`.as('rentabilidade'),
      sql`count(c.nrocupom)`.as('cupons'),
    ];

    // ---- 1) a GRADE: dia × departamento ----
    const grade = db
      .selectFrom(nivelCupom(true).as('c'))
      .select(['c.idempresa', 'c.dia', 'c.coddpto', 'c.departamento', ...medidas])
      .groupBy(['c.idempresa', 'c.dia', 'c.coddpto', 'c.departamento'])
      .orderBy('c.dia').orderBy('c.departamento');

    // ---- 2) a banda do impresso: departamento no período inteiro (+ as 3 colunas mortas) ----
    const porDpto = db
      .selectFrom(nivelCupom(false).as('c'))
      .select(['c.coddpto', 'c.departamento', ...medidas])
      .groupBy(['c.coddpto', 'c.departamento'])
      .orderBy(sql`sum(c.total_venda + c.acrescimo - c.desc_promocao) desc`);

    // ---- 3) o auxiliar: MEDIA do período. ⚠️ agrupa o cupom COM nropedido (a query 1 não) ----
    let tk = db
      .selectFrom('vendas as a')
      .leftJoin('produtos as p', 'p.idproduto', 'a.codproduto')
      .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
      .select([
        'a.nrocupom',
        sql`sum(${bruto}) + sum(${acresc}) - sum(${desc})`.as('liquido'),
      ])
      .where('a.idempresa', '=', emp);
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      tk = tk.where('a.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where('a.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    } else {
      tk = tk.where('a.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
        .where('a.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    }
    const canc = f.canceladas ?? 'N';
    if (canc === 'N') tk = tk.where(sql<boolean>`coalesce(a.cancelado,'N') = 'N'`);
    else if (canc === 'S') tk = tk.where(sql<boolean>`coalesce(a.cancelado,'N') = 'S'`);
    if (f.promocao === 'S') tk = tk.where('a.promocao', '=', 'S');
    if (f.promocao === 'N') tk = tk.where('a.promocao', '=', 'N');
    if (f.departamentos?.length) tk = tk.where('p.coddpto', 'in', f.departamentos.map(Number));
    if (f.produto) tk = tk.where(sql<boolean>`upper(p.descricao) like ${`%${f.produto.toUpperCase()}%`}`);
    if (f.fornecedor) tk = tk.where(sql<boolean>`upper(forn.razao) like ${`%${f.fornecedor.toUpperCase()}%`}`);
    tk = tk.groupBy(['a.nropedido', 'a.nrocupom', sql`(a.dtvenda at time zone ${tz})::date`, 'a.idempresa']);
    const ticket = db
      .selectFrom(tk.as('t'))
      .select([
        sql`round((sum(t.liquido) / nullif(count(t.nrocupom),0))::numeric, 2)`.as('media'),
        sql`count(t.nrocupom)`.as('cupons'),
      ]);

    const [linhasRaw, dptoRaw, tkRaw] = await Promise.all([grade.execute(), porDpto.execute(), ticket.execute()]);
    const rows = linhasRaw as Record<string, unknown>[];
    const dptos = dptoRaw as Record<string, unknown>[];
    const tkRow = (tkRaw as Record<string, unknown>[])[0] ?? {};

    const mapear = (r: Record<string, unknown>): Record<string, unknown> => ({
      ...r,
      total_custo: r2(num(r.total_custo)),
      total_venda: r2(num(r.total_venda)),
      total_lucro: r2(num(r.total_lucro)),
      desc_acre: r2(num(r.desc_acre)),
      desc_promocao: r2(num(r.desc_promocao)),
      acrescimo: r2(num(r.acrescimo)),
      vr_ticket_medio: r.vr_ticket_medio == null ? null : r2(num(r.vr_ticket_medio)),
      margem: r2(num(r.margem)),
      rentabilidade: r.rentabilidade == null ? null : r2(num(r.rentabilidade)),
      cupons: Number(r.cupons ?? 0),
    });
    const linhas = rows.map(mapear);
    const departamentos: Record<string, unknown>[] = dptos.map((d) => ({
      ...mapear(d),
      // literais 0 no fonte do legado — o leiaute tem as colunas e nada as calcula (cópia-fiel-negativa)
      total_custo_estoque: 0, total_custo_estoque_rep: 0, cobertura: 0,
    }));

    const somar = (ls: Record<string, unknown>[], k: string) => r2(ls.reduce((s, l) => s + num(l[k]), 0));
    const totalVenda = somar(departamentos, 'total_venda');
    const totalCusto = somar(departamentos, 'total_custo');
    return {
      linhas, departamentos,
      totais: {
        dias: new Set(linhas.map((l) => l.dia)).size,
        total_venda: totalVenda,
        total_custo: totalCusto,
        total_lucro: somar(departamentos, 'total_lucro'),
        cupons: departamentos.reduce((s, d) => s + Number(d.cupons ?? 0), 0),
        // a query 3 do legado: faturamento ÷ cupons no período. `cupons_ticket` vai junto porque o
        // agrupamento dela inclui NROPEDIDO e pode não bater com o `cupons` acima.
        ticket_medio_periodo: tkRow.media == null ? null : r2(num(tkRow.media)),
        cupons_ticket: Number(tkRow.cupons ?? 0),
        margem: totalVenda > 0 ? r2((totalCusto / totalVenda) * 100) : 0,
        rentabilidade: totalVenda !== 0 ? r2(((totalVenda - totalCusto) / totalVenda) * 100) : null,
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }
}
