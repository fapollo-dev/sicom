import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ShortcutScope, useShortcut } from '../src/shared/keyboard';
import { NfItemModal } from '../src/features/nf/NfItemModal';
import { NfProcessarModal } from '../src/features/nf/NfProcessarModal';
import { PedidoCompraItemModal } from '../src/features/pedido-compra/PedidoCompraItemModal';
import { MemoryRouter } from 'react-router-dom';
import { ControleContasPage } from '../src/features/controle-contas/ControleContasPage';

/**
 * As teclas próprias das janelas da NF e do item do pedido (corte 3 do mapa de teclado): FRMITENSNF (uItensNF), FRMESTOQUENF
 * (uEstoqueNF) e FRMPRECIFICACAOPRODUTO (uPrecificacaoProdutos). A tecla é da janela (o escopo do Modal), não da tela de baixo.
 */
function Atalho({ combo, fn }: { combo: string; fn: () => void }) {
  useShortcut(combo, fn);
  return null;
}

const tecla = (key: string, extra: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(window, { key, code: key, ...extra });
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const inputDoRotulo = (rotulo: string) => {
  const label = Array.from(dialogo().querySelectorAll('label')).find((l) => l.textContent?.trim() === rotulo);
  const alvo = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  return (alvo ?? label?.parentElement?.querySelector('input, button')) as HTMLElement;
};

describe('FRMITENSNF — a janela do item da nota (FormKeyDown do uItensNF)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ editarDescricao: false }) }) as any;
  });
  const abrir = () => render(
    <ShortcutScope>
      <NfItemModal tipo="E" produtoOptions={[]} cfopOptions={[{ value: '1102', label: '1102 - Compra' }]} aliquotaOptions={[]} unidadeOptions={[]}
        onFechar={() => {}} onConfirmar={() => {}} />
    </ShortcutScope>,
  );

  it('F6 foca o fator de embalagem; F9 vai ao CFOP', async () => {
    abrir();
    await waitFor(() => dialogo());
    tecla('F6');
    expect(document.activeElement).toBe(inputDoRotulo('Fator embal. [F6]'));
    tecla('F9');
    // a Pesquisa de CFOP do legado: aqui a lista do CFOP, focada e aberta
    expect(document.activeElement).toBe(inputDoRotulo('CFOP [F9]'));
    expect(document.activeElement?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it('sem o inherited: o Ctrl+E e o Alt+← da tela não passam da janela; o &Ok e o &Cancelar levam a letra', async () => {
    const trocaEmpresa = vi.fn();
    const voltaCampo = vi.fn();
    const onConfirmar = vi.fn();
    const onFechar = vi.fn();
    render(
      <ShortcutScope>
        <Atalho combo="ctrl+e" fn={trocaEmpresa} />
        <Atalho combo="alt+arrowleft" fn={voltaCampo} />
        <NfItemModal produtoOptions={[]} cfopOptions={[]} aliquotaOptions={[]} unidadeOptions={[]} onFechar={onFechar} onConfirmar={onConfirmar} />
      </ShortcutScope>,
    );
    await waitFor(() => dialogo());
    tecla('e', { code: 'KeyE', ctrlKey: true });
    expect(trocaEmpresa).not.toHaveBeenCalled();
    tecla('ArrowLeft', { altKey: true });
    expect(voltaCampo).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC', altKey: true });
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});

describe('FRMESTOQUENF — a janela de processar a nota (FormKeyDown do uEstoqueNF)', () => {
  const OPCOES = {
    codnf: 9, entrada: true, modo: 'lote', sincronizar: false, onlineBloqueado: false,
    itens: [
      { codnfprod: 1, nroitem: 1, codproduto: 10, descricao: 'A', quantidade: 1, vrvenda: 1, vrvenda_loja: 1, alterapreco: true, alteracusto: true },
      { codnfprod: 2, nroitem: 2, codproduto: 20, descricao: 'B', quantidade: 1, vrvenda: 1, vrvenda_loja: 1, alterapreco: false, alteracusto: false },
    ],
  };
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => OPCOES }) as any;
  });
  const marcas = (col: number) => Array.from(dialogo().querySelectorAll<HTMLInputElement>('tbody tr'))
    .map((tr) => (tr.querySelectorAll('input[type="checkbox"]')[col] as HTMLInputElement).checked);

  it('F7 e F8: o valor do item corrente (o 1º, sem foco na grade) invertido vai para todos', async () => {
    render(<ShortcutScope><NfProcessarModal codnf={9} onFechar={() => {}} onProcessado={() => {}} /></ShortcutScope>);
    await waitFor(() => expect(dialogo().querySelectorAll('tbody tr').length).toBe(2));
    expect(marcas(0)).toEqual([true, false]);
    tecla('F7');
    expect(marcas(0)).toEqual([false, false]);
    tecla('F7');
    expect(marcas(0)).toEqual([true, true]);
    tecla('F8');
    expect(marcas(1)).toEqual([false, false]);
  });

  it('F7 com o foco na 2ª linha: o item corrente é ela', async () => {
    render(<ShortcutScope><NfProcessarModal codnf={9} onFechar={() => {}} onProcessado={() => {}} /></ShortcutScope>);
    await waitFor(() => expect(dialogo().querySelectorAll('tbody tr').length).toBe(2));
    const segunda = dialogo().querySelectorAll('tbody tr')[1].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    segunda.focus();
    fireEvent.keyDown(segunda, { key: 'F7', code: 'F7' });
    expect(marcas(0)).toEqual([true, true]);
  });

  it('em "Não atualizar" o preço trava e o F7 não marca', async () => {
    render(<ShortcutScope><NfProcessarModal codnf={9} onFechar={() => {}} onProcessado={() => {}} /></ShortcutScope>);
    await waitFor(() => expect(dialogo().querySelectorAll('tbody tr').length).toBe(2));
    fireEvent.click(screen.getByLabelText('Não atualizar'));
    tecla('F7');
    expect(marcas(0)).toEqual([true, false]);
  });
});

