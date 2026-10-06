import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { hojeNaLoja } from '../../shared/tempo/hoje';
import { ConfigService } from '../cadastro/config.service';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3 } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dias = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export interface FiltroConsCliRcb {
  codparceiro: number;
  /** o edtJuro (% ao mês): sem ele, a taxa padrão da empresa (EMPRESAS.TXJUROPADRAO) */
  taxa?: number | null;
  /** o edtJuroAte (o juro projetado até essa data): sem ele, hoje */
  juroAte?: string | null;
  /** os títulos marcados (SEL) — os totais da seleção */
  selecionados?: number[] | null;
}

/**
 * CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`, `UConsCliRcb.pas` 584 linhas). Dossiê: `uConsCliRcb.md`. **64 acessos.**
 *
 * Refeita pelo fonte em 06/10/2026 (o corte de 09/2026 calculava o juro pela taxa do título e só na loja do login):
 *  - `sqqRcb`: os títulos **em aberto** (`QUITADA = 'N'`) e **não agrupados** do parceiro, de **todas as lojas**, em ordem de
 *    vencimento — com a razão, o primeiro endereço ativo, o PDV (`SUBSTR(NROPEDIDO, 1, 2)`), a TOLERÂNCIA, o DIASPRAZO e o DESCPADRAO
 *    do cliente; o ATRASO = max(0, hoje − vencimento);
 *  - o JURO e o TOTAL do SQL **não ficam**: o `edtCodClienteExit` põe no edtJuro a **taxa padrão da empresa** e o `edtJuroExit`
 *    recalcula cada linha com ELA (a TXJUROS da linha vira a taxa da tela): com ATRASO > 0 **e** ATRASO > TOLERÂNCIA, juro simples
 *    `TruncarArredondar((taxa/30) × (VALOR − DESCONTO_CLIENTE)/100 × (ATRASO + (juros até − hoje)), 'A', 2)` e TOTAL = JURO + VALOR −
 *    DESCONTO; ou, com JuroComposto (JURO_COMPOSTO_BX_RECEBER do módulo Retaguarda, como o histórico financeiro do cadastro), por
 *    mês cheio `(VALOR − DESC) × (1 + taxa)^meses` mais os dias que sobram a taxa/30 sobre o montante; senão JURO 0 e TOTAL = VALOR − DESC;
 *  - o DESCONTO_CLIENTE (DIASPRAZO > 0, DESCPADRAO > 0 e venda + DIASPRAZO ≥ hoje) = VALOR × DESCPADRAO/100 sai do TOTAL; na carga ele é
 *    aplicado DEPOIS do juro (o juro da carga não o desconta); quando o operador muda a taxa ou o "juros até", o juro já sai sobre o
 *    valor com desconto — `recalculo` reproduz as duas ordens;
 *  - os totais: geral e em atraso (vencimento < hoje), sem e com juros; os da seleção (valor, com juros, juros, descontos); o saldo do
 *    cliente (os créditos a pagar em aberto, `GetSaldoCliente`).
 * Na produção (06/10/2026) a TXJUROPADRAO é nula nas 5 lojas — a grade abre com juro zero até o operador digitar a taxa.
 */
