import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrecificacaoNfPage } from '../src/features/precificacao-nf/PrecificacaoNfPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const LINHA = { codnfprod: 900, idproduto: 5, codnf: 55, nronf: '123', dtemissao: '2026-10-01', descricao: 'ARROZ', codbarra: '789', codprodnota: '789',
  quantidade: 10, fatorembal: 1, vrcusto: 5, custo_rep: 5, custo_csi: 4, ultcusto: 5, ult_custo_rep: 5, vrvenda: 8, preco_venda: 8, pmz: 6, vrvendasug: 8,
  markup: 60, markdown: 37.5, markupfixo: 0, vrpromo: 0, grupo_preco: null, aliquota: 'T18', icms: 18, idempresa: 1, statusnfe: null, proc: 'S', cancelada: 'N',
  markup_autorizado: true, parceiro_razao: 'FORN', margem_negativa: false };
let urls: string[] = [];
let linhas: unknown[] = [LINHA];
let notaResp: { status: number; body: unknown } = { status: 200, body: { codnf: 55 } };
beforeEach(() => {
  urls = []; linhas = [LINHA]; notaResp = { status: 200, body: { codnf: 55 } };
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url); urls.push(u);
    if (u.endsWith('/precificacao/nf/tela')) return { ok: true, status: 200, json: async () => ({ tipoCusto: 'BRUTO', mostrarEtiquetas: true, markdownFixo: true }) };
    if (u.includes('/precificacao/nf/nota?')) return { ok: notaResp.status === 200, status: notaResp.status, json: async () => notaResp.body };
    if (u.includes('/precificacao/nf?')) return { ok: true, status: 200, json: async () => ({ tipoCusto: 'BRUTO', mostrarEtiquetas: true, linhas, totais: { itens: linhas.length, margemNegativa: 0, custoTotal: 0, mediaMargem: 0, lucroCB: 0, lucroRep: 0, lucroCSI: 0 } }) };
    return { ok: true, status: 200, json: async () => [] };
  }) as any;
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><PrecificacaoNfPage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;

describe('Precificação de NF (uPrecificacaoNF.dfm) — o filtro do legado', () => {
  it('abre no custo configurado; o Número NF resolve o Código NF ao sair; Visualizar filtra pelo CODNF sem período; colunas Código NF/Emissão e o MARKDOWN FIXO', async () => {
    tela();
    await waitFor(() => expect((screen.getByLabelText('Valor custo bruto') as HTMLInputElement).checked).toBe(true));
    const nro = screen.getByLabelText('Número NF [F3]');
    fireEvent.change(nro, { target: { value: '123' } });
    fireEvent.blur(nro);
    await waitFor(() => expect((screen.getByLabelText('Código NF') as HTMLInputElement).value).toBe('55'));
    expect((screen.getByLabelText('Período NF') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(botao('Visualizar'));
    await waitFor(() => expect(urls.some((u) => u.includes('/precificacao/nf?'))).toBe(true));
    const q = urls.find((u) => u.includes('/precificacao/nf?'))!;
    expect(q).toContain('codnf=55');
    expect(q).toContain('tipoCusto=BRUTO');
    expect(q).not.toContain('dataIni');
    // o rótulo do filtro e o cabeçalho da coluna
    expect(screen.getAllByText('Código NF').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Markdown fixo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('01/10/2026').length).toBeGreaterThan(0);
  });

  it('o número repetido avisa e limpa; "Data NF" limpa a nota e libera o período, que vai na consulta; sem registros, a mensagem do legado', async () => {
    notaResp = { status: 422, body: { statusCode: 422, code: 'PRECIFICACAO_NF_NUMERO_REPETIDO', message: 'Encontrada mais de uma nota fiscal para este mesmo número. Utilize a pesquisa para selecionar a nota fiscal desejada.' } };
    tela();
    const nro = screen.getByLabelText('Número NF [F3]') as HTMLInputElement;
    fireEvent.change(nro, { target: { value: '77' } });
    fireEvent.blur(nro);
    expect(await screen.findByText(/Encontrada mais de uma nota fiscal/)).toBeTruthy();
    await waitFor(() => expect(nro.value).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    fireEvent.click(screen.getByLabelText('Data NF'));
    expect((screen.getByLabelText('Período NF') as HTMLInputElement).disabled).toBe(false);
    linhas = [];
    fireEvent.click(botao('Visualizar'));
    expect(await screen.findByText(/Registros não encontrados/)).toBeTruthy();
    const q = urls.find((u) => u.includes('/precificacao/nf?'))!;
    expect(q).toContain('dataIni=');
    expect(q).not.toContain('codnf');
  });
});
