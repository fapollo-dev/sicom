import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const mesAtual = () => {
  const d = new Date();
  const ini = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { ini, fim: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, '0')}-${String(u.getDate()).padStart(2, '0')}` };
};
type Linha = Record<string, unknown>;

/**
 * REGISTRO DE ENTRADAS / REGISTRO DE SAÍDAS (FRMRELREGISTROS_ES pelos menus 186 e 187) — as notas do período pela data contábil e,
 * de cada uma, o resultado por CFOP, CST e alíquota ([F2] "Resultado da Nota"); [F4] abre a nota para alterar; [F11] imprime o livro
 * no layout do cliente com o número do livro e a folha.
 */
export function RegistroEsPage({ tipo }: { tipo: 'E' | 'S' }) {
  const mensagem = useMensagem();
  const m = mesAtual();
  const [dataini, setDataini] = useState<string | undefined>(m.ini);
  const [datafin, setDatafin] = useState<string | undefined>(m.fim);
  const [livro, setLivro] = useState('');
  const [folha, setFolha] = useState('');
  const [notas, setNotas] = useState<Linha[]>([]);
  const [detalhe, setDetalhe] = useState<Linha[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [resumo, setResumo] = useState(false);
  const [busy, setBusy] = useState(false);
  const titulo = tipo === 'E' ? 'Registro de Entradas' : 'Registro de Saídas';

  const consultar = async () => {
    if (busy) return;
    if (!dataini || !datafin) { window.alert('Informe o período.'); return; }
    setBusy(true);
    try {
      const r = await req<{ notas: Linha[]; detalhe: Linha[] }>('/fiscal/registro-es/consultar', { tipo, dataini, datafin });
      setNotas(r.notas); setDetalhe(r.detalhe); setSel(r.notas[0] ? String(r.notas[0].codigo) : null);
      if (!r.notas.length) mensagem.sucesso('Nenhuma nota no período.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const imprimir = async () => {
    if (!dataini || !datafin) { window.alert('Informe o período.'); return; }
    const q = new URLSearchParams({ tipo, dataini, datafin, livro: livro.trim() || '1', folha: folha.trim() || '1' });
    try { await imprimirRelatorio(`/fiscal/registro-es/impressao?${q.toString()}`); } catch (e) { mensagem.erro(e); }
  };

  /** [F4] - Altera Nota Fiscal: só para nota ("Recurso apenas para Notas Fiscais."); ao voltar, a consulta é refeita */
  const alterarNota = () => {
    const n = notas.find((x) => String(x.codigo) === sel);
    if (!n) return;
    if (n.especie !== 'NF') { window.alert('Recurso apenas para Notas Fiscais.'); return; }
    const cod = String(n.codigo).replace('NF', '');
    window.open(`/fiscal/notas/${tipo === 'S' ? 'saida' : 'entrada'}?codigo=${cod}`, '_blank');
  };

  const exportar = () => exportarGradeCsv(notas, [
    { titulo: 'Data Chegada', valor: (l) => dia(l.dtchegada) }, { titulo: 'Número NF', valor: (l) => l.nronf },
    { titulo: 'Razão', valor: (l) => l.razao }, { titulo: 'Total', valor: (l) => brl(l.total) }, { titulo: 'UF', valor: (l) => l.uf },
    { titulo: 'Série', valor: (l) => l.serie }, { titulo: 'Data Emissão', valor: (l) => dia(l.dtemissao) },
    { titulo: 'Espécie', valor: (l) => l.especie }, { titulo: 'Código', valor: (l) => l.codigo }, { titulo: 'Código parceiro', valor: (l) => l.codparceiro },
  ], titulo.toLowerCase().replace(/ /g, '-'));

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'F2' && sel) { e.preventDefault(); setResumo(true); }
      else if (e.key === 'F4' && sel) { e.preventDefault(); alterarNota(); }
      else if (e.key === 'F11') { e.preventDefault(); void imprimir(); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const doSel = detalhe.filter((d) => String(d.codigo) === sel);
  const total = notas.reduce((s, n) => s + Number(n.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title={titulo} />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-44"><DateField label="Data &inicial" value={dataini} onChange={setDataini} /></div>
        <div className="w-44"><DateField label="Data &final" value={datafin} onChange={setDatafin} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <div className="w-24"><Field label="Nrº Livro" value={livro} inputMode="numeric" onChange={(e) => setLivro(e.target.value.replace(/\D/g, ''))} /></div>
        <div className="w-24"><Field label="Nrº F&olha" value={folha} inputMode="numeric" onChange={(e) => setFolha(e.target.value.replace(/\D/g, ''))} /></div>
        <Button label="&Imprimir livro (F11)" variant="ghost" disabled={busy} onClick={() => void imprimir()} />
        <Button label="&Exportar" variant="ghost" disabled={!notas.length} onClick={exportar} />
        <small className="w-full text-fg-muted">[F2] - Visualiza Resumo da nota &nbsp; [F4] - Altera Nota Fiscal</small>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead><tr className="text-left text-fg-muted">
            <th className="p-pad-xs">Data Chegada</th><th className="p-pad-xs text-right">Número NF</th><th className="p-pad-xs">Razão</th>
            <th className="p-pad-xs text-right">Total</th><th className="p-pad-xs">UF</th><th className="p-pad-xs">Série</th>
            <th className="p-pad-xs">Data Emissão</th><th className="p-pad-xs">Espécie</th><th className="p-pad-xs">Código</th>
            <th className="p-pad-xs text-right">Código parceiro</th>
          </tr></thead>
          <tbody>
            {notas.map((n) => (
              <tr key={String(n.codigo)} onClick={() => setSel(String(n.codigo))} onDoubleClick={() => { setSel(String(n.codigo)); setResumo(true); }}
                className={`cursor-pointer border-t border-border ${sel === String(n.codigo) ? 'bg-bg-subtle' : ''}`}>
                <td className="p-pad-xs tabular-nums">{dia(n.dtchegada)}</td>
                <td className="p-pad-xs text-right tabular-nums">{String(n.nronf ?? '')}</td>
                <td className="p-pad-xs">{String(n.razao ?? '')}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(n.total)}</td>
                <td className="p-pad-xs">{String(n.uf ?? '')}</td>
                <td className="p-pad-xs">{String(n.serie ?? '')}</td>
                <td className="p-pad-xs tabular-nums">{dia(n.dtemissao)}</td>
                <td className="p-pad-xs">{String(n.especie ?? '')}</td>
                <td className="p-pad-xs">{String(n.codigo ?? '')}</td>
                <td className="p-pad-xs text-right tabular-nums">{String(n.codparceiro ?? '')}</td>
              </tr>
            ))}
            {!notas.length && <tr><td colSpan={10} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
          {!!notas.length && (
            <tfoot><tr className="border-t border-border font-semibold">
              <td className="p-pad-xs" colSpan={3}>{notas.length} nota(s)</td>
              <td className="p-pad-xs text-right tabular-nums">{brl(total)}</td><td colSpan={6} />
            </tr></tfoot>
          )}
        </table>
      </div>

      {resumo && sel && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex items-center justify-between">
            <div className="text-title-sm font-semibold">Resultado da Nota {sel}</div>
            <Button label="&OK" variant="soft" onClick={() => setResumo(false)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead><tr className="text-left text-fg-muted">
                <th className="p-pad-xs">CFOP</th><th className="p-pad-xs text-right">Aliq. ICMS</th><th className="p-pad-xs">CST</th>
                <th className="p-pad-xs text-right">ICMS efetivo</th><th className="p-pad-xs text-right">Base de Calculo</th>
                <th className="p-pad-xs text-right">Valor ICMS</th><th className="p-pad-xs text-right">Isentas e Nao Trib.</th>
                <th className="p-pad-xs text-right">Outras</th>
              </tr></thead>
              <tbody>
                {doSel.map((d, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-pad-xs tabular-nums">{String(d.cfop ?? '')}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(d.icms)}</td>
                    <td className="p-pad-xs">{String(d.cst ?? '')}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(d.icms_efetivo)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(d.base)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(d.valor_icms)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(d.isentas_naotrib)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(d.outras)}</td>
                  </tr>
                ))}
                {!doSel.length && <tr><td colSpan={8} className="p-pad-md text-fg-muted">A nota não tem itens.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
