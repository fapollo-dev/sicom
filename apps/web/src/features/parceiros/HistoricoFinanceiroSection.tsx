import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import {
  getHistoricoFinanceiro,
  type HistLinha,
  type HistResumo,
  type StatusHist,
} from './parceiroHistoricoApi';

/**
 * Aba "Histórico Financeiro" (tsSaldoParceiros do uCadClientes) — RELATÓRIO READ-ONLY. Extrato UNION de
 * CONTAS A RECEBER (+) e A PAGAR (−) do parceiro, com atraso/juros/saldo corrente, + somatórios (Receber,
 * Pagar, Receber c/ Juros, Crédito, Restante = (Pagar+Crédito)−Receber). Filtro Abertos/Liquidados/Todos
 * (RadioGroup1 do legado). Só para parceiro JÁ gravado. Modo de juros SIMPLES (composto adiado — depende
 * do subsistema de config). CHEQUE/agrupados adiados (não migrados / golden vazio).
 */
const OPCOES_STATUS: { value: StatusHist; label: string }[] = [
  { value: 'abertos', label: 'Abertos' },
  { value: 'liquidados', label: 'Liquidados' },
  { value: 'todos', label: 'Todos' },
];

const fmtNum = (n: number | null | undefined) =>
  (Number(n ?? 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export function HistoricoFinanceiroSection({ codparceiro }: { codparceiro?: number }) {
  const mensagem = useMensagem();
  const [status, setStatus] = useState<StatusHist>('todos');
  // as lojas da grade (`GetMultiEmpresa`); os somatórios somam todas, como o legado
  const [empresas, setEmpresas] = useState('');
  const [empresasAplicadas, setEmpresasAplicadas] = useState('');
  const [linhas, setLinhas] = useState<HistLinha[]>([]);
  const [resumo, setResumo] = useState<HistResumo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (codparceiro == null) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    getHistoricoFinanceiro(codparceiro, status, empresasAplicadas)
      .then((r) => {
        if (!vivo) return;
        setLinhas(r.linhas);
        setResumo(r.resumo);
      })
      .catch(() => vivo && setErro('Não foi possível carregar o histórico financeiro.'))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [codparceiro, status, empresasAplicadas]);

  const columns = useMemo<DataTableColumnDef<HistLinha & { _id: number }>[]>(
    () => [
      { field: 'tipo', headerName: 'Tipo Mov.', type: 'text', width: 110, isPrimary: true },
      { field: 'dtvenda_compra', headerName: 'Dt.Venda/Compra', type: 'text', width: 140, valueGetter: (r) => fmtData(r.dtvenda_compra) },
      { field: 'dtvenc', headerName: 'Dt.Venc.', type: 'text', width: 110, valueGetter: (r) => fmtData(r.dtvenc) },
      { field: 'nrocupom', headerName: 'Nro Cupom', type: 'text', width: 110 },
      { field: 'valor', headerName: 'Valor', type: 'text', width: 120, valueGetter: (r) => fmtNum(r.valor) },
      { field: 'saldo', headerName: 'Saldo', type: 'text', width: 120, valueGetter: (r) => fmtNum(r.saldo) },
      { field: 'txjuros', headerName: 'Tx J.', type: 'text', width: 90, valueGetter: (r) => fmtNum(r.txjuros) },
      { field: 'valor_com_juro', headerName: 'Valor c/ Juros', type: 'text', width: 130, valueGetter: (r) => fmtNum(r.valor_com_juro) },
      { field: 'saldo_com_juro', headerName: 'Saldo c/ juro', type: 'text', width: 130, valueGetter: (r) => fmtNum(r.saldo_com_juro) },
      { field: 'duplicata', headerName: 'Duplicata', type: 'text', width: 120 },
      { field: 'datapgto', headerName: 'Dt.Pgto', type: 'text', width: 110, valueGetter: (r) => fmtData(r.datapgto) },
      { field: 'agrupamento', headerName: 'Agrupamento', type: 'text', width: 120, valueGetter: (r) => (r.agrupamento ? String(r.agrupamento) : '') },
    ],
    [],
  );

  const rows = useMemo(() => linhas.map((l, i) => ({ ...l, _id: i })), [linhas]);

  if (codparceiro == null) {
    return <small className="text-fg-muted">Grave o parceiro primeiro para ver o histórico financeiro.</small>;
  }

  return (
    <div className="flex flex-col gap-gp-md">
      <div className="flex flex-wrap items-end gap-gp-sm">
        <div className="w-56">
          <SelectField
            label="&Situação"
            options={OPCOES_STATUS}
            value={status}
            onChange={(v) => setStatus((v as StatusHist) || 'todos')}
          />
        </div>
        <div className="w-40"><Field label="Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>
        <Button label="&Visualizar saldos" variant="soft" onClick={() => setEmpresasAplicadas(empresas)} />
        {/* btnImprimirExtrato: o HistoricoFinanceiro.fr3 do cliente com a consulta da situação */}
        <Button label="&Imprimir" variant="ghost" onClick={() => imprimirRelatorio(`/cadastro/parceiros/${codparceiro}/impressao/historico-financeiro?status=${status}`).catch((e) => mensagem.erro(e))} />
      </div>

      {/* Somatórios (edtReceber/edtPagar/edtSomaValorComJuro/CREDITO/edtRestante do legado) */}
      {resumo && (
        <div className="grid grid-cols-2 gap-gp-sm sm:grid-cols-5">
          {(
            [
              ['Receber', resumo.receber],
              ['Pagar', resumo.pagar],
              ['Receber c/ Juros', resumo.receber_com_juros],
              ['Crédito', resumo.credito],
              ['Saldo Restante', resumo.restante],
            ] as const
          ).map(([label, valor]) => (
            <div key={label} className="rounded-radius-base border border-border p-pad-sm">
              <div className="text-body-xs text-fg-muted">{label}</div>
              <div className={`text-body-md font-semibold tabular-nums ${valor < 0 ? 'text-fg-danger' : 'text-fg-default'}`}>
                {fmtNum(valor)}
              </div>
            </div>
          ))}
        </div>
      )}

      {erro ? (
        <small className="text-fg-danger">{erro}</small>
      ) : carregando ? (
        <small className="text-fg-muted">Carregando…</small>
      ) : rows.length === 0 ? (
        <small className="text-fg-muted">Sem títulos para a situação selecionada.</small>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(r) => r._id}
          toolbar={{ enableSearch: false, enableFilters: false }}
          paginationConfig={{ enabled: true, initialPageSize: 15 }}
          cardBreakpoint={false}
        />
      )}
    </div>
  );
}
