import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import type { CampoErro, ErroResposta } from '@apollo/shared';
import { AppError, ValidationError } from './app-error';
import { tenantStore } from '../tenant/tenant-context';

/**
 * Filtro único de exceções (ADR-015): TODA falha sai no envelope `ErroResposta`
 * { statusCode, code, message (PT), campos? }. Nunca um 500 genérico "erro no
 * servidor" — a meta é mapear AppError, HttpException e erros do Postgres em
 * mensagens reais em português; o 500 é só o último recurso.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const envelope = this.toEnvelope(err);
    return res.status(envelope.statusCode).json(envelope);
  }

  // ── roteamento ────────────────────────────────────────────────────────────
  private toEnvelope(err: unknown): ErroResposta {
    if (err instanceof AppError) return this.fromAppError(err);
    if (err instanceof HttpException) return this.fromHttpException(err);
    if (isPgError(err)) return this.fromPgError(err);
    return this.fromUnknown(err);
  }

  // ── AppError (regra/validação/autorização) ─────────────────────────────────
  private fromAppError(err: AppError): ErroResposta {
    // ValidationError carrega os erros por campo em details.campos (vindos do pipe).
    if (err instanceof ValidationError) {
      const campos = camposFromDetails(err.details);
      return {
        statusCode: err.httpStatus,
        code: 'VALIDACAO',
        message: campos.length ? 'Há campos inválidos.' : msgPt(err),
        ...(campos.length ? { campos } : {}),
      };
    }

    // Se message === code, o code é cru (ex.: BANCO_OBRIGATORIO) → traduz p/ PT.
    const message = err.message === err.code ? msgPt(err) : err.message;
    const campos = camposFromDetails(err.details);
    return {
      statusCode: err.httpStatus,
      code: err.code,
      message,
      ...(campos.length ? { campos } : {}),
      // detalhe estruturado (o `details` do AppError) — SÓ p/ códigos na allowlist (ex.: import de NFe →
      // detalhe.itens = pendências). Allowlist evita ecoar dados internos de outros erros (saldos, RBAC).
      ...(err.details && Object.keys(err.details).length && DETALHE_CODES.has(err.code) ? { detalhe: err.details } : {}),
    };
  }

  // ── HttpException do Nest ───────────────────────────────────────────────────
  private fromHttpException(err: HttpException): ErroResposta {
    const status = err.getStatus();
    const mapped = HTTP_STATUS_PT[status];
    // Mensagem real do HttpException quando ela é informativa (ex.: validação do
    // próprio Nest); senão cai no texto PT padrão por status.
    const raw = httpExceptionMessage(err);
    return {
      statusCode: status,
      code: mapped?.code ?? 'ERRO_HTTP',
      message: raw ?? mapped?.message ?? 'Não foi possível concluir a requisição.',
    };
  }

  // ── Erro do Postgres (pg) por SQLSTATE ─────────────────────────────────────
  private fromPgError(err: PgErrorLike): ErroResposta {
    const campo = pgOffendingColumn(err);
    const campos: CampoErro[] = [];

    switch (err.code) {
      case '23503': // foreign_key_violation
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'REGISTRO_RELACIONADO_INEXISTENTE',
          message: err.constraint
            ? `Operação viola a relação "${err.constraint}": o registro referenciado não existe ou ainda está em uso.`
            : 'A operação faz referência a um registro que não existe (ou que ainda está em uso).',
        };

      case '23505': // unique_violation
        // índices de EXPRESSÃO não expõem `campo` (err.detail); mapeia por nome de constraint p/ msg PT.
        if (err.constraint === 'ux_operadores_login') {
          return { statusCode: HttpStatus.CONFLICT, code: 'LOGIN_DUPLICADO', message: 'Já existe um usuário com este login.' };
        }
        if (campo) campos.push({ campo, mensagem: 'Já existe um registro com este valor.' });
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'DUPLICADO',
          message: campo
            ? `Já existe um registro com este valor para "${campo}".`
            : 'Já existe um registro com estes dados (valor duplicado).',
          ...(campos.length ? { campos } : {}),
        };

      case '23502': // not_null_violation
        if (err.column) campos.push({ campo: err.column, mensagem: 'Campo obrigatório.' });
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'CAMPO_OBRIGATORIO',
          message: err.column
            ? `O campo "${err.column}" é obrigatório.`
            : 'Um campo obrigatório não foi informado.',
          ...(campos.length ? { campos } : {}),
        };

      case '23514': // check_violation
        return {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'REGRA_VIOLADA',
          message: err.constraint
            ? `O valor informado viola a regra "${err.constraint}".`
            : 'O valor informado viola uma regra de integridade.',
        };

      case '22001': // string_data_right_truncation
        if (campo) campos.push({ campo, mensagem: 'Texto acima do tamanho permitido.' });
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'TEXTO_LONGO',
          message: 'Um dos textos informados é maior do que o tamanho permitido.',
          ...(campos.length ? { campos } : {}),
        };

      case '22P02': // invalid_text_representation (número/texto inválido)
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'VALOR_INVALIDO',
          message: 'Um dos valores informados está em formato inválido.',
        };

      case '22003': // numeric_value_out_of_range (valor numérico maior que a precisão da coluna)
        if (campo) campos.push({ campo, mensagem: 'Valor numérico fora da faixa permitida.' });
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'VALOR_FORA_DA_FAIXA',
          message: 'Um dos valores numéricos informados está acima do limite permitido.',
          ...(campos.length ? { campos } : {}),
        };

      default:
        return this.fromUnknown(err);
    }
  }

  // ── último recurso ──────────────────────────────────────────────────────────
  private fromUnknown(err: unknown): ErroResposta {
    const tenantId = tenantStore.getStore()?.tenantId;
    console.error('[unhandled]', { tenantId, err });
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'ERRO_INTERNO',
      message: 'Ocorreu um erro inesperado. A equipe foi notificada.',
    };
  }
}

/** Tradução PT de codes conhecidos (quando message === code, sem texto humano). */
/**
 * Códigos cujo `details` do AppError PODE ser ecoado ao cliente no envelope (`detalhe`) — allowlist explícita
 * (evita vazar dados internos de outros erros: saldos, form/opção de RBAC, etc.). Só o que o front consome.
 */
