import { sql } from 'kysely';
import { unidadeSchema, atualizarUnidadeSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * Cadastro de UNIDADE (UCadUnidade) — sigla, descrição, ativo, produção e fracionado. As regras da tela: a sigla é única na inclusão
 * (btnGravarClick: "Já existe uma unidade cadastrada com esta sigla. Verifique!") e excluir é recusado com produto associado (btnExcluirClick:
 * "Existe produto associado a esta unidade. Verifique!"); a exclusão do form-base é lógica (INDR) e grava os carimbos.
 */
export const unidadeCrudConfig: CrudConfig = {
  tabela: 'unidade',
  pk: 'codunidade',
  view: 'get_unidade',
  colunas: ['sigla', 'descricao', 'ativo', 'producao', 'fracionado'],
  rbacForm: 'FRMCADUNIDADE',
  softDelete: true,
  replica: false,
  colunasPesquisa: ['codunidade', 'sigla', 'descricao'],
  derivar: (_dto, id) => (id == null ? { ativo: _dto.ativo ?? 'S' } : {}),
  validarTrx: async ({ trx, id, dto }) => {
    if (id == null && typeof dto.sigla === 'string') {
      const existe = await trx.selectFrom('unidade').select('codunidade').where(sql`upper(trim(sigla))`, '=', dto.sigla.trim().toUpperCase())
        .where(sql`coalesce(indr, 'I')`, '<>', 'E').executeTakeFirst();
      if (existe) throw new BusinessRuleError('UNIDADE_SIGLA_EXISTE', { sigla: dto.sigla });
    }
  },
  validarRemocaoTrx: async ({ trx, id }) => {
    const u = (await trx.selectFrom('unidade').select('sigla').where('codunidade', '=', id).executeTakeFirst()) as { sigla?: string } | undefined;
    const usado = await trx.selectFrom('produtos').select('idproduto')
      .where((eb: any) => eb.or([eb('codunidade', '=', id), eb(sql`upper(trim(unidade))`, '=', String(u?.sigla ?? '').trim().toUpperCase())]))
      .executeTakeFirst();
    if (usado) throw new BusinessRuleError('UNIDADE_EM_USO_PRODUTO', { codunidade: id });
  },
};

export const UnidadeCrudController = createCrudController({
  path: 'cadastro/unidades',
  config: unidadeCrudConfig,
  schema: unidadeSchema,
  updateSchema: atualizarUnidadeSchema,
});
