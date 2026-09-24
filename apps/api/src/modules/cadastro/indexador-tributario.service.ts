import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { FiltroIndexadorDto, IndexadorTributarioDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { gravarLogDaLinha, type CampoLog } from '../../shared/log/registro-log';

type AnyDB = Kysely<any>;

/** a LOG "Indexador Tributário" (o form-base, `TLog.GravaLog` com o DataSet): os campos na ordem do legado (lida na produção,
 *  21/09/2026 — 5.030 Inseriu e 183 Alterou desde 2025). O legado chama a alíquota de destino de ALIQUOTA. */
const CAMPOS_LOG: readonly CampoLog[] = [
  'codindexadortributario', 'tp_cadastro', 'codparceiro', 'origem', 'destino', 'codcfop', 'codfigurafiscal', 'operacao', ['ALIQUOTA', 'aliquota_dest'],
  'icm_fonte', 'reducao', 'redcom', 'mva', 'st_externo', 'codbarra', 'aliquota_fonte_lei_3166', 'ncm', 'aliquota_reduzida_lei_3166', 'cnpj_cpf',
  'considerar_desconto_calc_st', 'tp_figura', 'aliquota_fem', 'basesemreducao', 'base_st_com_reducao',
];
/** os CFOPs em que o MVA vale (`EnableDisableMVA`, :800) — e os de remessa, só com a operação C, F ou Z */
const CFOPS_MVA = ['1403', '2403', '1401', '2401', '1407', '2407', '1411', '2411', '5403', '6403', '1949', '2949', '5411', '6411', '5202', '6202', '1124',
  '1923', '2923', '1406', '2406'];
const CFOPS_REMESSA_MVA = ['1910', '2910', '1911', '2911', '1902', '2902'];
const linha = async (trx: AnyDB, cod: number) => (await sql<Record<string, unknown>>`SELECT * FROM indexador_tributario WHERE codindexadortributario = ${cod}`.execute(trx)).rows[0];

/**
 * CADASTRO DO INDEXADOR TRIBUTÁRIO (`FRMCADINDEXADORTRIBUTARIO`). **23 acessos, 4 operadores.**
 * Dossiê: `uCadIndexadorTributario.md`. Migration 248.
 *
 * Para cada combinação de **figura fiscal · tipo · origem · destino · CFOP** — e, dentro dela, **EAN, NCM ou
 * fornecedor** —, qual alíquota, MVA e redução aplicar. É de onde sai o ICMS-ST de toda entrada de nota, e o
 * motor que o consome já existe (`tributacao.repository.ts`, resolução multi-chave com desempate por
 * especificidade).
 *
 * ── A chave é composta, e o dado não deixa dúvida ─────────────────────────────────────────────────────
 * **12.053 indexadores** para apenas **1.075 NCMs distintos**: **748 NCMs têm mais de um**, e o `19053100`
 * tem **285**. Buscar "o indexador do NCM" não é uma pergunta bem-formada — por isso a resolução filtra pela
 * figura completa e só então desempata entre os candidatos.
 *
 * ⚠️ **um indexador sem nenhum discriminador vira curinga universal**: a resolução usa OR-null (campo nulo
 * casa com qualquer valor), então uma linha com EAN, NCM e fornecedor todos nulos casaria com tudo dentro da
 * figura e venceria por falta de concorrente em muitos casos. O cadastro exige ao menos um dos três.
 *
 * ⚠️ **exclusão é lógica** (`INDR = 'E'`), como no legado — 230 das 12.053 linhas já estão assim. O motor
 * fiscal filtra `coalesce(indr,'I') <> 'E'`, então apagar de verdade mudaria o passado das notas já lançadas.
 */
@Injectable()
export class IndexadorTributarioService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: FiltroIndexadorDto): Promise<Array<Record<string, unknown>>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT i.*, coalesce(p.razao, '') AS parceiro, c.descricao AS cfop_descricao,
             coalesce(o.nome, '') AS usuario
        FROM indexador_tributario i
        LEFT JOIN parceiros p  ON p.codparceiro = i.codparceiro
        LEFT JOIN cfop c       ON c.codcfop = i.codcfop::text
        LEFT JOIN operadores o ON o.codoperador = i.usultalteracao
       WHERE (${f.incluirExcluidos} = 'S' OR coalesce(i.indr, 'I') <> 'E')
         AND (${f.ncm ?? null}::text IS NULL OR i.ncm = ${f.ncm ?? null}::text)
         AND (${f.codbarra ?? null}::text IS NULL OR i.codbarra = ${f.codbarra ?? null}::text)
         AND (${f.codparceiro ?? null}::int IS NULL OR i.codparceiro = ${f.codparceiro ?? null}::int)
         AND (${f.codcfop ?? null}::int IS NULL OR i.codcfop = ${f.codcfop ?? null}::int)
         AND (${f.tp_cadastro ?? null}::text IS NULL OR i.tp_cadastro = ${f.tp_cadastro ?? null}::text)
       ORDER BY i.ncm NULLS LAST, i.codbarra NULLS LAST, i.codindexadortributario
       LIMIT ${f.limite}
    `.execute(db)).rows;
  }

  /**
   * as validações do Gravar do legado (`btnGravarClick`, uCadIndexadorTributario.pas:273-370), na ordem:
   * - os obrigatórios (UF de origem e destino, tipo de cadastro, operação, figura e CFOP): "verifique os campos obrigatórios";
   * - CFOP x403/x401 exige MVA > 0, salvo empresa do Simples ou operação F (CST 060);
   * - o MVA só vale nos CFOPs de ST (e nos de remessa com operação C/F/Z) — fora deles, "Não informar MVA para itens tributados!";
   * - CPF (≤ 11 dígitos) com alíquota fonte: o legado zera e avisa — aqui zera;
   * - o tipo da figura vem da CLASSIFICACAO do parceiro (a tela o trava).
   * Devolve o dto ajustado (MVA/alíquota fonte/tipo da figura).
   */
  private async normalizar(trx: AnyDB, dto: IndexadorTributarioDto): Promise<IndexadorTributarioDto> {
    if (!dto.origem || !dto.destino || !dto.tp_cadastro || !dto.operacao || dto.codfigurafiscal == null || dto.codcfop == null) {
      throw new BusinessRuleError('INDEXADOR_CAMPOS_OBRIGATORIOS');
    }
    const cfop = String(dto.codcfop);
    const mvaHabilitado = CFOPS_MVA.includes(cfop) || (CFOPS_REMESSA_MVA.includes(cfop) && ['C', 'F', 'Z'].includes(String(dto.operacao)));
    if (['403', '401'].includes(cfop.slice(1, 4)) && !(Number(dto.mva ?? 0) > 0) && String(dto.operacao) !== 'F') {
      const classfiscal = String((await sql<{ c: string | null }>`SELECT classfiscal AS c FROM empresas WHERE idempresa = ${this.emp()}`.execute(trx)).rows[0]?.c ?? '');
      if (classfiscal.toUpperCase() !== 'SN') throw new BusinessRuleError('INDEXADOR_MVA_OBRIGATORIO');
    }
    if (!mvaHabilitado && Number(dto.mva ?? 0) > 0) throw new BusinessRuleError('INDEXADOR_MVA_NAO_PERMITIDO');
    const cnpj = String(dto.cnpj_cpf ?? '').replace(/\D/g, '');
    const icmFonte = cnpj && cnpj.length <= 11 && Number(dto.icm_fonte ?? 0) > 0 ? 0 : dto.icm_fonte;
    let tpFigura: IndexadorTributarioDto['tp_figura'] = dto.tp_figura ?? null;
    if (dto.codparceiro != null) {
      const c = (await sql<{ c: string | null }>`SELECT classificacao AS c FROM parceiros WHERE codparceiro = ${dto.codparceiro}`.execute(trx)).rows[0];
      if (!c) throw new BusinessRuleError('INDEXADOR_PARCEIRO_INEXISTENTE');
      tpFigura = (String(c.c ?? '').trim().toUpperCase() || null) as IndexadorTributarioDto['tp_figura'];
    }
    return { ...dto, mva: mvaHabilitado ? dto.mva ?? 0 : 0, icm_fonte: icmFonte ?? 0, tp_figura: tpFigura };
  }

  async criar(dtoEntrada: IndexadorTributarioDto, operador: number | null): Promise<{ codindexadortributario: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const dto = await this.normalizar(trx, dtoEntrada);
      await this.assertSemDuplicata(trx, dto, null);
      const r = (await sql<{ codindexadortributario: number }>`
        INSERT INTO indexador_tributario
          (tp_cadastro, tp_figura, codfigurafiscal, origem, destino, codcfop, operacao,
           codbarra, ncm, codparceiro, cnpj_cpf, aliquota_dest, icm_fonte, mva, redcom, reducao,
           aliquota_fem, st_externo, basesemreducao, base_st_com_reducao, aliquota_fonte_lei_3166,
           aliquota_reduzida_lei_3166, considerar_desconto_calc_st, usultalteracao, dtultimalteracao, dtcadastro)
        VALUES (${dto.tp_cadastro}, ${dto.tp_figura}, ${dto.codfigurafiscal ?? null}, ${dto.origem ?? null},
                ${dto.destino ?? null}, ${dto.codcfop ?? null}, ${dto.operacao ?? null},
                ${dto.codbarra ?? null}, ${dto.ncm ?? null}, ${dto.codparceiro ?? null}, ${dto.cnpj_cpf ?? null},
                ${dto.aliquota_dest}, ${dto.icm_fonte}, ${dto.mva}, ${dto.redcom}, ${dto.reducao},
                ${dto.aliquota_fem}, ${dto.st_externo}, ${dto.basesemreducao ?? null},
                ${dto.base_st_com_reducao ?? null}, ${dto.aliquota_fonte_lei_3166 ?? null},
                ${dto.aliquota_reduzida_lei_3166 ?? null}, ${dto.considerar_desconto_calc_st ?? null},
                ${operador}, now(), now())
        RETURNING codindexadortributario
      `.execute(trx)).rows[0];
      const cod = Number(r.codindexadortributario);
      await gravarLogDaLinha(trx, { acao: 'Inseriu', formulario: 'Indexador Tributário', tabela: 'INDEXADOR_TRIBUTARIO', chave: 'CODINDEXADORTRIBUTARIO', valor: cod,
        idempresa: this.emp(), campos: CAMPOS_LOG, depois: (await linha(trx, cod)) ?? {} });
      return { codindexadortributario: cod };
    });
  }

  async atualizar(cod: number, dtoEntrada: IndexadorTributarioDto, operador: number | null): Promise<{ codindexadortributario: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const antes = await linha(trx, cod);
      if (!antes) throw new BusinessRuleError('INDEXADOR_NAO_ENCONTRADO', { cod });
      // "Não é possível alterar o registro, pois ele foi desativado." (:443)
      if (String(antes.indr ?? 'I') === 'E') throw new BusinessRuleError('INDEXADOR_DESATIVADO', { cod });
      const dto = await this.normalizar(trx, dtoEntrada);
      await this.assertSemDuplicata(trx, dto, cod);
      const r = await sql`
        UPDATE indexador_tributario
           SET tp_cadastro = ${dto.tp_cadastro}, tp_figura = ${dto.tp_figura},
               codfigurafiscal = ${dto.codfigurafiscal ?? null}, origem = ${dto.origem ?? null},
               destino = ${dto.destino ?? null}, codcfop = ${dto.codcfop ?? null},
               operacao = ${dto.operacao ?? null}, codbarra = ${dto.codbarra ?? null},
               ncm = ${dto.ncm ?? null}, codparceiro = ${dto.codparceiro ?? null},
               cnpj_cpf = ${dto.cnpj_cpf ?? null}, aliquota_dest = ${dto.aliquota_dest},
               icm_fonte = ${dto.icm_fonte}, mva = ${dto.mva}, redcom = ${dto.redcom},
               reducao = ${dto.reducao}, aliquota_fem = ${dto.aliquota_fem}, st_externo = ${dto.st_externo},
               basesemreducao = ${dto.basesemreducao ?? null},
               base_st_com_reducao = ${dto.base_st_com_reducao ?? null},
               aliquota_fonte_lei_3166 = ${dto.aliquota_fonte_lei_3166 ?? null},
               aliquota_reduzida_lei_3166 = ${dto.aliquota_reduzida_lei_3166 ?? null},
               considerar_desconto_calc_st = ${dto.considerar_desconto_calc_st ?? null},
               usultalteracao = ${operador}, dtultimalteracao = now()
         WHERE codindexadortributario = ${cod}
      `.execute(trx);
      if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('INDEXADOR_NAO_ENCONTRADO', { cod });
      await gravarLogDaLinha(trx, { acao: 'Alterou', formulario: 'Indexador Tributário', tabela: 'INDEXADOR_TRIBUTARIO', chave: 'CODINDEXADORTRIBUTARIO', valor: cod,
        idempresa: this.emp(), campos: CAMPOS_LOG, antes, depois: (await linha(trx, cod)) ?? {} });
      return { codindexadortributario: cod };
    });
  }

  /**
   * ⚠️ exclusão LÓGICA (`INDR = 'E'`), como no legado: o motor fiscal filtra `coalesce(indr,'I') <> 'E'`, e
   * apagar de verdade mudaria a base de cálculo das notas já lançadas.
   */
  async excluir(cod: number, operador: number | null): Promise<{ codindexadortributario: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const r = await sql`
      UPDATE indexador_tributario
         SET indr = 'E', indr_usuario = ${operador}, indr_data = now()
       WHERE codindexadortributario = ${cod} AND coalesce(indr, 'I') <> 'E'
    `.execute(db);
    if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('INDEXADOR_NAO_ENCONTRADO', { cod });
    return { codindexadortributario: cod };
  }

  /**
   * dois indexadores com a MESMA figura e os MESMOS discriminadores tornam o desempate arbitrário — a
   * resolução ordena por especificidade e pega o primeiro, então o segundo nunca seria usado.
   */
  /**
   * "Indexador ja cadastrado com estes parâmetros. Verifique!" (`btnGravarClick`, :336-370): o legado só recusa o indexador IGUAL
   * em TODOS os campos (figura, tipos, parceiro, UFs, CFOP, operação, alíquotas, MVA, reduções, EAN, NCM, CNPJ, FEM…), comparando
   * nulo com nulo. ⚠️ O Apollo recusava pela figura + discriminadores (sem nem olhar a operação) — e a produção tem 159 grupos
   * (330 indexadores) iguais nesses campos e diferentes nos valores: editar qualquer um deles era recusado.
   */
  private async assertSemDuplicata(trx: AnyDB, dto: IndexadorTributarioDto, cod: number | null): Promise<void> {
    const eq = (col: string, v: unknown) => sql`${sql.ref(col)} IS NOT DISTINCT FROM ${v === '' || v === undefined ? null : v}`;
    const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
    const igual = (await sql<{ codindexadortributario: number }>`
      SELECT codindexadortributario FROM indexador_tributario
       WHERE coalesce(indr, 'I') <> 'E'
         AND ${eq('tp_figura', dto.tp_figura ?? null)} AND ${eq('tp_cadastro', dto.tp_cadastro)} AND codparceiro IS NOT DISTINCT FROM ${num(dto.codparceiro)}::int
         AND ${eq('origem', dto.origem ?? null)} AND ${eq('destino', dto.destino ?? null)} AND codcfop IS NOT DISTINCT FROM ${num(dto.codcfop)}::int
         AND codfigurafiscal IS NOT DISTINCT FROM ${num(dto.codfigurafiscal)}::int AND ${eq('operacao', dto.operacao ?? null)}
         AND aliquota_dest IS NOT DISTINCT FROM ${num(dto.aliquota_dest)}::numeric AND icm_fonte IS NOT DISTINCT FROM ${num(dto.icm_fonte)}::numeric
         AND redcom IS NOT DISTINCT FROM ${num(dto.redcom)}::numeric AND mva IS NOT DISTINCT FROM ${num(dto.mva)}::numeric
         AND ${eq('st_externo', dto.st_externo ?? null)} AND reducao IS NOT DISTINCT FROM ${num(dto.reducao)}::numeric
         AND ${eq('codbarra', dto.codbarra ?? null)} AND ${eq('aliquota_fonte_lei_3166', dto.aliquota_fonte_lei_3166 ?? null)} AND ${eq('ncm', dto.ncm ?? null)}
         AND aliquota_reduzida_lei_3166 IS NOT DISTINCT FROM ${num(dto.aliquota_reduzida_lei_3166)}::numeric AND coalesce(cnpj_cpf, '') = ${dto.cnpj_cpf ?? ''}
         AND aliquota_fem IS NOT DISTINCT FROM ${num(dto.aliquota_fem)}::numeric
         AND (${cod}::int IS NULL OR codindexadortributario <> ${cod}::int)
       LIMIT 1
    `.execute(trx)).rows[0];
    if (igual) {
      throw new BusinessRuleError('INDEXADOR_DUPLICADO', { existente: Number(igual.codindexadortributario) });
    }
  }
}
