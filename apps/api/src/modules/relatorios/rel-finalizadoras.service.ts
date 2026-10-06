import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, textoVariavel } from '../../shared/relatorios/registro-fr3';

/**
 * O `CorrigePalavra` do legado (FuncoesApollo, ausente do repositório), pelo que o dado prova: o fechamento de caixa grava
 * `' em ' + CorrigePalavra(AnsiLowerCase(OPERACAO))` no histórico da MOV_CONTAS_BANCARIAS e a produção (2026) tem "convênio", "devolução",
 * e "cartoes", "pos", "pix", "pix pos", "dinheiro" sem mudança — a função devolve o acento das palavras que conhece, mantendo a caixa.
 */
const ACENTOS: Record<string, string> = { convenio: 'convênio', devolucao: 'devolução' };
export function corrigePalavra(s: string): string {
  return s.replace(/[A-Za-zÀ-ÿ]+/g, (w) => {
    const a = ACENTOS[w.toLowerCase()];
    if (!a) return w;
    if (w === w.toUpperCase()) return a.toUpperCase();
    if (w[0] === w[0].toUpperCase()) return a[0].toUpperCase() + a.slice(1);
    return a;
  });
}

/** o título da coluna do `Corrigegrid` (uComunPesquisaRel.pas:131), que na grade sem colunas fixas vira o DisplayLabel do campo */
const tituloGrade = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1).replace(/[A-Z]/g, (c) => c.toLowerCase())).replace(/_/g, ' ');
const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const frNum = (v: number) => String(Math.round(v * 1e6) / 1e6).replace('.', ',');

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroRelFinalizadoras {
  dtini: string;
  dtfim: string;
  empresas?: number[];
}

/**
 * VENDAS E FINALIZADORAS (FRMRELFINALIZADORAS) — 3º relatório migrado. 7.897 acessos / 9 operadores.
 * Procedência: `UrelFinalizadoras.pas` `btnConsultaClick` :246-380 (o bloco :98-231 é a versão ANTIGA, toda
 * comentada — a viva é a de baixo) · `GetForma` :1020 · a lista de modalidades vem de `sqqPgto` no .dfm:
 * `SELECT MODALIDADE, DESTINO FROM FORMAS_PGTO WHERE IDEMPRESA IN (...) GROUP BY ... ORDER BY ...`.
 *
 * FORMA: uma linha por DIA; as colunas são 4 medidas de VENDAS + **uma por modalidade de pagamento**. O legado
 * monta isso como um UNION de `(DATA, VALOR, TIPO)` e pivota no cliente criando um TFloatField por modalidade;
 * aqui a query devolve o mesmo tuplo e o pivot é feito no serviço (a tela recebe pronto).
 *
 * MEDIDAS DE VENDAS (as 4 primeiras) — a de TOTAL_VENDA é **a mesma fórmula do líquido da rel-vendas**, já
 * certificada lá: `IAT='A' ? round(qtde×vrvenda,2) : trunc(…)/100`, menos a parte NEGATIVA de
 * desc_acre_medio/_item somada aos descontos, mais a parte POSITIVA. Reaproveitada verbatim.
 *   · TOTAL_VENDA   = líquido do dia, `cancelado='N'`
 *   · DESCONTO      = desc_promocao + desc_departamento + |parte negativa| dos 2 desc_acre
 *   · ACRESCIMO     = parte POSITIVA dos 2 desc_acre
 *   · CANCELAMENTO  = a MESMA fórmula do líquido, mas `cancelado='S'` (é o que se perdeu no dia)
 * ⚠️ O legado agrupa o interno por (dia, nrocupom, codvendas) e soma por fora. Como a expressão arredonda a
 * coluna CRUA e `codvendas` é a PK, o interno é 1:1 com a linha — logo somar por dia direto dá o mesmo centavo
 * (é o mesmo argumento provado na auditoria da rel-vendas).
 *
 * FINALIZADORAS: por modalidade, `SUM(cx_vendas.valor - COALESCE(troco,0))` no dia, casando
 * `cx_vendas.operacao = formas_pgto.modalidade`. O troco entra subtraindo — é dinheiro que voltou ao cliente.
 *
 * O QUE NÃO VEIO (morto no golden, cópia-fiel-negativa): a perna de CHEQUE (12 linhas na tabela, última de
 * 2024-10-15) e o `NOT EXISTS(... AGRUPARECEBER ...)` (0 linhas). ADIADO: impressão/frx e o drill-down por
 * cupom (`dbgDadosKeyDown`).
 */
