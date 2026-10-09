import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PrecificacaoCustoPage } from '../src/features/precificacao-custo/PrecificacaoCustoPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const painel = { vrcustoreal: 10, vrcustorep: 12, vrcustocsi: 11, creditoicm: 1, creditopiscofins: 0, pmz: 15, vrvendasug: 18, markup: 30, vrvenda: 20,
  debitoicm: 3.6, debitopiscofins: 1.85, vendaliq: 14.55, lucrobrutov: 3.55, lucrobrutop: 24.4, despopv: 4, lucroliqv: -0.45, lucroliqp: -2.25, imprend: 0, contsocial: 0,
  margeml2v: -0.45, margeml2: -2.25, markdown: 40 };
let acumulativa = false;
const abertura = (idempresa: number) => ({
  produto: { idproduto: 760, codbarra: '7899000990760', descricao: 'PRECIFICA TELA', codgrupopreco: 5, grupo_preco: 'CAFES' },
  preco: { vrcusto: idempresa === 2 ? 9 : 10, vrvenda: 20, markup: 30, fcp_saida: 2, ativo: 'S', ativo_compra: 'S', promocao: 'N', markupfixo: 0 },
  empresas: [{ idempresa: 1, fantasia: 'LOJA 1', qtde: 5 }, { idempresa: 2, fantasia: 'LOJA 2', qtde: 0 }],
  painel, modo_lote_default: false, idempresa, promocao_acumulativa: acumulativa,
  fiscal: { icm_efetivo: 18, despoperacional: 20, imprenda: 15, contsocial: 9, simples: false },
  config: { tipo_precificacao: 'P', permite_promocao: false, habilita_atacarejo: true, sincroniza_empresas: false },
});

