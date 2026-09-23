import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chaveNfeValida, dvChaveNfe, montarChaveNfe } from '../src/validators/chave-nfe';

/**
 * HARNESS DE PARIDADE da NF (nf.parity.spec) — fecha o gap NC-1/NC-2 do code-review de
 * certificação (2026-07-02): converte o confronto golden que antes era um COMENTÁRIO
 * ("5000/5000 chaves passam") em ASSERTS REGRESSÁVEIS sobre dados REAIS.
 *
 * `nf.parity.golden.json` = chaves de acesso REAIS (NF.CHAVENFE autorizadas) capturadas do
 * Oracle PINHEIRAO (read-only). Para CADA chave real o harness exige que a implementação
 * migrada (funções puras de `@apollo/shared`) reproduza o legado por três caminhos
 * independentes — validade, recomputo do DV (direção/pesos), e remontagem do layout.
 *
 * A paridade do VALOR do item (TOTALPROD/TOTALDESC a partir de NF_PROD) vive em `nf-valor.spec.ts`: o valor da
 * linha é o VRCUSTO, não o VRVENDA (a INFIDELIDADE-3, fechada em 23/09/2026 com golden de 36 NFs reais).
 */

type ChaveGolden = { codnf: number; chave: string; cuf: string; serie: string; dv: number; status: string };
const golden = JSON.parse(
  readFileSync(new URL('./nf.parity.golden.json', import.meta.url), 'utf8'),
) as { chaves: ChaveGolden[] };

describe('NF parity — chave de acesso / DV mód 11 (golden REAL do Oracle PINHEIRAO)', () => {
  it('a fixture tem chaves reais suficientes e diversas (≥20, ≥5 séries)', () => {
    expect(golden.chaves.length).toBeGreaterThanOrEqual(20);
    expect(new Set(golden.chaves.map((c) => c.serie)).size).toBeGreaterThanOrEqual(5);
  });

  for (const g of golden.chaves) {
    describe(`CODNF ${g.codnf} — série ${g.serie} DV ${g.dv}`, () => {
      it('chaveNfeValida aceita a chave real de produção', () => {
        expect(chaveNfeValida(g.chave)).toBe(true);
      });

      it('dvChaveNfe recomputa o MESMO DV que o legado gravou (prova direção/pesos)', () => {
        expect(dvChaveNfe(g.chave.slice(0, 43))).toBe(Number(g.chave[43]));
        expect(dvChaveNfe(g.chave.slice(0, 43))).toBe(g.dv);
      });

      it('montarChaveNfe remonta a chave real a partir dos seus campos (layout idêntico)', () => {
        const k = g.chave;
        const remontada = montarChaveNfe({
          cuf: Number(k.slice(0, 2)),
          aamm: k.slice(2, 6),
          cnpj: k.slice(6, 20),
          modelo: Number(k.slice(20, 22)),
          serie: Number(k.slice(22, 25)),
          numero: Number(k.slice(25, 34)),
          tpEmis: Number(k.slice(34, 35)),
          cnf: Number(k.slice(35, 43)),
        });
        expect(remontada).toBe(k);
      });
    });
  }

  it('regressão: uma chave real com 1 dígito corrompido é REPROVADA (não passa silenciosamente)', () => {
    const k = golden.chaves[0].chave;
    const dvErrado = (Number(k[43]) + 1) % 10;
    expect(chaveNfeValida(k.slice(0, 43) + String(dvErrado))).toBe(false);
  });
});
