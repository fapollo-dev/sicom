import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import {
  isErroResposta, LAYOUTS_REMESSA, PLACEHOLDERS_BOLETO, TIPOS_INTEG_BANCARIA,
  type ConfIntegBancariaDto, type ErroResposta,
} from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONFIGURAÇÃO DA INTEGRAÇÃO BANCÁRIA — BOLETO (`FRMCONFINTEGBANCARIA`).
 *
 * O que o CNAB de cobrança lê para montar a remessa. A tela avisa sobre as duas coisas que enganam: o
 * sequencial é **estado** (baixá-lo faz o banco rejeitar a remessa) e o código do banco tem **dois** números
 * diferentes — o interno e o FEBRABAN.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cobranca/conf-integ-bancaria';

interface Conf extends ConfIntegBancariaDto { codconf: number; nome_banco?: string; nome_empresa?: string }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: res.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const vazia = (): ConfIntegBancariaDto => ({
  codempresa: 1, codbco: 0, agencia: '', nrconta: '', codfornbco: '', arqteste: 'N',
  layoutremessa: 'C400', codempresa_arquivo: null, dias_baixa_boleto: null, tipo_integ_bancaria: 'B',
  identempresabco: '', sequenciaremessa: 0, obs_boleto: '', iniciais_arquivo: '',
  nosso_numero_inicial: null, habilitar_bolecode: 'N',
});

