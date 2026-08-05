import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroCaixaDre {
  dtini: string; dtfim: string; empresas?: number[];
}

export interface Conta {
  desccodplc: string; descricao: string; pai: string | null; descricao_pai: string | null;
  pai_principal: string; valor: number;
}

/**
 * CAIXA D.R.E. (FRMRELATORIOCAIXA) — etapa 2 de 2: o relatório. 495 acessos / 6 operadores.
 * Uma DRE de CAIXA (regime de caixa, não de competência) sobre o plano de contas GERENCIAL (`plc`), com a
 * hierarquia `desccodplc` ('1.' → '1.01.' → '1.01.001') e o PAI PRINCIPAL = `substr(desccodplc,1,1) || '.'`.
 * Procedência: `uDmRelatorioCaixa.dfm` — `aqqCaixaAnualRec` (receitas) · `aqqCaixaAnualDesp` (despesas, 2 pernas)
 * · `aqqCaixaAnualAVista` (vendas à vista) · `sqqCusto` (custo da mercadoria vendida).
 *
 * RECEITAS — o que ENTROU no período:
 *  · recebimentos de título (`areceber_bx` ⋈ `areceber`), separados como o legado: título SEM conta gerencial
 *    (`codplc IS NULL`) cai num bucket fixo "1.01. CONTAS RECEBIDAS"; COM conta, agrupa por conta;
 *  · cartões liberados no período (`cartao.dtbaixa`), bucket "1.03. CARTOES RECEBIDOS";
 *  · cheques (`GET_CHEQUEBX` no legado) = **cópia-fiel-negativa**: a tabela CHEQUE tem 12 linhas no golden
 *    (última de 2024-10-15) e não foi migrada — a perna existiria e somaria zero.
 *
 * DESPESAS — o que SAIU, com o RATEIO por centro de custo, que é o coração do relatório:
 *  cada baixa de título (`apagar_bx`) é apropriada em cada centro de custo (`cx_apagar.codcc` → conta gerencial)
 *  na proporção de `cx_apagar.valor` sobre a BASE do título, e **líquida de juros e de acréscimo/desconto** — as
 *  três parcelas usam o MESMO divisor:
 *      ABS( (valorpg × p) − (juros × p) − (acre_desc × p) ),  onde p = (cx_apagar.valor × 100 / BASE) / 100
 *  BASE = total da NF quando o título tem NF (`idnf > 0`, com `totalnf = 0` → 1 para não dividir por zero);
 *         senão a soma `valor + vendor` dos títulos do mesmo grupo.
 *  Filtros fiéis: `coalesce(indr,'I') = 'I'` (não estornada), `dtpgto` no período, conta gerencial não nula.
 *
 *  A 2ª PERNA das despesas lê o LIVRO-CAIXA por PADRÃO DE TEXTO no `obs` — 6 padrões, copiados **literalmente**,
 *  com os dois erros de digitação do legado ('REFERENTA' e 'FDIANTAMENTO'). No golden ela casa **ZERO linhas**
 *  (as 35 que se parecem são lançamentos manuais tipo 'REF. VALE TRANSPORTE'), então é cópia-fiel-negativa —
 *  implementada porque, se algum dia o gerador escrever esse texto, a DRE tem de contar.
 *
 * VENDAS À VISTA: o legado varre `contacorrente` (PDV × forma de pagamento → conta) onde
 * `formas_pgto.destino = 'CXA'` e soma o livro-caixa por aquela conta. Reproduzido com um IN das contas.
 *
 * DIVERGÊNCIA DELIBERADA: na 2ª perna das despesas o legado tem **`I.IDEMPRESA IN (1)` fixo no código** (a 1ª
 * perna usa o placeholder de empresa). Copiar isso faria a empresa 2 nunca ver essas despesas. Usamos a empresa
 * do escopo — é bug evidente, não regra.
 *
 * CORTE-3 (fecha a tela): `aqqCredito` — crédito de ICMS das entradas, só quando o CFOP não é de cupom e a
 * alíquota começa com 'T' — e `sqqResultado` — resultado por conta com rateio DIFERENTE (divisor = valor do
 * próprio título, sem descontar juros/acre_desc), por isso em campo separado. ADIADO: impressão frx.
 */
