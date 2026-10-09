import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoService } from '../../shared/acesso/acesso.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError, ForbiddenActionError } from '../../shared/errors/app-error';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** o cadastro que o "Corrigir" abre (o `AbreTela` do legado) */
export type CadastroDaPendencia = 'cfop' | 'produto' | 'nf' | 'operadora' | 'parceiro';

export interface PendenciaSped {
  /** o TCodPendencia do legado */
  tipo:
    | 'cfop_plc' | 'ncm_produto' | 'nfe_sem_chave' | 'produto_sem_piscofins' | 'produto_sem_base_credito' | 'operadora_sem_adm'
    | 'administradora_sem_cnpj' | 'cnpj_cpf_invalido' | 'cod_mun_invalido' | 'parceiro_sem_endereco';
  /** "Descrição da pendência" */
  descricao: string;
  /** "Código" (o CodigoRegistro: o CFOP, o código de barras, o CODNF, o produto, a operadora, o parceiro) */
  codigo: string;
  /** "Descrição" (o DescricaoRegistro) */
  descricao_registro: string;
  /** "Complemento" (o NCM, na verificação de NCM) */
  complemento?: string | null;
  /** o que o Corrigir abre */
  abrir: { cadastro: CadastroDaPendencia; id: number; tipo_nf?: 'E' | 'S' };
}

/**
 * Os produtos com NCM inválido (`TFrmPendenciasSPED.GetNCMProdutosInvalidos`, UPendenciasSPED.pas:788-842) — o "Verificar NCM dos produtos
 * ativos" do cadastro de produto: os ATIVOS (pela MULTI_PRECO com ATIVO_PELA_MULTIPRECO = 'S'; senão o PRODUTOS.ATIVO — 'N' na produção)
 * com NCM fora de 8 caracteres, vazio, que não está na tabela NCM, com a vigência vencida ou ainda não começada; em ordem de descrição.
 */
export async function ncmProdutosInvalidos(db: AnyDB): Promise<PendenciaSped[]> {
  const t = currentTenant();
  const pelaMultiPreco = String((await configNaTrx(db, 'ATIVO_PELA_MULTIPRECO', { empresaId: t.empresaId ?? undefined, operadorId: t.operadorId ?? undefined, modulo: 'Retaguarda' })) ?? 'N')
    .trim().toUpperCase() === 'S';
  const ativos = pelaMultiPreco
    ? sql`(SELECT DISTINCT p.idproduto, p.codbarra, p.descricao, p.ncmsh FROM produtos p JOIN multi_preco mp ON mp.idproduto = p.idproduto WHERE coalesce(mp.ativo, 'S') = 'S')`
    : sql`(SELECT p.idproduto, p.codbarra, p.descricao, p.ncmsh FROM produtos p WHERE coalesce(p.ativo, 'S') = 'S')`;
  const rows = (await sql<{ idproduto: number; codbarra: string | null; descricao: string | null; ncmsh: string | null; motivo: string }>`
      SELECT p.idproduto, p.codbarra, p.descricao, p.ncmsh,
             CASE
               WHEN length(p.ncmsh) <> 8 THEN 'NCM do produto possui menos de 8 caracteres'
               WHEN p.ncmsh IS NULL THEN 'NCM não informado'
               WHEN n.ncmsh IS NULL THEN 'NCM não encontrado no sistema ou inválido'
               WHEN n.vigencia_fim IS NOT NULL AND n.vigencia_fim < current_date THEN 'A data de validade do NCM foi ultrapassada'
               WHEN n.vigencia_inicio IS NOT NULL AND n.vigencia_fim > current_date THEN 'O NCM informado no produto ainda não está em vigência'
               ELSE 'NCM inválido'
             END AS motivo
        FROM ${ativos} p
        LEFT JOIN ncm n ON n.ncmsh = p.ncmsh
       WHERE length(p.ncmsh) <> 8 OR p.ncmsh IS NULL OR n.ncmsh IS NULL
          OR (n.vigencia_fim IS NOT NULL AND n.vigencia_fim < current_date)
          OR (n.vigencia_inicio IS NOT NULL AND n.vigencia_fim > current_date)
       ORDER BY p.descricao`.execute(db)).rows;
  return rows.map((r) => ({
    tipo: 'ncm_produto', descricao: r.motivo, codigo: String(r.codbarra ?? ''), descricao_registro: String(r.descricao ?? ''),
    complemento: r.ncmsh ?? null, abrir: { cadastro: 'produto', id: Number(r.idproduto) },
  }));
}

