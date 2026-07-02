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
  razao: string | null; // RAZAO do "Cobrador" (LEFT JOIN parceiros) — coluna 016
  qtd_itens: number;
}

/**
 * Tela "Lotes de Cobrança" COMPLETA (legado-fiel): tabelas transacionais e views de
 * exibição/picker. Só CODRCB é coluna STORED do item; o resto do grid é LIVE-JOIN.
 */
export interface ParceirosTable {
  codparceiro: Generated<number>;
  razao: string | null;
  fun: string | null; // 'S' = cobrador/fornecedor
  tolerancia: number | null; // dias de carência p/ juros
  codend: number | null; // → parceiros_end.codend
}
export interface ParceirosEndTable {
  codend: Generated<number>;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
}
export interface AreceberTable {
  codrcb: Generated<number>;
  codparceiro: number | null;
  codempresa: number; // ATENÇÃO: ARECEBER usa CODEMPRESA (não IDEMPRESA)
  dtvenda: Timestamptz | null;
  dtvenc: Timestamptz | null;
  duplicata: string | null;
  valor: number | null;
  txjuros: number | null;
  consiliado: string | null; // 'S' = conciliado
  // 028 (faturamento da NF)
  idnf: number | null;
  quitada: string | null; // 'S' = baixado
  nrodup: number | null;
  // 043 (gestão do título — corte-1)
  dtpgto: Timestamptz | null;
  txmulta: number | null;
  desconto_boleto: number | null;
  tipodoc: string | null;
  origem: string | null; // A/B/F/Q/O/C
  gerado: string | null; // SISTEMA/OPERADOR
  cadastrado_manualmente: string | null;
  codvendedor: number | null;
  codcobrador: number | null;
  idpgto: number | null;
  codbco: number | null;
  codplc: number | null;
  obs: string | null;
  nroped: string | null;
  nrocupom: string | null;
  idsituacao_nf: number | null;
  agrupado: string | null; // 'S' = em agrupamento
  contabilizado: string | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
/** ARECEBER_BX (044) — baixas do título (1:N); estorno LÓGICO via INDR ('I'/'E'). */
export interface AreceberBxTable {
  codrcbbx: Generated<number>;
  codrcb: number;
  codempresa: number;
  valorpg: number | null;
  juros: number | null;
  multa: number | null;
  acre_desc: number | null;
  dtpgto: Timestamptz | null;
  codopbx: number | null;
  data_operacao: Timestamptz | null;
  indr: string | null; // 'I' válida / 'E' estornada
  contabilizado: string | null;
  obs: string | null;
}
/** Picker GET_ARECEBER — documentos disponíveis p/ adicionar ao lote (live-join + juros/total). */
export interface GetAreceberView {
  codrcb: number;
  codparceiro: number | null;
  codempresa: number;
  consiliado: string | null;
  razao: string | null;
  duplicata: string | null;
  dtvenda: Timestamptz | null;
  dtvenc: Timestamptz | null;
  valor: number | null;
  txjuros: number | null;
  dias_atrazo: number;
  dias_tolerancia: number;
  juro: number;
  total: number;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
}
/** APAGAR (028 + 045) — contas a pagar (gêmea de areceber; tenant por codempresa). */
export interface ApagarTable {
  codapg: Generated<number>;
  codparceiro: number | null;
  codempresa: number;
  idnf: number | null;
  dtvenda: Timestamptz | null;
  dtvenc: Timestamptz | null;
  duplicata: string | null;
  nrodup: number | null;
  valor: number | null;
  txjuros: number | null;
  quitada: string | null;
  consiliado: string | null;
  // 045 (gestão)
  dtpgto: Timestamptz | null;
  txmulta: number | null;
  desconto_boleto: number | null;
  tipodoc: string | null;
  origem: string | null;
  gerado: string | null;
  cadastrado_manualmente: string | null;
  idpgto: number | null;
  codbco: number | null;
  codplc: number | null;
  obs: string | null;
  nroped: string | null;
  nrocupom: string | null;
  idsituacao_nf: number | null;
  agrupado: string | null;
  contabilizado: string | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
/** APAGAR_BX (045) — baixas/pagamentos (1:N; estorno lógico via INDR). */
export interface ApagarBxTable {
  codapgbx: Generated<number>;
  codapg: number;
  codempresa: number;
  valorpg: number | null;
  juros: number | null;
  multa: number | null;
  acre_desc: number | null;
  dtpgto: Timestamptz | null;
  codopbx: number | null;
  data_operacao: Timestamptz | null;
  indr: string | null;
  contabilizado: string | null;
  obs: string | null;
}
/** View GET_APAGAR — gestão do título a pagar (juro/total live). */
export interface GetApagarView {
  codapg: number;
  codparceiro: number | null;
  codempresa: number;
  consiliado: string | null;
  razao: string | null;
  duplicata: string | null;
  dtvenda: Timestamptz | null;
  dtvenc: Timestamptz | null;
  valor: number | null;
  txjuros: number | null;
  dias_atrazo: number;
  dias_tolerancia: number;
  juro: number;
  total: number;
  idnf: number | null;
  nrodup: number | null;
  quitada: string | null;
  agrupado: string | null;
  contabilizado: string | null;
  tipodoc: string | null;
  origem: string | null;
  gerado: string | null;
  cadastrado_manualmente: string | null;
  dtpgto: Timestamptz | null;
  idpgto: number | null;
  codbco: number | null;
  codplc: number | null;
  idsituacao_nf: number | null;
}
/** Detalhe de exibição do lote GET_ITENS_LOTECOB — grid live-joined + juros/total. */
export interface GetItensLotecobView {
  codilotcob: number;
  codlotecob: number;
  codrcb: number;
  codparceiro: number | null;
  razao: string | null;
  dtvenda: Timestamptz | null;
  dtvenc: Timestamptz | null;
  duplicata: string | null;
  valor: number | null;
  txjuros: number | null;
  juros: number;
  total: number;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
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
  parceiros: ParceirosTable;
  parceiros_end: ParceirosEndTable;
  areceber: AreceberTable;
  get_areceber: GetAreceberView;
  get_itens_lotecob: GetItensLotecobView;
  marcas: MarcasTable;
  get_marcas: GetMarcasView;
  det_aliquota: DetAliquotaTable;
  indexador_tributario: IndexadorTributarioTable;
  tributacao_reforma: TributacaoReformaTable;
  outbox: OutboxTable;
  permissoes: PermissoesTable;
}
