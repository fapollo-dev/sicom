import { useEffect, useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { NfItemDto } from '@apollo/shared';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarLotesRotativo, itensNfRotativo,
  type LoteRotativoResumo, type PreviaRotativoNf, type LadoRotativoNf,
} from '../inventario-rotativo/inventarioRotativoApi';

/**
 * IMPORTAR INVENTÁRIO ROTATIVO para a nota — o `ImportarInventarioRotativoPerdas/Sobras` do legado
 * (`uNF.pas:12747` / `:12901`): escolhe os lotes FECHADOS (multisseleção, como o `HabilitaMultiselecao`), pede a
 * prévia ao servidor e inclui os itens na nota em edição. O que o legado decide na tela e aqui também:
 *  · o LADO — perdas em nota de SAÍDA, sobras em nota de ENTRADA (o modal sugere pelo tipo da nota);
 *  · os lotes já importados aparecem marcados (o legado colore de VERDE com a legenda "Importado", `:12763`)
 *    e, se escolhidos, voltam em `lotes_recusados` — o gate é por lote, não aborta a importação.
 * O carimbo (IMPORTADO_x/CODNF_x) NÃO acontece aqui: como no legado, é no GRAVAR da nota — quem chama o
 * `vincular-nf` é a tela da NF quando o `codnf` aparece.
 */
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MOTIVO: Record<string, string> = {
  JA_IMPORTADO: 'já importado em nota fiscal',
  LOTE_NAO_FECHADO: 'lote não está fechado',
  SEM_PERDAS: 'não possui itens com perda',
  SEM_SOBRAS: 'não possui itens com sobra',
};

interface Props {
  /** tipo da nota em edição: 'S' sugere PERDAS, 'E' sugere SOBRAS. */
  tipoNota: 'E' | 'S' | undefined;
  /** UF do destinatário/emitente já escolhido na nota (decide CFOP interno × interestadual). */
  ufDestino?: string;
  onFechar: () => void;
  /** entrega os itens prontos + o cabeçalho (CFOP/observação) + os lotes a carimbar no gravar. */
  onConfirmar: (r: { itens: NfItemDto[]; cfopNota: number; observacao: string; lotes: number[]; lado: LadoRotativoNf }) => void;
}

