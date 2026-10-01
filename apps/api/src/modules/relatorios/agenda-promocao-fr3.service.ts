import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, dataBr, registroFr3, textoVariavel, type RegistroFr3 } from '../../shared/relatorios/registro-fr3';
import { AgendaPromocaoRelService, type FiltroRelAgenda } from './agenda-promocao-rel.service';
import { ConfigService } from '../cadastro/config.service';
import { linhaGetSql01, textosLucroBruto } from './rel-vendas-fr3.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ImpressaoAgenda { titulo: string; modelo: string; datasets: Record<string, RegistroFr3[]>; variaveis?: Record<string, string>; textos?: Record<string, string> }

/** as colunas numéricas dos registros que os relatórios imprimem (o que vem das consultas, não das tabelas) */
const NUMERICAS = new Set(['qtde', 'total_custo', 'total_venda', 'rentabilidade', 'desc_promocao', 'desc_departamento', 'desc_operador', 'acrescimo', 'lucro', 'margem',
  'vrvenda_uni', 'vrcusto_uni', 'vr_total_venda', 'vr_total_dif_venda_promo', 'vr_total_venda_promo', 'vr_total_perc_dif_venda_promo', 'vrvenda', 'vrcusto', 'vlrpromocao',
  'preco2', 'vrcustorep', 'vr_total_depto', 'idempresa', 'idproduto', 'codproduto', 'codagenda', 'desc_acre', 'vrpromo']);

/**
 * OS RELATÓRIOS DA AGENDA DE PROMOÇÃO NO LAYOUT DO CLIENTE — o `GeralRel` (uCadAgendaPromocao.pas:1844), o `GerarRelProdInativos` e o
 * `btnImprimirClick` carregam o .fr3 e imprimem com os datasets da tela. Aqui os dados são os do `AgendaPromocaoRelService` (o mesmo
 * da prévia na tela) e o modelo vem da RELATORIOS (PERSONALIZADO antes do DEFAULT); o navegador desenha (`shared/fr3`).
 *
 * | relatório | modelo | datasets e variáveis (procedência) |
 * |---|---|---|
 * | imprimir a agenda | ListagemAgendaPromocao / RelatorioAgendaPromocaoAgrupadoDepto | frxDBDatasetA (a agenda), frxDBDatasetB (os itens), frxDBDatasetC (por depto) |
 * | vendidos | Rel_Produtos_Vendidos_no_Periodo_Agrupado | dbdConsulta (GetSQL 1), frxDBDatasetD (GetSQL 1000); DtInicial/DtFinal = as DATAS DA AGENDA (edtDtInicio, :2068) |
 * | TV/rádio/tabloide/interna | ven2_01 - Produtos_vendidos_no_periodo | dbdConsulta; as datas do diálogo; `CalculaTotais` (MARGEM_BRUTA, TOTAL_VENDA, LUCRO_BRUTO…) e o % de lucro pela config |
 * | totais / com itens | CadAgenda_Vendas_Rebaixa(_Itens) | dbdConsulta (GetSQL 1001/1002) |
 * | por loja | AgendaPromocaoVendidosPorLoja | dbdPorLoja: o pivô Q/C/V 1..3 com até 5 caracteres de lojas ("1,2,3"), senão a lista; QtdEmpresa = esse comprimento |
 * | fim da promoção | ListagemProdutosFimPromocao | dbdRelFimPromocao; os memos dtFimPromocao e Empresas |
 * | inativos | Agenda_Promocao_Produtos_Inativos | dbdRelProdAtivo; os memos Empresas e Agenda |
 */
