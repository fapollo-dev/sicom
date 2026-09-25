import { empresaSchema, atualizarEmpresaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * EMPRESAS — cadastro da empresa/tenant (corte 1: núcleo + fiscal + precificação/financeiro).
 * DECLARATIVO via engine CRUD. A empresa É o tenant: `idempresa` (= CODEMPRESA) é a PK DIGITADA
 * (`pkGerada:false`) e a tabela **NÃO é empresaScoped** (o schema-per-tenant já isola; filtrar
 * `WHERE idempresa=atual` esconderia as demais empresas do tenant). Consolida o stub `empresa_fiscal`
 * (F6) — os reads da NFe foram repontados p/ esta tabela.
 *
 * Adiado (dossiê UCadEmpresa.md): certificado/CSC/NFC-e/CTe/MDFe, integrações/tokens, e-mail,
 * contingência, contábil/centros-de-custo, master-details (contabilista/rede), camada de config
 * chave-valor (AMBIENTE_NF/APROVEITAMENTO_CREDITO_ICMSST_NF...).
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
    'pc_curva_abc_a', 'pc_curva_abc_b', 'pc_curva_abc_c', 'pc_curva_comp_a', 'pc_curva_comp_b', 'pc_curva_comp_c',
    'aream2', 'aream2_venda', 'tef_loja', 'tef_servidor', 'junta_comercial', 'codplc_nf_pdv', 'idsituacao_nf_pdv',
  ], // NÃO inclui idempresa (PK digitada, fornecida no dto)
  colunasPesquisa: ['idempresa', 'razao_social', 'cnpj', 'uf', 'classfiscal'],
  softDelete: false,
  replica: false,
};

export const EmpresasCrudController = createCrudController({
  path: 'cadastro/empresas',
  config: empresasCrudConfig,
  schema: empresaSchema,
  updateSchema: atualizarEmpresaSchema,
});
