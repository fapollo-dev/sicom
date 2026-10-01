import { Injectable } from '@nestjs/common';
import { type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3, modelosDoPrefixo } from '../../shared/relatorios/modelo-fr3';
import { camposDoDataset } from '../../shared/relatorios/campos-fr3';
import { dataBr, registroFr3, textoVariavel, type RegistroFr3 } from '../../shared/relatorios/registro-fr3';
import { RelVendasService, type FiltroRelVendas } from './rel-vendas.service';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;

/** os nomes do `TVendas.GetSQL(1)` (uVendas.pas:1814-1866 — o TEMP) que o Apollo fornece para o dataset dbdConsulta */
export const CAMPOS_GETSQL_01 = ['IDEMPRESA', 'CODBARRA', 'QTDE', 'TOTAL_CUSTO', 'TOTAL_VENDA', 'DESCRICAO', 'RENTABILIDADE', 'DESC_PROMOCAO', 'DESC_SCANNTECH',
  'DESC_ACUMULATIVO', 'DESC_DEPARTAMENTO', 'DESC_OPERADOR', 'DESC_FUNC', 'DESC_ATAREJO', 'DESC_GESTAO_PROMOCAO', 'DESC_CRESCEVENDAS', 'ACRESCIMO', 'LUCRO', 'MARGEM',
  'IDPRODUTO', 'UNIDADE', 'CODDPTO', 'DEPTO', 'CODGRUPO', 'GRUPO', 'CODSUBGRUPO', 'SUBGRUPO', 'CODSECAO', 'SECAO', 'VRVENDA_UNI', 'VRCUSTO_UNI'];

const NUMERICAS = new Set(CAMPOS_GETSQL_01.filter((c) => !['CODBARRA', 'DESCRICAO', 'UNIDADE', 'DEPTO', 'GRUPO', 'SUBGRUPO', 'SECAO'].includes(c)).map((c) => c.toLowerCase()));

/**
 * A linha do relatório de produtos vendidos com os nomes do GetSQL(1): TOTAL_VENDA é o líquido (venda + acréscimo − desconto),
 * MARGEM o markup (venda/custo − 1), RENTABILIDADE o markdown, VRVENDA_UNI o bruto ÷ qtde; os descontos que o Apollo não separa
 * (Scanntech, acumulativo, funcionário, atacarejo, gestão de promoção, CresceVendas) são 0, como estão no dado do cliente.
 */
export function linhaGetSql01(l: RegistroFr3): RegistroFr3 {
  return registroFr3({
    idempresa: l.idempresa, codbarra: l.codbarra, qtde: l.qtde, total_custo: l.total_custo, total_venda: l.total_venda, descricao: l.descricao,
    rentabilidade: l.rentabilidade, desc_promocao: l.desc_promocao, desc_departamento: l.desc_departamento, desc_operador: l.desc_operador,
    desc_scanntech: 0, desc_acumulativo: 0, desc_func: 0, desc_atarejo: 0, desc_gestao_promocao: 0, desc_crescevendas: 0,
    acrescimo: l.acrescimo, lucro: l.lucro, margem: l.margem, idproduto: l.idproduto, unidade: l.unidade, coddpto: l.coddpto, depto: l.departamento,
    codgrupo: l.codgrupo, grupo: l.grupo, codsubgrupo: l.codsubgrupo, subgrupo: l.subgrupo, codsecao: l.codsecao, secao: l.secao,
    vrvenda_uni: l.vrvenda_uni, vrcusto_uni: l.vrcusto_uni,
  }, NUMERICAS);
}

/** os % de lucro bruto dos memos SysMemo10/SysMemo15 pela config de lucro bruto (URelVendas.pas:537-570) */
export function textosLucroBruto(porVenda: boolean): Record<string, string> {
  return {
    SysMemo10: porVenda
      ? '[iif(<dbdConsulta."TOTAL_VENDA"> > 0, (((<dbdConsulta."TOTAL_VENDA">-<dbdConsulta."TOTAL_CUSTO">) / <dbdConsulta."TOTAL_VENDA">)) * 100, 0)]%'
      : '[iif(<dbdConsulta."TOTAL_CUSTO"> > 0, ((<dbdConsulta."TOTAL_VENDA"> / <dbdConsulta."TOTAL_CUSTO">) - 1) * 100, 0)]%',
    SysMemo15: porVenda
      ? '[((SUM(<dbdConsulta."TOTAL_VENDA">-<dbdConsulta."TOTAL_CUSTO">,MasterData1) / SUM(<dbdConsulta."TOTAL_VENDA">,MasterData1))) * 100]%'
      : '[((SUM(<dbdConsulta."TOTAL_VENDA">,MasterData1) / SUM(<dbdConsulta."TOTAL_CUSTO">,MasterData1)) - 1) * 100]%',
  };
}

