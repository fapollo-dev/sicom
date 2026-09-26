import { sql } from 'kysely';
import { empresaSchema, atualizarEmpresaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import { EMPRESA_CAMPOS_LEGADO, UFS } from '@apollo/shared';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/** o valor que vai ficar gravado: o do dto quando veio, senão o da linha (o PUT é parcial; o legado confere o registro inteiro) */
const valorFinal = (dto: Record<string, unknown>, atual: Record<string, unknown> | undefined, col: string): unknown =>
  dto[col] !== undefined ? (dto[col] === '' ? null : dto[col]) : atual?.[col] ?? null;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * As regras do gravar do legado (UCadEmpresa.pas btnGravarClick:1303-1341), na ordem dele — as que leem o banco ou o registro inteiro
 * (o CNPJ e a margem de contribuição, que só olham o próprio campo, estão no schema):
 *  1. `Preenchido(1)`: a curva ABC fecha 100%. O fonte de 2020 soma A+B+C; o binário da produção soma também as faixas novas — a LOG
 *     prova: até 24/02/2025 todo gravar tinha A+B+C = 100 (e a faixa D, recém-criada, entrou somando 105 sem bloqueio); de 07/03/2025
 *     em diante são 60 gravações com A+B+C = 90 e A+B+C+D = 100 (empresas 1, 2 e 52: 60/20/10/10), nenhuma com a soma das faixas ≠ 100.
 *     A faixa E está vazia nas 5 lojas (entra na soma — vazia vale 0).
 *  2. `Preenchido(7)`: o centro de custo das taxas de cartão, quando informado, é de DESPESA (PLC.TPCONTA = 1; na produção: 305).
 *  3. cidade + UF conferem com a tabela do IBGE (CIDADES por CIDADE e IDUF da sigla).
 *  4. `FormaPgtoValida` (só na alteração): a forma de pagamento da quebra de caixa existe, tem destino QUE e é da própria empresa.
 *  5. `ContigenciaNFC`: o início não é depois do fim, o período não passa de 5 dias e, com início ≠ fim, o motivo tem 14+ caracteres.
 * Produção conferida em 25/09/2026 (só leitura): as 5 empresas passam nas 5 regras.
 */
async function validarGravar(trx: any, id: number | undefined, dto: Record<string, unknown>): Promise<void> {
  const atual = id != null ? ((await trx.selectFrom('empresas').selectAll().where('idempresa', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined) : undefined;
  const v = (col: string) => valorFinal(dto, atual, col);

  const curva = ['a', 'b', 'c', 'd', 'e'].reduce((s, f) => s + num(v(`pc_curva_abc_${f}`)), 0);
  if (Math.round(curva * 100) !== 10000) throw new BusinessRuleError('EMPRESA_CURVA_ABC_100', { soma: curva });

  const plcTaxas = num(v('codplc_taxas_cartao'));
  if (plcTaxas > 0) {
    const plc = (await trx.selectFrom('plc').select('tpconta').where('codplc', '=', plcTaxas).executeTakeFirst()) as { tpconta?: unknown } | undefined;
    if (Number(plc?.tpconta ?? 0) !== 1) throw new BusinessRuleError('EMPRESA_PLC_TAXAS_NAO_DESPESA', { codplc_taxas_cartao: plcTaxas });
  }

  const uf = UFS.find((u) => u.sigla === String(v('uf') ?? '').trim());
  if (uf) {
    const cidade = String(v('cidade') ?? '');
    const achou = await trx.selectFrom('cidades').select('idcidade').where('cidade', '=', cidade).where('iduf', '=', uf.iduf).executeTakeFirst();
    if (!achou) throw new BusinessRuleError('EMPRESA_CIDADE_IBGE', { cidade, uf: uf.sigla });
  }

  const idpgto = num(v('idpgto'));
  if (idpgto !== 0 && id != null) {
    const fp = (await trx.selectFrom('formas_pgto').select(['idempresa', 'destino']).where('idpgto', '=', idpgto).executeTakeFirst()) as
      { idempresa?: unknown; destino?: string | null } | undefined;
    if (!fp) throw new BusinessRuleError('EMPRESA_FORMA_PGTO_INEXISTENTE', { idpgto });
    if (String(fp.destino ?? '').trim() !== 'QUE') throw new BusinessRuleError('EMPRESA_FORMA_PGTO_NAO_QUEBRA', { idpgto });
    if (Number(fp.idempresa) !== id)
      throw new BusinessRuleError('EMPRESA_FORMA_PGTO_OUTRA_EMPRESA', { idpgto, idempresa: id }, `A forma de pagamento não pertence à empresa ${id}.`);
  }

  const ini = v('dtcontingencia_inicio_nfc'), fim = v('dtcontingencia_fim_nfc');
  if (ini != null && fim != null) {
    const ti = new Date(String(ini instanceof Date ? ini.toISOString() : ini)).getTime();
    const tf = new Date(String(fim instanceof Date ? fim.toISOString() : fim)).getTime();
    if (!Number.isNaN(ti) && !Number.isNaN(tf)) {
      if (ti > tf) throw new BusinessRuleError('EMPRESA_CONTINGENCIA_INICIO_APOS_FIM');
      if (tf - ti > 5 * 86_400_000) throw new BusinessRuleError('EMPRESA_CONTINGENCIA_LONGA');
      if (ti !== tf && String(v('motivo_contingencia_nfc') ?? '').trim().length < 14) throw new BusinessRuleError('EMPRESA_CONTINGENCIA_MOTIVO');
    }
  }
}

/**
 * EMPRESAS — cadastro da empresa/tenant (corte 1: núcleo + fiscal + precificação/financeiro).
 * DECLARATIVO via engine CRUD. A empresa É o tenant: `idempresa` (= CODEMPRESA) é a PK DIGITADA
 * (`pkGerada:false`) e a tabela **NÃO é empresaScoped** (o schema-per-tenant já isola; filtrar
 * `WHERE idempresa=atual` esconderia as demais empresas do tenant). Consolida o stub `empresa_fiscal`
 * (F6) — os reads da NFe foram repontados p/ esta tabela.
 *
 * As regras do gravar que leem o banco: `validarGravar` acima. Os campos do legado que a tela não tinha: `empresa-legado.ts`.
 */
export const empresasCrudConfig: CrudConfig = {
  tabela: 'empresas',
  pk: 'idempresa',
  pkGerada: false, // CODEMPRESA é digitado (não há sequence)
  empresaScoped: false, // a tabela É a empresa; o schema-per-tenant isola
  view: 'get_empresas',
  rbacForm: 'FRMCADEMPRESA',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Cadastro de empresas', chave: 'CODEMPRESA' },
  colunas: [
    'razao_social', 'fantasia', 'cnpj', 'insc', 'im',
    'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep', 'fone1', 'idcidade', 'cuf',
    'classfiscal', 'figurafiscal', 'contribuinte_icms', 'alqsimplesnac', 'serie_nfe', 'tiponfe', 'ambiente',
    'piscofis', 'imprenda', 'contsocial', 'aliquota_estado',
    'despoperacional', 'margem_venda', 'margem_contribuicao', 'txjuropadrao', 'tx_juro_apagar', 'descmax', 'limite_descmax',
    // os parâmetros que a produção altera e que o Apollo LÊ (auditoria de esqueletos §4.15: 78 alterações no LOG de 2025-26 sem
    // editor em módulo nenhum — o CODPLC_JUROS_PAGOS que a baixa lê ninguém conseguia manter)
    'ccmultajuros', 'codplc_juros_pagos', 'codplc_acrescimos_pagos', 'codplc_descontos_recebidos', 'codplc_descontos_concedidos',
    'codparceiro', 'sincroniza_preco_nf',
    'pc_curva_abc_a', 'pc_curva_abc_b', 'pc_curva_abc_c', 'pc_curva_abc_d', 'pc_curva_abc_e', 'pc_curva_comp_a', 'pc_curva_comp_b', 'pc_curva_comp_c',
    'aream2', 'aream2_venda', 'tef_loja', 'tef_servidor', 'junta_comercial', 'codplc_nf_pdv', 'idsituacao_nf_pdv',
    // os campos do UCadEmpresa (e do binário novo) que a tela não tinha — `empresa-legado.ts` do shared (186 colunas)
    ...EMPRESA_CAMPOS_LEGADO.map((c) => c.coluna),
  ], // NÃO inclui idempresa (PK digitada, fornecida no dto)
  // senhas de certificado/e-mail, tokens e CSC: graváveis, nunca devolvidos na leitura
  colunasOcultasLeitura: EMPRESA_CAMPOS_LEGADO.filter((c) => c.segredo).map((c) => c.coluna),
  colunasPesquisa: ['idempresa', 'razao_social', 'cnpj', 'uf', 'classfiscal'],
  softDelete: false,
  replica: false,
  validarTrx: ({ trx, id, dto }) => validarGravar(trx, id, dto),
  // a empresa NOVA ganha ESTOQUE e ESTOQUE_DEP zerados para todos os produtos (`SetaEstoque(teEstoque|teDeposito, 0, taEmpresa)`,
  // UCadEmpresa.pas:1345-1351) — sem isso, o produto não tem linha de estoque na loja nova e toda movimentação dela falha
  aposGravarTrx: async ({ trx, id, criado }) => {
    if (!criado) return;
    await sql`INSERT INTO estoque (idproduto, idempresa, qtde, minimo, maximo)
              SELECT p.idproduto, ${id}, 0, 0, 0 FROM produtos p
               WHERE NOT EXISTS (SELECT 1 FROM estoque e WHERE e.idproduto = p.idproduto AND e.idempresa = ${id})`.execute(trx);
    await sql`INSERT INTO estoque_dep (idproduto, idempresa, qtde, minimo, maximo)
              SELECT p.idproduto, ${id}, 0, 0, 0 FROM produtos p
               WHERE NOT EXISTS (SELECT 1 FROM estoque_dep d WHERE d.idproduto = p.idproduto AND d.idempresa = ${id})`.execute(trx);
  },
};

export const EmpresasCrudController = createCrudController({
  path: 'cadastro/empresas',
  config: empresasCrudConfig,
  schema: empresaSchema,
  updateSchema: atualizarEmpresaSchema,
});
