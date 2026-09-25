import { useState, type ChangeEvent } from 'react';
import { Modal } from '@apollosg/design-system';
import { TextArea } from '../../shared/ui/TextArea';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { Field } from '../../shared/ui/Field';
import { importarXmlNfe, vincularProdutos, cadastrarParceiroDoXml } from './pedidoCompraApi';

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
  onSucesso: (r: { codnf: number; divergencia: boolean; titulosApagar: number; parcelas?: number }) => void;
}

export function ImportarXmlModal({ codpedcomp, onFechar, onSucesso }: Props) {
  const mensagem = useMensagem();
  const [xml, setXml] = useState('');
  const [erro, setErro] = useState<string | undefined>();
  const [ocupado, setOcupado] = useState(false);
  const [pendencias, setPendencias] = useState<Pendencia[] | null>(null); // null = passo do XML; array = passo de resolução
  const [codfor, setCodfor] = useState<number | undefined>();
  const [escolha, setEscolha] = useState<Record<number, number>>({}); // nItem → idproduto
  // o parceiro que falta (fornecedor ou transportadora), com os dados do XML — o `ImportaParceiro` do legado
  const [cadastro, setCadastro] = useState<{ tipo: 'FRN' | 'TRA'; dados: Record<string, string> } | null>(null);

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
      if ((env?.code === 'NFE_FORNECEDOR_NAO_ENCONTRADO' || env?.code === 'NFE_TRANSPORTADORA_NAO_ENCONTRADA') && env?.detalhe?.parceiro) {
        const p = env.detalhe.parceiro as Record<string, unknown>;
        setCadastro({ tipo: env.code === 'NFE_FORNECEDOR_NAO_ENCONTRADO' ? 'FRN' : 'TRA', dados: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v == null ? '' : String(v)])) });
      } else if (env?.code === 'NFE_PRODUTOS_NAO_CASADOS' && Array.isArray(env?.detalhe?.itens)) {
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

  /** grava o parceiro com os dados (conferidos pelo operador) e reimporta */
  const cadastrarEReimportar = async () => {
    if (!cadastro) return;
    const d = cadastro.dados;
    if (!d.razao?.trim()) return setErro('Informe a razão social.');
    setOcupado(true);
    setErro(undefined);
    try {
      const fone = (d.telefone ?? '').replace(/\D/g, '');
      await cadastrarParceiroDoXml({
        razao: d.razao, fantasia: d.fantasia || undefined, tipofj: d.tipofj || 'J',
        ...(cadastro.tipo === 'FRN' ? { frn: 'S' } : { tra: 'S', placa: d.placa || undefined, ufplaca: d.ufplaca || undefined }),
        enderecos: [{
          endereco: d.endereco || undefined, bairro: d.bairro || undefined, cidade: d.cidade || undefined, idcidade: Number(d.idcidade) || undefined,
          uf: d.uf || undefined, cep: d.cep || undefined, cnpj_cpf: d.cnpj_cpf || undefined, rg_insc: d.rg_insc || undefined,
          telefone: fone.length === 10 || fone.length === 11 ? fone : undefined, endereco_padrao: 'S', ativado: 'S',
        }],
      });
      setCadastro(null);
      await importar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setOcupado(false);
    }
  };

  // ── passo: cadastrar o fornecedor/transportadora que o XML traz ──
  if (cadastro) {
    const campo = (k: string, label: string, max?: number) => (
      <Field label={label} value={cadastro.dados[k] ?? ''} maxLength={max}
        onChange={(e) => setCadastro((c) => (c ? { ...c, dados: { ...c.dados, [k]: e.target.value } } : c))} />
    );
    return (
      <Modal
        open
        onClose={onFechar}
        size="lg"
        title={cadastro.tipo === 'FRN' ? 'Cadastrar o fornecedor da nota' : 'Cadastrar a transportadora da nota'}
        primaryAction={{ label: ocupado ? 'Gravando…' : 'Gravar e reimportar', onClick: () => void cadastrarEReimportar() }}
        secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
      >
        <div className="flex flex-col gap-form-gap">
          {erro && <small className="text-fg-danger">{erro}</small>}
          <small className="text-fg-muted">
            {cadastro.tipo === 'FRN' ? 'O fornecedor' : 'A transportadora'} da nota não está cadastrad{cadastro.tipo === 'FRN' ? 'o' : 'a'}. Confira os dados do XML,
            grave e a nota é importada de novo.
          </small>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            {campo('razao', '&Razão social', 150)}
            {campo('fantasia', '&Fantasia', 150)}
            {campo('cnpj_cpf', '&CNPJ/CPF', 18)}
            {campo('rg_insc', '&Inscrição estadual', 30)}
            {campo('endereco', '&Endereço', 150)}
            {campo('bairro', '&Bairro', 50)}
            {campo('cidade', 'C&idade', 60)}
            {campo('uf', '&UF', 2)}
            {campo('cep', 'CE&P', 9)}
            {campo('telefone', '&Telefone', 20)}
            {cadastro.tipo === 'TRA' && campo('placa', 'Pla&ca', 10)}
            {cadastro.tipo === 'TRA' && campo('ufplaca', 'UF da placa', 2)}
          </div>
        </div>
      </Modal>
    );
  }

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
