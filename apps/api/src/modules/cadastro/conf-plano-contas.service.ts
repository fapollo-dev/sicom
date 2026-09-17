import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConfPlanoContasDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * CONFIGURAÇÕES DO PLANO DE CONTAS (`FRMCADCONFPLANOCONTAS`). **45 acessos, 2 operadores.**
 * Migration 237 (a tabela veio nas 103 e 108).
 *
 * Duas coisas: a **máscara** — quantos dígitos cada nível do código tem — e as **contas padrão** por natureza
 * de parceiro, que um fornecedor ou cliente sem conta própria herda na hora de contabilizar.
 *
 * ⚠️ **a máscara do cliente é `1,1,2,2,5`**, e isso foi medido no plano inteiro: **10.653 contas** têm 5
 * dígitos no último nível contra **297** com 4. O seed antigo dizia 4, e com ele o auto-código sugeriria um
 * código curto em 97,3% dos casos.
 *
 * ⚠️ **a máscara não valida o que já existe** — ela SUGERE o próximo código. O plano real tem contas dos dois
 * formatos (as 297 antigas), e uma validação rígida transformaria cadastro histórico em erro.
 */
@Injectable()
export class ConfPlanoContasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async obter(tipo = 'E'): Promise<Record<string, unknown>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = (await sql<Record<string, unknown>>`
      SELECT * FROM config_plano_contas WHERE tipo = ${tipo}
    `.execute(db)).rows[0];
    if (!c) throw new BusinessRuleError('CONFIG_PLANO_NAO_ENCONTRADA', { tipo });

    // as contas padrão, com a descrição — é o que o operador confere antes de trocar
    const codigos = ['for', 'cli', 'cxa', 'bco'].flatMap((n) => [
      Number(c[`codcontasintetica_${n}`] ?? 0), Number(c[`codcontaanalitica_${n}`] ?? 0),
    ]).filter((x) => x > 0);
    const contas = codigos.length
      ? (await sql<Record<string, unknown>>`
          SELECT codplanocontas, descricao, tipo AS classe FROM plano_contas
           WHERE codplanocontas = ANY(${codigos}::int[])
        `.execute(db)).rows
      : [];

    // quantas contas o plano tem em cada formato — a prova viva da máscara
    const formatos = (await sql<{ digitos: number; n: number }>`
      SELECT length(split_part(codiexpandido, '.', 5))::int AS digitos, count(*)::int AS n
        FROM plano_contas
       WHERE codiexpandido LIKE '%.%.%.%.%'
       GROUP BY 1 ORDER BY 1
    `.execute(db)).rows.filter((r) => Number(r.digitos) > 0);

    return {
      ...c,
      niveis: String(c.mascara ?? '').split(',').map(Number).filter((n) => n > 0),
      contas,
      formatos,
    };
  }

  async gravar(dto: ConfPlanoContasDto, operador: number | null): Promise<{ tipo: string }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      // toda conta apontada tem de existir — e ser ANALÍTICA quando é a que recebe lançamento
      const pares: Array<[string, number | null | undefined, boolean]> = [
        ['codcontasintetica_for', dto.codcontasintetica_for, false],
        ['codcontaanalitica_for', dto.codcontaanalitica_for, true],
        ['codcontasintetica_cli', dto.codcontasintetica_cli, false],
        ['codcontaanalitica_cli', dto.codcontaanalitica_cli, true],
        ['codcontasintetica_cxa', dto.codcontasintetica_cxa, false],
        ['codcontaanalitica_cxa', dto.codcontaanalitica_cxa, true],
        ['codcontasintetica_bco', dto.codcontasintetica_bco, false],
        ['codcontaanalitica_bco', dto.codcontaanalitica_bco, true],
      ];
      for (const [campo, cod, exigeAnalitica] of pares) {
        if (cod == null) continue;
        const c = (await sql<{ tipo: string | null }>`
          SELECT tipo FROM plano_contas WHERE codplanocontas = ${cod}
        `.execute(trx)).rows[0];
        if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { campo, conta: cod });
        // ⚠️ conta SINTÉTICA não recebe lançamento: apontar uma como padrão faria a contabilização falhar
        // no momento do lançamento, longe de quem configurou
        if (exigeAnalitica && String(c.tipo ?? 'A').toUpperCase() === 'S') {
          throw new BusinessRuleError('CONTA_PADRAO_NAO_ANALITICA', { campo, conta: cod });
        }
      }

      const mascara = dto.niveis.join(',');
      const r = await sql`
        UPDATE config_plano_contas
           SET mascara = ${mascara}, descricao = ${dto.descricao ?? null},
               codcontasintetica_for = ${dto.codcontasintetica_for ?? null},
               codcontaanalitica_for = ${dto.codcontaanalitica_for ?? null},
               codcontasintetica_cli = ${dto.codcontasintetica_cli ?? null},
               codcontaanalitica_cli = ${dto.codcontaanalitica_cli ?? null},
               codcontasintetica_cxa = ${dto.codcontasintetica_cxa ?? null},
               codcontaanalitica_cxa = ${dto.codcontaanalitica_cxa ?? null},
               codcontasintetica_bco = ${dto.codcontasintetica_bco ?? null},
               codcontaanalitica_bco = ${dto.codcontaanalitica_bco ?? null}
         WHERE tipo = ${dto.tipo}
      `.execute(trx);
      if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('CONFIG_PLANO_NAO_ENCONTRADA', { tipo: dto.tipo });
      void operador;
      return { tipo: dto.tipo };
    });
  }
}
