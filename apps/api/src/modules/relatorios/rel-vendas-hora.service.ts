import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroVendasHora {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
  canceladas?: 'N' | 'S' | 'T';
  promocao?: 'S' | 'N' | 'T';
  produto?: string; fornecedor?: string;
  departamentos?: number[]; grupos?: number[]; subgrupos?: number[]; secoes?: number[];
  aliquota?: string;
  /** traz também o detalhe por HORÁRIO EXATO (a subconsulta `VendasPorMinuto`) */
  detalhe?: boolean;
}

interface Sessao {
  data: string; codpdv: number | null; codoperadora: number | null; chave: string | null;
  horaentrada: number | null; horasaida: number | null;
}

/**
 * VENDAS POR HORA — rel 07 do hub FRMRELVENDAS. São **três** fontes no legado, todas portadas:
 *   1. `VendasPorHora`   (GetSQL 07)        → faturamento por HORA (0-23)
 *   2. `VendasPorMinuto` (GetSQLSubConsulta 07) → o mesmo por HORÁRIO EXATO (`TO_CHAR(DTVENDA,'HH24:MI:SS')`)
 *   3. `TRelVendasPorHora.GetQuantidadeOperadorasLogadas` (`URelVendasPorHora.pas`, chamado por `ProcessaRel7`)
 *      → **quantos CAIXAS estavam abertos** em cada hora, com a média por dia. É o par que dá sentido ao
 *      relatório: faturamento do pico contra caixa aberto no pico.
 *
 * (1) e (2) colapsam em uma passada: o nível interno agrupa por `V.CODVENDAS`, que é a PK de VENDAS, então é
 * 1 linha por item e os SUMs internos são no-ops. E a `HORA` do interno é uma **subconsulta correlacionada pela
 * PRÓPRIA PK** (`SELECT MAX(extract(hour ...)) FROM VENDAS VE WHERE VE.CODVENDAS = V.CODVENDAS`) — devolve
 * sempre a hora da própria linha, logo é `extract(hour from v.dtvenda)`. Equivalência por construção.
 *
 * ⚠️ O detalhe (2) agrupa pelo TEXTO `HH24:MI:SS`, sem a data: num período de vários dias, **o mesmo horário de
 * dias diferentes SOMA na mesma linha**. É o que o legado faz (o gráfico é um perfil de horário, não uma série
 * temporal). Preservado, e por isso o detalhe vem com `dias_no_periodo` p/ a tela não sugerir série.
 *
 * ⚠️ (3) é ALGORITMO, não SQL — a query só devolve as SESSÕES e o Delphi expande cada uma nas horas que ela
 * cobre. Portado com os quatro detalhes que importam:
 *   · hora de abertura = `HourOf(HORAENTRADA)`; se estiver vazia, sai de **`Copy(CHAVE, 9, 2)`** — a CHAVE tem
 *     14 chars no leiaute `PP AAMMDD HHMMSS` (conferido contra a HORAENTRADA da mesma linha no golden).
 *     Ramo raro: 0 de 12.710 linhas sem HORAENTRADA, mas é o caminho da sessão ABERTA.
 *   · hora de fechamento = `HourOf(HORASAIDA)`; vazia ⇒ **hora ATUAL se a sessão é de hoje, senão 23**
 *     (2 linhas em 12.710).
 *   · `QUANTIDADE` soma 1 por sessão POR HORA coberta; `DIAS` conta (dia, hora) DISTINTOS — é "em quantos dias
 *     havia caixa aberto nesta hora" — e a média é QUANTIDADE ÷ DIAS.
 *   · o `for` do legado é `hIni to hFim`: se o fechamento cair numa hora MENOR que a abertura (sessão que
 *     atravessa a meia-noite), o laço **não executa** e a sessão não conta em hora nenhuma. Copiado.
 *   Horas com quantidade/dias/média todos zerados são REMOVIDAS do resultado (o legado deleta as linhas).
 *
 * A sessão vem de CX_VENDAS ⋈ OPERADORES ⋈ PDV ⋈ CAIXA_PDV. O `JOIN` (interno) com PDV **descarta** venda de
 * PDV não cadastrado na empresa, e o casamento da sessão é `CP.CODPDV = C.NROPDV` (a coluna se chama CODPDV mas
 * guarda o NRO — ver mig 140). `TRUNC` nas duas datas.
 */
