import { perfilSchema, atualizarPerfilSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { sincronizarVinculos, TABELA_DO_TIPO, validarOperadoresDoPerfil, operadoresVinculados } from './perfil-vinculos';

/**
 * PERFIL (TfrmCadPerfilOperador, uCadPerfilOperador.pas — um TfrmCadMasterDet). GLOBAL (sem empresa, fiel ao PERFIL da produção).
 * Soft-delete INDR. O TIPO vem da janela que abre a tela (Acessos / Parceiros / Compras) e entra no NewRecord
 * (`cdsPerfilOperadorNewRecord`, udmCadPerfilOperador.pas): obrigatório na inclusão e fixo depois — a tela só carrega perfil do seu tipo
 * ("O perfil não é do tipo …"). A grade "Operadores vinculados" é detalhe do cadastro e vai ao banco no Gravar, na tabela do tipo
 * (ACESSO → RELACAO_OPERADOR_PERFIL, COMPRA → RELACAO_OPERADOR_PERFIL_COMPRA; o PARCEIRO não tem), com o histórico do legado: o vínculo
 * novo é uma linha 'I' e o retirado vira 'E' — por isso não é um `detalhe` do motor, que regrava delete+insert.
 */
export const perfilAggregateConfig: AggregateConfig = {
  tabela: 'perfil',
  pk: 'codperfil',
  view: 'get_perfil',
  colunas: ['perfil', 'ativo', 'tipo'],
  rbacForm: 'FRMCADPERFILOPERADOR',
  colunasPesquisa: ['codigo', 'perfil', 'ativo', 'tipo'], // tipo: o perfil do CLIENTE é TIPO 'PARCEIRO' (uCadClientes.pas:4222)
  softDelete: true,
  replica: false,
  detalhes: [],
  validar: async ({ dto, id, db }) => {
    if (id == null) {
      if (!dto.tipo) throw new BusinessRuleError('PERFIL_TIPO_OBRIGATORIO', {});
      return;
    }
    if (dto.tipo === undefined) return;
    const atual = (await db.selectFrom('perfil').select('tipo').where('codperfil', '=', id).executeTakeFirst()) as { tipo?: string | null } | undefined;
    if (atual && String(atual.tipo ?? '').toUpperCase() !== String(dto.tipo).toUpperCase()) {
      throw new BusinessRuleError('PERFIL_TIPO_IMUTAVEL', { codperfil: id, tipo: atual.tipo, pedido: dto.tipo });
    }
  },
  anexarLeitura: async ({ db, id, registro }) => {
    const tabela = TABELA_DO_TIPO[String(registro.tipo ?? '').toUpperCase()];
    return { ...registro, operadores: tabela ? await operadoresVinculados(db, tabela, id) : [] };
  },
  aposGravarTrx: async ({ trx, id, dto }) => {
    const lista = dto.operadores as Array<{ codoperador: number }> | undefined;
    if (lista === undefined) return;
    const p = (await trx.selectFrom('perfil').select('tipo').where('codperfil', '=', id).executeTakeFirst()) as { tipo?: string | null } | undefined;
    const tabela = TABELA_DO_TIPO[String(p?.tipo ?? '').toUpperCase()];
    if (!tabela) {
      if (lista.length) throw new BusinessRuleError('PERFIL_SEM_OPERADORES', { codperfil: id, tipo: p?.tipo ?? null });
      return;
    }
    await sincronizarVinculos(trx, tabela, { coluna: 'codperfil', valor: id }, lista.map((o) => Number(o.codoperador)),
      (novos) => validarOperadoresDoPerfil(trx, novos));
  },
};

export const PerfilAggregateController = createAggregateController({
  path: 'cadastro/perfil',
  config: perfilAggregateConfig,
  schema: perfilSchema,
  updateSchema: atualizarPerfilSchema,
});

