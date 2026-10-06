import { useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../../shared/ui/Modal';
import type { NfItemDto } from '@apollo/shared';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { sincronizarNf, type ParDeSincronizacao } from './nfProcessamentoApi';

/**
 * SINCRONIZAR CFOP / ALÍQUOTA / CST dos itens (menu da NF, uNF.pas:16401 → uSincronizaCFOPNotaFiscal): as três grades com os valores
 * distintos dos itens, o "novo" começando igual ao "atual". No OK o servidor valida o CFOP no cadastro, aplica cada de-para uma vez
 * por item e marca todos os itens como sincronizados — "a execução é irreversível", e o imposto não é recalculado.
 *
 * As teclas da janela (`FRMSINCRONIZACFOPNOTAFISCAL`): o FormKeyDown/FormKeyPress do uSincronizaCFOPNotaFiscal só segura o Enter na grade
 * (não vira Tab) — o mesmo da base no Apollo, que não avança em grade; o resto é o `inherited`. Os botões levam as letras do .dfm:
 * "&Sincronizar" (o btnOK) e "Ca&ncelar".
 */
interface Props {
  codnf: number;
  itens: NfItemDto[];
  onFechar: () => void;
  /** devolve os de-para aplicados, para a tela refletir nos itens sem recarregar */
  onSincronizado: (pares: { mapa: ParDeSincronizacao[]; aliquotas: ParDeSincronizacao[]; csts: ParDeSincronizacao[] }) => void;
}

const distintos = (valores: string[]) => [...new Set(valores)];
const cst3 = (v: unknown) => String(Number(v ?? 0)).padStart(3, '0');

export function NfSincronizarModal({ codnf, itens, onFechar, onSincronizado }: Props) {
  const mensagem = useMensagem();
  const { data: aliquotas = [] } = useResourceOptions('cadastro/aliquotas', (a: any) => ({ value: String(a.codigo).trim(), label: `${a.codigo} - ${a.descricao}` }));
  const base = useMemo(() => ({
    cfop: distintos(itens.map((i) => String(i.cfop ?? ''))),
    aliquota: distintos(itens.map((i) => String(i.aliquota ?? '').trim().toUpperCase())),
    cst: distintos(itens.map((i) => cst3((i as { cst?: unknown }).cst))),
  }), [itens]);
  const [novo, setNovo] = useState<Record<'cfop' | 'aliquota' | 'cst', Record<string, string>>>(() => ({
    cfop: Object.fromEntries(base.cfop.map((v) => [v, v])),
    aliquota: Object.fromEntries(base.aliquota.map((v) => [v, v])),
    cst: Object.fromEntries(base.cst.map((v) => [v, v])),
  }));
  const [executando, setExecutando] = useState(false);
  const mudar = (grade: 'cfop' | 'aliquota' | 'cst', atual: string, v: string) => setNovo((n) => ({ ...n, [grade]: { ...n[grade], [atual]: v } }));
  const pares = (grade: 'cfop' | 'aliquota' | 'cst'): ParDeSincronizacao[] =>
    Object.entries(novo[grade]).filter(([de, para]) => de !== '' && para.trim() !== '' && para.trim() !== de).map(([de, para]) => ({ de, para: para.trim() }));

  const confirmar = async () => {
    if (executando) return;
    if (!window.confirm('Deseja realmente executar esta operação? SUA EXECUÇÃO É IRREVERSÍVEL.')) return;
    setExecutando(true);
    try {
      const p = { mapa: pares('cfop'), aliquotas: pares('aliquota'), csts: pares('cst') };
      const r = await sincronizarNf(codnf, p);
      mensagem.sucesso(`Sincronização concluída: ${r.sincronizados} ${r.sincronizados === 1 ? 'item' : 'itens'} sincronizados.`);
      onSincronizado(p);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const grade = (titulo: string, chave: 'cfop' | 'aliquota' | 'cst', editor: (atual: string) => ReactNode) => (
    <div className="flex min-w-40 flex-1 flex-col gap-gp-xs">
      <span className="text-body-sm font-semibold text-fg-default">{titulo}</span>
      <table className="w-full text-body-sm">
        <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Atual</th><th className="p-pad-xs">Novo</th></tr></thead>
        <tbody>
          {base[chave].map((atual) => (
            <tr key={atual} className="border-b border-border/50">
              <td className="p-pad-xs tabular-nums">{atual || '—'}</td>
              <td className="p-pad-xs">{editor(atual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const entrada = (chave: 'cfop' | 'cst', atual: string, max: number) => (
    <input className="w-24 rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-0.5 tabular-nums" inputMode="numeric" maxLength={max}
      aria-label={`Novo ${chave.toUpperCase()} para ${atual}`} value={novo[chave][atual] ?? ''} onChange={(e) => mudar(chave, atual, e.target.value.replace(/\D/g, ''))} />
  );

  return (
    <Modal open onClose={onFechar} title="Sincronizar CFOP, alíquota e CST dos itens"
      primaryAction={{ label: '&Sincronizar', onClick: () => void confirmar(), disabled: executando }} secondaryAction={{ label: 'Ca&ncelar', onClick: onFechar }}>
      <div className="flex flex-col gap-form-gap">
        <div className="flex flex-wrap gap-gp-md">
          {grade('CFOP', 'cfop', (a) => entrada('cfop', a, 4))}
          {grade('Alíquota', 'aliquota', (a) => (
            <select className="rounded-radius-sm border border-border bg-bg-surface px-pad-xs py-0.5" aria-label={`Nova alíquota para ${a}`}
              value={novo.aliquota[a] ?? ''} onChange={(e) => mudar('aliquota', a, e.target.value)}>
              {!aliquotas.some((o) => o.value === a) && <option value={a}>{a || '—'}</option>}
              {aliquotas.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
            </select>
          ))}
          {grade('CST', 'cst', (a) => entrada('cst', a, 3))}
        </div>
        <small className="text-fg-muted">O imposto não é recalculado: use "Recalcular" depois, se precisar.</small>
      </div>
    </Modal>
  );
}
