import { parceiroSchema, atualizarParceiroSchema } from '@apollo/shared';
import { opcoesConcedidas } from '../../shared/acesso/acesso.service';
import { conferirCampos } from '../../shared/acesso/controles';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { capturarAlteracaoParceiro } from '../sped/sped-alteracoes';

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
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Cadastro de parceiros' },
  // o PARCEIRO é da REDE: o legado não filtra por loja (udmParceiros.dfm:59) e 17.690 de 19.073 têm IDEMPRESA nulo — com o
  // escopo por loja, as lojas 2/50/51 não enxergavam os parceiros dos próprios títulos (auditoria de esqueletos §4.5). A loja da
  // sessão só carimba o parceiro novo.
  empresaScoped: false,
  // e o NewRecord do binário novo: as 5 flags que o legado grava 'N' em todo parceiro novo (500 de 500 em 2026)
  derivarTrx: async ({ dto, emp }) => {
    const out: Record<string, unknown> = emp != null ? { idempresa: emp } : {};
    for (const k of ['soma_st_bonificacao', 'habilita_retencao_senar_nf', 'visualiza_pc_parc', 'participa_cotacao', 'clubefidelidade']) {
      if (dto[k] === undefined) out[k] = 'N';
    }
    return out;
  },
  // a data da última alteração carimbada pela TELA em toda gravação (está no dataset: vai na LOG "Alterou" — 280 de 280 em 2026)
  derivar: () => ({ dtultalteracao: new Date().toISOString() }),
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
    // F3 — configuração fiscal (a tela armazena; cálculo vive a jusante em NF/financeiro)
    'estrangeiro', 'envianfe', 'devolucao_zera_imposto_icmsst', 'irrf', 'apuracao', 'classificacao',
    'habilita_retencao_pis_nf', 'habilita_retencao_cofins_nf', 'habilita_retencao_csll_nf',
    'habilita_retencao_ir_nf', 'habilita_retencao_inss_nf', 'habilita_retencao_issqn_nf',
    'habilita_retencao_funrural_nf', 'perc_aliquota_ir', 'perc_aliquota_issqn', 'codparceiro_ent_issqn',
    // Aba "Dados Fornecedor" (tbsDadosFornecedor) — 28 campos FLAT (contatos de papel fixo + config comercial).
    'codcomprador', 'diretor_comercial', 'email_diretor_comercial', 'fone_diretor_comercial',
    'gerente_comercial', 'email_gerente_comercial', 'fone_gerente_comercial',
    'vendedor_representante', 'email_vendedor_representante', 'fone_vendedor_representante',
    'responsavel_financeiro', 'email_responsavel_financeiro', 'fone_responsavel_financeiro',
    'responsavel_logistico', 'email_responsavel_logistico', 'fone_responsavel_logistico',
    'caracteristica_tributaria', 'pronta_entrega', 'desconto_pedidos', 'valor_acres_fin', 'numero_contrato',
    'regras_tabela_fornecedor', 'prazo_entrega', 'prazo_recebimento', 'prazo_reposicao', 'tipo_fornecedor',
    'retira_fornindex', 'realiza_troca',
    // o perfil do cliente (edtCodPerfilCliente → GET_PERFIL TIPO 'PARCEIRO', uCadClientes.pas:4222) e a data da última alteração.
    // EMPRESAS e IDENTIFICADOR não estão na tela (vêm de outro processo): o UPDATE não os toca.
    'codperfil_parceiro', 'dtultalteracao',
    // o que a tela do binário novo grava e o Apollo não gerenciava (conferir-campos-da-log.py, 2026): as 5 flags de todo parceiro novo,
    // a conta corrente, o parceiro matriz, "todos os pagamentos" e a placa da transportadora
    'soma_st_bonificacao', 'habilita_retencao_senar_nf', 'visualiza_pc_parc', 'participa_cotacao', 'clubefidelidade',
    'codconta', 'codparceiro_matriz', 'todospgtos', 'placa', 'ufplaca',
  ],
  detalhes: [
    {
      tabela: 'parceiros_end',
      // a LOG do endereço (uCadClientes.pas:2121/2135): Inseriu/Alterou com os campos do `cdsEndParceiros`, CHAVE CODPARCEIRO
      log: { tabela: 'PARCEIROS_END', chave: 'CODPARCEIRO', campos: [
        'codend', 'codparceiro', 'endereco', 'numero', 'bairro', 'cidade', 'uf', 'telefone', 'celular', 'fax', 'cnpj_cpf', 'rg_insc', 'cep',
        'complemento', 'ativado', 'endereco_padrao', 'razao', 'tipofj', 'idcidade', 'dtultimalteracao', 'tipo_endereco', 'referencia', 'codpais',
      ] },
      pk: 'codend',
      fk: 'codparceiro',
      chaveNatural: ['tipo_endereco'],
      // "todos os campos" (mig 310): o que o cadastro não gerencia sobrevive ao save (lição 124)
      preservarNaoGerenciadas: true,
      // o CODEND não muda na alteração (udmParceiros: `upWhereKeyOnly`, atualiza no lugar) — PARCEIROS.CODEND, NF e pedido o
      // guardam; o Apollo renumerava a cada PUT (auditoria de esqueletos §4.5: 17.455 NFs de parceiros alterados em 2025-26)
      pkEstavel: true,
      chave: 'enderecos',
      colunas: [
        'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'idcidade', 'uf', 'cep',
        'cnpj_cpf', 'rg_insc', 'telefone', 'celular', 'fax', 'tipo_endereco',
        'endereco_padrao', 'ativado', 'codpais',
      ],
      // o gatilho REM_PARCEIROS (mig 372): o parceiro que muda de ATIVADO leva o valor aos endereços — o regravado aqui acompanha, em vez
      // de voltar com o que a tela carregou
      derivarItensTrx: async (itens, _trx, _emp, header) => {
        const novo = (header as Record<string, unknown> | undefined)?._ativadoMudou;
        return novo === undefined ? itens : itens.map((it) => ({ ...it, ativado: novo }));
      },
    },
    // F2 — sub-recursos 1:N (engine grava todos na mesma transação; substitui no update)
    { tabela: 'parceiros_bancos', pk: 'codparceirobanco', fk: 'codparceiro', chave: 'bancos', colunas: ['codbco', 'agencia', 'nrconta'],
      log: { tabela: 'PARCEIROS_BANCOS', chave: 'CODPARCEIRO', campos: ['codparceiro', 'codparceirobanco', 'codbco', 'nrconta', 'banco', 'agencia', 'cidade', 'uf'] } },
    { tabela: 'parceiros_pgto', pk: 'codparceiros_pgto', fk: 'codparceiro', chave: 'pgtos', chaveNatural: ['idpgto'], preservarNaoGerenciadas: true, colunas: ['idpgto', 'modalidade'] },
    { tabela: 'parceiros_rel', pk: 'codrelacionamento', fk: 'codparceiro', chave: 'relacionamentos', chaveNatural: ['nome'], preservarNaoGerenciadas: true, colunas: ['nome', 'doc1', 'doc2', 'tiporel', 'telefone', 'celular', 'endereco'],
      log: { tabela: 'PARCEIROS_REL', chave: 'CODPARCEIRO', campos: ['codrelacionamento', 'codparceiro', 'tiporel', 'nome', 'doc1', 'doc2', 'telefone', 'celular', 'endereco', 'ativado', 'senha_autpdv'] } },
    { tabela: 'parceiros_vendedores', pk: 'codparceirovendedor', fk: 'codparceiro', chave: 'vendedores', colunas: ['codvendedor'] },
  ],
  colunasPesquisa: ['codparceiro', 'razao', 'fantasia', 'cnpj_cpf', 'cidade', 'uf', 'tipofj', 'cli', 'frn', 'fun', 'tra', 'con'],
  // as senhas do parceiro não saem na leitura: SENHA (57 na produção), SENHA_HASH e SENHA_AUTPDV (203 — a autorização no PDV; no
  // legado o campo é mascarado e só aparece pelo menu "Visualizar senha dados financeiros", que exige a opção)
  colunasOcultasLeitura: ['senha', 'senha_hash', 'senha_autpdv'],
  // o registro 0175 do SPED: nome, documento, município ou endereço do participante mudou (uCadClientes.pas:2113-2114).
  // No UPDATE o `validar` roda na transação do save, antes da troca dos endereços — lê o endereço ainda gravado.
  validar: async ({ dto, id, db }) => {
    // as PERMISSÕES DE CONTROLE do cadastro de clientes (UCadClientes.dfm, form de cadastro): os papéis (cliente, fornecedor,
    // funcionário, convênio, transportadora), o crédito, "livre do indexador" e "realiza troca" desabilitados sem a opção —
    // produção 27/09/2026: 2 de 49 operador×loja sem as de fornecedor/convênio/transportadora/crédito, 5 sem indexador/troca
    if (currentTenant().operadorId != null) {
      const tem = await opcoesConcedidas(db, 'FRMCADCLIENTES');
      const antes = id != null ? ((await db.selectFrom('parceiros').selectAll().where('codparceiro', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined) : undefined;
      conferirCampos(tem, 'FRMCADCLIENTES', dto, antes, [
        // os papéis só na ALTERAÇÃO: na inclusão a tela aberta (clientes, fornecedores…) já traz o seu
        { campo: 'cli', opcao: 'CHBCLIENTE', acao: 'alterar o papel de cliente' },
        { campo: 'frn', opcao: 'CHBFORNECEDOR', acao: 'alterar o papel de fornecedor' },
        { campo: 'fun', opcao: 'CHBFUNCIONARIO', acao: 'alterar o papel de funcionário' },
        { campo: 'con', opcao: 'CHBCONVENIO', acao: 'alterar o papel de convênio' },
        { campo: 'tra', opcao: 'CHBTRANSPORTADORA', acao: 'alterar o papel de transportadora' },
        { campo: 'credito', opcao: 'CCDCREDITO', acao: 'alterar o crédito', padrao: 0, numero: true },
        { campo: 'retira_fornindex', opcao: 'DBLIVREINDEXADOR', acao: 'alterar o "livre do indexador"' },
        { campo: 'realiza_troca', opcao: 'JVDBCHECKBOX1', acao: 'alterar o "realiza troca"' },
      ]);
    }
    if (id != null) await capturarAlteracaoParceiro(db, id, dto);
    // o ATIVADO de antes (o gatilho REM_PARCEIROS cascateia na gravação do cabeçalho; o detalhe de endereços precisa saber que mudou)
    if (id != null && dto.ativado !== undefined) {
      const atual = (await (db as any).selectFrom('parceiros').select('ativado').where('codparceiro', '=', id).executeTakeFirst()) as { ativado?: string | null } | undefined;
      if (atual?.ativado != null && dto.ativado != null && String(atual.ativado) !== String(dto.ativado)) (dto as Record<string, unknown>)._ativadoMudou = dto.ativado;
    }
  },
};

export const ParceiroAggregateController = createAggregateController({
  path: 'cadastro/parceiros',
  config: parceiroAggregateConfig,
  schema: parceiroSchema,
  updateSchema: atualizarParceiroSchema,
});
