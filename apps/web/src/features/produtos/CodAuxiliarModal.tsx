import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { eanValido, type CodAuxiliarDto } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';

/**
 * Modal de ADICIONAR/EDITAR um CÓDIGO AUXILIAR do produto (detalhe 1:N — PROD_CODAUXILIAR).
 * Espelha o padrão dos modais de detalhe de Parceiros (Bancos/Vendedores): form LOCAL e
 * controlado; só ao "Salvar" o item sobe pro pai (append/update no useFieldArray), aparecendo
 * imediatamente no grid. No save do master, o engine de agregado grava master + auxiliares
 * numa transação.
 *
 * Campos (CodAuxiliarDto): codauxiliar (código alternativo/PLU), codbarra (EAN/GTIN — dica
 * visual via `eanValido`), fatoremb (fator de embalagem), codunidade (lookup de unidades) e
 * operacao (1 char — C/V do legado). A validação de formato é do `produtoSchema` no submit.
 */
const CODAUX_VAZIO: CodAuxiliarDto = {};

interface Props {
  /** item a EDITAR (vem do field array) ou undefined p/ ADICIONAR um novo. */
  inicial?: CodAuxiliarDto;
  /** lookup de unidades (codunidade → "sigla - descrição"). */
  unidadeOptions: Opcao[];
  onFechar: () => void;
  /** devolve o item pronto ao pai (que faz append/update no useFieldArray). */
  onConfirmar: (item: CodAuxiliarDto) => void;
}

export function CodAuxiliarModal({ inicial, unidadeOptions, onFechar, onConfirmar }: Props) {
  const [item, setItem] = useState<CodAuxiliarDto>(inicial ?? CODAUX_VAZIO);
  const set = <K extends keyof CodAuxiliarDto>(k: K, v: CodAuxiliarDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  // dica visual de EAN/GTIN (não bloqueia — a obrigatoriedade/validação é do schema).
  const codbarra = (item.codbarra ?? '').trim();
  const codbarraInvalido = codbarra !== '' && !eanValido(codbarra);

  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar código auxiliar' : 'Adicionar código auxiliar'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <Field
          label="Código &auxiliar"
          value={item.codauxiliar ?? ''}
          onChange={(e) => set('codauxiliar', e.target.value || undefined)}
        />
        <div className="flex flex-col gap-gp-xs">
          <Field
            label="Cód. de &barras"
            value={item.codbarra ?? ''}
            inputMode="numeric"
            error={codbarraInvalido ? 'Código de barras (EAN/GTIN) inválido.' : undefined}
            onChange={(e) => set('codbarra', e.target.value || undefined)}
          />
        </div>
        <NumberField
          label="&Fator embalagem"
          value={item.fatoremb}
          onChange={(v) => set('fatoremb', v)}
          decimais={3}
          min={0}
        />
        <SelectField
          label="&Unidade"
          options={unidadeOptions}
          value={item.codunidade != null ? String(item.codunidade) : undefined}
          onChange={(v) => set('codunidade', v ? Number(v) : undefined)}
          placeholder="Selecione…"
        />
        <Field
          label="&Operação"
          value={item.operacao ?? ''}
          maxLength={1}
          onChange={(e) => set('operacao', e.target.value.slice(0, 1) || undefined)}
        />
      </div>
    </Modal>
  );
}
