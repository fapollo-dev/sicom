import { contaBancariaSchema, atualizarContaBancariaSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * Contas Bancárias (UCadContasBancarias) — MESTRE-DETALHE (AggregateEngineService). Versão completa: a aba mestre
 * "Contas Correntes" (17 colunas, FK→BANCOS, escopo por empresa) + as DUAS partes antes deferidas, agora que
 * PLANO_CONTAS e OPERADORES migraram:
 *  - LOOKUP Plano de Contas: `codlanccontabil` → PLANO_CONTAS (validado: CLASSE='ANALITICA' AND TIPO='EMPRESA',
 *    fiel a GET_PLANO_CONTAS/SegPlanoContas). Só valida quando informado (campo opcional).
 *  - aba "Liberação de operadores": detalhe `contas_bancarias_op` (chave 'operadores') — quem baixa CR/CP por essa
 *    conta. Substitute no PUT (delete+insert). Dedup por operador (UNIQUE codconta+codoperador).
 *
 * Exclusão: o legado usa a flag ATIVO (não INDR) → hard-delete (softDelete:false); a ponte cai na cascata.
 */
export const contasBancariasCrudConfig: AggregateConfig = {
  tabela: 'contas_bancarias',
  pk: 'codconta',
  view: 'get_contas_bancarias',
  empresaScoped: true, // carimba idempresa no create; filtra read/list por empresa
  colunas: [
    'codbco', 'titular', 'nroconta', 'gerente', 'dtabertura', 'fone1', 'obs', 'codlanccontabil',
    'convenio', 'carteira_cobranca', 'variacao_carteira', 'tipo_cobranca', 'codigo_transmissao_cobranca',
    'nroconvenio_arqrem', 'conta_propria', 'exibe_rel_apuracao_caixa', 'ativo',
  ], // NÃO inclui idempresa (carimbado) nem codconta (PK gerada)
  rbacForm: 'FRMCADCONTASBANCARIAS',
  colunasPesquisa: ['codconta', 'banco', 'titular', 'nroconta', 'gerente', 'ativo'],
  softDelete: false, // legado usa flag ATIVO → hard-delete (detalhe cai na cascata do engine)
  replica: false,
  detalhes: [
    // liberação de operadores (ponte conta↔operador; PK surrogate; substitute no update).
    { tabela: 'contas_bancarias_op', pk: 'codrelacao', fk: 'codconta', chave: 'operadores', colunas: ['codoperador', 'cbo_baixa_cr', 'cbo_baixa_cp'] },
  ],
  validar: async ({ dto, id, db }) => {
    // lookup Plano de Contas (só quando informado): conta de lançamento tem de ser ANALÍTICA de EMPRESA.
    const raw = dto.codlanccontabil != null ? String(dto.codlanccontabil).trim() : '';
    if (raw !== '') {
      // fold auditoria [ALTA]: no UPDATE, só valida se o valor MUDOU — reenviar o codlanccontabil já gravado (o
      // que o form faz a cada save) não pode re-bloquear uma conta cuja conta contábil foi configurada antes.
      let mudou = true;
      if (id != null) {
        const atual = (await db.selectFrom('contas_bancarias').select('codlanccontabil').where('codconta', '=', id).executeTakeFirst()) as { codlanccontabil?: string } | undefined;
        mudou = String(atual?.codlanccontabil ?? '').trim() !== raw;
      }
      if (mudou) {
        const conta = Number(raw);
        const plc =
          Number.isInteger(conta) && conta > 0
            ? await db.selectFrom('plano_contas').select('codplanocontas').where('codplanocontas', '=', conta).where('classe', '=', 'A').where('tipo', '=', 'E').executeTakeFirst()
            : undefined;
        if (!plc) throw new BusinessRuleError('CONTA_CONTABIL_INVALIDA', { codlanccontabil: raw });
      }
    }
    // dedup dos operadores liberados (a UNIQUE também barra, mas erro claro no gravar).
    const ops = (dto.operadores as Array<{ codoperador: number }> | undefined) ?? [];
    const vistos = new Set<number>();
    for (const o of ops) {
      const k = Number(o.codoperador);
      if (vistos.has(k)) throw new BusinessRuleError('CONTA_OPERADOR_DUPLICADO', { codoperador: k });
      vistos.add(k);
    }
  },
};

export const ContasBancariasCrudController = createAggregateController({
  path: 'cadastro/contas-bancarias',
  config: contasBancariasCrudConfig,
  schema: contaBancariaSchema,
  updateSchema: atualizarContaBancariaSchema,
});
