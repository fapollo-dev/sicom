import { describe, expect, it } from 'vitest';
import { hashPaf, hashProduto } from '../src/modules/shared/hash-paf';
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

describe('HASHPAF do produto (getHASH_Produtos)', () => {
  it('MD5 maiúsculo de IDPRODUTO+CODBARRA+DESCRICAO+UNIDADE+ALIQUOTA+ATIVO+NCMSH+CEST, o acento como "?" (Indy ASCII) — produtos reais', () => {
    expect(hashProduto({ idproduto: 868974, codbarra: '7896471802983', descricao: 'LAVA ROUPA PO GEO FLORAL 1,6KG', unidade: 'UN', aliquota: 'STB', ativo: 'S', ncmsh: '38089419', cest: '1100200' }))
      .toBe('7270E1830382C605A14C59894EBEACD0');
    expect(hashProduto({ idproduto: 868975, codbarra: '7896471802563', descricao: 'LAVA ROUPA PÓ GEO MULTIAÇÃO 1,6KG', unidade: 'UN', aliquota: 'STB', ativo: 'S', ncmsh: '34025000', cest: '1100200' }))
      .toBe('560F095F48157D7D3B382CE07BCB62CD');
    expect(hashProduto({ idproduto: 868766, codbarra: '8721274700053', descricao: 'KIBON  MINI PAÇOQUITA 92G', unidade: 'UN', aliquota: 'STB', ativo: 'S', ncmsh: '21050010', cest: '2300100' }))
      .toBe('D9929350CD842AE57209A74260E25966');
    // o "Inseriu" da LOG: a alíquota era T01 (depois trocada para IST sem refazer o hash); CEST nulo = vazio
    expect(hashProduto({ idproduto: 868973, codbarra: '9365', descricao: 'CER NE60000 33X60 A 2,19M - VIVA', unidade: 'UN', aliquota: 'T01', ativo: 'S', ncmsh: '69072200', cest: null }))
      .toBe('CE1352A69B555AC294F893697EEE8128');
  });
});

describe('histórico da baixa de cartão', () => {
  it('o que o operador digita vai antes de "REF. BX LOTE: <lote>" (dbmObsEnter)', () => {
    expect(historicoDaBaixa('AMEX', 91347)).toBe('AMEX REF. BX LOTE: 91347');
    expect(historicoDaBaixa('', 91347)).toBe('REF. BX LOTE: 91347');
    expect(historicoDaBaixa('MASTER V REF. BX LOTE: 91365', 91365)).toBe('MASTER V REF. BX LOTE: 91365');
  });
});
