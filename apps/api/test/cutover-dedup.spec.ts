import { describe, it, expect } from 'vitest';
import { dedupCodref, type RawCodref } from '../scripts/cutover/dedup-codref';

/** CUTOVER do de-para — motor de de-dup (pura). Cobre cada categoria de colisão do golden. */

// helper: linha válida por default (produto existe/ativo, fornecedor válido); sobrescreve o que interessa.
function row(over: Partial<RawCodref>): RawCodref {
  return {
    codreferencia_for: 1,
    idproduto: 100,
    codref: 'ABC',
    codfor: 9,
    tiporef: 'E',
    fator_embalagem: null,
    produto_existe: true,
    produto_ativo: true,
    produto_codbarra_norm: null,
    fornecedor_valido: true,
    ...over,
  };
}

describe('dedupCodref', () => {
  it('singleton migra limpo; tiporef null→E; fator null→1; codref normalizado', () => {
    const { keep, report } = dedupCodref([
      row({ codreferencia_for: 10, idproduto: 100, codfor: 9, codref: '789.6417', tiporef: null, fator_embalagem: null }),
    ]);
    expect(keep).toHaveLength(1);
    expect(keep[0]).toMatchObject({ codfor: 9, codref: '7896417', idproduto: 100, tiporef: 'E', fator_embalagem: 1, legacy_id: 10 });
    expect(report.limpas).toBe(1);
    expect(report.colisoes.grupos).toBe(0);
  });

  it('descarta SUJAS (codfor nulo/inválido, idproduto nulo/inexistente, codref branco)', () => {
    const { keep, report } = dedupCodref([
      row({ codfor: null }),
      row({ fornecedor_valido: false }),
      row({ idproduto: null }),
      row({ produto_existe: false }),
      row({ codref: '   ' }),
    ]);
    expect(keep).toHaveLength(0);
    expect(report.descartadas.sujas).toBe(5);
  });

  it("descarta 'SEM GTIN' (sentinela textual, não é código) — mesmo com N produtos", () => {
    const { keep, report } = dedupCodref([
      row({ codreferencia_for: 1, idproduto: 100, codref: 'SEM GTIN' }),
      row({ codreferencia_for: 2, idproduto: 200, codref: 'sem gtin' }),
      row({ codreferencia_for: 3, idproduto: 300, codref: 'SEM GTIN' }),
    ]);
    expect(keep).toHaveLength(0);
    expect(report.descartadas.semGtin).toBe(3);
    expect(report.colisoes.grupos).toBe(0); // não vira colisão (cai antes do agrupamento)
  });

  it('colisão AUTO-RESOLVE: mantém o candidato cujo codref == seu próprio codbarra', () => {
    const { keep, report } = dedupCodref([
      row({ codreferencia_for: 10, idproduto: 100, codfor: 9, codref: '7896029021798', produto_codbarra_norm: '7896029021781' }), // errado
      row({ codreferencia_for: 11, idproduto: 101, codfor: 9, codref: '7896029021798', produto_codbarra_norm: '7896029021798' }), // dono legítimo
    ]);
    expect(keep).toHaveLength(1);
    expect(keep[0].idproduto).toBe(101);
    expect(report.colisoes).toMatchObject({ grupos: 1, autoResolvidas: 1, ambiguas: 0 });
    expect(report.descartadas.colisaoExcedente).toBe(1);
  });

  it('colisão AMBÍGUA: tiebreak (ativo vence; entre iguais, maior legacy_id) + registra p/ revisão', () => {
    const { keep, report } = dedupCodref([
      row({ codreferencia_for: 10, idproduto: 100, codfor: 9, codref: '789155003663', produto_ativo: false }),
      row({ codreferencia_for: 20, idproduto: 200, codfor: 9, codref: '789155003663', produto_ativo: true }), // ativo → vence
      row({ codreferencia_for: 30, idproduto: 300, codfor: 9, codref: '789155003663', produto_ativo: true }), // ativo + maior id
    ]);
    expect(keep).toHaveLength(1);
    expect(keep[0].idproduto).toBe(300); // ativo + maior legacy_id
    expect(report.colisoes).toMatchObject({ grupos: 1, autoResolvidas: 0, ambiguas: 1 });
    expect(report.ambiguos[0]).toMatchObject({ codfor: 9, codref: '789155003663', escolhido: 300 });
    expect(report.ambiguos[0].candidatos).toHaveLength(3);
    expect(report.descartadas.colisaoExcedente).toBe(2);
  });

  it('GTIN-14 (zero à esquerda) COLAPSA com o GTIN-13 → vira a MESMA chave (colisão)', () => {
    const { keep, report } = dedupCodref([
      row({ codreferencia_for: 10, idproduto: 100, codfor: 9, codref: '07896417294534', produto_codbarra_norm: '7896417294534' }),
      row({ codreferencia_for: 11, idproduto: 101, codfor: 9, codref: '7896417294534' }),
    ]);
    expect(keep).toHaveLength(1); // colapsaram na chave '7896417294534'
    expect(keep[0].codref).toBe('7896417294534');
    expect(keep[0].idproduto).toBe(100); // auto-resolve pelo codbarra
    expect(report.colisoes.autoResolvidas).toBe(1);
  });

  it('mesmo codfor+codref em produtos diferentes conta 1 grupo; codfor diferente NÃO colide', () => {
    const { keep, report } = dedupCodref([
      row({ codreferencia_for: 1, idproduto: 100, codfor: 9, codref: 'X' }),
      row({ codreferencia_for: 2, idproduto: 200, codfor: 9, codref: 'X' }), // colide (mesmo codfor)
      row({ codreferencia_for: 3, idproduto: 300, codfor: 8, codref: 'X' }), // outro fornecedor → não colide
    ]);
    expect(keep).toHaveLength(2); // 1 do grupo (9,X) + 1 do (8,X)
    expect(report.colisoes.grupos).toBe(1);
  });
});
