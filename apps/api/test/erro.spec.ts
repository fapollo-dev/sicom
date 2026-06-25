import { describe, it, expect } from 'vitest';
import { HttpStatus, HttpException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import {
  BusinessRuleError,
  ForbiddenActionError,
  UnauthorizedTenantError,
} from '../src/shared/errors/app-error';
import { ZodValidationPipe } from '../src/shared/zod-validation.pipe';

/** ArgumentsHost + Response mínimos para exercitar o filtro fora do Nest. */
function capture(err: unknown): { status: number; body: ErroResposta } {
  let status = 0;
  let body: ErroResposta = undefined as any;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: ErroResposta) {
      body = payload;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as any;
  new AllExceptionsFilter().catch(err, host);
  return { status, body };
}

describe('AllExceptionsFilter — envelope ErroResposta (ADR-015)', () => {
  it('erro do Postgres 23503 (FK) → 409 envelope PT', () => {
    const pg = Object.assign(new Error('insert or update on table'), {
      code: '23503',
      constraint: 'conta_banco_fk',
      table: 'contas',
      detail: 'Key (codbco)=(99) is not present in table "bancos".',
    });
    const { status, body } = capture(pg);

    expect(status).toBe(409);
    expect(body.statusCode).toBe(409);
    expect(body.code).toBe('REGISTRO_RELACIONADO_INEXISTENTE');
    expect(typeof body.message).toBe('string');
    expect(body.message).toContain('conta_banco_fk');
    expect(isErroResposta(body)).toBe(true);
  });

  it('erro do Postgres 23505 (unique) → 409 DUPLICADO com campo', () => {
    const pg = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'bancos_codigo_key',
      detail: 'Key (codigo)=(1) already exists.',
    });
    const { status, body } = capture(pg);

    expect(status).toBe(409);
    expect(body.code).toBe('DUPLICADO');
    expect(body.campos?.[0]?.campo).toBe('codigo');
  });

  it('erro do Postgres 23502 (not-null) → 400 CAMPO_OBRIGATORIO com campo', () => {
    const pg = Object.assign(new Error('null value'), { code: '23502', column: 'banco' });
    const { status, body } = capture(pg);

    expect(status).toBe(400);
    expect(body.code).toBe('CAMPO_OBRIGATORIO');
    expect(body.campos?.[0]).toEqual({ campo: 'banco', mensagem: 'Campo obrigatório.' });
  });

  it('erro do Postgres 23514 (check) → 422 REGRA_VIOLADA', () => {
    const pg = Object.assign(new Error('check'), { code: '23514', constraint: 'preco_positivo' });
    const { status, body } = capture(pg);
    expect(status).toBe(422);
    expect(body.code).toBe('REGRA_VIOLADA');
    expect(body.message).toContain('preco_positivo');
  });

  it('erro do Postgres 22P02 (valor inválido) → 400 VALOR_INVALIDO', () => {
    const pg = Object.assign(new Error('invalid input syntax for integer'), { code: '22P02' });
    const { status, body } = capture(pg);
    expect(status).toBe(400);
    expect(body.code).toBe('VALOR_INVALIDO');
  });

  it('AppError (BusinessRuleError) → 422 envelope, traduz code conhecido p/ PT', () => {
    const { status, body } = capture(new BusinessRuleError('MARGEM_INVALIDA', { margem: 100 }));
    expect(status).toBe(422);
    expect(body.statusCode).toBe(422);
    expect(body.code).toBe('MARGEM_INVALIDA');
    expect(body.message).toBe('A margem informada é inválida.'); // message===code → traduzido
  });

  it('AppError com code não mapeado → message = code cru (sem inventar)', () => {
    const { status, body } = capture(new BusinessRuleError('CODE_DESCONHECIDO'));
    expect(status).toBe(422);
    expect(body.code).toBe('CODE_DESCONHECIDO');
    expect(body.message).toBe('CODE_DESCONHECIDO');
  });

  it('AppError de autorização → 403 (ForbiddenActionError / UnauthorizedTenantError)', () => {
    const f = capture(new ForbiddenActionError('SEM_PERMISSAO', { form: 'BANCOS' }));
    expect(f.status).toBe(403);
    expect(f.body.code).toBe('SEM_PERMISSAO');
    expect(f.body.message).toBe('Você não tem permissão para executar esta ação.');

    const t = capture(new UnauthorizedTenantError());
    expect(t.status).toBe(403);
    expect(t.body.code).toBe('TENANT_FORBIDDEN');
  });

  it('HttpException do Nest → status + message PT por código', () => {
    const nf = capture(new NotFoundException());
    expect(nf.status).toBe(404);
    expect(nf.body.code).toBe('NAO_ENCONTRADO');
    expect(nf.body.message).toBe('Registro não encontrado.');

    const fb = capture(new ForbiddenException());
    expect(fb.status).toBe(403);
    expect(fb.body.code).toBe('ACESSO_NEGADO');
  });

  it('HttpException com mensagem própria preserva a mensagem', () => {
    const ex = new HttpException('Mensagem específica do domínio', HttpStatus.BAD_REQUEST);
    const { status, body } = capture(ex);
    expect(status).toBe(400);
    expect(body.message).toBe('Mensagem específica do domínio');
  });

  it('erro genérico (desconhecido) → 500 ERRO_INTERNO com message PT', () => {
    const { status, body } = capture(new Error('boom interno'));
    expect(status).toBe(500);
    expect(body.code).toBe('ERRO_INTERNO');
    expect(body.message).toBe('Ocorreu um erro inesperado. A equipe foi notificada.');
    // não vaza o erro interno
    expect(body.message).not.toContain('boom');
  });
});

describe('ZodValidationPipe → ValidationError → filtro renderiza campos[]', () => {
  const schema = z.object({
    banco: z.string().min(1, 'Banco é obrigatório'),
    uf: z.string().length(2, 'UF inválida (use a sigla de 2 letras)'),
  });

  it('pipe zod inválido → ValidationError com campos por path/mensagem', () => {
    const pipe = new ZodValidationPipe(schema);
    let caught: unknown;
    try {
      pipe.transform({ banco: '', uf: 'XYZ' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();

    // O filtro renderiza o envelope com campos[]
    const { status, body } = capture(caught);
    expect(status).toBe(400);
    expect(body.statusCode).toBe(400);
    expect(body.code).toBe('VALIDACAO');
    expect(body.message).toBe('Há campos inválidos.');
    expect(body.campos).toBeDefined();

    const porCampo = Object.fromEntries((body.campos ?? []).map((c) => [c.campo, c.mensagem]));
    expect(porCampo.banco).toBe('Banco é obrigatório');
    expect(porCampo.uf).toBe('UF inválida (use a sigla de 2 letras)');
  });

  it('pipe zod válido → passa o valor parseado (sem lançar)', () => {
    const pipe = new ZodValidationPipe(schema);
    const out = pipe.transform({ banco: 'ITAU', uf: 'SP' });
    expect(out).toEqual({ banco: 'ITAU', uf: 'SP' });
  });

  it('campo aninhado → path com ponto (ex.: itens.0.codrcb)', () => {
    const nested = z.object({ itens: z.array(z.object({ codrcb: z.number() })) });
    const pipe = new ZodValidationPipe(nested);
    let caught: unknown;
    try {
      pipe.transform({ itens: [{ codrcb: 'x' }] });
    } catch (e) {
      caught = e;
    }
    const { body } = capture(caught);
    expect(body.campos?.some((c) => c.campo === 'itens.0.codrcb')).toBe(true);
  });
});