@Injectable()
export class RelCaixaDreService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroCaixaDre): Promise<{
    receitas: Conta[]; despesas: Conta[]; resultado_contas: Conta[];
    totais: Record<string, number>; filtro: Record<string, unknown>;
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

    // hierarquia da conta gerencial — o legado resolve PAI e PAI_PRINCIPAL por subselect em PLC
    const hier = sql`
      (select pl.desccodplc from plc pl where pl.codplc = p.codpai) as pai,
      (select pl.descricao  from plc pl where pl.codplc = p.codpai) as descricao_pai,
      substr(p.desccodplc, 1, 1) || '.' as pai_principal`;

    // ---- RECEITAS ----
    const recPorConta = (await db.executeQuery(sql<Conta & { valor: string }>`
      select p.desccodplc, p.descricao, ${hier},
             round(coalesce(sum(b.valorpg), 0)::numeric, 2) as valor
        from areceber_bx b
        join areceber r on r.codrcb = b.codrcb
        join plc p      on p.codplc = r.codplc
       where coalesce(b.indr,'I') = 'I'
         and b.dtpgto >= ${de} and b.dtpgto < ${ateTs}
         and r.codempresa in (${sql.join(empresas)})
       group by p.desccodplc, p.descricao, p.codpai
       order by 1
    `.compile(db)));

    const recSemConta = (await db.executeQuery(sql<{ valor: string }>`
      select round(coalesce(sum(b.valorpg), 0)::numeric, 2) as valor
        from areceber_bx b
        join areceber r on r.codrcb = b.codrcb
       where coalesce(b.indr,'I') = 'I'
         and b.dtpgto >= ${de} and b.dtpgto < ${ateTs}
         and r.codempresa in (${sql.join(empresas)})
         and r.codplc is null
    `.compile(db)));

    const cartoes = (await db.executeQuery(sql<{ valor: string }>`
      select round(coalesce(sum(c.valor), 0)::numeric, 2) as valor
        from cartao c
       where upper(coalesce(c.liberado,'N')) = 'S'
         and c.dtbaixa >= ${de} and c.dtbaixa < ${ateTs}
         and c.idempresa in (${sql.join(empresas)})
    `.compile(db)));

    // ---- VENDAS À VISTA: contas roteadas p/ o caixa (destino 'CXA') ----
    const aVista = (await db.executeQuery(sql<Conta & { valor: string }>`
      select p.desccodplc, p.descricao, ${hier},
             round(coalesce(sum(abs(i.valor)), 0)::numeric, 2) as valor
        from caixa i
        join plc p on p.codplc = i.codplc
       where i.codplc in (
               select cc.codplc from contacorrente cc
                 join formas_pgto fp on fp.idpgto = cc.idpgto
                where upper(trim(coalesce(fp.destino,''))) = 'CXA'
             )
         and i.data >= ${de} and i.data < ${ateTs}
         and i.idempresa in (${sql.join(empresas)})
       group by p.desccodplc, p.descricao, p.codpai
       order by 1
    `.compile(db)));

    // ---- DESPESAS, perna 1: rateio por centro de custo ----
    // p = (cx_apagar.valor × 100 / BASE) / 100 — as 3 parcelas (pago, juros, acre_desc) usam o MESMO divisor.
    const base = sql`
      case when coalesce(g.idnf,0) > 0
             then (select case when coalesce(n.totalnf,0) = 0 then 1 else n.totalnf end from nf n where n.codnf = g.idnf)
             else (select nullif(sum(coalesce(w.valor,0)) + sum(coalesce(w.vendor,0)), 0)
                     from apagar w where w.codgrupo_agrupamento_apg = g.codgrupo_agrupamento_apg)
        end`;
    const despRateio = (await db.executeQuery(sql<Conta & { valor: string }>`
      select p.desccodplc, p.descricao, ${hier},
             round(sum(abs(
                 (coalesce(b.valorpg,0)    * ((c.valor * 100) / ${base})) / 100
               - (coalesce(b.juros,0)      * ((c.valor * 100) / ${base})) / 100
               - (coalesce(b.acre_desc,0)  * ((c.valor * 100) / ${base})) / 100
             ))::numeric, 2) as valor
        from apagar_bx b
        join apagar g    on g.codapg = b.codapg
        join cx_apagar c on c.codapg = g.codapg
        join plc p       on p.codplc = c.codcc
       where coalesce(b.indr,'I') = 'I'
         and b.dtpgto >= ${de} and b.dtpgto < ${ateTs}
         and p.desccodplc is not null
         and g.codempresa in (${sql.join(empresas)})
       group by p.desccodplc, p.descricao, p.codpai
       order by 1
    `.compile(db)));

