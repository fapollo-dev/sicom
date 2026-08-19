import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import {
  listarAdiantamentos, listarContas, listarSituacoes, criarAdiantamento, editarAdiantamento, excluirAdiantamento,
  type Adiantamento, type ContaAdiantamento, type SituacaoAdiantamento,
} from './adiantamentoFornApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => new Date().toISOString().slice(0, 10);
const nomeConta = (c: ContaAdiantamento) => `${c.nroconta ?? ''} ${c.titular ?? ''}`.trim() || `Conta ${c.codconta}`;
/** prefill da observação (dbmOBSEnter do legado): 'ADIANT P/ <razão> - ' no débito, 'ADIANT DE <razão> - ' no
 *  crédito. No golden 527 das 563 observações começam com 'ADIANT P/ ' e 5 com 'ADIANT DE ' — é o padrão do
 *  histórico do razão de contas correntes, e por isso vale copiar. */
const prefixoObs = (tipo: string, razao?: string) =>
  !tipo ? '' : `${tipo === 'D' ? 'ADIANT P/' : 'ADIANT DE'} ${(razao ?? '').trim()} - `.toUpperCase();
/** o rótulo do que o adiantamento produz — é o que o operador precisa entender antes de gravar. */
const efeito = (tipo: string) =>
  tipo === 'D'
    ? 'Débito: o dinheiro SAI da conta e o parceiro passa a nos dever (gera título a receber).'
    : tipo === 'C'
      ? 'Crédito: o dinheiro ENTRA na conta e passamos a dever ao parceiro (gera título a pagar).'
      : tipo === 'E'
        ? 'Crédito de fornecedor: entra na conta e gera título a pagar marcado como crédito.'
        : '';

/**
 * ADIANTAMENTO A FORNECEDOR/PARCEIRO (FRMADIANTAMENTOFORNECEDOR). O TIPO não é digitado: vem da SITUAÇÃO do
 * documento (F19→crédito · F20→débito · F21→crédito de fornecedor), como no legado, que desabilita o radio depois
 * de escolher. Gravar cria, na mesma transação, o movimento na conta corrente e o título (a receber ou a pagar).
 * Registro quitado (título baixado) ou contabilizado não pode ser editado nem excluído.
 */
