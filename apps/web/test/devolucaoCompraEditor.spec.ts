import { describe, it, expect } from 'vitest';
import { juntarItens, totaisDevolucao, type ItemEditor } from '../src/features/devolucao-compra/DevolucaoCompraEditor';

const disp = (codnfprod: number, saldo: number, cfop: string | null = '5202') => ({
  codnf: 1, codnfprod, idproduto: codnfprod, nronf: '100', nroitem: codnfprod, descricao: `P${codnfprod}`, unidade: 'UN', fatorembalagem: 1,
  cfop_entrada: '1102', cfop_devolucao: cfop, chavenfe: null, qtd_nota_fiscal: 10, qtd_ja_devolvida: 10 - saldo, saldo, valor_custo: 5,
});

describe('o editor do pedido de devolução de compras (CarregaItens e os totais)', () => {
  it('juntarItens: entra o que tem saldo (a quantidade a devolver é o saldo), não repete o item e pula o sem CFOP de devolução', () => {
    const r1 = juntarItens([], [disp(1, 4), disp(2, 0), disp(3, 2, null)] as never);
    expect(r1.adicionados).toBe(1);
    expect(r1.itens[0]).toMatchObject({ codnfprod: 1, qtd_devolvida: 4, saldo: 4, cfop: '5202' });
    const r2 = juntarItens(r1.itens, [disp(1, 4), disp(4, 10)] as never);
    expect(r2.adicionados).toBe(1);
    expect(r2.itens.map((i) => i.codnfprod)).toEqual([1, 4]);
  });

  it('totaisDevolucao: soma o fiscal gravado e o total devolvido (o não gravado é qtde × custo)', () => {
    const itens = [
      { codnf: 1, codnfprod: 1, idproduto: 1, qtd_nota_fiscal: 10, saldo: 4, qtd_devolvida: 4, valor_custo: 5, total_produto_devolvido: 20, icms_bc: 20, icms_valor: 3.6, ipi: 1 },
      { codnf: 1, codnfprod: 2, idproduto: 2, qtd_nota_fiscal: 10, saldo: 2, qtd_devolvida: 2, valor_custo: 3, total_produto_devolvido: null },
    ] as ItemEditor[];
    expect(totaisDevolucao(itens)).toMatchObject({ icms_bc: 20, icms: 3.6, ipi: 1, devolvido: 26 });
  });
});
