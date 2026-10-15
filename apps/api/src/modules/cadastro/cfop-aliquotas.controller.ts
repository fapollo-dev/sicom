import { Controller, Get, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * O combo "Alíquota Saída" do Cadastro de CFOP (UCadCFOP `cmbALIQUOTA` → `sqqAliquota`, uRDMCadCFOP.dfm): a DET_ALIQUOTA da UF da empresa
 * (ALIQUOTA, ICM, ICM_EFETIVO, BASE, CST) — o ICM_EFETIVO é o "ICMS Saída" que a tela mostra ao lado.
 */
@Controller('cadastro/cfop-aliquotas')
@UseGuards(AcessoGuard)
export class CfopAliquotasController {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Get()
  @RequerAcesso('FRMCADCFOP', 'FRMCADCFOP')
  async listar(): Promise<Array<{ aliquota: string; icm: number | null; icm_efetivo: number | null; base: number | null; cst: string | null }>> {
    const emp = currentTenant().empresaId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    const db = this.dbp.forTenantRead() as Kysely<any>;
    return (await sql<{ aliquota: string; icm: number | null; icm_efetivo: number | null; base: number | null; cst: string | null }>`
      SELECT trim(e.aliquota) AS aliquota, e.icm, e.icm_efetivo, e.base, e.cst
        FROM det_aliquota e
       WHERE e.uf = (SELECT uf FROM empresas WHERE idempresa = ${emp})
       ORDER BY e.aliquota`.execute(db)).rows;
  }
}
