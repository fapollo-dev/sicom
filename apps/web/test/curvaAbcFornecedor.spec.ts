import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paginasDoModelo } from '../src/shared/fr3/render';

/** os layouts PERSONALIZADOS da produção (RELATORIOS 703 e 702) — o A/B/C sai do script do .fr3, em duas passadas */
const modelo = (arq: string) => readFileSync(resolve(__dirname, 'fixtures/relatorios', arq), 'utf8');
const agora = new Date(2026, 9, 8, 10, 0, 0);
const texto = (paginas: Array<{ html: string[] }>) => paginas.map((p) => p.html.join(' ')).join(' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const linha = (CODPARCEIRO: number, RAZAO: string, TOTALNF: number, extra: Record<string, unknown> = {}) => ({
  CODPARCEIRO, RAZAO, IDEMPRESA: 1, PC_CURVA_ABC_A: 60, PC_CURVA_ABC_B: 20, PC_CURVA_ABC_C: 10, QTDE: 10, TOTALNF, ...extra,
});
// 1.000 de compra: 50% · 70% · 85% · 95% · 100% acumulados com as faixas da loja 1 (A 60, B 20, C 10)
const consulta = [linha(1, 'FORN UM', 500), linha(2, 'FORN DOIS', 200), linha(3, 'FORN TRES', 150), linha(4, 'FORN QUATRO', 100), linha(5, 'FORN CINCO', 50)];
const vars = { DtInicial: "'01/09/2026'", DtFinal: "'30/09/2026'", Empresa: "'1'" };

describe('Curva ABC por fornecedor (uRelCurvaABCFornecedor) no layout da produção', () => {
  it('o script classifica pelo acumulado: A até 60, B até 80, C até 90 e acima disso repete a letra anterior', () => {
    const t = texto(paginasDoModelo(modelo('curva-abc-fornecedor.fr3'), { dbdConsulta: consulta }, agora, vars));
    expect(t).toContain('RELATÓRIO CURVA ABC POR FORNECEDOR');
    expect(t).toContain('01/09/2026');
    expect(t).toMatch(/FORN UM 10,00 A 50,0000 50,00/);
    expect(t).toMatch(/FORN DOIS 10,00 B 20,0000 70,00/);
    expect(t).toMatch(/FORN TRES 10,00 C 15,0000 85,00/);
    // 95% passa de A+B+C (90): o script não tem o else — fica a letra da linha anterior
    expect(t).toMatch(/FORN QUATRO 10,00 C 10,0000 95,00/);
    expect(t).toContain('1.000,00'); // SUM(TOTALNF)
  });

  it('o layout "com saidas" mostra a quantidade e o total vendidos de cada fornecedor', () => {
    const t = texto(paginasDoModelo(modelo('curva-abc-fornecedor-saidas.fr3'),
      { dbdConsulta: consulta.map((l, i) => ({ ...l, QTDE_VEN: 5 + i, TOTAL_VENDA: 100 * (i + 1) })) }, agora, vars));
    expect(t).toContain('FORN CINCO');
    expect(t).toContain('1.500,00'); // SUM(TOTAL_VENDA) = 100+200+300+400+500
  });
});