describe('FRMPRECIFICACAOPRODUTO — o item do pedido de compra (FormKeyDown do uPrecificacaoProdutos)', () => {
  const ITEM = { idproduto: 5, qtde: 2, fatorembalagem: 12, vrcusto: 3, vrvendasug: 7.5, vrvenda: 6 } as any;

  it('F3 foca a quantidade, F5 o desconto, F9 confirma', async () => {
    const onConfirmar = vi.fn();
    render(<ShortcutScope><PedidoCompraItemModal inicial={ITEM} produtoOptions={[{ value: '5', label: 'P' }]} onFechar={() => {}} onConfirmar={onConfirmar} /></ShortcutScope>);
    await waitFor(() => dialogo());
    tecla('F3');
    expect(document.activeElement).toBe(inputDoRotulo('Qtde (embalagens) [F3]'));
    tecla('F5');
    expect(document.activeElement).toBe(inputDoRotulo('Desconto [F5]'));
    tecla('F9');
    expect(onConfirmar).toHaveBeenCalledWith(expect.objectContaining({ idproduto: 5, qtde: 2 }));
  });

  it('F3 no pedido de várias lojas: a 1ª loja aberta', async () => {
    render(<ShortcutScope><PedidoCompraItemModal inicial={ITEM} lojas={[{ idempresa: 1, fechado: true }, { idempresa: 2, fechado: false }]}
      produtoOptions={[]} onFechar={() => {}} onConfirmar={() => {}} /></ShortcutScope>);
    await waitFor(() => dialogo());
    tecla('F3');
    expect(document.activeElement).toBe(inputDoRotulo('Loja 2'));
  });

  it('F11: a venda sugerida vira a praticada e a margem é refeita no servidor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ vrvendasug: 7.5, pmz: 5, margeml2: 10 }) });
    global.fetch = fetchMock as any;
    render(<ShortcutScope><PedidoCompraItemModal inicial={ITEM} produtoOptions={[]} onFechar={() => {}} onConfirmar={() => {}} /></ShortcutScope>);
    await waitFor(() => dialogo());
    await act(async () => { tecla('F11'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const corpo = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(corpo.vrvenda).toBe(7.5);
    await waitFor(() => expect((inputDoRotulo('Venda (praticada)') as HTMLInputElement).value).toBe('7,50'));
  });
});

describe('FRMCONSMOVBANCARIAS — o detalhamento da conta (FormKeyDown do UconsMovBancaria)', () => {
  const CONTA = { codconta: 3, nroconta: '123', titular: 'LOJA', idempresa: 1, banco: 'BB', habiltiar_detalhar_conta: 'S', visualizar_saldos: 'N' };
  it('F3 foca o filtro do documento (o "Filtro por Cheque"), com o detalhamento à vista', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true, status: 200, json: async () => (String(url).includes('/contas') ? [CONTA] : []),
    })) as any;
    render(<MemoryRouter><ShortcutScope><ControleContasPage /></ShortcutScope></MemoryRouter>);
    await waitFor(() => screen.getByText('LOJA'));
    const antes = document.activeElement;
    tecla('F3');
    expect(document.activeElement).toBe(antes); // sem conta escolhida não há detalhamento
    fireEvent.click(screen.getByText('LOJA'));
    await waitFor(() => screen.getByText('Detalhamento da conta'));
    tecla('F3');
    const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent?.trim() === 'Documento [F3]')!;
    expect(document.activeElement).toBe(document.getElementById(label.htmlFor));
  });
});
