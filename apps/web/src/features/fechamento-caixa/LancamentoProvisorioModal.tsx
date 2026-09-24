import { useEffect, useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import {
  excluirLinhaLancProv, gravarCabecalhoLancProv, inserirLinhaLancProv, lancamentoProvisorio,
  type LancamentoProvisorio, type TurnoRef,
} from './fechamentoCaixaApi';

/**
 * LANÇAMENTO PROVISÓRIO (`TfrmLanProv`, UlancProv.pas; BTNLANCPROV) — a ferramenta de suporte para acertar um turno à mão: o
 * cabeçalho do turno (fiscal de caixa, GT inicial/final, cancelamentos e descontos → venda bruta e líquida) e as modalidades,
 * cada uma gravada na hora como uma linha provisória da CX_VENDAS. "Efetivar lançamento" só confere a soma contra a venda líquida.
 */
const moeda = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
const txt = (v: number | null | undefined) => (v == null ? '' : String(v));

export function LancamentoProvisorioModal({ turno, onClose, onAlterou }: { turno: TurnoRef; onClose: () => void; onAlterou: () => void }) {
  const mensagem = useMensagem();
  const [d, setD] = useState<LancamentoProvisorio | null>(null);
  const [cab, setCab] = useState({ codfiscalcaixa: '', gtinicial: '', gtfinal: '', cancelamentos: '', descontos: '' });
  const [nova, setNova] = useState({ operacao: '', valor: '' });
  const [ocupado, setOcupado] = useState(false);

  const executar = async (f: () => Promise<void>) => {
    setOcupado(true);
    try { await f(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const recarregar = async () => {
    const r = await lancamentoProvisorio(turno);
    setD(r);
    setCab({
      codfiscalcaixa: txt(r.cabecalho?.codfiscalcaixa), gtinicial: txt(r.cabecalho?.gtinicial), gtfinal: txt(r.cabecalho?.gtfinal),
      cancelamentos: txt(r.cabecalho?.cancelamentos), descontos: txt(r.cabecalho?.descontos),
    });
  };
  useEffect(() => { void executar(recarregar); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vendab = n(cab.gtfinal) == null && n(cab.gtinicial) == null ? null : (n(cab.gtfinal) ?? 0) - (n(cab.gtinicial) ?? 0);
  const vendal = (vendab ?? 0) - (n(cab.descontos) ?? 0) - (n(cab.cancelamentos) ?? 0);
  const gravarCab = () => executar(async () => {
    await gravarCabecalhoLancProv(turno, {
      codfiscalcaixa: n(cab.codfiscalcaixa), gtinicial: n(cab.gtinicial), gtfinal: n(cab.gtfinal), cancelamentos: n(cab.cancelamentos), descontos: n(cab.descontos),
    });
    await recarregar();
    mensagem.sucesso('Cabeçalho gravado.');
  });
  const incluir = () => executar(async () => {
    const fiscal = n(cab.codfiscalcaixa);
    if (!fiscal) { mensagem.erro(new Error('Informe o fiscal de caixa.')); return; }
    await inserirLinhaLancProv(turno, { operacao: nova.operacao, valor: n(nova.valor) ?? 0, codfiscalcaixa: fiscal });
    setNova({ operacao: nova.operacao, valor: '' });
    await recarregar();
    onAlterou();
  });
  const remover = (cod: number) => executar(async () => {
    if (!window.confirm('Deseja remover está modalidade?')) return;
    await excluirLinhaLancProv(turno, cod);
    await recarregar();
    onAlterou();
  });
  // "Efetivar lançamento" (btnFechaClick): as linhas já foram gravadas; aqui só a conferência com a venda líquida
  const efetivar = () => {
    if (!d) return;
    if (Math.round(d.total * 100) !== Math.round(vendal * 100)) { mensagem.erro(new Error('Venda liquida diverge do total informado!')); return; }
    mensagem.sucesso('Registros gravados com sucesso!');
    onClose();
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Lançamento de caixa (provisório)" primaryAction={{ label: 'Efetivar lançamento', onClick: efetivar }}>
      <div className="flex flex-col gap-gp-sm">
        <div className="grid grid-cols-2 gap-gp-sm md:grid-cols-4">
          <Field label="Fiscal de caixa (código)" inputMode="numeric" value={cab.codfiscalcaixa} onChange={(e) => setCab({ ...cab, codfiscalcaixa: e.target.value })} />
          <small className="self-end text-fg-muted">{d?.cabecalho?.fiscal ?? ''}</small>
          <Field label="GT inicial" inputMode="decimal" value={cab.gtinicial} onChange={(e) => setCab({ ...cab, gtinicial: e.target.value })} />
          <Field label="GT final" inputMode="decimal" value={cab.gtfinal} onChange={(e) => setCab({ ...cab, gtfinal: e.target.value })} />
          <Field label="Cancelamentos" inputMode="decimal" value={cab.cancelamentos} onChange={(e) => setCab({ ...cab, cancelamentos: e.target.value })} />
          <Field label="Descontos" inputMode="decimal" value={cab.descontos} onChange={(e) => setCab({ ...cab, descontos: e.target.value })} />
          <small className="self-end">Venda bruta <strong className="tabular-nums">{moeda(vendab)}</strong></small>
          <small className="self-end">Venda líquida <strong className="tabular-nums">{moeda(vendal)}</strong></small>
        </div>
        <div className="flex justify-end"><Button label="Gravar cabeçalho" variant="soft" onClick={() => void gravarCab()} disabled={ocupado} /></div>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-56">
            <SelectField label="Modalidade" value={nova.operacao} onChange={(v) => setNova({ ...nova, operacao: v })} options={(d?.formas ?? []).map((f) => ({ value: f, label: f }))} />
          </div>
          <div className="w-36"><Field label="Valor" inputMode="decimal" value={nova.valor} onChange={(e) => setNova({ ...nova, valor: e.target.value })} /></div>
          <Button label="Incluir" onClick={() => void incluir()} disabled={ocupado || !nova.operacao} />
        </div>
        <div className="max-h-72 overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Modalidade</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-right">Sangria</th><th className="px-2 py-1 text-right">Suprimento</th><th className="px-2 py-1">Tipo</th><th className="px-2 py-1" /></tr></thead>
            <tbody>
              {(d?.linhas ?? []).map((l) => (
                <tr key={l.codcxvendas} className="border-t border-border">
                  <td className="px-2 py-1">{l.operacao}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{moeda(l.valor)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{moeda(l.sangrias)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{moeda(l.suprimentos)}</td>
                  <td className="px-2 py-1">{l.provisorio ? 'Provisório' : l.nropedido === '00000' ? 'Completado' : 'PDV'}</td>
                  <td className="px-2 py-1 text-right"><Button label="Remover" variant="ghost" onClick={() => void remover(l.codcxvendas)} disabled={ocupado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small>Total informado <strong className="tabular-nums">{moeda(d?.total)}</strong> · venda líquida <strong className="tabular-nums">{moeda(vendal)}</strong></small>
      </div>
    </Modal>
  );
}
