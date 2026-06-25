import { bairroSchema, atualizarBairroSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de Bairros — 1ª tela HERDEIRA COMPLETA, DECLARATIVA (engine CRUD).
 * Prova o pilar inteiro numa tela real do legado: texto + combo (REGIAO) + flag (ATIVO),
 * soft-delete (INDR), Pesquisa (filtro/ordenação/F6) com decode de REGIAO na view,
 * navegação por setas e HISTORICO_DINAMICO — tudo herdado, só uma config.
 */
export const bairroCrudConfig: CrudConfig = {
  tabela: 'bairro',
  pk: 'idbairro',
  view: 'get_bairro',
  colunas: ['descricao', 'regiao', 'ativo', 'idcidade'], // idcidade = LOOKUP/FK → CIDADES
  rbacForm: 'FRMCADBAIRRO',
  softDelete: true, // excluir → INDR='E' (igual ao legado)
  replica: false, // BAIRRO não tem trigger REM no legado
  colunasPesquisa: ['idbairro', 'descricao', 'regiao', 'ativo'],
};

export const BairroCrudController = createCrudController({
  path: 'cadastro/bairros',
  config: bairroCrudConfig,
  schema: bairroSchema,
  updateSchema: atualizarBairroSchema,
});
