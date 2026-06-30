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
const CODE_PT: Record<string, string> = {
  // regra de negócio (BusinessRuleError 422)
  BANCO_OBRIGATORIO: 'O banco é obrigatório.',
  CIDADE_OBRIGATORIA: 'A cidade é obrigatória.',
  MARGEM_INVALIDA: 'A margem informada é inválida.',
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
  NF_CANCELADA: 'Nota fiscal cancelada não pode ser processada.',
  NF_ESTOQUE_NEGATIVO:
    'Processamento de Nota Fiscal não permitido, pois com sua emissão o estoque ficará negativo.',
  // autorização
  TENANT_FORBIDDEN: 'Acesso negado: empresa/tenant não autorizado.',
  SEM_PERMISSAO: 'Você não tem permissão para executar esta ação.',
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
