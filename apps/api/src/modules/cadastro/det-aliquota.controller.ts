import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;

// o que não veio fica como está (a edição é da linha inteira no legado, mas o PUT parcial não pode zerar o resto)
const dec = (v: unknown) => (v === undefined ? undefined : v === '' || v === null ? null : Number(v));
const detAliquotaSchema = z.object({
  icm: z.preprocess(dec, z.number().nullable().optional()),
  icm_efetivo: z.preprocess(dec, z.number().nullable().optional()),
  base: z.preprocess(dec, z.number().nullable().optional()),
  cst: z.preprocess(dec, z.number().int().nullable().optional()),
  lei: z.string().trim().max(100).nullable().optional(),
  codcontabilavista: z.preprocess(dec, z.number().int().nullable().optional()),
  codcontabilaprazo: z.preprocess(dec, z.number().int().nullable().optional()),
});

/**
 * Cadastro de alíquotas (UcadAliquota) — o editor da DET_ALIQUOTA: a lista das alíquotas (`select distinct aliquota from det_aliquota`),
 * a linha de cada UF da alíquota escolhida e, no duplo clique, a edição de ICMS, ICMS efetivo, base, CST, lei e os lançamentos contábeis à
 * vista e a prazo (btnSaveClick). A tela não inclui nem exclui linha — só edita.
 */
@Controller('cadastro/det-aliquota')
@UseGuards(AcessoGuard)
export class DetAliquotaController {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Get('aliquotas')
  @RequerAcesso('FRMCADALIQUOTA', 'FRMCADALIQUOTA')
  async aliquotas(): Promise<Array<{ aliquota: string; descricao: string | null }>> {
    return (await sql<{ aliquota: string; descricao: string | null }>`
      SELECT d.aliquota, max(a.descricao) AS descricao FROM det_aliquota d LEFT JOIN aliquota a ON a.codigo = d.aliquota
       GROUP BY d.aliquota ORDER BY d.aliquota`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  @Get()
  @RequerAcesso('FRMCADALIQUOTA', 'FRMCADALIQUOTA')
  async listar(@Query('aliquota') aliquota: string): Promise<Array<Record<string, unknown>>> {
    return (await sql<Record<string, unknown>>`
      SELECT aliquota, uf, icm, icm_efetivo, base, cst, csosn, lei, codcontabilavista, codcontabilaprazo, descricaoaliquota
        FROM det_aliquota WHERE aliquota = ${String(aliquota ?? '')} ORDER BY uf`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  @Put(':aliquota/:uf')
  @RequerAcesso('FRMCADALIQUOTA', 'BTNGRAVAR')
  async gravar(@Param('aliquota') aliquota: string, @Param('uf') uf: string, @Body(new ZodValidationPipe(detAliquotaSchema)) dto: z.infer<typeof detAliquotaSchema>) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) set[k] = v;
    if (!Object.keys(set).length) return { aliquota, uf };
    const r = await (this.dbp.forTenant() as AnyDB).updateTable('det_aliquota').set(set).where('aliquota', '=', aliquota).where('uf', '=', uf).executeTakeFirst();
    if (Number((r as { numUpdatedRows?: bigint })?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('DET_ALIQUOTA_NAO_ENCONTRADA', { aliquota, uf });
    return { aliquota, uf };
  }
}
