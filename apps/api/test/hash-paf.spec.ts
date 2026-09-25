import { describe, expect, it } from 'vitest';
import { hashPaf } from '../src/modules/shared/hash-paf';
import { historicoDaBaixa } from '../src/modules/cadastro/cartao-baixa.service';

/** o HASHPAF reconstruído do dado de produção (MULTI_PRECO, 25/09/2026) */
describe('HASHPAF (getHASH_MultiPreco)', () => {
  it('MD5 maiúsculo de IDPRODUTO+IDEMPRESA+VRVENDA+VRCUSTO no CurrToStr pt-BR — 4 preços reais', () => {
    expect(hashPaf(6040, 2, 15.99, 7.14)).toBe('CF2D021C9E5903072610ED3E8AD28A12');
    expect(hashPaf(6026, 51, 4.99, 2.8)).toBe('900A61C43914D693BC364A56726AF822');
    expect(hashPaf(6026, 52, 7.49, 4.5)).toBe('47F80069391EFE2430C6C34077ADA685');
    expect(hashPaf(6040, 52, '15.9900', '8.5700')).toBe('EE37C6CD580C2F767ABD8961C9B62D51');
  });
});

describe('histórico da baixa de cartão', () => {
  it('o que o operador digita vai antes de "REF. BX LOTE: <lote>" (dbmObsEnter)', () => {
    expect(historicoDaBaixa('AMEX', 91347)).toBe('AMEX REF. BX LOTE: 91347');
    expect(historicoDaBaixa('', 91347)).toBe('REF. BX LOTE: 91347');
    expect(historicoDaBaixa('MASTER V REF. BX LOTE: 91365', 91365)).toBe('MASTER V REF. BX LOTE: 91365');
  });
});
