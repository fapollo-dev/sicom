import { promocaoSchema, atualizarPromocaoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * GESTÃO DE PROMOÇÕES (UCadPromocao) corte-1 — casca + aba Preço Fixo. Agregado mestre-detalhe: `promocao`
 * (header, empresaScoped, soft-delete) + `clube_desconto` (motor de detalhe discriminado por ORIGEM). O TIPO do
 * header escolhe a mecânica; o corte-1 entrega a mecânica Preço Fixo (ORIGEM='P': produto + preço fixo em VALOR).
 *
 * - derivarItensTrx (Preço Fixo, fiel ao AtualizaDadosFilho da pas:1534): carimba idempresa/LOJA (do tenant),
 *   copia o PERÍODO do header (DATA_INICIO/DATA_FIM) em cada filho, e default OPERACAO='PRECO', ENCERRADA='F',
 *   QUANTIDADE=1, ATIVO='S'. TIPO fica NULL (o golden de origem='P' tem TIPO NULL — $/% é da mecânica de desconto).
 * - validar: dtfim>dtini (schema); corte-1 só suporta a mecânica Preço Fixo → REJEITA item com origem≠'P'
 *   (fail-closed, anti-lixo latente); para origem='P' o produto deve EXISTIR + estar ATIVO e VALOR>0.
 */
const OP_ORIGEM = 'P'; // única mecânica implementada no corte-1 (Preço Fixo)
export const promocaoAggregateConfig: AggregateConfig = {
  tabela: 'promocao',
  pk: 'idpromocao',
  view: 'get_promocao',
  rbacForm: 'FRMCADPROMOCAO',
  empresaScoped: true,
  softDelete: true,
  colunas: ['descricao', 'datainicio', 'datafim', 'empresas', 'opcao', 'tipo', 'destino', 'valorcombo', 'tipocombo', 'valor_minimo_compra'],
  colunasPesquisa: ['idpromocao', 'descricao', 'tipo', 'datainicio', 'datafim'],
  detalhes: [
    {
      tabela: 'clube_desconto',
      pk: 'idclubedesconto',
      fk: 'idpromocao',
      chave: 'itens',
      colunas: [
        'origem', 'operacao', 'idorigempromocao', 'tipo', 'subtipo', 'destino', 'valor', 'valorcombo', 'tipocombo',
        'quantidade', 'quantidade_paga', 'minimo', 'maximo', 'maximo_estoque', 'preco_grupo', 'grupo',
        'codigo_promocional', 'codperfil_parceiro', 'codparceiro', 'valor_minimo_compra', 'id_formas_pgto',
        'data_inicio', 'data_fim', 'encerrada', 'loja', 'ativo', 'idempresa',
      ],
      derivarItensTrx: async (itens, _trx, emp, header) => {
        // Preço Fixo — espelha AtualizaDadosFilho (pas:1534): copia o período do header + defaults do golden.
        const dtini = (header?.datainicio as string | undefined) ?? undefined;
        const dtfim = (header?.datafim as string | undefined) ?? undefined;
        return itens.map((it) => ({
          ...it,
          idempresa: emp, // SEMPRE o tenant (não confia em valor do cliente) — integridade multi-empresa
          loja: it.loja ?? emp, // golden: LOJA=1 (=empresa)
          operacao: it.operacao ?? 'PRECO', // golden: OPERACAO='PRECO'
          encerrada: it.encerrada ?? 'F', // golden: ENCERRADA='F' (não encerrada)
          quantidade: it.quantidade ?? 1, // golden: QUANTIDADE=1
          data_inicio: it.data_inicio ?? dtini, // período do header em cada filho
          data_fim: it.data_fim ?? dtfim,
          ativo: it.ativo === 'N' ? 'N' : 'S',
        }));
      },
    },
  ],
  validar: async ({ dto, db }) => {
    const itens = (dto.itens ?? []) as Array<Record<string, unknown>>;
    // corte-1 só implementa a mecânica Preço Fixo → qualquer item com outra origem é REJEITADO (fail-closed:
    // sem isso, itens de origens não-suportadas seriam persistidos sem validação, virando lixo latente).
    for (const it of itens) {
      if (String(it.origem) !== OP_ORIGEM) throw new BusinessRuleError('PROMOCAO_ORIGEM_NAO_SUPORTADA', { origem: it.origem });
      if (!(Number(it.valor) > 0)) throw new BusinessRuleError('PROMOCAO_PRECO_INVALIDO', { idproduto: it.idorigempromocao });
    }
    const ids = [...new Set(itens.map((it) => Number(it.idorigempromocao)).filter((n) => Number.isFinite(n) && n > 0))];
    if (ids.length) {
      // produto deve EXISTIR e estar ATIVO (fiel ao filtro GET_PRODUTOS ativo='S' + PROMOCAO_PRODUTO_INATIVO da Agenda).
      const prods = (await db.selectFrom('produtos').select(['idproduto', 'ativo']).where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number; ativo: string }>;
      const porId = new Map(prods.map((p) => [Number(p.idproduto), p]));
      for (const id of ids) {
        const p = porId.get(id);
        if (!p) throw new BusinessRuleError('PROMOCAO_PRODUTO_INEXISTENTE', { idproduto: id });
        if (p.ativo !== 'S') throw new BusinessRuleError('PROMOCAO_PRODUTO_INATIVO', { idproduto: id });
      }
    }
  },
};

export const PromocaoAggregateController = createAggregateController({
  path: 'cadastro/promocao',
  config: promocaoAggregateConfig,
  schema: promocaoSchema,
  updateSchema: atualizarPromocaoSchema,
});
