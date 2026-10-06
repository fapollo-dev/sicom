import type { ComponentProps } from 'react';
import { Modal as DSModal } from '@apollosg/design-system';
import { ShortcutScope } from '../keyboard/ShortcutScope';
import { useMnemonic } from '../keyboard/useMnemonic';

type Props = ComponentProps<typeof DSModal>;
type Acao = NonNullable<Props['primaryAction']>;

/**
 * O Modal do DS com o `&` nos botões do rodapé (ADR-010): o DS desenha o `label` cru ("&Sair" aparecia com o &). Aqui a legenda
 * sai com a letra sublinhada e o Alt+letra aciona o botão — só com a janela aberta, num escopo próprio (a janela por cima leva a
 * letra antes da tela de baixo). Botão desabilitado/carregando deixa a letra passar.
 */
export function Modal(props: Props) {
  return <ShortcutScope><ModalComLetras {...props} /></ShortcutScope>;
}

function ModalComLetras(props: Props) {
  const { open, onClose } = props;
  const primary = useAcao(props.primaryAction, open);
  const secondary = useAcao(props.secondaryAction, open, onClose);
  const tertiary = useAcao(props.tertiaryAction, open);
  return <DSModal {...props} primaryAction={primary} secondaryAction={secondary} tertiaryAction={tertiary} />;
}

function useAcao(acao: Acao | undefined, aberto: boolean, padrao?: () => void): Acao | undefined {
  const rotulo = typeof acao?.label === 'string' ? acao.label : '';
  const { text } = useMnemonic(rotulo, () => {
    if (!acao || acao.disabled || acao.loading) return false;
    (acao.onClick ?? padrao)?.();
  }, { when: aberto && rotulo.includes('&') });
  if (!acao || !rotulo.includes('&')) return acao;
  return { ...acao, label: text };
}