/**
 * PRÉ-VALIDADOR DO SPED (`TFrmPendenciasSPED`, UPendenciasSPED.pas — "Pendências SPED"): o que o SPED Fiscal e o SPED PIS/COFINS conferem
 * antes de gerar o arquivo (o "Pré-validador", marcado por padrão — Uspedfiscal.pas:4362, UspedPisCofins.pas:2523). Na loja do login, no
 * período (`AnalisaPendencias`, :367-390):
 *  - SPED Fiscal: o cartão sem administradora e a administradora sem CNPJ;
 *  - SPED PIS/COFINS: o CFOP sem conta contábil e o produto sem a base de crédito da isenção;
 *  - os dois: a NF-e sem chave, e os participantes — CNPJ/CPF vazio, município que não está na tabela de cidades, parceiro sem endereço.
 * A NFAUXSPED do legado (a NF do período ⋈ o endereço dela) entra direto na consulta. O ramo das NFC-e dos participantes
 * (chkGerarNFCParticipante) fica de fora: a NFC-e é do PDV, fora do escopo.
 */
@Injectable()
export class SpedPendenciasService {
  constructor(private readonly dbp: DatabaseProvider, private readonly acesso: AcessoService) {}

  async analisar(dto: { dtini?: string; dtfim?: string; tipo?: string }): Promise<{ pendencias: PendenciaSped[] }> {
    const tipo = dto.tipo === 'piscofins' ? 'piscofins' : dto.tipo === 'fiscal' ? 'fiscal' : null;
    if (!tipo) throw new BusinessRuleError('SPED_PENDENCIAS_TIPO', { tipo: dto.tipo });
    const form = tipo === 'fiscal' ? 'FRMSPEDFISCAL' : 'FRMSPEDPISCOFINS';
    if (!(await this.acesso.possuiAcesso(form, form))) throw new ForbiddenActionError('SEM_PERMISSAO', { form, opcao: form });
    const d1 = String(dto.dtini ?? '');
    const d2 = String(dto.dtfim ?? '');
    if (!DATA.test(d1) || !DATA.test(d2) || d1 > d2) throw new BusinessRuleError('SPED_PERIODO_INVALIDO', { dtini: d1, dtfim: d2 });
    const emp = Number(currentTenant().empresaId);
    const db = this.dbp.forTenantRead() as AnyDB;
    const out: PendenciaSped[] = [];
    if (tipo === 'fiscal') {
      out.push(...(await this.cartaoSemAdministradora(db, d1, d2)));
      out.push(...(await this.administradoraSemCnpj(db, d1, d2, emp)));
    } else {
      out.push(...(await this.cfopSemPlanoContas(db, d1, d2, emp)));
      out.push(...(await this.produtosSemBaseCredito(db, d1, d2, emp)));
    }
    out.push(...(await this.nfeSemChave(db, d1, d2, emp)));
    out.push(...(await this.participantes(db, d1, d2, emp)));
    return { pendencias: out };
  }

