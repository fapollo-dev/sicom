import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const CAMPOS = ['nome', 'cpf', 'crc', 'cnpj', 'cep', 'endereco', 'num', 'complemento', 'bairro', 'fone', 'fax', 'email', 'cod_mun'] as const;
const TAM: Record<string, number> = { nome: 150, cpf: 20, crc: 20, cnpj: 20, cep: 10, endereco: 150, num: 10, complemento: 60, bairro: 60, fone: 30, fax: 30, email: 120 };

/**
 * O CONTABILISTA DA EMPRESA (a aba "Contabilista" do UCadEmpresa — o dataset CONTABILISTA aninhado na empresa, `SELECT * FROM
 * CONTABILISTA WHERE CODEMPRESA = :CODEMPRESA`, CODCONTABILISTA pelo GetID no NewRecord, udmCadEmpresa.pas:628). É o registro 0100
 * das duas escriturações do SPED (Uspedfiscal.pas:1661, uSpedPisCofins.pas:416) e o cabeçalho do Diário. O Apollo lia a tabela e
 * não tinha onde editá-la (conferir-tabelas-sem-escritor.py, 30/09/2026).
 */
@Controller('cadastro/empresas/:id/contabilista')
@UseGuards(AcessoGuard)
export class EmpresaContabilistaController {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Get()
  @RequerAcesso('FRMCADEMPRESA', 'FRMCADEMPRESA')
  async obter(@Param('id', ParseIntPipe) id: number) {
    currentTenant();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = (await sql<Record<string, unknown>>`SELECT codcontabilista, ${sql.raw(CAMPOS.join(', '))} FROM contabilista WHERE codempresa = ${id}`.execute(db)).rows[0];
    return r ?? null;
  }

  @Put()
  @RequerAcesso('FRMCADEMPRESA', 'BTNGRAVAR')
  async gravar(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const op = currentTenant().operadorId ?? null;
    const v: Record<string, unknown> = {};
    for (const c of CAMPOS) {
      const x = body?.[c];
      if (c === 'cod_mun') v[c] = x == null || x === '' ? null : Math.trunc(Number(x)) || null;
      else v[c] = x == null || String(x).trim() === '' ? null : String(x).trim().slice(0, TAM[c]);
    }
    if (!v.nome) throw new BusinessRuleError('CONTABILISTA_NOME_OBRIGATORIO', {}, 'Informe o nome do contabilista.');
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const emp = await trx.selectFrom('empresas').select('idempresa').where('idempresa', '=', id).executeTakeFirst();
      if (!emp) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: id });
      const ja = (await sql<{ c: number | null }>`SELECT codcontabilista AS c FROM contabilista WHERE codempresa = ${id} FOR UPDATE`.execute(trx)).rows[0];
      // as colunas do Apollo (numero/telefone, mig 270) espelham as do legado (NUM/FONE) — o Diário e o SPED leem as do legado
      const espelho = { numero: v.num, telefone: v.fone };
      if (ja) {
        await trx.updateTable('contabilista').set({ ...v, ...espelho, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codempresa', '=', id).execute();
        return { codempresa: id, codcontabilista: ja.c };
      }
      const cod = Number((await sql<{ n: number }>`SELECT coalesce(max(codcontabilista), 0) + 1 AS n FROM contabilista`.execute(trx)).rows[0].n);
      await trx.insertInto('contabilista').values({ codempresa: id, codcontabilista: cod, ...v, ...espelho, usultalteracao: op, dtcadastro: sql`now()` }).execute();
      return { codempresa: id, codcontabilista: cod };
    });
  }
}
