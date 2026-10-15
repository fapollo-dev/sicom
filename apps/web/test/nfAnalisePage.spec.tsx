import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NfAnalisePage } from '../src/features/nf-analise/NfAnalisePage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let corpos: any[] = [];
beforeEach(() => {
  corpos = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/fiscal/nf-analise')) corpos.push(JSON.parse(String(init?.body ?? '{}')));
    return { ok: true, status: 200, json: async () => ({ modelo: 'TRIBUTARIA', notas: [], linhas: [], totais: {} }) };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><NfAnalisePage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const buscaDireta = () => [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes('Busca direto'))!.querySelector('input')!;
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;

describe('Análise de notas fiscais (UNFAnalise.dfm) — o fornecedor', () => {
  it('sem "Busca direto pela descrição" filtra pelo código (N.CODPARCEIRO); com ela, pela parte da razão (P.RAZAO LIKE) — UNFAnalise.pas:717-720', async () => {
    tela();
    // sem a busca direta: o código do parceiro (a Pesquisa); com ela: o texto da razão
    expect(screen.queryByPlaceholderText('parte da razão social')).toBeNull();
    fireEvent.click(buscaDireta());
    fireEvent.change(screen.getByPlaceholderText('parte da razão social'), { target: { value: 'ATACADO' } });
    fireEvent.click(botao('Gerar'));
    await waitFor(() => expect(corpos.length).toBe(1));
    expect(corpos[0].razao).toBe('ATACADO');
    expect(corpos[0].codparceiro).toBeNull();
  });
});
