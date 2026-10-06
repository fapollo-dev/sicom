import { useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import type { PaiDecomposicao } from './nfProcessamentoApi';

/**
 * "Item de decomposição nota fiscal" (frmItemDecomposicaoNotaFiscal): o item de produto com entrada decomposta. Mostra o item como veio e
 * deixa mudar só a quantidade total em KG, o valor total e o CFOP; "Confirmar decomposição" troca o item pelos produtos da decomposição.
 * As validações (CFOP, quantidade e valor) são do servidor, com as mensagens do legado.
 */
export function NfDecomposicaoModal({ pai, restantes, onFechar, onConfirmar }: {
  pai: PaiDecomposicao; restantes: number; onFechar: () => void; onConfirmar: (e: { qtdTotal: number; valorTotal: number; cfop: number }) => void;
}) {
  const [qtd, setQtd] = useState<number | undefined>(pai.qtdetotal);
  const [valor, setValor] = useState<number | undefined>(pai.totalprods);
  const [cfop, setCfop] = useState(pai.cfop != null ? String(pai.cfop) : '');
  return (
    <Modal open onClose={onFechar} size="md" title="Item de decomposição nota fiscal"
      primaryAction={{ label: '&Confirmar decomposição', onClick: () => onConfirmar({ qtdTotal: Number(qtd ?? 0), valorTotal: Number(valor ?? 0), cfop: Number(cfop || 0) }) }}
      secondaryAction={{ label: 'Cance&lar', onClick: onFechar }}>
      <div className="flex flex-col gap-form-gap">
        <small className="text-warning">Produto com entrada em decomposição. Os produtos da decomposição serão lançados à nota. Deseja continuar?</small>
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          <div className="sm:col-span-3"><Field label="Produto" value={pai.descricao ?? ''} readOnly /></div>
          <Field label="Código barra" value={pai.codbarra ?? ''} readOnly />
          <Field label="Fator" value={String(pai.fatorembal)} readOnly />
          <Field label="UN" value={pai.unidade ?? ''} readOnly />
          <Field label="Quantidade" value={pai.qtdetotal.toLocaleString('pt-BR', { minimumFractionDigits: 3 })} readOnly />
          <Field label="Valor total original" value={pai.totalprods.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} readOnly />
          <Field label="CFOP do item" value={pai.cfop != null ? String(pai.cfop) : ''} readOnly />
        </div>
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-3">
          <NumberField label="Quantidade total em KG" value={qtd} onChange={(v) => setQtd(v == null ? undefined : Number(v))} decimais={3} min={0} />
          <CurrencyField label="Valor total" value={valor} onChange={(v) => setValor(v == null ? undefined : Number(v))} />
          <Field label="CFOP" value={cfop} onChange={(e) => setCfop(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
        </div>
        {restantes > 0 && <small className="text-fg-muted">Depois deste, {restantes} {restantes === 1 ? 'item' : 'itens'} com entrada em decomposição.</small>}
      </div>
    </Modal>
  );
}
