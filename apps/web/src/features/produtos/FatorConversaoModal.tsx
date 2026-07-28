import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import type { FatorConversaoItemDto } from '@apollo/shared';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import type { Opcao } from '../../shared/cadmaster/useResourceOptions';

/**
 * Modal de ADICIONAR/EDITAR um fator de conversão de unidades (tabFatorConversao — F. de Conversão).
 * Leitura: "1 <PARA=unidade do produto> contém <FATOR> <DE=unidade convertida>". PARA é read-only
 * (a unidade do produto, `unidadeProduto`) — o usuário só informa DE e FATOR. Espelha o `DecomposicaoModal`:
 * form LOCAL; só ao "Salvar" o item sobe pro pai (append/update no useFieldArray).
 *
 * Guardas de ENTRADA fiéis ao legado (edtUnDeExit/btnSaveFatorConv): DE ≠ unidade do produto ("origem e
 * destino iguais") e FATOR > 0. São só da tela — o servidor tolera dados sujos do golden (não regride save).
 */
const FATOR_VAZIO: FatorConversaoItemDto = { de: '', fator: 0 };

interface Props {
  /** item a EDITAR (vem do field array) ou undefined p/ ADICIONAR um novo. */
  inicial?: FatorConversaoItemDto;
  /** unidade do produto (= PARA, read-only). */
  unidadeProduto?: string;
  /** lookup de unidades por SIGLA (DE é a sigla, não o código). */
  unidadeOptions: Opcao[];
  /** DEs já cadastrados (uppercase; exceto a linha em edição) — barra o duplicado no add-time. */
  desUsados?: string[];
  onFechar: () => void;
  /** devolve o item pronto ao pai (que faz append/update no useFieldArray). */
  onConfirmar: (item: FatorConversaoItemDto) => void;
}

export function FatorConversaoModal({
  inicial,
  unidadeProduto,
  unidadeOptions,
  desUsados = [],
  onFechar,
  onConfirmar,
}: Props) {
  const [item, setItem] = useState<FatorConversaoItemDto>(inicial ?? FATOR_VAZIO);
  const set = <K extends keyof FatorConversaoItemDto>(k: K, v: FatorConversaoItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  const para = (unidadeProduto ?? '').trim().toUpperCase();
  const de = (item.de ?? '').trim().toUpperCase();
  const igual = de !== '' && de === para; // "origem e destino iguais"
  const duplicado = de !== '' && desUsados.includes(de); // "Registro já existe com essas configurações!"
  const fatorInvalido = !(Number(item.fator) > 0);
  const invalido = de === '' || igual || duplicado || fatorInvalido;

  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar fator de conversão' : 'Adicionar fator de conversão'}
      primaryAction={{
        label: 'Salvar',
        disabled: invalido,
        onClick: () => onConfirmar({ ...item, para: unidadeProduto }),
      }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        <p className="text-body-sm text-fg-muted">
          1 <strong>{para || '—'}</strong> (unidade do produto) contém{' '}
          <strong>{Number(item.fator) > 0 ? item.fator : '…'}</strong>{' '}
          <strong>{de || '…'}</strong>.
        </p>
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
          <SelectField
            label="Unidade convertida (&DE)"
            options={unidadeOptions}
            value={item.de || undefined}
            onChange={(v) => set('de', (v ?? '').toUpperCase())}
            placeholder="Selecione a unidade…"
            error={
              igual
                ? 'A unidade convertida deve ser diferente da unidade do produto.'
                : duplicado
                  ? 'Já existe um fator de conversão com essa unidade.'
                  : undefined
            }
          />
          <NumberField
            label="&Fator (quantidade)"
            value={item.fator}
            onChange={(v) => set('fator', v ?? 0)}
            decimais={6}
            min={0}
            error={fatorInvalido ? 'Informe um fator maior que zero.' : undefined}
          />
        </div>
      </div>
    </Modal>
  );
}
