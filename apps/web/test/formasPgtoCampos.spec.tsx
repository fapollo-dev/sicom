import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { CamposFormaPgto } from '../src/features/formas-pgto/FormasPgtoCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ linhas: [], total: 0 }) })) as any;
});
function Wrap({ valores }: { valores: Record<string, unknown> }) {
  const form = useForm<Record<string, unknown>>({ defaultValues: valores });
  return <CamposFormaPgto form={form} editavel contaOptions={[]} />;
}
const tela = (valores: Record<string, unknown>) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShortcutScope><MensagemProvider><Wrap valores={valores} /></MensagemProvider></ShortcutScope></MemoryRouter>
  </QueryClientProvider>,
);
const aba = (t: string) => fireEvent.click(screen.getByRole('tab', { name: t }));

describe('Formas de pagamento (uCadFormaPgto.dfm) — os campos da tela', () => {
  it('a Modalidade só aceita letras, dígitos e espaço (edtMODALIDADEKeyPress); o Troco Limite só vale para TEF/CRT', () => {
    tela({ modalidade: '', destino: 'CXA', troco_limite: 0 });
    const mod = screen.getByLabelText('Modalidade') as HTMLInputElement;
    fireEvent.change(mod, { target: { value: 'CARTÃO-1 x' } });
    expect(mod.value).toBe('CARTO1 x');
    expect((screen.getByLabelText('Troco Limite') as HTMLInputElement).disabled).toBe(true);
    for (const l of ['Comissão (%)', 'Desc/Acres. (+/-)', 'Código contábil', 'Vr. mínimo para venda', 'Entregas', 'Exige permissão', 'Baixa documento automático']) {
      expect(screen.getByLabelText(l)).toBeTruthy();
    }
  });

  it('com destino TEF o Troco Limite abre; a aba CFOP traz dentro/fora do estado e a aba Condições a grade REL_FORMA_PAGAMENTO_CONDICAO', () => {
    tela({ destino: 'TEF', troco_limite: 5, cfopdentrodoestado: 5102, condicoes: [{ codconpagto: 3, condicao_pagamento: '30 DIAS' }] });
    expect((screen.getByLabelText('Troco Limite') as HTMLInputElement).disabled).toBe(false);
    aba('CFOP');
    expect((screen.getByLabelText('CFOP Dentro do Estado') as HTMLInputElement).value).toBe('5102');
    expect(screen.getByLabelText('CFOP Fora do Estado')).toBeTruthy();
    aba('Condições de pagamento');
    expect(screen.getByText('30 DIAS')).toBeTruthy();
    expect(screen.getByText('Código condição')).toBeTruthy();
  });
});
