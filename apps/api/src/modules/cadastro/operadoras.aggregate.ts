import { operadoraSchema, atualizarOperadoraSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * OPERADORAS (FRMCADOPERADORAS) — administradora/adquirente de cartão (Cielo/Rede/…) por produto (crédito/débito/
 * voucher). Cadastro GLOBAL (não empresaScoped) com os parâmetros econômicos (TXADM %, DIASCOMP) + detalhe
 * `operadoras_taxa` = override POR EMPRESA (mestre-detalhe). Alimenta o líquido/vencimento computados em get_cartao.
 * soft-delete INDR.
 */
export const operadorasAggregateConfig: AggregateConfig = {
  tabela: 'operadoras',
  pk: 'codoperadoras',
  view: 'get_operadoras',
  rbacForm: 'FRMCADOPERADORAS',
  empresaScoped: false, // cadastro global; o override por empresa vive em operadoras_taxa
  softDelete: true,
  colunas: ['operadora', 'txadm', 'txadmparc', 'diascomp', 'tipo', 'tipocartao', 'codbandeira', 'codadm', 'codbanco', 'codoperadorabase', 'ativo'],
  colunasPesquisa: ['codoperadoras', 'operadora', 'tipo', 'ativo'],
  detalhes: [
    {
      tabela: 'operadoras_taxa',
      pk: 'idoperadorastaxa',
      fk: 'codoperadoras',
      chave: 'itens',
      colunas: ['idempresa', 'txadm', 'diafechamento'],
    },
  ],
  derivarTrx: async () => ({ usucadastro: currentTenant().operadorId ?? null, usultalteracao: currentTenant().operadorId ?? null }),
  // fold auditoria inline [BAIXA]: 2 overrides p/ a MESMA empresa violariam o UNIQUE(codoperadoras,idempresa) no
  // reinsert (delete+insert do detalhe) → erro cru. Rejeita cedo com mensagem de domínio.
  validar: async ({ dto }) => {
    const itens = Array.isArray(dto.itens) ? (dto.itens as Array<Record<string, unknown>>) : [];
    const emps = itens.map((i) => Number(i.idempresa)).filter((n) => Number.isInteger(n));
    if (new Set(emps).size !== emps.length) throw new BusinessRuleError('OPERADORA_TAXA_EMPRESA_DUPLICADA');
  },
};

export const OperadorasAggregateController = createAggregateController({
  path: 'cadastro/operadoras',
  config: operadorasAggregateConfig,
  schema: operadoraSchema,
  updateSchema: atualizarOperadoraSchema,
});