@Injectable()
export class RelVendasHoraService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroVendasHora): Promise<{
    horas: Record<string, unknown>[];
    operadoras: Record<string, unknown>[];
    detalhe: Record<string, unknown>[];
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

    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    const liquido = sql`sum(${bruto}) + sum(${acresc}) - sum(${desc})`;

    /** o balde: HORA (0-23) na grade, HH24:MI:SS no detalhe. */
    const porBalde = (balde: 'HORA' | 'HORARIO') => {
      let q = db
        .selectFrom('vendas as v')
        .leftJoin('produtos as p', 'p.idproduto', 'v.codproduto')
        .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
        .select([
          balde === 'HORA'
            ? sql`extract(hour from (v.dtvenda at time zone ${tz}))::int`.as('balde')
            : sql`to_char(v.dtvenda at time zone ${tz}, 'HH24:MI:SS')`.as('balde'),
          sql`round((${liquido})::numeric, 2)`.as('total_venda'),
        ])
        .where('v.idempresa', '=', emp);
      if (f.filtrarHora && f.horaIni && f.horaFim) {
        q = q.where('v.dtvenda', '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
          .where('v.dtvenda', '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
      } else {
        q = q.where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
          .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
      }
      const canc = f.canceladas ?? 'N';
      if (canc === 'N') q = q.where(sql<boolean>`coalesce(v.cancelado,'N') = 'N'`);
      else if (canc === 'S') q = q.where(sql<boolean>`coalesce(v.cancelado,'N') = 'S'`);
      if (f.promocao === 'S') q = q.where('v.promocao', '=', 'S');
      if (f.promocao === 'N') q = q.where('v.promocao', '=', 'N');
      if (f.produto) q = q.where(sql<boolean>`upper(p.descricao) like ${`%${f.produto.toUpperCase()}%`}`);
      if (f.fornecedor) q = q.where(sql<boolean>`upper(forn.razao) like ${`%${f.fornecedor.toUpperCase()}%`}`);
      if (f.departamentos?.length) q = q.where('p.coddpto', 'in', f.departamentos.map(Number));
      if (f.grupos?.length) q = q.where('p.codgrupo', 'in', f.grupos.map(Number));
      if (f.subgrupos?.length) q = q.where('p.codsubgrupo', 'in', f.subgrupos.map(Number));
      if (f.secoes?.length) q = q.where('p.codsecao', 'in', f.secoes.map(Number));
      if (f.aliquota) q = q.where(sql<boolean>`v.aliquota like ${`%${f.aliquota}%`}`);
      // o balde tem PARÂMETRO (o fuso) ⇒ agrupar/ordenar pelo ORDINAL (lição 29)
      return q.groupBy(sql`1`).orderBy(sql`1`);
    };

    // ---- as SESSÕES de caixa (a query 3; a expansão em horas é no TS, como no Delphi) ----
    const sessoes = db
      .selectFrom('cx_vendas as c')
      .innerJoin('operadores as o', 'o.codoperador', 'c.codoperadora')
      .innerJoin('pdv as p', (j) => j.on(sql<boolean>`p.nropdv = c.nropdv and p.codempresa = c.idempresa`))
      .leftJoin('caixa_pdv as cp', (j) => j.on(sql<boolean>`cp.chave = c.chave and cp.codpdv = c.nropdv
        and (cp.data at time zone ${tz})::date = (c.data at time zone ${tz})::date and cp.idempresa = c.idempresa`))
      .select([
        sql`to_char(c.data at time zone ${tz}, 'YYYY-MM-DD')`.as('data'),
        'p.codpdv', 'c.codoperadora', 'c.chave',
        sql`extract(hour from (cp.horaentrada at time zone ${tz}))::int`.as('horaentrada'),
        sql`extract(hour from (cp.horasaida at time zone ${tz}))::int`.as('horasaida'),
      ])
      .where('c.idempresa', '=', emp)
      .where('c.data', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
      .where('c.data', '<', sql`(${ate}::timestamp at time zone ${tz})`)
      .groupBy([sql`1`, 'p.codpdv', 'c.codoperadora', 'c.chave', sql`5`, sql`6`])
      .orderBy(sql`1`);

    const [horasRaw, sessoesRaw, detalheRaw] = await Promise.all([
      porBalde('HORA').execute(),
      sessoes.execute(),
      f.detalhe ? porBalde('HORARIO').limit(5000).execute() : Promise.resolve([]),
    ]);

    const horasVenda = (horasRaw as Record<string, unknown>[]).map((r) => ({
      hora: Number(r.balde), total_venda: r2(num(r.total_venda)),
    }));
    const detalhe = (detalheRaw as Record<string, unknown>[]).map((r) => ({
      horario: String(r.balde), total_venda: r2(num(r.total_venda)),
    }));

    // ---- a expansão das sessões em horas (o laço do Delphi, verbatim) ----
    const agora = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date());
    const hojeTz = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const qtde = new Array(24).fill(0);
    const dias = new Array(24).fill(0);
    const vistos = new Set<string>();
    for (const s of sessoesRaw as unknown as Sessao[]) {
      // abertura: HORAENTRADA ou, na falta dela, a hora embutida na CHAVE (posições 9-10, leiaute PP AAMMDD HHMMSS)
      const hIni = s.horaentrada != null
        ? Number(s.horaentrada)
        : Number.parseInt(String(s.chave ?? '').slice(8, 10), 10) || 0;
      // fechamento: HORASAIDA ou, na falta dela, a hora ATUAL se a sessão é de hoje, senão 23
      const hFim = s.horasaida != null
        ? Number(s.horasaida)
        : (s.data === hojeTz ? Number.parseInt(agora, 10) || 0 : 23);
      // fiel ao `for hIni to hFim`: fechamento em hora MENOR que a abertura ⇒ laço vazio, sessão não conta
      for (let h = hIni; h <= hFim; h++) {
        if (h < 0 || h > 23) continue;
        qtde[h] += 1;
        const k = `${s.data}#${h}`;
        if (!vistos.has(k)) { vistos.add(k); dias[h] += 1; }
      }
    }
    const operadoras = [] as Record<string, unknown>[];
    for (let h = 0; h < 24; h++) {
      const media = dias[h] > 0 ? qtde[h] / dias[h] : 0;
      // o legado DELETA a hora sem operadora nenhuma
      if (qtde[h] === 0 && dias[h] === 0 && media === 0) continue;
      operadoras.push({ hora: h, quantidade: qtde[h], dias: dias[h], media_quantidade: r2(media) });
    }

    // a grade da tela junta as duas fontes por hora (é como o gráfico do legado é lido)
    const porHora = new Map<number, Record<string, unknown>>();
    for (const v of horasVenda) porHora.set(v.hora, { ...v, quantidade: 0, dias: 0, media_quantidade: 0 });
    for (const o of operadoras) {
      const atual = porHora.get(Number(o.hora)) ?? { hora: Number(o.hora), total_venda: 0 };
      porHora.set(Number(o.hora), { ...atual, ...o });
    }
    const horas = [...porHora.values()].sort((a, b) => Number(a.hora) - Number(b.hora));

    const totalVenda = r2(horasVenda.reduce((s, h) => s + h.total_venda, 0));
    const pico = horasVenda.reduce<{ hora: number; total_venda: number } | null>(
      (m, h) => (m == null || h.total_venda > m.total_venda ? h : m), null,
    );
    return {
      horas, operadoras, detalhe,
      totais: {
        total_venda: totalVenda,
        horas_com_venda: horasVenda.length,
        pico_hora: pico?.hora ?? null,
        pico_valor: pico?.total_venda ?? null,
        // quantos dias distintos o período cobre segundo as SESSÕES (o detalhe soma horários de dias diferentes)
        dias_no_periodo: new Set((sessoesRaw as unknown as Sessao[]).map((s) => s.data)).size,
        caixas_no_pico: pico ? Number(porHora.get(pico.hora)?.quantidade ?? 0) : null,
      },
      filtro: { ...f, empresa: emp, fuso: tz, detalhe_max: 5000 },
    };
  }
}
