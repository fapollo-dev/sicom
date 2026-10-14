import { describe, it, expect } from 'vitest';
import { planejarParcelasApagar, obsDigitadaDaParcela, prefixoDuplicataApagar } from '@apollo/shared';

/** o PROCESSAR da tela de Contas a Pagar (GerarDocumentos + BuildParcelas, uAPagar.pas:1256): o plano puro que a prévia e a API compartilham */
describe('planejarParcelasApagar (o Processar do uAPagar)', () => {
  it('intervalo de dias: total/N com o resíduo na 1ª, desconto/embutidos divididos com o resíduo na última, BOL-001/003, 1/3 e a OBS digitada + PARCELA i DE N', () => {
    const p = planejarParcelasApagar({ total: 100, nrodup: 3, venc1: '2027-01-01', intervalo: 30, tipodoc: 'BOLETO', obs: ' TESTE ', desconto: 1, vendor: 2 });
    expect(p.map((x) => x.valor)).toEqual([33.34, 33.33, 33.33]);
    expect(p.map((x) => x.dtvenc)).toEqual(['2027-01-01', '2027-01-31', '2027-03-02']);
    expect(p.map((x) => x.duplicata)).toEqual(['BOL-001/003', 'BOL-002/003', 'BOL-003/003']);
    expect(p.map((x) => x.nrparcela)).toEqual(['1/3', '2/3', '3/3']);
    expect(p.map((x) => x.desconto)).toEqual([0.33, 0.33, 0.34]);
    expect(p.map((x) => x.vendor)).toEqual([0.67, 0.67, 0.66]);
    expect(p[0].obs).toBe('TESTE PARCELA 1 DE 3');
    expect(p[2].obs).toBe('TESTE PARCELA 3 DE 3');
  });

  it('dia fixo do mês (o IncMonth clampando o fim do mês) e "Incluir restantes na última parcela"', () => {
    const p = planejarParcelasApagar({ total: 100, nrodup: 3, venc1: '2027-01-31', diaFixo: 10, restantesNaUltima: true, tipodoc: 'RH' });
    expect(p.map((x) => x.dtvenc)).toEqual(['2027-01-10', '2027-02-10', '2027-03-10']);
    expect(p.map((x) => x.valor)).toEqual([33.33, 33.33, 33.34]);
    expect(p[0].duplicata).toBe('OUT-001/003');
    expect(p[0].obs).toBe('PARCELA 1 DE 3');
    const fim = planejarParcelasApagar({ total: 10, nrodup: 2, venc1: '2027-01-31', diaFixo: 31 });
    expect(fim.map((x) => x.dtvenc)).toEqual(['2027-01-31', '2027-02-28']);
  });

  it('a duplicata pelo MODELO_DUPLICATA 2 (NRONF-) e a OBS "REFERENTE A NOTA FISCAL"; a digitada só fica quando é o número da NF; tipos sem prefixo', () => {
    const p = planejarParcelasApagar({ total: 50, nrodup: 2, venc1: '2027-02-05', intervalo: 15, tipodoc: 'BOLETO', nronf: 555, modeloDuplicata: 2, dtcompra: '2027-01-05', duplicata: '555' });
    expect(p.map((x) => x.duplicata)).toEqual(['555', '555']);
    expect(p[0].obs).toBe('PARCELA 1 DE 2 REFERENTE A NOTA FISCAL 555 EMITIDA EM 05/01/2027');
    const q = planejarParcelasApagar({ total: 50, nrodup: 2, venc1: '2027-02-05', intervalo: 15, tipodoc: 'A VISTA', nronf: 555, modeloDuplicata: 2, duplicata: 'X' });
    expect(q.map((x) => x.duplicata)).toEqual(['555-001/002', '555-002/002']);
    expect(prefixoDuplicataApagar('A VISTA')).toBe('');
    expect(prefixoDuplicataApagar('jurídica')).toBe('JUR-');
    expect(obsDigitadaDaParcela('PARCELAMENTO DE DÉBITOS PARCELA 2 DE 24')).toBe('PARCELAMENTO DE DÉBITOS');
    expect(obsDigitadaDaParcela('PARCELA 1 DE 2 REFERENTE A NOTA FISCAL 555 EMITIDA EM 05/01/2027')).toBe('');
  });

  it('as validações do legado: sem intervalo nem dia (com N > 1), sem vencimento, total insuficiente', () => {
    expect(() => planejarParcelasApagar({ total: 100, nrodup: 3, venc1: '2027-01-01' })).toThrow('APAGAR_PARCELAS_SEM_CONFIG');
    expect(() => planejarParcelasApagar({ total: 100, nrodup: 3, venc1: '', intervalo: 30 })).toThrow('APAGAR_PARCELAS_SEM_VENCIMENTO');
    expect(() => planejarParcelasApagar({ total: 0.02, nrodup: 3, venc1: '2027-01-01', intervalo: 30 })).toThrow('PARCELA_VALOR_INSUFICIENTE');
    expect(planejarParcelasApagar({ total: 10, nrodup: 1, venc1: '2027-01-01' })[0]).toMatchObject({ nrparcela: '1/1', valor: 10, dtvenc: '2027-01-01' });
  });
});
