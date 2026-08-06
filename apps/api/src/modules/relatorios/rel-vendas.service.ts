import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroRelVendas {
  dtini: string; dtfim: string;
  // CkHora («Filtrar Hora diariamente»): a LEGENDA mente — o SQL do legado é UMA JANELA CONTÍNUA
  // (dtini+horaIni → dtfim+horaFim), não uma faixa por dia. Fiel ao SQL (uVendas.pas:1805-1806 + :422-423).
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
  empresas?: number[];
  canceladas?: 'N' | 'S' | 'T'; // rgCanceladas — default 'N' (não canceladas), fiel
  promocao?: 'S' | 'N' | 'T';
  descontos?: 'COM' | 'SEM' | 'T'; // rgDescontos — testa o desconto TOTAL agregado, não a coluna crua
  agruparEmpresas?: boolean;
  custoReposicao?: boolean; // RgFiltroCusto: usa vrcustorep no lugar de vrcusto
  produto?: string; fornecedor?: string;
  departamentos?: number[]; grupos?: number[]; subgrupos?: number[]; secoes?: number[];
  nrocupom?: number; nropedido?: string; aliquota?: string; nropdv?: number;
  // CkbExibirProdutosFilhos: troca a CHAVE de agrupamento do relatório para o produto FILHO
  // (`COALESCE(A.IDPRODUTO_FILHO, A.CODPRODUTO)`, uVendas.pas:1867 no SELECT e :1986 no GROUP BY).
  exibirFilhos?: boolean;
}

/**
 * RELATÓRIO DE VENDAS — rel 01 "Produtos vendidos no período" (trilha Vendas), a variante DOMINANTE do hub
 * FRMRELVENDAS (TVendas.ProdutosVendidosPeriodo, uVendas.pas:1794-2277). Duas agregações, como o legado: NÍVEL
 * ITEM (materializa bruto/acréscimo/desconto ANTES do arredondamento) → NÍVEL EXIBIDO (1 linha por empresa×produto).
 * FÓRMULAS FIÉIS: bruto = IAT='A' ? round(qtde×vrvenda,2) : trunc(qtde×vrvenda×100)/100 · acréscimo = parte
 * POSITIVA de desc_acre_medio/_item · desconto = desc_promocao + desc_departamento + |parte NEGATIVA| dos mesmos 2
 * campos (os dois são ASSINADOS e vão p/ acréscimo OU desconto conforme o sinal — o detalhe que mais quebra
 * reimplementação) · líquido = Σbruto + acréscimo − desconto · custo = round(qtde×vrcusto,2) (SNAPSHOT da venda,
 * mig 130) · margem(markup) = (líq/custo−1)×100 · rentabilidade(markdown) = (líq−custo)/líq×100. Cancelados são
 * EXCLUÍDOS por filtro (nunca subtraídos) e devoluções NÃO são tratadas (o legado não as referencia aqui). O GRAND
 * TOTAL é RECALCULADO (não é soma das colunas de margem). Colunas de desconto mortas no tenant (categoria/combo/
 * atacarejo/cresce-vendas/acumulativa) saem 0,00 = cópia-fiel-negativa. Demais 49 variantes/trilhas = adiadas.
 *
 * UMA PASSADA ≡ DUAS DO LEGADO (provado na auditoria, não é atalho): o nível ITEM do legado agrupa por
 * A.QTDE/A.VRVENDA/A.IAT/A.CODVENDAS (uVendas.pas:1999-2002) e arredonda as colunas CRUAS (:1872-1876) — logo é
 * Σ round(linha), não round(Σ). Somar `${bruto}` por linha dá o MESMO centavo (conferido em PG: Σround ≠ roundΣ em
 * 1 centavo por chave, e nós estamos do lado certo). Os filtros externos do legado também descem p/ o nível linha
 * porque todos são chaves do GROUP BY interno — EXCEÇÃO: DESC_PROMOCAO, que no legado é o AGREGADO (ver `descontos`).
 */
