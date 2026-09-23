import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { argsPelosItens, montarDeschist, type ItemHistoricoContabil } from '@apollo/shared';
import {
  ARGS_POR_HISTORICO,
  CAMPO_DO_LEGADO,
  argsDoHistorico,
  type CtxHistorico,
} from '../src/modules/cobranca/historico-contabil.args';

/**
 * OS ITENS DO HISTÓRICO CONTÁBIL (mig 294) contra o mapa medido e contra o razão do cliente.
 *
 * Os itens vêm do seed da própria migration — a cópia fiel dos 144 itens da produção —, então o teste mede o
 * que o Apollo carrega, não uma lista paralela.
 */
function itensDoSeed(): Map<number, ItemHistoricoContabil[]> {
  const sql = readFileSync(join(__dirname, '../migrations/294_itens_historico_contabil.sql'), 'utf8');
  const out = new Map<number, ItemHistoricoContabil[]>();
  const re = /^\s*\((\d+),(\d+),(\d+|NULL),(?:\d+|NULL),'([^']*)','([^']*)',(?:'[^']*'|NULL),'([SN])'\)/gm;
  for (const m of sql.matchAll(re)) {
    const hist = Number(m[2]);
    const lista = out.get(hist) ?? [];
    lista.push({ ordem: m[3] === 'NULL' ? null : Number(m[3]), campo: m[4], tabela: m[5], status: m[6] });
    out.set(hist, lista);
  }
  return out;
}

/** um valor diferente em cada chave do contexto — para saber de qual chave veio cada argumento. */
const SENTINELA: Required<CtxHistorico> = {
  documento: 'documento', documentoTexto: 'documentoTexto', lote: 'lote', parceiro: 'parceiro',
  codparceiro: 777, cnpj: 'cnpj', tipodoc: 'tipodoc', notafiscal: 'notafiscal', operadora: 'operadora',
  usuario: 'usuario', historicoMov: 'historicoMov', obs: 'obs', verba: 'verba', conta: 'conta', cfop: 'cfop',
  loja: 'loja',
};

const TEMPLATES: Record<number, string> = {
  41: 'NOTA FISCAL DESPESAS * FORNECEDOR * CFOP *',
  62: 'CREDITO ICMS NFISCAL COMPRA .: * CNPJ.: * PARCEIRO.:*',
  64: 'NOTA FISCAL PERDA.: *CFOP .: *LOJA .: *',
  66: 'DEBITO ICMS NFISCAL PERDA .: * CFOP .: *LOJA .: *',
  70: 'CUSTO VENDA NFISCAL .:*CFOP .: *',
  108: 'DEVOLUCAO COMPRA .: *  NOTAFISCAL .: *',
  121: 'DOCTO.: *LOTE.: * * PARCEIRO.: * *',
  201: 'FÉRIAS A PAGAR .: *',
};

describe('itens do histórico contábil (mig 294)', () => {
  const itens = itensDoSeed();

  it('o seed traz os 144 itens dos 54 históricos', () => {
    expect([...itens.values()].reduce((n, l) => n + l.length, 0)).toBe(144);
    expect(itens.size).toBe(54);
  });

  it('o dicionário não contradiz nenhum histórico que o mapa medido já prova', () => {
    const conflitos: string[] = [];
    for (const [hist, f] of Object.entries(ARGS_POR_HISTORICO)) {
      const lista = itens.get(Number(hist));
      if (!lista) continue;
      const medido = f(SENTINELA);
      const pelosItens = argsPelosItens(lista, (t, c) => CAMPO_DO_LEGADO[`${t}.${c}`]?.(SENTINELA) ?? null);
      // só as posições que o dicionário sabe traduzir: as que ele não sabe ficam vazias, como hoje
      medido.forEach((esperado, i) => {
        const obtido = pelosItens[i];
        if (obtido != null && obtido !== esperado) conflitos.push(`${hist}[${i}]: itens=${String(obtido)} mapa=${String(esperado)}`);
      });
    }
    expect(conflitos).toEqual([]);
  });

  // linhas REAIS do razão do cliente, de históricos que o mapa medido não tinha
  const CASOS: Array<{ hist: number; ctx: CtxHistorico; esperado: string }> = [
    {
      hist: 62, // o CFOP cai no rótulo "CNPJ": a ordem é a dos ITENS, não a dos rótulos
      ctx: { documento: 7922433, cfop: '1403', cnpj: '23.814.940/0010-00', parceiro: 'X', loja: '001' },
      esperado: 'CREDITO ICMS NFISCAL COMPRA .: 007922433 CNPJ.: 1403 PARCEIRO.:23.814.940/0010-00',
    },
    {
      hist: 64,
      ctx: { documento: 4413, cfop: '5927', loja: '001' },
      esperado: 'NOTA FISCAL PERDA.: 000004413CFOP .: 5927LOJA .: 001',
    },
    {
      hist: 66, // os itens começam pelo CFOP: 'PERDA .: 5927 CFOP .: 001LOJA .: 000004412'
      ctx: { documento: 4412, cfop: '5927', loja: '001' },
      esperado: 'DEBITO ICMS NFISCAL PERDA .: 5927 CFOP .: 001LOJA .: 000004412',
    },
    {
      hist: 70,
      ctx: { documento: 4393, cfop: '5405' },
      esperado: 'CUSTO VENDA NFISCAL .:5405CFOP .: 000004393',
    },
    {
      hist: 41,
      ctx: { documento: 26783, parceiro: 'COLETO ALDA E FILHOS LTDA', cfop: '1653' },
      esperado: 'NOTA FISCAL DESPESAS 000026783 FORNECEDOR COLETO ALDA E FILHOS LTDA CFOP 1653',
    },
    {
      hist: 108,
      ctx: { documento: 4407, parceiro: 'LATICINIO CANTO DE MINAS LTDA' },
      esperado: 'DEVOLUCAO COMPRA .: LATICINIO CANTO DE MINAS LTDA  NOTAFISCAL .: 000004407',
    },
    {
      hist: 121,
      ctx: { documento: 280845, lote: '90683', verba: 'TAXAS DE CARTAO', parceiro: 'SODEXO DO BRASIL COMERCIAL S.A.', obs: 'TAXA PLUXEE' },
      esperado: 'DOCTO.: 000280845LOTE.: 90683 TAXAS DE CARTAO PARCEIRO.: SODEXO DO BRASIL COMERCIAL S.A. TAXA PLUXEE',
    },
    {
      hist: 201,
      ctx: { parceiro: 'SEFURI CAUANE DA SILVA' },
      esperado: 'FÉRIAS A PAGAR .: SEFURI CAUANE DA SILVA',
    },
  ];

  for (const c of CASOS) {
    it(`histórico ${c.hist} sai como o razão do cliente`, () => {
      expect(ARGS_POR_HISTORICO[c.hist]).toBeUndefined(); // é o caminho dos itens que está sob teste
      expect(montarDeschist(TEMPLATES[c.hist], argsDoHistorico(c.hist, c.ctx, itens.get(c.hist)))).toBe(c.esperado);
    });
  }

  it('o mapa medido vence os itens onde os dois existem', () => {
    // 89: os itens dizem ARECEBER.OBS; o razão mostra o centro de custo (5.895 de 5.895) — e é o mapa que manda
    const ctx: CtxHistorico = { documento: 130582, verba: 'AÇAO DE VENDAS', obs: 'outra coisa', parceiro: 'NESTLE BRASIL LTDA' };
    expect(montarDeschist('A RECEBER DOCTO .: * VERBA .: * PARCEIRO .: *', argsDoHistorico(89, ctx, itens.get(89))))
      .toBe('A RECEBER DOCTO .: 000130582 VERBA .: AÇAO DE VENDAS PARCEIRO .: NESTLE BRASIL LTDA');
  });

  it('item inativo sai da lista e o seguinte sobe um buraco', () => {
    const lista: ItemHistoricoContabil[] = [
      { ordem: 1, tabela: 'NF', campo: 'NRO_NF', status: 'N' },
      { ordem: 2, tabela: 'NF', campo: 'CFOP', status: 'S' },
    ];
    expect(argsPelosItens(lista, (_t, c) => c)).toEqual(['CFOP']);
  });
});
