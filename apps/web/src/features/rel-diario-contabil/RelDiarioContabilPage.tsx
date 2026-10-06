import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { hojeNaLoja } from '../../shared/tempo';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';

/**
 * LIVRO DIÁRIO (`FRMRELDIARIOCONTABIL`). Dossiê: `uRelDiarioContabil.md`.
 * Cada lançamento em duas linhas — débito e crédito — com conta, histórico, origem e documento; das lojas escolhidas. Como no legado,
 * duas linhas iguais em tudo saem uma vez só (o UNION do SQL). O legado só imprime (LivroDiarioContabil.fr3); a grade é a prévia.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => hojeNaLoja();
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

interface Linha { dia: string; conta: string | null; codigoconta: number | null; descricao: string | null; historico: string; origem: number | null; nome_origem: string | null; idorigem: number | null; documento: string | null; debito: number; credito: number }
interface Resultado { periodo: { de: string; ate: string }; contabilista: { nome: string; cpf: string | null; crc: string | null } | null; linhas: Linha[]; totais: { linhas: number; debito: number; credito: number; diferenca: number } }

export function RelDiarioContabilPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), pagina: '1', empresas: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const params = () => {
    const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, pagina: f.pagina || '1' });
    if (f.empresas.trim()) q.set('empresas', f.empresas.replace(/\s/g, ''));
    return q;
  };
  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/contabil/diario?${params()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { setRes(null); mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Livro Diário" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Os lançamentos do período, cada um em duas linhas: a conta debitada e a creditada, com o histórico, a origem e o documento.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-28"><Field label="&Página inicial" value={f.pagina} onChange={(e) => setF({ ...f, pagina: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-40"><Field label="&Lojas (vírgula)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={() => {
            void imprimirRelatorio(`/contabil/diario/impressao?${params().toString()}`).catch((e) => mensagem.erro(e));
          }} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>{dataBr(res.periodo.de)} a {dataBr(res.periodo.ate)}</span>
              <span>Linhas <strong className="tabular-nums">{res.totais.linhas}</strong></span>
              <span>Débito <strong className="tabular-nums">{moeda(res.totais.debito)}</strong></span>
              <span>Crédito <strong className="tabular-nums">{moeda(res.totais.credito)}</strong></span>
              <span className={Math.abs(res.totais.diferenca) > 0.01 ? 'font-semibold text-fg-danger' : ''}>Diferença <strong className="tabular-nums">{moeda(res.totais.diferenca)}</strong></span>
            </div>
            {res.contabilista && <p className="mt-form-gap text-body-sm text-fg-muted">Contabilista: {res.contabilista.nome}{res.contabilista.crc ? ` · CRC ${res.contabilista.crc}` : ''}{res.contabilista.cpf ? ` · CPF ${res.contabilista.cpf}` : ''}</p>}
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[1100px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Dia</th><th className="p-pad-xs">Conta</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Histórico</th>
                <th className="p-pad-xs">Origem</th><th className="p-pad-xs">Documento</th><th className="p-pad-xs text-right">Débito</th><th className="p-pad-xs text-right">Crédito</th>
              </tr></thead>
              <tbody>{res.linhas.map((l, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="p-pad-xs">{dataBr(l.dia)}</td><td className="p-pad-xs tabular-nums">{l.conta ?? ''}</td>
                  <td className="p-pad-xs">{l.descricao ?? ''}</td><td className="max-w-[22rem] truncate p-pad-xs text-fg-muted">{l.historico}</td>
                  <td className="p-pad-xs">{l.nome_origem ?? (l.origem == null ? '' : String(l.origem))}</td>
                  <td className="p-pad-xs tabular-nums">{l.documento ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.debito ? moeda(l.debito) : ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.credito ? moeda(l.credito) : ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