@Injectable()
export class AgendaPromocaoFr3Service {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly rel: AgendaPromocaoRelService,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async imprimir(codagenda: number, f: FiltroRelAgenda): Promise<ImpressaoAgenda> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = (await this.rel.relatorio(codagenda, f)) as Record<string, any>;
    const reg = (x: RegistroFr3) => registroFr3(x, NUMERICAS);
    const linhas: RegistroFr3[] = (r.linhas ?? []) as RegistroFr3[];
    // a agenda (cdsAgendaPromocao, o frxDBDatasetA) com as datas como o legado as tem: data e hora
    const agenda = (await sql<RegistroFr3>`
      SELECT a.*, to_char(a.dtiniciopromocao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS dtiniciopromocao,
             to_char(a.dtfimpromocao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS dtfimpromocao
        FROM agenda_promocao a WHERE a.codagenda = ${codagenda}`.execute(db)).rows[0] ?? {};
    const numsAgenda = await colunasNumericas(db, ['agenda_promocao']);
    const agendaReg = registroFr3(agenda, numsAgenda);
    const dtAgendaIni = dataBr(String(agenda.dtiniciopromocao ?? ''));
    const dtAgendaFim = dataBr(String(agenda.dtfimpromocao ?? ''));
    const empresas = ((r.empresas as number[] | undefined) ?? [emp]).join(',');
    const periodo = (ini: string, fim: string) => ({
      DtInicial: textoVariavel(ini), DtFinal: textoVariavel(fim), HrInicial: textoVariavel(String(r.horaIni ?? '')), HrFinal: textoVariavel(String(r.horaFim ?? '')),
      Empresa: textoVariavel(empresas),
    });
    // "Nenhum registro encontrado!" (:1966/:1977) — os relatórios de venda não imprimem a consulta vazia
    const exigeLinhas = () => { if (!linhas.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', { tipo: f.tipo }, 'Nenhum registro encontrado!'); };
    const titulo = `Agenda ${codagenda} — ${String(agenda.nomepromo ?? '')}`;

    switch (f.tipo) {
      case 'agenda': {
        // DmConfigura.AgruparAgendaPromocaoPorDepartamento (ConfigDB.xml da estação) → a escolha na hora de imprimir
        if (r.agrupar) return {
          titulo, modelo: await modeloFr3(db, 'RelatorioAgendaPromocaoAgrupadoDepto.fr3'),
          datasets: { frxDBDatasetA: [agendaReg], frxDBDatasetB: linhas.map(reg), frxDBDatasetC: ((r.departamentos ?? []) as RegistroFr3[]).map(reg) },
        };
        return { titulo, modelo: await modeloFr3(db, 'ListagemAgendaPromocao.fr3'), datasets: { frxDBDatasetA: [agendaReg], frxDBDatasetB: linhas.map(reg) } };
      }
      case 'vendidos': {
        exigeLinhas();
        if (!((r.departamentos ?? []) as unknown[]).length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', { tipo: f.tipo }, 'Nenhum registro encontrado!');
        return {
          titulo, modelo: await modeloFr3(db, 'Rel_Produtos_Vendidos_no_Periodo_Agrupado.fr3'),
          datasets: { dbdConsulta: linhas.map(linhaGetSql01), frxDBDatasetD: ((r.departamentos ?? []) as RegistroFr3[]).map(reg) },
          // trNormal usa as datas da AGENDA (edtDtInicio/edtDtFim), não as do diálogo (uCadAgendaPromocao.pas:2068)
          variaveis: periodo(dtAgendaIni, dtAgendaFim),
        };
      }
      case 'tv': case 'radio': case 'tabloide': case 'interno': {
        exigeLinhas();
        const vrVenda = linhas.reduce((s, l) => s + num(l.total_venda), 0);
        const vrCusto = linhas.reduce((s, l) => s + num(l.total_custo), 0);
        const vrAcres = linhas.reduce((s, l) => s + num(l.acrescimo), 0);
        // CalculaTotais (:2386): as razões sobre a venda — o legado divide por zero sem venda; aqui 0
        const pct = (a: number) => (vrVenda !== 0 ? r2((a / vrVenda) * 100) : 0);
        const porVenda = String((await this.config.resolver('RELATORIO_VENDAS_LUCRO_BRUTO', { empresaId: emp })) ?? 'TOTAL CUSTO').toUpperCase() === 'TOTAL VENDA';
        return {
          titulo, modelo: await modeloFr3(db, 'ven2_01 - Produtos_vendidos_no_periodo.fr3'),
          datasets: { dbdConsulta: linhas.map(linhaGetSql01) },
          variaveis: {
            ...periodo(dataBr(String(r.dtini ?? '')), dataBr(String(r.dtfim ?? ''))),
            MARGEM_BRUTA: String(pct(vrCusto)), TOTAL_VENDA: String(vrVenda), LUCRO_BRUTO: String(r2(vrVenda - vrCusto)),
            LUCRO_BRUTO_PERC: String(pct(vrVenda - vrCusto)), TOTAL_CUSTO: String(vrCusto), TOTAL_ACRES: String(vrAcres), DESCONTOTOTAL: '0',
          },
          // o % de lucro bruto dos memos SysMemo10/SysMemo15 segue a config LucroBruto (:1931-1952) e o total de desconto sai 0,00 (:1925)
          textos: { MemoTOTAL_DESC: '0,00', ...textosLucroBruto(porVenda) },
        };
      }
      case 'totais': case 'totais-itens':
        exigeLinhas();
        return {
          titulo, modelo: await modeloFr3(db, f.tipo === 'totais' ? 'CadAgenda_Vendas_Rebaixa.fr3' : 'CadAgenda_Vendas_Rebaixa_Itens.fr3'),
          datasets: { dbdConsulta: linhas.map(reg) }, variaveis: periodo(dataBr(String(r.dtini ?? '')), dataBr(String(r.dtfim ?? ''))),
        };
      case 'por-loja': {
        exigeLinhas();
        // Length(Empresa) <= 5 (:2214): o pivô Q/C/V pelo CÓDIGO da loja (1 a 3); acima disso a lista. A loja de código fora de 1..3
        // derruba o pivô do legado ("Não foi possível carregar todos os dados.") — aqui ela não entra no pivô
        const pivo = empresas.length <= 5;
        const dados: RegistroFr3[] = [];
        if (pivo) {
          for (const l of linhas) {
            let p = dados[dados.length - 1];
            if (!p || p.IDPRODUTO !== num(l.codproduto)) {
              p = { IDPRODUTO: num(l.codproduto), Q1: 0, Q2: 0, Q3: 0, C1: 0, C2: 0, C3: 0, V1: 0, V2: 0, V3: 0 };
              dados.push(p);
            }
            p.CODBARRAS = l.codbarra;
            p.DESCRICAO = l.descricao;
            const loja = num(l.idempresa);
            if (loja >= 1 && loja <= 3) { p[`Q${loja}`] = num(l.qtde); p[`C${loja}`] = num(l.vrcusto); p[`V${loja}`] = num(l.vrvenda); }
          }
        }
        return {
          titulo, modelo: await modeloFr3(db, 'AgendaPromocaoVendidosPorLoja.fr3'),
          datasets: { dbdPorLoja: pivo ? dados : linhas.map(reg) },
          variaveis: { ...periodo(dtAgendaIni, dtAgendaFim), QtdEmpresa: String(empresas.length) },
        };
      }
      case 'fim-promocao':
        return {
          titulo: `Produtos que sairão da promoção em ${dataBr(String(r.data ?? ''))}`, modelo: await modeloFr3(db, 'ListagemProdutosFimPromocao.fr3'),
          datasets: { dbdRelFimPromocao: linhas.map(reg) },
          textos: { dtFimPromocao: dataBr(String(r.data ?? '')), Empresas: `Empresa: ${emp}` },
        };
      case 'inativos':
        return {
          titulo, modelo: await modeloFr3(db, 'Agenda_Promocao_Produtos_Inativos.fr3'),
          datasets: { dbdRelProdAtivo: linhas.map(reg) },
          textos: { Empresas: `Empresa: ${emp}`, Agenda: `Agenda: ${codagenda} - ${String(agenda.nomepromo ?? '')}` },
        };
      default:
        throw new BusinessRuleError('RELATORIO_TIPO_INVALIDO', { tipo: f.tipo });
    }
  }
}
