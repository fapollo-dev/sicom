import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PosicaoProdutoPage } from '../src/features/produtos/PosicaoProdutoPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const POSICAO = {
  empresas: [1], origem: 'V', janela: { mesIni: '2025-10-01', mesFim: '2026-10-31', hoje: '2026-10-14' },
  produto: { codbarra: '7890001', descricao: 'ARROZ 5KG', fornecedor: 'FORN A', familia: 'ARROZ', unidade: 'UN', frete: 1, ipi: 0.5, icmst: 0, despacessorio: 0, seguro: 0,
    icm_efetivo: 18, creditoicm: 0.9, creditopiscofins: 0.46, debitoicm: 1.8, debitopiscofins: 0.92, vendaliq: 7.28, lucrobrutov: 2.28, despopv: 0.5, lucroliqv: 1.78, imprend: 0.1, contsocial: 0.05, margeml2v: 1.63, margeml2: 16.3 },
  lojas: [{ idempresa: 1, vrcusto: 5, vrvenda: 10 }], estoques: [{ idempresa: 1, qtde: 20, qtde_dep: 5 }],
  mensal: [{ data: '10/2026', qtde: 7 }], total_mensal: 7, entradas: [{ data: '10/2026', qtde: 24 }], total_entradas: 24,
  semanas: [{ semana: '1º SEMANA', qtde: 3 }], dias: [{ data: '2026-10-14', qtde: 3 }], anual: [{ ano: 2026, qtde: 7 }], compras: [], pendentes: [{ nropedido: 77, dtpedido: '2026-10-01', qtde: 7, codfor: 2, razao: 'FORN A' }],
};

let urls: string[] = [];
beforeEach(() => {
  urls = [];
  window.history.replaceState({}, '', '/cadastro/produtos/posicao?idproduto=992860');
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => POSICAO };
  }) as any;
});

describe('Posição do produto (TfrmPosicaoProduto, o [F7] do cadastro)', () => {
  it('abre pelo idproduto da URL na origem Vendas e mostra os blocos do legado; a origem Pedidos reconsulta com origem=P e muda os títulos', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><PosicaoProdutoPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    await waitFor(() => expect(urls.some((u) => u.endsWith('/cadastro/produtos/992860/posicao?origem=V'))).toBe(true));
    expect(await screen.findByText('ARROZ 5KG')).toBeTruthy();
    expect(screen.getByText('Resumo mensal de saídas')).toBeTruthy();
    expect(screen.getByText('Venda últimas semanas')).toBeTruthy();
    expect(screen.getByText('Empresa(s) analisada(s): 1 · período mensal 01/10/2025 a 31/10/2026')).toBeTruthy();
    expect(screen.getByText('1º SEMANA')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Pedidos'));
    await waitFor(() => expect(urls.some((u) => u.endsWith('/posicao?origem=P'))).toBe(true));
    expect(await screen.findByText('Resumo mensal de pedidos')).toBeTruthy();
    expect(screen.getByText('Pedido últimas semanas')).toBeTruthy();
  });

  it('com a origem Todos os botões Notas/Vendas/Kardex ficam desabilitados, como no legado; as empresas vão na consulta', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><PosicaoProdutoPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    await screen.findByText('ARROZ 5KG');
    fireEvent.click(screen.getByLabelText('Todos'));
    await waitFor(() => expect(urls.some((u) => u.endsWith('/posicao?origem=T'))).toBe(true));
    const notas = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Notas') as HTMLButtonElement;
    expect(notas.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Empresas/), { target: { value: '1, 2' } });
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Analisar')!);
    await waitFor(() => expect(urls.some((u) => u.endsWith('/posicao?origem=T&empresas=1,2'))).toBe(true));
  });
});
