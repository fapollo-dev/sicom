import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';
import { ConfigService } from './config.service';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DH = 'YYYY-MM-DD"T"HH24:MI:SS';

export type StatusHist = 'abertos' | 'liquidados' | 'todos';
const STATUS_VALIDOS: readonly StatusHist[] = ['abertos', 'liquidados', 'todos'];
/** o que o laço do legado não grava no dataset da consulta (fkInternalCalc do cdsSaldoParceiros): a impressão os leva vazios */
const SENSIVEIS = /senha|token|hash|biometria|certificado/i;

/**
 * HISTÓRICO FINANCEIRO do parceiro (aba tsSaldoParceiros do uCadClientes — `btnVisualizarSaldoParceirosClick`, uCadClientes.pas:2438,
 * e o `cdsSaldoParceiros`, udmParceiros.dfm:2796) — READ-ONLY.
 *  - A consulta é do parceiro em TODAS as lojas: A Receber (+), A Pagar (−, pela data da COMPRA) e CHEQUE (o cheque do parceiro, pelo
 *    BOMPARA; 11 na produção, 7 em aberto, de 2023); o status troca os filtros do legado (/*QUITADOA*\/, /*QUITADO*\/, /*AGRUPADO*\/; nos
 *    abertos, o CONSILIADO='S' quando a loja do login fecha caixa). O TOTAL_COM_JUROS (modo simples) vem da SQL: juros/dia = TXJUROS/30
 *    sobre o valor ORIGINAL, quando o atraso passa da tolerância.
 *  - As lojas (`GetMultiEmpresa`) recortam a GRADE (`cdsSaldos.Filter := 'IDEMPRESA IN (...)'`) e o SALDO corrente corre só nelas; os
 *    somatórios (Receber, Pagar, Receber c/ juros, Restante = Pagar + Crédito − Receber) somam TODAS as linhas, como o laço do legado.
 *  - Juro COMPOSTO quando JURO_COMPOSTO_BX_RECEBER do módulo Retaguarda é 'S' (o binário novo leva para a CONFIGURACOES o "JURO
 *    COMPOSTO BX RECEBER" que o fonte de 2020 lia do ConfigDB.xml; a produção tem 'S' com o específico do módulo Retaguarda = 'N' — simples):
 *    por mês cheio de atraso VALOR × (1 + TX)^meses, mais os dias que sobram a TX/30 sobre o montante.
 *  - O "ARECEBER AGRUPADO" (AGRUPARECEBER, nos liquidados e todos) não entra: a tabela tem 0 linhas na produção (01/10/2026).
 * QUIRK FIEL: o LEFT JOIN às baixas faz uma linha por baixa (com o valor PAGO dela), e o TOTAL_COM_JUROS usa o valor ORIGINAL em cada uma.
 */