export function NfRotativoModal({ tipoNota, ufDestino, onFechar, onConfirmar }: Props) {
  const mensagem = useMensagem();
  const [lado, setLado] = useState<LadoRotativoNf>(tipoNota === 'E' ? 'SOBRAS' : 'PERDAS');
  const [lotes, setLotes] = useState<LoteRotativoResumo[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [previa, setPrevia] = useState<PreviaRotativoNf | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let vivo = true;
    listarLotesRotativo()
      .then((r) => { if (vivo) setLotes((r.itens ?? []).filter((l) => !l.aberto && l.lote != null)); })
      .catch((e) => mensagem.erro(e));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alternar = (lote: number, v: 'S' | 'N') => {
    setPrevia(null);
    setMarcados((s) => { const n = new Set(s); if (v === 'S') n.add(lote); else n.delete(lote); return n; });
  };

  const calcular = async () => {
    if (!marcados.size) { mensagem.erro('Selecione ao menos um lote fechado.'); return; }
    setCarregando(true);
    try {
      const r = await itensNfRotativo({ lotes: Array.from(marcados), tipo: lado, uf_destino: ufDestino || undefined });
      setPrevia(r);
      if (!r.itens.length) mensagem.erro(`Nenhum item com ${lado === 'PERDAS' ? 'perda' : 'sobra'} nos lotes escolhidos.`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  };

  const incluir = () => {
    if (!previa || !previa.itens.length) return;
    // o mapeamento é o do `IncluirProdutoInventarioRotativo*` (uNF.pas:14155-14245): a nota carrega o item a
    // CUSTO — VRCUSTO e TOTAL_PROD = custo × qtde — então o valor unitário da linha é o custo.
    const itens: NfItemDto[] = previa.itens.map((it) => ({
      nroitem: undefined,
      codproduto: it.codproduto,
      codprodnota: it.codbarra ?? undefined,
      quantidade: it.quantidade,
      fatorembal: it.fatorembal,
      unidade: it.unidade ? it.unidade.slice(0, 2) : undefined,
      vrvenda: it.vrcusto,
      vrcusto: it.vrcusto,
      desconto: 0, vrdescprod: 0, bonificacao: 0,
      cfop: String(it.cfop),
      ncm: it.ncmsh ?? undefined,
      cest: it.cest ?? undefined,
      aliquota: it.aliquota,
      icms: it.icms ?? 0, icme: it.icme ?? 0, bcr: it.bcr ?? 0,
      cst: it.cst ?? undefined,
      vrbasecalculo: 0, vricm: 0, mva: 0, vrbasest: 0, vricmst: 0, streal: 0, ipi: 0, vripi: 0,
    }) as NfItemDto);
    onConfirmar({ itens, cfopNota: previa.cfop_nota, observacao: previa.observacao, lotes: previa.lotes_aceitos, lado });
  };

  const jaImportado = (l: LoteRotativoResumo) => (lado === 'PERDAS' ? l.codnf_perdas : l.codnf_sobras);

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title="Importar inventário rotativo"
      primaryAction={{ label: 'Incluir na nota', onClick: incluir, disabled: !previa || !previa.itens.length }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        <SelectField
          label="&Lado"
          options={[
            { value: 'PERDAS', label: 'Perdas (diferença negativa) — nota de saída, CFOP 5927/6927' },
            { value: 'SOBRAS', label: 'Sobras (diferença positiva) — nota de entrada, CFOP 1949/2949' },
          ]}
          value={lado}
          onChange={(v) => { setLado((v as LadoRotativoNf) ?? 'PERDAS'); setPrevia(null); }}
        />
        {tipoNota && ((tipoNota === 'S') !== (lado === 'PERDAS')) && (
          <small className="text-fg-danger">
            O lado não combina com o tipo da nota: perdas exigem nota de SAÍDA e sobras nota de ENTRADA — o vínculo será recusado ao gravar.
          </small>
        )}

        <div className="flex flex-col gap-gp-xs">
          <small className="text-fg-muted">Lotes fechados ({lotes.length}). Os já importados neste lado aparecem com o código da nota.</small>
          {lotes.length === 0 ? (
            <small className="text-fg-muted">Nenhum lote fechado nesta empresa.</small>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border p-gp-xs">
              {lotes.map((l) => {
                const cod = jaImportado(l);
                return (
                  <div key={l.lote} className="flex items-center justify-between gap-gp-sm py-0.5">
                    <CheckboxField
                      label={`${l.lote} — ${l.nomelote ?? ''} (${l.coletas} coletas)`}
                      value={marcados.has(l.lote as number) ? 'S' : 'N'}
                      onChange={(v) => alternar(l.lote as number, v)}
                    />
                    {cod != null && <small className="text-fg-success">Importado · NF {cod}</small>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-gp-sm">
          <Button label="&Calcular itens" variant="soft" onClick={() => void calcular()} disabled={carregando || !marcados.size} />
        </div>

        {previa && (
          <div className="flex flex-col gap-gp-xs">
            <small>
              CFOP da nota <strong>{previa.cfop_nota}</strong> · {previa.itens.length} item(ns) · lotes aceitos: {previa.lotes_aceitos.join(', ') || '—'}
            </small>
            {previa.lotes_recusados.length > 0 && (
              <small className="text-fg-danger">
                Recusados: {previa.lotes_recusados.map((r) => `lote ${r.lote} (${MOTIVO[r.motivo] ?? r.motivo}${r.codnf ? `, NF ${r.codnf}` : ''})`).join(' · ')}
              </small>
            )}
            {previa.linhas_duplicadas > 0 && (
              <small className="text-fg-danger">
                Atenção: {previa.linhas_duplicadas} produto(s) coletado(s) em mais de um dia no mesmo lote — o legado soma a diferença de novo por dia (quantidade dobrada). Conferir antes de gravar.
              </small>
            )}
            {previa.itens.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Qtde</th><th className="px-2 py-1 text-right">Custo</th><th className="px-2 py-1 text-right">Total</th><th className="px-2 py-1">CFOP</th><th className="px-2 py-1">Alíq.</th></tr></thead>
                  <tbody>
                    {previa.itens.map((it) => (
                      <tr key={it.codproduto} className="border-t border-border">
                        <td className="px-2 py-1">{it.codproduto} — {it.descricao ?? ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtQ(it.quantidade)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(it.vrcusto)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(it.total_prod)}</td>
                        <td className="px-2 py-1">{it.cfop}</td>
                        <td className="px-2 py-1">{it.aliquota}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