const DETALHE_CODES = new Set<string>(['NFE_PRODUTOS_NAO_CASADOS', 'PEDIDO_LIMITE_EXCEDIDO']);

const CODE_PT: Record<string, string> = {
  // regra de negócio (BusinessRuleError 422)
  BANCO_OBRIGATORIO: 'O banco é obrigatório.',
  PRODUTO_NAO_ENCONTRADO: 'Produto não encontrado.',
  CIDADE_OBRIGATORIA: 'A cidade é obrigatória.',
  MARGEM_INVALIDA: 'A margem informada é inválida.',
  PMZ_SAIDAS_INVALIDAS: 'Impossível calcular o PMZ: os impostos de saída + despesa operacional somam 100% ou mais (o preço não cobriria as saídas).',
  ALIQUOTA_NAO_CADASTRADA: 'Alíquota não cadastrada para a UF informada.',
  INDEXADOR_NAO_CADASTRADO: 'Indexador tributário não cadastrado para o NCM informado.',
  REFORMA_NAO_CADASTRADA: 'Tributação da Reforma não cadastrada para a UF/data informada.',
  TRIBUTOS_ATUAIS_AUSENTES: 'Tributos atuais não cadastrados.',
  TRIBUTOS_REFORMA_AUSENTES: 'Tributos da Reforma não cadastrados.',
  TRIBUTOS_TRANSICAO_INCOMPLETOS: 'Tributos do período de transição estão incompletos.',
  FORNECEDOR_NAO_ENCONTRADO: 'Fornecedor não encontrado com o código informado. Verifique!',
  PRODUTO_EM_COMPOSICAO: 'Não é permitido desativar o produto, pois ele faz parte da composição de um kit.',
  // Nota Fiscal (travas de estado + duplicidade — uNF.pas)
  NF_PROCESSADA: 'Nota fiscal já processada não pode ser modificada.',
  NF_CONTABILIZADA: 'Documento contabilizado. Não é permitido editar.',
  NF_ENVIADA: 'Nota fiscal já enviada para receita.',
  NF_DUPLICADA: 'Esta nota fiscal já está lançada com o mesmo número e o mesmo fornecedor.',
  // processamento / movimento de estoque (F3)
  NF_NAO_ENCONTRADA: 'Nota fiscal não encontrada no sistema.',
  NF_JA_PROCESSADA: 'A nota selecionada já está processada!',
  NF_NAO_PROCESSADA: 'A nota fiscal não está processada.',
  NF_CANCELADA: 'Nota fiscal cancelada não pode ser modificada nem excluída.',
  NF_TEM_FATURAMENTO: 'Estorne o faturamento antes de excluir/editar a nota fiscal.',
  NF_REFERENCIADA: 'Esta nota fiscal está referenciada por outra nota (devolução/complemento) e não pode ser excluída.',
  NF_ESTOQUE_NEGATIVO:
    'Processamento de Nota Fiscal não permitido, pois com sua emissão o estoque ficará negativo.',
  NF_TOTAL_DIVERGENTE: 'Valor informado no total da NF não confere com o calculado. Verifique!',
  NF_ST_DIVERGENTE: 'Valores do ICMS ST divergentes do calculado. Verifique!',
  // contábil / DIÁRIO (F5b)
  NF_JA_CONTABILIZADA: 'Esta nota fiscal já está contabilizada.',
  NF_NAO_CONTABILIZADA: 'Esta nota fiscal não está contabilizada.',
  NF_SEM_RATEIO_CONTABIL: 'Informe o rateio contábil (situação/centro de custo) antes de contabilizar.',
  NF_SEM_DTCONTABIL: 'A nota fiscal não tem data contábil (DTCONTABIL).',
  INTEGRACAO_NAO_AUTOMATICA: 'A integração contábil da empresa não é automática.',
  CONTAS_NAO_INFORMADAS: 'Não foram informadas as contas (débito e crédito) para a situação. Verifique!',
  CONTA_PARCEIRO_NAO_DEFINIDA: 'O parceiro não tem conta contábil definida para o lançamento automático.',
  CONTA_PLC_NAO_DEFINIDA: 'O centro de custo (PLC) não tem conta contábil formal vinculada.',
  CONTA_AUTOMATICA_NAO_SUPORTADA: 'Conta contábil automática de débito exige centro de custo (CODCC).',
  ICMS_SEM_SITUACAO: 'CFOP sem situação contábil de ICMS configurada, mas há ICMS a lançar. Verifique!',
  PERIODO_FECHADO: 'O período contábil desta data está fechado. Entre em contato com o contador responsável.',
  // faturamento / financeiro (F4)
  NF_JA_FATURADA: 'Esta nota fiscal já está faturada.',
  NF_NAO_FATURADA: 'Esta nota fiscal não está faturada.',
  NF_SEM_VALOR: 'A nota fiscal não tem valor total para faturar.',
  NUM_PARCELAS_INVALIDO: 'Número de parcelas inválido.',
  TITULO_QUITADO:
    'Existem documentos financeiros que já foram baixados, agrupados ou contabilizados relacionados à essa nota. Não é possível excluir o financeiro. Verifique!',
  // Contas a Receber (uCadAReceber — travas de estado do título)
  TITULO_NAO_ENCONTRADO: 'Título a receber não encontrado no sistema.',
  TITULO_JA_BAIXADO: 'Título já quitado (baixado) — estorne a baixa antes de alterar ou excluir.',
  TITULO_AGRUPADO: 'Título agrupado não pode ser modificado nem excluído. Remova do agrupamento antes.',
  TITULO_CONTABILIZADO: 'Título contabilizado não pode ser modificado nem excluído.',
  TITULO_DE_NF: 'Este título foi gerado por uma nota fiscal — altere pela própria nota (faturar/estornar).',
  TITULO_ORIGEM_AUTO: 'Título gerado por outro processo (quitação/convênio/caixa) não pode ser alterado nem excluído por aqui.',
  TITULO_CONCILIADO: 'Título conciliado na tesouraria não pode ser alterado nem excluído.',
  // Baixa / recebimento (corte-2)
  TITULO_EM_LOTE: 'Título está em um lote de cobrança — remova-o do lote antes de baixar.',
  TITULO_NAO_BAIXADO: 'Título não está baixado — não há baixa a estornar.',
  BAIXA_CONTABILIZADA: 'A baixa já foi contabilizada — estorne a contabilização antes.',
  TITULO_VALOR_INVALIDO: 'O valor da baixa deve ser maior que zero.',
  TITULO_VALOR_EXCEDE: 'O valor pago é maior que o total do título — troco/crédito ainda não é suportado.',
  REVERSAO_PARCIAL_SALDO_BAIXADO: 'O título-saldo gerado nesta baixa parcial já possui movimentação — trate a baixa do saldo antes de estornar esta.',
  CONTA_BANCARIA_NAO_ENCONTRADA: 'A conta bancária informada para o depósito não existe nesta empresa.',
  // Ajuste de estoque (FRMAJUSTEESTOQUE)
  MOTIVO_NAO_ENCONTRADO: 'Motivo de operação não encontrado.',
  AJUSTE_CONCORRENTE: 'Outro ajuste deste produto está em andamento — tente novamente.',
  AJUSTE_NAO_ENCONTRADO: 'Ajuste de estoque não encontrado.',
  AJUSTE_JA_ESTORNADO: 'Este ajuste de estoque já foi estornado.',
  AJUSTE_ESTORNO_SALDO_MUDOU: 'O saldo do produto mudou desde este ajuste — não é possível estorná-lo com segurança.',
  // Plano de Contas (uCadPlanoContas — árvore/validações/travas)
  CONTA_NAO_ENCONTRADA: 'Conta contábil não encontrada no sistema.',
  CONTA_CODIGO_DUPLICADO: 'Já existe uma conta com este código.',
  CONTA_REDUZIDO_DUPLICADO: 'Já existe uma conta com este código reduzido.',
  CONTA_PAI_INEXISTENTE: 'A conta-pai informada não existe.',
  CONTA_PAI_ANALITICA: 'Não é possível criar contas filhas em uma conta analítica. A conta-pai deve ser sintética.',
  CONTA_PAI_INVALIDO: 'A conta não pode ser pai de si mesma.',
  CONTA_PREFIXO_INVALIDO: 'O código é incompatível com a estrutura da conta-pai (deve conter o prefixo do pai).',
  CONTA_COM_FILHOS: 'A conta possui contas filhas — remova ou reclassifique as filhas antes.',
  CONTA_COM_MOVIMENTO: 'A conta possui movimento no diário — não é possível excluir. Inative-a.',
  CONTA_EM_USO: 'A conta está em uso (integração/centro de custo/parceiro) — não é possível excluir. Inative-a.',
  // DRE (relatório)
  DRE_PERIODO_OBRIGATORIO: 'Informe as datas inicial e final do período.',
  DRE_PERIODO_INVALIDO: 'A data inicial não pode ser maior que a data final.',
  // Caixa (uMovCaixa/UabertCaixa/uFechamentoCaixa — sessão + movimento manual)
  CAIXA_JA_ABERTO: 'Este operador já possui um caixa aberto. Feche o caixa atual antes de abrir outro.',
  CAIXA_NAO_ABERTO: 'Não há caixa aberto para este operador. Abra o caixa antes de movimentar.',
  CAIXA_NAO_ENCONTRADO: 'Caixa não encontrado no sistema.',
  CAIXA_JA_FECHADO: 'Este caixa já está fechado.',
  CAIXA_FECHADO: 'O caixa está fechado — não é possível estornar movimentos.',
  CAIXA_OUTRO_OPERADOR: 'Este caixa pertence a outro operador — só o operador dono pode fechá-lo.',
  CAIXA_ESPECIE_INVALIDA: 'Espécie de movimento inválida.',
  CAIXA_VALOR_INVALIDO: 'O valor do movimento deve ser maior que zero.',
  CAIXA_SALDO_INSUFICIENTE: 'Saldo insuficiente no caixa para esta saída.',
  CAIXA_MOV_NAO_ENCONTRADO: 'Movimento de caixa não encontrado no sistema.',
  CAIXA_MOV_ESTORNADO: 'Movimento já estornado — não há o que estornar.',
  OPERADOR_SEM_PARCEIRO: 'O operador não tem um parceiro (funcionário) vinculado — não é possível gerar o título de quebra de caixa.',
  OPERADOR_PROTEGIDO: 'Este é um usuário de sistema (SICOM) — não pode ser editado nem excluído.',
  CAIXA_NAO_FECHADO: 'O caixa não está fechado — não há o que reabrir.',
  REABERTURA_QUEBRA_BAIXADA: 'O título de quebra deste caixa já foi baixado — estorne a baixa antes de reabrir o caixa.',
  CAIXA_JA_CONTABILIZADA: 'O fechamento deste caixa já foi contabilizado.',
  CAIXA_NAO_CONTABILIZADA: 'O fechamento deste caixa não está contabilizado — não há o que estornar.',
  CAIXA_SEM_DIFERENCA: 'O fechamento não tem quebra/sobra nem dinheiro a contabilizar.',
  CAIXA_CONTABIL_QUEBRA_TITULO: 'A quebra deste caixa gerou título A Receber — a contabilização depende do contábil de A Receber (corte futuro).',
  CAIXA_TESOURARIA_SEM_CONTA: 'A forma DINHEIRO da empresa não tem conta contábil (codplanocontas) definida para a tesouraria.',
  // NFe / SEFAZ (F6)
  NF_JA_TRANSMITIDA: 'Esta nota fiscal já foi transmitida para a SEFAZ.',
  NF_NAO_AUTORIZADA: 'A nota fiscal não está autorizada pela SEFAZ.',
  NF_MODELO_INVALIDO_PARA_TRANSMISSAO: 'Apenas notas modelo 55 (NF-e) podem ser transmitidas pela retaguarda.',
  NF_TERCEIROS_NAO_TRANSMITE: 'Não é possível enviar uma nota com emissão de terceiros. Verifique!',
  NF_SEM_NUMERO: 'A nota fiscal não tem número para transmitir.',
  NF_SEM_DESTINATARIO: 'A nota fiscal não tem destinatário (parceiro) informado.',
  NF_SEM_ITENS: 'A nota fiscal não tem itens para transmitir.',
  NF_DENEGADA: 'Nota fiscal denegada pela SEFAZ. Emita uma nova nota.',
  NF_CCE_LIMITE: 'Não é possível enviar carta de correção, pois já foi atingido o limite de 20 cartas!',
  NF_CHAVE_INVALIDA: 'Chave de acesso inválida (formato ou dígito verificador).',
  NF_SEFAZ_ERRO: 'A SEFAZ retornou erro na transmissão.',
  EMPRESA_FISCAL_NAO_CONFIGURADA: 'Configuração fiscal da empresa (CNPJ/UF) não cadastrada.',
  // Pedido de Compra (FRMPEDIDOCOMPRA)
  PEDIDO_FORNECEDOR_INVALIDO: 'Fornecedor inválido: o parceiro informado não é um fornecedor (FRN).',
  PEDIDO_FECHADO: 'Este pedido de compra está fechado — reabra o pedido antes de alterá-lo ou excluí-lo.',
  PEDIDO_NAO_ENCONTRADO: 'Pedido de compra não encontrado.',
  PEDIDO_JA_FECHADO: 'Este pedido de compra já está fechado.',
  PEDIDO_NAO_FECHADO: 'Este pedido de compra não está fechado — não há o que reabrir.',
  PEDIDO_SEM_ITENS: 'O pedido de compra não tem itens — inclua ao menos um item antes de fechar.',
  PEDIDO_FATURADO: 'Este pedido já foi faturado (NF de entrada) — não é possível reabri-lo.',
  PEDIDO_JA_RECEBIDO: 'Este pedido já tem uma NF de entrada gerada — não é possível gerar outra.',
  PEDIDO_SEM_CONDICAO_PAGTO: 'Informe a condição de pagamento (ou os prazos CD1..CD8) antes de gerar as parcelas.',
  PEDIDO_SEM_VALOR: 'O pedido não tem valor (total dos itens é zero) — inclua itens antes de gerar as parcelas.',
  PEDIDO_SEM_CONDICAO_OBRIGATORIA: 'A condição de pagamento é obrigatória neste pedido (informe a condição ou os prazos CD1..CD8).',
  PEDIDO_PRAZO_EXCEDE_FORNECEDOR: 'Um dos prazos de pagamento excede o máximo de dias permitido para este fornecedor.',
  PEDIDO_FORNECEDOR_PENDENCIAS: 'Este fornecedor tem pendências financeiras (A Receber em aberto) — regularize antes de incluir o pedido.',
  PEDIDO_LIMITE_EXCEDIDO: 'O pedido excede o limite de compra do período (diário/semanal) — solicite a liberação a um operador autorizado.',
  PEDIDO_IMPORT_EXCESSO: 'Produtos demais para importar de uma vez (limite de 990) — filtre o catálogo do fornecedor.',
  // Import do XML da NFe (recebimento corte-2)
  NFE_XML_INVALIDO: 'O XML informado não é uma NFe válida (estrutura não reconhecida).',
  NFE_FORNECEDOR_NAO_ENCONTRADO: 'Fornecedor do XML (CNPJ) não encontrado no cadastro desta empresa.',
  NFE_PRODUTOS_NAO_CASADOS: 'Há itens do XML sem produto correspondente (por código de barras). Cadastre/vincule os produtos e reimporte.',
  NFE_FORNECEDOR_DIVERGE_PEDIDO: 'O fornecedor do XML é diferente do fornecedor do pedido informado.',
  NFE_ITENS_EXCESSO: 'O XML tem itens demais (acima do limite de 990 por NFe).',
  NF_SEM_DUPLICATAS: 'A NF não tem duplicatas para gerar contas a pagar.',
  // Devolução de compra (FRMDEVOLUCAOCOMPRA)
  DEVOLUCAO_NAO_ENCONTRADA: 'Devolução de compra não encontrada.',
  DEVOLUCAO_NAO_EDITAVEL: 'Esta devolução não está em digitação — não pode ser alterada nem excluída.',
  DEVOLUCAO_FORNECEDOR_INVALIDO: 'Fornecedor inválido: o parceiro informado não é um fornecedor (FRN).',
  DEVOLUCAO_ITEM_INVALIDO: 'Item de devolução inválido: a nota de origem não é uma nota de entrada válida.',
  DEVOLUCAO_ITEM_OUTRO_FORNECEDOR: 'Um dos itens pertence a uma nota de outro fornecedor.',
  DEVOLUCAO_CFOP_ORIGEM_AUSENTE: 'A nota de origem está sem CFOP no item. Reimporte/complete a nota antes de devolver.',
  DEVOLUCAO_CFOP_NAO_CONFIGURADO: 'O CFOP de origem não tem CFOP de devolução configurado. Configure antes de devolver.',
  DEVOLUCAO_QTDE_EXCEDE: 'A quantidade a devolver excede o saldo disponível da nota de entrada.',
  DEVOLUCAO_SEM_ITENS: 'A devolução não tem itens — inclua ao menos um item antes de finalizar.',
  DEVOLUCAO_ESTADO_INVALIDO: 'A devolução não está em digitação para ser finalizada.',
  DEVOLUCAO_NAO_DIGITADA: 'A devolução não está finalizada (digitada) — não há o que reabrir.',
  DEVOLUCAO_NAO_CANCELAVEL: 'Esta devolução não pode ser cancelada no estado atual.',
  DEVOLUCAO_NAO_FINALIZADA: 'Finalize a digitação da devolução antes de gerar a NF.',
  DEVOLUCAO_NF_JA_EMITIDA: 'Esta devolução já tem uma NF de saída gerada.',
  DEVOLUCAO_ORIGEM_CANCELADA: 'Uma das notas de entrada de origem está cancelada — não é possível devolver.',
  DEPARA_SEM_CODIGO: 'Informe o EAN ou o código do fornecedor para vincular o produto.',
  // autorização / autenticação (OPERADORES corte-3a — auth)
  TENANT_FORBIDDEN: 'Acesso negado: empresa/tenant não autorizado.',
  SEM_PERMISSAO: 'Você não tem permissão para executar esta ação.',
  NAO_AUTENTICADO: 'Autenticação necessária. Faça login novamente.',
  CREDENCIAIS_INVALIDAS: 'Usuário ou senha inválidos.',
  OPERADOR_DESABILITADO: 'Usuário desabilitado — contate o administrador.',
  OPERADOR_BLOQUEADO: 'Usuário temporariamente bloqueado por excesso de tentativas. Tente novamente mais tarde.',
  OPERADOR_SEM_EMPRESA: 'Usuário sem acesso à empresa selecionada — contate o administrador.',
  SENHA_ATUAL_INVALIDA: 'A senha atual está incorreta.',
  SENHA_TROCA_OBRIGATORIA: 'É obrigatório trocar a senha antes de continuar.',
  // validação genérica
  VALIDATION: 'Há campos inválidos.',
  VALIDACAO: 'Há campos inválidos.',
};