  /** AnalisaCFOPSemPlanoContas (:170-224): o CFOP das notas do período (item ou cabeçalho) e os seis do cupom, sem conta contábil */
  private async cfopSemPlanoContas(db: AnyDB, d1: string, d2: string, emp: number): Promise<PendenciaSped[]> {
    const rows = (await sql<{ codcfop: string; descricao: string | null }>`
        SELECT DISTINCT codcfop, descricao FROM (
          SELECT c.codcfop, c.descricao FROM nf_prod np JOIN nf n ON n.codnf = np.codnf JOIN cfop c ON c.codcfop = np.cfop
           WHERE n.idempresa = ${emp} AND n.dtcontabil BETWEEN ${d1}::date AND ${d2}::date AND c.codplanocontas IS NULL
          UNION ALL
          SELECT c.codcfop, c.descricao FROM nf n JOIN cfop c ON c.codcfop = n.cfop
           WHERE n.idempresa = ${emp} AND n.dtcontabil BETWEEN ${d1}::date AND ${d2}::date AND c.codplanocontas IS NULL
          UNION ALL
          SELECT c.codcfop, c.descricao FROM cfop c WHERE c.codcfop IN ('5102', '5405', '5101', '5656', '5667', '5403') AND c.codplanocontas IS NULL
        ) x ORDER BY codcfop`.execute(db)).rows;
    return rows.map((r) => ({
      tipo: 'cfop_plc', descricao: 'CFOP não possui a conta contábil informada', codigo: String(r.codcfop).trim(), descricao_registro: String(r.descricao ?? ''),
      abrir: { cadastro: 'cfop', id: Number(String(r.codcfop).trim()) },
    }));
  }

  /** AnalisaNFeSemChave (:342-365): NF-e/CT-e (55/57) processada, numerada, sem chave de acesso */
  private async nfeSemChave(db: AnyDB, d1: string, d2: string, emp: number): Promise<PendenciaSped[]> {
    const rows = (await sql<{ codnf: number; tipo: string }>`
        SELECT n.codnf, n.tipo FROM nf n
         WHERE n.dtcontabil BETWEEN ${d1}::date AND ${d2}::date AND n.nronf <> '0' AND n.nronf IS NOT NULL
           AND n.modelo IN (55, 57) AND n.proc = 'S' AND n.nronf NOT IN ('000000') AND n.idempresa = ${emp} AND n.chavenfe IS NULL
         ORDER BY n.codnf`.execute(db)).rows;
    return rows.map((r) => ({
      tipo: 'nfe_sem_chave', descricao: 'NFE LANÇADA NÃO POSSUI CHAVE DE ACESSO.', codigo: String(r.codnf),
      descricao_registro: `Nota fiscal de : ${r.tipo === 'E' ? 'ENTRADA' : 'SAIDA'}`,
      abrir: { cadastro: 'nf', id: Number(r.codnf), tipo_nf: r.tipo === 'E' ? 'E' : 'S' },
    }));
  }

  /**
   * AnaliseCartaoSemAdministradora (:416-438): na GET_CARTAO (os cartões ainda não liberados), a operadora cuja administradora não é parceiro
   * (CODADM 0) no período — sem filtro de loja, como o SQL do legado (GetSQLCartaoSemAdministradora não usa a empresa)
   */
  private async cartaoSemAdministradora(db: AnyDB, d1: string, d2: string): Promise<PendenciaSped[]> {
    const rows = (await sql<{ codigo: number; descricao: string | null }>`
        SELECT DISTINCT c.codigo_operadora AS codigo, c.operadora AS descricao
          FROM rel_get_cartao c JOIN parceiros p ON c.codadm = p.codparceiro LEFT JOIN parceiros_end e ON e.codparceiro = p.codparceiro
         WHERE c.data BETWEEN ${d1}::date AND ${d2}::date AND c.codadm = 0
         ORDER BY 1`.execute(db)).rows;
    return rows.map((r) => ({
      tipo: 'operadora_sem_adm', descricao: 'PARCEIRO NÃO VINCULADO NO CADASTRO DO CARTÃO', codigo: String(r.codigo), descricao_registro: String(r.descricao ?? ''),
      abrir: { cadastro: 'operadora', id: Number(r.codigo) },
    }));
  }

