import { useEffect, useState } from 'react';
import { Modal } from '@apollosg/design-system';
import { useMensagem } from '../../shared/mensagem';
import { opcoesDoProcessarNf, pedeLiberacaoEstoqueNegativo, processarNf, type ModoPrecoProcessar, type OpcoesDoProcessar } from './nfProcessamentoApi';
import { LiberacaoEstoqueNegativoModal } from './NfLiberacaoEstoqueNegativoModal';

/**
 * A TELA DE PROCESSAR da nota de entrada (`TfrmEstoqueNF`): o preço de venda — On-line / Gerar lote / Não atualizar (o on-line travado por
 * BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF), Individual ou Sincronizar empresas — e, por item, "Atualizar preço de venda? [F7]" (padrão: o
 * ATUALIZA_VENDA_NF do CFOP) e "Altera custo" (padrão marcado). [F7] marca/desmarca todos os preços. O servidor move o estoque, atualiza
 * os produtos e o preço como o legado (UpdateProdutos).
 */
interface Props {
  codnf: number;
  onFechar: () => void;
  onProcessado: () => void;
}

const fmt = (v: unknown) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function NfProcessarModal({ codnf, onFechar, onProcessado }: Props) {
  const mensagem = useMensagem();
  const [opcoes, setOpcoes] = useState<OpcoesDoProcessar | null>(null);
  const [modo, setModo] = useState<ModoPrecoProcessar>('lote');
  const [sincronizar, setSincronizar] = useState(false);
  const [preco, setPreco] = useState<Record<number, boolean>>({});
  const [custo, setCusto] = useState<Record<number, boolean>>({});
  const [executando, setExecutando] = useState(false);

  useEffect(() => {
    let vivo = true;
    opcoesDoProcessarNf(codnf).then((o) => {
      if (!vivo) return;
      setOpcoes(o);
      setModo(o.modo);
      setSincronizar(o.sincronizar);
      setPreco(Object.fromEntries(o.itens.map((i) => [i.codnfprod, i.alterapreco])));
      setCusto(Object.fromEntries(o.itens.map((i) => [i.codnfprod, i.alteracusto])));
    }).catch((e) => mensagem.erro(e));
    return () => { vivo = false; };
  }, [codnf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'F7' || !opcoes) return;
      e.preventDefault();
      const todos = opcoes.itens.every((i) => preco[i.codnfprod]);
      setPreco(Object.fromEntries(opcoes.itens.map((i) => [i.codnfprod, !todos])));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [opcoes, preco]);

  const [negativos, setNegativos] = useState<Array<{ nroitem: number; codproduto: number; saldo: number }> | null>(null);
  const confirmar = async (cred?: { login: string; senha: string }) => {
    if (executando || !opcoes) return;
    if (!cred && !window.confirm('Confirma o processamento da nota fiscal?')) return;
    setExecutando(true);
    try {
      await processarNf(codnf, {
        precos: { modo, sincronizar, itens: opcoes.itens.filter((i) => preco[i.codnfprod]).map((i) => i.codnfprod) },
        semAlterarCusto: opcoes.itens.filter((i) => !custo[i.codnfprod]).map((i) => i.codnfprod),
        ...(cred ? { liberacaoEstoqueNegativo: cred } : {}),
      });
      mensagem.sucesso('Nota processada: estoque movimentado e produtos atualizados.');
      setNegativos(null);
      onProcessado();
    } catch (e) {
      // PERMITE_PROC_NF_ESTOQUE_NEG = 'N': o servidor pede a liberação dos itens com estoque negativo
      const itens = pedeLiberacaoEstoqueNegativo(e);
      if (itens && !cred) setNegativos(itens);
      else mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const radio = (v: ModoPrecoProcessar, rotulo: string, desabilitado = false) => (
    <label className={`flex items-center gap-gp-xs text-body-sm ${desabilitado ? 'text-fg-muted' : 'text-fg-default'}`}>
      <input type="radio" name="modo-preco" checked={modo === v} disabled={desabilitado} onChange={() => setModo(v)} />
      {rotulo}
    </label>
  );

  return (
    <Modal open onClose={onFechar} size="lg" title="Processar nota fiscal"
      primaryAction={{ label: executando ? 'Processando…' : 'Processar', onClick: () => void confirmar() }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}>
      {negativos && <LiberacaoEstoqueNegativoModal itens={negativos} onFechar={() => setNegativos(null)} onConfirmar={(c) => void confirmar(c)} />}
      {!opcoes ? <small className="text-fg-muted">Carregando…</small> : (
        <div className="flex flex-col gap-form-gap">
          <div className="flex flex-wrap gap-gp-lg">
            <fieldset className="flex flex-col gap-gp-xs">
              <legend className="text-body-sm font-semibold text-fg-default">Atualizar preços</legend>
              {radio('online', 'On-line', opcoes.onlineBloqueado)}
              {radio('lote', 'Gerar lote')}
              {radio('nenhum', 'Não atualizar')}
            </fieldset>
            <fieldset className="flex flex-col gap-gp-xs">
              <legend className="text-body-sm font-semibold text-fg-default">Opção de atualização</legend>
              <label className="flex items-center gap-gp-xs text-body-sm"><input type="radio" name="sinc" checked={!sincronizar} onChange={() => setSincronizar(false)} />Individual</label>
              <label className="flex items-center gap-gp-xs text-body-sm"><input type="radio" name="sinc" checked={sincronizar} onChange={() => setSincronizar(true)} />Sincronizar empresas</label>
            </fieldset>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm tabular-nums">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="py-pad-xs pr-pad-sm">Item</th><th className="pr-pad-sm">Produto</th><th className="pr-pad-sm text-right">Qtde</th>
                  <th className="pr-pad-sm text-right">Venda da nota</th><th className="pr-pad-sm text-right">Venda da loja</th>
                  <th className="pr-pad-sm">Atualizar preço de venda? [F7]</th><th>Altera custo</th>
                </tr>
              </thead>
              <tbody>
                {opcoes.itens.map((i) => (
                  <tr key={i.codnfprod} className="border-t border-border">
                    <td className="py-pad-xs pr-pad-sm">{i.nroitem}</td>
                    <td className="pr-pad-sm">{i.codproduto} - {i.descricao ?? ''}</td>
                    <td className="pr-pad-sm text-right">{fmt(i.quantidade)}</td>
                    <td className="pr-pad-sm text-right">{fmt(i.vrvenda)}</td>
                    <td className={`pr-pad-sm text-right ${Number(i.vrvenda).toFixed(2) !== Number(i.vrvenda_loja).toFixed(2) ? 'text-warning' : ''}`}>{fmt(i.vrvenda_loja)}</td>
                    <td className="pr-pad-sm"><input type="checkbox" checked={!!preco[i.codnfprod]} disabled={modo === 'nenhum'} onChange={(e) => setPreco((p) => ({ ...p, [i.codnfprod]: e.target.checked }))} /></td>
                    <td><input type="checkbox" checked={!!custo[i.codnfprod]} onChange={(e) => setCusto((c) => ({ ...c, [i.codnfprod]: e.target.checked }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
