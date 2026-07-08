import { useState, type ChangeEvent } from 'react';
import { Modal } from '@apollosg/design-system';
import { TextArea } from '../../shared/ui/TextArea';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { importarXmlNfe, vincularProdutos } from './pedidoCompraApi';

/**
 * Modal do RECEBIMENTO — importar o XML da NFe do fornecedor. Cola/seleciona o XML → importa → cria a NF de
 * entrada VALORADA. Se houver itens sem produto casado (por EAN), entra no passo de RESOLUÇÃO (corte-3): o
 * operador escolhe o produto p/ cada pendência → grava a DE-PARA do fornecedor → reimporta (agora casa). O
 * fluxo (import + resolução + reimport) vive aqui; o pai só trata o sucesso.
 */
interface Pendencia {
  nItem: number;
  cProd?: string;
  cEAN?: string;
  xProd?: string;
  ncm?: string;
  motivo?: string;
}
interface Props {
  codpedcomp?: number;
  onFechar: () => void;
  onSucesso: (r: { codnf: number; divergencia: boolean }) => void;
}

export function ImportarXmlModal({ codpedcomp, onFechar, onSucesso }: Props) {
  const mensagem = useMensagem();
  const [xml, setXml] = useState('');
  const [erro, setErro] = useState<string | undefined>();
  const [ocupado, setOcupado] = useState(false);
  const [pendencias, setPendencias] = useState<Pendencia[] | null>(null); // null = passo do XML; array = passo de resolução
  const [codfor, setCodfor] = useState<number | undefined>();
  const [escolha, setEscolha] = useState<Record<number, number>>({}); // nItem → idproduto

  const { data: produtoOptions = [] } = useResourceOptions('cadastro/produtos', (p: any) => ({
    value: String(p.idproduto ?? p.codigo),
    label: `${p.codbarra ?? ''} - ${p.descricao ?? ''}`,
  }));

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

  /** importa o XML; em pendência de produto, entra no passo de resolução (não fecha). */
  const importar = async () => {
    setOcupado(true);
    setErro(undefined);
    try {
      const r = await importarXmlNfe(xml, codpedcomp);
      onSucesso(r);
    } catch (e: any) {
      const env = e?.envelope;
      if (env?.code === 'NFE_PRODUTOS_NAO_CASADOS' && Array.isArray(env?.detalhe?.itens)) {
        setPendencias(env.detalhe.itens as Pendencia[]);
        setCodfor(env.detalhe.codparceiro != null ? Number(env.detalhe.codparceiro) : undefined);
      } else {
        mensagem.erro(e);
      }
    } finally {
      setOcupado(false);
    }
  };

  /** grava a de-para dos itens resolvidos e reimporta. */
  const vincularEReimportar = async () => {
    if (!pendencias || codfor == null) return;
    const semEscolha = pendencias.filter((p) => !escolha[p.nItem]);
    if (semEscolha.length) return setErro('Escolha um produto para cada item pendente.');
    setOcupado(true);
    setErro(undefined);
    try {
      await vincularProdutos(
        codfor,
        pendencias.map((p) => ({ idproduto: escolha[p.nItem], cEAN: p.cEAN, cProd: p.cProd })),
      );
      setPendencias(null); // volta o estado; a reimportação decide o desfecho
      await importar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  // ── passo 2: resolução de pendências ──
  if (pendencias) {
    return (
      <Modal
        open
        onClose={onFechar}
        size="lg"
        title="Vincular produtos do fornecedor"
        primaryAction={{ label: ocupado ? 'Vinculando…' : 'Vincular e reimportar', onClick: () => void vincularEReimportar() }}
        secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
      >
        <div className="flex flex-col gap-form-gap">
          {erro && <small className="text-fg-danger">{erro}</small>}
          <small className="text-fg-muted">
            Estes itens do XML não têm produto casado por código de barras. Escolha o produto de cada um — o vínculo
            fica salvo por fornecedor e o próximo import casa sozinho.
          </small>
          <div className="flex flex-col gap-gp-sm">
            {pendencias.map((p) => (
              <div key={p.nItem} className="rounded-radius-base border border-border bg-bg-surface p-pad-sm">
                <div className="text-body-sm text-fg-default">
                  <strong>Item {p.nItem}</strong> — {p.xProd || '(sem descrição)'}
                </div>
                <div className="mb-form-gap text-body-sm text-fg-muted">
                  cProd: {p.cProd || '—'} · EAN: {p.cEAN || '—'} · NCM: {p.ncm || '—'}
                </div>
                <SelectField
                  label="&Produto"
                  options={produtoOptions}
                  value={escolha[p.nItem] != null ? String(escolha[p.nItem]) : undefined}
                  onChange={(v) => setEscolha((s) => ({ ...s, [p.nItem]: v ? Number(v) : (undefined as unknown as number) }))}
                  placeholder="Selecione o produto…"
                />
              </div>
            ))}
          </div>
        </div>
      </Modal>
    );
  }

  // ── passo 1: colar/subir o XML ──
  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title="Importar XML da NFe do fornecedor"
      primaryAction={{ label: ocupado ? 'Importando…' : 'Importar', onClick: () => (xml.trim() ? void importar() : setErro('Cole o XML da NFe ou selecione o arquivo.')) }}
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
            : 'Cria uma NF de entrada valorada a partir do XML. Itens sem produto casado entram no passo de vínculo.'}
        </small>
      </div>
    </Modal>
  );
}
