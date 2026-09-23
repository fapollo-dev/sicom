import type { LogConfig } from '../log/registro-log';
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
  /**
   * Coluna CSV de empresas que TAMBÉM enxergam o registro, além da dona (`idempresa`) — ex.: `pedidocompra.empresas`,
   * as lojas participantes do pedido multi-loja ('1, 2'; o legado habilita as ações para a loja que está nela,
   * `PedidoPertenceEmpresaSelecionada`). Com `empresaScoped`, read/list/posse passam a aceitar a empresa do contexto
   * quando ela está na lista. A view de listagem precisa expor a coluna. Sem ela, nada muda.
   */
  empresasColuna?: string;
  /**
   * grava a LOG do legado a cada gravação (o "Registros de Log" que a tela mostra — uCadMaster.pas:485, TLog.GravaLog
   * com o DataSet): o título da tela e, quando diferem das nossas, a tabela e a coluna-chave do legado.
   */
  log?: LogConfig;
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
   * Colunas da TABELA BASE que NÃO devem sair no read por-id / echo de POST/PUT (o `read()` faz `selectAll`
   * na base, que pode conter segredos que a allowlist `colunas` de escrita não filtra). Ex.: ['senha_hash']
   * em `operadores` — material de credencial nunca trafega ao cliente. A view de listagem já não as expõe.
   */
  colunasOcultasLeitura?: string[];
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
  /**
   * PRESERVA AS COLUNAS QUE O AGREGADO NÃO GERENCIA (lição 124). O motor regrava os detalhes (delete+insert) e só
   * escreve `colunas` — tudo mais que a linha tinha (o que a carga trouxe, o que outro processo gravou) SUMIRIA no
   * primeiro save. Com esta opção, cada item novo herda as colunas não gerenciadas da linha antiga casada por
   * `chaveNatural` (na ordem de ocorrência — o mesmo produto duas vezes casa 1ª com 1ª). Item sem par fica como veio.
   * Requer `chaveNatural`.
   */
  preservarNaoGerenciadas?: boolean;
  /**
   * Enriquecimento ASSÍNCRONO/TRANSACIONAL de cada item ANTES do insert (o análogo por-linha do
   * `derivarTrx` do master). Recebe os itens, a `trx` e a empresa; devolve os itens com colunas
   * derivadas do banco. Uso: CONGELAR o custo do item (nf_prod.vl_custo = snapshot de
   * MULTI_PRECO.VRCUSTO por idproduto/idempresa — GetCustoProduto, udmNF.pas:12057), base do CMV.
   * A coluna derivada deve estar em `colunas` para ser gravada. Recebe também o `header` (dto do master) p/
   * derivações que dependem do cabeçalho (ex.: copiar DATAINICIO/DATAFIM do header em cada filho — AtualizaDadosFilho)
   * e o `masterId` (PK do master já gravado) p/ derivações que precisam buscar dado do próprio master no banco
   * (ex.: PARA = produtos.unidade quando o header não traz `unidade`). Retrocompatível: impls antigas ignoram o 5º arg.
   */
  derivarItensTrx?: (
    itens: Record<string, unknown>[],
    trx: any,
    emp: number | null,
    header?: Record<string, unknown>,
    masterId?: number,
    /** o que `antesDeSubstituirTrx` devolveu (só no update) — o estado dos itens ANTES de serem apagados */
    snapshot?: unknown,
  ) => Promise<Record<string, unknown>[]>;
  /**
   * NETOS do agregado (tabelas que apontam para o ITEM, não para o master — ex.: `pedido_compra_qtde`, a quantidade de
   * cada item por loja). O motor regrava os itens a cada salvamento (delete + insert, PK nova), e o neto iria junto
   * pela cascata. Os dois ganchos abaixo o fazem sobreviver: `antesDeSubstituirTrx` tira um INSTANTÂNEO do que precisa
   * ser preservado ANTES do delete (só no update); `aposInserirItensTrx` recebe os itens JÁ GRAVADOS — com a PK nova,
   * na ordem do dto — e o instantâneo, e reinsere os netos. Rodam na mesma transação do agregado.
   */
  antesDeSubstituirTrx?: (ctx: { trx: any; masterId: number; emp: number | null }) => Promise<unknown>;
  aposInserirItensTrx?: (ctx: {
    trx: any;
    masterId: number;
    emp: number | null;
    itens: Record<string, unknown>[];
    snapshot: unknown;
    header?: Record<string, unknown>;
  }) => Promise<void>;
  /** anexa dados à LEITURA dos itens (ex.: as quantidades por loja de cada item). */
  anexarLeitura?: (ctx: { db: any; masterId: number; itens: Record<string, unknown>[] }) => Promise<Record<string, unknown>[]>;
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
  /**
   * Validação de REGRA DE NEGÓCIO antes de EXCLUIR (espelha as guardas do btnExcluir do legado
   * que impedem apagar um documento com efeitos: ex.: NF já processada/faturada/enviada — apagar
   * deixaria estoque movido e títulos órfãos). Recebe o id e um db de leitura; deve LANÇAR p/
   * bloquear. Roda no início do removeAggregate, antes da cascata.
   */
  validarRemocao?: (ctx: { id: number; db: any }) => Promise<void> | void;
  /**
   * EFEITO na remoção, dentro da MESMA transação e depois de `validarRemocao` — para o que o legado desfaz ao
   * excluir o documento (estornos de carimbo em outras tabelas). Separado da validação de propósito: um hook
   * chamado "validar" que grava é uma armadilha para quem ler depois.
   */
  aoRemover?: (ctx: { id: number; db: any }) => Promise<void> | void;
  /**
   * Derivação ASSÍNCRONA e TRANSACIONAL antes do INSERT (o que `derivar` é para campos síncronos).
   * Roda DENTRO da transação do create, com a `trx` (pode travar/consultar), e retorna um patch a
   * mesclar no registro do master. Uso: auto-numeração de documento (ex.: NRONF = MAX+1 por
   * empresa/modelo/série na emissão própria — SetaNroNF, uNF.pas:15787), onde o valor depende do banco
   * e precisa ser atômico. Só master; recebe o delta já carimbado (com idempresa).
   */
  derivarTrx?: (ctx: { dto: Record<string, unknown>; trx: any; emp: number | null }) => Promise<Record<string, unknown>>;
  /** anexa dados derivados à LEITURA do agregado (ex.: o estado de fechamento de cada loja do pedido). */
  anexarLeitura?: (ctx: { db: any; id: number; registro: Record<string, unknown>; emp: number | null }) => Promise<Record<string, unknown>>;
  /**
   * EFEITO depois de gravar o agregado (master + itens), na MESMA transação — no create e no update, mesmo quando o
   * dto não traz itens. Para o que o btnGravar do legado faz ao salvar além de gravar as linhas: ex.: a agenda de
   * promoção volta de EXECUTANDO para ABERTA, a loja retirada da agenda perde o preço promocional, a tabela de lojas da
   * agenda é regravada (uCadAgendaPromocao.pas:745-770). `criado` diz se foi um create.
   */
  aposGravarTrx?: (ctx: { trx: any; id: number; dto: Record<string, unknown>; criado: boolean; emp: number | null }) => Promise<void>;
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
