import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * GERENCIAR SUGESTÃO DE PROMOÇÃO (`FRMGERENCIARSUGESTAOPROMOCAO`) — a tela não veio no fonte de mai/2020; reconstruída do dado
 * (`SUGEST_PROMO_PROD`, 471 linhas até 21/09/2026). É a lista de produtos que alguém sugeriu para promoção, por loja e
 * operador; "resolver" é a exclusão lógica — INDR 'S' com o usuário e a data (343 resolvidas, 319 pelo mesmo operador que
 * sugere). Não há duas sugestões abertas do mesmo produto na mesma loja (0 no dado) — a inclusão recusa a repetida.
 */
@Injectable()
export class SugestaoPromocaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(q: { situacao?: string }) {
    const emp = this.emp();
    const filtro = q.situacao === 'resolvidas' ? sql`s.indr = 'S'` : q.situacao === 'todas' ? sql`true` : sql`s.indr IS NULL`;
    return (await sql<Record<string, unknown>>`
      SELECT s.idsugest_promo_prod, s.idproduto, p.descricao, p.codbarra, s.operador, o.nome AS nome_operador,
             to_char(s.dtcadastro, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtcadastro, s.indr, s.indr_usuario, u.nome AS nome_indr_usuario,
             to_char(s.indr_data, 'YYYY-MM-DD"T"HH24:MI:SS') AS indr_data,
             (SELECT to_char(max(a.dtiniciopromocao), 'YYYY-MM-DD') FROM agenda_promocao_itens i JOIN agenda_promocao a ON a.codagenda = i.codagenda
               WHERE i.idproduto = s.idproduto) AS ultima_promocao
        FROM sugest_promo_prod s
        LEFT JOIN produtos p ON p.idproduto = s.idproduto
        LEFT JOIN operadores o ON o.codoperador = s.operador
        LEFT JOIN operadores u ON u.codoperador = s.indr_usuario
       WHERE s.idempresa = ${emp} AND ${filtro}
       ORDER BY s.dtcadastro DESC, s.idsugest_promo_prod DESC
       LIMIT 1000`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  async sugerir(idproduto: number) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const p = (await sql`SELECT 1 FROM produtos WHERE idproduto = ${idproduto}`.execute(trx)).rows[0];
      if (!p) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto });
      const aberta = (await sql`SELECT 1 FROM sugest_promo_prod WHERE idempresa = ${emp} AND idproduto = ${idproduto} AND indr IS NULL FOR UPDATE`.execute(trx)).rows[0];
      if (aberta) throw new BusinessRuleError('SUGESTAO_PROMOCAO_JA_EXISTE', { idproduto });
      const r = (await sql<{ id: number }>`INSERT INTO sugest_promo_prod (idproduto, operador, idempresa, dtcadastro)
          VALUES (${idproduto}, ${op}, ${emp}, now()) RETURNING idsugest_promo_prod AS id`.execute(trx)).rows[0];
      return { idsugest_promo_prod: num(r.id) };
    });
  }

  async resolver(id: number) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const r = await sql`UPDATE sugest_promo_prod SET indr = 'S', indr_usuario = ${op}, indr_data = now()
        WHERE idsugest_promo_prod = ${id} AND idempresa = ${emp} AND indr IS NULL`.execute(this.dbp.forTenant() as AnyDB);
    if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('SUGESTAO_PROMOCAO_NAO_ENCONTRADA', { id });
    return { idsugest_promo_prod: id, indr: 'S' };
  }
}
