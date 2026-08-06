import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** os 5 modos do diálogo `OpcoesForm` do legado (uVendas.pas:1418-1424). */
export type ModoSemMovimento = 'SEM_COMPRA' | 'SEM_VENDA' | 'SEM_NENHUMA' | 'COMPROU_SEM_SAIDA' | 'VENDEU_SEM_COMPRA';

export interface FiltroSemMovimento {
  dtini: string; dtfim: string;
  modo?: ModoSemMovimento;
  empresas?: number[];
  codfor?: number; departamento?: number; grupo?: number; subgrupo?: number; secao?: number;
  cadastradoDe?: string; cadastradoAte?: string;   // FSubData — filtro por data de CADASTRO do produto
}

/**
 * PRODUTOS SEM MOVIMENTO NO PERÍODO — relatório **13** do hub FRMRELVENDAS (trilha Vendas).
 * Procedência: `uVendas.pas` `TVendas.ProdutosSemMovimentacao` :1400-1520, despachado em `GetSQL` :481.
 * É o complemento da rel 01: em vez do que girou, mostra **o que NÃO girou** — o encalhe.
 *
 * CINCO MODOS (diálogo `OpcoesForm` do legado), sobre a origem calculada de cada produto:
 *   · SEM ENTRADA = o produto NÃO aparece em NF de entrada (`tipo='E'`) no período;
 *   · SEM SAIDA   = NÃO aparece em VENDAS não-cancelada NEM em NF de saída (`tipo <> 'E' or tipo is null`).
 *   0 Sem Compra              → SEM ENTRADA
 *   1 Sem Venda               → SEM SAIDA
 *   2 Sem Nenhuma Movimentação→ as DUAS origens ao mesmo tempo
 *   3 Comprou e não teve saída→ SEM SAIDA   (mesmo filtro do 1 — ver abaixo)
 *   4 Vendeu e não teve compra→ SEM ENTRADA (mesmo filtro do 0 — ver abaixo)
 * ⚠️ Os modos 3 e 4 usam o MESMO filtro de origem que 1 e 0; o que muda é a **variante da CTE**: os modos 2/3/4
 * montam a origem SEM `ativo='S'` e SEM `cancelada='N'` nas pernas de NF, enquanto 0/1 montam COM as duas
 * restrições. Copiado assim — é a diferença real entre eles no legado, por mais que os rótulos sugiram outra
 * coisa (3 diz "comprou e não teve saída" mas não verifica que comprou).
 *
 * FILTRO DE ATIVO: o legado escolhe entre `multi_preco.ativo` e `produtos.ativo` conforme a config
 * `ATIVO_PELA_MULTIPRECO` (valor VIVO no tenant = 'S' → usa o multi_preco). Mesmo padrão da Exporta-Balança.
 *
 * DIVERGÊNCIA DELIBERADA: o legado ainda faz `JOIN ESTOQUE_DEP` (inner) — tabela não migrada. Medido: ela tem
 * os **mesmos 43.116 produtos** de `estoque` (137.524 linhas em ambas), então o join é filtro de existência que
 * não exclui ninguém. Portá-la só para isso seria peso morto; usamos `estoque`.
 */
@Injectable()
export class RelSemMovimentoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroSemMovimento): Promise<{
    linhas: Record<string, unknown>[]; totais: Record<string, number>; filtro: Record<string, unknown>;
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
    const de = sql`(${f.dtini}::timestamp at time zone ${tz})`;
    const ateTs = sql`(${ate}::timestamp at time zone ${tz})`;

    const modo: ModoSemMovimento = f.modo ?? 'SEM_VENDA';
    // modos 2/3/4 usam a CTE "solta" (sem ativo='S' e sem cancelada='N'); 0/1 usam a restrita — fiel.
    const cteSolta = modo === 'SEM_NENHUMA' || modo === 'COMPROU_SEM_SAIDA' || modo === 'VENDEU_SEM_COMPRA';
    // na variante RESTRITA o legado filtra `ATIVO='S'` também no CONJUNTO CANDIDATO (o FROM PRODUTOS da CTE),
    // além do filtro de ativo do rodapé — são dois filtros distintos e ambos existem nos modos 0/1.
    const candidatoAtivo = cteSolta ? null : sql<boolean>`coalesce(p.ativo,'S') = 'S'`;
    const nfNaoCancelada = cteSolta ? sql`` : sql` and coalesce(n.cancelada,'N') = 'N' `;

    // produtos COM entrada no período (NF tipo 'E')
    const comEntrada = sql`
      select distinct np.codproduto
        from nf_prod np join nf n on n.codnf = np.codnf
       where n.dtcontabil >= ${f.dtini}::date and n.dtcontabil < ${ate}::date
         and n.idempresa in (${sql.join(empresas)})
         and upper(coalesce(n.tipo,'')) = 'E' ${nfNaoCancelada}`;
    // produtos COM saída no período (venda não-cancelada OU NF que não é de entrada)
    const comSaida = sql`
      select codproduto from (
        select v.codproduto
          from vendas v
         where v.dtvenda >= ${de} and v.dtvenda < ${ateTs}
           and coalesce(v.cancelado,'N') = 'N'
           and v.idempresa in (${sql.join(empresas)})
        union all
        select np.codproduto
          from nf_prod np join nf n on n.codnf = np.codnf
         where n.dtcontabil >= ${f.dtini}::date and n.dtcontabil < ${ate}::date
           and n.idempresa in (${sql.join(empresas)})
           and (upper(coalesce(n.tipo,'')) <> 'E' or n.tipo is null) ${nfNaoCancelada}
      ) s`;

