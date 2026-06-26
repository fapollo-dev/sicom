import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { PrecoProdutoDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';
import { precificarProduto } from './precificacaoApi';

/**
 * Modal de ADICIONAR/EDITAR um PREÇO por empresa (detalhe 1:N — MULTI_PRECO). No legado fica
 * na MESMA form do produto. Espelha o padrão dos modais de detalhe (CodAuxiliar/Bancos): form
 * LOCAL e controlado; só ao "Salvar" o item sobe pro pai (append/update no useFieldArray),
 * aparecendo na hora no grid. No save do master, o engine de agregado grava master + preços
 * numa transação.
 *
 * O VRVENDA é o RESULTADO do cálculo (custo+markup+impostos), REUSADO de
 * POST /precificacao/produto — a tela só ARMAZENA o resultado por empresa. O botão
 * "Calcular venda" dispara o motor e preenche vrvenda (mostra o CST retornado).
 */

/** Defaults de novo preço (espelham OnNewRecord do legado: ativo='S'). idempresa=1 em F2. */
const precoVazio = (): PrecoProdutoDto => ({
  idempresa: 1, // TODO: idempresa virá de EMPRESAS quando o cadastro for migrado.
  promocao: 'N',
  ativo: 'S',
  ativo_compra: 'S',
});

interface Props {
  /** item a EDITAR (vem do field array) ou undefined p/ ADICIONAR um novo. */
  inicial?: PrecoProdutoDto;
  /** alíquota fiscal do produto (form.watch('aliquota')) — default do cálculo/aliquotasaida. */
  produtoAliquota?: string;
  /** lookup de alíquotas (codigo → "codigo - descrição") — espelha a seção Fiscal. */
  aliquotaOptions: Opcao[];
  onFechar: () => void;
  /** devolve o item pronto ao pai (que faz append/update no useFieldArray). */
  onConfirmar: (item: PrecoProdutoDto) => void;
}

export function PrecoModal({
  inicial,
  produtoAliquota,
  aliquotaOptions,
  onFechar,
  onConfirmar,
}: Props) {
  const mensagem = useMensagem();
  const [item, setItem] = useState<PrecoProdutoDto>(inicial ?? precoVazio());
  // UF do cálculo: MULTI_PRECO é por empresa, mas EMPRESAS ainda não foi migrada.
  // TODO: a UF virá da EMPRESA (idempresa) quando o cadastro for migrado. Default 'SP'.
  const [uf, setUf] = useState('SP');
  const [calculando, setCalculando] = useState(false);

  const set = <K extends keyof PrecoProdutoDto>(k: K, v: PrecoProdutoDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  // alíquota de saída efetiva: a do preço, senão a do produto (default).
  const aliquotaCalc = (item.aliquotasaida ?? '').trim() || (produtoAliquota ?? '').trim();

  /** REUSO do motor: POST /precificacao/produto → seta vrvenda (e mostra o CST). */
  const calcularVenda = async () => {
    if (calculando) return; // guarda de reentrância (o Button do app não tem `disabled`)
    setCalculando(true);
    try {
      const r = await precificarProduto({
        custo: item.vrcusto ?? 0,
        margem: item.markup ?? 0,
        aliquota: aliquotaCalc,
        uf: uf.trim().toUpperCase(),
        pis: 0,
        cofins: 0,
        regime: 'atual',
      });
      setItem((i) => ({ ...i, vrvenda: r.valorVenda }));
      mensagem.sucesso(`Preço de venda calculado: R$ ${r.valorVenda.toFixed(2)} (CST ${r.cst}).`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCalculando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title={inicial ? 'Editar preço' : 'Adicionar preço'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          {/* TODO: idempresa virá de um lookup EMPRESAS quando o cadastro for migrado (F2 default 1). */}
          <NumberField
            label="&Empresa"
            value={item.idempresa}
            onChange={(v) => set('idempresa', v ?? 1)}
            decimais={0}
            min={1}
          />
          <SelectField
            label="A&líquota saída"
            options={aliquotaOptions}
            value={item.aliquotasaida ?? undefined}
            onChange={(v) => set('aliquotasaida', v || undefined)}
            placeholder={produtoAliquota ? `Padrão: ${produtoAliquota}` : 'Selecione a alíquota…'}
          />

          <CurrencyField
            label="&Custo"
            value={item.vrcusto}
            onChange={(v) => set('vrcusto', v)}
          />
          <CurrencyField
            label="Custo &reposição"
            value={item.vrcustorep}
            onChange={(v) => set('vrcustorep', v)}
          />
          <NumberField
            label="&Markup"
            value={item.markup}
            onChange={(v) => set('markup', v)}
            decimais={4}
            endAddon="%"
          />
          <NumberField
            label="Margem (&ML)"
            value={item.margeml}
            onChange={(v) => set('margeml', v)}
            decimais={4}
            endAddon="%"
          />
          <CurrencyField
            label="&Venda"
            value={item.vrvenda}
            onChange={(v) => set('vrvenda', v)}
          />
          <CurrencyField
            label="Preço pro&mocional"
            value={item.vrpromo}
            onChange={(v) => set('vrpromo', v)}
          />
        </div>

        {/* REUSO do motor de precificação (POST /precificacao/produto). UF temporária p/ o cálculo. */}
        <div className="flex items-end gap-gp-sm">
          <div className="w-32">
            <Field
              label="&UF (cálculo)"
              value={uf}
              maxLength={2}
              onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
            />
          </div>
          <Button
            label="&Calcular venda"
            variant="soft"
            onClick={() => void calcularVenda()}
          />
        </div>

        {/* Flags de controle (char 'S'/'N'). */}
        <div className="flex flex-wrap items-center gap-gp-lg">
          <CheckboxField
            label="&Promoção"
            value={item.promocao}
            onChange={(v) => set('promocao', v)}
          />
          <CheckboxField label="&Ativo" value={item.ativo} onChange={(v) => set('ativo', v)} />
          <CheckboxField
            label="Ativo p/ co&mpra"
            value={item.ativo_compra}
            onChange={(v) => set('ativo_compra', v)}
          />
        </div>
      </div>
    </Modal>
  );
}
