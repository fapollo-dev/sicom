import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RedesEstabelecimentoSection, LOOKUPS_EMPRESA } from '../src/features/empresas/EmpresasCadMaster';
import { MensagemProvider } from '../src/shared/mensagem';
import { ShortcutScope } from '../src/shared/keyboard';

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => [{ ere_rede: 5, ere_numero_estabelecimento: '85150371' }, { ere_rede: 54, ere_numero_estabelecimento: '94990735' }] })) as any;
});

describe('Empresas (UCadEmpresa.dfm) — rede × estabelecimento e as Pesquisas dos códigos', () => {
  it('a grade mostra a rede pelo nome do combo do legado (Rede 5) e a desconhecida pelo código', async () => {
    render(<MemoryRouter><ShortcutScope><MensagemProvider><RedesEstabelecimentoSection idempresa={1} editavel /></MensagemProvider></ShortcutScope></MemoryRouter>);
    expect(await screen.findByText('85150371')).toBeTruthy();
    const celulas = [...document.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(celulas).toContain('Rede');
    expect(screen.getByText('Rede 54')).toBeTruthy();
  });
  it('os centros de custo, fornecedores e contas da empresa vão pela Pesquisa (com a descrição)', () => {
    expect(LOOKUPS_EMPRESA.codplc_voucher.recurso).toBe('lookup/plc');
    expect(LOOKUPS_EMPRESA.ccdesconto.recurso).toBe('lookup/plc');
    expect(LOOKUPS_EMPRESA.codfornecedor_recarga.recurso).toBe('lookup/parceiros');
    expect(LOOKUPS_EMPRESA.codconta_baixa_recarga.recurso).toBe('lookup/contas-bancarias');
  });
});
