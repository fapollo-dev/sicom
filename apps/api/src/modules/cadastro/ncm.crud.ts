import { ncmSchema, atualizarNcmSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de NCM — DECLARATIVO (engine). Prova: CHAVE NATURAL (pkGerada:false →
 * o create insere o CODIGO do dto), datas (vigência), combo (un_tributada) e memo
 * (descricao/categoria/observacao). Sem INDR no legado → hard-delete (softDelete omitido).
 *
 * NCMSH é DERIVADO server-side (BeforePost do legado, uCadNCM.pas ~76):
 *   NCMSH := ConcatenaLeft(CODIGO, 8, '0')  → left-pad do código a 8 dígitos.
 * IPI existe na tabela (data load) mas NÃO é editado por esta tela (sem controle no .dfm),
 * por isso fora de `colunas`.
 */
export const ncmCrudConfig: CrudConfig = {
  tabela: 'ncm',
  pk: 'codigo',
  pkGerada: false, // chave natural: usuário digita o código NCM
  view: 'get_ncm',
  colunas: [
    'ncmsh',
    'descricao',
    'categoria',
    'un_tributada',
    'un_tributada_descricao',
    'vigencia_inicio',
    'vigencia_fim',
    'observacao',
  ],
  rbacForm: 'FRMCADNCM',
  // sem softDelete → hard-delete (NCM não tem INDR)
  replica: false,
  colunasPesquisa: ['codigo', 'ncmsh', 'descricao'],
  // BeforePost: NCMSH = ConcatenaLeft(CODIGO,8,'0') (read-only na tela, server sobrepõe).
  derivar: (dto, id) => ({ ncmsh: String(dto.codigo ?? id ?? '').padStart(8, '0') }),
};

export const NcmCrudController = createCrudController({
  path: 'cadastro/ncm',
  config: ncmCrudConfig,
  schema: ncmSchema,
  updateSchema: atualizarNcmSchema,
});
