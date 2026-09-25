import { sql } from 'kysely';
import { familiaSchema, atualizarFamiliaSchema } from '@apollo/shared';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/** o pai de cada campo da hierarquia: o TIPO que ele tem de ter e a mensagem do legado (`GetMsgFamiliaProdInativo`, udmPrincipal.pas:2608) */
const PAIS: Array<[string, string, string]> = [
  ['coddpto', 'D', 'FAMILIA_DEPARTAMENTO_INATIVO'],
  ['codgrupo', 'G', 'FAMILIA_GRUPO_INATIVO'],
  ['codsecao', 'O', 'FAMILIA_SECAO_INATIVA'],
  ['codsetor', 'E', 'FAMILIA_SETOR_INATIVO'],
];

/**
 * Cadastro de categorias e departamentos (FAMILIAS_PROD; UCadFamiliaProd) — o catálogo único com discriminador TIPO: D Departamento,
 * G Grupo, S Subgrupo, P Grupo de preço, R Produção, O Seção (o combo, UCadFamiliaProd.dfm:105-122) e E Setor (binário novo). As regras da
 * tela:
 *  - o subgrupo pendura em departamento, grupo, seção e setor, cada um do seu TIPO e ATIVO (`CheckAtivo(... AND TIPO = 'D')` nos exits,
 *    :367-590) — cobrado só quando o campo muda (`OldValue <> Value`);
 *  - o setor de perda padrão é um só (`ExisteValorPadrao`, :343);
 *  - excluir é recusado se algum produto usa a família (departamento, grupo, subgrupo, grupo de preço, seção — :264-290); senão é lógico:
 *    EXCLUIDO 'S' e ATIVO 'N';
 *  - a inclusão grava ATIVO 'S' e a loja da sessão (92 de 92 em 2025-26) e os carimbos do form-base.
 * A aba Área (FAMILIAS_PROD_AREA) não entra: a tabela está vazia na produção.
 */
export const familiasCrudConfig: CrudConfig = {
  tabela: 'familias_prod',
  pk: 'codfamilia',
  view: 'get_familias_prod',
  colunas: [
    'tipo', 'descricao', 'ativo', 'idempresa',
    'coddpto', 'codgrupo', 'codsecao', 'codsetor', 'coberturamaxima', 'exibesicomanda', 'comissao', 'codperfil_compra', 'codplc',
    'codsetor_perda_padrao', 'vrmargemmin', 'vrmargemmax', 'vrmargemfixa', 'fp_despesa_operacional', 'checkout', 'referencia',
    'modeloeitqueta', 'desconsidera_conferencia_peso',
  ],
  rbacForm: 'FRMCADFAMILIAPROD',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Cadastro de categorias e departamentos' },
  replica: false,
  colunasPesquisa: ['codfamilia', 'tipo', 'descricao'],
  exclusaoLogica: { excluido: 'S', ativo: 'N' },
  derivar: (_dto, id) => (id == null ? { ativo: 'S', idempresa: currentTenant().empresaId ?? null } : {}),
  validarTrx: async ({ trx, id, dto }) => {
    const atual = id != null ? ((await trx.selectFrom('familias_prod').selectAll().where('codfamilia', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined) : undefined;
    for (const [campo, tipo, codigo] of PAIS) {
      const v = dto[campo];
      if (v == null || v === '' || Number(v) === Number(atual?.[campo] ?? NaN)) continue;
      const pai = await trx.selectFrom('familias_prod').select('codfamilia').where('codfamilia', '=', Number(v)).where('tipo', '=', tipo)
        .where(sql`coalesce(ativo, 'S')`, '=', 'S').executeTakeFirst();
      if (!pai) throw new BusinessRuleError(codigo, { [campo]: Number(v) });
    }
    if (dto.codsetor_perda_padrao === 'S') {
      let q = trx.selectFrom('familias_prod').select('codfamilia').where('codsetor_perda_padrao', '=', 'S');
      if (id != null) q = q.where('codfamilia', '<>', id);
      if (await q.executeTakeFirst()) throw new BusinessRuleError('FAMILIA_SETOR_PERDA_PADRAO_EXISTE');
    }
  },
  validarRemocaoTrx: async ({ trx, id }) => {
    const usado = await trx.selectFrom('produtos').select('idproduto')
      .where((eb: any) => eb.or(['coddpto', 'codgrupo', 'codsubgrupo', 'codgrupopreco', 'codsecao'].map((c) => eb(c, '=', id))))
      .executeTakeFirst();
    if (usado) throw new BusinessRuleError('FAMILIA_EM_USO_PRODUTO', { codfamilia: id });
  },
};

export const FamiliasCrudController = createCrudController({
  path: 'cadastro/familias',
  config: familiasCrudConfig,
  schema: familiaSchema,
  updateSchema: atualizarFamiliaSchema,
});
