/**
 * Configuração declarativa de um CRUD de tabela única — o "engine" lê isto e
 * implementa read/list/create/update/delete herdando a fundação (auditoria,
 * soft/hard-delete, outbox, view de listagem). Telas triviais viram ~config,
 * não um vertical copiado (espírito da ADR-014 / contrato do form-base TfrmCadMaster).
 */
export interface CrudConfig {
  /** tabela física (snake_case), ex.: 'marcas' */
  tabela: string;
  /** coluna PK, ex.: 'idmarca' */
  pk: string;
  /**
   * PK gerada pelo banco (sequence). Default: true. Em cadastros de CHAVE NATURAL
   * (ex.: NCM, CFOP, CST), o usuário digita o código → false: o create insere a PK
   * vinda do dto, sem sequence.
   */
  pkGerada?: boolean;
  /** view de listagem, ex.: 'get_marcas' */
  view: string;
  /** colunas editáveis pelo usuário (delta), ex.: ['descricao'] */
  colunas: string[];
  /** nome do form p/ RBAC (PossuiAcessoForm), ex.: 'FRMCADMARCAS' */
  rbacForm: string;
  /** soft-delete via INDR (legado): excluir marca INDR='E' e a lista filtra. Default: hard-delete. */
  softDelete?: boolean;
  /**
   * Tabela tem IDEMPRESA (escopo multi-tenant por empresa, ex.: CONTAS_BANCARIAS).
   * Quando true: o create CARIMBA `idempresa = currentTenant().empresaId` (fail-closed —
   * sem empresa no contexto a coluna NOT NULL barra a escrita), e read/list FILTRAM por
   * empresa. A view de listagem precisa expor `idempresa`. Default: false (tabela global).
   */
  empresaScoped?: boolean;
  /** gera evento de replicação no outbox (como BANCOS tem REM_*). Default: false. */
  replica?: boolean;
  /** carimba USULTALTERACAO/DTULTIMALTERACAO/DTCADASTRO. Default: true. */
  audit?: boolean;
  /**
   * grava HISTORICO_DINAMICO (SetaHistorico_Dinamico): 1 linha por campo alterado
   * em toda gravação/exclusão. Default: true (o form-base faz para todo cadastro).
   */
  historico?: boolean;
  /** colunas da view filtráveis/ordenáveis na Pesquisa (whitelist — anti-injection). */
  colunasPesquisa?: string[];
  /**
   * Campos DERIVADOS server-side (espelha derivações do BeforePost/OnValidate do legado,
   * ex.: NCM grava NCMSH = ConcatenaLeft(CODIGO,8,'0')). Recebe o dto (e a PK no update)
   * e retorna os valores a sobrepor ANTES do delta — o usuário nunca os digita.
   * As colunas derivadas devem estar em `colunas` para serem persistidas.
   */
  derivar?: (dto: Record<string, unknown>, id?: number) => Record<string, unknown>;
}

/**
 * Detalhe de um agregado mestre-detalhe (espelha um ClientDataSet de detalhe do
 * TfrmCadMasterDet). Ex.: itens_lotecob (pk codilotcob, fk codlotecob → master).
 */
export interface DetalheConfig {
  tabela: string; // tabela do detalhe, ex.: 'itens_lotecob'
  pk: string; // pk do detalhe (gerada), ex.: 'codilotcob'
  fk: string; // coluna que aponta ao master, ex.: 'codlotecob'
  colunas: string[]; // colunas editáveis do item, ex.: ['codrcb']
  /** propriedade no dto/registro que carrega o array de itens (ex.: 'itens') */
  chave: string;
  /**
   * Chave NATURAL do detalhe (colunas que identificam a linha ALÉM da fk), ex.: ['idempresa']
   * p/ ESTOQUE. Usada com `preservar` para casar a linha do dto com a existente no banco
   * durante o substitute (delete+insert).
   */
  chaveNatural?: string[];
  /**
   * Colunas cujo valor é OWNED pelo banco — movidas por OUTRO processo (ex.: `estoque.qtde`,
   * movido pela NF no processamento/F3) — e que NÃO podem ser regravadas pelo valor do cliente
   * no substitute. São lidas da linha existente (casada por `chaveNatural`, com lock) e
   * carregadas adiante, evitando LOST-UPDATE do saldo. Sem isso, o save do cadastro clobberia
   * o saldo movido pela NF. Requer `chaveNatural`.
   */
  preservar?: string[];
}

/**
 * Config de um CRUD MESTRE-DETALHE: o master é uma CrudConfig + N detalhes.
 * O agregado (header + itens) é gravado/excluído numa ÚNICA transação (contrato
 * TfrmCadMasterDet, recon §5b): validação e itens junto do master; cascata na exclusão.
 */
export interface AggregateConfig extends CrudConfig {
  detalhes: DetalheConfig[];
  /**
   * Validação de REGRA DE NEGÓCIO cross-row ANTES de gravar (espelha checagens do btnGravar
   * do legado que consultam outras tabelas). Recebe o dto, o id (no update) e um db de leitura;
   * deve LANÇAR (ex.: BusinessRuleError) p/ bloquear. Ex.: Produto não pode ser desativado se é
   * componente de algum kit (COMPOSICAO.idproduto_01). Roda no create e no update, antes da escrita.
   */
  validar?: (ctx: { dto: Record<string, unknown>; id?: number; db: any }) => Promise<void> | void;
}

/** Operadores da Pesquisa (espelham os TTipoPesquisa do frmPesquisa). */
export type OperadorPesquisa = 'contem' | 'comeca' | 'igual' | 'diferente' | 'maior' | 'menor';

/** rdgAtivo do form-base (F6): ativos → inativos(excluídos) → todos. */
export type SituacaoRegistro = 'ativos' | 'inativos' | 'todos';

/** Filtro da Pesquisa: campo + operador + valor, ordenação e situação (rdgAtivo). */
export interface PesquisaQuery {
  campo?: string;
  operador?: OperadorPesquisa;
  valor?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  /** rdgAtivo (F6): default 'ativos'. Tem precedência sobre incluirExcluidos. */
  situacao?: SituacaoRegistro;
  incluirExcluidos?: boolean; // legado: equivale a situacao='todos'
  limite?: number;
}
