import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { FiguraFiscalConsultaDto, FiguraFiscalDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * CADASTRO DE FIGURAS FISCAIS (`FRMCADFIGURASFISCAIS`). **6 acessos, 2 operadores.** Dossiê:
 * `uCadFigurasFiscais.md`. Migration 267.
 *
 * O catálogo que o `indexador_tributario` multi-campo aponta (mig 034) — o caminho tributário que 4 das 5
 * empresas usam (`EMPRESAS.FIGURAFISCAL='O'`). No cliente são **16.838 figuras**, todas ativas, mas só
 * **11 aparecem no indexador**: o resto é histórico de integração. A tela do legado edita um campo só
 * (`DESCFIGURAFISCAL`); aqui vem com o código reduzido, o uso no indexador e exclusão lógica.
 */
@Injectable()
export class FiguraFiscalService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private op() { return currentTenant().operadorId ?? null; }

  private sel = sql`
      SELECT f.codfigurafiscal, f.descfigurafiscal, f.codreduzido, coalesce(f.indr, 'I') AS indr,
             (SELECT count(*) FROM indexador_tributario i WHERE i.codfigurafiscal = f.codfigurafiscal) AS regras
        FROM figura_fiscal f`;

  private linha(r: Record<string, unknown>) {
    return {
      codfigurafiscal: Number(r.codfigurafiscal), descfigurafiscal: r.descfigurafiscal,
      codreduzido: r.codreduzido ?? null, indr: r.indr, regras: Number(r.regras ?? 0),
    };
  }

  async buscar(q: FiguraFiscalConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const termo = (q.q ?? '').trim().toUpperCase();
    const rows = (await sql<Record<string, unknown>>`${this.sel}
       WHERE coalesce(f.indr, 'I') <> 'E'
         AND (${termo}::text = '' OR upper(f.descfigurafiscal) LIKE ${'%' + termo + '%'} OR f.codfigurafiscal::text = ${termo})
         AND (NOT ${q.somenteEmUso}::boolean OR EXISTS (SELECT 1 FROM indexador_tributario i WHERE i.codfigurafiscal = f.codfigurafiscal))
       ORDER BY f.codfigurafiscal
       LIMIT ${q.limite}`.execute(db)).rows;
    const tot = (await sql<Record<string, unknown>>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM indexador_tributario i WHERE i.codfigurafiscal = f.codfigurafiscal)) AS em_uso
        FROM figura_fiscal f WHERE coalesce(f.indr, 'I') <> 'E'`.execute(db)).rows[0] ?? {};
    return {
      itens: rows.map((r) => this.linha(r)),
      total: Number(tot.total ?? 0), emUso: Number(tot.em_uso ?? 0), truncado: rows.length >= q.limite,
    };
  }

  async obter(id: number) {
    const r = (await sql<Record<string, unknown>>`${this.sel} WHERE f.codfigurafiscal = ${id}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (!r) throw new BusinessRuleError('FIGURA_NAO_ENCONTRADA', { codfigurafiscal: id });
    return this.linha(r);
  }

  async criar(b: FiguraFiscalDto) {
    const r = (await sql<{ codfigurafiscal: unknown }>`
      INSERT INTO figura_fiscal (descfigurafiscal, codreduzido, indr, usultalteracao, dtultimalteracao)
      VALUES (${b.descfigurafiscal}, ${b.codreduzido ?? null}, 'I', ${this.op()}, now())
      RETURNING codfigurafiscal`.execute(this.dbp.forTenant() as AnyDB)).rows[0];
    return this.obter(Number(r.codfigurafiscal));
  }

  async atualizar(id: number, b: FiguraFiscalDto) {
    await this.obter(id);
    await sql`UPDATE figura_fiscal SET descfigurafiscal = ${b.descfigurafiscal}, codreduzido = ${b.codreduzido ?? null},
                     usultalteracao = ${this.op()}, dtultimalteracao = now()
               WHERE codfigurafiscal = ${id}`.execute(this.dbp.forTenant() as AnyDB);
    return this.obter(id);
  }

  /** exclusão lógica; figura EM USO pelo indexador não sai — a regra tributária ficaria órfã. */
  async excluir(id: number) {
    const f = await this.obter(id);
    if (f.regras > 0) throw new BusinessRuleError('FIGURA_EM_USO', { codfigurafiscal: id, regras: f.regras });
    await sql`UPDATE figura_fiscal SET indr = 'E', indr_usuario = ${this.op()}, indr_data = now() WHERE codfigurafiscal = ${id}`
      .execute(this.dbp.forTenant() as AnyDB);
    return { codfigurafiscal: id, indr: 'E' };
  }
}