export function AdiantamentoFornPage() {
  const mensagem = useMensagem();
  const [situacoes, setSituacoes] = useState<SituacaoAdiantamento[]>([]);
  const [contas, setContas] = useState<ContaAdiantamento[]>([]);
  const [lista, setLista] = useState<Adiantamento[]>([]);
  const [busy, setBusy] = useState(false);
  // filtros
  const [fTipo, setFTipo] = useState('');
  const [fQuitada, setFQuitada] = useState('');
  // formulário
  const [editando, setEditando] = useState<number | null>(null);
  const [situacao, setSituacao] = useState('');
  const [conta, setConta] = useState('');
  const [parceiro, setParceiro] = useState<number | undefined>();
  const [dtAdto, setDtAdto] = useState<string | undefined>(hoje());
  const [dtVenc, setDtVenc] = useState<string | undefined>(hoje());
  const [valor, setValor] = useState<number | undefined>();
  const [obs, setObs] = useState('');

  const tipo = situacoes.find((s) => String(s.idsituacao_nf) === situacao)?.tipo ?? '';
  const contaSel = contas.find((c) => String(c.codconta) === conta);
  const razaoSel = lista.find((a) => a.codparceiro === parceiro)?.razao ?? undefined;

  const carregar = useCallback(async () => {
    try {
      setLista(await listarAdiantamentos({ tipo: fTipo || undefined, quitada: fQuitada || undefined }));
    } catch (e) { mensagem.erro(e); }
  }, [fTipo, fQuitada, mensagem]);

  useEffect(() => {
    // erro nos lookups não pode ficar mudo: sem situação/conta a tela não grava, e o operador precisa saber por quê
    // (403 sem grant, API fora do ar…).
    void listarSituacoes().then(setSituacoes).catch((e) => { setSituacoes([]); mensagem.erro(e); });
    void listarContas().then(setContas).catch((e) => { setContas([]); mensagem.erro(e); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const limpar = () => {
    setEditando(null); setSituacao(''); setConta(''); setParceiro(undefined);
    setDtAdto(hoje()); setDtVenc(hoje()); setValor(undefined); setObs('');
  };

  const gravar = async () => {
    if (busy) return;
    if (!editando && !situacao) { window.alert('Informe a situação do documento.'); return; }
    if (!parceiro) { window.alert('Favor entrar com código do Parceiro!'); return; }
    if (!editando && !conta) { window.alert('Favor entrar com o número da conta corrente!'); return; }
    if (valor == null || valor <= 0) { window.alert('Favor entrar com o valor do adiantamento!'); return; }
    if (!dtAdto || !dtVenc) { window.alert('Informe as datas.'); return; }
    if (dtVenc < dtAdto) { window.alert('Favor entrar com a data de vencimento igual ou maior que a data de Adiantamento!'); return; }
    setBusy(true);
    try {
      if (editando) {
        const r = await editarAdiantamento({ codadiantamento: editando, codparceiro: parceiro, dtadiantamento: dtAdto, dtvencimento: dtVenc, valor, obs: obs || undefined });
        mensagem.sucesso(`Adiantamento ${r.codadiantamento} alterado${r.titulo_atualizado ? ' (título atualizado)' : ''}.`);
      } else {
        const r = await criarAdiantamento({ idsituacao_nf: Number(situacao), codparceiro: parceiro, codcontacorrente: Number(conta), dtadiantamento: dtAdto, dtvencimento: dtVenc, valor, obs: obs || undefined });
        const titulo = r.codrcb != null ? `título a receber ${r.codrcb}` : `título a pagar ${r.codapg}`;
        mensagem.sucesso(`Adiantamento ${r.codadiantamento} gravado — ${titulo}. Saldo da conta: ${brl(r.saldo)}.`);
      }
      limpar();
      await carregar();
      setContas(await listarContas());
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const editar = (a: Adiantamento) => {
    setEditando(a.codadiantamento);
    setSituacao(a.idsituacao_nf != null ? String(a.idsituacao_nf) : '');
    setConta(String(a.codcontacorrente));
    setParceiro(a.codparceiro);
    setDtAdto(String(a.dtadiantamento).slice(0, 10));
    setDtVenc(String(a.dtvencimento).slice(0, 10));
    setValor(Number(a.valor));
    setObs(a.obs ?? '');
  };

  const excluir = async (a: Adiantamento) => {
    if (busy) return;
    if (!window.confirm(`Excluir o adiantamento ${a.codadiantamento}? O movimento na conta corrente e o título gerado serão apagados.`)) return;
    setBusy(true);
    try {
      const r = await excluirAdiantamento(a.codadiantamento);
      mensagem.sucesso(`Adiantamento ${r.codadiantamento} excluído${r.titulo_removido ? ' (título removido)' : ''}.`);
      if (editando === a.codadiantamento) limpar();
      await carregar();
      setContas(await listarContas());
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const bloqueado = (a: Adiantamento) => a.quitada === 'S' || a.contabilizado === 'S';
  const motivo = (a: Adiantamento) => (a.quitada === 'S' ? 'documento já baixado' : 'já contabilizado');

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Adiantamento a Fornecedor" />

      <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="text-body-sm font-semibold text-fg-muted">{editando ? `Alterando o adiantamento ${editando}` : 'Novo adiantamento'}</div>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-72">
            <SelectField
              label="&Situação do documento"
              value={situacao}
              onChange={setSituacao}
              disabled={editando != null}
              options={situacoes.map((s) => ({ value: String(s.idsituacao_nf), label: `${s.descricao} (${s.tipo_operacao})` }))}
              placeholder="(situação)"
            />
          </div>
          <div className="w-72">
            <SelectField
              label="&Conta corrente"
              value={conta}
              onChange={setConta}
              disabled={editando != null}
              options={contas.map((c) => ({ value: String(c.codconta), label: `${nomeConta(c)} — ${brl(c.saldo)}` }))}
              placeholder="(conta)"
            />
          </div>
          <div className="w-40"><NumberField label="&Parceiro" value={parceiro} decimais={0} min={1} onChange={setParceiro} placeholder="código" /></div>
          <div className="w-44"><DateField label="&Data" value={dtAdto} onChange={setDtAdto} /></div>
          <div className="w-44"><DateField label="&Vencimento" value={dtVenc} onChange={setDtVenc} /></div>
          <div className="w-40"><NumberField label="&Valor" value={valor} decimais={2} min={0} onChange={setValor} /></div>
          <div className="min-w-64 flex-1">
            <Field
              label="&Observação"
              value={obs}
              onChange={(e) => setObs(e.target.value.toUpperCase())}
              onFocus={() => { if (!obs && tipo) setObs(prefixoObs(tipo, razaoSel)); }}
              placeholder="vira o histórico do movimento"
            />
          </div>
        </div>
        {tipo && <div className="text-body-sm text-fg-muted">{efeito(tipo)}{contaSel ? ` Saldo atual da conta: ${brl(contaSel.saldo)}.` : ''}</div>}
        <div className="flex gap-gp-sm">
          <Button label="&Gravar" variant="soft" disabled={busy} onClick={() => void gravar()} />
          {editando != null && <Button label="Cancelar" variant="ghost" disabled={busy} onClick={limpar} />}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-56"><SelectField label="&Tipo" value={fTipo} onChange={setFTipo} options={[{ value: 'D', label: 'Débito (a receber)' }, { value: 'C', label: 'Crédito (a pagar)' }, { value: 'E', label: 'Crédito de fornecedor' }]} placeholder="(todos)" /></div>
        <div className="w-56"><SelectField label="&Situação" value={fQuitada} onChange={setFQuitada} options={[{ value: 'N', label: 'Em aberto' }, { value: 'S', label: 'Quitado' }]} placeholder="(todos)" /></div>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">{lista.length} adiantamento(s)</div>
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Código</th><th className="p-pad-xs">Parceiro</th><th className="p-pad-xs">Conta</th>
              <th className="p-pad-xs">Data</th><th className="p-pad-xs">Venc.</th><th className="p-pad-xs text-right">Valor</th>
              <th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Título</th><th className="p-pad-xs">Estado</th><th className="p-pad-xs" />
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.codadiantamento} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">{a.codadiantamento}</td>
                <td className="p-pad-xs">{a.razao ?? a.codparceiro}</td>
                <td className="p-pad-xs text-fg-muted">{a.nroconta ?? a.codcontacorrente}</td>
                <td className="p-pad-xs tabular-nums">{dia(a.dtadiantamento)}</td>
                <td className="p-pad-xs tabular-nums">{dia(a.dtvencimento)}</td>
                <td className={`p-pad-xs text-right tabular-nums ${a.tipo === 'D' ? 'text-danger' : 'text-fg'}`}>{a.tipo === 'D' ? '−' : '+'}{brl(a.valor)}</td>
                <td className="p-pad-xs">{a.tipo === 'D' ? 'Débito' : a.tipo === 'C' ? 'Crédito' : 'Créd. forn.'}</td>
                <td className="p-pad-xs text-fg-muted">{a.codrcb != null ? `receber ${a.codrcb}` : a.codapg != null ? `pagar ${a.codapg}` : '—'}</td>
                <td className="p-pad-xs">{a.quitada === 'S' ? 'Quitado' : 'Em aberto'}{a.contabilizado === 'S' ? ' · contabilizado' : ''}</td>
                <td className="p-pad-xs text-right">
                  {bloqueado(a) ? (
                    <span className="text-body-xs text-fg-muted">{motivo(a)}</span>
                  ) : (
                    <span className="flex justify-end gap-gp-xs">
                      <Button label="Editar" variant="ghost" onClick={() => editar(a)} />
                      <Button label="Excluir" variant="ghost" onClick={() => void excluir(a)} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={10} className="p-pad-md text-fg-muted">Nenhum adiantamento no filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
