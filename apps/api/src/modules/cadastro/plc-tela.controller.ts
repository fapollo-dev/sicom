import { Controller, Get, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { configNaTrx } from '../compras/pedido-heranca';

/**
 * O que a tela do Cadastro do Centro de Custos (uCadPLC.pas `FormShow` :708) decide ao abrir: o "Lançamento contábil" só aparece com a
 * configuração LANCAMENTO_CONTABIL_NO_CENTRO_CUSTO = 'S' ('N' na produção) e a marcação "Visualizado apenas por proprietários" só para o
 * operador PRO (`VerificaCheckProprietarios` :926).
 */
@Controller('cadastro/plc-tela')
@UseGuards(AcessoGuard)
export class PlcTelaController {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Get()
  @RequerAcesso('FRMCADPLC', 'FRMCADPLC')
  async tela(): Promise<{ lancamentoContabil: boolean; proprietario: boolean }> {
    const db = this.dbp.forTenantRead() as Kysely<any>;
    const t = currentTenant();
    const cfg = await configNaTrx(db, 'LANCAMENTO_CONTABIL_NO_CENTRO_CUSTO', { empresaId: t.empresaId ?? null, operadorId: t.operadorId ?? null, modulo: 'Retaguarda' });
    const tipo = t.operadorId == null ? null
      : (await sql<{ tipoop: string | null }>`SELECT tipoop FROM operadores WHERE codoperador = ${t.operadorId}`.execute(db)).rows[0]?.tipoop;
    return { lancamentoContabil: String(cfg ?? 'N') === 'S', proprietario: String(tipo ?? '') === 'PRO' };
  }
}
