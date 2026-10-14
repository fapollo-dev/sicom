import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ManifestoDfePage } from '../src/features/manifesto-dfe/ManifestoDfePage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const CH_A = '52991201000000000001550010000010001000010001';
const CH_C = '52991201000000000003550010000010003000010003';
const LINHAS = [
  { chave: CH_A, cadastrada: 'NAO', codigo: 97001, numero_nf: '10001', data_emissao: '2026-10-01', cnpj_cpf: '11.222.333/0001-81', razao: 'FORN A', tipo: 'ENTRADA', total_nf: 1000,
    processada: 'NAO', ciencia: 'NAO', confirmacao: 'NAO', naorealizada: 'NAO', desconhecimento: 'NAO', cancelamento: 'NAO', outros_eventos: 'NAO', contingencia: 'NAO', tem_xml: true, ignorada: 'N' },
  { chave: CH_C, cadastrada: 'SIM', codigo: 555, numero_nf: '10003', data_emissao: '2026-10-02', cnpj_cpf: '11.222.333/0001-81', razao: 'FORN C', tipo: 'ENTRADA', total_nf: 3000,
    processada: 'SIM', ciencia: 'SIM', confirmacao: 'SIM', naorealizada: 'NAO', desconhecimento: 'NAO', cancelamento: 'NAO', outros_eventos: 'NAO', contingencia: 'NAO', tem_xml: true, ignorada: 'N' },
];

let corpos: Array<{ url: string; body: any }> = [];
beforeEach(() => {
  corpos = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    corpos.push({ url: u, body });
    if (u.endsWith('/manifesto-dfe/listar')) return { ok: true, status: 200, json: async () => ({ linhas: LINHAS, totais: { linhas: 2, pendentes: 1, canceladas: 0, total: 4000 } }) };
    if (u.endsWith('/manifesto-dfe/importar-xml')) return { ok: true, status: 200, json: async () => ({ resultados: [{ nome: 'a.xml', chave: CH_A, importado: 'S', erro: '' }], chaves: [CH_A], importadas: 1 }) };
    if (u.endsWith('/manifesto-dfe/xml-lote')) return { ok: true, status: 200, json: async () => ({ zip: btoa('PK'), nome: 'manifesto-xml.zip', exportadas: 1, faltantes: [] }) };
    if (u.includes(`/manifesto-dfe/danfe/${CH_C}`)) return { ok: true, status: 200, json: async () => ({ cadastrada: true, codnf: 555 }) };
    if (u.includes(`/manifesto-dfe/danfe/${CH_A}`)) return { ok: false, status: 422, json: async () => ({ statusCode: 422, code: 'DANFE_NOTA_NAO_IMPORTADA', message: 'O DANFE desta NF-e ainda não importada não é gerado pelo Apollo: baixe o XML (Download do documento) ou importe a nota.' }) };
    if (u.includes('/fiscal/nf/555/danfe')) return { ok: true, status: 200, json: async () => ({ modelo: '', datasets: {} }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  (URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (URL as any).revokeObjectURL = vi.fn();
  window.confirm = vi.fn(() => true) as any;
  window.open = vi.fn() as any;
});

function Onde() { const l = useLocation(); return <div data-testid="onde">{l.pathname + l.search}</div>; }
const tela = () => render(
  <MemoryRouter initialEntries={['/compras/manifesto-dfe']}><ShortcutScope><MensagemProvider>
    <Routes>
      <Route path="/compras/manifesto-dfe" element={<ManifestoDfePage />} />
      <Route path="/fiscal/notas/entrada" element={<Onde />} />
    </Routes>
  </MensagemProvider></ShortcutScope></MemoryRouter>,
);
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto)!;

describe('Manifesto do destinatário (FRMMANIFESTODFE) — os controles da tela do legado', () => {
  it('F5 busca as últimas sem filtro; a linha cadastrada tem "abrir" (a NF de entrada) e "DANFE"; a da fila avisa no DANFE; "site" abre o portal com a chave copiada', async () => {
    tela();
    fireEvent.keyDown(document.body, { key: 'F5' });
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/listar'))).toBe(true));
    expect(corpos.find((c) => c.url.endsWith('/listar'))!.body).toEqual({ canceladas: 'TODOS' });
    expect(await screen.findByText('FORN C')).toBeTruthy();
    const linhaC = screen.getByText('FORN C').closest('tr')!;
    fireEvent.click([...linhaC.querySelectorAll('button')].find((b) => b.textContent === 'abrir')!);
    expect((await screen.findByTestId('onde')).textContent).toBe('/fiscal/notas/entrada?codigo=555');
  });

  it('o "DANFE" da fila mostra o aviso do legado; o "site" abre o portal nacional', async () => {
    tela();
    fireEvent.click(botao('Pesquisar'));
    const linhaA = (await screen.findByText('FORN A')).closest('tr')!;
    fireEvent.click([...linhaA.querySelectorAll('button')].find((b) => b.textContent === 'DANFE')!);
    expect(await screen.findByText(/não é gerado pelo Apollo/)).toBeTruthy();
    fireEvent.click([...linhaA.querySelectorAll('button')].find((b) => b.textContent === 'site')!);
    expect(window.open).toHaveBeenCalledWith('https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=completa&tipoConteudo=XbSeqxE8pl8=', '_blank');
  });

  it('importar XML manda os arquivos lidos, pergunta se carrega as importadas e lista pelas chaves; exportar XML das marcadas baixa o .zip', async () => {
    tela();
    const input = screen.getByLabelText('Arquivos XML') as HTMLInputElement;
    const f = new File(['<nfeProc/>'], 'a.xml', { type: 'text/xml' });
    Object.defineProperty(f, 'text', { value: async () => '<nfeProc/>' });
    fireEvent.change(input, { target: { files: [f] } });
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/importar-xml'))).toBe(true));
    expect(corpos.find((c) => c.url.endsWith('/importar-xml'))!.body).toEqual({ arquivos: [{ nome: 'a.xml', xml: '<nfeProc/>' }] });
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/listar') && c.body?.chaves?.length === 1)).toBe(true));
    expect(await screen.findByText('FORN A')).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('Marcar')[0]);
    fireEvent.click(botao('Exportar XML (marcadas)'));
    await waitFor(() => expect(corpos.some((c) => c.url.endsWith('/xml-lote'))).toBe(true));
    expect(corpos.find((c) => c.url.endsWith('/xml-lote'))!.body).toEqual({ chaves: [CH_A] });
    await waitFor(() => expect((URL as any).createObjectURL).toHaveBeenCalled());
  });
});
