import { describe, it, expect } from 'vitest';
import { filtrarAgendas } from '../src/features/agenda-promocao/AgendaPromocaoCadMaster';

/** a pergunta da Pesquisa do legado (btnPesquisaClick/F3): só abertas (FLAGPROMOCAO <> J e fim ≥ hoje), só fechadas (J), todas */
const L = [
  { codagenda: 1, flagpromocao: 'N', situacao: 'AGENDADA', dtfimpromocao: '2026-12-31T23:59:00' },
  { codagenda: 2, flagpromocao: 'E', situacao: 'VIGENTE', dtfimpromocao: '2026-10-20T23:59:00' },
  { codagenda: 3, flagpromocao: 'J', situacao: 'ENCERRADA', dtfimpromocao: '2026-10-20T23:59:00' },
  { codagenda: 4, flagpromocao: 'N', situacao: 'EXPIRADA', dtfimpromocao: '2026-01-10T23:59:00' },
];
describe('Agenda de promoção — "Trazer" (btnPesquisaClick, uCadAgendaPromocao.pas:857)', () => {
  it('abertas = não fechada e com o fim de hoje em diante; fechadas = FLAGPROMOCAO J; todas = tudo', () => {
    expect(filtrarAgendas(L, 'abertas', '2026-10-14').map((a) => a.codagenda)).toEqual([1, 2]);
    expect(filtrarAgendas(L, 'fechadas', '2026-10-14').map((a) => a.codagenda)).toEqual([3]);
    expect(filtrarAgendas(L, 'todas', '2026-10-14').map((a) => a.codagenda)).toEqual([1, 2, 3, 4]);
    // a que termina hoje ainda é aberta (DT_FIM_PROMOCAO >= TRUNC(SYSDATE))
    expect(filtrarAgendas(L, 'abertas', '2026-10-20').map((a) => a.codagenda)).toEqual([1, 2]);
    expect(filtrarAgendas(L, 'abertas', '2026-10-21').map((a) => a.codagenda)).toEqual([1]);
  });
});