    const semEntrada = sql<boolean>`p.idproduto not in (${comEntrada})`;
    const semSaida = sql<boolean>`p.idproduto not in (${comSaida})`;
    const origem =
      modo === 'SEM_COMPRA' || modo === 'VENDEU_SEM_COMPRA' ? semEntrada
      : modo === 'SEM_VENDA' || modo === 'COMPROU_SEM_SAIDA' ? semSaida
      : sql<boolean>`${semEntrada} and ${semSaida}`;   // SEM_NENHUMA: as duas ao mesmo tempo

    // ATIVO_PELA_MULTIPRECO decide de onde vem o "ativo" (valor vivo no tenant = 'S')
    const pelaMulti = String((await this.config.resolver('ATIVO_PELA_MULTIPRECO', { empresaId: emp })) ?? 'N').toUpperCase() === 'S';
    const filtroAtivo = pelaMulti ? sql<boolean>`coalesce(m.ativo,'S') = 'S'` : sql<boolean>`coalesce(p.ativo,'S') = 'S'`;

    let q = db
      .selectFrom('produtos as p')
      .leftJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'p.idproduto').on('m.idempresa', 'in', empresas))
      .leftJoin('estoque as e', (j) => j.onRef('e.idproduto', '=', 'p.idproduto').on('e.idempresa', 'in', empresas))
      .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
      .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
      .leftJoin('familias_prod as g', 'g.codfamilia', 'p.codgrupo')
      .leftJoin('familias_prod as sg', 'sg.codfamilia', 'p.codsubgrupo')
      .leftJoin('familias_prod as sc', 'sc.codfamilia', 'p.codsecao')
      .select([
        'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), 'p.unidade', 'p.codfor',
        sql`forn.fantasia`.as('fornecedor'), sql`d.descricao`.as('departamento'), sql`g.descricao`.as('grupo'),
        sql`sg.descricao`.as('subgrupo'), sql`sc.descricao`.as('secao'),
        sql`coalesce(e.qtde,0)`.as('estoque'), sql`coalesce(e.minimo,0)`.as('est_minimo'),
        sql`m.vrvenda`.as('preco'), sql`m.vrcusto`.as('custo'),
        sql`to_char(max(e.dtent) at time zone ${tz}, 'YYYY-MM-DD')`.as('ultima_entrada'),
        sql`p.dtcadastro`.as('dtcadastro'),
      ])
      .where(origem)
      .where(filtroAtivo)
      .groupBy(['p.idproduto', 'p.codbarra', 'p.descricao', 'p.unidade', 'p.codfor', 'forn.fantasia',
        'd.descricao', 'g.descricao', 'sg.descricao', 'sc.descricao', 'e.qtde', 'e.minimo',
        'm.vrvenda', 'm.vrcusto', 'p.dtcadastro']);

    if (candidatoAtivo) q = q.where(candidatoAtivo);
    if (f.codfor != null) q = q.where('p.codfor', '=', Number(f.codfor));
    if (f.departamento != null) q = q.where('p.coddpto', '=', Number(f.departamento));
    if (f.grupo != null) q = q.where('p.codgrupo', '=', Number(f.grupo));
    if (f.subgrupo != null) q = q.where('p.codsubgrupo', '=', Number(f.subgrupo));
    if (f.secao != null) q = q.where('p.codsecao', '=', Number(f.secao));
    // FSubData: filtro por data de CADASTRO do produto (o legado só aplica quando marcado)
    if (f.cadastradoDe && f.cadastradoAte) {
      q = q.where('p.dtcadastro', '>=', sql`${f.cadastradoDe}::date`)
        .where('p.dtcadastro', '<', sql`(${f.cadastradoAte}::date + 1)`);
    }

    const MAX_LINHAS = 20000;
    const brutas = (await q.orderBy(sql`p.descricao`).limit(MAX_LINHAS + 1).execute()) as Record<string, unknown>[];
    const truncado = brutas.length > MAX_LINHAS;
    const linhas = (truncado ? brutas.slice(0, MAX_LINHAS) : brutas).map((r) => ({
      ...r,
      estoque: r3(num(r.estoque)),
      est_minimo: r3(num(r.est_minimo)),
      // parado com estoque é o caso que dói: dinheiro na prateleira sem giro
      parado_com_estoque: num(r.estoque) > 0,
    }));

    const totais = {
      produtos: linhas.length,
      com_estoque: linhas.filter((l) => l.parado_com_estoque).length,
      estoque_total: r3(linhas.reduce((s, l) => s + num(l.estoque), 0)),
    };
    return { linhas, totais, filtro: { ...f, empresas, modo, fuso: tz, ativo_pela_multipreco: pelaMulti, truncado, max_linhas: MAX_LINHAS } };
  }
}