export function ConfIntegBancariaPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Conf[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [form, setForm] = useState<ConfIntegBancariaDto | null>(null);
  const [seqOriginal, setSeqOriginal] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try { setLista(await req<Conf[]>(P)); } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); }, [carregar]);

  const abrir = (c: Conf | null) => {
    setEditando(c?.codconf ?? null);
    setSeqOriginal(c ? Number(c.sequenciaremessa) : null);
    setForm(c ? { ...c } : vazia());
  };

  const salvar = async () => {
    if (!form) return;
    setOcupado(true);
    try {
      if (editando == null) await req(P, { method: 'POST', body: JSON.stringify(form) });
      else await req(`${P}/${editando}`, { method: 'PUT', body: JSON.stringify(form) });
      mensagem.sucesso('Configuração gravada.');
      setForm(null); setEditando(null); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const excluir = async (c: Conf) => {
    setOcupado(true);
    try { await req(`${P}/${c.codconf}`, { method: 'DELETE' }); mensagem.sucesso('Excluída.'); await carregar(); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const seqBaixou = form != null && seqOriginal != null && Number(form.sequenciaremessa) < seqOriginal;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Configuração da integração bancária (boleto)" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          É daqui que o CNAB de cobrança tira banco, conta, layout e convênio para montar a remessa.
        </p>
        <Button label="&Nova configuração" onClick={() => abrir(null)} />
      </section>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[840px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Empresa</th><th className="p-pad-xs">Banco</th>
              <th className="p-pad-xs">Agência / Conta</th><th className="p-pad-xs">Layout</th>
              <th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Seq. remessa</th>
              <th className="p-pad-xs">Bolecode</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.codconf} className="border-b border-border">
                <td className="p-pad-xs">{c.nome_empresa ?? c.codempresa}</td>
                <td className="p-pad-xs">{c.nome_banco ?? c.codbco} <span className="text-fg-muted">({c.codfornbco})</span></td>
                <td className="p-pad-xs font-mono">{c.agencia} / {c.nrconta}</td>
                <td className="p-pad-xs">{c.layoutremessa}</td>
                <td className="p-pad-xs">{c.tipo_integ_bancaria === 'B' ? 'Boleto' : 'Pagamento'}</td>
                <td className="p-pad-xs tabular-nums">{c.sequenciaremessa}</td>
                <td className="p-pad-xs">{c.habilitar_bolecode}</td>
                <td className="p-pad-xs">
                  <span className="flex gap-gp-xs">
                    <Button variant="outline" label="Editar" onClick={() => abrir(c)} />
                    <Button variant="outline" label="Excluir" disabled={ocupado} onClick={() => void excluir(c)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="text-title-sm">{editando == null ? 'Nova configuração' : `Configuração ${editando}`}</h2>

          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-32"><Field label="&Empresa" type="number" value={String(form.codempresa)} onChange={(e) => setForm({ ...form, codempresa: Number(e.target.value || 0) })} /></div>
            <div className="w-32"><Field label="&Banco (interno)" type="number" value={String(form.codbco)} onChange={(e) => setForm({ ...form, codbco: Number(e.target.value || 0) })} /></div>
            <div className="w-40"><Field label="Cód. &FEBRABAN" value={form.codfornbco ?? ''} onChange={(e) => setForm({ ...form, codfornbco: e.target.value })} /></div>
            <div className="w-32"><Field label="&Agência" value={form.agencia ?? ''} onChange={(e) => setForm({ ...form, agencia: e.target.value })} /></div>
            <div className="w-36"><Field label="&Conta" value={form.nrconta ?? ''} onChange={(e) => setForm({ ...form, nrconta: e.target.value })} /></div>
          </div>
          <p className="text-body-sm text-fg-muted">
            ⚠️ São <strong>dois números diferentes</strong> para o mesmo banco: o <em>interno</em> (o código do
            cadastro de bancos) e o <em>FEBRABAN</em> (341 Itaú, 001 BB). Trocá-los gera remessa que o banco não lê.
          </p>

          <div className="flex flex-wrap items-end gap-gp-sm">
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Layout da remessa
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.layoutremessa} onChange={(e) => setForm({ ...form, layoutremessa: e.target.value as ConfIntegBancariaDto['layoutremessa'] })}>
                {LAYOUTS_REMESSA.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Tipo de integração
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.tipo_integ_bancaria} onChange={(e) => setForm({ ...form, tipo_integ_bancaria: e.target.value as ConfIntegBancariaDto['tipo_integ_bancaria'] })}>
                {TIPOS_INTEG_BANCARIA.map((t) => <option key={t} value={t}>{t === 'B' ? 'Boleto' : 'Pagamento (a pagar)'}</option>)}
              </select>
            </label>
            <div className="w-44"><Field label="Cód. da empresa no ban&co" value={form.identempresabco ?? ''} onChange={(e) => setForm({ ...form, identempresabco: e.target.value })} /></div>
            <div className="w-36"><Field label="Empresa do ar&quivo" type="number" value={String(form.codempresa_arquivo ?? '')} onChange={(e) => setForm({ ...form, codempresa_arquivo: e.target.value ? Number(e.target.value) : null })} /></div>
            <div className="w-40"><Field label="&Dias p/ baixa do boleto" type="number" value={String(form.dias_baixa_boleto ?? '')} onChange={(e) => setForm({ ...form, dias_baixa_boleto: e.target.value ? Number(e.target.value) : null })} /></div>
            <div className="w-32"><Field label="&Iniciais do arquivo" value={form.iniciais_arquivo ?? ''} onChange={(e) => setForm({ ...form, iniciais_arquivo: e.target.value })} /></div>
            <div className="w-40"><Field label="&Nosso número inicial" type="number" value={String(form.nosso_numero_inicial ?? '')} onChange={(e) => setForm({ ...form, nosso_numero_inicial: e.target.value ? Number(e.target.value) : null })} /></div>
          </div>

          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-40">
              <Field label="&Sequência da remessa" type="number" value={String(form.sequenciaremessa)}
                onChange={(e) => setForm({ ...form, sequenciaremessa: Number(e.target.value || 0) })} />
            </div>
            <label className="flex items-center gap-gp-xs text-body-sm">
              <input type="checkbox" checked={form.arqteste === 'S'} onChange={(e) => setForm({ ...form, arqteste: e.target.checked ? 'S' : 'N' })} />
              Arquivo de teste (homologação bancária)
            </label>
            <label className="flex items-center gap-gp-xs text-body-sm">
              <input type="checkbox" checked={form.habilitar_bolecode === 'S'} onChange={(e) => setForm({ ...form, habilitar_bolecode: e.target.checked ? 'S' : 'N' })} />
              Habilitar bolecode
            </label>
          </div>
          {seqBaixou && (
            <p className="text-body-sm text-fg-danger">
              ⚠️ A sequência é <strong>estado</strong>: o sistema a incrementa a cada remessa. Baixá-la de{' '}
              {seqOriginal} para {String(form.sequenciaremessa)} faz o banco receber dois arquivos com o mesmo
              sequencial — e rejeitar a remessa.
            </p>
          )}

          <div>
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Texto impresso no boleto
              <textarea className="min-h-24 rounded-radius-sm border border-border bg-bg-base p-pad-sm font-mono text-body-sm"
                value={form.obs_boleto ?? ''} onChange={(e) => setForm({ ...form, obs_boleto: e.target.value })} />
            </label>
            <p className="mt-gp-xs text-body-sm text-fg-muted">
              Aceita {PLACEHOLDERS_BOLETO.map((p) => <code key={p} className="mr-1">{p}</code>)} — o gerador
              substitui pelos valores do título.
            </p>
          </div>

          <div className="flex gap-gp-sm">
            <Button label="&Gravar" disabled={ocupado || !form.codbco || !form.codempresa} onClick={() => void salvar()} />
            <Button variant="outline" label="&Cancelar" onClick={() => { setForm(null); setEditando(null); }} />
          </div>
        </section>
      )}
    </div>
  );
}
