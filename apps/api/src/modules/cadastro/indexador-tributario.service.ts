import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { FiltroIndexadorDto, IndexadorTributarioDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

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

  async criar(dto: IndexadorTributarioDto, operador: number | null): Promise<{ codindexadortributario: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
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
      return { codindexadortributario: Number(r.codindexadortributario) };
    });
  }

  async atualizar(cod: number, dto: IndexadorTributarioDto, operador: number | null): Promise<{ codindexadortributario: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
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
  private async assertSemDuplicata(trx: AnyDB, dto: IndexadorTributarioDto, cod: number | null): Promise<void> {
    const igual = (await sql<{ codindexadortributario: number }>`
      SELECT codindexadortributario FROM indexador_tributario
       WHERE coalesce(indr, 'I') <> 'E'
         AND tp_cadastro = ${dto.tp_cadastro}
         AND coalesce(codfigurafiscal, -1) = coalesce(${dto.codfigurafiscal ?? null}::int, -1)
         AND coalesce(origem, '~')   = coalesce(${dto.origem ?? null}::text, '~')
         AND coalesce(destino, '~')  = coalesce(${dto.destino ?? null}::text, '~')
         AND coalesce(codcfop, -1)   = coalesce(${dto.codcfop ?? null}::int, -1)
         AND coalesce(codbarra, '~') = coalesce(${dto.codbarra ?? null}::text, '~')
         AND coalesce(ncm, '~')      = coalesce(${dto.ncm ?? null}::text, '~')
         AND coalesce(codparceiro, -1) = coalesce(${dto.codparceiro ?? null}::int, -1)
         AND (${cod}::int IS NULL OR codindexadortributario <> ${cod}::int)
    `.execute(trx)).rows[0];
    if (igual) {
      throw new BusinessRuleError('INDEXADOR_DUPLICADO', { existente: Number(igual.codindexadortributario) });
    }
  }
}
