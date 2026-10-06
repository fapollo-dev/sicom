import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { z } from 'zod';
import { ShortcutScope, useShortcut, useEnterAdvances, TeclasDaBaseDesligadas } from '../src/shared/keyboard';
import { AppLayout } from '../src/app/AppLayout';
import { AuthProvider } from '../src/features/auth/AuthContext';
import { CadMaster } from '../src/shared/cadmaster/CadMaster';
import { useRef } from 'react';

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }) as any;
});

function Atalho({ combo, fn }: { combo: string; fn: () => void | boolean }) {
  useShortcut(combo, fn);
  return null;
}

describe('registro de atalhos com pilha de escopos (o KeyPreview do form ativo)', () => {
  it('o escopo mais interno trata primeiro; devolvendo false, a tecla desce para o de fora', () => {
    const fora = vi.fn();
    const dentroTrata = vi.fn();
    const { unmount } = render(
      <ShortcutScope>
        <Atalho combo="f9" fn={fora} />
        <ShortcutScope><Atalho combo="f9" fn={dentroTrata} /></ShortcutScope>
      </ShortcutScope>,
    );
    fireEvent.keyDown(window, { key: 'F9', code: 'F9' });
    expect(dentroTrata).toHaveBeenCalledTimes(1);
    expect(fora).not.toHaveBeenCalled();
    unmount();

    const fora2 = vi.fn();
    render(
      <ShortcutScope>
        <Atalho combo="escape" fn={fora2} />
        <ShortcutScope><Atalho combo="escape" fn={() => false} /></ShortcutScope>
      </ShortcutScope>,
    );
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(fora2).toHaveBeenCalledTimes(1);
  });

  it('Alt+letra pelo code (o Alt+O do Mac chega como "ø" em key)', () => {
    const fn = vi.fn();
    render(<ShortcutScope><Atalho combo="alt+o" fn={fn} /></ShortcutScope>);
    fireEvent.keyDown(window, { key: 'ø', code: 'KeyO', altKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

function Conteudo({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEnterAdvances(ref);
  return <div ref={ref}>{children}</div>;
}

describe('Enter-avança fora de <form> (o FormKeyPress do TfrmMaster)', () => {
  it('avança no container; não avança em campo "Enter nativo" nem em grade', async () => {
    const user = userEvent.setup();
    render(
      <Conteudo>
        <input aria-label="a" />
        <input aria-label="b" data-enter="nativo" />
        <div role="grid"><input aria-label="g" /></div>
        <input aria-label="c" />
      </Conteudo>,
    );
    const a = screen.getByLabelText('a'), b = screen.getByLabelText('b'), g = screen.getByLabelText('g');
    a.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(b);
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(b); // nativo: fica
    g.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(g); // grade: fica
  });
});

function Tela() {
  return (
    <div>
      <input aria-label="primeiro" />
      <input aria-label="segundo" />
    </div>
  );
}

function montarCasca() {
  const router = createMemoryRouter(
    [{ element: <AppLayout />, children: [{ path: '/tela', element: <Tela /> }, { path: '/inicio', element: <div>INICIO</div> }] }],
    { initialEntries: ['/tela'] },
  );
  render(<AuthProvider><RouterProvider router={router} /></AuthProvider>);
  return router;
}

describe('as teclas da base TfrmMaster na casca', () => {
  it('Esc fecha a tela (volta ao Início); com janela aberta por cima, o Esc é da janela', () => {
    const router = montarCasca();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    act(() => { fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }); });
    expect(router.state.location.pathname).toBe('/tela');
    dlg.remove();
    act(() => { fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }); });
    expect(router.state.location.pathname).toBe('/inicio');
  });

  it('Enter avança e Alt+← volta ao controle anterior', async () => {
    const user = userEvent.setup();
    montarCasca();
    const p = screen.getByLabelText('primeiro'), s = screen.getByLabelText('segundo');
    p.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(s);
    act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }); });
    expect(document.activeElement).toBe(p);
  });

  it('Ctrl+E abre a troca de empresa', async () => {
    montarCasca();
    act(() => { fireEvent.keyDown(window, { key: 'e', code: 'KeyE', ctrlKey: true }); });
    expect(await screen.findByText('Empresas')).toBeTruthy();
  });

  it('tela com o `inherited` comentado (TeclasDaBaseDesligadas): Esc não fecha, Enter não avança, Ctrl+E não troca', async () => {
    const user = userEvent.setup();
    const f3 = vi.fn();
    function TelaSemBase() {
      useShortcut('f3', f3);
      return <TeclasDaBaseDesligadas><input aria-label="primeiro" /><input aria-label="segundo" /></TeclasDaBaseDesligadas>;
    }
    const router = createMemoryRouter(
      [{ element: <AppLayout />, children: [{ path: '/tela', element: <TelaSemBase /> }, { path: '/inicio', element: <div>INICIO</div> }] }],
      { initialEntries: ['/tela'] },
    );
    render(<AuthProvider><RouterProvider router={router} /></AuthProvider>);
    act(() => { fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }); });
    expect(router.state.location.pathname).toBe('/tela');
    const p = screen.getByLabelText('primeiro');
    p.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(p);
    act(() => { fireEvent.keyDown(window, { key: 'e', code: 'KeyE', ctrlKey: true }); });
    expect(screen.queryByText('Empresas')).toBeNull();
    act(() => { fireEvent.keyDown(window, { key: 'F3', code: 'F3' }); });
    expect(f3).toHaveBeenCalledTimes(1); // a tecla própria da tela continua valendo
  });
});

