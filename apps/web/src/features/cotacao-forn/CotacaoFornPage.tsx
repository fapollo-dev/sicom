import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Item {
  codctcfit: number; codcpr: number; descricao: string; codbarra: string; unidade: string;
  quantidade: number; valor: number; icms: number; fatorembalagem: number; valortotal: number;
  ultimo_valor: number | null; valorcusto: number; valorvenda: number;
}
interface Sessao { validadoPorEmpresa: boolean; codoperador: number | null; codparceiro: number | null; nome: string | null }

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });

/**
 * PREENCHER COTAÇÃO (`FRMCADCOTACAOFORN`). Dossiê: `uCadCotacaoForn.md`.
 *
 * A única tela em que quem opera pode ser **de fora da empresa**: o comprador monta a lista e o fornecedor
 * preenche os preços. Por isso ela abre com uma porta própria — e o que ficar gravado diz de quem foi a mão.
 */
export function CotacaoFornPage() {
  const mensagem = useMensagem();
  const [login, setLogin] = useState({ comoParceiro: true, login: '', codparceiro: '', senha: '' });
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [codctcforn, setCodctcforn] = useState('');
  const [cab, setCab] = useState<Record<string, any> | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [edit, setEdit] = useState<Record<number, { valor: string; icms: string; fator: string }>>({});
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const chamar = async (url: string, init?: RequestInit) => {
    const r = await fetch(`${BASE}/${url}`, { ...init, headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return r.json();
  };

  const entrar = async () => {
    setOcupado(true);
    try {
      const s = (await chamar('compras/cotacao-forn/autenticar', {
        method: 'POST',
        body: JSON.stringify({
          comoParceiro: login.comoParceiro,
          login: login.comoParceiro ? null : login.login,
          codparceiro: login.comoParceiro ? Number(login.codparceiro) : null,
          senha: login.senha,
        }),
      })) as Sessao;
      setSessao(s);
      mensagem.sucesso(`Bem-vindo, ${s.nome ?? ''}.`);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const abrir = async () => {
    setOcupado(true);
    try {
      const j = (await chamar(`compras/cotacao-forn/${Number(codctcforn)}`)) as { cabecalho: Record<string, any>; itens: Item[] };
      setCab(j.cabecalho);
      setItens(j.itens);
      setObs(String(j.cabecalho?.obs ?? ''));
      setEdit(Object.fromEntries(j.itens.map((i) => [i.codctcfit, {
        valor: String(i.valor ?? 0), icms: String(i.icms ?? 0), fator: String(i.fatorembalagem ?? 1),
      }])));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const gravar = async () => {
    if (!sessao || !cab) return;
    setOcupado(true);
    try {
      const j = (await chamar('compras/cotacao-forn/preencher', {
        method: 'POST',
        body: JSON.stringify({
          codctcforn: Number(cab.codctcforn),
          porEmpresa: sessao.validadoPorEmpresa,
          codoperador: sessao.codoperador,
          obs,
          itens: itens.map((i) => ({
            codctcfit: i.codctcfit,
            valor: Number(String(edit[i.codctcfit]?.valor ?? 0).replace(',', '.')) || 0,
            icms: Number(String(edit[i.codctcfit]?.icms ?? 0).replace(',', '.')) || 0,
            fatorembalagem: Number(String(edit[i.codctcfit]?.fator ?? 1).replace(',', '.')) || 1,
          })),
        }),
      })) as { itens: number };
      mensagem.sucesso(`${j.itens} item(ns) gravado(s).`);
      await abrir();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const mudar = (id: number, campo: 'valor' | 'icms' | 'fator', v: string) =>
    setEdit((e) => ({ ...e, [id]: { ...(e[id] ?? { valor: '0', icms: '0', fator: '1' }), [campo]: v } }));

  const cols = useMemo<DataTableColumnDef<Item>[]>(() => [
    { field: 'descricao', headerName: 'Produto', type: 'text', isPrimary: true },
    { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 130 },
    { field: 'unidade', headerName: 'Un.', type: 'text', width: 60 },
    { field: 'quantidade', headerName: 'Qtde pedida', type: 'text', width: 115, valueGetter: (i) => nfmt(i.quantidade) },
    {
      field: 'valor', headerName: 'Preço', type: 'text', width: 110, valueGetter: () => '',
      renderCell: ({ row: i }: { row: Item }) => (
        <input className="w-24 rounded border border-border px-1 text-right tabular-nums"
          value={edit[i.codctcfit]?.valor ?? ''} onChange={(e) => mudar(i.codctcfit, 'valor', e.target.value)} />
      ),
    } as DataTableColumnDef<Item>,
    {
      field: 'fatorembalagem', headerName: 'Fator embal.', type: 'text', width: 120, valueGetter: () => '',
      renderCell: ({ row: i }: { row: Item }) => (
        <input className="w-20 rounded border border-border px-1 text-right tabular-nums"
          value={edit[i.codctcfit]?.fator ?? ''} onChange={(e) => mudar(i.codctcfit, 'fator', e.target.value)} />
      ),
    } as DataTableColumnDef<Item>,
    {
      field: 'icms', headerName: 'ICMS %', type: 'text', width: 100, valueGetter: () => '',
      renderCell: ({ row: i }: { row: Item }) => (
        <input className="w-16 rounded border border-border px-1 text-right tabular-nums"
          value={edit[i.codctcfit]?.icms ?? ''} onChange={(e) => mudar(i.codctcfit, 'icms', e.target.value)} />
      ),
    } as DataTableColumnDef<Item>,
    { field: 'valortotal', headerName: 'Total gravado', type: 'text', width: 125, valueGetter: (i) => moeda(i.valortotal) },
    { field: 'ultimo_valor', headerName: 'Preço anterior', type: 'text', width: 125, valueGetter: (i) => (i.ultimo_valor == null ? '—' : moeda(i.ultimo_valor)) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [edit]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Preencher cotação" />

      {!sessao ? (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <p className="mb-form-gap text-body-sm text-fg-muted">
            Esta tela é preenchida <strong>pelo fornecedor</strong> na maior parte das vezes. Identifique-se
            para continuar.
          </p>
          <div className="flex flex-wrap items-end gap-gp-sm">
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Entrar como
              <select className="rounded border border-border px-1 py-1" value={login.comoParceiro ? 'F' : 'E'}
                onChange={(e) => setLogin({ ...login, comoParceiro: e.target.value === 'F' })}>
                <option value="F">Fornecedor</option>
                <option value="E">Operador da empresa</option>
              </select>
            </label>
            {login.comoParceiro
              ? <div className="w-40"><Field label="&Código do fornecedor" value={login.codparceiro} onChange={(e) => setLogin({ ...login, codparceiro: e.target.value })} /></div>
              : <div className="w-40"><Field label="&Login" value={login.login} onChange={(e) => setLogin({ ...login, login: e.target.value })} /></div>}
            <div className="w-40"><Field label="&Senha" type="password" value={login.senha} onChange={(e) => setLogin({ ...login, senha: e.target.value })} /></div>
            <Button label="&Entrar" disabled={ocupado} onClick={() => void entrar()} />
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-end gap-gp-sm">
              <div className="text-body-sm">
                <div className="text-fg-muted">Identificado como</div>
                <div className="text-body-lg">
                  {sessao.nome} <span className="text-fg-muted">({sessao.validadoPorEmpresa ? 'operador da empresa' : 'fornecedor'})</span>
                </div>
              </div>
              <div className="w-40"><Field label="Código da &cotação" value={codctcforn} onChange={(e) => setCodctcforn(e.target.value)} /></div>
              <Button label="&Abrir" disabled={ocupado || !codctcforn} onClick={() => void abrir()} />
              <Button label="&Trocar usuário" variant="soft" onClick={() => { setSessao(null); setCab(null); setItens([]); }} />
            </div>
          </section>

          {cab && (
            <>
              <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
                <div className="flex flex-wrap items-center gap-gp-lg text-body-sm">
                  <div><div className="text-fg-muted">Cotação</div><div className="text-body-lg">{cab.descricao ?? cab.codctc}</div></div>
                  <div><div className="text-fg-muted">Fornecedor</div><div className="text-body-lg">{cab.razao ?? cab.codparceiro}</div></div>
                  <div><div className="text-fg-muted">Itens</div><div className="text-body-lg tabular-nums">{itens.length}</div></div>
                  <div className="w-72"><Field label="&Observação" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
                  <Button label="&Gravar preços" disabled={ocupado || itens.length === 0} onClick={() => void gravar()} />
                </div>
                <p className="mt-form-gap text-body-sm text-fg-muted">
                  O <strong>total</strong> de cada item é o preço multiplicado pelo fator de embalagem. O
                  registro guarda de quem foi a mão: preenchido pelo fornecedor, o campo do operador fica em
                  branco.
                </p>
              </section>
              <DataTable rows={itens} columns={cols} getRowId={(i: Item) => String(i.codctcfit)} />
            </>
          )}
        </>
      )}
    </div>
  );
}