@Injectable()
export class ParceiroHistoricoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o `cdsSaldoParceiros`: as linhas do parceiro em todas as lojas, na ordem do legado (data da venda/compra, vencimento, razão, total) */
  private async consulta(db: AnyDB, codparceiro: number, status: StatusHist): Promise<Linha[]> {
    const emp = this.emp();
    const fechaCaixa = (await sql<{ f: string | null }>`SELECT fechamento_caixa AS f FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0]?.f === 'S';
    const arStatus = status === 'abertos'
      ? sql`AND a.quitada LIKE '%N%' ${fechaCaixa ? sql`AND a.consiliado = 'S'` : sql``} AND coalesce(a.agrupado, 'N') = 'N'`
      : status === 'liquidados'
        ? sql`AND (a.quitada LIKE '%S%' OR (coalesce(a.agrupado, 'N') = 'S' AND coalesce(a.codgrupo_agrupamento_rcb, 0) > 0))`
        : sql``;
    // o /*QUITADO*/ do A Pagar e do cheque: '%N%', '%S%' ou '%%' (que não pega o nulo)
    const like = status === 'abertos' ? '%N%' : status === 'liquidados' ? '%S%' : '%%';
    const apAgrupado = status === 'abertos' ? sql`AND coalesce(c.agrupado, 'N') = 'N'` : sql``;
    const atraso = (col: string) => sql`greatest(0, current_date - ${sql.ref(col)}::date)`;
    return (await sql<Linha>`
      SELECT * FROM (
        SELECT a.duplicata, ${atraso('a.dtvenc')} AS atraso, coalesce(b.tolerancia, 0) AS tolerancia, to_char(a.dtvenda, ${DH}) AS dtvenda_compra,
               a.codparceiro, b.razao,
               CASE coalesce(bx.valorpg, 0) WHEN 0 THEN a.valor ELSE bx.valorpg END AS valor, coalesce(a.txjuros, 0) AS txjuros,
               (CASE WHEN (current_date - a.dtvenc::date) < b.tolerancia THEN a.valor
                     ELSE (coalesce(a.txjuros / 30.0, 0) * coalesce(${atraso('a.dtvenc')} * a.valor / 100, 0)) + a.valor END)::numeric(13,2) AS total_com_juros,
               to_char(a.dtvenc::date, ${DH}) AS dtvenc, to_char(bx.dtpgto::date, ${DH}) AS datapgto, 'ARECEBER'::varchar(20) AS tipo, 'N'::char(1) AS devolvido,
               a.nrocupom::varchar AS nrocupom, 0 AS codnovorcb, a.codempresa AS idempresa, a.nropedido::varchar AS nropedido, a.idnf::varchar(20) AS idnf,
               a.codrcb AS codorigem, a.dtvenda AS o1, a.dtvenc::date AS o2
          FROM areceber a
          LEFT JOIN parceiros b    ON b.codparceiro = a.codparceiro
          LEFT JOIN areceber_bx bx ON bx.codrcb = a.codrcb AND coalesce(bx.indr, 'I') = 'I'
         WHERE a.codparceiro = ${codparceiro} AND a.valor > 0 ${arStatus}
        UNION ALL
        SELECT c.duplicata, ${atraso('c.dtvenc')}, coalesce(d.tolerancia, 0), to_char(c.dtcompra, ${DH}), c.codparceiro, d.razao,
               CASE coalesce(bz.valorpg, 0) WHEN 0 THEN c.valor * -1 ELSE bz.valorpg * -1 END, coalesce(c.txjuros, 0), 0::numeric(15,2),
               to_char(c.dtvenc::date, ${DH}), to_char(bz.dtpgto::date, ${DH}), 'APAGAR'::varchar(20), 'N'::char(1), NULL, 0, c.codempresa, ''::varchar,
               c.idnf::varchar(20), c.codapg, c.dtcompra, c.dtvenc::date
          FROM apagar c
          LEFT JOIN parceiros d  ON d.codparceiro = c.codparceiro
          LEFT JOIN apagar_bx bz ON bz.codapg = c.codapg AND coalesce(bz.indr, 'I') = 'I'
         WHERE c.quitada LIKE ${like} AND c.codparceiro = ${codparceiro} AND c.valor > 0 ${apAgrupado}
        UNION ALL
        SELECT ch.nrocheque::varchar(20), ${atraso('ch.bompara')}, coalesce(d.tolerancia, 0), to_char(ch.dtemissao, ${DH}), ch.codparceiro, d.razao,
               ch.valor, coalesce(ch.txjuros, 0),
               (CASE WHEN (current_date - ch.bompara::date) < d.tolerancia THEN ch.valor
                     ELSE (coalesce(ch.txjuros / 30.0, 0) * coalesce(${atraso('ch.bompara')} * ch.valor / 100, 0)) + ch.valor END)::numeric(13,2),
               to_char(ch.bompara::date, ${DH}), to_char(ch.databaixa::date, ${DH}), 'CHEQUE'::varchar(20), ch.devolvido, NULL, 0, ch.idempresa,
               ch.nropedido::varchar, NULL, ch.codchq, ch.dtemissao, ch.bompara::date
          FROM cheque ch
          LEFT JOIN parceiros d ON d.codparceiro = ch.codparceiro
         WHERE ch.baixado LIKE ${like} AND ch.codparceiro = ${codparceiro}
      ) h
      ORDER BY o1, o2, razao, total_com_juros`.execute(db)).rows;
  }

  async historico(codparceiro: number, statusRaw: string | undefined, empresasPedidas?: number[]) {
    const status: StatusHist = (STATUS_VALIDOS as readonly string[]).includes(statusRaw ?? '') ? (statusRaw as StatusHist) : 'todos';
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, empresasPedidas);
    const composto = String((await this.config.resolver('JURO_COMPOSTO_BX_RECEBER', { empresaId: this.emp(), operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'N')
      .trim().toUpperCase().startsWith('S');
    const rows = await this.consulta(db, codparceiro, status);

    let receber = 0, pagar = 0, receberComJuros = 0, saldoSel = 0, saldoComJuroSel = 0;
    const linhas: Linha[] = [];
    for (const r of rows) {
      const valor = Number(r.valor ?? 0);
      const total = Number(r.total_com_juros ?? 0);
      const tipo = String(r.tipo);
      let valorComJuro: number;
      let juroDaLinha: number;
      if (composto) {
        const atraso = Number(r.atraso ?? 0), tol = Number(r.tolerancia ?? 0), tx = Number(r.txjuros ?? 0);
        let saldoJ = 0;
        if (atraso > 0 && atraso > tol) {
          const meses = Math.trunc(atraso / 30);
          const resto = atraso - meses * 30;
          let montante = valor * Math.pow(1 + tx / 100, meses);
          montante += ((tx / 30) * montante / 100) * resto;
          saldoJ = montante - valor;
        }
        valorComJuro = valor + saldoJ;
        juroDaLinha = valor + saldoJ;
        if (tipo === 'ARECEBER' || tipo === 'CHEQUE') { receber += valor; receberComJuros += valor + saldoJ; } else if (tipo === 'APAGAR') pagar += valor;
      } else {
        valorComJuro = total;
        juroDaLinha = total > 0 ? total : valor;
        if (tipo === 'ARECEBER' || tipo === 'CHEQUE') { receber += valor; receberComJuros += total; } else if (tipo === 'APAGAR') pagar += valor;
      }
      if (!empresas.includes(Number(r.idempresa))) continue; // a grade só mostra as lojas marcadas — os totais já somaram
      saldoSel = r2(saldoSel + valor);
      saldoComJuroSel = r2(saldoComJuroSel + juroDaLinha);
      linhas.push({
        tipo, dtvenda_compra: r.dtvenda_compra, dtvenc: r.dtvenc, nrocupom: r.nrocupom, valor: r2(valor), saldo: saldoSel,
        txjuros: Number(r.txjuros ?? 0), valor_com_juro: r2(valorComJuro), saldo_com_juro: saldoComJuroSel, total_com_juros: r2(total),
        duplicata: r.duplicata, datapgto: r.datapgto, agrupamento: null, devolvido: r.devolvido, idempresa: Number(r.idempresa),
        atraso: Number(r.atraso ?? 0), codorigem: r.codorigem, nropedido: r.nropedido,
      });
    }
    const credito = Number(((await sql<{ credito: unknown }>`SELECT credito FROM parceiros WHERE codparceiro = ${codparceiro}`.execute(db)).rows[0]?.credito) ?? 0);
    return {
      status,
      juros_modo: composto ? ('composto' as const) : ('simples' as const),
      empresas,
      linhas,
      resumo: { receber: r2(receber), pagar: r2(pagar), receber_com_juros: r2(receberComJuros), credito: r2(credito), restante: r2(pagar + credito - receber) },
    };
  }

  /**
   * "Imprimir" do histórico (`btnImprimirExtratoClick`): o HistoricoFinanceiro.fr3 com o frxDBDatasetDados = o `cdsSaldoParceiros` — a
   * consulta crua, de TODAS as lojas (o recorte das lojas é do cdsSaldos da grade, que a impressão não usa) e sem o SALDO, o SALDO_COM_JURO e
   * o VALOR_COM_JURO, que o laço só grava no cdsSaldos (no dataset da consulta são fkInternalCalc nunca preenchidos — saem vazios no
   * legado). frxDBDataset1 = a empresa do login. Sem linha: a mensagem do legado.
   */
  async impressaoHistorico(codparceiro: number, statusRaw: string | undefined) {
    const status: StatusHist = (STATUS_VALIDOS as readonly string[]).includes(statusRaw ?? '') ? (statusRaw as StatusHist) : 'todos';
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = await this.consulta(db, codparceiro, status);
    if (!rows.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', { codparceiro }, 'Não existe informações para serem impressas. Verifique !!!');
    const nums = await colunasNumericas(db, ['areceber', 'apagar', 'cheque'], ['valor', 'txjuros', 'total_com_juros', 'atraso', 'tolerancia', 'codnovorcb', 'codorigem']);
    const dados = rows.map(({ o1: _o1, o2: _o2, ...r }) => registroFr3({ ...r, saldo: null, saldo_com_juro: null, valor_com_juro: null }, nums));
    return {
      titulo: `Histórico financeiro do parceiro ${codparceiro}`,
      modelo: await modeloFr3(db, 'HistoricoFinanceiro.fr3'),
      datasets: { frxDBDatasetDados: dados, frxDBDataset1: [await empresaParaRelatorio(db, this.emp())] },
    };
  }

  /** o parceiro (cdsParceiros), os endereços (qryEndParceiros, o padrão primeiro) e os relacionamentos (qryRelParceiros) — sem senhas */
  private async cadastro(db: AnyDB, codparceiro: number) {
    const p = (await sql<Linha>`SELECT * FROM parceiros WHERE codparceiro = ${codparceiro}`.execute(db)).rows[0];
    if (!p) throw new BusinessRuleError('PARCEIRO_NAO_ENCONTRADO', { codparceiro });
    const enderecos = (await sql<Linha>`
      SELECT e.codend, e.codparceiro, e.endereco, e.numero, e.bairro, e.cidade, e.uf, e.telefone, e.celular, e.fax, e.cnpj_cpf, e.rg_insc, e.cep,
             e.complemento, e.ativado, e.endereco_padrao, p.razao, p.tipofj, e.idcidade, e.tipo_endereco, e.referencia, e.codpais
        FROM parceiros_end e
        JOIN parceiros p ON p.codparceiro = e.codparceiro
       WHERE e.codparceiro = ${codparceiro}
       ORDER BY e.endereco_padrao DESC, e.codend`.execute(db)).rows;
    const rel = (await sql<Linha>`
      SELECT codrelacionamento, codparceiro, tiporel, nome, doc1, doc2, telefone, celular, endereco, ativado
        FROM parceiros_rel WHERE codparceiro = ${codparceiro} ORDER BY codrelacionamento`.execute(db)).rows;
    const nums = await colunasNumericas(db, ['parceiros', 'parceiros_end', 'parceiros_rel']);
    const parceiro = registroFr3(Object.fromEntries(Object.entries(p).filter(([k]) => !SENSIVEIS.test(k))), nums);
    return { parceiro, enderecos: enderecos.map((e) => registroFr3(e, nums)), rel: rel.map((r) => registroFr3(r, nums)) };
  }

  /**
   * "Ficha cadastral" (`Fichacadastral1Click`): o FichaCadatralParceiro.fr3 com o parceiro, os endereços (sub-relatório da Page2) e as
   * referências (sub-relatório da Page3), e a empresa do login.
   */
  async impressaoFicha(codparceiro: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const { parceiro, enderecos, rel } = await this.cadastro(db, codparceiro);
    return {
      titulo: `Ficha cadastral ${codparceiro}`,
      modelo: await modeloFr3(db, 'FichaCadatralParceiro.fr3'),
      datasets: { frxDBDatasetParceiro: [parceiro], frxDBDatasetEnd: enderecos, frxDBDatasetRel: rel, frxDBDataset1: [await empresaParaRelatorio(db, this.emp())] },
    };
  }

  /**
   * "Imprimir cartão" (`ImprimirCarto1Click`): o Cliente_Cartao.fr3 — sem banda de dados, os campos saem do registro CORRENTE: o
   * parceiro e o endereço selecionado na grade (o código de barras é o CODPARCEIRO do endereço; o CPF, o dele).
   */
  async impressaoCartao(codparceiro: number, codend?: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const { parceiro, enderecos } = await this.cadastro(db, codparceiro);
    const atual = enderecos.find((e) => Number(e.CODEND) === codend) ?? enderecos[0];
    return {
      titulo: `Cartão do cliente ${codparceiro}`,
      modelo: await modeloFr3(db, 'Cliente_Cartao.fr3'),
      datasets: { frxDBDatasetParceiro: [parceiro], frxDBDatasetEnd: atual ? [atual] : [] },
    };
  }
}
