import { hojeNaLoja } from '../tempo/hoje';

/**
 * AS CORES DA GRADE DA PESQUISA (o `cdsColoracao` do chamador + `GetColor`, uPesquisa.pas:969-1113 e :1844-1865 — dossiê uPesquisa.md §5):
 * cada regra é CAMPO + OPERAÇÃO (`=`, `<>`, `>`, `<`, `NULL`, `NDIAS` com a operação dos dias) + VALOR → COR + LEGENDA; **a 1ª que
 * casa** pinta a linha. As cores são os nomes do legado; `AMARELO` e `PRETO` o `GetColor` não conhece e pinta de preto (a "NFe
 * Denegada" não se destaca) — fiel, a linha fica na cor normal.
 */
export type CorDoLegado = 'VERMELHO' | 'AZUL' | 'VERDE' | 'ROXO' | 'FUSHIA' | 'AZUL_PETROLEO' | 'AMARELO' | 'PRETO';

export interface RegraDeCor {
  /** a coluna da view do destino */
  coluna: string;
  op: '=' | '<>' | '>' | '<' | 'nulo' | 'ndias';
  /** o valor comparado; com `hoje`, a data de hoje na loja (o `DateToStr(Now)` do chamador) */
  valor?: string | number;
  hoje?: boolean;
  /** NDIAS: há quantos dias a data está (`OPERACAO_NDIAS` + VALOR, ex.: a última compra há mais de 35 dias) */
  dias?: number;
  opDias?: '>' | '<';
  cor: CorDoLegado;
  legenda: string;
}

/** 'aaaa-mm-dd' de um valor de data do PostgreSQL (Date ou texto ISO), no dia da loja */
function diaDe(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return hojeNaLoja(v);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? (s.length > 10 ? hojeNaLoja(new Date(s)) : s.slice(0, 10)) : null;
}

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/** a regra casa com a linha? (o `GetColor` compara o texto do campo; número e data comparam como número e data) */
export function regraCasa(r: RegraDeCor, linha: Record<string, unknown>, hoje: string = hojeNaLoja()): boolean {
  const v = linha[r.coluna];
  switch (r.op) {
    case 'nulo':
      return v == null || v === '';
    case '=':
      return String(v ?? '').trim() === String(r.valor ?? '');
    case '<>':
      return String(v ?? '').trim() !== String(r.valor ?? '');
    case '<':
    case '>': {
      if (r.hoje) {
        const d = diaDe(v);
        if (!d) return false;
        return r.op === '<' ? d < hoje : d > hoje;
      }
      const n = Number(v);
      if (v == null || !Number.isFinite(n)) return false;
      return r.op === '<' ? n < Number(r.valor) : n > Number(r.valor);
    }
    case 'ndias': {
      const d = diaDe(v);
      if (!d || r.dias == null) return false;
      const n = diasEntre(d, hoje);
      return r.opDias === '<' ? n < r.dias : n > r.dias;
    }
  }
}

/** a cor da linha: a 1ª regra que casa, entre as que a view tem a coluna */
export function corDaLinha(regras: RegraDeCor[], linha: Record<string, unknown>, hoje?: string): CorDoLegado | null {
  for (const r of regras) if (regraCasa(r, linha, hoje)) return r.cor;
  return null;
}
