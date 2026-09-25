import { describe, it, expect } from 'vitest';
import { pisCofinsDoItemC170, baseCofinsC170, icmsDoItemC170, pisCofinsDoCabecalho, indFreteC100 } from '../src/modules/sped/sped-pc-legado';

const PC_CONFIG = new Set([2102, 1102, 1403, 2403, 1910, 2910, 2101, 1101, 1401, 2401, 1253, 1933, 1353, 2353, 1411, 2411, 1202, 2202]); // a produção
const trib = { aliq_pis_ent: 1.65, aliq_cofins_ent: 7.6, aliq_pis_sai: 1.65, aliq_cofins_sai: 7.6, cst_pis_ent: 50, cst_cofins_ent: 50, cst_pis_sai: 1, cst_cofins_sai: 1 };

describe('EFD-Contribuições — o C170 e o C100 do legado', () => {
  it('o CASE do CST e das alíquotas (UdmSpedPisCofins.dfm:2375-2454)', () => {
    expect(pisCofinsDoItemC170(1102, 'E', 'J', trib, PC_CONFIG)).toEqual({ cst: 50, aliqPis: 1.65, aliqCofins: 7.6 });
    expect(pisCofinsDoItemC170(1910, 'E', 'J', trib, PC_CONFIG)).toEqual({ cst: 74, aliqPis: 0, aliqCofins: 0 }); // bonificação
    expect(pisCofinsDoItemC170(1556, 'E', 'J', trib, PC_CONFIG)).toEqual({ cst: 74, aliqPis: 0, aliqCofins: 0 }); // uso e consumo
    expect(pisCofinsDoItemC170(1102, 'E', 'F', trib, PC_CONFIG)).toEqual({ cst: 74, aliqPis: 0, aliqCofins: 0 }); // pessoa física com CST de crédito
    expect(pisCofinsDoItemC170(1152, 'E', 'J', trib, PC_CONFIG)).toEqual({ cst: 74, aliqPis: 0, aliqCofins: 0 }); // fora do PC_CONFIG
    expect(pisCofinsDoItemC170(1202, 'E', 'J', { ...trib, cst_pis_ent: 60, cst_cofins_ent: 60 }, PC_CONFIG)).toEqual({ cst: 50, aliqPis: 1.65, aliqCofins: 7.6 });
    expect(pisCofinsDoItemC170(1202, 'E', 'F', { ...trib, aliq_pis_sai: 1.1 }, PC_CONFIG).aliqPis).toBe(1.1); // devolução: a alíquota de saída
    expect(pisCofinsDoItemC170(5102, 'S', 'J', trib, PC_CONFIG)).toEqual({ cst: 1, aliqPis: 1.65, aliqCofins: 7.6 });
    expect(pisCofinsDoItemC170(5929, 'S', 'J', trib, PC_CONFIG)).toEqual({ cst: 8, aliqPis: 0, aliqCofins: 0 });
    expect(pisCofinsDoItemC170(5949, 'S', 'J', trib, PC_CONFIG)).toEqual({ cst: 8, aliqPis: 0, aliqCofins: 0 });
  });

  it('a BASECOFINS, o ICMS do item e o IND_FRT', () => {
    const it = { vrcusto: 10, quantidade: 3, vrdescprod: 2, depsacess: 1.5, seguro: 1, frete: 2, vricm: 5 };
    expect(baseCofinsC170(it, 'E', true, 7.6)).toBe(r(28 + 1.5 + 0.28 + 0.56));
    expect(baseCofinsC170(it, 'S', true, 7.6)).toBe(r(28 + 1.5 + 0.28 + 0.56 - 5)); // abate o ICMS na saída
    expect(icmsDoItemC170({ cfop: '1102', aliquota: 'T01', vrbasecalculo: 100, icme: 18, vricm: 18 }, false)).toEqual({ bc: 100, aliq: 18, valor: 18 });
    expect(icmsDoItemC170({ cfop: '1403', aliquota: 'STB', vrbasecalculo: 100, icme: 18, vricm: 18 }, false)).toEqual({ bc: 0, aliq: 0, valor: 0 }); // STB não mantém (≠ ICMS-IPI)
    expect(icmsDoItemC170({ cfop: '1102', aliquota: 'T01', vrbasecalculo: 100, icme: 18, vricm: 18 }, true)).toEqual({ bc: 0, aliq: 0, valor: 0 }); // PROC_CUPOM
    expect(icmsDoItemC170({ cfop: '5929', aliquota: 'T01', vrbasecalculo: 100, icme: 18, vricm: 18 }, false)).toEqual({ bc: 0, aliq: 0, valor: 0 });
    expect(indFreteC100(null)).toBe('0');
    expect(indFreteC100(9)).toBe('9');
    expect(indFreteC100(7)).toBe('');
  });

  it('o PIS/COFINS do cabeçalho: a conta do FDqNF, com a alíquota pelo tipo de emissão', () => {
    const it = { cfop: 1102, vrcusto: 10, quantidade: 10, desconto: 10, vricmst: 5, depsacess: 1, vroutrasdesp: 2, frete: 1, ipi: 5 };
    // 100 − 10 + 5 + 1 + 2 + 0,90 + 4,50 = 103,40 → PIS 1,71 / COFINS 7,86
    expect(pisCofinsDoCabecalho([{ it, pc: trib }], 'E', '1', 'J', PC_CONFIG, false)).toEqual({ pis: 1.71, cofins: 7.86 });
    // emissão própria: as regras de saída — 1102 fora da lista de saída e dentro do PC_CONFIG → a alíquota de saída
    expect(pisCofinsDoCabecalho([{ it, pc: { ...trib, aliq_pis_sai: 0.65, aliq_cofins_sai: 3 } }], 'E', '0', 'J', PC_CONFIG, false)).toEqual({ pis: 0.67, cofins: 3.1 });
    expect(pisCofinsDoCabecalho([{ it: { ...it, cfop: 5929 }, pc: trib }], 'S', '0', 'J', PC_CONFIG, false)).toEqual({ pis: 0, cofins: 0 });
  });
});

function r(x: number) { return Math.round(x * 100) / 100; }
