import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const impressoes: string[] = [];
vi.mock('../src/shared/fr3/imprimirRelatorio', () => ({ imprimirRelatorio: vi.fn(async (p: string) => { impressoes.push(p); }) }));
import { RentabilidadePage } from '../src/features/rentabilidade/RentabilidadePage';

const LINHAS = [
  { subgrupo: 'ARROZ', idproduto: 10, descricao: 'ARROZ 5KG', vrcusto: 5, vrunit: 10, promocao: 'N', totcusto: 50, totvenda: 100, despacess: 1, frete: 2, frete2: 0, st: 0,
    vrfcpst: 0, ipi: 0, seguro: 0, bonificacao: 0, creditoicms: 9, creditopiscofins: 4.63, vrcustoreal: 39.37, debitoicms: 18, debitopiscofins: 9.25, vendaliquida: 72.75,
    vrperda: 0, lucro: 30, margembruta: 41.24, despoperacional: 5, imprenda: 3.75, contsocial: 2.25, lucrofinal: 19, margemfinal: 19 },
  { subgrupo: 'ARROZ', idproduto: 11, descricao: 'ARROZ 1KG', vrcusto: 1, vrunit: 2, promocao: 'S', totcusto: 10, totvenda: 20, despacess: 0, frete: 0, frete2: 0, st: 0,
    vrfcpst: 0, ipi: 0, seguro: 0, bonificacao: 0, creditoicms: 1.8, creditopiscofins: 0.93, vrcustoreal: 7.27, debitoicms: 3.6, debitopiscofins: 1.85, vendaliquida: 14.55,
    vrperda: 0, lucro: 6, margembruta: 41.24, despoperacional: 1, imprenda: 0.75, contsocial: 0.45, lucrofinal: 3.8, margemfinal: 19 },
];
let urls: string[] = [];
beforeEach(() => {
  urls = []; impressoes.length = 0;
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url); urls.push(u);
    const r = u.includes('/acesso/opcoes/') ? { opcoes: ['BTNCONSULTA'] } : u.includes('/rentabilidade/legado') ? { empresas: [1], linhas: LINHAS }
      : u.includes('/pesquisa/meta') ? { titulo: 'Família de produtos', colunas: [{ campo: 'nome', titulo: 'Nome', tipo: 'texto' }], operacoes: { texto: ['igual', 'qualquer'], numero: ['igual'] }, abertura: { campo: 'nome', operacao: 'qualquer', valor: null, ordenacao: 'nome', ordemDesc: false }, opcoes: [], situacao: false, retorno: 'codigo', obrigatorio: null } : { linhas: [], total: 0 };
    return { ok: true, status: 200, json: async () => r };
  }) as any;
  (URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (URL as any).revokeObjectURL = vi.fn();
});
const tela = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><RentabilidadePage /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const botao = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;

describe('Rentabilidade por categorias (uRentabilidadeCategorias.dfm)', () => {
  it('Completo com "Exibe grade": o [F9] mostra a grade do legado (rótulos, ordem e as somas do rodapé); Imprimir imprime, Exportar baixa, Sair fecha', async () => {
    tela();
    await waitFor(() => expect(botao('[F9] Consultar').disabled).toBe(false));
    fireEvent.click(botao('[F9] Consultar'));
    expect(await screen.findByText('ARROZ 5KG')).toBeTruthy();
    expect(urls.some((u) => u.includes('/relatorios/rentabilidade/legado?') && u.includes('tipo=COMPLETO'))).toBe(true);
    expect(impressoes.length).toBe(0);
    for (const h of ['Categoria', 'PLU', 'Prom.', 'Desp. acessórias', 'FCP ST', 'Crédito P/C', 'Total custo real', 'Total venda líquida', 'MLB %', 'Ct. social', 'MLF %']) expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    // o rodapé soma: total venda 100 + 20
    expect(screen.getAllByText('120,00').length).toBeGreaterThan(0);
    fireEvent.click(botao('Exportar'));
    expect((URL as any).createObjectURL).toHaveBeenCalled();
    fireEvent.click(botao('Imprimir'));
    await waitFor(() => expect(impressoes.length).toBe(1));
    expect(impressoes[0]).toContain('/relatorios/rentabilidade/impressao?');
    fireEvent.click(botao('Sair'));
    expect(screen.queryByText('ARROZ 5KG')).toBeNull();
  });

  it('Simplificado trava e desmarca o "Exibe grade" e o [F9] vai direto à impressão; Vendas e Notas Fiscais manda considerarNf', async () => {
    tela();
    await waitFor(() => expect(botao('[F9] Consultar').disabled).toBe(false));
    fireEvent.click(screen.getByLabelText('Simplificado'));
    const grade = screen.getByLabelText('Exibe grade') as HTMLInputElement;
    expect(grade.disabled).toBe(true);
    expect(grade.checked).toBe(false);
    fireEvent.click(screen.getByLabelText('Vendas e Notas Fiscais'));
    fireEvent.click(botao('[F9] Consultar'));
    await waitFor(() => expect(impressoes.length).toBe(1));
    expect(impressoes[0]).toContain('tipo=SIMPLIFICADO');
    expect(impressoes[0]).toContain('considerarNf=true');
    expect(urls.some((u) => u.includes('/rentabilidade/legado'))).toBe(false);
  });

  it('o [F3] no Dpto abre a Pesquisa da GET_FAMILIAS_PROD com TIPO = DEPARTAMENTO', async () => {
    tela();
    fireEvent.keyDown(screen.getByLabelText('Dpto - [F3] buscar'), { key: 'F3' });
    await waitFor(() => expect(urls.some((u) => u.includes('/cadastro/pesquisa/meta?recurso=lookup%2Ffamilias'))).toBe(true));
  });
});
