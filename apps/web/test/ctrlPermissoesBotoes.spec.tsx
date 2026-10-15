import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CtrlPermissoesPage, telasDoCatalogo, filtrarCatalogo } from '../src/features/perfil/CtrlPermissoesPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const CATALOGO = [
  { form: 'FRMLIBERACOES', opcao: 'FRMLIBERACOES', caption: 'Acessar formulário', form_caption: 'LIBERACOES' },
  { form: 'FRMLIBERACOES', opcao: 'BTNCONSULTAR', caption: 'Consultar', form_caption: 'LIBERACOES' },
  { form: 'FRMAPAGAR', opcao: 'FRMAPAGAR', caption: 'Acessar formulário', form_caption: 'CONTAS A PAGAR' },
];
let corpos: Array<{ url: string; method: string; body: any }> = [];
beforeEach(() => {
  corpos = [];
  window.confirm = vi.fn(() => true) as any;
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    corpos.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const corpo = u.includes('/permissoes/catalogo') ? CATALOGO
      : u.includes('/permissoes/operador/') ? { codoperador: 8, codempresa: 1, grants: [{ form: 'FRMLIBERACOES', opcao: 'FRMLIBERACOES' }] }
      : u.includes('/permissoes/lote') ? { alterados: 2 }
      : u.includes('/cadastro/pesquisa') || u.includes('lookup/operadores') ? { linhas: [{ codoperador: 8, nome: 'MARIA' }], total: 1 }
      : [];
    return { ok: true, status: 200, json: async () => corpo };
  }) as any;
});

const montar = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/cadastro/permissoes']}><ShortcutScope><MensagemProvider><CtrlPermissoesPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement;

describe('Controle de permissões — os quatro botões e o Localizar do uCtrlPermissoes.dfm', () => {
  it('a lista de telas mostra o nome da tela; 3/4 só com uma tela escolhida; 1/2 valem para todas', async () => {
    montar();
    await waitFor(() => expect(corpos.some((c) => c.url.includes('/permissoes/catalogo'))).toBe(true));
    expect(botao('1 - Marcar todos')).toBeTruthy();
    expect(botao('3 - Marcar').disabled).toBe(true);
    expect(botao('4 - Desmarcar').disabled).toBe(true);
    expect(telasDoCatalogo(CATALOGO)).toEqual([{ form: 'FRMAPAGAR', rotulo: 'CONTAS A PAGAR' }, { form: 'FRMLIBERACOES', rotulo: 'LIBERACOES' }]);
  });

  it('o Localizar filtra as linhas pelo nome da tela, sem acento', async () => {
    montar();
    await waitFor(() => expect(corpos.some((c) => c.url.includes('/permissoes/catalogo'))).toBe(true));
    const loc = screen.getByLabelText(/Localizar/) as HTMLInputElement;
    fireEvent.change(loc, { target: { value: 'liberações' } });
    expect(loc.value).toBe('liberações');
    expect(filtrarCatalogo(CATALOGO, '', 'liberações').map((c) => c.opcao)).toEqual(['FRMLIBERACOES', 'BTNCONSULTAR']);
    expect(filtrarCatalogo(CATALOGO, '', 'consultar').map((c) => c.opcao)).toEqual(['BTNCONSULTAR']);
    expect(filtrarCatalogo(CATALOGO, 'FRMAPAGAR', '').map((c) => c.opcao)).toEqual(['FRMAPAGAR']);
  });
});
