/**
 * O carimbo de cada linha da folha do inventário (INVENTARIO), nas 4 gerações da tela (uInventario.pas:1438-1446, :1586-1596,
 * :1774-1784, :2140): DATAINVENTARIO = a "Data do inventário" (`edtDataInventario`, ligado ao INVENTARIO_LIVRO.DTINVENTARIO) no
 * momento em que a folha é gerada — o livro 242 da produção teve a data trocada depois e as 3.527 linhas ficaram com a antiga —, e o
 * TIPO pelo combo do tipo do inventário (TIPOINVENTARIO 1..5 = P, T, B, A, F; sem tipo, o `TipoInv` fica vazio → NULL, como em 3 das 4
 * folhas da produção). O Apollo gravava o TIPO 'P' fixo e a data vazia.
 */
const TIPOS: Record<number, string> = { 1: 'P', 2: 'T', 3: 'B', 4: 'A', 5: 'F' };

export function carimboDaFolha(livro: { dtinventario?: unknown; tipoinventario?: unknown }): { datainventario: string | null; tipo: string | null } {
  const d = livro.dtinventario;
  const data = d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return { datainventario: data, tipo: TIPOS[Number(livro.tipoinventario)] ?? null };
}
