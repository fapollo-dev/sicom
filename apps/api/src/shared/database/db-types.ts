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
  codrcb_gerado: number | null; // 054: título-saldo gerado na baixa PARCIAL (origem='B')
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
  codapg_gerado: number | null; // 054: título-saldo gerado no pagamento PARCIAL (origem='B')
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
/** PLANO_CONTAS (046) — razão contábil em árvore (codpai). Chave de negócio = codiexpandido (máscara). */
export interface PlanoContasTable {
  codplanocontas: Generated<number>;
  codiexpandido: string | null;
  codireduzido: string | null;
  descricao: string;
  classe: string | null; // T sintética / A analítica
  natureza: number | null; // 1 Ativo/2 Passivo/3 PL/4 Resultado/5 Comp/9 Outras
  nivel: number | null;
  codpai: number | null;
  codparceiro: number | null;
  tipo: string | null;
  status: string | null;
  integrado: string | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
/** View GET_PLANO_CONTAS — cadastro do plano (flat; a árvore é montada no front por codpai). */
export interface GetPlanoContasView {
  codplanocontas: number;
  codiexpandido: string | null;
  codireduzido: string | null;
  descricao: string;
  descricao_completa: string | null;
  classe: string | null;
  natureza: number | null;
  nivel: number | null;
  codpai: number | null;
  tipo: string | null;
  status: string | null;
}
/** DRE_ESTRUTURA (047) — árvore de linhas do DRE (P=contas vinculadas / F=soma filhas / E=expressão). */
export interface DreEstruturaTable {
  codestrutura: Generated<number>;
  codexpandido: string;
  descricao: string;
  tipo_calculo: string; // P/F/E
  classe: string; // A/S
  expressao: string | null;
  nivel: number | null;
  codpai: number | null;
  ativo: string | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
/** DRE_CONTA (047) — mapeamento conta contábil → linha do DRE. */
export interface DreContaTable {
  codplanocontas: number;
  codestrutura: number;
}
export interface GetDreEstruturaView {
  codestrutura: number;
  codexpandido: string;
  descricao: string;
  tipo_calculo: string;
  classe: string;
  expressao: string | null;
  nivel: number | null;
  codpai: number | null;
  ativo: string | null;
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
/** CAIXA (048) — sessão do operador (abre/fecha) + movimento manual (estorno lógico via INDR). */
export interface CaixaSessaoTable {
  codcaixa: Generated<number>;
  codempresa: number;
  codoperador: number | null;
  dtabertura: Timestamptz | null;
  dtfechamento: Timestamptz | null;
  saldo_inicial: number | null;
  saldo_final: number | null;
  status: string | null; // 'A' aberta / 'F' fechada
  obs: string | null;
  // 049 (conferência/quebra no fechamento)
  valor_contado: number | null;
  diferenca: number | null; // contado − esperado; <0 quebra, >0 sobra
  codrcb_quebra: number | null; // título A Receber gerado na quebra
  contabilizado: string | null; // 053: 'S' = fechamento contabilizado no DIÁRIO
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
/** OPERADORES (049 stub + 051 cadastro) — usuário do sistema, GLOBAL (codempresa vestigial). */
export interface OperadoresTable {
  codoperador: number; // PK digitada
  codparceiro: number | null;
  nome: string | null;
  codempresa: number | null; // vestigial (operador é global; empresa via ponte, adiado)
  ativo: string | null;
  // 051 (cadastro)
  login: string | null;
  tipoop: string | null; // USU/OPE/SUP/FOR/PRO/ASU/ANS
  idgrupo: number | null; // FK grupo_operador (derivado de tipoop)
  desabilitado: string | null;
  dtaltdesab: Timestamptz | null;
  desabilita_operacoes_basicas: string | null;
  desabilita_desconto_pdv: string | null;
  solicitar_alteracao_senha: string | null;
  idsupervisor: number | null;
  codigoauxiliar: number | null;
  indr: string | null; // soft-delete I/E
  indr_data: Timestamptz | null;
  indr_usuario: number | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
/** GRUPO_OPERADOR (051) — perfil/categoria do operador (6 grupos do legado). */
export interface GrupoOperadorTable {
  idgrupo: number;
  descricao: string;
}
/** FORMAS_PGTO (052) — formas de pagamento/modalidades por empresa; 3 vínculos p/ o Caixa corte-2d. */
export interface FormasPgtoTable {
  idpgto: Generated<number>;
  idempresa: number;
  modalidade: string;
  atalho: string;
  destino: string | null;
  plccofre: number | null;
  codcontacorrente: number | null;
  codplanocontas: number | null;
  recebe_pdv: string | null;
  permite_sangria_pdv: string | null;
  lanc_movimento_individual: string | null;
  tipo: string | null;
  inativo: string | null;
  data_inativo: Timestamptz | null;
  usultalteracao: number | null;
  dtultimalteracao: Timestamptz | null;
  dtcadastro: Timestamptz | null;
}
/** View GET_FORMAS_PGTO (052) — cadastro + nomes dos vínculos (conta/cofre/plano de contas). */
export interface GetFormasPgtoView {
  idpgto: number;
  idempresa: number;
  modalidade: string;
  atalho: string;
  destino: string | null;
  plccofre: number | null;
  cofre: string | null;
  codcontacorrente: number | null;
  conta_corrente: string | null;
  codplanocontas: number | null;
  conta_contabil: string | null;
  recebe_pdv: string | null;
  permite_sangria_pdv: string | null;
  lanc_movimento_individual: string | null;
  tipo: string | null;
  inativo: string | null;
  data_inativo: Timestamptz | null;
}
/** View GET_OPERADORES (051) — núcleo + JOINs de exibição (parceiro/grupo/supervisor). */
export interface GetOperadoresView {
  codoperador: number;
  nome: string | null;
  login: string | null;
  tipoop: string | null;
  idgrupo: number | null;
  grupo: string | null;
  codparceiro: number | null;
  parceiro: string | null;
  idsupervisor: number | null;
  supervisor: string | null;
  desabilitado: string | null;
  desabilita_operacoes_basicas: string | null;
  desabilita_desconto_pdv: string | null;
  solicitar_alteracao_senha: string | null;
  codigoauxiliar: number | null;
  ativo: string | null;
  indr: string | null;
}
export interface CaixaMovTable {
  codmov: Generated<number>;
  codcaixa: number;
  codempresa: number;
  tipo: string; // 'E' entrada / 'S' saída
  especie: string; // SUPRIMENTO/SANGRIA/ENTRADA/SAIDA
  recurso: string | null;
  valor: number;
  codrcbbx: number | null; // gancho baixa AR (corte-2)
  codapgbx: number | null; // gancho baixa AP (corte-2)
  codconta: number | null; // gancho tesouraria (corte-2)
  codoperador: number | null;
  data_operacao: Timestamptz | null;
  indr: string | null; // 'I' válido / 'E' estornado
  contabilizado: string | null;
  obs: string | null;
}
/** View GET_CAIXA_SESSAO — sessão + saldo corrente (saldo_inicial + Σ entradas − Σ saídas, INDR='I'). */
export interface GetCaixaSessaoView {
  codcaixa: number;
  codempresa: number;
  codoperador: number | null;
  dtabertura: Timestamptz | null;
  dtfechamento: Timestamptz | null;
  saldo_inicial: number | null;
  saldo_final: number | null;
  status: string | null;
  obs: string | null;
  valor_contado: number | null;
  diferenca: number | null;
  codrcb_quebra: number | null;
  saldo_corrente: number | null;
  contabilizado: string | null;
}

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
  areceber_bx: AreceberBxTable;
  get_areceber: GetAreceberView;
  apagar: ApagarTable;
  apagar_bx: ApagarBxTable;
  get_apagar: GetApagarView;
  plano_contas: PlanoContasTable;
  get_plano_contas: GetPlanoContasView;
  dre_estrutura: DreEstruturaTable;
  dre_conta: DreContaTable;
  get_dre_estrutura: GetDreEstruturaView;
  caixa_sessao: CaixaSessaoTable;
  caixa_mov: CaixaMovTable;
  get_caixa_sessao: GetCaixaSessaoView;
  operadores: OperadoresTable;
  grupo_operador: GrupoOperadorTable;
  get_operadores: GetOperadoresView;
  formas_pgto: FormasPgtoTable;
  get_formas_pgto: GetFormasPgtoView;
  get_itens_lotecob: GetItensLotecobView;
  marcas: MarcasTable;
  get_marcas: GetMarcasView;
  det_aliquota: DetAliquotaTable;
  indexador_tributario: IndexadorTributarioTable;
  tributacao_reforma: TributacaoReformaTable;
  outbox: OutboxTable;
  permissoes: PermissoesTable;
}
