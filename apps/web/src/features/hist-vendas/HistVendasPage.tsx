import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { NumberField } from '../../shared/ui/NumberField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { consultarCupom, type ConsultaCupom } from './histVendasApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dataHora = (s: unknown) => {
  if (!s) return '—';
  const t = String(s);
  const [d, h] = [t.slice(0, 10).split('-').reverse().join('/'), t.slice(11, 16)];
  return h ? `${d} ${h}` : d;
};

/**
 * CONSULTA DE HISTÓRICO DE VENDAS (FRMCONSHISTVENDAS). Informe **cupom e PDV** (os dois obrigatórios, como no
 * legado) e a venda abre: cabeçalho, itens com o total de cada um, rodapé (subtotal − cancelados) e como foi paga.
 * O PDV é o prefixo de 2 dígitos do número do pedido, então basta o número do caixa.
 */
export function HistVendasPage() {
  const mensagem = useMensagem();
  const [cupom, setCupom] = useState<number | undefined>();
  const [pdv, setPdv] = useState<number | undefined>();
  const [pedido, setPedido] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ConsultaCupom | null>(null);

  const consultar = async () => {
    if (busy) return;
    if (cupom == null) { window.alert('Informe o número do cupom'); return; }
    if (pdv == null) { window.alert('Informe o número do PDV'); return; }
    setBusy(true);
    try {
      const r = await consultarCupom({ nrocupom: cupom, pdv, nropedido: pedido || undefined });
      setRes(r);
      if (!r.encontrado) {
        // a diferença que o legado faz questão de mostrar: "não existe" × "existe e foi cancelado".
        window.alert(r.cupom_cancelado ? 'O cupom informado está cancelado.' : 'Nenhuma venda encontrada para o cupom e PDV informados.');
      }
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const cab = res?.cabecalho ?? null;

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Consulta de Histórico de Vendas" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><NumberField label="&Cupom" value={cupom} decimais={0} min={0} onChange={setCupom} /></div>
        <div className="w-28"><NumberField label="&PDV" value={pdv} decimais={0} min={0} max={99} onChange={setPdv} /></div>
        <div className="w-64"><Field label="Nro. &Pedido (opcional)" value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="ex. 01280526112745" /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
      </div>

      {cab && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap gap-gp-md text-body-sm">
            <div><div className="text-fg-muted">Pedido</div><div className="font-semibold tabular-nums">{cab.nropedido ?? '—'}</div></div>
            <div><div className="text-fg-muted">Cupom</div><div className="font-semibold tabular-nums">{cab.nrocupom ?? '—'}</div></div>
            <div><div className="text-fg-muted">Data</div><div className="font-semibold tabular-nums">{dataHora(cab.dtvenda)}</div></div>
            <div><div className="text-fg-muted">Cliente</div><div className="font-semibold">{cab.cliente ?? '—'}</div></div>
            <div><div className="text-fg-muted">Vendedor</div><div className="font-semibold">{cab.vendedor ?? '—'}</div></div>
            <div><div className="text-fg-muted">Operador</div><div className="font-semibold">{cab.operador ?? '—'}</div></div>
            {res?.cupom_cancelado && <div className="text-danger font-semibold">CUPOM CANCELADO</div>}
          </div>
        </div>
      )}

      {res?.encontrado && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">Itens — {res.totais.qtd_itens}</div>
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Item</th><th className="p-pad-xs">Código de barras</th><th className="p-pad-xs">Descrição</th>
                <th className="p-pad-xs">Un.</th><th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Unitário</th>
                <th className="p-pad-xs text-right">Vlr. Desconto</th><th className="p-pad-xs text-right">Vlr. Acréscimo</th>
                <th className="p-pad-xs text-right">Total</th><th className="p-pad-xs">Alíq.</th><th className="p-pad-xs" />
              </tr>
            </thead>
            <tbody>
              {res.itens.map((i) => (
                <tr key={`${i.nroitem}-${i.codbarra}`} className={`border-t border-border ${i.cancitem ? 'text-fg-muted line-through' : ''}`}>
                  <td className="p-pad-xs tabular-nums">{i.nroitem ?? '—'}</td>
                  <td className="p-pad-xs tabular-nums">{i.codbarra ?? '—'}</td>
                  <td className="p-pad-xs">{i.descricao ?? '—'}</td>
                  <td className="p-pad-xs">{i.unidade ?? '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{qtd(i.qtde)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(i.vrvenda)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{i.desconto ? brl(i.desconto) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{i.acrescimo ? brl(i.acrescimo) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(i.total_item)}</td>
                  <td className="p-pad-xs">{i.aliquota ?? '—'}</td>
                  <td className="p-pad-xs text-danger text-body-xs">{i.cancitem}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap justify-end gap-gp-md border-t border-border p-pad-sm text-body-sm">
            <div className="text-right"><div className="text-fg-muted">Subtotal</div><div className="tabular-nums">{brl(res.totais.subtotal)}</div></div>
            <div className="text-right"><div className="text-fg-muted">Cancelados</div><div className="tabular-nums text-danger">{brl(res.totais.cancelados)}</div></div>
            <div className="text-right"><div className="text-fg-muted">Total</div><div className="text-title-sm font-bold tabular-nums">{brl(res.totais.total)}</div></div>
          </div>
        </div>
      )}

      {res?.encontrado && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">
            Movimento do caixa neste cupom — {res.finalizadores.length} lançamento(s)
          </div>
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted"><th className="p-pad-xs">Operação</th><th className="p-pad-xs text-right">Valor (líquido de troco)</th></tr></thead>
            <tbody>
              {res.finalizadores.map((f, n) => (
                <tr key={`${f.operacao}-${n}`} className="border-t border-border">
                  <td className="p-pad-xs">{f.operacao ?? '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(f.valor)}</td>
                </tr>
              ))}
              {!res.finalizadores.length && <tr><td colSpan={2} className="p-pad-md text-fg-muted">Sem lançamentos de caixa para este pedido.</td></tr>}
            </tbody>
          </table>
          {/* o legado lista TODAS as operações do cupom, e nem todas são pagamento (sangria, desconto,
              devolução…) — por isso a soma aparece rotulada como movimento, não como "valor pago". */}
          <div className="border-t border-border p-pad-sm text-right text-body-sm">
            <span className="text-fg-muted">Soma do movimento: </span>
            <span className="tabular-nums font-semibold">{brl(res.total_finalizadores)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
