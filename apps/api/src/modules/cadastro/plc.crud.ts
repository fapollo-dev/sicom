import { sql } from 'kysely';
import { plcSchema, atualizarPlcSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/** os usos que impedem excluir o centro de custo (`CentroCustoUtilizado`, uCadPLC.pas:262-285): tabela, coluna e onde */
const USOS: Array<[string, string, string]> = [
  ['caixa', 'codplc', 'em lançamentos financeiros'],
  ['areceber', 'codplc', 'em contas a receber'],
  ['cx_apagar', 'codcc', 'em contas a pagar'],
  ['formas_pgto', 'plccofre', 'nas formas de pagamento'],
  ...['contacmv', 'codplc_taxas_cartao', 'codplc_voucher', 'codplc_recarga', 'codplc_correspondente', 'codplc_juros_pagos', 'codplc_acrescimos_pagos',
    'codplc_descontos_recebidos', 'codplc_juros_recebidos', 'codplc_acrescimos_recebidos', 'codplc_descontos_concedidos', 'codplc_taxa_cartao_paga',
    'codplc_trocosolidario'].map((c): [string, string, string] => ['empresas', c, 'no cadastro de empresas']),
  ['contacorrente', 'codplc', 'no cadastro de PDVs'],
  ['contas_bancarias', 'codlanccontabil', 'no cadastro de contas correntes'],
  ['apagar_bx', 'codplc_acredesc', 'na baixa de contas a pagar'],
  ['apagar_bx', 'codplc_juros', 'na baixa de contas a pagar'],
  ['areceber_bx', 'codplc_acredesc', 'na baixa de contas a receber'],
  ['areceber_bx', 'codplc_juros', 'na baixa de contas a receber'],
];

/**
 * Cadastro do Centro de Custos (PLC; uCadPLC) — o plano gerencial em árvore. As regras da tela:
 *  - o código da conta é único (`CDS.Locate('DESCCODPLC')`, uCadPLC.pas:607: "Já existe uma conta cadastrada com o número informado!");
 *  - a conta raiz tem código de até 2 caracteres (:626); a derivada começa pelo código do pai (btnGravarClick, :368);
 *  - o NIVELCONTA vem do pai (+1; raiz = 1, :376) e a descrição da conta contábil, da conta escolhida (`edtLancContabilExit`, :521);
 *  - o código é gerado (`GetID('CODPLC')`); excluir é recusado com conta filha ou com o centro de custo em uso (:220-290) e é lógico (INDR).
 * Os motivos de operação (PLC_MOTIVO_OPERACAO) ficam de fora: a tabela está vazia na produção.
 */
export const plcCrudConfig: CrudConfig = {
  tabela: 'plc',
  pk: 'codplc',
  view: 'get_plc',
  colunas: [
    'desccodplc', 'descricao', 'codpai', 'tpconta', 'nivelconta', 'codcontabil', 'descplccontabil',
    'apenas_proprietario', 'flg_uso_setor', 'nao_mostrar_scrap_rel_partset', 'flg_perda', 'plc_obriga_motivo_perda', 'limiteplc',
  ],
  rbacForm: 'FRMCADPLC',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Cadastro do Centro de Custos' },
  softDelete: true,
  replica: false,
  historico: false,
  colunasPesquisa: ['codplc', 'desccodplc', 'descricao'],
  derivar: (dto) => {
    const out: Record<string, unknown> = {};
    for (const k of ['codpai', 'tpconta', 'codcontabil']) if (dto[k] === '') out[k] = null;
    return out;
  },
  validarTrx: async ({ trx, id, dto }) => {
    const atual = id != null ? ((await trx.selectFrom('plc').selectAll().where('codplc', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined) : undefined;
    const cod = dto.desccodplc !== undefined ? String(dto.desccodplc ?? '').trim() : String(atual?.desccodplc ?? '');
    if (dto.desccodplc !== undefined && cod !== String(atual?.desccodplc ?? '')) {
      let q = trx.selectFrom('plc').select('codplc').where('desccodplc', '=', cod).where(sql`coalesce(indr, 'I')`, '<>', 'E');
      if (id != null) q = q.where('codplc', '<>', id);
      if (await q.executeTakeFirst()) throw new BusinessRuleError('PLC_CODIGO_EXISTE', { desccodplc: cod });
    }
    const codpai = dto.codpai !== undefined ? (dto.codpai === '' || dto.codpai == null ? null : Number(dto.codpai)) : (atual?.codpai == null ? null : Number(atual.codpai));
    if (codpai != null) {
      if (id != null && codpai === id) throw new BusinessRuleError('PLC_PAI_INVALIDO', { codpai });
      const pai = (await trx.selectFrom('plc').select(['desccodplc', 'nivelconta']).where('codplc', '=', codpai).where(sql`coalesce(indr, 'I')`, '<>', 'E').executeTakeFirst()) as
        { desccodplc?: string | null; nivelconta?: unknown } | undefined;
      if (!pai) throw new BusinessRuleError('PLC_PAI_INVALIDO', { codpai });
      const prefixo = String(pai.desccodplc ?? '');
      if (!cod.startsWith(prefixo)) throw new BusinessRuleError('PLC_CODIGO_PREFIXO_PAI', { prefixo });
      dto.nivelconta = Number(pai.nivelconta ?? 0) + 1;
    } else {
      if (cod.replace(/\D/g, '').length > 2 && (dto.desccodplc !== undefined || dto.codpai !== undefined)) throw new BusinessRuleError('PLC_CODIGO_RAIZ');
      dto.nivelconta = 1;
    }
    if (dto.codcontabil !== undefined && dto.codcontabil !== '' && dto.codcontabil != null) {
      const conta = (await trx.selectFrom('plano_contas').select('descricao').where('codplanocontas', '=', Number(dto.codcontabil)).executeTakeFirst()) as { descricao?: string } | undefined;
      if (!conta) throw new BusinessRuleError('PLC_CONTA_CONTABIL_INVALIDA', { codcontabil: dto.codcontabil });
      dto.descplccontabil = conta.descricao ?? null;
    } else if (dto.codcontabil === '') {
      dto.descplccontabil = null;
    }
  },
  validarRemocaoTrx: async ({ trx, id }) => {
    const filha = await trx.selectFrom('plc').select('codplc').where('codpai', '=', id).where(sql`coalesce(indr, 'I')`, '<>', 'E').executeTakeFirst();
    if (filha) throw new BusinessRuleError('PLC_TEM_FILHAS', { codplc: id });
    for (const [tabela, coluna, onde] of USOS) {
      const usado = await trx.selectFrom(tabela).select(sql`1`.as('x')).where(coluna, '=', id).limit(1).executeTakeFirst();
      if (usado) throw new BusinessRuleError('PLC_EM_USO', { codplc: id, onde });
    }
  },
};

export const PlcCrudController = createCrudController({
  path: 'cadastro/plc',
  config: plcCrudConfig,
  schema: plcSchema,
  updateSchema: atualizarPlcSchema,
});
