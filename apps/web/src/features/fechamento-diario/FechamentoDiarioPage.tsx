import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { Lock, Unlock } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/SelectField';
import { useMensagem } from '../../shared/mensagem';
import { listarMes, fecharDia, abrirDia, mesInteiro, type DiaFechamento } from './fechamentoApi';

/**
 * FECHAMENTO DIÁRIO (`FRMFECHAMENTODIARIO`, `uFechamentoDiario.pas`). Dossiê: `uFechamentoDiario-impacto.md`.
 *
 * A tela do legado é uma grade de dias do mês com quatro botões: fechar o dia (F6), reabrir (F7), fechamento
 * total (F8) e reabertura total (F9). O estado mora numa coluna só — `STATUS` nulo é ABERTO e `'F'` é FECHADO
 * (não existe 'A' no legado, e inventá-lo quebraria o de-para na virada).
 *
 * Duas coisas que esta tela mostra e a do legado não:
 *  · **quantas notas pendentes** cada dia tem — porque fechar o dia MOVE a data contábil delas, e quem fecha
 *    merece ver isso antes de clicar (o `VerificaNFs`, `:770`);
 *  · **o que o fechamento fez** — quantas notas foram empurradas e para que dia. Quando não há próximo dia
 *    aberto, o legado grava 30/12/1899 (há 1 nota assim em produção); aqui não se empurra nada e a tela diz
 *    quantas ficaram para trás.
 *
 * ADIADO (fiel ao recon): o "Rateio Geral" (F10) e os painéis de conferência de registros/valores do legado —
 * são a conferência do Sintegra, e o cliente praticamente não o emite mais (10 acessos em um ano).
 */
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const ptBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function FechamentoDiarioPage() {
  const mensagem = useMensagem();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [dias, setDias] = useState<DiaFechamento[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async (a: number, m: number) => {
    try {
      const r = await listarMes(a, m);
      setDias(r.dias);
    } catch (e) {
      mensagem.erro(e);
      setDias([]);
    }
  }, [mensagem]);

  useEffect(() => { void recarregar(ano, mes); }, [ano, mes, recarregar]);

  /** o que o fechamento moveu — é a informação que decide se quem fechou precisa agir. */
  const avisarMovimento = (r: { movidas: number; para: string | null; sem_destino: number }) => {
    if (r.sem_destino > 0) {
      // não há `aviso` no MensagemApi (só erro/sucesso) — e este caso PEDE atenção: a nota ficou parada.
      mensagem.sucesso(`Dia fechado, mas ATENÇÃO: ${r.sem_destino} nota(s) não processada(s) continuam neste dia. Não há próximo dia aberto no mês para onde levar a data contábil — reabra um dia ou processe as notas.`);
    } else if (r.movidas > 0) {
      mensagem.sucesso(`Dia fechado. ${r.movidas} nota(s) não processada(s) tiveram a data contábil movida para ${ptBR(r.para as string)}.`);
    } else {
      mensagem.sucesso('Dia fechado.');
    }
  };

  const acao = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try { await fn(); await recarregar(ano, mes); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const fechar = (d: DiaFechamento) => acao(async () => {
    if (d.nfs_pendentes > 0 && !window.confirm(`Este dia tem ${d.nfs_pendentes} nota(s) não processada(s). Ao fechar, a data contábil delas passa para o próximo dia aberto. Confirma?`)) return;
    avisarMovimento(await fecharDia(d.data));
  });
  const reabrir = (d: DiaFechamento) => acao(async () => { await abrirDia(d.data); mensagem.sucesso('Dia reaberto.'); });
  const total = (fechar_: boolean) => acao(async () => {
    if (!window.confirm(`${fechar_ ? 'Fechar' : 'Reabrir'} TODOS os dias de ${MESES[mes - 1]} de ${ano}?`)) return;
    const r = await mesInteiro(ano, mes, fechar_);
    mensagem.sucesso(`${r.dias} dia(s) ${fechar_ ? 'fechados' : 'reabertos'}.`);
  });

  const anos = useMemo(() => {
    const base = hoje.getFullYear();
    return Array.from({ length: 8 }, (_, i) => base + 1 - i).map((a) => ({ value: String(a), label: String(a) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fechados = dias.filter((d) => d.fechado).length;
  const pendentes = dias.reduce((s, d) => s + d.nfs_pendentes, 0);

  const cols = useMemo<DataTableColumnDef<DiaFechamento>[]>(() => [
    {
      field: 'data', headerName: 'Dia', type: 'text', isPrimary: true, width: 160,
      valueGetter: (d) => `${ptBR(d.data)} (${DIA_SEMANA[new Date(`${d.data}T12:00:00`).getDay()]})`,
    },
    { field: 'situacao', headerName: 'Situação', type: 'text', width: 130, valueGetter: (d) => (d.fechado ? '🔒 Fechado' : 'Aberto') },
    {
      field: 'nfs_pendentes', headerName: 'Notas não processadas', type: 'text', width: 200,
      valueGetter: (d) => (d.nfs_pendentes > 0 ? `${d.nfs_pendentes} — a data contábil vai mudar` : '—'),
    },
    {
      field: 'acoes', headerName: '', type: 'actions', width: 140,
      getActions: ({ row: d }: { row: DiaFechamento }) => [
        d.fechado
          ? { id: 'abrir', label: 'Reabrir dia', icon: <Unlock size={16} />, onClick: () => void reabrir(d) }
          : { id: 'fechar', label: 'Fechar dia', icon: <Lock size={16} />, onClick: () => void fechar(d) },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ocupado, ano, mes]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Fechamento diário" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-4">
          <SelectField label="&Mês" options={MESES.map((m, i) => ({ value: String(i + 1), label: m }))}
            value={String(mes)} onChange={(v) => setMes(Number(v ?? mes))} />
          <SelectField label="&Ano" options={anos} value={String(ano)} onChange={(v) => setAno(Number(v ?? ano))} />
          <div className="flex items-end text-body-sm text-fg-muted">
            {fechados} de {dias.length} dia(s) fechado(s)
            {pendentes > 0 && ` · ${pendentes} nota(s) não processada(s) no mês`}
          </div>
        </div>
        <div className="mt-form-gap flex flex-wrap gap-gp-sm">
          <Button label="F&echamento total" variant="soft" disabled={ocupado} onClick={() => void total(true)} />
          <Button label="Re&abertura total" variant="soft" disabled={ocupado} onClick={() => void total(false)} />
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">
          Fechar um dia marca que ele está conferido e leva a data contábil das notas ainda não processadas para
          o próximo dia aberto do mês. No fechamento total isso não acontece — não há para onde levar.
        </p>
      </section>

      <DataTable rows={dias} columns={cols} getRowId={(d: DiaFechamento) => d.data} />
    </div>
  );
}
