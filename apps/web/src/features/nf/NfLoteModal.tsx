import { useEffect, useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { DateField } from '../../shared/ui/DateField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { listarLotesItem, criarLoteItem, alterarLoteItem, excluirLoteItem, type NfLoteRow } from './nfLoteApi';

/**
 * LOTES/VALIDADE do item da NF — a sub-tela `uNFLoteValidade` (aberta pelo `btnLotesValidades` do item,
 * `uItensNF.pas:1286-1305`). Grade dos lotes do item + edição de um lote por vez (lote, vencimento, fabricação),
 * como a tela do legado com `edtLote`/`edtDataVenc`/`edtDataFab`. As regras (obrigatórios, "Lote já cadastrado
 * para este item de nota fiscal.") vêm do servidor; aqui só a confirmação da exclusão, que é da tela (:129).
 * Só existe para item já GRAVADO (precisa do `codnfprod`), igual ao legado, que abre sobre o item corrente.
 */
interface Props {
  codnf: number;
  codnfprod: number;
  titulo: string; // "Produto - <cod>: <descrição>" (o lblProduto da tela, :1299)
  onFechar: () => void;
}

const VAZIO = { lote: '', dtvalidade: '', dtfabricacao: '' };
const fmtDia = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');

export function NfLoteModal({ codnf, codnfprod, titulo, onFechar }: Props) {
  const mensagem = useMensagem();
  const [lotes, setLotes] = useState<NfLoteRow[]>([]);
  const [editando, setEditando] = useState<number | null | 'novo'>(null);
  const [form, setForm] = useState(VAZIO);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = async () => {
    try { setLotes((await listarLotesItem(codnf, codnfprod)).itens); } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void recarregar(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codnf, codnfprod]);

  const abrirNovo = () => { setForm(VAZIO); setEditando('novo'); };
  const abrirEdicao = (l: NfLoteRow) => {
    setForm({ lote: l.lote ?? '', dtvalidade: l.dtvalidade ?? '', dtfabricacao: l.dtfabricacao ?? '' });
    setEditando(l.codnfprodlote);
  };

  const gravar = async () => {
    setOcupado(true);
    try {
      const body = { lote: form.lote, dtvalidade: form.dtvalidade, dtfabricacao: form.dtfabricacao || null };
      if (editando === 'novo') await criarLoteItem(codnf, codnfprod, body);
      else if (editando != null) await alterarLoteItem(codnf, codnfprod, editando, body);
      setEditando(null);
      await recarregar();
      mensagem.sucesso('Lote gravado.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async (l: NfLoteRow) => {
    if (!window.confirm('Confirma a exclusão do registro?')) return; // literal da tela (:129)
    setOcupado(true);
    try {
      await excluirLoteItem(codnf, codnfprod, l.codnfprodlote);
      await recarregar();
      mensagem.sucesso('Registro excluído com sucesso!'); // literal (:134)
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal open onClose={onFechar} size="lg" title="Lotes e validade do item" secondaryAction={{ label: 'Sair', onClick: onFechar }}>
      <div className="flex flex-col gap-form-gap">
        <small className="text-fg-muted">{titulo}</small>

        {editando != null ? (
          <div className="flex flex-col gap-form-gap rounded-md border border-border p-gp-sm">
            <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
              <Field label="&Lote" value={form.lote} maxLength={20} onChange={(e) => setForm((f) => ({ ...f, lote: e.target.value }))} />
              <DateField label="Data de &vencimento" value={form.dtvalidade || undefined} onChange={(v) => setForm((f) => ({ ...f, dtvalidade: v ?? '' }))} />
              <DateField label="Data de &fabricação" value={form.dtfabricacao || undefined} onChange={(v) => setForm((f) => ({ ...f, dtfabricacao: v ?? '' }))} />
            </div>
            <div className="flex flex-wrap gap-gp-sm">
              <Button label="&Gravar" variant="soft" onClick={() => void gravar()} disabled={ocupado} />
              <Button label="&Cancelar" variant="ghost" onClick={() => setEditando(null)} disabled={ocupado} />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-gp-sm">
            <Button label="&Adicionar registro" variant="soft" onClick={abrirNovo} disabled={ocupado} />
          </div>
        )}

        {lotes.length === 0 ? (
          <small className="text-fg-muted">Nenhum lote para este item.</small>
        ) : (
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="px-2 py-1">Lote</th><th className="px-2 py-1">Vencimento</th><th className="px-2 py-1">Fabricação</th><th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.codnfprodlote} className="border-t border-border">
                    <td className="px-2 py-1">{l.lote ?? <em className="text-fg-muted">(em branco)</em>}</td>
                    <td className="px-2 py-1 tabular-nums">{fmtDia(l.dtvalidade)}</td>
                    <td className="px-2 py-1 tabular-nums">{fmtDia(l.dtfabricacao)}</td>
                    <td className="px-2 py-1 text-right">
                      <span className="inline-flex gap-gp-xs">
                        <Button label="Editar" variant="ghost" onClick={() => abrirEdicao(l)} disabled={ocupado || editando != null} />
                        <Button label="Excluir" variant="ghost" onClick={() => void excluir(l)} disabled={ocupado || editando != null} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