@Injectable()
export class ConsCliRcbService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroConsCliRcb) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cli = (await sql<{ razao: string | null }>`SELECT razao FROM parceiros WHERE codparceiro = ${f.codparceiro}`.execute(db)).rows[0];
    if (!cli) throw new BusinessRuleError('CLIENTE_NAO_ENCONTRADO', { codparceiro: f.codparceiro }, 'Cliente não encontrado, Verifique!');

    const hoje = hojeNaLoja();
    const juroAte = f.juroAte ?? hoje;
    const padrao = num((await sql<{ t: unknown }>`SELECT txjuropadrao AS t FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0]?.t);
    const taxa = f.taxa != null ? Number(f.taxa) : padrao;
    const recalculo = f.taxa != null || f.juroAte != null;
    const composto = String((await this.config.resolver('JURO_COMPOSTO_BX_RECEBER', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'N')
      .trim().toUpperCase().startsWith('S');

    const rows = (await sql<Record<string, unknown>>`
      SELECT r.codrcb AS codigo, to_char(r.dtvenda, 'YYYY-MM-DD') AS dtvenda, to_char(r.dtvenc, 'YYYY-MM-DD') AS dtvenc, r.valor, r.duplicata,
             greatest(${hoje}::date - r.dtvenc::date, 0) AS atraso, coalesce(c.tolerancia, 0) AS tolerancia,
             r.nrocupom, r.obs, r.codempresa, r.codparceiro AS codigo_cliente, r.nropedido, c.razao,
             e.endereco, e.bairro, e.cnpj_cpf, substr(r.nropedido::text, 1, 2) AS pdv, c.diasprazo, coalesce(c.descpadrao, 0) AS descpadrao
        FROM areceber r
        LEFT JOIN parceiros c ON c.codparceiro = r.codparceiro
        LEFT JOIN LATERAL (SELECT pe.endereco, pe.bairro, pe.cnpj_cpf FROM parceiros_end pe
                            WHERE pe.codparceiro = c.codparceiro AND pe.ativado = 'S' ORDER BY pe.codend LIMIT 1) e ON true
       WHERE r.quitada = 'N' AND r.codparceiro = ${f.codparceiro} AND coalesce(r.agrupado, 'N') = 'N'
       ORDER BY r.dtvenc::date, r.codrcb
       LIMIT 5001`.execute(db)).rows;

    const y = dias(juroAte, hoje);
    const juroDe = (valor: number, desc: number, atraso: number, tol: number) => {
      if (!(atraso > 0 && atraso > tol)) return { juro: 0, total: valor - desc };
      if (composto) {
        const x = atraso + y;
        const t = Math.trunc(x / 30);
        const r = x - t * 30;
        let total = (valor - desc) * Math.pow(1 + taxa / 100, t);
        total += ((taxa / 30) * total / 100) * r;
        return { juro: (total + desc) - valor, total };
      }
      const juro = r2(((taxa / 30) * (valor - desc) / 100) * (atraso + y));
      return { juro, total: juro + (valor - desc) };
    };

    const sel = new Set((f.selecionados ?? []).map(Number));
    let totalGeral = 0, totalAtraso = 0, totalGeralJ = 0, totalAtrasoJ = 0;
    let selValor = 0, selTotal = 0, selJuro = 0, selDesc = 0;
    const titulos = rows.map((l) => {
      const valor = num(l.valor), atraso = num(l.atraso), tol = num(l.tolerancia);
      const temDesc = num(l.diasprazo) > 0 && num(l.descpadrao) > 0 && dias(String(l.dtvenda).slice(0, 10), hoje) + num(l.diasprazo) >= 0;
      const desc = temDesc ? valor * num(l.descpadrao) / 100 : 0;
      // a carga: o juro sem o desconto e o desconto tirado do total depois; o recálculo (taxa/juros até mudados): o juro já com ele
      const j = recalculo ? juroDe(valor, desc, atraso, tol) : juroDe(valor, 0, atraso, tol);
      const total = recalculo ? j.total : j.total - desc;
      const vencido = String(l.dtvenc).slice(0, 10) < hoje;
      totalGeral += valor; totalGeralJ += total;
      if (vencido) { totalAtraso += valor; totalAtrasoJ += total; }
      const s = sel.has(Number(l.codigo));
      if (s) { selValor += valor; selTotal += total; selJuro += j.juro; selDesc += desc; }
      return { ...l, txjuros: taxa, juro: r2(j.juro), total: r2(total), desconto_cliente: r2(desc), vencido, sel: s };
    });

    const saldoCliente = num(((await sql<{ v: unknown }>`
      SELECT coalesce(sum(valor), 0) AS v FROM apagar
       WHERE adcredito = 'S' AND coalesce(quitada, 'N') = 'N' AND codparceiro = ${f.codparceiro}`.execute(db)).rows[0] ?? {}).v);

    return {
      cliente: cli.razao, taxa, juroAte, composto, titulos, saldoCliente: r2(saldoCliente),
      totais: {
        titulos: titulos.length, geral: r2(totalGeral), atraso: r2(totalAtraso), geralComJuros: r2(totalGeralJ), atrasoComJuros: r2(totalAtrasoJ),
        selecionados: sel.size ? titulos.filter((t) => t.sel).length : 0,
        selValor: r2(selValor), selComJuros: r2(selTotal), selJuros: r2(selJuro), selDescontos: r2(selDesc),
      },
    };
  }

  /**
   * O Imprimir (`BitBtn1Click`): `Relatorios\Rel_BaixaAReceber.fr3` com o `cdsRcb` filtrado nos MARCADOS (`SEL = TRUE`) no
   * `frxDBDataset1` — as colunas como a grade está (a taxa da tela, o juro e o total recalculados) — e a variável TOTADIANTAMENTO =
   * o saldo do cliente (o script do layout tira esse valor do total). Nada marcado: o relatório sai vazio, como no legado.
   */
  async impressao(f: FiltroConsCliRcb) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.consultar(f);
    const marcados = r.titulos.filter((t) => t.sel);
    const nums = new Set(['codigo', 'valor', 'txjuros', 'atraso', 'tolerancia', 'juro', 'total', 'codempresa', 'codigo_cliente', 'diasprazo', 'descpadrao', 'desconto_cliente']);
    return {
      titulo: `A receber — ${r.cliente ?? ''}`,
      modelo: await modeloFr3(db, 'Rel_BaixaAReceber.fr3'),
      datasets: { frxDBDataset1: marcados.map(({ vencido: _v, sel: _s, ...l }) => registroFr3(l, nums)) },
      variaveis: { TOTADIANTAMENTO: String(r.saldoCliente) },
    };
  }
}
