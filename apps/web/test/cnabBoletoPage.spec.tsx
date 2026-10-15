import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CnabRemessaPage, inverterMarcas, marcasIniciais, enderecoIncompleto } from '../src/features/cnab/CnabRemessaPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let contaResp: any = null;
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const corpo = u.endsWith('/cobranca/cnab/conta') ? contaResp
      : u.includes('/cadastro/pesquisa') ? { linhas: [{ codigo: 9, nro_conta: '23055-1', titular: 'APOLLO' }], total: 1 }
      : {};
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><CnabRemessaPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto && !b.closest('thead')) as HTMLButtonElement | undefined;

describe('Boleto/Remessa (uConfBoleto.dfm) — a conta decide os botões', () => {
  it('com a conta padrão de banco que emite boleto: Boleto, Cancelar boleto e Remessa; sem a duplicata', async () => {
    contaResp = { conta: { codconta: 9, nroconta: '23055-1', titular: 'APOLLO', agencia: '3034', codbco: 526 }, febraban: '341', emiteBoleto: true,
      conf: { codconf: 21, layoutremessa: 'C400' }, geraRemessa: 'P', aviso: null };
    tela();
    await waitFor(() => expect(botao('Boleto')).toBeTruthy());
    expect(botao('Cancelar boleto')).toBeTruthy();
    expect(botao('Remessa ▾')).toBeTruthy();
    expect(botao('Imprimir')).toBeUndefined();
    expect((screen.getByLabelText('Layout Arquivo Remessa') as HTMLInputElement).value).toBe('CNAB 400');
  });

  it('sem conta: só a duplicata (Imprimir)', async () => {
    contaResp = { conta: null, febraban: null, emiteBoleto: false, conf: null, geraRemessa: 'P', aviso: null };
    tela();
    await waitFor(() => expect(botao('Imprimir')).toBeTruthy());
    expect(botao('Boleto')).toBeUndefined();
  });

  it('as marcas: o importado vem marcado menos o enviado; o título "Imprimir" inverte menos o cancelado; o endereço incompleto trava', () => {
    const ls = [{ codrcb: 1, registro_arq_remessa: null, endereco: 'R', bairro: 'B', cidade: 'C', cep: '1', uf: 'GO' },
      { codrcb: 2, registro_arq_remessa: 'S', endereco: 'R', bairro: 'B', cidade: 'C', cep: '1', uf: 'GO' },
      { codrcb: 3, registro_arq_remessa: 'C', endereco: 'R', bairro: '', cidade: 'C', cep: '1', uf: 'GO' }];
    expect([...marcasIniciais(ls)].sort()).toEqual([1, 3]);
    expect([...inverterMarcas(ls, new Set([1, 3]))].sort()).toEqual([2, 3]);
    expect(Number(enderecoIncompleto(ls)?.codrcb)).toBe(3);
  });
});
