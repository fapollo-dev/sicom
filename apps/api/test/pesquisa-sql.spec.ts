import { describe, it, expect } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { condicaoDoUsuario, numeroDigitado, dataDigitada, tipoDoCampo, operacaoDeAbertura } from '../src/shared/pesquisa/pesquisa-sql';

// Kysely só para compilar (o Pool nunca abre conexão em .compile()).
const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({}) }) });
const sqlDe = (c: ReturnType<typeof condicaoDoUsuario>) => {
  const q = db.selectFrom('v').selectAll().where(c!).compile();
  return { sql: q.sql.replace(/^select \* from "v" where /, ''), p: q.parameters };
};

describe('o filtro da Pesquisa (GetParametroWhere do uComunPesquisaRel)', () => {
  it('texto: as 6 operações, com upper dos dois lados', () => {
    expect(sqlDe(condicaoDoUsuario('razao', 'texto', 'igual', 'lufir'))).toEqual({ sql: 'upper("razao"::text) = $1', p: ['LUFIR'] });
    expect(sqlDe(condicaoDoUsuario('razao', 'texto', 'comeca', 'luf')).p).toEqual(['LUF%']);
    expect(sqlDe(condicaoDoUsuario('razao', 'texto', 'termina', 'fir')).p).toEqual(['%FIR']);
    expect(sqlDe(condicaoDoUsuario('razao', 'texto', 'qualquer', 'bento')).p).toEqual(['%BENTO%']);
    expect(sqlDe(condicaoDoUsuario('razao', 'texto', 'contido', 'apollo, sistemas'))).toEqual({ sql: 'upper("razao"::text) in ($1, $2)', p: ['APOLLO', 'SISTEMAS'] });
  });

  it('"+" separa palavras em ordem (ARROZ+TIO → %ARROZ %TIO%)', () => {
    expect(sqlDe(condicaoDoUsuario('descricao', 'texto', 'qualquer', 'arroz+tio')).p).toEqual(['%ARROZ %TIO%']);
  });

  it("'' acha o vazio e o Diferente de '' o preenchido; texto vazio não filtra", () => {
    expect(sqlDe(condicaoDoUsuario('obs', 'texto', 'igual', "''")).sql).toBe(`coalesce("obs"::text, '') = ''`);
    expect(sqlDe(condicaoDoUsuario('obs', 'texto', 'diferente', "''")).sql).toBe(`coalesce("obs"::text, '') <> ''`);
    expect(condicaoDoUsuario('obs', 'texto', 'qualquer', '   ')).toBeNull();
  });

  it('número: vazio vale 0 (where CODIGO = 0), Entre inclusivo, Contido em com ponto decimal', () => {
    expect(sqlDe(condicaoDoUsuario('codigo', 'numero', 'igual', ''))).toEqual({ sql: '"codigo" = $1', p: [0] });
    expect(sqlDe(condicaoDoUsuario('valor', 'numero', 'entre', '1.234,5', '2000'))).toEqual({ sql: '"valor" between $1 and $2', p: [1234.5, 2000] });
    expect(sqlDe(condicaoDoUsuario('aliq', 'numero', 'contido', '5.1,6.9,7.8')).p).toEqual([5.1, 6.9, 7.8]);
    expect(sqlDe(condicaoDoUsuario('codigo', 'numero', 'maior', '10')).sql).toBe('"codigo" > $1');
  });

  it('data: o dia inteiro; vazia não filtra; Entre sem fim usa o início; Contido em dd/mm/aaaa', () => {
    expect(sqlDe(condicaoDoUsuario('vencimento', 'data', 'igual', '2026-10-07'))).toEqual({ sql: '"vencimento"::date = $1::date', p: ['2026-10-07'] });
    expect(condicaoDoUsuario('vencimento', 'data', 'igual', '')).toBeNull();
    expect(sqlDe(condicaoDoUsuario('vencimento', 'data', 'entre', '2026-10-03', '')).p).toEqual(['2026-10-03', '2026-10-03']);
    expect(sqlDe(condicaoDoUsuario('vencimento', 'data', 'contido', '13/10/2011,1/2/2026')).p).toEqual(['2011-10-13', '2026-02-01']);
  });

  it('operação fora do tipo é recusada; tipo pelo information_schema; abertura por tipo', () => {
    expect(() => condicaoDoUsuario('codigo', 'numero', 'comeca', '1')).toThrow('OPERACAO_INVALIDA');
    expect(tipoDoCampo('character varying')).toBe('texto');
    expect(tipoDoCampo('numeric')).toBe('numero');
    expect(tipoDoCampo('timestamp with time zone')).toBe('data');
    expect(operacaoDeAbertura('texto')).toBe('qualquer');
    expect(operacaoDeAbertura('data')).toBe('igual');
    expect(numeroDigitado('')).toBe(0);
    expect(() => dataDigitada('31-12')).toThrow('DATA_INVALIDA');
    expect(sql.ref('x')).toBeTruthy();
  });
});