    // ---- DESPESAS, perna 2: livro-caixa por PADRÃO DE TEXTO no obs (os 6 do legado, com os typos dele) ----
    const despCaixa = (await db.executeQuery(sql<Conta & { valor: string }>`
      select p.desccodplc, p.descricao, ${hier},
             round(coalesce(sum(abs(i.valor)), 0)::numeric, 2) as valor
        from caixa i
        join plc p on p.codplc = i.codplc
       where (   i.obs like 'REFERENTA A BAIXA A PAGAR DO LOTE%'
              or i.obs like 'REFERENTA A BAIXA DE CARTAO DO LOTE%'
              or i.obs like 'REF. JUROS PGTO LOTE%'
              or i.obs like 'REF. A BX CARTAO LOTE%'
              or i.obs like 'REFERENTE A PRODUCAO%'
              or i.obs like 'ORIGINADO DO LANCAMENTO DO FDIANTAMENTO DE PARCEIRO COM MESMO CNPJ.%')
         and i.data >= ${de} and i.data < ${ateTs}
         and p.desccodplc is not null
         and i.idempresa in (${sql.join(empresas)})
       group by p.desccodplc, p.descricao, p.codpai
       order by 1
    `.compile(db)));

    // ---- CUSTO da mercadoria vendida (sqqCusto) ----
    const custo = (await db.executeQuery(sql<{ totalcusto: string }>`
      select round(coalesce(sum((coalesce(v.qtde,0) * coalesce(v.vrcusto,0))::numeric), 2)::numeric, 2) as totalcusto
        from vendas v
       where coalesce(v.cancelado,'N') = 'N'
         and v.dtvenda >= ${de} and v.dtvenda < ${ateTs}
         and v.idempresa in (${sql.join(empresas)})
    `.compile(db)));

    // ---- CRÉDITO DE ICMS das entradas (aqqCredito) ----
    // Fiel: só credita quando o CFOP **não** é de processamento de cupom (`proc_cupom <> 'S'`; NULL credita,
    // porque o CASE do legado compara com 'S' e NULL cai no ELSE) E a alíquota começa com 'T' (tributada).
    // O legado agrupa por um punhado de colunas e soma por fora — como `proc_cupom` e a 1ª letra da alíquota
    // estão no GROUP BY, cada grupo é homogêneo neles e a soma dos grupos ≡ soma direta das linhas.
    // ⚠️ O legado tem `N.IDEMPRESA = 1` FIXO aqui também — usamos a empresa do escopo (mesmo motivo da 2ª perna
    // das despesas: é bug, não regra).
    const creditoIcms = (await db.executeQuery(sql<{ valor: string }>`
      select round(coalesce(sum(np.vricm), 0)::numeric, 2) as valor
        from nf_prod np
        join nf n on n.codnf = np.codnf
        left join cfop c on c.codcfop = np.cfop
       where n.dtcontabil >= ${f.dtini}::date and n.dtcontabil <= ${f.dtfim}::date
         and coalesce(n.proc,'N') = 'S' and coalesce(n.cancelada,'N') = 'N'
         and upper(coalesce(n.tipo,'')) = 'E'
         and n.nronf is not null and n.nronf <> '0'
         and n.idempresa in (${sql.join(empresas)})
         and coalesce(c.proc_cupom,'') <> 'S'
         and substr(coalesce(np.aliquota,''), 1, 1) = 'T'
    `.compile(db)));

