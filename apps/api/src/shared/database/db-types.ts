import type { ColumnType, Generated } from 'kysely';

/** timestamptz lido como string ISO; escrito como string/Date. */
type Timestamptz = ColumnType<string, string | Date | undefined, string | Date>;

/**
 * Schema do banco do TENANT (Postgres). Mapeia a tabela BANCOS do legado Oracle
 * (ver oracle-to-postgres-recon.md): NUMBER→integer, VARCHAR2→varchar,
 * CHAR(2)→char(2), TIMESTAMP(6)→timestamptz. PK gerada por sequence.
 */
export interface BancosTable {
  codbco: Generated<number>; // PK, sequence (espelha geração app-side do legado)
  agencia: string | null;
  banco: string;
  cidade: string;
  uf: string | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
  agencia_cedente: number | null;
  codbcoblt: number | null;
  convenio: number | null;
  carteira_cobranca: number | null;
  variacao_carteira: number | null;
}

/** View de pesquisa GET_BANCOS — projeção com aliases idênticos ao legado. */
export interface GetBancosView {
  banco: string;
  agencia: string | null;
  cidade: string;
  codigo: number; // = codbco
  codigo_banco: number | null; // = codbcoblt
  convenio: number | null;
  carteira_cobranca: number | null;
  variacao_carteira: number | null;
}

/**
 * Outbox de replicação (espelha REM_BANCOS→REMESSA_SERVER do legado).
 * Nesta fatia: 1 evento por operação (o fan-out por terminal é trilha de sync/Fase 4).
 */
export interface OutboxTable {
  id: Generated<number>;
  tipo: 'INSERT' | 'UPDATE' | 'DELETE';
  tabela: string;
  chave: number;
  campochave: string;
  instrucao: string;
  criado_em: Generated<Timestamptz>;
}

/** 2ª tela: OPERACOES_CONTA (não tem trigger de replicação no legado). */
export interface OperacoesContaTable {
  codopconta: Generated<number>;
  descricao: string;
  tipo: string; // 'C' | 'D'
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}

export interface GetOperacoesContaView {
  descricao: string;
  codopconta: number;
  tipo: string; // decodificado: 'CREDITO' | 'DEBITO'
}

/** 3ª tela: CONTAS_BANCARIAS (FK codbco → bancos; padrão lookup). */
export interface ContasBancariasTable {
  codconta: Generated<number>;
  codbco: number;
  titular: string | null;
  nroconta: string | null;
  ativo: string; // 'S' | 'N'
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}

export interface GetContasBancariasView {
  codconta: number;
  codbco: number;
  banco: string; // nome do banco (via JOIN)
  titular: string | null;
  nroconta: string | null;
  ativo: string;
}

/** 4ª tela: MESTRE-DETALHE — header LOTE_COBRANCA + itens ITENS_LOTECOB. */
export interface LoteCobrancaTable {
  codlotecob: Generated<number>;
  codparceiro: number;
  data: Timestamptz;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
export interface ItensLotecobTable {
  codilotcob: Generated<number>;
  codlotecob: number;
  codrcb: number;
}
export interface GetLoteCobrancaView {
  codlotecob: number;
  codparceiro: number;
  data: Timestamptz;
  qtd_itens: number;
}

/** 5ª tela: MARCAS — cadastro com SOFT-DELETE (INDR). */
export interface MarcasTable {
  idmarca: Generated<number>;
  descricao: string | null;
  indr: string | null;
  indr_usuario: number | null;
  indr_data: Timestamptz | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
export interface GetMarcasView {
  codigo: number;
  descricao: string | null;
  indr: string | null;
  indr_data: Timestamptz | null;
  indr_usuario: number | null;
}

/** FISCAL legado: DET_ALIQUOTA — resolve ICMS efetivo/CST/redução/LEI por (aliquota, UF). */
export interface DetAliquotaTable {
  aliquota: string;
  uf: string;
  icm: number;
  icm_efetivo: number;
  base: number;
  cst: number;
  csosn: string | null;
  descricao: string | null;
  lei: string | null;
}
/** FISCAL legado: INDEXADOR_TRIBUTARIO — MVA/ST por NCM (substituição tributária). */
export interface IndexadorTributarioTable {
  ncm: string;
  aliquota_dest: number;
  icm_fonte: number;
  mva: number;
  reducao: number;
  st_externo: string | null;
}

/** FISCAL novo: Reforma (IBS/CBS/IS) por UF e vigência. */
export interface TributacaoReformaTable {
  uf: string;
  vigencia_inicio: string;
  ibs: number;
  cbs: number;
  imposto_seletivo: number;
  fonte: string;
}

/** RBAC: PERMISSOES do legado — presença de linha = acesso concedido. */
export interface PermissoesTable {
  form: string;
  opcao: string;
  codoperador: number | null;
  codperfil: number | null;
  codempresa: number;
  caption: string | null;
  form_caption: string | null;
}

/** Banco de dados de UM tenant. */
export interface TenantDB {
  bancos: BancosTable;
  get_bancos: GetBancosView;
  operacoes_conta: OperacoesContaTable;
  get_operacoes_conta: GetOperacoesContaView;
  contas_bancarias: ContasBancariasTable;
  get_contas_bancarias: GetContasBancariasView;
  lote_cobranca: LoteCobrancaTable;
  itens_lotecob: ItensLotecobTable;
  get_lote_cobranca: GetLoteCobrancaView;
  marcas: MarcasTable;
  get_marcas: GetMarcasView;
  det_aliquota: DetAliquotaTable;
  indexador_tributario: IndexadorTributarioTable;
  tributacao_reforma: TributacaoReformaTable;
  outbox: OutboxTable;
  permissoes: PermissoesTable;
}
