import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { isErroResposta, transferenciasPermitidasSchema, type ErroResposta } from '@apollo/shared';

/**
 * TRANSFERÊNCIAS PERMITIDAS a partir desta conta (`CONTAS_BANC_TRANSF_PERM`, mig 295).
 *
 * A regra saiu do dado do cliente: com ao menos um destino ATIVO, a conta **só** transfere para a lista; sem
 * nenhum, fica livre. A tela diz em qual dos dois estados a conta está, porque a diferença entre "livre" e
 * "restrita a nada" é uma linha só.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type Destino = { codconta_destino: number; ativo: 'S' | 'N'; titular?: string | null; nroconta?: string | null };

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...apiHeaders(), 'Content-Type': 'application/json' } });
  handle401(r);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return (await r.json()) as T;
}

export function TransferenciasPermitidas({ codconta, editavel }: { codconta: number | null; editavel: boolean }) {
  const mensagem = useMensagem();
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [novo, setNovo] = useState('');
  const [sujo, setSujo] = useState(false);
  const { data: contas = [] } = useResourceOptions('cadastro/contas-bancarias', (c: any) => ({
    value: String(c.codconta),
    label: `${c.codconta} - ${c.titular ?? ''}${c.nroconta ? ` (${c.nroconta})` : ''}`,
  }));

  useEffect(() => {
    setSujo(false);
    if (codconta == null) { setDestinos([]); return; }
    pedir<{ destinos: Destino[] }>(`${BASE}/cadastro/contas-bancarias/${codconta}/transferencias-permitidas`)
      .then((r) => setDestinos(r.destinos))
      .catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codconta]);

  if (codconta == null) {
    return <p className="text-body-sm text-fg-muted">Grave a conta para definir para onde ela pode transferir.</p>;
  }

  const restrita = destinos.some((d) => d.ativo === 'S');
  const rotulo = (cod: number) => contas.find((c) => Number(c.value) === cod)?.label ?? String(cod);
  const incluir = () => {
    const cod = Number(novo);
    if (!cod || destinos.some((d) => d.codconta_destino === cod)) return;
    setDestinos((l) => [...l, { codconta_destino: cod, ativo: 'S' }]);
    setNovo('');
    setSujo(true);
  };
  const gravar = async () => {
    const dto = transferenciasPermitidasSchema.safeParse({ destinos: destinos.map(({ codconta_destino, ativo }) => ({ codconta_destino, ativo })) });
    if (!dto.success) { mensagem.erro(new Error(dto.error.issues[0]?.message ?? 'lista inválida')); return; }
    try {
      const r = await pedir<{ destinos: Destino[] }>(`${BASE}/cadastro/contas-bancarias/${codconta}/transferencias-permitidas`, {
        method: 'PUT', body: JSON.stringify(dto.data),
      });
      setDestinos(r.destinos);
      setSujo(false);
      mensagem.sucesso('Transferências permitidas gravadas.');
    } catch (e) { mensagem.erro(e); }
  };
  const sel = 'rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-0.5 text-body-sm disabled:opacity-60';

  return (
    <div className="flex flex-col gap-gp-sm">
      <p className={`text-body-sm ${restrita ? 'font-semibold' : 'text-fg-muted'}`}>
        {restrita
          ? `Esta conta só transfere para ${destinos.filter((d) => d.ativo === 'S').length === 1 ? 'a conta abaixo' : 'as contas abaixo'}.`
          : 'Sem destino ativo: esta conta transfere para qualquer conta da empresa.'}
      </p>
      {destinos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-body-sm">
            <thead><tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Conta de destino</th><th className="w-24 p-pad-xs">Ativo</th><th className="w-10 p-pad-xs" />
            </tr></thead>
            <tbody>{destinos.map((d, i) => (
              <tr key={d.codconta_destino} className="border-b border-border">
                <td className="p-pad-xs">{rotulo(d.codconta_destino)}</td>
                <td className="p-pad-xs">
                  <select className={sel} disabled={!editavel} value={d.ativo} aria-label="Ativo"
                    onChange={(e) => { const v = e.target.value as 'S' | 'N'; setDestinos((l) => l.map((x, n) => (n === i ? { ...x, ativo: v } : x))); setSujo(true); }}>
                    <option value="S">Sim</option><option value="N">Não</option>
                  </select>
                </td>
                <td className="p-pad-xs text-right">
                  {editavel && <button type="button" className="text-fg-danger" aria-label="Remover destino"
                    onClick={() => { setDestinos((l) => l.filter((_x, n) => n !== i)); setSujo(true); }}>×</button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {editavel && (
        <div className="flex flex-wrap items-center gap-gp-sm">
          <select className={sel} value={novo} onChange={(e) => setNovo(e.target.value)} aria-label="Conta de destino">
            <option value="">Escolha a conta de destino…</option>
            {contas.filter((c) => Number(c.value) !== codconta && !destinos.some((d) => d.codconta_destino === Number(c.value)))
              .map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <Button label="Incluir &destino" onClick={incluir} disabled={!novo} />
          <Button label="Gravar transferê&ncias" onClick={() => void gravar()} disabled={!sujo} />
        </div>
      )}
    </div>
  );
}
