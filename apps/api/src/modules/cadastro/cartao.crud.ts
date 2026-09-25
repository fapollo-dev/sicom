import { cartaoSchema, atualizarCartaoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { sql } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SenhaOperacaoService } from './senha-operacao.service';

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
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Lançamento de Cartões' },
  empresaScoped: true,
  // NSUHOST e CODREDE: os campos da conciliação (445 e 178 alterações no HISTORICO de 2025-26); CONSILIADO vai 'S' em toda
  // gravação (UcadCartao.pas:366-367 — 94% dos cartões de 2026 conciliados)
  colunas: ['dtvenda', 'valor', 'codoperadora', 'idpgto', 'nrocupom', 'nropedido', 'codpdv', 'nroparcela', 'qtde_parcelas', 'tipocartao', 'codbandeira', 'nsu', 'autorizacao', 'nrocartao', 'obs', 'nsuhost', 'codrede', 'consiliado'],
  derivar: () => ({ consiliado: 'S' }),
  // "Documento ja consiliado na tesouraria, não é possivel alteração de valores!" (btnEditarClick :283-290): o VALOR e a
  // PARCELA do cartão conciliado não mudam
  validarTrx: async ({ trx, id, dto }) => {
    if (id == null) return;
    const c = (await sql<{ consiliado: string | null; valor: unknown; nroparcela: unknown }>`
      SELECT consiliado, valor, nroparcela FROM cartao WHERE codvendcartao = ${id}`.execute(trx)).rows[0];
    if (!c || String(c.consiliado ?? '') !== 'S') return;
    const mudou = (novo: unknown, atual: unknown) => novo !== undefined && Number(novo ?? 0) !== Number(atual ?? 0);
    if (mudou(dto.valor, c.valor) || mudou(dto.nroparcela, c.nroparcela)) throw new BusinessRuleError('CARTAO_CONCILIADO_VALOR', { codvendcartao: id });
  },
  // "Documento ja conciliado na tesouraria, não é possivel excluí-lo!" — só com a senha administrativa (btnExcluirClick :293-300)
  validarRemocaoTrx: async ({ trx, id, senhaAdmin, dbp }) => {
    const c = (await sql<{ consiliado: string | null }>`SELECT consiliado FROM cartao WHERE codvendcartao = ${id}`.execute(trx)).rows[0];
    if (!c || String(c.consiliado ?? '') !== 'S') return;
    if (!senhaAdmin) throw new BusinessRuleError('CARTAO_CONCILIADO_EXCLUSAO', { codvendcartao: id });
    const { ok } = await new SenhaOperacaoService(dbp).verificar('admin', senhaAdmin);
    if (!ok) throw new BusinessRuleError('SENHA_ADM_INVALIDA');
  },
  colunasPesquisa: ['codvendcartao', 'dtvenda', 'operadora', 'liberado', 'nrocupom', 'nropedido', 'valor'],
};

export const CartaoCrudController = createCrudController({
  path: 'cadastro/cartao',
  config: cartaoCrudConfig,
  schema: cartaoSchema,
  updateSchema: atualizarCartaoSchema,
});
