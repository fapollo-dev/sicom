import { cartaoSchema, atualizarCartaoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * CARTÃO (FRMCADCARTAO) — recebível de cartão, corte-1: cadastro/consulta (SEM baixa). CRUD de linha única lendo a
 * view `get_cartao` (que COMPUTA o líquido = bruto − bruto×txadm/100 e o vencimento = dtvenda + diascomp×parcela,
 * pulando fim de semana — espelha o GET_CARTAO do legado). O front filtra por LIBERADO (aberto/baixado). No corte-1
 * o recebível nasce sempre LIBERADO='N' (o default do banco) — a baixa (LIBERADO='S') é o corte-2. empresaScoped.
 * Exclusão física (o legado não tem INDR no cartão). Travas de "não editar baixado" ficam p/ o corte da baixa.
 */
export const cartaoCrudConfig: CrudConfig = {
  tabela: 'cartao',
  pk: 'codvendcartao',
  pkGerada: true,
  view: 'get_cartao',
  rbacForm: 'FRMCADCARTAO',
  empresaScoped: true,
  colunas: ['dtvenda', 'valor', 'codoperadora', 'idpgto', 'nrocupom', 'nropedido', 'codpdv', 'nroparcela', 'qtde_parcelas', 'tipocartao', 'codbandeira', 'nsu', 'autorizacao', 'nrocartao', 'obs'],
  colunasPesquisa: ['codvendcartao', 'dtvenda', 'operadora', 'liberado', 'nrocupom', 'nropedido', 'valor'],
};

export const CartaoCrudController = createCrudController({
  path: 'cadastro/cartao',
  config: cartaoCrudConfig,
  schema: cartaoSchema,
  updateSchema: atualizarCartaoSchema,
});
