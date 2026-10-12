import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { HistVendasPage } from '../src/features/hist-vendas/HistVendasPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const CUPOM = {
  encontrado: true, cupom_cancelado: false,
  cabecalho: { nropedido: '07150318101010', nrocupom: 321, idempresa: 2, dtvenda: '2018-03-15T10:10:10', cliente: 'AO CONSUMIDOR', vendedor: null, operador: 'CAIXA 7',
    desc_acre: 0, venda_nfc: 'N', permite_ticket: true },
  itens: [{ nroitem: 1, codbarra: '789', descricao: 'ARROZ', unidade: 'UN', qtde: 1, vrvenda: 10, aliquota: 'T01', total: 10, total_item: 10, total_canc: 0,
    acrescimo: 0, desconto: 0, cancelado: 'N', cancitem: '', canc: '' }],
  totais: { qtd_itens: 1, subtotal: 10, cancelados: 0, total: 10 },
  finalizadores: [{ operacao: 'DINHEIRO', valor: 10 }], total_finalizadores: 10,
};
const PEDIDO = { ...CUPOM, cabecalho: { ...CUPOM.cabecalho, nrocupom: 0, idempresa: 1, venda_nfc: null, permite_ticket: false, titulo: 'PEDIDO', obs: 'ENTREGAR NA RUA B' } };

let alertas: string[] = [];
beforeEach(() => {
  alertas = [];
  window.alert = vi.fn((m: string) => { alertas.push(m); }) as any;
  window.history.replaceState({}, '', '/vendas/historico');
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/hist-vendas/consultar')) return { ok: true, status: 200, json: async () => CUPOM };
    if (u.endsWith('/hist-vendas/consultar-pedido')) return { ok: true, status: 200, json: async () => PEDIDO };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
});

const chamadas = () => (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;
const corpoDe = (fim: string) => JSON.parse(String(chamadas().find(([u]) => String(u).endsWith(fim))![1]!.body));
/** o OK da janela (a letra sublinhada parte o nome acessível no jsdom) */
const botaoOk = async () => waitFor(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'OK'); if (!b) throw new Error('sem OK'); return b; });
const tela = () => render(<MemoryRouter><ShortcutScope><MensagemProvider><HistVendasPage /></MensagemProvider></ShortcutScope></MemoryRouter>);

describe('Consulta de histórico de vendas (FRMCONSHISTVENDAS)', () => {
  it('o Visualizar exige cupom e PDV e pergunta NFC ou ECF; com ECF a consulta vai com venda_nfc N e a Empresa vem da venda achada', async () => {
    tela();
    fireEvent.click(screen.getByRole('button', { name: /isualizar/ }));
    expect(alertas).toEqual(['Informe o número do cupom']);
    fireEvent.change(screen.getAllByLabelText('Cupom')[0], { target: { value: '321' } });
    fireEvent.click(screen.getByRole('button', { name: /isualizar/ }));
    expect(alertas.at(-1)).toBe('Informe o número do PDV');
    fireEvent.change(screen.getByLabelText('PDV'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /isualizar/ }));
    expect(await screen.findByText('Trazer pesquisa de vendas')).toBeTruthy();
    expect((screen.getByLabelText('Com vendas de NFC') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Com vendas de ECF'));
    fireEvent.click(await botaoOk());
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/consultar'))).toBe(true));
    expect(corpoDe('/consultar')).toEqual({ nrocupom: 321, pdv: 7, venda_nfc: 'N' });
    expect(await screen.findByText('ARROZ')).toBeTruthy();
    expect((screen.getByLabelText('Empresa') as HTMLInputElement).value).toBe('2');
  });

  it('cancelar a pergunta avisa e não consulta', async () => {
    tela();
    fireEvent.change(screen.getAllByLabelText('Cupom')[0], { target: { value: '321' } });
    fireEvent.change(screen.getByLabelText('PDV'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /isualizar/ }));
    fireEvent.click(await screen.findByRole('button', { name: /ancelar/ }));
    expect(alertas).toEqual(['Seleção de pesquisa de vendas cancelada.']);
    expect(chamadas().some(([u]) => String(u).endsWith('/consultar'))).toBe(false);
  });

  it('a Empresa digitada vai na consulta (o padrão NFC)', async () => {
    tela();
    fireEvent.change(screen.getAllByLabelText('Cupom')[0], { target: { value: '321' } });
    fireEvent.change(screen.getByLabelText('PDV'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /isualizar/ }));
    fireEvent.click(await botaoOk());
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/consultar'))).toBe(true));
    expect(corpoDe('/consultar')).toEqual({ nrocupom: 321, pdv: 7, venda_nfc: 'S', idempresa: 3 });
  });

  it('o pedido de balcão (aberto pelo kardex) mostra a Observação', async () => {
    window.history.replaceState({}, '', '/vendas/historico?balcao=1&nropedido=01010122101010');
    tela();
    expect(await screen.findByText('ENTREGAR NA RUA B')).toBeTruthy();
    expect(screen.getByText('Observação')).toBeTruthy();
    expect(corpoDe('/consultar-pedido')).toEqual({ nropedido: '01010122101010' });
  });
});
