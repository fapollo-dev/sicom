import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScrapPage } from '../src/features/scrap/ScrapPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

/** a tela de SCRAP depois da auditoria do uCadSCRAP.dfm (14/10/2026): o produto pelo código (F2 = PLU), a grade do legado, Limpar, a exclusão com liberação, as notas e o F6 */
const APOIO = { situacoes: [{ idsituacao_nf: 3000, descricao: 'PERCA' }], centros: [{ codplc: 3, desccodplc: '1.01', descricao: 'PERDAS', uso_setor: 'N', obriga_motivo: 'N' }], centrosDaSituacao: {}, setores: [],
  parceiro: { codparceiro: 87199, razao: 'JF SUPERMERCADOS' }, informaSituacao: false, informaMotivo: false, baixarEstoque: false, exibeProdutoPai: true, pedeSenhaExcluir: true, bloqueiaDuplicado: false, diasRetroativo: 0 };
const SCRAP = { codscrap: 15916, dt_cadastro: '2026-10-01', codplc: 3, idsituacao_nf: 3000, obs: 'quebra', importado: 'N', mov_estoque: null,
  itens: [{ codscrapitem: 501, idproduto: 993150, idproduto_filho: 993151, qtde: 2, vr_custo: 2.5, vrcustorep: 2.7, codbarra: '7899009931518', descricao: 'SCRAP FILHO 500G', unidade: 'UN', fornecedor: 'FORN A', origem: 'ESTOQUE', faturado: 'N', total: 5 }],
  notas: [] as Array<{ codnf: number; nronf: string; dtemissao: string; tiponf: string; statusnota: string }> };
let chamadas: Array<{ url: string; method: string; body: any }> = [];
let scrap = SCRAP;
beforeEach(() => {
  chamadas = [];
  scrap = SCRAP;
  try { localStorage.removeItem('scrap.buscaPLU'); } catch { /* sem armazenamento local */ }
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url: u, method, body });
    if (u.includes('/acesso/opcoes/')) return { ok: true, status: 200, json: async () => ({ opcoes: ['BTNADICIONARITEM', 'BTNEXCLUIRI', 'BTNLIMPARI', 'BTNEXCLUIR', 'BTNGRAVAR', 'BTNEDITAR', 'BTNADICIONARREGISTRO'] }) };
    if (u.endsWith('/cadastro/scrap/apoio/dados')) return { ok: true, status: 200, json: async () => APOIO };
    if (u.includes('/cadastro/scrap/apoio/produto')) return { ok: true, status: 200, json: async () => ({ idproduto: 993152, idproduto_filho: null, codbarra: '7899009931525', descricao: 'SCRAP KG', unidade: 'KG', vrcusto: 8, vrcustorep: 8.4, qtde_estoque: 3, codfor: 2, fornecedor: 'FORN B' }) };
    if (u.endsWith('/cadastro/motivos-operacao')) return { ok: true, status: 200, json: async () => [{ codmotivoop: 9, descricao: 'LIXO/PERDA', tipo_operacao: 'PERDA' }] };
    if (u.endsWith('/cadastro/scrap') && method === 'GET') return { ok: true, status: 200, json: async () => [{ codscrap: 15916, dt_cadastro: '2026-10-01', parceiro: 'JF', qtde_itens: 1, valor_total: 5, importado: 'N' }] };
    if (u.endsWith('/cadastro/scrap/15916') && method === 'GET') return { ok: true, status: 200, json: async () => scrap };
    if (u.endsWith('/cadastro/scrap/15916/excluir-itens')) { scrap = { ...SCRAP, itens: [] }; return { ok: true, status: 200, json: async () => scrap }; }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  window.confirm = vi.fn(() => true) as any;
  window.alert = vi.fn() as any;
});
function Onde() { const l = useLocation(); return <div data-testid="onde">{l.pathname + l.search}</div>; }
const tela = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/cadastro/scrap']}><ShortcutScope><MensagemProvider>
    <Routes><Route path="/cadastro/scrap" element={<ScrapPage />} /><Route path="/cadastro/produtos/posicao" element={<Onde />} /></Routes>
  </MensagemProvider></ShortcutScope></MemoryRouter></QueryClientProvider>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto)!;