  /** AnaliseAdministradoraSemCNPJ (:392-414): a administradora dos cartões da loja no período com endereço sem CNPJ */
  private async administradoraSemCnpj(db: AnyDB, d1: string, d2: string, emp: number): Promise<PendenciaSped[]> {
    const rows = (await sql<{ codigo: number; descricao: string | null }>`
        SELECT p.codparceiro AS codigo, p.razao AS descricao
          FROM rel_get_cartao c JOIN parceiros p ON c.codadm = p.codparceiro LEFT JOIN parceiros_end e ON e.codparceiro = p.codparceiro
         WHERE c.data BETWEEN ${d1}::date AND ${d2}::date AND c.codigo_empresa = ${emp} AND p.codparceiro <> 0 AND e.cnpj_cpf IS NULL
         GROUP BY p.codparceiro, p.razao, e.cnpj_cpf
         ORDER BY 1`.execute(db)).rows;
    // o "Corrigir" do legado abria o cadastro de OPERADORAS com o código do parceiro (o registro errado); o CNPJ se corrige no parceiro
    return rows.map((r) => ({
      tipo: 'administradora_sem_cnpj', descricao: 'CNPJ DO PARCEIRO(ADMINISTRADORA) INVÁLIDO', codigo: String(r.codigo), descricao_registro: String(r.descricao ?? ''),
      abrir: { cadastro: 'parceiro', id: Number(r.codigo) },
    }));
  }

  /**
   * os participantes do SPED (GetSQLCNPJCPFInvalido, :862-1016 — a mesma consulta para as três análises): o parceiro (cliente, fornecedor
   * ou transportadora) das notas que entram no SPED — o endereço da NOTA — e a administradora dos cartões da loja — o endereço ATIVO
   *  - AnaliseCNPJCPFInvalido (:440-478): CNPJ/CPF vazio (menos "AO CONSUMIDOR"), o texto pelo ramo (NF-e / endereço ativo);
   *  - AnaliseCodMunInvalido (:480-505): a cidade do endereço não está na tabela de cidades da UF dele;
   *  - AnaliseParceiroSemEndereco (:507-532): sem endereço (a administradora sem endereço ativo).
   */
  private async participantes(db: AnyDB, d1: string, d2: string, emp: number): Promise<PendenciaSped[]> {
    const rows = (await sql<{ codparceiro: number; razao: string | null; cnpj_cpf: string | null; cod_part: number | null; cidade: string | null; idcidade: number | null; tipo: string }>`
        SELECT DISTINCT codparceiro, razao, cnpj_cpf, cod_part, cidade, idcidade, tipo FROM (
          SELECT p.codparceiro, p.razao, e.cnpj_cpf, e.codend AS cod_part, e.cidade, gc.idcidade, 'NF' AS tipo
            FROM parceiros p
            JOIN nf x ON x.codparceiro = p.codparceiro
            JOIN parceiros_end pe ON pe.codend = x.codparceiro_end
            JOIN cfop c ON c.codcfop = x.cfop AND coalesce(c.nao_gera_sped, 'N') = 'N'
            LEFT JOIN parceiros_end e ON e.codend = x.codparceiro_end
            LEFT JOIN get_cidades gc ON gc.cidade = e.cidade AND gc.uf = e.uf
           WHERE x.dtcontabil BETWEEN ${d1}::date AND ${d2}::date AND x.idempresa = ${emp} AND x.cancelada = 'N' AND x.proc = 'S'
             AND ((x.modelo = 55 AND x.chavenfe IS NOT NULL AND coalesce(x.statusnfe, 'P') <> 'I') OR (x.modelo = 55 AND x.statusnfe = 'I')
                  OR x.modelo NOT IN (2, 3, 55))
             AND x.nronf NOT IN ('000000')
             AND (p.cli = 'S' OR p.frn = 'S' OR p.tra = 'S')
          UNION
          SELECT p.codparceiro, p.razao, e.cnpj_cpf, e.codend, e.cidade, gc.idcidade, 'CARTAO'
            FROM (SELECT coalesce(pa.codparceiro, 0) AS codadm
                    FROM cartao c
                    LEFT JOIN operadoras o  ON o.codoperadoras = c.codoperadora
                    LEFT JOIN operadoras ot ON ot.codoperadoras = CASE WHEN coalesce(o.codoperadorabase, 0) > 0 THEN o.codoperadorabase ELSE o.codoperadoras END
                    LEFT JOIN parceiros pa  ON pa.codparceiro = ot.codadm
                   WHERE (c.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${d1}::date AND ${d2}::date AND c.idempresa = ${emp}
                   GROUP BY 1) o
            JOIN parceiros p ON o.codadm = p.codparceiro
            LEFT JOIN parceiros_end e ON e.codparceiro = p.codparceiro AND e.ativado = 'S'
            LEFT JOIN get_cidades gc ON gc.cidade = e.cidade AND gc.uf = e.uf
        ) x ORDER BY codparceiro, razao, cnpj_cpf, cod_part, cidade`.execute(db)).rows;
    const out: PendenciaSped[] = [];
    for (const r of rows) {
      if (r.cnpj_cpf == null && String(r.razao ?? '') !== 'AO CONSUMIDOR') {
        out.push({
          tipo: 'cnpj_cpf_invalido',
          descricao: r.tipo === 'NF' ? 'PARCEIRO COM CNPJ_CPF INVALIDO NO ENDEREÇO REF. NA NFE' : 'PARCEIRO COM CNPJ_CPF INVALIDO NO ENDEREÇO ATIVO DO PARCEIRO',
          codigo: String(r.codparceiro), descricao_registro: `CodEnd : ${r.cod_part ?? ''} - Parc : ${r.razao ?? ''}`,
          abrir: { cadastro: 'parceiro', id: Number(r.codparceiro) },
        });
      }
    }
    for (const r of rows) {
      if (r.idcidade == null) {
        out.push({ tipo: 'cod_mun_invalido', descricao: 'CÓDIGO DO MUNICIPIO INVÁLIDO', codigo: String(r.codparceiro), descricao_registro: String(r.cidade ?? ''),
          abrir: { cadastro: 'parceiro', id: Number(r.codparceiro) } });
      }
    }
    for (const r of rows) {
      if (r.cod_part == null) {
        out.push({ tipo: 'parceiro_sem_endereco', descricao: 'PARCEIRO SEM ENDEREÇO ATIVO', codigo: String(r.codparceiro), descricao_registro: 'ENDEREÇO ATIVO NÃO INFORMADO',
          abrir: { cadastro: 'parceiro', id: Number(r.codparceiro) } });
      }
    }
    return out;
  }

