import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ExportaBalancaPage } from '../src/features/exporta-balanca/ExportaBalancaPage';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

const CONFIGS = [
  { id: 302, idempresa: 1, razao_social: 'LOJA UM', dir_bal: 'D:\\Dados\\Balanca\\LJ1', tipo_bal: 'TOLEDO', mod_bal: 'PRIX4-N', campo_setor: 'Código da Balança', export_nutricional: 'S', export_receita: 'S', exporta_tara: 'N' },
  { id: 223, idempresa: 2, razao_social: 'LOJA DOIS', dir_bal: 'D:\\Dados\\Balanca\\LJ2', tipo_bal: 'TOLEDO', mod_bal: 'PRIX4-N', campo_setor: 'Código da Balança', export_nutricional: 'S', export_receita: 'S', exporta_tara: 'N' },
];
const arq = (nome: string) => ({ nome, conteudo: 'X\r\n', linhas: 1 });

let alertas: string[] = [];
let respostaLote: unknown;
beforeEach(() => {
  alertas = [];
  window.alert = vi.fn((m: string) => { alertas.push(m); }) as any;
  respostaLote = { lotes: [{ config: 302, idempresa: 1, pasta: 'LJ1', modelo: 'PRIX4-N', produtos: 3, arquivos: [arq('TXITENS.TXT')], aviso: null }], zip: null, nomeZip: null };
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/exporta-balanca/configs')) return { ok: true, status: 200, json: async () => CONFIGS };
    if (u.endsWith('/auth/empresas')) return { ok: true, status: 200, json: async () => [{ idempresa: 1, fantasia: 'UM' }, { idempresa: 2, fantasia: 'DOIS' }] };
    if (u.endsWith('/exporta-balanca/gerar-lote')) return { ok: true, status: 200, json: async () => respostaLote };
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
  (URL as any).createObjectURL = vi.fn(() => 'blob:bal');
  (URL as any).revokeObjectURL = vi.fn();
});

const chamadas = () => (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;
const tela = () => render(<MemoryRouter><ShortcutScope><MensagemProvider><ExportaBalancaPage /></MensagemProvider></ShortcutScope></MemoryRouter>);

describe('Exportar para balança (FRMEXPORTABALANCA)', () => {
  it('a grade lista a config de cada loja com as colunas do legado; sem marcar, o Exportar avisa e não gera', async () => {
    tela();
    expect(await screen.findByText('LOJA DOIS')).toBeTruthy();
    expect(screen.getByText('Ex.Tabela Nutricional')).toBeTruthy();
    expect(screen.getByText('D:\\Dados\\Balanca\\LJ2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /xportar/ }));
    expect(alertas).toEqual(['Selecione os registros na grade á exportar e tente novamente!']);
    expect(chamadas().some(([u]) => String(u).endsWith('/gerar-lote'))).toBe(false);
  });

  it('marcar uma loja exporta só ela e baixa os .TXT', async () => {
    tela();
    fireEvent.click(await screen.findByLabelText('Selecionar a empresa 1'));
    fireEvent.click(screen.getByRole('button', { name: /xportar/ }));
    await waitFor(() => expect(chamadas().some(([u]) => String(u).endsWith('/gerar-lote'))).toBe(true));
    expect(JSON.parse(String(chamadas().find(([u]) => String(u).endsWith('/gerar-lote'))![1]!.body))).toEqual({ ids: [302] });
    expect(await screen.findByText(/Arquivos gerados com êxito/)).toBeTruthy();
    expect((URL as any).createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('a tecla T marca todas; com duas lojas baixa o .zip e a loja sem produto avisa', async () => {
    respostaLote = {
      lotes: [{ config: 302, idempresa: 1, pasta: 'LJ1', modelo: 'PRIX4-N', produtos: 3, arquivos: [arq('TXITENS.TXT')], aviso: null },
        { config: 223, idempresa: 2, pasta: 'LJ2', modelo: null, produtos: 0, arquivos: [], aviso: 'Não foi encontrado produto para balança.' }],
      zip: btoa('PK'), nomeZip: 'Balanca.zip',
    };
    tela();
    await screen.findByText('LOJA DOIS');
    fireEvent.keyDown(screen.getByLabelText('Lista de empresas configuradas para exportação'), { key: 't' });
    expect((screen.getByLabelText('Selecionar a empresa 2') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /xportar/ }));
    await waitFor(() => expect(alertas).toEqual(['Não foi encontrado produto para balança.']));
    expect(JSON.parse(String(chamadas().find(([u]) => String(u).endsWith('/gerar-lote'))![1]!.body)).ids.sort()).toEqual([223, 302]);
    expect((URL as any).createObjectURL).toHaveBeenCalledTimes(1);
  });
});
