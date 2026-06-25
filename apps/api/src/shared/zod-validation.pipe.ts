import { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import type { CampoErro } from '@apollo/shared';
import { ValidationError } from './errors/app-error';

/**
 * Valida o corpo com a MESMA zod schema do frontend (fonte única, ADR-015).
 * Na falha, lança `ValidationError` carregando os erros POR CAMPO em
 * `details.campos` — o AllExceptionsFilter os renderiza no envelope
 * `ErroResposta.campos[]`. As mensagens já vêm em PT-BR dos schemas.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      const campos: CampoErro[] = r.error.issues.map((issue) => ({
        campo: issue.path.join('.'),
        mensagem: issue.message,
      }));
      throw new ValidationError('VALIDACAO', { campos });
    }
    return r.data;
  }
}
