import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * OS NÚMEROS DE ESTABELECIMENTO DA EMPRESA POR REDE (a grade da aba "Configurações financeiras" do UCadEmpresa — `CdsEmpRedeEstab`,
 * EMPRESA_REDE_ESTABELECIMENTO: CODEMPRESA, ERE_REDE, ERE_NUMERO_ESTABELECIMENTO). O combo da rede no fonte: Cielo (125), Rede (5),
 * Concil (-1); a produção tem também 54 e 77 (binário novo). Quem lê: os conciliadores de arquivo da Tivit/Rede (UTivit_Rede_EEVC/EEVD)
 * e a validação da baixa de cartões (UbaixaCartao.pas:2425) — "Informe o número do estabelecimento para a empresa X, rede Y.". Produção:
 * 23 linhas nas lojas 1, 2, 50 e 51. «Salvar» (BtnSalvarRedeClick): "Informe a rede." / "Informe o número do estabelecimento.".
 */
@Controller('cadastro/empresas/:id/redes-estabelecimento')
@UseGuards(AcessoGuard)
export class EmpresaRedeEstabelecimentoController {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Get()
  @RequerAcesso('FRMCADEMPRESA', 'FRMCADEMPRESA')
  async listar(@Param('id', ParseIntPipe) id: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    return db.selectFrom('empresa_rede_estabelecimento').select(['ere_rede', 'ere_numero_estabelecimento'])
      .where('codempresa', '=', id).orderBy('ere_rede').orderBy('ere_numero_estabelecimento').execute();
  }

  @Post()
  @HttpCode(200)
  @RequerAcesso('FRMCADEMPRESA', 'BTNGRAVAR')
  async incluir(@Param('id', ParseIntPipe) id: number, @Body() body: { ere_rede?: unknown; ere_numero_estabelecimento?: unknown }) {
    const rede = Number(body?.ere_rede);
    const numero = String(body?.ere_numero_estabelecimento ?? '').trim();
    if (!Number.isInteger(rede) || rede === 0) throw new BusinessRuleError('EMPRESA_REDE_OBRIGATORIA', {}, 'Informe a rede.');
    if (!numero) throw new BusinessRuleError('EMPRESA_REDE_NUMERO_OBRIGATORIO', {}, 'Informe o número do estabelecimento.');
    if (numero.length > 30) throw new BusinessRuleError('EMPRESA_REDE_NUMERO_OBRIGATORIO', {}, 'O número do estabelecimento tem até 30 caracteres.');
    const db = this.dbp.forTenant() as AnyDB;
    const emp = await db.selectFrom('empresas').select('idempresa').where('idempresa', '=', id).executeTakeFirst();
    if (!emp) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: id });
    await db.insertInto('empresa_rede_estabelecimento').values({ codempresa: id, ere_rede: rede, ere_numero_estabelecimento: numero })
      .onConflict((oc: any) => oc.doNothing()).execute();
    return { codempresa: id, ere_rede: rede, ere_numero_estabelecimento: numero };
  }

  @Delete()
  @RequerAcesso('FRMCADEMPRESA', 'BTNGRAVAR')
  async excluir(@Param('id', ParseIntPipe) id: number, @Query('rede') rede: string, @Query('numero') numero: string) {
    const db = this.dbp.forTenant() as AnyDB;
    const r = await db.deleteFrom('empresa_rede_estabelecimento').where('codempresa', '=', id).where('ere_rede', '=', Number(rede))
      .where('ere_numero_estabelecimento', '=', String(numero ?? '')).executeTakeFirst();
    return { excluidos: Number((r as any)?.numDeletedRows ?? 0) };
  }
}
