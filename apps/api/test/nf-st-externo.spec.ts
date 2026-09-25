import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stExternoDoItem, calculoIndexador, type ContextoStExterno, type ItemSt } from '../src/modules/cadastro/nf-indexador-item';

/**
 * O ST EXTERNO da entrada (`RecalculaICMSST` + `TIndexadorTributario`) contra a PRODUÇÃO: 183 itens de entrada de 2026 com indexador
 * (sorteio fixo entre os 45.042 das lojas "O"), com o STREAL, o VRBASE_STEXTERNO e o VRICMS_STEXTERNO que o legado gravou. Na amostra
 * inteira: 100% nos digitados e 98,2% nos importados (os que sobram são notas com o item sem análise); aqui cada campo tem de bater em 95%.
 */
interface Caso { item: ItemSt; fig: Record<string, unknown>; importada: boolean; tipoemissao: string; esperado: Record<string, number> }
const casos = JSON.parse(readFileSync(join(__dirname, 'fixtures/nf-st-externo.golden.json'), 'utf8')) as Caso[];
const ctxO = (c: Partial<ContextoStExterno>): ContextoStExterno => ({
  figuraFiscal: 'O', liberada: false, fornecedorLivre: false, importada: false, tipoemissao: '1', calculaSemIndexador: false,
  rateio: 'N', rateioSt: 'N', totalBaseIcmt: 0, totalIcmSt: 0, totalProdSt: 0, ...c,
});

describe('ST externo do item de entrada contra a produção', () => {
  it('bate o que o legado gravou em ≥ 95% dos itens, campo a campo', () => {
    const acertos: Record<string, number> = {};
    const erros: string[] = [];
    for (const c of casos) {
      const r = stExternoDoItem(c.item, c.fig, ctxO({ importada: c.importada, tipoemissao: c.tipoemissao })) as Record<string, number>;
      for (const [k, v] of Object.entries(c.esperado)) {
        if (Math.abs((r[k] ?? 0) - v) <= 0.011) acertos[k] = (acertos[k] ?? 0) + 1;
        else if (erros.length < 20) erros.push(`${k}: ${r[k]} ≠ ${v}`);
      }
    }
    for (const k of Object.keys(casos[0].esperado)) {
      expect((acertos[k] ?? 0) / casos.length, `${k}: ${erros.join(' | ')}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  const item: ItemSt = { totalprods: 100, totaldescprod: 0, vripi: 0, vrfrete: 0, vrseguro: 0, depsacess: 0, vricmst: 5, vrbasest: 150, vricm: 0, cfop: '1403', cst: 60,
    geraicmFrete: false, mva: 40, arredonda: true, mvaProduto: 0, aliqopeInterna: 0 };
  const fig = { aliquota_dest: 18, icm_fonte: 12, redcom: 100, mva: 40, aliquota_fem: 0, reducao: 100, tp_figura: 'N', codcfop: 1403, st_externo: 'N', origem: 'MA', destino: 'MG' };

  it('a recolher sem piso em zero, zerado entre −0,02 e 0,01; bonificação tributada e MVA 0 não calculam', () => {
    expect(stExternoDoItem(item, fig, ctxO({}))).toEqual({ streal: 15.04, vrbase_stexterno: 150.24, vricms_stexterno: 10.04, vricms_stexterno_separadonf: 0 });
    expect(calculoIndexador({ ...base(), vrIcmsStNota: 20 }).icmsStRecolher).toBeCloseTo(-4.956, 3); // negativo fica
    expect(calculoIndexador({ ...base(), vrIcmsStNota: 15.05 }).icmsStRecolher).toBe(0); // −0,006 → 0
    expect(calculoIndexador({ ...base(), cfop: 1910, cst: 0 }).calcularSt).toBe(false);
    expect(calculoIndexador({ ...base(), cfop: 1910, cst: 60 }).calcularSt).toBe(true);
    expect(calculoIndexador({ ...base(), mva: 0 }).bcStCalculada).toBe(0);
    // a BC-ST da nota vale quando encosta (0,01999)
    expect(calculoIndexador({ ...base(), vrBcStNota: 150.26 }).bcStCalculada).toBe(150.26);
  });

  it('fornecedor livre e loja D: o ST da nota; os TEMP com MVA/ALIQOPE no produto e nota digitada; emissão própria com ST externo separa', () => {
    const daNota = { streal: 5, vrbase_stexterno: 150, vricms_stexterno: 0, vricms_stexterno_separadonf: 0 };
    expect(stExternoDoItem(item, null, ctxO({ fornecedorLivre: true }))).toEqual(daNota);
    expect(stExternoDoItem(item, null, ctxO({ figuraFiscal: 'D' }))).toEqual(daNota);
    expect(stExternoDoItem(item, null, ctxO({ figuraFiscal: 'D', tipoemissao: '0' }))).toEqual({});
    expect(stExternoDoItem(item, null, ctxO({}))).toEqual({}); // sem indexador: fica como está
    // TEMP: (100) × 1,40 = 140; 140 × 18% − ICMS próprio 12 = 13,20
    expect(stExternoDoItem({ ...item, mvaProduto: 40, aliqopeInterna: 18, vricm: 12 }, null, ctxO({ fornecedorLivre: true })))
      .toEqual({ vrbasest: 140, vricmst: 13.2, streal: 13.2, vrbase_stexterno: 140 });
    expect(stExternoDoItem(item, { ...fig, st_externo: 'S' }, ctxO({ tipoemissao: '0' })))
      .toEqual({ vrbasest: 0, vricmst: 0, streal: 0, vrbase_stexterno: 0, vricms_stexterno: 15.04, vricms_stexterno_separadonf: 15.04 });
  });

  function base() {
    return { vrProduto: 100, vrDesconto: 0, vrIpi: 0, vrOutrasDesp: 0, vrFrete: 0, vrIcmsStNota: 5, vrBcStNota: 0, reducaoBcSt: 100, mva: 40, aliquota: 18,
      aliquotaFonte: 12, aliquotaFem: 0, reducaoAliquotaFonte: 100, lei3166: false, aliqFonteLei3166: 0, fornecedorSimples: false, cfop: 1403, icmsComFrete: false,
      cst: 60, ufOrigem: 'MA', ufDestino: 'MG', considerarDesconto: false };
  }
});
