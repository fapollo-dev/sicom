import { useState, type ChangeEvent } from 'react';
import { Modal } from '@apollosg/design-system';
import { TextArea } from '../../shared/ui/TextArea';

/**
 * Modal do RECEBIMENTO corte-2 — importar o XML da NFe do fornecedor. Cola o XML (ou seleciona o arquivo,
 * lido no cliente) e importa → cria a NF de entrada VALORADA (valores fiscais reais do XML). Se `codpedcomp`
 * vier (aberto da tela do pedido), a NF é vinculada ao pedido. Itens sem produto casado bloqueiam (erro em PT).
 */
interface Props {
  codpedcomp?: number;
  onFechar: () => void;
  onConfirmar: (xml: string) => void | Promise<void>;
  ocupado?: boolean;
}

export function ImportarXmlModal({ codpedcomp, onFechar, onConfirmar, ocupado }: Props) {
  const [xml, setXml] = useState('');
  const [erro, setErro] = useState<string | undefined>();

  const lerArquivo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setXml(await f.text());
      setErro(undefined);
    } catch {
      setErro('Não foi possível ler o arquivo.');
    }
  };

  const confirmar = () => {
    if (!xml.trim()) return setErro('Cole o XML da NFe ou selecione o arquivo.');
    void onConfirmar(xml);
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title="Importar XML da NFe do fornecedor"
      primaryAction={{ label: ocupado ? 'Importando…' : 'Importar', onClick: confirmar }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        {erro && <small className="text-fg-danger">{erro}</small>}
        <label className="flex flex-col gap-gp-xs text-body-sm text-fg-default">
          Arquivo XML da NFe
          <input type="file" accept=".xml,text/xml,application/xml" onChange={(e) => void lerArquivo(e)} />
        </label>
        <TextArea label="&XML da NFe (ou cole o conteúdo aqui)" rows={10} value={xml} onChange={(e) => setXml(e.target.value)} />
        <small className="text-fg-muted">
          {codpedcomp != null
            ? `A NF de entrada será vinculada ao pedido nº ${codpedcomp}. Os valores fiscais vêm do XML; confira e processe a NF (estoque/A Pagar) na tela de Notas de Entrada.`
            : 'Cria uma NF de entrada valorada a partir do XML. Itens sem produto casado (por código de barras) bloqueiam a importação.'}
        </small>
      </div>
    </Modal>
  );
}