  /**
   * AnaliseProdutosIDBaseCreditoIsento (:534-571, GetSQLIDBaseCreditoIsento :1018-1094): os produtos vendidos (cupom) e faturados (NF de
   * saída) pelas lojas do mesmo CNPJ raiz no período com CST de PIS de saída 04/05/06/08/09 e sem a base de crédito da isenção (a natureza
   * da receita do M410/M810) — a do produto (PRODUTOS.IDTABELA) se for da situação dele, senão a primeira da situação; o CST 08 sem
   * nenhuma vira 999 ("outras receitas isentas"). Na NF o CST vem do CFOP: 5927/5929 → 08; os de venda e os do PC_CONFIG → o da situação;
   * os outros → 08.
   */
  private async produtosSemBaseCredito(db: AnyDB, d1: string, d2: string, emp: number): Promise<PendenciaSped[]> {
    const raiz = (await sql<{ r: string }>`SELECT left(regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g'), 8) AS r FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0]?.r ?? '';
    const rows = (await sql<{ codproduto: number; descricao: string | null; cst_pis_sai: number | null }>`
        SELECT * FROM (
          SELECT codproduto, descricao, cst_pis_sai,
                 CASE WHEN idbasecreditoisento IS NULL AND cst_pis_sai = 8 THEN 999 ELSE idbasecreditoisento END AS idbasecreditoisento
            FROM (
              SELECT v.codproduto, p.descricao, pc.cst_pis_sai,
                     CASE WHEN i.idbasecreditoisento IS NULL
                            OR i.idbasecreditoisento NOT IN (SELECT o.idbasecreditoisento FROM pc_tipocreditoisento o WHERE p.idpiscofins = o.idpiscofins)
                          THEN (SELECT o.idbasecreditoisento FROM pc_tipocreditoisento o WHERE o.idpiscofins = coalesce(v.idpiscofins, p.idpiscofins) LIMIT 1)
                          ELSE i.idbasecreditoisento END AS idbasecreditoisento
                FROM vendas v
                JOIN produtos p ON p.idproduto = v.codproduto
                JOIN piscofins pc ON pc.idpiscofins = coalesce(v.idpiscofins, p.idpiscofins)
                LEFT JOIN pc_tipocreditoisento i ON i.idtabela = p.idtabela
                JOIN empresas e ON e.idempresa = v.idempresa
               WHERE (v.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${d1}::date AND ${d2}::date
                 AND coalesce(v.cancelado, 'N') = 'N'
                 AND left(regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g'), 8) = ${raiz}
                 AND pc.cst_pis_sai IN (4, 5, 6, 8, 9)
              UNION ALL
              SELECT codproduto, descricao, cst_pis_sai, idbasecreditoisento FROM (
                SELECT np.codproduto, np.descricao,
                       CAST(CASE WHEN np.cfop IN ('5927', '5929') THEN 8
                                 ELSE CASE WHEN np.cfop IN ('5202', '6202', '5411', '6411', '5102', '6102', '5403', '6403')
                                             OR np.cfop IN (SELECT x.cfop FROM pc_config x)
                                           THEN cpc.cst_pis_sai ELSE 8 END END AS numeric(10, 0)) AS cst_pis_sai,
                       CASE WHEN i.idbasecreditoisento IS NULL
                              OR i.idbasecreditoisento NOT IN (SELECT o.idbasecreditoisento FROM pc_tipocreditoisento o WHERE p.idpiscofins = o.idpiscofins)
                            THEN (SELECT o.idbasecreditoisento FROM pc_tipocreditoisento o WHERE o.idpiscofins = coalesce(np.idpiscofins, p.idpiscofins) LIMIT 1)
                            ELSE i.idbasecreditoisento END AS idbasecreditoisento
                  FROM nf_prod np
                  LEFT JOIN produtos p ON p.idproduto = np.codproduto
                  LEFT JOIN piscofins cpc ON cpc.idpiscofins = coalesce(np.idpiscofins, p.idpiscofins)
                  LEFT JOIN pc_tipocreditoisento i ON i.idtabela = p.idtabela
                  JOIN nf n ON n.codnf = np.codnf
                  LEFT JOIN empresas e ON e.idempresa = n.idempresa
                 WHERE n.dtcontabil BETWEEN ${d1}::date AND ${d2}::date
                   AND n.nronf <> '0' AND n.nronf IS NOT NULL AND n.modelo NOT IN (22, 21, 6, 2, 57, 7, 8, 3) AND n.proc = 'S'
                   AND n.nronf NOT IN ('000000')
                   AND left(regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g'), 8) = ${raiz}
                   AND n.tipo = 'S' AND coalesce(n.cancelada, 'N') = 'N'
              ) nfp
            ) u
           WHERE cst_pis_sai IN (4, 5, 6, 8, 9)
           GROUP BY codproduto, descricao, cst_pis_sai, idbasecreditoisento
        ) z
        WHERE cst_pis_sai IS NULL OR idbasecreditoisento IS NULL
        ORDER BY cst_pis_sai, codproduto`.execute(db)).rows;
    return rows.map((r) => ({
      tipo: r.cst_pis_sai == null ? 'produto_sem_piscofins' : 'produto_sem_base_credito',
      descricao: r.cst_pis_sai == null ? 'IDPISCOFINS NÃO INFORMADO NO CADASTRO DO PRODUTO' : 'IDBASECREDITOISENTO NÃO VINCULADO AO IDPISCOFINS',
      codigo: String(r.codproduto), descricao_registro: String(r.descricao ?? ''),
      abrir: { cadastro: 'produto', id: Number(r.codproduto) },
    }));
  }
}
