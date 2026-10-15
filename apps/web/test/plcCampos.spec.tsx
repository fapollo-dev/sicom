import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { MemoryRouter } from 'react-router-dom';
import { CamposPlc } from '../src/features/plc/PlcCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

let tela = { lancamentoContabil: false, proprietario: false };
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).endsWith('/cadastro/plc-tela') ? tela : {}) })) as any;
});
function Tela({ valores }: { valores: Record<string, unknown> }) {
  const form = useForm<any>({ defaultValues: valores });
  return <MemoryRouter><ShortcutScope><MensagemProvider><CamposPlc form={form} editavel /></MensagemProvider></ShortcutScope></MemoryRouter>;
}
const caixa = (nome: RegExp) => screen.queryByRole('checkbox', { name: nome }) as HTMLButtonElement | null;

describe('Cadastro do Centro de Custos (uCadPLC.dfm) — as regras da tela', () => {
  it('sem a configuração e sem ser PRO: sem "Lançamento contábil" e sem "apenas proprietários"; na alteração o código trava e as marcações só no último nível', async () => {
    tela = { lancamentoContabil: false, proprietario: false };
    render(<Tela valores={{ codplc: 10, codpai: 5, desccodplc: '4.01', descricao: 'DESPESAS', ultimo_nivel: false }} />);
    await waitFor(() => expect((global.fetch as any).mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByText('Lançamento contábil')).toBeNull();
    expect(caixa(/apenas por proprietários/)).toBeNull();
    expect((screen.getByLabelText('Código da conta') as HTMLInputElement).disabled).toBe(true);
    expect(caixa(/Uso de setor/)!.disabled).toBe(true);
  });

  it('PRO com a configuração: a marcação de proprietário só na conta raiz; na inclusão com retrocedente as marcações liberam (último nível)', async () => {
    tela = { lancamentoContabil: true, proprietario: true };
    const { unmount } = render(<Tela valores={{ codpai: '', desccodplc: '', descricao: '' }} />);
    expect(await screen.findByText('Lançamento contábil')).toBeTruthy();
    await waitFor(() => expect(caixa(/apenas por proprietários/)).not.toBeNull());
    expect(caixa(/apenas por proprietários/)!.disabled).toBe(false);
    expect(caixa(/Uso de setor/)!.disabled).toBe(true);
    expect((screen.getByLabelText('Código da conta') as HTMLInputElement).disabled).toBe(false);
    unmount();
    render(<Tela valores={{ codpai: 7, desccodplc: '4.01', descricao: '' }} />);
    await waitFor(() => expect(caixa(/apenas por proprietários/)).not.toBeNull());
    expect(caixa(/apenas por proprietários/)!.disabled).toBe(true);
    expect(caixa(/Uso de setor/)!.disabled).toBe(false);
  });
});
