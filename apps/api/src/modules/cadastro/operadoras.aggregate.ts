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
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Operadoras de Cartão' },
  empresaScoped: false, // cadastro global; o override por empresa vive em operadoras_taxa
  softDelete: true,
  // todas as colunas da OPERADORAS que a tela do legado (e o binário novo) gravam
  colunas: ['operadora', 'txadm', 'txadmparc', 'diascomp', 'tipo', 'tipocartao', 'codbandeira', 'codadm', 'codbanco', 'codoperadorabase', 'ativo',
    'txgestao', 'txanuidade', 'diafechamento', 'obs', 'empresas', 'pos', 'operadora_pdv', 'codrede', 'flg_validar_nsu', 'smart_tef'],
  colunasPesquisa: ['codoperadoras', 'operadora', 'tipo', 'ativo'],
  detalhes: [
    {
      tabela: 'operadoras_taxa',
      pk: 'idoperadorastaxa',
      fk: 'codoperadoras',
      chave: 'itens',
      chaveNatural: ['idempresa'],
      // idem (lição 124)
      preservarNaoGerenciadas: true,
      colunas: ['idempresa', 'txadm', 'diafechamento', 'txgestao', 'txanuidade', 'txantecipacao'],
    },
  ],
  derivarTrx: async () => ({ usucadastro: currentTenant().operadorId ?? null, usultalteracao: currentTenant().operadorId ?? null }),
  // fold auditoria inline [BAIXA]: 2 overrides p/ a MESMA empresa violariam o UNIQUE(codoperadoras,idempresa) no
  // reinsert (delete+insert do detalhe) → erro cru. Rejeita cedo com mensagem de domínio.
  validar: async ({ dto, id }) => {
    // o btnGravarClick do UcadOperadoras: Operadora PDV, o tipo TEF e a rede TEF são obrigatórios (o `not X > 0` do Delphi é o NOT
    // bit a bit: na prática só barra o vazio — o 0 do cheque passa)
    const vazio = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    // na inclusão os três; na alteração, os que vieram (o que não veio fica como está)
    const exige = (k: string) => id == null || k in dto;
    if (exige('operadora_pdv') && vazio(dto.operadora_pdv)) throw new BusinessRuleError('OPERADORA_PDV_OBRIGATORIA');
    if (exige('tipocartao') && vazio(dto.tipocartao)) throw new BusinessRuleError('OPERADORA_TIPO_TEF_OBRIGATORIO');
    if (exige('codrede') && vazio(dto.codrede)) throw new BusinessRuleError('OPERADORA_REDE_TEF_OBRIGATORIA');
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
