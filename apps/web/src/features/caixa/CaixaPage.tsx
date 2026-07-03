import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { CAIXA_ESPECIE_OPCOES, type CaixaMov, type CaixaSessao } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { TextArea } from '../../shared/ui/TextArea';
import { useMensagem } from '../../shared/mensagem';
import {
  caixaAtual, abrirCaixa, movimentarCaixa, estornarMovimentoCaixa, fecharCaixa,
  listCaixas, reabrirCaixa, type CaixaAtual,
} from './caixaApi';

const fmtBRL = (n: unknown) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDataHora = (s?: string) => (s ? new Date(s).toLocaleString('pt-BR') : '');
const ESPECIE_LABEL = new Map<string, string>([
  ...CAIXA_ESPECIE_OPCOES.map((o) => [o.value, o.label] as [string, string]),
  // espécies AUTOMÁTICAS (geradas pela baixa de A Receber/A Pagar — corte-2, não selecionáveis à mão)
  ['RECEBIMENTO', 'Recebimento (A Receber)'],
  ['PAGAMENTO', 'Pagamento (A Pagar)'],
]);
const especieOptions = CAIXA_ESPECIE_OPCOES.map((o) => ({ value: o.value, label: o.label }));

/**
 * CAIXA — corte-1 (sessão + movimento manual). Painel STATEFUL (não CRUD-grid): sem caixa aberto,
 * mostra "Abrir caixa" (fundo opcional); com caixa aberto, mostra o saldo corrente + lançamento de
 * movimento (suprimento/sangria/entrada/saída) + a lista de movimentos com estorno lógico + fechar.
 * Fiel a UabertCaixa/uMovCaixa/uFechamentoCaixa (fluxo). Conferência/quebra e tesouraria = corte-2.
 */
