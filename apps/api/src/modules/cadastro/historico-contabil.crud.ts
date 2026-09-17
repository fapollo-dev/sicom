import { atualizarHistoricoContabilSchema, historicoContabilSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * CADASTRO DE HISTÓRICO CONTÁBIL (`FRMCADHISTORICOCONTABIL`, `uCadHistoricoContabil.pas`).
 * **62 acessos, 3 operadores.** Migration 231 (a tabela e os 54 templates vieram na 229).
 *
 * O texto que o razão imprime. Cada `*` é um buraco que a contabilização preenche na ordem — a regra está em
 * `montarDeschist` (pacote compartilhado) e a procedência, em `uTron-integracao-contabil.md` §8.
 *
 * ⚠️ **hard-delete, mas o razão não fica órfão**: `DIARIO` guarda o CÓDIGO e a DESCRIÇÃO JÁ RESOLVIDA
 * (`DESCHIST`), não uma referência ao texto. Apagar um histórico não apaga nem altera o que o razão mostra
 * — só tira o template das contabilizações futuras. Por isso o legado não tem trava aqui, e nós também não.
 * Para tirar de circulação sem apagar, é o `STATUS` que serve.
 */
export const historicoContabilCrudConfig: CrudConfig = {
  tabela: 'historico_contabil',
  pk: 'codhistcontabil',
  pkGerada: true,
  view: 'get_historico_contabil',
  colunas: ['deschist', 'status'],
  rbacForm: 'FRMCADHISTORICOCONTABIL',
  audit: true,
  replica: false,
  colunasPesquisa: ['codhistcontabil', 'deschist', 'status', 'coringas'],
};

export const HistoricoContabilCrudController = createCrudController({
  path: 'cadastro/historico-contabil',
  config: historicoContabilCrudConfig,
  schema: historicoContabilSchema,
  updateSchema: atualizarHistoricoContabilSchema,
});