@Injectable()
export class RelFinalizadorasService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroRelFinalizadoras): Promise<{
    modalidades: { modalidade: string; destino: string | null; campo: string }[];
    linhas: Record<string, unknown>[];
    totais: Record<string, number>;
    participacao: Record<string, number | null>;
    filtro: Record<string, unknown>;
  }> {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const db = this.dbp.forTenantRead() as AnyDB;
    // as lojas marcadas, recortadas às do operador (o GetMultiEmpresa) — antes valia só a do login
    const empresas = await empresasDoOperador(db, f.empresas?.map(Number));

    // FUSO — `dtvenda` e `cx_vendas.data` são timestamptz, então o balde do dia E os limites têm de ser
    // resolvidos no fuso do NEGÓCIO. Sem isto, com a sessão do PG em UTC, 4,02% das 11,9M vendas e R$4,29M das
    // finalizadoras (21:00+) caem no dia seguinte — e como os dois lados escorregam valores DIFERENTES (a sangria
    // de fechamento fica no bloco da noite), o resíduo não se cancela e a conferência do dia enche de ruído.
    // Mesmo fold [ALTA] já aplicado na Prévia do Fornecedor.
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    // faixa [dtini, dtfim+1) na coluna CRUA — `::date` invalidaria o índice (lição da rel-vendas) e cx_vendas
    // tem 1,5M linhas no golden.
    const fimExcl = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fimExcl.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fimExcl.setUTCDate(fimExcl.getUTCDate() + 1);
    const ate = fimExcl.toISOString().slice(0, 10);

    // ---- as MODALIDADES (as colunas do relatório) — fiel ao sqqPgto: agrupadas por (modalidade, destino) ----
    const modalidades = (await db
      .selectFrom('formas_pgto')
      .select(['modalidade', 'destino'])
      .where('idempresa', 'in', empresas)
      .groupBy(['modalidade', 'destino'])
      .orderBy('modalidade')
      .orderBy('destino')
      .execute()) as { modalidade: string; destino: string | null }[];
    // GetForma :1020 — espaço e hífen viram '_' (era o nome do campo no dataset; aqui é a chave da coluna)
    const campoDe = (m: string) => String(m).replace(/[ -]/g, '_');
    // dedup por `campo`: 'PIX POS' e 'PIX-POS' podem coexistir (a UNIQUE é sobre upper(modalidade)) e as duas
    // colapsariam no mesmo nome — duas colunas iguais na tela e dois meios de pagamento somados em silêncio.
    // Não ocorre em nenhuma empresa do golden; é rede.
    const vistos = new Set<string>();
    const cols = modalidades
      .map((m) => ({ ...m, campo: campoDe(m.modalidade) }))
      .filter((c) => (vistos.has(c.campo) ? false : (vistos.add(c.campo), true)));

    // ---- as 4 medidas de VENDAS, por dia ----
    const bruto = sql`case when coalesce(v.iat,'') = 'A'
      then round((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric, 2)
      else trunc((coalesce(v.qtde,0) * coalesce(v.vrvenda,0))::numeric * 100) / 100 end`;
    const desconto = sql`coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
      + abs(least(coalesce(v.desc_acre_medio,0),0)) + abs(least(coalesce(v.desc_acre_item,0),0))`;
    const acrescimo = sql`greatest(coalesce(v.desc_acre_medio,0),0) + greatest(coalesce(v.desc_acre_item,0),0)`;

    // o dia (com fuso) vai numa DERIVADA e o GROUP BY agrupa pela COLUNA: repetir a expressão no select e no
    // group by falha, porque o PG casa as duas estruturalmente e os placeholders do parâmetro `tz` não batem —
    // ele passa a exigir `v.dtvenda` no GROUP BY. Mesma correção da Prévia do Fornecedor.
    const vendasDia = db
      .selectFrom('vendas as v')
      .select([
        sql`to_char(v.dtvenda at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
        sql`coalesce(v.cancelado,'N')`.as('cancelado'),
        bruto.as('bruto'), desconto.as('desconto'), acrescimo.as('acrescimo'),
      ])
      .where('v.idempresa', 'in', empresas)
      .where('v.dtvenda', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
      .where('v.dtvenda', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    const medidas = (await db
      .selectFrom(vendasDia.as('d'))
      .select([
        'd.dia', 'd.cancelado',
        sql`sum(d.bruto)`.as('bruto'),
        sql`sum(d.desconto)`.as('desconto'),
        sql`sum(d.acrescimo)`.as('acrescimo'),
      ])
      .groupBy(['d.dia', 'd.cancelado'])
      .execute()) as Record<string, unknown>[];

    // ---- as FINALIZADORAS, por dia × operação ----
    const cxDia = db
      .selectFrom('cx_vendas as c')
      .select([
        sql`to_char(c.data at time zone ${tz}, 'YYYY-MM-DD')`.as('dia'),
        sql`c.operacao`.as('operacao'),
        // fiel: VALOR menos o TROCO (dinheiro que voltou ao cliente)
        sql`coalesce(c.valor,0) - coalesce(c.troco,0)`.as('valor'),
      ])
      // `AND V.VALOR > 0` — o legado tem isto em TODA perna de modalidade (:371) e eu havia perdido. Sem ele uma
      // linha com valor 0 e troco 347,52 SUBTRAÍA o troco da coluna de dinheiro: no golden 30/10/2023 o DINHEIRO
      // saía 5.765,31 em vez de 6.112,83 — R$347,52 de furo de caixa INVENTADO, a mesma ordem de um furo real.
      .where(sql`coalesce(c.valor,0)`, '>', 0)
      .where('c.idempresa', 'in', empresas)
      .where('c.data', '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
      .where('c.data', '<', sql`(${ate}::timestamp at time zone ${tz})`);
    const fins = (await db
      .selectFrom(cxDia.as('x'))
      .select(['x.dia', 'x.operacao', sql`sum(x.valor)`.as('valor')])
      .groupBy(['x.dia', 'x.operacao'])
      .execute()) as Record<string, unknown>[];

    // ---- PIVOT: 1 linha por dia (o legado faz isso no cliente, criando um campo por modalidade) ----
    const porDia = new Map<string, Record<string, number>>();
    const linha = (dia: string) => {
      if (!porDia.has(dia)) {
        const base: Record<string, number> = { total_venda: 0, desconto: 0, acrescimo: 0, cancelamento: 0, total_finalizadoras: 0 };
        // prefixo `fin_`: sem ele uma forma de pagamento chamada 'DESCONTO' ou 'TOTAL_VENDA' (nada impede — a
        // unicidade é só sobre upper(modalidade)) sobrescreveria a MEDIDA de mesmo nome na linha.
        for (const c of cols) base[`fin_${c.campo}`] = 0;
        porDia.set(dia, base);
      }
      return porDia.get(dia)!;
    };
    for (const m of medidas) {
      const l = linha(String(m.dia));
      const liquido = r2(num(m.bruto) + num(m.acrescimo) - num(m.desconto));
      if (String(m.cancelado).toUpperCase() === 'S') {
        l.cancelamento = r2(l.cancelamento + liquido);   // cancelado: só a medida própria (fiel)
      } else {
        l.total_venda = r2(l.total_venda + liquido);
        l.desconto = r2(l.desconto + num(m.desconto));
        l.acrescimo = r2(l.acrescimo + num(m.acrescimo));
      }
    }
    const campoPorOperacao = new Map(cols.map((c) => [String(c.modalidade).toUpperCase(), c.campo]));
    // operação do PDV que não existe em formas_pgto: some do pivot do legado (ele só cria coluna do que está no
    // cadastro). Somamos num balde à parte para o número não desaparecer sem aviso.
    let semCadastro = 0;
    for (const x of fins) {
      const l = linha(String(x.dia));
      const campo = campoPorOperacao.get(String(x.operacao ?? '').toUpperCase());
      const v = r2(num(x.valor));
      if (campo) {
        l[`fin_${campo}`] = r2(l[`fin_${campo}`] + v);
        // o total soma SÓ pagamento cadastrado — CX_VENDAS carrega muito mais que pagamento: SANGRIA (32.232
        // linhas / R$13,98M no golden, presente em 362 dos 362 dias), SUPRIMENTO, DESCONTO, ACRESCIMO... Somar
        // tudo fazia a conferência do dia acusar R$11.063 de média (o resíduo real é R$41) e o total exibido não
        // fechava com a soma das próprias colunas. Fold [ALTA] da auditoria.
        l.total_finalizadoras = r2(l.total_finalizadoras + v);
      } else {
        semCadastro = r2(semCadastro + v);
      }
    }

    const linhas = [...porDia.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dia, v]) => ({
        dia,
        ...v,
        // conferência do dia: pagamento cadastrado menos venda líquida. É ACRÉSCIMO MEU (o legado só exibe as
        // colunas) e é INFORMATIVA: mesmo com o total correto sobra um resíduo legítimo de R$16 a R$112/dia em 25
        // de 30 dias medidos (arredondamento e movimento de borda). Por isso não há alarme por "≠ 0" — inventar
        // limiar sem base no legado mandaria o operador caçar furo que não existe.
        diferenca: r2(num(v.total_finalizadoras) - num(v.total_venda)),
      }));

    const somar = (k: string) => r2(linhas.reduce((s, l) => s + num((l as any)[k]), 0));
    const totais: Record<string, number> = {
      dias: linhas.length,
      total_venda: somar('total_venda'),
      desconto: somar('desconto'),
      acrescimo: somar('acrescimo'),
      cancelamento: somar('cancelamento'),
      total_finalizadoras: somar('total_finalizadoras'),
      diferenca: somar('diferenca'),
      sem_cadastro: semCadastro,
    };
    for (const c of cols) totais[`fin_${c.campo}`] = somar(`fin_${c.campo}`);
    // PARTICIPAÇÃO % — a última linha da grade do legado (:548-566): cada modalidade sobre o TOTAL_VENDA, com a
    // divisão guardada por `TotalVenda <> 0`. Estava faltando (fold da auditoria).
    const participacao: Record<string, number | null> = {};
    for (const c of cols) {
      participacao[`fin_${c.campo}`] = totais.total_venda > 0
        ? r2((num(totais[`fin_${c.campo}`]) / totais.total_venda) * 100)
        : null;
    }

    return { modalidades: cols, linhas, totais, participacao, filtro: { ...f, empresas, de: f.dtini, ate: f.dtfim, fuso: tz } };
  }

  /**
   * O "Imprimir" (`btnImprimirClick`, UrelFinalizadoras.pas:587): o `cdsTemp` da consulta — uma linha por dia com movimento, a linha dos
   * totais e a da participação (as duas sem DATA) — em um dos dois layouts do `RgpOrientacaoFP`:
   *  · HORIZONTAL (`Rel_Finalizadoras.fr3`): o legado CRIA um memo por forma de pagamento no PageHeader1 (o título, a MODALIDADE) e no
   *    MasterData1 (`[formatFloat(',0.00',<FrxFinalizadoras."FORMA">)]`), a partir de Left 398, de 90 em 90, largura = tamanho da
   *    MODALIDADE (30) × 3, Courier New 8, alinhado à direita — feito aqui no XML do layout, como o relatorio-geral-fr3 do construtor;
   *  · VERTICAL (`Rel_Finalizadoras_Vertical.fr3`): cada campo do dia vira uma linha (DATA, FORMA_PGTO, VALOR) e a linha dos totais vai
   *    no FrxDBTotais; o nome é o `CorrigePalavra(DisplayLabel)` — e o DisplayLabel é o título que o `Corrigegrid` deu à coluna ("Total
   *    venda", "Descontos", "Acréscimos", "Cancelamentos", "Pix pos"…), que o script do layout reconhece para tirar as quatro medidas da
   *    lista; V_TOTAL_VENDA = o total de venda (o "% do total" da segunda página).
   * PERIODO "Periodo: dd/mm/aaaa até dd/mm/aaaa". O botão só existe depois de uma consulta com dados (sem dados: a mensagem do legado).
   */
  async impressao(f: FiltroRelFinalizadoras, vertical: boolean) {
    const r = await this.consultar(f);
    if (!r.linhas.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não foram encontrados registros para imprimir o relatório.');
    const db = this.dbp.forTenantRead() as AnyDB;
    const cols = r.modalidades;
    // o cdsTemp: DATA, TOTAL_VENDA, DESCONTO, ACRESCIMO, CANCELAMENTO e um campo por forma (GetForma)
    const linhaTemp = (l: Record<string, unknown>) => ({
      DATA: `${String(l.dia)}T00:00:00`, TOTAL_VENDA: num(l.total_venda), DESCONTO: num(l.desconto), ACRESCIMO: num(l.acrescimo), CANCELAMENTO: num(l.cancelamento),
      ...Object.fromEntries(cols.map((c) => [c.campo, num(l[`fin_${c.campo}`])])),
    });
    const dias = r.linhas.map(linhaTemp);
    const totais: Record<string, unknown> = {
      DATA: null, TOTAL_VENDA: r.totais.total_venda, DESCONTO: r.totais.desconto, ACRESCIMO: r.totais.acrescimo, CANCELAMENTO: r.totais.cancelamento,
      ...Object.fromEntries(cols.map((c) => [c.campo, num(r.totais[`fin_${c.campo}`])])),
    };
    // a participação: só as formas; `TotalVenda <> 0` senão 0 (:552-566)
    const participacao: Record<string, unknown> = {
      DATA: null, TOTAL_VENDA: null, DESCONTO: null, ACRESCIMO: null, CANCELAMENTO: null,
      ...Object.fromEntries(cols.map((c) => [c.campo, r.totais.total_venda !== 0 ? (num(r.totais[`fin_${c.campo}`]) / r.totais.total_venda) * 100 : 0])),
    };
    const empresa = await empresaParaRelatorio(db, this.emp());
    const dmy = (d: string) => d.split('-').reverse().join('/');
    const variaveis: Record<string, string> = { PERIODO: textoVariavel(`Periodo: ${dmy(f.dtini)} até ${dmy(f.dtfim)}`), V_TOTAL_VENDA: '0' };

    if (!vertical) {
      let modelo = await modeloFr3(db, 'Rel_Finalizadoras.fr3');
      const altura = (banda: string) => {
        const m = new RegExp(`<${banda === 'PageHeader1' ? 'TfrxPageHeader' : 'TfrxMasterData'}[^>]*Name="${banda}"[^>]*>`).exec(modelo);
        const h = m ? /\bHeight="([^"]+)"/.exec(m[0]) : null;
        return h ? Number(h[1].replace(',', '.')) : 0;
      };
      const hCab = altura('PageHeader1'), hDados = altura('MasterData1');
      const memo = (nome: string, left: number, top: number, h: number, texto: string) =>
        `<TfrxMemoView Name="${nome}" Left="${frNum(left)}" Top="${frNum(top)}" Width="90" Height="${frNum(h)}" ShowHint="False" Font.Charset="1" Font.Color="0" Font.Height="-11" Font.Name="Courier New" Font.Style="0" HAlign="haRight" ParentFont="False" WordWrap="False" Text="${xmlAttr(texto)}"/>`;
      let cab = '', dados = '';
      cols.forEach((c, k) => {
        const left = 398 + 90 * k;
        cab += memo(`MemoTituloP${k + 1}`, left, hCab - 23, hCab, c.modalidade);
        dados += memo(`MemoCampo${k + 1}`, left, hDados - 19, hDados, `[formatFloat(',0.00',<FrxFinalizadoras."${c.campo}">)]`);
      });
      const inserir = (xml: string, tag: string, nome: string, filhos: string) => {
        const re = new RegExp(`(<${tag}[^>]*Name="${nome}"[^>]*?)(/?)>`);
        const m = re.exec(xml);
        if (!m) return xml;
        if (m[2] === '/') return xml.replace(m[0], `${m[1]}>${filhos}</${tag}>`);
        const fim = xml.indexOf(`</${tag}>`, m.index);
        return fim < 0 ? xml : xml.slice(0, fim) + filhos + xml.slice(fim);
      };
      modelo = inserir(modelo, 'TfrxPageHeader', 'PageHeader1', cab);
      modelo = inserir(modelo, 'TfrxMasterData', 'MasterData1', dados);
      return { titulo: 'Finalizadoras', modelo, datasets: { FrxFinalizadoras: [...dias, totais, participacao], FrxEmpresas: [empresa] }, variaveis };
    }

    // VERTICAL: os campos na ordem do cdsTemp, com o rótulo do Corrigegrid passado pelo CorrigePalavra
    const campos: Array<[string, string]> = [['TOTAL_VENDA', 'TOTAL_VENDA'], ['DESCONTO', 'Descontos'], ['ACRESCIMO', 'Acréscimos'], ['CANCELAMENTO', 'Cancelamentos'],
      ...cols.map((c) => [c.campo, c.campo] as [string, string])];
    const rotulo = (label: string) => corrigePalavra(tituloGrade(label));
    const linhasVert = dias.flatMap((d) => campos.map(([campo, label]) => ({ DATA: d.DATA, FORMA_PGTO: rotulo(label), VALOR: num((d as Record<string, unknown>)[campo]) })));
    const linhasTot = campos.map(([campo, label]) => ({ FORMA_PGTO: rotulo(label), VALOR: num(totais[campo]) }));
    variaveis.V_TOTAL_VENDA = String(r.totais.total_venda);
    return {
      titulo: 'Finalizadoras', modelo: await modeloFr3(db, 'Rel_Finalizadoras_Vertical.fr3'),
      datasets: { FrxFinalizadoras: linhasVert, FrxDBTotais: linhasTot, FrxEmpresas: [empresa] }, variaveis,
    };
  }
}
