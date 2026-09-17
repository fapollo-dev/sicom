import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, mascaraVisivel, NIVEIS_PLANO, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONFIGURAÇÕES DO PLANO DE CONTAS (`FRMCADCONFPLANOCONTAS`).
 *
 * Duas coisas: a **máscara** — quantos dígitos cada nível do código tem — e as **contas padrão** por natureza
 * de parceiro, que quem não tem conta própria herda na hora de contabilizar.
 *
 * A tela mostra, ao lado da máscara, **quantas contas do plano já usam cada formato**: é o que diz se a
 * máscara está certa. Foi assim que se descobriu que o número guardado estava errado.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cadastro/conf-plano-contas';

const NATUREZAS = [
  { pre: 'for', rotulo: 'Fornecedores' },
  { pre: 'cli', rotulo: 'Clientes' },
  { pre: 'cxa', rotulo: 'Caixa' },
  { pre: 'bco', rotulo: 'Bancos' },
] as const;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: res.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return (await res.json()) as T;
}

interface Cfg {
  tipo: string; mascara: string; descricao: string | null; niveis: number[];
  contas: Array<{ codplanocontas: number; descricao: string; classe: string }>;
  formatos: Array<{ digitos: number; n: number }>;
  [k: string]: unknown;
}

export function ConfPlanoContasPage() {
  const mensagem = useMensagem();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [niveis, setNiveis] = useState<number[]>([]);
  const [contas, setContas] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const c = await req<Cfg>(P);
      setCfg(c); setNiveis(c.niveis ?? []);
      const m: Record<string, string> = {};
      for (const n of NATUREZAS) for (const t of ['sintetica', 'analitica']) {
        const k = `codconta${t}_${n.pre}`;
        m[k] = c[k] == null ? '' : String(c[k]);
      }
      setContas(m);
    } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async () => {
    setOcupado(true);
    try {
      const corpo: Record<string, unknown> = { tipo: cfg?.tipo ?? 'E', niveis, descricao: cfg?.descricao ?? null };
      for (const [k, v] of Object.entries(contas)) corpo[k] = v === '' ? null : Number(v);
      await req(P, { method: 'PUT', body: JSON.stringify(corpo) });
      mensagem.sucesso('Configuração gravada.');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const desc = (cod: string) => cfg?.contas.find((c) => String(c.codplanocontas) === cod)?.descricao ?? '';

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Configurações do plano de contas" />

      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <h2 className="text-title-sm">Níveis do plano de contas</h2>
        <p className="text-body-sm text-fg-muted">
          Quantos dígitos cada nível tem. A máscara <strong>sugere</strong> o próximo código — ela não valida o
          que já existe, porque o plano tem contas de formatos diferentes de épocas diferentes.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          {Array.from({ length: NIVEIS_PLANO }, (_, i) => (
            <div key={i} className="w-20">
              <Field label={`${i + 1}º`} type="number" value={String(niveis[i] ?? '')}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  const n = [...niveis];
                  if (v == null) n.length = i; else n[i] = v;
                  setNiveis(n.filter((x, j) => j < i || x != null));
                }} />
            </div>
          ))}
        </div>
        <p className="text-body-sm">
          Máscara: <code className="font-mono">{mascaraVisivel(niveis)}</code>
        </p>
        {(cfg?.formatos ?? []).length > 0 && (
          <p className="text-body-sm text-fg-muted">
            No plano de hoje, o último nível aparece assim:{' '}
            {(cfg?.formatos ?? []).map((f) => (
              <span key={f.digitos} className="mr-gp-sm">
                <strong>{f.n.toLocaleString('pt-BR')}</strong> conta(s) com {f.digitos} dígitos
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <h2 className="text-title-sm">Contas padrão</h2>
        <p className="text-body-sm text-fg-muted">
          Quem não tem conta própria herda a <strong>analítica</strong> daqui na hora de contabilizar — são as
          contas &ldquo;diversos&rdquo;. ⚠️ a analítica é a que recebe lançamento: uma conta sintética aqui faria a
          contabilização falhar depois.
        </p>
        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Natureza</th><th className="p-pad-xs">Conta sintética</th><th className="p-pad-xs">Conta analítica</th>
            </tr>
          </thead>
          <tbody>
            {NATUREZAS.map((n) => (
              <tr key={n.pre} className="border-b border-border">
                <td className="p-pad-xs">{n.rotulo}</td>
                {(['sintetica', 'analitica'] as const).map((t) => {
                  const k = `codconta${t}_${n.pre}`;
                  return (
                    <td key={k} className="p-pad-xs">
                      <input className="h-8 w-28 rounded-radius-sm border border-border bg-bg-base px-pad-xs" type="number"
                        value={contas[k] ?? ''} onChange={(e) => setContas({ ...contas, [k]: e.target.value })} />
                      <span className="ml-gp-xs text-fg-muted">{desc(contas[k] ?? '')}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex gap-gp-sm">
        <Button label="&Gravar" disabled={ocupado || niveis.length === 0} onClick={() => void salvar()} />
        <Button variant="outline" label="&Desfazer" onClick={() => void carregar()} />
      </div>
    </div>
  );
}
