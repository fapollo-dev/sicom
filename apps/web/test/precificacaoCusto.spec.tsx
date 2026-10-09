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
const abertura = (idempresa: number) => ({
  produto: { idproduto: 760, codbarra: '7899000990760', descricao: 'PRECIFICA TELA', codgrupopreco: 5, grupo_preco: 'CAFES' },
  preco: { vrcusto: idempresa === 2 ? 9 : 10, vrvenda: 20, markup: 30, fcp_saida: 2, ativo: 'S', ativo_compra: 'S', promocao: 'N', markupfixo: 0 },
  empresas: [{ idempresa: 1, fantasia: 'LOJA 1', qtde: 5 }, { idempresa: 2, fantasia: 'LOJA 2', qtde: 0 }],
  painel, modo_lote_default: false, idempresa,
  fiscal: { icm_efetivo: 18, despoperacional: 20, imprenda: 15, contsocial: 9, simples: false },
  config: { tipo_precificacao: 'P', permite_promocao: false, habilita_atacarejo: true, sincroniza_empresas: false },
});

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/cadastro/acesso/opcoes/')) return { ok: true, status: 200, json: async () => ({ opcoes: ['FRMPRIFICACAOCUSTO', 'BTNGRAVAR', 'EDTVRVENDA'] }) };
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
    fireEvent.change(prod, { target: { value: '760' } });
    fireEvent.keyDown(prod, { key: 'Enter' });
    expect(await screen.findByText('5 - CAFES')).toBeTruthy();
    expect(screen.getByText('Venda Sugestão:')).toBeTruthy();
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
});
