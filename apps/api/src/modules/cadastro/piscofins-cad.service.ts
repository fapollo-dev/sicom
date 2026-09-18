import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { PisCofinsDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * CADASTRO DE PIS/COFINS (`FRMCADPISCOFINS`). **13 acessos, 3 operadores.** Migration 256.
 *
 * As situações que `produtos.idpiscofins` aponta: descrição, alíquotas de entrada/saída, CSTs de entrada/saída,
 * o tipo de crédito (tabela 4.3.6 do SPED, `pc_tipocredito`) e a flag "exige natureza". No cliente são 12
 * situações para 45.416 produtos. Excluir uma situação em uso é recusado — 31.626 produtos apontam para
 * TRIBUTADOS; apagá-la deixaria a apuração sem CST.
 */
@Injectable()
export class PisCofinsCadService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private op() { return currentTenant().operadorId ?? null; }

  private linha(r: Record<string, unknown>) {
    return {
      idpiscofins: Number(r.idpiscofins), descricao: r.descricao,
      aliqPisEnt: num(r.aliq_pis_ent), aliqPisSai: num(r.aliq_pis_sai), aliqCofinsEnt: num(r.aliq_cofins_ent), aliqCofinsSai: num(r.aliq_cofins_sai),
      cstPisEnt: r.cst_pis_ent == null ? null : Number(r.cst_pis_ent), cstPisSai: r.cst_pis_sai == null ? null : Number(r.cst_pis_sai),
      cstCofinsEnt: r.cst_cofins_ent == null ? null : Number(r.cst_cofins_ent), cstCofinsSai: r.cst_cofins_sai == null ? null : Number(r.cst_cofins_sai),
      idTipoCredito: r.id_tipocredito == null ? null : Number(r.id_tipocredito), descricaoCredito: r.descricao_credito ?? null,
      exigeNatureza: r.exigenatureza ?? null, produtos: Number(r.produtos ?? 0),
    };
  }

  private sel = sql`
      SELECT p.idpiscofins, p.descricao, p.aliq_pis_ent, p.aliq_pis_sai, p.aliq_cofins_ent, p.aliq_cofins_sai,
             p.cst_pis_ent, p.cst_pis_sai, p.cst_cofins_ent, p.cst_cofins_sai, p.id_tipocredito, t.descricao AS descricao_credito, p.exigenatureza,
             (SELECT count(*) FROM produtos pr WHERE pr.idpiscofins = p.idpiscofins) AS produtos
        FROM piscofins p LEFT JOIN pc_tipocredito t ON t.id_tipocredito = p.id_tipocredito`;

  async listar() {
    const rows = (await sql<Record<string, unknown>>`${this.sel} ORDER BY p.descricao, p.idpiscofins`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((r) => this.linha(r));
  }
  async tiposCredito() {
    return (await sql<Record<string, unknown>>`SELECT id_tipocredito, descricao FROM pc_tipocredito ORDER BY id_tipocredito`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }
  async obter(id: number) {
    const r = (await sql<Record<string, unknown>>`${this.sel} WHERE p.idpiscofins = ${id}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (!r) throw new BusinessRuleError('PISCOFINS_NAO_ENCONTRADO', { id });
    return this.linha(r);
  }
  async criar(d: PisCofinsDto) {
    const db = this.dbp.forTenant() as AnyDB;
    const r = (await sql<{ idpiscofins: number }>`
      INSERT INTO piscofins (idpiscofins, descricao, aliq_pis_ent, aliq_pis_sai, aliq_cofins_ent, aliq_cofins_sai, cst_pis_ent, cst_pis_sai, cst_cofins_ent, cst_cofins_sai, id_tipocredito, exigenatureza, usultalteracao, dtultimalteracao)
      VALUES (nextval('seq_piscofins'), ${d.descricao}, ${d.aliqPisEnt}, ${d.aliqPisSai}, ${d.aliqCofinsEnt}, ${d.aliqCofinsSai}, ${d.cstPisEnt ?? null}, ${d.cstPisSai ?? null}, ${d.cstCofinsEnt ?? null}, ${d.cstCofinsSai ?? null}, ${d.idTipoCredito ?? null}, ${d.exigeNatureza ?? null}, ${this.op()}, now())
      RETURNING idpiscofins
    `.execute(db)).rows[0];
    return this.obter(Number(r.idpiscofins));
  }
  async atualizar(id: number, d: PisCofinsDto) {
    const r = await sql`
      UPDATE piscofins SET descricao = ${d.descricao}, aliq_pis_ent = ${d.aliqPisEnt}, aliq_pis_sai = ${d.aliqPisSai}, aliq_cofins_ent = ${d.aliqCofinsEnt}, aliq_cofins_sai = ${d.aliqCofinsSai},
             cst_pis_ent = ${d.cstPisEnt ?? null}, cst_pis_sai = ${d.cstPisSai ?? null}, cst_cofins_ent = ${d.cstCofinsEnt ?? null}, cst_cofins_sai = ${d.cstCofinsSai ?? null},
             id_tipocredito = ${d.idTipoCredito ?? null}, exigenatureza = ${d.exigeNatureza ?? null}, usultalteracao = ${this.op()}, dtultimalteracao = now()
       WHERE idpiscofins = ${id}
    `.execute(this.dbp.forTenant() as AnyDB);
    if (Number(r.numAffectedRows ?? 0) === 0) throw new BusinessRuleError('PISCOFINS_NAO_ENCONTRADO', { id });
    return this.obter(id);
  }
  async excluir(id: number) {
    const db = this.dbp.forTenant() as AnyDB;
    const uso = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM produtos WHERE idpiscofins = ${id}`.execute(db)).rows[0];
    if (Number(uso?.n ?? 0) > 0) throw new BusinessRuleError('PISCOFINS_EM_USO', { id, produtos: Number(uso!.n) });
    const r = await sql`DELETE FROM piscofins WHERE idpiscofins = ${id}`.execute(db);
    if (Number(r.numAffectedRows ?? 0) === 0) throw new BusinessRuleError('PISCOFINS_NAO_ENCONTRADO', { id });
    return { idpiscofins: id, excluido: true };
  }
}
