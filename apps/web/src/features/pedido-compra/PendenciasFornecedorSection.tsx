import { useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { CriarPedidoCompraDto } from '@apollo/shared';
import { Tabs } from '../../shared/ui/Tabs';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { pendenciasFornecedor, type PendenciasFornecedor } from './pedidoCompraApi';

const brl = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtd = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const dia = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');

/**
 * As pendências e trocas do fornecedor do pedido (abertas a cada escolha do fornecedor — `AbrePendenciasFornecedor`/`AbreCdsTroca`).
 * O pai recebe o resultado para o aviso do item ("Existem trocas em aberto para o fornecedor …").
 */
export function usePendenciasFornecedor(form: UseFormReturn<CriarPedidoCompraDto>, editavel: boolean): PendenciasFornecedor | null {
  const codparceiro = Number(form.watch('codparceiro' as never)) || undefined;
  const empresas = String((form.watch('empresas' as never) as unknown as string | undefined) ?? '');
  const [dados, setDados] = useState<PendenciasFornecedor | null>(null);
  // o aviso do VerificaPendencias ('S'): ao ESCOLHER o fornecedor e ao entrar em EDIÇÃO — não ao só navegar pelos pedidos
  const ultimo = useRef<{ forn?: number; editavel: boolean }>({ editavel });
  useEffect(() => {
    if (codparceiro == null) { setDados(null); return; }
    let vivo = true;
    pendenciasFornecedor(codparceiro, empresas).then((d) => {
      if (!vivo) return;
      setDados(d);
      const antes = ultimo.current;
      const avisar = editavel && (antes.forn !== codparceiro || !antes.editavel);
      ultimo.current = { forn: codparceiro, editavel };
      if (avisar && d.aviso === 'S' && d.mensagem) window.alert(d.mensagem);
    }).catch(() => { if (vivo) setDados(null); });
    return () => { vivo = false; };
  }, [codparceiro, empresas, editavel]);
  return dados;
}

/**
 * As abas "Pendências do fornecedor" e "Trocas" do uPedidoCompra (a aba fica vermelha com registro). Duplo clique na pendência abre o
 * A Receber (`TfrmCadAReceber.ChamaFrmAReceber`); o "Imprimir" do menu de cada uma usa o layout .fr3 do cliente, com o cabeçalho da tela.
 */
export function PendenciasFornecedorSection({ form, dados }: { form: UseFormReturn<CriarPedidoCompraDto>; dados: PendenciasFornecedor | null }) {
  const mensagem = useMensagem();
  const [aba, setAba] = useState<'pendencias' | 'trocas'>('pendencias');
  const codparceiro = Number(form.watch('codparceiro' as never)) || undefined;
  if (codparceiro == null || !dados) return null;
  const lojas = dados.empresas;
  const imprimir = () => {
    const v = form.getValues() as unknown as { codpedcomp?: number; data?: string; dt_vencimento?: string; empresas?: string };
    imprimirRelatorio(`/compras/pedidos/fornecedor/${codparceiro}/impressao/${aba}`, {
      codpedcomp: v.codpedcomp ?? null, data: v.data ?? null, dt_vencimento: v.dt_vencimento ?? null, empresas: v.empresas ?? '',
    }).catch((e) => mensagem.erro(e));
  };
  const vermelho = (n: number, rotulo: string) => (n > 0 ? `● ${rotulo} (${n})` : rotulo);
  return (
    <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Fornecedor</legend>
      <Tabs variant="sub" active={aba} onChange={(id) => setAba(id as 'pendencias' | 'trocas')}
        tabs={[{ id: 'pendencias', label: vermelho(dados.pendencias.length, 'Pendências do fornecedor') }, { id: 'trocas', label: vermelho(dados.trocas.length, 'Trocas') }]} />
      <div className="mt-gp-sm flex flex-col gap-gp-sm overflow-x-auto">
        {aba === 'pendencias' ? (
          dados.pendencias.length === 0 ? <small className="text-fg-muted">Sem pendências financeiras.</small> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left"><th className="p-pad-xs">Duplicata</th><th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Vencimento</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs">Empresa</th><th className="p-pad-xs">Centro de custo</th></tr></thead>
              <tbody>
                {dados.pendencias.map((p) => (
                  <tr key={String(p.codrcb)} className="cursor-pointer border-b border-border/50 text-fg-danger" title="Duplo clique abre o título no A Receber"
                    onDoubleClick={() => window.open(`/cadastro/areceber?codigo=${p.codrcb}`, '_blank')}>
                    <td className="p-pad-xs">{String(p.duplicata ?? '')}</td><td className="p-pad-xs">{dia(p.dtvenda)}</td><td className="p-pad-xs">{dia(p.dtvenc)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(p.valor)}</td><td className="p-pad-xs">{String(p.codempresa ?? '')}</td><td className="p-pad-xs">{String(p.centro_custo ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : dados.trocas.length === 0 ? <small className="text-fg-muted">Sem trocas pendentes.</small> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left"><th className="p-pad-xs">Barras</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Data</th>
              {lojas.map((l) => <th key={l} className="p-pad-xs text-right">Emp {l}</th>)}</tr></thead>
            <tbody>
              {dados.trocas.map((t, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="p-pad-xs">{String(t.codigobarra ?? '')}</td><td className="p-pad-xs">{String(t.descricao ?? '')}</td><td className="p-pad-xs">{dia(t.data)}</td>
                  {lojas.map((l) => <td key={l} className="p-pad-xs text-right tabular-nums">{qtd(t[`emp${l}`])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div><Button label="Imprimir" variant="ghost" onClick={imprimir} /></div>
      </div>
    </fieldset>
  );
}
