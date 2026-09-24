import { useMemo, useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { NfItemDto } from '@apollo/shared';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { listarCuponsDisponiveis, previaVendasNf, type CupomDisponivel, type PreviaVendasNf } from './nfVendasApi';

/**
 * IMPORTAR VENDAS — a NF de cupom (`ImportaVenda`, uNF.pas:13201): a pesquisa dos cupons do período (verde = já
 * importado), a prévia (itens da venda com os descontos e a alíquota do PDV, NFC-e referenciadas, cupons ECF na OBS)
 * e, se algum já foi importado, a senha administrativa. O vínculo (VENDAS.IMPORTADO) acontece no GRAVAR da nota.
 */
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Date().toISOString().slice(0, 10);

interface Props {
  onFechar: () => void;
  onConfirmar: (r: { previa: PreviaVendasNf; senhaAdm?: string }) => void;
}

export function NfVendasModal({ onFechar, onConfirmar }: Props) {
  const mensagem = useMensagem();
  const [ini, setIni] = useState(hoje());
  const [fim, setFim] = useState(hoje());
  const [nrocupom, setNrocupom] = useState('');
  const [lista, setLista] = useState<CupomDisponivel[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [previa, setPrevia] = useState<PreviaVendasNf | null>(null);
  const [senhaAdm, setSenhaAdm] = useState('');
  const [carregando, setCarregando] = useState(false);

  const algumImportado = useMemo(() => lista.some((c) => marcados.has(c.codvendas) && c.importado === 'S'), [lista, marcados]);

  const pesquisar = async () => {
    setCarregando(true);
    try {
      setLista(await listarCuponsDisponiveis({ data_ini: ini, data_fim: fim, nrocupom: nrocupom || undefined }));
      setMarcados(new Set());
      setPrevia(null);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  };

  const alternar = (cod: number, v: 'S' | 'N') => {
    setPrevia(null);
    setMarcados((s) => { const n = new Set(s); if (v === 'S') n.add(cod); else n.delete(cod); return n; });
  };

  const calcular = async () => {
    if (!marcados.size) { mensagem.erro('Selecione ao menos um cupom.'); return; }
    setCarregando(true);
    try {
      const r = await previaVendasNf({ codvendas: Array.from(marcados), ...(algumImportado && senhaAdm ? { senhaAdm } : {}) });
      setPrevia(r);
      if (r.naoProcessados.length) mensagem.erro(`Cupom(ns) ${r.naoProcessados.join(', ')} com NFC-e ainda não processada ficaram de fora.`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title="Importar vendas (NF de cupom)"
      primaryAction={{ label: 'Incluir na nota', onClick: () => previa && onConfirmar({ previa, senhaAdm: previa.reimportados.length ? senhaAdm : undefined }), disabled: !previa || !previa.itens.length }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><DateField label="&De" value={ini} onChange={(v) => setIni(v ?? hoje())} /></div>
          <div className="w-40"><DateField label="&Até" value={fim} onChange={(v) => setFim(v ?? hoje())} /></div>
          <div className="w-32"><Field label="&Cupom" inputMode="numeric" value={nrocupom} onChange={(e) => setNrocupom(e.target.value.replace(/\D/g, ''))} /></div>
          <Button label="&Pesquisar" variant="soft" onClick={() => void pesquisar()} disabled={carregando} />
        </div>
        {lista.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-md border border-border p-gp-xs">
            {lista.map((c) => (
              <div key={c.codvendas} className="flex items-center justify-between gap-gp-sm py-0.5">
                <CheckboxField
                  label={`Cupom ${c.nrocupom} — ${c.dtvenda ? new Date(c.dtvenda).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : ''} · ${c.razao ?? 'sem cliente'} · ${fmtBRL(Number(c.total) || 0)}${c.venda_nfc === 'S' ? ' · NFC-e' : ''}`}
                  value={marcados.has(c.codvendas) ? 'S' : 'N'}
                  onChange={(v) => alternar(c.codvendas, v)}
                />
                {c.importado === 'S'
                  ? <small className="text-fg-success">Importado</small>
                  : c.venda_nfc === 'S' && c.statusnfe !== 'P' ? <small className="text-fg-danger">NFC-e não processada</small> : null}
              </div>
            ))}
          </div>
        )}
        {algumImportado && (
          <div className="flex flex-col gap-gp-xs rounded-md border border-border p-gp-sm">
            <small className="text-fg-danger">Há cupom já importado em outra nota. Para continuar, informe a senha administrativa.</small>
            <div className="w-48"><Field label="Senha &administrativa" type="password" value={senhaAdm} onChange={(e) => setSenhaAdm(e.target.value)} autoComplete="off" /></div>
          </div>
        )}
        <div className="flex flex-wrap gap-gp-sm">
          <Button label="C&alcular itens" variant="soft" onClick={() => void calcular()} disabled={carregando || !marcados.size} />
        </div>
        {previa && (
          <div className="flex flex-col gap-gp-xs">
            <small>
              CFOP <strong>{previa.cfop}</strong> · {previa.itens.length} item(ns) · {previa.referencias.length} NFC-e referenciada(s)
              {previa.obs && <> · {previa.obs}</>}
            </small>
            <div className="max-h-56 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Qtde</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-right">Desconto</th><th className="px-2 py-1">Alíq.</th><th className="px-2 py-1">CST</th></tr></thead>
                <tbody>
                  {previa.itens.map((it: NfItemDto, i) => (
                    <tr key={`${it.codproduto}-${i}`} className="border-t border-border">
                      <td className="px-2 py-1">{it.codproduto} — {it.codprodnota ?? ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtQ(Number(it.quantidade) || 0)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(Number(it.vrcusto) || 0)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(Number(it.vrdescprod) || 0)}</td>
                      <td className="px-2 py-1">{it.aliquota}</td>
                      <td className="px-2 py-1">{it.cst}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
