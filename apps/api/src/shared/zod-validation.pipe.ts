import { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ValidationError } from './errors/app-error';

/** Valida o corpo com a MESMA zod schema do frontend (fonte única). */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}
  transform(value: unknown) {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new ValidationError('VALIDATION', r.error.flatten() as any);
    }
    return r.data;
  }
}