export interface LayoutHub { arquivo: string; completo: boolean; faltam: string[] }

/**
 * O HUB DE VENDAS NO LAYOUT DO CLIENTE (FRMRELVENDAS, `URelVendas.pas:500-735`): o combo lista os arquivos `ven2_*` do diretório de
 * relatórios — o número no nome é o `GetSQL(n)` —, e o "Imprimir" carrega o escolhido com o `dbdConsulta` e as variáveis do período.
 * Este corte faz o 01 (produtos vendidos no período). O layout só é oferecido quando o Apollo fornece todos os campos do dbdConsulta
 * que ele usa: o "Resumo de Vendas" do cliente imprime ST_/TD_QUANTIDADE e ST_/TD_TOTAL_VENDA, que a consulta de 2020 não tem e que
 * não estão no cache de SQL da produção — sem procedência, fica de fora (a lista diz por quê).
 */
@Injectable()
export class RelVendasFr3Service {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly vendas: RelVendasService,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** os layouts `ven2_<nn>` da RELATORIOS, cada um com os campos que faltam ao Apollo */
  async layouts(numero: string): Promise<LayoutHub[]> {
    this.emp();
    if (numero !== '01') throw new BusinessRuleError('RELATORIO_HUB_NAO_CONVERTIDO', { numero }, 'Este relatório ainda não imprime no layout do cliente.');
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await modelosDoPrefixo(db, `ven2_${numero} -`)).map((m) => {
      const faltam = [...camposDoDataset(m.xml, 'dbdConsulta')].filter((c) => !CAMPOS_GETSQL_01.includes(c)).sort();
      return { arquivo: m.arquivo, completo: !faltam.length, faltam };
    });
  }

  /** "Imprimir" do rel 01 com o layout escolhido: o dbdConsulta, o período, as variáveis do rodapé da grade (uRelVendasGrid1:343) */
  async imprimir01(f: FiltroRelVendas & { layout: string }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const layout = (await this.layouts('01')).find((l) => l.arquivo.toLowerCase() === String(f.layout ?? '').toLowerCase());
    if (!layout) throw new BusinessRuleError('RELATORIO_MODELO_NAO_ENCONTRADO', { arquivo: f.layout }, `O modelo de relatório "${f.layout}" não está cadastrado.`);
    if (!layout.completo) throw new BusinessRuleError('RELATORIO_LAYOUT_INCOMPLETO', { faltam: layout.faltam }, `O layout usa campos que o Apollo não fornece: ${layout.faltam.join(', ')}.`);
    const r = await this.vendas.produtosVendidos(f);
    // "Não há venda no filtro informado. Verifique!" (URelVendas.pas:520)
    if (!r.linhas.length) throw new BusinessRuleError('RELATORIO_SEM_VENDAS', undefined, 'Não há venda no filtro informado. Verifique!');
    if (r.filtro.truncado) throw new BusinessRuleError('RELATORIO_CORTADO', { max: r.filtro.max_linhas }, `O resultado passa de ${r.filtro.max_linhas} produtos — estreite o filtro para imprimir.`);
    const t = r.totais;
    const porVenda = String((await this.config.resolver('RELATORIO_VENDAS_LUCRO_BRUTO', { empresaId: emp })) ?? 'TOTAL CUSTO').toUpperCase() === 'TOTAL VENDA';
    const empresas = ((r.filtro.empresas as number[] | undefined) ?? [emp]).join(',');
    return {
      titulo: 'Relatório de vendas',
      modelo: await modeloFr3(db, layout.arquivo),
      datasets: { dbdConsulta: r.linhas.map((l) => linhaGetSql01(l as RegistroFr3)) },
      variaveis: {
        DtInicial: textoVariavel(dataBr(f.dtini)), DtFinal: textoVariavel(dataBr(f.dtfim)),
        HrInicial: textoVariavel(f.horaIni ?? '00:00'), HrFinal: textoVariavel(f.horaFim ?? '23:59'), Empresa: textoVariavel(empresas),
        AGRUPA_EMPRESA: textoVariavel(f.agruparEmpresas ? 'S' : 'N'), CUSTO_REP: textoVariavel(r.filtro.custo === 'REPOSICAO' ? 'SIM' : 'NÃO'),
        // o rodapé da grade (FooterSummaryValues 0..5): custo, venda, lucro, rentabilidade (markdown), margem (markup), acréscimo
        TOTAL_CUSTO: String(t.total_custo ?? 0), TOTAL_VENDA: String(t.total_venda ?? 0), LUCRO_BRUTO: String(t.lucro_bruto ?? 0),
        LUCRO_BRUTO_PERC: String(t.rentabilidade ?? 0), MARGEM_BRUTA: String(t.margem ?? 0), TOTAL_ACRES: String(t.acrescimo ?? 0),
      },
      textos: textosLucroBruto(porVenda),
    };
  }
}
