import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { CestConsultaDto, CestDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * CADASTRO DE CEST (`FRMCADCEST`). **11 acessos, 3 operadores.** Dossiê: `uCadCest.md`. Migration 260.
 *
 * A tabela CEST × NCM (19.109 linhas no cliente, 896 CESTs distintos) que `produtos.cest` aponta e que vai
 * para a NF-e e o SPED. A tela do legado é um CadMaster de três campos (CEST, DESCRIÇÃO, NCM) sem validação
 * nenhuma — e **248 produtos apontam um CEST que não existe na tabela** (mais 4 fora do formato de 7 dígitos).
 * `semCadastro()` lista esses produtos; `excluir()` recusa apagar o último NCM de um CEST que produtos usam.
 */
@Injectable()
export class CestService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private op() { return currentTenant().operadorId ?? null; }

  private linha(r: Record<string, unknown>) {
    return {
      codcest: Number(r.codcest), cest: String(r.cest), ncm: r.ncm ?? null, descricao: r.descricao,
      seguimento: r.seguimento ?? null, item: r.item ?? null, anexoxxvii: r.anexoxxvii ?? null,
      produtos: Number(r.produtos ?? 0),
    };
  }

  private sel = sql`
      SELECT c.codcest, c.cest, c.ncm, c.descricao, c.seguimento, c.item, c.anexoxxvii,
             (SELECT count(*) FROM produtos p WHERE p.cest = c.cest) AS produtos
        FROM cest c`;

  /** por prefixo de CEST/NCM quando o termo é numérico; por trecho da descrição quando não é. */
  async buscar(q: CestConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const termo = (q.q ?? '').trim();
    const digitos = /^\d+$/.test(termo);
    const rows = (await sql<Record<string, unknown>>`${this.sel}
       WHERE (${termo}::text = ''
              OR (${digitos}::boolean AND (c.cest LIKE ${termo + '%'} OR c.ncm LIKE ${termo + '%'}))
              OR (NOT ${digitos}::boolean AND upper(c.descricao) LIKE ${'%' + termo.toUpperCase() + '%'}))
       ORDER BY c.cest, c.ncm
       LIMIT ${q.limite}`.execute(db)).rows;
    const total = Number((await sql<{ n: unknown }>`SELECT count(*) AS n FROM cest`.execute(db)).rows[0]?.n ?? 0);
    return { itens: rows.map((r) => this.linha(r)), total, truncado: rows.length >= q.limite };
  }

  async obter(id: number) {
    const r = (await sql<Record<string, unknown>>`${this.sel} WHERE c.codcest = ${id}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (!r) throw new BusinessRuleError('CEST_NAO_ENCONTRADO', { codcest: id });
    return this.linha(r);
  }

  /** o par (CEST, NCM) é único — na origem são 19.109 pares sem repetição. */
  private async recusarDuplicado(db: AnyDB, b: CestDto, ignorar: number | null) {
    const d = (await sql<{ codcest: unknown }>`
      SELECT codcest FROM cest
       WHERE cest = ${b.cest} AND coalesce(ncm, '') = ${b.ncm ?? ''}
         AND (${ignorar}::integer IS NULL OR codcest <> ${ignorar}::integer)`.execute(db)).rows[0];
    if (d) throw new BusinessRuleError('CEST_DUPLICADO', { cest: b.cest, ncm: b.ncm ?? null, codcest: Number(d.codcest) });
  }

  async criar(b: CestDto) {
    const db = this.dbp.forTenant() as AnyDB;
    await this.recusarDuplicado(db, b, null);
    const r = (await sql<{ codcest: unknown }>`
      INSERT INTO cest (cest, ncm, descricao, seguimento, item, anexoxxvii, usultalteracao, dtultimalteracao)
      VALUES (${b.cest}, ${b.ncm ?? null}, ${b.descricao}, ${b.seguimento ?? null}, ${b.item ?? null}, ${b.anexoxxvii ?? null}, ${this.op()}, now())
      RETURNING codcest`.execute(db)).rows[0];
    return this.obter(Number(r.codcest));
  }

  async atualizar(id: number, b: CestDto) {
    const db = this.dbp.forTenant() as AnyDB;
    await this.obter(id);
    await this.recusarDuplicado(db, b, id);
    await sql`
      UPDATE cest SET cest = ${b.cest}, ncm = ${b.ncm ?? null}, descricao = ${b.descricao}, seguimento = ${b.seguimento ?? null},
             item = ${b.item ?? null}, anexoxxvii = ${b.anexoxxvii ?? null}, usultalteracao = ${this.op()}, dtultimalteracao = now()
       WHERE codcest = ${id}`.execute(db);
    return this.obter(id);
  }

  /** apagar o ÚLTIMO NCM de um CEST que produtos apontam deixaria esses produtos sem cadastro — recusado. */
  async excluir(id: number) {
    const db = this.dbp.forTenant() as AnyDB;
    const c = await this.obter(id);
    if (c.produtos > 0) {
      const outros = Number((await sql<{ n: unknown }>`SELECT count(*) AS n FROM cest WHERE cest = ${c.cest} AND codcest <> ${id}`.execute(db)).rows[0]?.n ?? 0);
      if (outros === 0) throw new BusinessRuleError('CEST_EM_USO', { cest: c.cest, produtos: c.produtos });
    }
    await sql`DELETE FROM cest WHERE codcest = ${id}`.execute(db);
    return { codcest: id, excluido: true };
  }

  /** os produtos cujo CEST não existe na tabela (248 no cliente) — inclui os fora do formato de 7 dígitos (4). */
  async semCadastro() {
    const rows = (await sql<Record<string, unknown>>`
      SELECT p.idproduto, p.codbarra, p.descricao, p.cest, (p.cest !~ '^[0-9]{7}$') AS formato_invalido
        FROM produtos p
       WHERE p.cest IS NOT NULL AND trim(p.cest) <> ''
         AND NOT EXISTS (SELECT 1 FROM cest c WHERE c.cest = p.cest)
       ORDER BY p.cest, p.descricao
       LIMIT 1000`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return {
      produtos: rows.map((r) => ({ idproduto: Number(r.idproduto), codbarra: r.codbarra ?? null, descricao: r.descricao, cest: r.cest, formatoInvalido: r.formato_invalido === true })),
      total: rows.length,
    };
  }
}