/** Texto PT por HTTP status para HttpException do Nest sem mensagem própria. */
const HTTP_STATUS_PT: Record<number, { code: string; message: string }> = {
  [HttpStatus.BAD_REQUEST]: { code: 'REQUISICAO_INVALIDA', message: 'Requisição inválida.' },
  [HttpStatus.UNAUTHORIZED]: { code: 'NAO_AUTENTICADO', message: 'Autenticação necessária.' },
  [HttpStatus.FORBIDDEN]: { code: 'ACESSO_NEGADO', message: 'Acesso negado.' },
  [HttpStatus.NOT_FOUND]: { code: 'NAO_ENCONTRADO', message: 'Registro não encontrado.' },
  [HttpStatus.METHOD_NOT_ALLOWED]: { code: 'METODO_NAO_PERMITIDO', message: 'Método não permitido.' },
  [HttpStatus.CONFLICT]: { code: 'CONFLITO', message: 'Conflito com o estado atual do recurso.' },
  [HttpStatus.UNPROCESSABLE_ENTITY]: { code: 'REGRA_NEGOCIO', message: 'Não foi possível processar a requisição.' },
  [HttpStatus.TOO_MANY_REQUESTS]: { code: 'EXCESSO_REQUISICOES', message: 'Muitas requisições. Tente novamente em instantes.' },
  [HttpStatus.INTERNAL_SERVER_ERROR]: { code: 'ERRO_INTERNO', message: 'Ocorreu um erro inesperado. A equipe foi notificada.' },
};

