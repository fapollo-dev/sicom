import { useCallback, useEffect, useState } from 'react';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { saldoPedido, divergenciasNf, liberarConferencia, type SaldoItem, type Divergencia } from './pedidoCompraApi';

const q3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TIPO_LABEL: Record<Divergencia['tipo'], string> = { PRECO: 'Preço', INE_PEDIDO: 'Fora do pedido', QUANTIDADE: 'Recebido a mais' };

/**
 * ANÁLISE PEDIDO×NF (Wave 4 corte-3) — painel do RECEBIMENTO PARCIAL 1:N no pedido: mostra o SALDO por produto
 * (qtd pedida − Σ recebida nas NFs vinculadas) e a CONFERÊNCIA de uma NF (divergências preço/quantidade/fora-do-
 * pedido + liberação; com divergência exige um SUPERVISOR — login+senha ∈ USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA).
 * `refreshKey` força re-buscar o saldo quando a barra de estado gera/importa uma NF.
 */
export function AnalisePedidoNfPanel({ codpedcomp, refreshKey = 0, ultimoCodnf }: { codpedcomp: number; refreshKey?: number; ultimoCodnf?: number }) {
  const mensagem = useMensagem();
  const [itens, setItens] = useState<SaldoItem[]>([]);
  const [totalmenteRecebido, setTotalmenteRecebido] = useState(false);
  const [carregando, setCarregando] = useState(false);

  // conferência
  const [codnf, setCodnf] = useState<number | undefined>(undefined);
  const [div, setDiv] = useState<{ divergencias: Divergencia[]; temDivergencia: boolean } | null>(null);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [exec, setExec] = useState(false);

  const carregarSaldo = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await saldoPedido(codpedcomp);
      setItens(r.itens);
      setTotalmenteRecebido(r.totalmenteRecebido);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [codpedcomp, mensagem]);

  useEffect(() => {
    void carregarSaldo();
  }, [carregarSaldo, refreshKey]);

  // pré-preenche a conferência com a NF recém-gerada/importada (a barra de estado passa o codnf via ultimoCodnf).
  useEffect(() => {
    if (ultimoCodnf != null) {
      setCodnf(ultimoCodnf);
      setDiv(null);
    }
  }, [ultimoCodnf]);

  const conferir = async () => {
    if (exec || codnf == null) return;
    setExec(true);
    setDiv(null);
    try {
      const r = await divergenciasNf(codnf);
      setDiv({ divergencias: r.divergencias, temDivergencia: r.temDivergencia });
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExec(false);
    }
  };

  const liberar = async () => {
    if (exec || codnf == null) return;
    setExec(true);
    try {
      const override = div?.temDivergencia ? { login: login.trim(), senha } : undefined;
      const r = await liberarConferencia(codnf, override);
      mensagem.sucesso(`Conferência da NF ${codnf} liberada: ${r.status}.`);
      setDiv(null);
      setLogin('');
      setSenha('');
      setCodnf(undefined);
      await carregarSaldo();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExec(false);
    }
  };

  return (
    <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Recebimento — saldo &amp; conferência (Pedido×NF)</legend>

      {/* SALDO por produto */}
      <div className="mb-gp-sm flex items-center gap-gp-sm">
        <span className={`rounded-radius-sm px-pad-xs py-[2px] text-body-sm font-semibold ${totalmenteRecebido ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>
          {totalmenteRecebido ? 'Totalmente recebido' : 'Saldo em aberto'}
        </span>
        <Button label="&Atualizar saldo" variant="ghost" onClick={() => void carregarSaldo()} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="py-[2px] pr-pad-sm">Produto</th>
              <th className="py-[2px] pr-pad-sm text-right">Pedido</th>
              <th className="py-[2px] pr-pad-sm text-right">Recebido</th>
              <th className="py-[2px] pr-pad-sm text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it) => (
              <tr key={it.idproduto} className="border-t border-border">
                <td className="py-[2px] pr-pad-sm">{it.descricao ?? `#${it.idproduto}`}</td>
                <td className="py-[2px] pr-pad-sm text-right tabular-nums">{q3(it.qtdPedido)}</td>
                <td className="py-[2px] pr-pad-sm text-right tabular-nums">{q3(it.qtdRecebida)}</td>
                <td className={`py-[2px] pr-pad-sm text-right tabular-nums font-semibold ${it.saldo < 0 ? 'text-danger' : it.saldo > 0 ? 'text-warning' : 'text-fg-muted'}`}>{q3(it.saldo)}</td>
              </tr>
            ))}
            {!itens.length && !carregando && (
              <tr><td colSpan={4} className="py-pad-sm text-fg-muted">Sem itens.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CONFERÊNCIA de uma NF vinculada */}
      <div className="mt-pad-md border-t border-border pt-pad-sm">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40">
            <NumberField label="Conferir &NF nº" value={codnf} onChange={setCodnf} decimais={0} min={1} />
          </div>
          <Button label="&Conferir" variant="soft" disabled={codnf == null || exec} onClick={() => void conferir()} />
        </div>

        {div && (
          <div className="mt-gp-sm">
            {div.temDivergencia ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="text-left text-fg-muted">
                        <th className="py-[2px] pr-pad-sm">Produto</th>
                        <th className="py-[2px] pr-pad-sm">Divergência</th>
                        <th className="py-[2px] pr-pad-sm text-right">Custo pedido</th>
                        <th className="py-[2px] pr-pad-sm text-right">Custo NF</th>
                        <th className="py-[2px] pr-pad-sm text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {div.divergencias.map((d, i) => (
                        <tr key={`${d.idproduto}-${d.tipo}-${i}`} className="border-t border-border">
                          <td className="py-[2px] pr-pad-sm">{d.descricao ?? `#${d.idproduto}`}</td>
                          <td className="py-[2px] pr-pad-sm">{TIPO_LABEL[d.tipo]}</td>
                          <td className="py-[2px] pr-pad-sm text-right tabular-nums">{d.tipo === 'PRECO' ? brl(d.custoPedido) : '—'}</td>
                          <td className="py-[2px] pr-pad-sm text-right tabular-nums">{d.tipo === 'PRECO' ? brl(d.custoNf) : '—'}</td>
                          <td className="py-[2px] pr-pad-sm text-right tabular-nums">{d.tipo === 'QUANTIDADE' ? q3(d.saldo ?? 0) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-gp-sm flex flex-wrap items-end gap-gp-sm">
                  <small className="w-full text-warning">Há divergências — informe um supervisor autorizado para liberar.</small>
                  <div className="w-40"><Field label="&Login supervisor" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" /></div>
                  <div className="w-40"><Field label="&Senha supervisor" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" /></div>
                  <Button label="&Liberar com divergência" variant="soft" disabled={exec || !login.trim() || !senha} onClick={() => void liberar()} />
                </div>
              </>
            ) : (
              <div className="flex items-center gap-gp-sm">
                <span className="text-success">Sem divergências.</span>
                <Button label="&Liberar conferência" variant="soft" disabled={exec} onClick={() => void liberar()} />
              </div>
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}
