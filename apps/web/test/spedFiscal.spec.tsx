import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { SpedFiscalPage } from '../src/features/sped/SpedFiscalPage';
import { PendenciasSpedModal } from '../src/features/sped/PendenciasSpedModal';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const PEND = [
  { tipo: 'administradora_sem_cnpj', descricao: 'CNPJ DO PARCEIRO(ADMINISTRADORA) INVÁLIDO', codigo: '42450', descricao_registro: 'BANCO BRADESCO SA', abrir: { cadastro: 'parceiro', id: 42450 } },
  { tipo: 'operadora_sem_adm', descricao: 'PARCEIRO NÃO VINCULADO NO CADASTRO DO CARTÃO', codigo: '981', descricao_registro: 'VISA VOUCHER - CODREDE 5', abrir: { cadastro: 'operadora', id: 981 } },
];

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/fiscal/sped/pendencias')) return { ok: true, status: 200, json: async () => ({ pendencias: PEND }) };
    if (u.endsWith('/fiscal/sped/efd-icms-ipi')) {
      return { ok: true, status: 200, json: async () => ({ arquivo: '|0000|017|0|01092026|30092026|LOJA|\r\n', nomeArquivo: 'SPED_12345678000190_09102026.txt', linhas: 1, documentos: 0,
        parcial: true, aviso: 'PARCIAL', validacao: { ok: true, erros: [], registros: 1 } }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  (URL as any).createObjectURL = vi.fn(() => 'blob:sped');
  (URL as any).revokeObjectURL = vi.fn();
});

const chamadas = () => (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;

describe('SPED ICMS/IPI (FRMSPEDFISCAL) — o gerador com o pré-validador', () => {
  it('o pré-validador mostra as pendências; ao sair delas a geração segue e baixa SPED_<CNPJ>_<data>.txt', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><SpedFiscalPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Competência: de/), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText(/^até/), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: /erar/ }));
    expect(await screen.findByText('Pendências SPED')).toBeTruthy();
    expect(screen.getByText('BANCO BRADESCO SA')).toBeTruthy();
    expect(screen.getByText('Quantidade de registros: 2')).toBeTruthy();
    expect(chamadas().some(([u]) => String(u).endsWith('/efd-icms-ipi'))).toBe(false);
    const corpo = JSON.parse(String(chamadas().find(([u]) => String(u).endsWith('/pendencias'))![1]!.body));
    expect(corpo).toEqual({ tipo: 'fiscal', dtini: '2026-09-01', dtfim: '2026-09-30' });

    fireEvent.click(screen.getByRole('button', { name: /air/ }));
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/efd-icms-ipi'))).toBe(true));
    // sem "Gerar H001" o inventário não vai
    expect(JSON.parse(String(chamadas().find(([u]) => String(u).endsWith('/efd-icms-ipi'))![1]!.body)).inventario).toBeUndefined();
    expect(await screen.findByText('SPED_12345678000190_09102026.txt')).toBeTruthy();
    expect(await screen.findByText(/Arquivo gerado com sucesso/)).toBeTruthy();
    expect((URL as any).createObjectURL).toHaveBeenCalled();
  });

  it('sem o pré-validador a geração vai direto', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><SpedFiscalPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Competência: de/), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText(/^até/), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByLabelText('Pré-validador'));
    fireEvent.click(screen.getByRole('button', { name: /erar/ }));
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/efd-icms-ipi'))).toBe(true));
    expect(chamadas().some(([u]) => String(u).endsWith('/pendencias'))).toBe(false);
  });

  it('o Bloco H: sem "Gerar H001" não manda inventário; marcado, manda a data, o motivo e a correção tributária', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><SpedFiscalPage /></MensagemProvider></ShortcutScope></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Competência: de/), { target: { value: '2027-02-01' } });
    fireEvent.change(screen.getByLabelText(/^até/), { target: { value: '2027-02-28' } });
    fireEvent.click(screen.getByLabelText('Pré-validador'));
    expect((screen.getByLabelText('Mot. inventário - H005') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Gerar H001 (Inventário)'));
    fireEvent.change(screen.getByLabelText('Data Inventário'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Mot. inventário - H005'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Correção Tributária'));
    fireEvent.click(screen.getByRole('button', { name: /erar/ }));
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/efd-icms-ipi'))).toBe(true));
    const corpo = JSON.parse(String(chamadas().find(([u]) => String(u).endsWith('/efd-icms-ipi'))![1]!.body));
    expect(corpo).toEqual({ dtini: '2027-02-01', dtfim: '2027-02-28', inventario: { data: '2026-12-31', motivo: 2, correcao: true } });
  });

  it('o Corrigir da operadora de cartão abre a tela dela em outra aba', async () => {
    const abrir = vi.fn();
    (window as any).open = abrir;
    render(<MemoryRouter><ShortcutScope><MensagemProvider>
      <PendenciasSpedModal titulo="Pendências SPED" pendencias={PEND as any} onReanalisar={async () => PEND as any} onFechar={() => undefined} />
    </MensagemProvider></ShortcutScope></MemoryRouter>);
    fireEvent.click(screen.getByText('VISA VOUCHER - CODREDE 5'));
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir' }));
    expect(abrir).toHaveBeenCalledWith('/cadastro/operadoras?codigo=981', '_blank');
  });
});