export function CaixaPage() {
  const mensagem = useMensagem();
  const [dados, setDados] = useState<CaixaAtual | null>(null);
  const [recentes, setRecentes] = useState<CaixaSessao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [executando, setExecutando] = useState(false);

  // formulário de abertura
  const [fundo, setFundo] = useState<number | undefined>(undefined);
  const [obsAbertura, setObsAbertura] = useState('');
  // formulário de movimento
  const [especie, setEspecie] = useState<string>('SUPRIMENTO');
  const [valor, setValor] = useState<number | undefined>(undefined);
  const [obsMov, setObsMov] = useState('');
  // conferência do fechamento (opcional)
  const [valorContado, setValorContado] = useState<number | undefined>(undefined);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [d, fechados] = await Promise.all([caixaAtual(), listCaixas('fechados')]);
      setDados(d);
      setRecentes(fechados);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [mensagem]);
  useEffect(() => { void recarregar(); }, [recarregar]);

  const onReabrir = async (codcaixa: number) => {
    if (executando) return;
    if (!window.confirm(`Reabrir o caixa nº ${codcaixa}? O título de quebra (se houver) será estornado.`)) return;
    setExecutando(true);
    try {
      const r = await reabrirCaixa(codcaixa);
      mensagem.sucesso(`Caixa nº ${r.codcaixa} reaberto${r.quebraEstornada ? ` — título de quebra ${r.quebraEstornada} estornado.` : '.'}`);
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    if (executando) return;
    setExecutando(true);
    try {
      await fn();
      mensagem.sucesso(ok);
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const onAbrir = () =>
    acao(async () => {
      await abrirCaixa({ saldoInicial: fundo, obs: obsAbertura || undefined });
      setFundo(undefined); setObsAbertura('');
    }, 'Caixa aberto com sucesso.');

  const onMovimentar = () =>
    acao(async () => {
      await movimentarCaixa({ especie: especie as any, valor: valor as number, obs: obsMov || undefined });
      setValor(undefined); setObsMov('');
    }, 'Movimento lançado.');

  const onEstornar = (codmov: number) => acao(() => estornarMovimentoCaixa(codmov), 'Movimento estornado.');

  const onFechar = async () => {
    const codcaixa = dados?.sessao?.codcaixa;
    if (codcaixa == null || executando) return;
    setExecutando(true);
    try {
      const r = await fecharCaixa(codcaixa, { valorContado });
      let msg = `Caixa nº ${r.codcaixa} fechado. Saldo esperado R$ ${fmtBRL(r.saldoFinal)}.`;
      if (r.classificacao === 'QUEBRA') msg += ` QUEBRA de R$ ${fmtBRL(Math.abs(Number(r.diferenca)))}${r.codrcbQuebra ? ` — título A Receber nº ${r.codrcbQuebra} gerado contra o operador.` : '.'}`;
      else if (r.classificacao === 'SOBRA') msg += ` SOBRA de R$ ${fmtBRL(Math.abs(Number(r.diferenca)))}.`;
      else if (r.classificacao === 'OK') msg += ' Conferência OK (sem diferença).';
      mensagem.sucesso(msg);
      setValorContado(undefined);
      await recarregar();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const columns = useMemo<DataTableColumnDef<CaixaMov>[]>(
    () => [
      { field: 'especie', headerName: 'Espécie', type: 'text', isPrimary: true, valueGetter: (r) => ESPECIE_LABEL.get(String(r.especie)) ?? r.especie },
      { field: 'tipo', headerName: 'Tipo', type: 'text', width: 110, valueGetter: (r) => (r.tipo === 'E' ? 'Entrada' : 'Saída') },
      { field: 'valor', headerName: 'Valor (R$)', type: 'number', width: 160, valueGetter: (r) => fmtBRL(r.valor) },
      { field: 'data_operacao', headerName: 'Data/Hora', type: 'text', width: 180, valueGetter: (r) => fmtDataHora(r.data_operacao) },
      { field: 'indr', headerName: 'Situação', type: 'text', width: 120, valueGetter: (r) => (String(r.indr ?? 'I') === 'E' ? 'Estornado' : 'Ativo') },
      {
        field: 'acoes', headerName: '', type: 'actions', width: 120,
        getActions: ({ row: r }: { row: CaixaMov }) =>
          String(r.indr ?? 'I') === 'E'
            ? []
            : [{ id: 'estornar', label: 'Estornar', destructive: true, onClick: (row: CaixaMov) => onEstornar(row.codmov) }],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const sessao = dados?.sessao;
  const movimentos = dados?.movimentos ?? [];

  return (
    <div className="flex flex-col gap-form-gap max-w-5xl">
      <PageHeader title="Caixa" description="Sessão do operador: abertura, movimentos manuais (suprimento/sangria) e fechamento." />

      {carregando ? (
        <small className="text-fg-muted">Carregando o caixa…</small>
      ) : !sessao ? (
        // ── SEM caixa aberto: abertura + reabertura de caixas fechados ──
        <>
          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md max-w-md">
            <strong className="text-fg-default">Nenhum caixa aberto</strong>
            <small className="text-fg-muted">Abra o caixa para começar a lançar movimentos.</small>
            <CurrencyField label="&Fundo de caixa (opcional)" value={fundo} onChange={setFundo} />
            <TextArea label="&Observação" rows={2} value={obsAbertura} onChange={(e) => setObsAbertura(e.target.value)} />
            <div><Button label="&Abrir caixa" variant="filled" onClick={onAbrir} /></div>
          </div>
          {recentes.length > 0 && (
            <div className="flex flex-col gap-gp-xs rounded-radius-md border border-border bg-bg-surface p-pad-md max-w-2xl">
              <strong className="text-fg-default">Caixas fechados recentes</strong>
              {recentes.slice(0, 8).map((c) => (
                <div key={c.codcaixa} className="flex items-center justify-between gap-gp-sm border-b border-border py-1 last:border-0">
                  <span className="text-body-sm text-fg-default">
                    Nº {c.codcaixa} · fechado {fmtDataHora(c.dtfechamento)} · saldo final R$ {fmtBRL(c.saldo_final)}
                    {Number(c.diferenca) ? ` · ${Number(c.diferenca) < 0 ? 'quebra' : 'sobra'} R$ ${fmtBRL(Math.abs(Number(c.diferenca)))}` : ''}
                  </span>
                  <Button label="Reabrir" variant="ghost" onClick={() => void onReabrir(c.codcaixa)} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        // ── COM caixa aberto: painel + movimento + lista ──
        <>
          <div className="flex flex-wrap items-center justify-between gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-col">
              <span className="inline-flex w-fit items-center rounded-radius-sm bg-bg-success-muted px-2 py-0.5 text-xs font-medium text-fg-success">Caixa aberto — nº {sessao.codcaixa}</span>
              <small className="mt-1 text-fg-muted">Aberto em {fmtDataHora(sessao.dtabertura)} · fundo R$ {fmtBRL(sessao.saldo_inicial)}</small>
            </div>
            <div className="flex flex-col items-end">
              <small className="text-fg-muted">Saldo corrente</small>
              <strong className="text-2xl text-fg-default">R$ {fmtBRL(sessao.saldo_corrente)}</strong>
            </div>
            <div className="flex items-end gap-gp-sm">
              <div className="w-40"><CurrencyField label="Valor &contado" value={valorContado} onChange={setValorContado} /></div>
              <Button label="&Fechar caixa" variant="outline" onClick={() => void onFechar()} />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="w-56"><SelectField label="&Espécie" options={especieOptions} value={especie} onChange={setEspecie} /></div>
            <div className="w-44"><CurrencyField label="&Valor" value={valor} onChange={setValor} /></div>
            <div className="flex-1 min-w-48"><TextArea label="&Observação" rows={1} value={obsMov} onChange={(e) => setObsMov(e.target.value)} /></div>
            <Button label="&Lançar movimento" variant="soft" onClick={onMovimentar} />
          </div>

          {movimentos.length === 0 ? (
            <small className="text-fg-muted">Nenhum movimento lançado ainda.</small>
          ) : (
            <DataTable
              rows={movimentos}
              columns={columns}
              getRowId={(r) => r.codmov}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: false }}
              cardBreakpoint={false}
            />
          )}
        </>
      )}
    </div>
  );
}
