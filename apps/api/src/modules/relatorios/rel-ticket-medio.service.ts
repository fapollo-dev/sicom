import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroTicketMedio {
  dtini: string; dtfim: string;
  filtrarHora?: boolean; horaPorDia?: boolean; horaIni?: string; horaFim?: string;
  empresas?: number[];
}

/**
 * VALOR DO TICKET MÉDIO (FRMVALORTICKETMEDIO) — 4º relatório. 612 acessos / 9 operadores.
 * Procedência: `uValorTicketMedio.pas` `btnProcessarClick` :~90-140 (os 3 modos de hora) + a query em
 * `udmValorTicketMedio.dfm` (`aqqValorTicketMedio`, com os placeholders de empresa e de filtro de data).
 *
 * DOIS NÍVEIS, e aqui eles NÃO colapsam (ao contrário dos outros relatórios):
 *  · interno: agrupa por **(NROPEDIDO, NROCUPOM, TRUNC(DTVENDA), IDEMPRESA)** e soma bruto/acréscimo/desconto;
 *  · externo: `COUNT(NROCUPOM)` conta esses GRUPOS (= nº de cupons do dia) e divide o total por ele.
 * O interno é obrigatório porque o divisor é uma CONTAGEM DE GRUPOS — não dá para chegar nele numa passada só.
 * Detalhe fiel e sutil: `COUNT(NROCUPOM)` **ignora NULL**, então uma venda sem cupom entra no VALOR e não no
 * DIVISOR (infla a média). No golden não ocorre (34.089/34.089 com cupom na amostra), mas a forma é preservada.
 * `NROPEDIDO` está no GROUP BY do legado e **não** no SELECT — logo um mesmo cupom em 2 pedidos conta 2 vezes.
 *
 * O líquido é a MESMA fórmula da rel-vendas (bruto por IAT + acréscimo − desconto), já certificada.
 *
 * TRÊS MODOS DE HORA (fiel, e corrobora o achado da rel-vendas):
 *  · sem `filtrarHora` → o dia inteiro;
 *  · `filtrarHora` → janela **CONTÍNUA** dtini+horaIni → dtfim+horaFim (o default do legado);
 *  · `filtrarHora` + `horaPorDia` → a faixa horária em CADA dia (checkbox próprio `cbHoraPorDia`).
 * Tudo resolvido no fuso do negócio (FUSO_HORARIO_ACESSO) — `dtvenda` é timestamptz e o balde do dia em UTC
 * jogaria a venda da noite para o dia seguinte (fold de classe, já aplicado nos 2 relatórios anteriores).
 *
 * ADIADO: impressão frx (`Rel_TicketMedio.fr3`).
 */
@Injectable()
export class RelTicketMedioService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroTicketMedio): Promise<{
    linhas: Record<string, unknown>[]; totais: Record<string, number | null>; filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = (f.empresas?.length ? f.empresas.map(Number) : [emp]).filter((e) => e === emp);
    if (!empresas.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: f.empresas });

    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const fim = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fim.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fim.setUTCDate(fim.getUTCDate() + 1);
    const ate = fim.toISOString().slice(0, 10);
    const comHora = !!f.filtrarHora && !!f.horaIni && !!f.horaFim;
    const porDia = comHora && !!f.horaPorDia;

    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const desconto = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    const acrescimo = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;

    // ---- nível ITEM → CUPOM: a derivada, com o dia já no fuso do negócio ----
    let porLinha = db
      .selectFrom('vendas as v')
      .select([
        sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
        'v.idempresa', 'v.nropedido', 'v.nrocupom',
        bruto.as('bruto'), desconto.as('desconto'), acrescimo.as('acrescimo'),
      ])
      .where(sql`coalesce(v.cancelado,'N')`, '=', 'N')   // fiel: só não-canceladas
      .where('v.idempresa', 'in', empresas);

    if (comHora && !porDia) {
      // janela CONTÍNUA (o default do legado quando marca "filtrar hora")
      const de = f.dtini + ' ' + f.horaIni;
      const ateHora = f.dtfim + ' ' + f.horaFim;
      porLinha = porLinha
        .where('v.dtvenda', '>=', sql`(${de}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<=', sql`(${ateHora}::timestamp at time zone ${tz})`);
    } else {
      porLinha = porLinha
        .where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
        .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
      if (porDia) {
        // a faixa horária em CADA dia — a hora também no fuso do negócio
        porLinha = porLinha
          .where(sql`to_char(v.dtvenda at time zone ${tz}, 'HH24:MI')`, '>=', f.horaIni!)
          .where(sql`to_char(v.dtvenda at time zone ${tz}, 'HH24:MI')`, '<=', f.horaFim!);
      }
    }

    // nível CUPOM (o interno do legado): 1 linha por (pedido, cupom, dia, empresa)
    const porCupom = db
      .selectFrom(porLinha.as('l'))
      .select([
        'l.dia', 'l.idempresa', 'l.nropedido', 'l.nrocupom',
        sql`sum(l.bruto)`.as('bruto'), sql`sum(l.desconto)`.as('desconto'), sql`sum(l.acrescimo)`.as('acrescimo'),
      ])
      .groupBy(['l.dia', 'l.idempresa', 'l.nropedido', 'l.nrocupom']);

    // nível DIA (o externo): COUNT(nrocupom) conta os grupos — e ignora NULL, como o legado
    const linhas = (await db
      .selectFrom(porCupom.as('c'))
      .leftJoin('empresas as e', 'e.idempresa', 'c.idempresa')
      .select([
        'c.dia', 'c.idempresa', sql`e.fantasia`.as('empresa'),
        sql`count(c.nrocupom)`.as('cupons'),
        sql`round(sum(c.bruto + c.acrescimo - c.desconto)::numeric, 2)`.as('total_venda'),
      ])
      .groupBy(['c.dia', 'c.idempresa', sql`e.fantasia`])
      .orderBy('c.idempresa')
      .orderBy('c.dia')
      .execute()) as Record<string, unknown>[];

    const comMedia = linhas.map((l) => {
      const cupons = num(l.cupons);
      const total = r2(num(l.total_venda));
      return {
        ...l,
        cupons,
        total_venda: total,
        // o legado divide sem NULLIF, mas Count nunca é 0 num grupo que existe — salvo o caso em que TODOS os
        // cupons do dia são NULL. Aí a média é DESCONHECIDA (null), nunca 0 (lição do denominador nulo).
        media: cupons > 0 ? r2(total / cupons) : null,
      };
    });

    const cupons = comMedia.reduce((s, l) => s + num(l.cupons), 0);
    const total = r2(comMedia.reduce((s, l) => s + num(l.total_venda), 0));
    const totais = {
      dias: comMedia.length,
      cupons,
      total_venda: total,
      // o ticket médio do PERÍODO é recalculado (total ÷ cupons), não a média das médias diárias
      media: cupons > 0 ? r2(total / cupons) : null,
    };
    return {
      linhas: comMedia, totais,
      filtro: { ...f, empresas, fuso: tz, modo_hora: comHora ? (porDia ? 'POR_DIA' : 'CONTINUA') : 'DIA_INTEIRO' },
    };
  }
}
