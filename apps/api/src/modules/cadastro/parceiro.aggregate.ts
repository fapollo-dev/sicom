import { parceiroSchema, atualizarParceiroSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';

/**
 * PARCEIROS (Cliente/Fornecedor/Funcionário/Transportador/Convênio) — tela UNIFICADA,
 * mestre-detalhe via AggregateEngineService: master `parceiros` + detalhe `parceiros_end`
 * (endereços, onde vivem CNPJ/CPF e RG/IE). Fase 1 = núcleo fiel.
 *
 * - `empresaScoped`: carimba/filtra IDEMPRESA (multi-tenant).
 * - papel: a tela passa `?campo=cli&operador=igual&valor=S` (etc.) p/ filtrar por papel —
 *   por isso cli/frn/fun/tra/con estão em `colunasPesquisa`. Os mesmos filtros alimentam
 *   os lookups de vendedor (fun='S') e convênio (con='S').
 * - "ao menos um papel" é validado no zod (parceiroSchema.superRefine).
 */
export const parceiroAggregateConfig: AggregateConfig = {
  tabela: 'parceiros',
  pk: 'codparceiro',
  view: 'get_parceiros',
  rbacForm: 'FRMCADCLIENTES',
  empresaScoped: true,
  colunas: [
    'razao', 'fantasia', 'tipofj',
    'cli', 'frn', 'fun', 'tra', 'con', 'ass',
    'ativado', 'bloqued',
    'email', 'dtnascimento', 'sexo', 'estado_civil', 'obs',
    'credito', 'txjuro', 'tolerancia', 'descpadrao', 'diasprazo',
    'codvendedor', 'codconvenio', 'codend',
    // F2 — abas condicionais por papel + fiscal essencial
    'venc_prev', 'dtultcompra', 'classfornecedor', 'codref', 'codcontabil_for',
    'limite_especial', 'codcontabil', 'renda', 'cargo', 'empresatrabalha',
    'contribuinte_icms', 'classfiscal',
  ],
  detalhes: [
    {
      tabela: 'parceiros_end',
      pk: 'codend',
      fk: 'codparceiro',
      chave: 'enderecos',
      colunas: [
        'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'idcidade', 'uf', 'cep',
        'cnpj_cpf', 'rg_insc', 'telefone', 'celular', 'fax', 'tipo_endereco',
        'endereco_padrao', 'ativado', 'codpais',
      ],
    },
    // F2 — sub-recursos 1:N (engine grava todos na mesma transação; substitui no update)
    { tabela: 'parceiros_bancos', pk: 'codparceirobanco', fk: 'codparceiro', chave: 'bancos', colunas: ['codbco', 'agencia', 'nrconta'] },
    { tabela: 'parceiros_pgto', pk: 'codparceiros_pgto', fk: 'codparceiro', chave: 'pgtos', colunas: ['idpgto', 'modalidade'] },
    { tabela: 'parceiros_rel', pk: 'codrelacionamento', fk: 'codparceiro', chave: 'relacionamentos', colunas: ['nome', 'doc1', 'doc2', 'tiporel', 'telefone', 'celular', 'endereco'] },
    { tabela: 'parceiros_vendedores', pk: 'codparceirovendedor', fk: 'codparceiro', chave: 'vendedores', colunas: ['codvendedor'] },
  ],
  colunasPesquisa: ['codparceiro', 'razao', 'fantasia', 'cnpj_cpf', 'cidade', 'uf', 'cli', 'frn', 'fun', 'tra', 'con'],
};

export const ParceiroAggregateController = createAggregateController({
  path: 'cadastro/parceiros',
  config: parceiroAggregateConfig,
  schema: parceiroSchema,
  updateSchema: atualizarParceiroSchema,
});
