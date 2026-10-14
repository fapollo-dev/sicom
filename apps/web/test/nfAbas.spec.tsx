import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { FormasPagamentoSection, CartaCorrecaoTab, DevolucoesCompraTab, AvulsaTab } from '../src/features/nf/NfCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

/** as abas da NF auditadas no uNF.dfm (14/10/2026): formas de pagamento, carta de correção, devoluções da compra e NF-e avulsa */
let chamadas: Array<{ url: string; method: string; body: any }> = [];
let linhas: any[] = [];
beforeEach(() => {
  chamadas = [];
  linhas = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url: u, method: init?.method ?? 'GET', body });
    if (u.endsWith('/formas-pagamento') && (init?.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ codnf: 55, totalnf: 100, totalPago: linhas.reduce((s, l) => s + l.vrpgto, 0), linhas,
      formas: [{ idpgto: 1, modalidade: 'DINHEIRO', destino: 'CXA' }, { idpgto: 3, modalidade: 'CARTAO', destino: 'CRT' }], operadoras: [{ codoperadoras: 9, operadora: 'VISA' }] }) };
    if (u.endsWith('/formas-pagamento') && init?.method === 'POST') { linhas = [{ codnforpgto: 77, idpgto: body.idpgto, modalidade: body.idpgto === 3 ? 'CARTAO' : 'DINHEIRO', vrpgto: body.vrpgto, vrtroco: 0, integrado: body.integrado, operadora: null, numero_aut: null }]; return { ok: true, status: 201, json: async () => ({ codnforpgto: 77 }) }; }
    if (u.includes('/formas-pagamento/77') && init?.method === 'DELETE') { linhas = []; return { ok: true, status: 200, json: async () => ({ codnforpgto: 77 }) }; }
    if (u.endsWith('/cartas-correcao')) return { ok: true, status: 200, json: async () => ({ codnf: 55, chavenfe: '3126', linhas: [{ codnfe_evento: 1, seq_evento: 1, protocolo_autorizacao: '135', data_evento: '2026-10-01T10:00:00Z', data_autorizacao: null, mensagem_autorizacao: 'Evento registrado', correcao: 'CORRIGE O ENDERECO' }] }) };
    if (u.endsWith('/devolucoes-compra')) return { ok: true, status: 200, json: async () => ({ codnf: 55, linhas: [{ cod_pedido_dev_compra: 10346, data_pedido: '2026-09-02', status: 'FINALIZADO', cod_nota_fiscal_emitida: 165473, nronf: '4400', chavenfe: '3126xyz', dtemissao: '2026-09-03' }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  window.confirm = vi.fn(() => true) as any;
});

function Tela({ children, valores }: { children: (form: any) => JSX.Element; valores: Record<string, unknown> }) {
  const form = useForm({ defaultValues: valores });
  return <QueryClientProvider client={new QueryClient()}><MemoryShell>{children(form)}</MemoryShell></QueryClientProvider>;
}
function MemoryShell({ children }: { children: JSX.Element }) {
  return <ShortcutScope><MensagemProvider>{children}</MensagemProvider></ShortcutScope>;
}
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto)!;

describe('NF — as abas auditadas do uNF.dfm', () => {
  it('Formas de pagamento: o Adicionar sugere total − pago, a operadora fica fechada sem forma CRT/TEF/POS, o Gravar manda a forma e a lista mostra a modalidade; o Excluir confirma', async () => {
    render(<Tela valores={{ codnf: 55, tipo: 'E' }}>{(form) => <FormasPagamentoSection form={form} liberado />}</Tela>);
    expect(await screen.findByText('Sem formas de pagamento na nota.')).toBeTruthy();
    // o Adicionar só abre com a lista carregada (o valor sugerido é total − pago)
    await waitFor(() => expect((botao('Adicionar') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(botao('Adicionar'));
    const operadora = screen.getByLabelText(/Operadora/) as HTMLSelectElement | HTMLButtonElement;
    expect((operadora as HTMLButtonElement).disabled ?? (operadora as HTMLSelectElement).disabled).toBe(true);
    const valor = screen.getByLabelText('Valor Pagamento') as HTMLInputElement;
    expect(valor.value).toContain('100');
    // (a forma é um Select Radix do DS — não se escolhe no jsdom; o servidor recusa idpgto 0 com NF_FORMA_PGTO_OBRIGATORIA, smoke §314.4)
    fireEvent.click(botao('Gravar'));
    await waitFor(() => expect(chamadas.some((c) => c.url.endsWith('/fiscal/nf/55/formas-pagamento') && c.method === 'POST')).toBe(true));
    const post = chamadas.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ idpgto: 0, vrpgto: 100, integrado: 'N' });
    expect(await screen.findByText('DINHEIRO')).toBeTruthy();
    fireEvent.click([...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Excluir' || b.textContent === 'Excluir')!);
    await waitFor(() => expect(chamadas.some((c) => c.method === 'DELETE')).toBe(true));
    expect(window.confirm).toHaveBeenCalledWith('Deseja realmente excluir a forma de pagamento?');
  });

  it('Carta Correção lista as CC-e da chave; Devoluções da Compra lista os pedidos de devolução; a NF-e avulsa mostra o fisco emitente', async () => {
    render(<Tela valores={{ codnf: 55, fisco_emit_cnpj: '16907746000120', fisco_emit_orgao: 'SEF/MG' }}>{(form) => (
      <div><CartaCorrecaoTab form={form} /><DevolucoesCompraTab form={form} /><AvulsaTab form={form} /></div>
    )}</Tela>);
    expect(await screen.findByText('CORRIGE O ENDERECO')).toBeTruthy();
    expect(await screen.findByText('10346')).toBeTruthy();
    expect(screen.getByText('165473')).toBeTruthy();
    expect((screen.getByLabelText('Órgão Emitente') as HTMLInputElement).value).toBe('SEF/MG');
  });

  it('sem nota gravada, as abas pedem para gravar', () => {
    render(<Tela valores={{}}>{(form) => <div><FormasPagamentoSection form={form} liberado /><CartaCorrecaoTab form={form} /></div>}</Tela>);
    expect(screen.getByText('Grave a nota para informar as formas de pagamento.')).toBeTruthy();
    expect(screen.getByText('Grave a nota para ver as cartas de correção.')).toBeTruthy();
  });
});