/** Traduz o code do AppError p/ PT; se não houver entrada, devolve o code cru. */
function msgPt(err: AppError): string {
  return CODE_PT[err.code] ?? err.code;
}

/**
 * Extrai `campos[]` de details. O ZodValidationPipe coloca os erros estruturados
 * em details.campos ([{campo, mensagem}]); aceitamos também o formato cru do
 * zod.flatten() (fieldErrors) por compatibilidade.
 */
function camposFromDetails(details: Record<string, unknown> | undefined): CampoErro[] {
  if (!details) return [];

  const direto = (details as { campos?: unknown }).campos;
  if (Array.isArray(direto)) {
    return direto.filter(
      (c): c is CampoErro =>
        !!c && typeof (c as CampoErro).campo === 'string' && typeof (c as CampoErro).mensagem === 'string',
    );
  }

  // fallback: zod flatten() → { fieldErrors: { campo: [msg, ...] } }
  const fieldErrors = (details as { fieldErrors?: Record<string, string[] | undefined> }).fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const out: CampoErro[] = [];
    for (const [campo, msgs] of Object.entries(fieldErrors)) {
      for (const mensagem of msgs ?? []) out.push({ campo, mensagem });
    }
    return out;
  }

  return [];
}

/** Mensagem "real" de um HttpException quando ela não é só o nome do status. */
function httpExceptionMessage(err: HttpException): string | undefined {
  const resp = err.getResponse();
  let msg: unknown;
  if (typeof resp === 'string') msg = resp;
  else if (resp && typeof resp === 'object') msg = (resp as { message?: unknown }).message;

  if (Array.isArray(msg)) msg = msg.join('; ');
  if (typeof msg !== 'string' || !msg.trim()) return undefined;

  // Nest devolve o nome do status como "mensagem" por padrão (ex.: "Not Found",
  // "Forbidden"): nesse caso preferimos o texto PT do mapa por status.
  const fallbackName = HttpStatus[err.getStatus()];
  if (fallbackName && msg.replace(/\s+/g, '_').toUpperCase() === fallbackName) return undefined;

  return msg;
}

// ── pg error duck-typing ──────────────────────────────────────────────────────
interface PgErrorLike {
  code: string;
  detail?: string;
  column?: string;
  table?: string;
  constraint?: string;
  schema?: string;
}

/** SQLSTATE: 5 chars alfanuméricos (ex.: 23505, 22P02). */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** Detecta erro do Postgres sem depender de instanceof (cruza módulos). */
function isPgError(err: unknown): err is PgErrorLike {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && SQLSTATE.test(code);
}

/** Tenta achar a coluna ofensora (unique/truncation costumam só trazer `detail`). */
function pgOffendingColumn(err: PgErrorLike): string | undefined {
  if (err.column) return err.column;
  // detail: 'Key (codigo)=(1) already exists.'
  const m = err.detail?.match(/Key \(([^)]+)\)=/);
  return m?.[1];
}