beforeEach(() => {
  acumulativa = false;
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/cadastro/acesso/opcoes/')) return { ok: true, status: 200, json: async () => ({ opcoes: ['FRMPRIFICACAOCUSTO', 'BTNGRAVAR', 'EDTVRVENDA', 'BTNSINCCUSTONAVENDA'] }) };
    if (u.includes('/cadastro/historico-dinamico/MULTI_PRECO/760')) return { ok: true, status: 200, json: async () => ({ campos: ['VRCUSTO', 'VRVENDA'], campo: 'VRVENDA',
      linhas: [{ codhistorico: 1, campo: 'VRVENDA', valor_anterior: '18', valor_atual: '20', data: '2026-10-08 14:05:09', codoperador: 7, nome: 'SMOKE', codempresa: 2, historico: 'Precificação do Custo' }] }) };
    if (u.endsWith('/precificacao/custo/produto/7899000990760')) return { ok: true, status: 200, json: async () => ({ idproduto: 760 }) };
    if (u.includes('/precificacao/custo/sinc-custo-venda')) return { ok: true, status: 200, json: async () => ({ vendas: 3 }) };
    if (u.includes('/precificacao/custo/salvar')) return { ok: true, status: 200, json: async () => ({ lotes: 0, historico: 2, precoMantido: [] }) };
    if (u.includes('/precificacao/custo/calcular')) return { ok: true, status: 200, json: async () => painel };
    const m = u.match(/\/precificacao\/custo\/760(?:\?idempresa=(\d+))?$/);
    if (m) return { ok: true, status: 200, json: async () => abertura(Number(m[1] ?? 1)) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
});

const chamadas = () => (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;

describe('Precificação de Mercadorias (UPrificacaoCusto) — a tela do legado', () => {
  it('abre o produto com o grupo de preço; a linha da grade troca a loja editada; Gravar vai em Individual, na loja editada', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><PrecificacaoCustoPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    const prod = screen.getByLabelText(/Produto/);
    fireEvent.change(prod, { target: { value: '7899000990760' } });
    fireEvent.keyDown(prod, { key: 'Enter' });
    expect(await screen.findByText('5 - CAFES')).toBeTruthy();
    // o campo recebe o código de barras (GetProduto) e abre o produto dele
    expect(chamadas().some(([u]) => String(u).endsWith('/precificacao/custo/produto/7899000990760'))).toBe(true);
    expect(screen.getByText('Venda Sugestão:')).toBeTruthy();
    expect(screen.queryByText('Produto em promoção acumulativa')).toBeNull();
    expect((screen.getByRole('radio', { name: /Individual/ }) as HTMLInputElement).checked).toBe(true);
    // o markup fixo e o ativo sem a permissão (Tag 1) ficam travados
    expect((screen.getByLabelText(/Markup Fixo/) as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('LOJA 2'));
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/precificacao/custo/760?idempresa=2'))).toBe(true));

    const gravar = await screen.findByRole('button', { name: /ravar/ });
    await waitFor(() => expect((gravar as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(gravar);
    await waitFor(() => expect(chamadas().some(([u]) => String(u).includes('/salvar'))).toBe(true));
    const corpo = JSON.parse(String(chamadas().find(([u]) => String(u).includes('/salvar'))![1]!.body));
    expect(corpo.opcao).toBe('individual');
    expect(corpo.empresaEditada).toBe(2);
    expect(corpo.fcp_saida).toBe(2);
    expect(corpo.ativo).toBe('S');
    expect(await screen.findByText(/Alterações realizadas com sucesso\./)).toBeTruthy();
  });

  it('Outros → Multi-Preço abre o histórico do MULTI_PRECO na loja da linha, no VRVENDA, com o item "código de barras-descrição"', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><PrecificacaoCustoPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    const prod = screen.getByLabelText(/Produto/);
    fireEvent.change(prod, { target: { value: '7899000990760' } });
    fireEvent.keyDown(prod, { key: 'Enter' });
    expect(await screen.findByText('5 - CAFES')).toBeTruthy();
    fireEvent.click(screen.getByText('LOJA 2'));
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/precificacao/custo/760?idempresa=2'))).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: /utros/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Multi-Preço' }));
    expect(await screen.findByText('Histórico Precificação de Mercadorias')).toBeTruthy();
    expect(screen.getByText('7899000990760-PRECIFICA TELA')).toBeTruthy();
    expect(await screen.findByText('08/10/2026 14:05:09')).toBeTruthy();
    expect((screen.getByLabelText('Campo') as HTMLSelectElement).value).toBe('VRVENDA');
    expect(chamadas().some(([u]) => String(u).endsWith('/cadastro/historico-dinamico/MULTI_PRECO/760?campo=VRVENDA&empresa=2'))).toBe(true);
  });

  it('com promoção acumulativa na loja do login a venda trava e o rótulo aparece', async () => {
    acumulativa = true;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><PrecificacaoCustoPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    const prod = screen.getByLabelText(/Produto/);
    fireEvent.change(prod, { target: { value: '7899000990760' } });
    fireEvent.keyDown(prod, { key: 'Enter' });
    expect(await screen.findByText('Produto em promoção acumulativa')).toBeTruthy();
    expect((screen.getByLabelText(/Venda praticada/) as HTMLInputElement).disabled).toBe(true);
  });

  it('Sinc. Custo na venda: pede o período, confirma "Deseja retroagir o custo atual até a data de: …" e manda o custo da tela na loja da linha', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ShortcutScope><MensagemProvider><PrecificacaoCustoPage /></MensagemProvider></ShortcutScope></MemoryRouter>
      </QueryClientProvider>,
    );
    const prod = screen.getByLabelText(/Produto/);
    fireEvent.change(prod, { target: { value: '7899000990760' } });
    fireEvent.keyDown(prod, { key: 'Enter' });
    expect(await screen.findByText('5 - CAFES')).toBeTruthy();
    const botao = await screen.findByRole('button', { name: 'Sinc. Custo na venda' });
    await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(botao);
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-10-08' } });
    fireEvent.click(screen.getByRole('button', { name: /onfirma/ }));
    expect(await screen.findByText('Deseja retroagir o custo atual até a data de: 01/10/26')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(await screen.findByText(/Custo sincronizado em 3 venda\(s\)\./)).toBeTruthy();
    const corpo = JSON.parse(String(chamadas().find(([u]) => String(u).includes('/sinc-custo-venda'))![1]!.body));
    expect(corpo).toEqual({ idproduto: 760, idempresa: 1, vrcusto: 10, dtini: '2026-10-01', dtfim: '2026-10-08' });
  });
});