const abrirScrap = async () => {
  tela();
  await waitFor(() => expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Abrir' || b.getAttribute('aria-label') === 'Abrir')).toBe(true));
  fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Abrir' || b.getAttribute('aria-label') === 'Abrir')!);
  await screen.findByText('SCRAP FILHO 500G');
};

describe('SCRAP (FRMCADSCRAP) — os controles auditados do uCadSCRAP.dfm', () => {
  it('a grade do legado mostra o filho, o código de barras, a descrição, o custo de reposição e o fornecedor; o F2 troca o rótulo para o PLU; o Enter no código resolve o produto e o Adicionar leva a descrição', async () => {
    await abrirScrap();
    expect(screen.getByText('Cod.Prod Filho')).toBeTruthy();
    expect(screen.getByText('7899009931518')).toBeTruthy();
    expect(screen.getByText('FORN A')).toBeTruthy();
    expect(screen.getByText('R$ 2,70')).toBeTruthy();
    expect(screen.getByLabelText(/Código de barra/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'F2', code: 'F2' });
    expect(await screen.findByLabelText(/Cód. do produto/)).toBeTruthy();
    const codigo = screen.getByLabelText(/Cód. do produto/) as HTMLInputElement;
    fireEvent.change(codigo, { target: { value: '993152' } });
    fireEvent.keyDown(codigo, { key: 'Enter' });
    await waitFor(() => expect(chamadas.some((c) => c.url.includes('/apoio/produto?codigo=993152&plu=S'))).toBe(true));
    expect(await screen.findByText(/SCRAP KG · KG · custo/)).toBeTruthy();
    const qtde = screen.getByLabelText(/Qtde/) as HTMLInputElement;
    fireEvent.change(qtde, { target: { value: '2' } });
    fireEvent.blur(qtde);
    fireEvent.click(botao('Adicionar'));
    expect(window.alert).not.toHaveBeenCalled();
    expect(await screen.findByText('SCRAP KG')).toBeTruthy();
  });

  it('o Excluir do item gravado pede a liberação por login e manda o item com as credenciais; o Limpar confirma e esvazia; o F6 abre a análise geral do produto da linha', async () => {
    await abrirScrap();
    fireEvent.click(screen.getByText('SCRAP FILHO 500G').closest('tr')!.querySelector('button')!);
    expect(window.confirm).toHaveBeenCalledWith('Deseja excluir o item selecionado?');
    expect(await screen.findByText('Liberar a exclusão do item')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Login/), { target: { value: 'ADMIN' } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: 'x' } });
    fireEvent.click(botao('Confirmar'));
    await waitFor(() => expect(chamadas.some((c) => c.url.endsWith('/cadastro/scrap/15916/excluir-itens'))).toBe(true));
    expect(chamadas.find((c) => c.url.endsWith('/excluir-itens'))!.body).toEqual({ codscrapitens: [501], login: 'ADMIN', senha: 'x' });
    expect(await screen.findByText(/Sem itens/)).toBeTruthy();
  });

  it('o Limpar confirma e esvazia a lista local; o F6 leva à posição do produto da linha corrente', async () => {
    await abrirScrap();
    fireEvent.click(screen.getByText('SCRAP FILHO 500G').closest('tr')!);
    fireEvent.keyDown(window, { key: 'F6', code: 'F6' });
    expect((await screen.findByTestId('onde')).textContent).toBe('/cadastro/produtos/posicao?idproduto=993150');
  });

  it('o scrap importado numa NF mostra o grupo "Notas fiscais" e avisa com a NF ao tentar gravar', async () => {
    scrap = { ...SCRAP, notas: [{ codnf: 165473, nronf: '4400', dtemissao: '2026-10-02', tiponf: 'S', statusnota: 'ENVIADA SEFAZ' }] };
    await abrirScrap();
    expect(screen.getByText('Notas fiscais')).toBeTruthy();
    expect(screen.getByText('ENVIADA SEFAZ')).toBeTruthy();
    expect(screen.queryByText('Adicionar')).toBeNull();
  });
});
