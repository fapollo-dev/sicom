import { sql, type RawBuilder, type SqlBool } from 'kysely';

/**
 * O FILTRO DA PESQUISA do legado (`GetParametroWhere`, uComunPesquisaRel.pas:228-299; `SetaParametrosWhere`, UFrameGeral.pas:140-264)
 * traduzido para o PostgreSQL — campo + operação + valor, no banco. Dossiê: docs/04-screen-dossier/dossiers/retaguarda/uPesquisa.md §3.
 *
 * O tipo do campo decide o "frame" e as operações (`SetaSaidas`/`MontaComboOperacao`, uComunPesquisaRel.pas:385-452), nesta ordem:
 *   texto        → Igual a · Diferente de · Começado com · Terminado com · Em Qualquer Lugar · Contido em
 *   número/data  → Igual a · Diferente de · Entre · Maior que · Menor que · Contido em
 */
export type TipoCampo = 'texto' | 'numero' | 'data';
export type Operacao = 'igual' | 'diferente' | 'comeca' | 'termina' | 'qualquer' | 'contido' | 'entre' | 'maior' | 'menor';

export const OPERACOES: Record<TipoCampo, Operacao[]> = {
  texto: ['igual', 'diferente', 'comeca', 'termina', 'qualquer', 'contido'],
  numero: ['igual', 'diferente', 'entre', 'maior', 'menor', 'contido'],
  data: ['igual', 'diferente', 'entre', 'maior', 'menor', 'contido'],
};

/** o tipo do campo pelo `data_type` do information_schema (o `UadaptadorBanco` do legado, que não veio no fonte, fazia o mesmo) */
export function tipoDoCampo(dataType: string): TipoCampo {
  const t = dataType.toLowerCase();
  if (/^(numeric|integer|bigint|smallint|double precision|real|decimal)/.test(t)) return 'numero';
  if (/^(date|timestamp)/.test(t)) return 'data';
  return 'texto';
}

/** número digitado: "1.234,56" (pt-BR) ou "1234.56"; VAZIO vale 0 — o frame de valor do legado não testa vazio (UFrameGeral.pas:219-235) */
export function numeroDigitado(v: string | undefined | null): number {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  if (!Number.isFinite(n)) throw new Error('NUMERO_INVALIDO');
  return n;
}

/** data digitada: 'aaaa-mm-dd' (o input do navegador) ou 'dd/mm/aaaa' (o "Contido em" do legado); inválida → erro */
export function dataDigitada(v: string): string {
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new Error('DATA_INVALIDA');
}

/**
 * A condição do usuário. Devolve null quando o legado não filtra:
 *  - texto vazio (`Trim(edtTexto.Text) <> ''`, UFrameGeral.pas:156) e data vazia (data zerada) ⇒ sem filtro — Enter traz a view inteira;
 *  - número vazio NÃO é "sem filtro": vale 0 (visto vivo: `where (CODIGO =  0)`).
 * Texto: o legado só aceita maiúsculas no campo (CharCase) e o `like` do Oracle diferencia caixa; aqui os dois lados vão a
 * `upper()` — acha também o dado gravado em minúscula (divergência benigna, registrada no dossiê §3.4).
 */
export function condicaoDoUsuario(
  coluna: string,
  tipo: TipoCampo,
  op: Operacao,
  valor: string | undefined,
  valor2?: string,
): RawBuilder<SqlBool> | null {
  if (!OPERACOES[tipo].includes(op)) throw new Error('OPERACAO_INVALIDA');
  const col = sql.ref(coluna);
  const v = valor ?? '';

  if (tipo === 'texto') {
    // `''` (duas aspas) acha o vazio e o "Diferente de ''" o preenchido (uPesquisa.pas:2096-2107) — no Oracle '' é NULL
    if (v.trim() === "''" && (op === 'igual' || op === 'diferente')) {
      return op === 'igual' ? sql<SqlBool>`coalesce(${col}::text, '') = ''` : sql<SqlBool>`coalesce(${col}::text, '') <> ''`;
    }
    if (!v.trim()) return null;
    const u = v.toUpperCase();
    const txt = sql`upper(${col}::text)`;
    switch (op) {
      case 'igual': return sql<SqlBool>`${txt} = ${u}`;
      case 'diferente': return sql<SqlBool>`${txt} <> ${u}`;
      case 'comeca': return sql<SqlBool>`${txt} like ${u + '%'}`;
      case 'termina': return sql<SqlBool>`${txt} like ${'%' + u}`;
      // "+" separa palavras em ordem: ARROZ+TIO → like '%ARROZ %TIO%'
      case 'qualquer': return sql<SqlBool>`${txt} like ${'%' + u.replace(/\+/g, ' %') + '%'}`;
      case 'contido': {
        const itens = u.split(',').map((s) => s.trim()).filter(Boolean);
        return itens.length ? sql<SqlBool>`${txt} in (${sql.join(itens)})` : null;
      }
    }
  }

  if (tipo === 'numero') {
    if (op === 'contido') {
      // a vírgula separa e o ponto é o decimal — o exemplo da tela: `5.1,6.9,7.8` (uPesquisa.pas:404-418)
      const nums = v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const n = Number(s);
        if (!Number.isFinite(n)) throw new Error('NUMERO_INVALIDO');
        return n;
      });
      return nums.length ? sql<SqlBool>`${col} in (${sql.join(nums)})` : null;
    }
    const n = numeroDigitado(v);
    switch (op) {
      case 'igual': return sql<SqlBool>`${col} = ${n}`;
      case 'diferente': return sql<SqlBool>`${col} <> ${n}`;
      case 'maior': return sql<SqlBool>`${col} > ${n}`;
      case 'menor': return sql<SqlBool>`${col} < ${n}`;
      case 'entre': return sql<SqlBool>`${col} between ${n} and ${numeroDigitado(valor2)}`;
    }
  }

  // data: o dia inteiro — nas colunas DATE conferidas na produção nenhuma linha tem hora (dossiê §3.4)
  if (op === 'contido') {
    const datas = v.split(',').map((s) => s.trim()).filter(Boolean).map(dataDigitada);
    return datas.length ? sql<SqlBool>`${col}::date in (${sql.join(datas.map((d) => sql`${d}::date`))})` : null;
  }
  if (!v.trim()) return null;
  const d = dataDigitada(v);
  const dia = sql`${col}::date`;
  switch (op) {
    case 'igual': return sql<SqlBool>`${dia} = ${d}::date`;
    case 'diferente': return sql<SqlBool>`${dia} <> ${d}::date`;
    case 'maior': return sql<SqlBool>`${dia} > ${d}::date`;
    case 'menor': return sql<SqlBool>`${dia} < ${d}::date`;
    case 'entre': return sql<SqlBool>`${dia} between ${d}::date and ${dataDigitada(valor2?.trim() ? valor2 : v)}::date`;
  }
  return null;
}

/** a operação com que o campo abre (`SetOperacaoDefault` com tpQualquerLugar): texto → Em Qualquer Lugar; número/data → Igual a */
export function operacaoDeAbertura(tipo: TipoCampo): Operacao {
  return tipo === 'texto' ? 'qualquer' : 'igual';
}