@Injectable()
export class RelVendasService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async produtosVendidos(f: FiltroRelVendas): Promise<{ linhas: Record<string, unknown>[]; totais: Record<string, number | null>; filtro: Record<string, unknown> }> {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim }); // fiel :485
    const db = this.dbp.forTenantRead() as AnyDB;
    // empresas: as pedidas ∩ a do tenant (o GetMultiEmpresa do legado é multi-seleção; aqui o escopo é o tenant).
    const empresas = (f.empresas?.length ? f.empresas.map(Number) : [emp]).filter((e) => e === emp);
    if (!empresas.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: f.empresas });
    // custo: VRCUSTO (default) ou VRCUSTOREP (radio) — a config dá o default (fiel ao StringReplace global).
    const custoRepDefault = String((await this.config.resolver('VENDAS_FILTRO_CUSTO', { empresaId: emp })) ?? 'C').toUpperCase() === 'R';
    const usarRep = f.custoReposicao ?? custoRepDefault;
    const colCusto = usarRep ? sql`coalesce(v.vrcustorep, 0)` : sql`coalesce(v.vrcusto, 0)`;
    // A config LucroBruto NÃO troca as colunas da grade (MARGEM é sempre markup e RENTABILIDADE sempre markdown,
    // hardcoded em uRelVendasGrid1.dfm:184-195) — ela reescreve só os memos IMPRESSOS SysMemo10/SysMemo15
    // (URelVendas.pas:537-570), um TERCEIRO campo "% Lucro Bruto". Daí `lucro_bruto_perc` separado, e ele usa
    // iif(den>0, ..., 0) — ao contrário das colunas da grade, que dividem por NULLIF e vêm em BRANCO.
    const porCusto = String((await this.config.resolver('RELATORIO_VENDAS_LUCRO_BRUTO', { empresaId: emp })) ?? 'TOTAL CUSTO').toUpperCase() !== 'TOTAL VENDA';

    // ---- NÍVEL ITEM: bruto (IAT), acréscimo (parte +) e desconto (parte −) por linha de venda ----
    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const acresc = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;
    const desc = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    const custoItem = sql`round((coalesce(v.qtde,0) * ${colCusto})::numeric, 2)`;

    // chave do relatório: o PAI (default) ou o FILHO, quando «Exibir produtos filhos» está marcado. No legado a
    // troca é feita no SELECT e no GROUP BY do nível item; aqui basta rotear o join, que é o mesmo efeito —
    // `p` passa a ser a linha do filho e o GROUP BY já é por `p.idproduto`.
    const chaveProduto = f.exibirFilhos ? sql`coalesce(v.idproduto_filho, v.codproduto)` : sql`v.codproduto`;
    let q = db
      .selectFrom('vendas as v')
      .leftJoin('produtos as p', (j) => j.on(sql<boolean>`p.idproduto = ${chaveProduto}`))
      .leftJoin('familias_prod as d', 'd.codfamilia', 'p.coddpto')
      .leftJoin('familias_prod as g', 'g.codfamilia', 'p.codgrupo')
      .leftJoin('familias_prod as sg', 'sg.codfamilia', 'p.codsubgrupo')
      .leftJoin('familias_prod as sc', 'sc.codfamilia', 'p.codsecao')
      .leftJoin('parceiros as forn', 'forn.codparceiro', 'p.codfor')
      .select([
        f.agruparEmpresas ? sql`0` .as('idempresa') : sql`v.idempresa`.as('idempresa'),
        'p.idproduto', 'p.codbarra', sql`p.descricao`.as('descricao'), 'p.unidade',
        sql`d.descricao`.as('departamento'), sql`g.descricao`.as('grupo'),
        sql`sg.descricao`.as('subgrupo'), sql`sc.descricao`.as('secao'),
        sql`round(sum(coalesce(v.qtde,0))::numeric, 3)`.as('qtde'),
        sql`sum(${bruto})`.as('bruto'),
        sql`round(sum(${custoItem})::numeric, 2)`.as('total_custo'),
        sql`round(sum(${acresc})::numeric, 2)`.as('acrescimo'),
        sql`round(sum(${desc})::numeric, 2)`.as('desc_promocao'),
        // decomposição informativa (não entra no líquido — evita dupla contagem, fiel)
        sql`round(sum(coalesce(v.desc_departamento,0))::numeric, 2)`.as('desc_departamento'),
        sql`round(sum(coalesce(v.desc_acre_medio,0) + coalesce(v.desc_acre_item,0))::numeric, 2)`.as('desc_operador'),
      ])
      .where('v.idempresa', 'in', empresas)
      .where(sql<boolean>`${chaveProduto} is not null`);

    // período: SEMPRE predicado de FAIXA na coluna crua (`dtvenda::date` invalidava ix_vendas_empresa_data e
    // varria a tabela inteira — 11,9M linhas na tela mais usada do ERP). Com CkHora é UMA JANELA CONTÍNUA
    // dtini+horaIni → dtfim+horaFim (fiel a :1805-1806, apesar da legenda "diariamente"); sem CkHora o legado
    // IGNORA a hora e pega os dias inteiros (:1809-1810) → [dtini, dtfim+1).
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      q = q.where('v.dtvenda', '>=', sql`${`${f.dtini} ${f.horaIni}`}::timestamptz`)
        .where('v.dtvenda', '<=', sql`${`${f.dtfim} ${f.horaFim}`}::timestamptz`);
    } else {
      q = q.where('v.dtvenda', '>=', sql`${f.dtini}::timestamptz`)
        .where('v.dtvenda', '<', sql`(${f.dtfim}::date + 1)`);
    }
    // cancelados: default NÃO canceladas (fiel ao ItemIndex=0); 'S' só canceladas; 'T' todas.
    const canc = f.canceladas ?? 'N';
    if (canc === 'N') q = q.where(sql`coalesce(v.cancelado,'N')`, '=', 'N');
    else if (canc === 'S') q = q.where(sql`coalesce(v.cancelado,'N')`, '=', 'S');
    // promoção: SEM coalesce — o legado é `V.PROMOCAO = 'S'` / `= 'N'`, e NULL cai fora dos DOIS ramos (fiel).
    if (f.promocao === 'S') q = q.where('v.promocao', '=', 'S');
    if (f.promocao === 'N') q = q.where('v.promocao', '=', 'N');
    // descontos: no legado este filtro vive no WHERE EXTERNO (DivideFiltros só desce PROMOCAO/IDPROMOCAO,
    // uVendas.pas:3907-3921), onde V é a derivada → V.DESC_PROMOCAO é o desconto TOTAL agregado, não a coluna
    // crua. Testar `v.desc_promocao` sozinho perdia a linha cujo único desconto é desc_acre_medio negativo.
    if (f.descontos === 'COM') q = q.where(desc, '>', 0);
    if (f.descontos === 'SEM') q = q.where(desc, '=', 0);
    if (f.produto) q = q.where(sql`upper(p.descricao)`, 'like', `%${f.produto.toUpperCase()}%`);
    if (f.fornecedor) q = q.where(sql`upper(forn.razao)`, 'like', `%${f.fornecedor.toUpperCase()}%`);
    if (f.departamentos?.length) q = q.where('p.coddpto', 'in', f.departamentos.map(Number));
    if (f.grupos?.length) q = q.where('p.codgrupo', 'in', f.grupos.map(Number));
    if (f.subgrupos?.length) q = q.where('p.codsubgrupo', 'in', f.subgrupos.map(Number));
    if (f.secoes?.length) q = q.where('p.codsecao', 'in', f.secoes.map(Number));
    if (f.nrocupom != null && Number(f.nrocupom) > 0) q = q.where('v.nrocupom', '=', Number(f.nrocupom)); // fiel :AsInteger > 0
    // nropedido: o legado usa LIKE só quando o operador digita '%', senão ele digita o próprio operador
    // (URelVendas.pas:953-960). Aqui: com '%' → LIKE do jeito que veio; sem → igualdade EXATA (um `%12%` implícito
    // casaria "0112"/"1234" e inflaria o total sem o operador poder pedir exato).
    if (f.nropedido) {
      q = f.nropedido.includes('%')
        ? q.where('v.nropedido', 'like', f.nropedido)
        : q.where('v.nropedido', '=', f.nropedido);
    }
    if (f.aliquota) q = q.where(sql`v.aliquota`, 'like', `%${f.aliquota}%`);
    if (f.nropdv != null) q = q.where(sql`v.nropedido`, 'like', `${String(f.nropdv).padStart(2, '0')}%`); // fiel: prefixo

    const grupoBase = ['p.idproduto', 'p.codbarra', 'p.descricao', 'p.unidade', 'd.descricao', 'g.descricao', 'sg.descricao', 'sc.descricao'];
    q = f.agruparEmpresas ? q.groupBy(grupoBase) : q.groupBy(['v.idempresa', ...grupoBase]);
    // teto de linhas: o legado NÃO tem limite. Pedimos MAX+1 p/ DETECTAR o corte — devolver 20k linhas e um
    // total somado só sobre elas seria um número silenciosamente errado (a cauda alfabética desaparece).
    const MAX_LINHAS = 20000;
    const brutas = (await q.orderBy(f.agruparEmpresas ? sql`p.descricao` : sql`v.idempresa, p.descricao`).limit(MAX_LINHAS + 1).execute()) as Record<string, unknown>[];
    const truncado = brutas.length > MAX_LINHAS;
    const rows = truncado ? brutas.slice(0, MAX_LINHAS) : brutas;

    // ---- NÍVEL EXIBIDO: líquido/lucro/margem por linha (as razões NÃO podem ser somadas) ----
    const linhas = rows.map((r) => {
      const qt = num(r.qtde);
      const brutoV = r2(num(r.bruto));
      const acrescimoV = r2(num(r.acrescimo));
      const descV = r2(num(r.desc_promocao));
      const custo = r2(num(r.total_custo));
      const liquido = r2(brutoV + acrescimoV - descV);
      const lucro = r2(liquido - custo);
      return {
        ...r,
        total_venda: liquido, // a coluna "VR. VENDA" do legado é o LÍQUIDO
        total_custo: custo,
        lucro,
        // MARGEM (markup) e RENTABILIDADE (markdown) são FIXAS na grade e dividem por NULLIF → null (célula
        // em branco) quando o denominador é 0, NUNCA 0,00. Zerar aqui inventaria "vendido a preço de custo"
        // (margem 0,00%) e "rentabilidade 100,00%" em toda linha sem custo — número errado com cara de certo.
        margem: custo > 0 ? r2((liquido / custo - 1) * 100) : null,
        rentabilidade: liquido !== 0 ? r2(((liquido - custo) / liquido) * 100) : null,
        // "% Lucro Bruto" impresso — este SIM segue a config, e este SIM cai p/ 0 (iif do frx).
        lucro_bruto_perc: porCusto ? (custo > 0 ? r2((liquido / custo - 1) * 100) : 0) : (liquido > 0 ? r2(((liquido - custo) / liquido) * 100) : 0),
        // custo ausente (venda sem snapshot de custo): sinaliza p/ a tela não passar por "margem desconhecida = 0".
        sem_custo: r.total_custo == null || custo === 0,
        // unitários: fiel ao legado — o de VENDA usa o BRUTO (não o líquido), então VR.VENDA ≠ qtde×unit.
        // Divisões protegidas com NULLIF (o legado divide cru e pode estourar com Σqtde=0 — fold não copiado).
        vrvenda_uni: qt !== 0 ? r2(brutoV / qt) : 0,
        vrcusto_uni: qt !== 0 ? r2(custo / qt) : 0,
        // buckets MORTOS no tenant (0 linhas no golden) — 0,00 = cópia-fiel-negativa
        desc_scanntech: 0, desc_acumulativo: 0, desc_func: 0, desc_atarejo: 0,
        desc_gestao_promocao: 0, desc_crescevendas: 0,
      };
    });

    // ---- GRAND TOTAL: somas simples nas medidas e RECÁLCULO nas razões (fiel a uRelVendasGrid1.pas:327-341) ----
    const somar = (k: string) => r2(linhas.reduce((s, l) => s + num((l as any)[k]), 0));
    const totalVenda = somar('total_venda');
    const totalCusto = somar('total_custo');
    const totais = {
      qtde: r2(linhas.reduce((s, l) => s + num((l as any).qtde), 0)),
      total_venda: totalVenda,
      total_custo: totalCusto,
      acrescimo: somar('acrescimo'),
      desc_promocao: somar('desc_promocao'),
      lucro_bruto: r2(totalVenda - totalCusto),
      margem: totalCusto > 0 ? r2((totalVenda / totalCusto - 1) * 100) : null, // markup — footer[4]
      rentabilidade: totalVenda !== 0 ? r2(((totalVenda - totalCusto) / totalVenda) * 100) : null, // markdown — footer[3]
      lucro_bruto_perc: porCusto ? (totalCusto > 0 ? r2((totalVenda / totalCusto - 1) * 100) : 0) : (totalVenda > 0 ? r2(((totalVenda - totalCusto) / totalVenda) * 100) : 0),
      linhas: linhas.length,
      sem_custo: linhas.filter((l) => (l as any).sem_custo).length,
    };
    return {
      linhas, totais,
      // truncado: o total acima cobre SÓ as linhas devolvidas — a tela tem de avisar em vez de exibir um total menor.
      filtro: { ...f, empresas, custo: usarRep ? 'REPOSICAO' : 'CUSTO', margem_por: porCusto ? 'TOTAL CUSTO' : 'TOTAL VENDA', truncado, max_linhas: MAX_LINHAS },
    };
  }
}
