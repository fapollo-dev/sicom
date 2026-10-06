import { useEffect, useRef, useState, type RefObject } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { useShortcut, focarMnemonico } from '../../shared/keyboard';
import { ORIGEM_OPCOES, type NfItemDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';
import { configuracaoItemNf } from './nfFiscalApi';

/**
 * Modal de ADICIONAR/EDITAR um ITEM da NF (detalhe 1:N — NF_PROD). Espelha o padrão dos
 * modais de detalhe (CodAuxiliarModal/EnderecoModal): form LOCAL controlado; só ao "Ok"
 * o item sobe ao pai (append/update no useFieldArray) e aparece no grid. No save do master,
 * o engine de agregado grava header + itens numa transação.
 *
 * F1 = a tela ARMAZENA a config fiscal por item (CFOP/CST/alíquota/origem/NCM/CEST); o
 * CÁLCULO de imposto (bases/valores) é F2 (reusa `precificacao`). Por isso o modal coleta o
 * que o operador digita; produto e quantidade são obrigatórios (item sem produto/qtde é
 * rejeitado no schema). Validação de formato/obrigatórios é do `nfSchema` no submit.
 *
 * O VALOR UNITÁRIO da linha é o `VRCUSTO` e o desconto digitado é em DINHEIRO (`VRDESCPROD`) — o `DESCONTO` guarda o
 * percentual e sai dele no gravar; o `VRVENDA` é o PREÇO DE VENDA, que só a nota de entrada mostra (`nf-valor.ts` do
 * shared, provado contra a produção). "Arredondar" é o `chkARREDONDA` do item: sem ele o total da linha é truncado.
 */
const ITEM_VAZIO: NfItemDto = { codproduto: undefined as unknown as number, quantidade: undefined as unknown as number };

interface Props {
  /** item a EDITAR (do field array) ou undefined p/ ADICIONAR. */
  inicial?: NfItemDto;
  /** tipo da nota: o preço de venda (VRVENDA) só existe no item de ENTRADA */
  tipo?: 'E' | 'S';
  produtoOptions: Opcao[];
  cfopOptions: Opcao[];
  aliquotaOptions: Opcao[];
  unidadeOptions: Opcao[];
  onFechar: () => void;
  onConfirmar: (item: NfItemDto) => void;
}

export function NfItemModal({
  inicial,
  tipo,
  produtoOptions,
  cfopOptions,
  aliquotaOptions,
  unidadeOptions,
  onFechar,
  onConfirmar,
}: Props) {
  const [item, setItem] = useState<NfItemDto>(inicial ?? ITEM_VAZIO);
  const [erro, setErro] = useState<string | undefined>();
  const set = <K extends keyof NfItemDto>(k: K, v: NfItemDto[K]) => setItem((i) => ({ ...i, [k]: v }));
  // a descrição do item só se digita com EDITAR_DESCRICAO_ITEM_NF='S' (uItensNF.pas:3657); sem ela é a do produto
  const [editarDescricao, setEditarDescricao] = useState(false);
  const fatorRef = useRef<HTMLDivElement>(null);
  const cfopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let vivo = true;
    configuracaoItemNf().then((c) => { if (vivo) setEditarDescricao(Boolean(c.editarDescricao)); }).catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  const salvar = () => {
    if (item.codproduto == null) return setErro('Informe o produto do item.');
    if (!(Number(item.quantidade) > 0)) return setErro('A quantidade deve ser maior que zero.');
    // passou pelo diálogo: deixa de ser "importado" e o CFOP×situação passa a cobrá-lo (uItensNF.pas:1525)
    // e a gravação confere a descrição contra a do produto e leva a diferença à LOG (o GravaLog do OK, uItensNF.pas:4058)
    const { importado_de: _imp, ...digitado } = item;
    onConfirmar({ ...digitado, dialogo: true } as NfItemDto);
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title={inicial ? 'Editar item da nota' : 'Adicionar item da nota'}
      primaryAction={{ label: '&Ok', onClick: salvar }}
      secondaryAction={{ label: '&Cancelar', onClick: onFechar }}
    >
      <TeclasDoItemNf fator={fatorRef} cfop={cfopRef} />
      <div className="flex flex-col gap-form-gap">
        {erro && <small className="text-fg-danger">{erro}</small>}
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SelectField
              label="&Produto"
              options={produtoOptions}
              value={item.codproduto != null ? String(item.codproduto) : undefined}
              // outro produto: a descrição volta a ser a dele (preenchida no gravar)
              onChange={(v) => setItem((i) => ({ ...i, codproduto: v ? Number(v) : (undefined as unknown as number), descricao: undefined }))}
              placeholder="Selecione o produto…"
            />
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Descrição"
              maxLength={120}
              value={item.descricao ?? ''}
              disabled={!editarDescricao}
              placeholder="A do produto"
              onChange={(e) => set('descricao', e.target.value || undefined)}
            />
          </div>
          <NumberField
            label="&Quantidade"
            value={item.quantidade as number | undefined}
            onChange={(v) => set('quantidade', v as number)}
            decimais={3}
            min={0}
          />
          <div ref={fatorRef}>
            <NumberField
              label="Fator embal. [F6]"
              value={item.fatorembal}
              onChange={(v) => set('fatorembal', v)}
              decimais={3}
              min={0}
            />
          </div>
          <SelectField
            label="Unidade"
            options={unidadeOptions}
            value={item.unidade ?? undefined}
            onChange={(v) => set('unidade', v || undefined)}
            placeholder="Selecione…"
          />
          <CurrencyField
            label="Valor unitário"
            value={item.vrcusto}
            onChange={(v) => set('vrcusto', v)}
          />
          <CurrencyField label="&Desconto (R$)" value={item.vrdescprod} onChange={(v) => set('vrdescprod', v)} />
          {tipo === 'E' && (
            <CurrencyField label="Preço de &venda" value={item.vrvenda} onChange={(v) => set('vrvenda', v)} />
          )}
          <CheckboxField
            label="A&rredondar"
            value={item.arredonda === 'N' ? 'N' : item.arredonda === 'S' ? 'S' : undefined}
            onChange={(v) => set('arredonda', v)}
          />
          <CurrencyField label="Bonificação" value={item.bonificacao} onChange={(v) => set('bonificacao', v)} />
        </div>

        {/* Config fiscal ARMAZENADA (cálculo de imposto = F2). */}
        <fieldset className="rounded-radius-base border border-border p-pad-sm">
          <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Fiscal</legend>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <div ref={cfopRef}>
              <SelectField
                label="CFOP [F9]"
                options={cfopOptions}
                value={item.cfop ?? undefined}
                onChange={(v) => set('cfop', v || undefined)}
                placeholder="Selecione o CFOP…"
              />
            </div>
            <SelectField
              label="A&líquota"
              options={aliquotaOptions}
              value={item.aliquota ?? undefined}
              onChange={(v) => set('aliquota', v || undefined)}
              placeholder="Selecione a alíquota…"
            />
            <Field
              label="NCM"
              inputMode="numeric"
              maxLength={8}
              value={item.ncm ?? ''}
              onChange={(e) => set('ncm', e.target.value || undefined)}
            />
            <Field
              label="C&EST"
              inputMode="numeric"
              maxLength={7}
              value={item.cest ?? ''}
              onChange={(e) => set('cest', e.target.value || undefined)}
            />
            <NumberField
              label="ICMS (%)"
              value={item.icms}
              onChange={(v) => set('icms', v)}
              decimais={2}
              min={0}
              endAddon="%"
            />
            <NumberField
              label="CST"
              value={item.cst}
              onChange={(v) => set('cst', v)}
              decimais={0}
              min={0}
            />
            <Field
              label="CSOSN"
              maxLength={3}
              value={item.csosn ?? ''}
              onChange={(e) => set('csosn', e.target.value || undefined)}
            />
            <SelectField
              label="Origem"
              options={ORIGEM_OPCOES}
              value={item.origem_estoque ?? undefined}
              onChange={(v) => set('origem_estoque', v || undefined)}
              placeholder="Selecione a origem…"
            />
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

/**
 * AS TECLAS DA JANELA (`FRMITENSNF`, FormKeyDown do uItensNF — sem `inherited`): Esc = Cancelar (o `onClose` do Modal) · F6 foca o
 * fator de embalagem · F9 abre o CFOP. O Alt+← e o Ctrl+E do `TfrmMaster` não valem na janela; o Enter-avança vale (sem FormKeyPress
 * próprio, é o da base). LACUNAS — a ação não existe nesta janela: F2 o cadastro do produto por cima do item (aqui o cadastro é tela:
 * ir até ele perderia a nota em edição) · F5 o indexador do item · F7 a busca por PLU × EAN (o produto é uma lista) · F8 a situação do
 * item (a janela `FRMCONSULTASITUACAODOCUMENTO`; o item não tem o campo aqui) · F10 o estoque por empresa · F11 a declaração de
 * importação.
 */
function TeclasDoItemNf({ fator, cfop }: { fator: RefObject<HTMLDivElement | null>; cfop: RefObject<HTMLDivElement | null> }) {
  // F6 = SetaFoco(edtFatorEmb) (FormKeyDown do uItensNF) — o "Fator embal. [F6]"
  useShortcut('f6', () => focarMnemonico(fator.current?.querySelector<HTMLInputElement>('input')));
  // F9 = btnCFOPClick (FormKeyDown do uItensNF) — a Pesquisa de CFOP do tipo da nota, dentro/fora do estado e da situação: aqui a
  // lista do CFOP (as opções já têm esse filtro), aberta
  useShortcut('f9', () => {
    const gatilho = cfop.current?.querySelector<HTMLElement>('button,[role=combobox]');
    if (focarMnemonico(gatilho) === false) return false;
    gatilho!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
  });
  // o FormKeyDown do uItensNF não chama o `inherited`: o Alt+← e o Ctrl+E da base não valem com a janela aberta
  useShortcut('ctrl+e', () => undefined);
  useShortcut('alt+arrowleft', () => undefined);
  return null;
}