    // ---- RESULTADO por conta (sqqResultado) ----
    // Rateio DIFERENTE do das despesas, e a diferença importa: o divisor aqui é o **valor do próprio título**
    // (`apagar.valor`), não o total da NF nem a soma do grupo, e **não** desconta juros nem acréscimo/desconto.
    // Por isso vive em campo próprio e não substitui `despesas`.
    // A 2ª perna casa 2 padrões (minúsculos, mesmo typo 'Referenta') sobre `caixa.dtvenc` — no legado o OR/AND
    // está sem parênteses, então o 1º padrão ESCAPA do filtro de data e somaria a série histórica inteira. Aqui
    // o período vale para os dois: é acidente de precedência, não regra (e ambos casam ZERO no golden).
    const resultadoRateio = (await db.executeQuery(sql<Conta & { valor: string }>`
      select p.desccodplc, p.descricao, ${hier},
             round(sum((coalesce(b.valorpg,0) * ((c.valor * 100) / nullif(g.valor, 0))) / 100)::numeric, 2) as valor
        from apagar_bx b
        join apagar g    on g.codapg = b.codapg
        join cx_apagar c on c.codapg = b.codapg
        join plc p       on p.codplc = c.codcc
       where coalesce(b.indr,'I') = 'I'
         and b.dtpgto >= ${de} and b.dtpgto < ${ateTs}
         and p.desccodplc is not null
         and g.codempresa in (${sql.join(empresas)})
       group by p.desccodplc, p.descricao, p.codpai
       order by 1
    `.compile(db)));

    const resultadoCaixa = (await db.executeQuery(sql<Conta & { valor: string }>`
      select p.desccodplc, p.descricao, ${hier},
             round(coalesce(sum(abs(i.valor)), 0)::numeric, 2) as valor
        from caixa i
        join plc p on p.codplc = i.codplc
       where (i.obs like 'Referenta a baixa a pagar do lote%' or i.obs like 'Referenta a baixa de cartao do lote%')
         and i.dtvenc >= ${f.dtini}::date and i.dtvenc <= ${f.dtfim}::date
         and p.desccodplc is not null
         and i.idempresa in (${sql.join(empresas)})
       group by p.desccodplc, p.descricao, p.codpai
       order by 1
    `.compile(db)));

    // ---- consolidação: soma por conta, mantendo a hierarquia ----
    const juntar = (grupos: Conta[][]): Conta[] => {
      const m = new Map<string, Conta>();
      for (const g of grupos) {
        for (const l of g) {
          const k = String(l.desccodplc);
          const at = m.get(k);
          if (at) at.valor = r2(at.valor + num(l.valor));
          else m.set(k, { ...l, valor: r2(num(l.valor)) });
        }
      }
      return [...m.values()].sort((a, b) => (a.desccodplc < b.desccodplc ? -1 : 1));
    };

    const receitas = juntar([recPorConta.rows as Conta[], aVista.rows as Conta[]]);
    const resultado_contas = juntar([resultadoRateio.rows as Conta[], resultadoCaixa.rows as Conta[]]);
    const despesas = juntar([despRateio.rows as Conta[], despCaixa.rows as Conta[]]);
    const semConta = r2(num(recSemConta.rows[0]?.valor));
    const totalCartoes = r2(num(cartoes.rows[0]?.valor));

    const somaReceitas = r2(receitas.reduce((s, l) => s + num(l.valor), 0) + semConta + totalCartoes);
    const somaDespesas = r2(despesas.reduce((s, l) => s + num(l.valor), 0));
    const totalCusto = r2(num(custo.rows[0]?.totalcusto));
    const totais = {
      receitas: somaReceitas,
      contas_recebidas_sem_conta: semConta,   // o bucket fixo "1.01. CONTAS RECEBIDAS" do legado
      cartoes_recebidos: totalCartoes,        // o bucket fixo "1.03. CARTOES RECEBIDOS"
      cheques_recebidos: 0,                   // cópia-fiel-negativa: CHEQUE tem 12 linhas no golden
      despesas: somaDespesas,
      resultado: r2(somaReceitas - somaDespesas),
      custo_mercadoria: totalCusto,
      credito_icms: r2(num(creditoIcms.rows[0]?.valor)),
      // total do rateio "resultado" (divisor = valor do título, sem juros) — NÃO é o mesmo que `despesas`
      total_resultado_contas: r2(resultado_contas.reduce((s2, l) => s2 + num(l.valor), 0)),
    };
    return { receitas, despesas, resultado_contas, totais, filtro: { ...f, empresas, fuso: tz } };
  }
}