const schema = z.object({ nome: z.string().optional(), ativo: z.string().optional() });
function cadastro() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ShortcutScope>
          <CadMaster<any>
            titulo="T" resourcePath="t/x" pk="id" schema={schema} defaultValues={{ nome: '', ativo: 'S' }}
            colunasPesquisa={[{ campo: 'id', label: 'Código' }, { campo: 'nome', label: 'Nome' }]}
            campos={({ form }) => <input aria-label="nome" {...form.register('nome')} />}
          />
        </ShortcutScope>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('as teclas da base de cadastro TfrmCadMaster', () => {
  it('F6 cicla o "Ativo [F6]" Sim → Não → Todos e F3 abre a Pesquisa com essa situação', async () => {
    cadastro();
    expect(screen.getByText(/Ativo \[F6\]/).textContent).toContain('Sim');
    act(() => { fireEvent.keyDown(window, { key: 'F6', code: 'F6' }); });
    expect(screen.getByText(/Ativo \[F6\]/).textContent).toContain('Não');
    act(() => { fireEvent.keyDown(window, { key: 'F3', code: 'F3' }); });
    await screen.findByRole('dialog');
    const chamadas = (global.fetch as any).mock.calls.map((c: unknown[]) => String(c[0]));
    expect(chamadas.some((u: string) => u.includes('situacao=inativos'))).toBe(true);
  });

  it('Esc em inclusão não sai da tela (o cadastro segura a tecla)', () => {
    const fora = vi.fn();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ShortcutScope>
            <Atalho combo="escape" fn={fora} />
            <CadMaster<any> titulo="T" resourcePath="t/x" pk="id" schema={schema} defaultValues={{ nome: '' }}
              campos={({ form }) => <input aria-label="nome" {...form.register('nome')} />} />
          </ShortcutScope>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // consulta: o Esc desce para a base
    act(() => { fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }); });
    expect(fora).toHaveBeenCalledTimes(1);
    // inclusão (Alt+A = &Adicionar): o cadastro segura o Esc
    act(() => { fireEvent.keyDown(window, { key: 'a', code: 'KeyA', altKey: true }); });
    act(() => { fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }); });
    expect(fora).toHaveBeenCalledTimes(1);
  });
});
