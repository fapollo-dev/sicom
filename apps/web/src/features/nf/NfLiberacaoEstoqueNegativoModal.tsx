import { useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';

/** a liberação do estoque negativo (PermiteReverterComProdutoEstoqueNeg com a config 'N'): os itens e o login de um usuário autorizado */
export function LiberacaoEstoqueNegativoModal({ itens, onFechar, onConfirmar }: { itens: Array<{ nroitem: number; codproduto: number; saldo: number }>; onFechar: () => void; onConfirmar: (c: { login: string; senha: string }) => void }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  return (
    <Modal open onClose={onFechar} size="sm" title="Estoque negativo"
      primaryAction={{ label: 'Liberar', onClick: () => onConfirmar({ login, senha }) }} secondaryAction={{ label: 'Cancelar', onClick: onFechar }}>
      <div className="flex flex-col gap-form-gap">
        <small className="text-fg-muted">
          {itens.length === 1 ? 'O item' : 'Os itens'} {itens.map((i) => `${i.nroitem} (produto ${i.codproduto}, saldo ${i.saldo})`).join(', ')} {itens.length === 1 ? 'fica' : 'ficam'} com quantidade negativa no estoque. Um usuário autorizado informa o login para liberar.
        </small>
        <Field label="&Login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
        <Field label="&Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
      </div>
    </Modal>
  );
}

