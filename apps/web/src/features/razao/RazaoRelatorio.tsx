import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { gerarRazao, type ContaRazao } from './razaoApi';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// default = MÊS corrente (o Razão detalha cada lançamento; abrir com o ano inteiro × todas as contas seria
// pesado num diário grande). O operador amplia o período/filtra a conta conforme precisar.
const mesInicio = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * LIVRO RAZÃO contábil (uRelRazaoContabil) — corte-2. Movimentos do Diário por conta analítica e período:
 * saldo anterior + cada lançamento (débito/crédito, partida dobrada) + saldo corrente. Convenção do legado
 * (saldo = Σdébito − Σcrédito). Somente leitura; filtro opcional por conta.
 */
export function RazaoRelatorio() {
  const mensagem = useMensagem();
  const [dataInicio, setDataInicio] = useState<string | undefined>(mesInicio());
  const [dataFim, setDataFim] = useState<string | undefined>(hojeISO());
  const [codconta, setCodconta] = useState('');
  const [semMovimento, setSemMovimento] = useState(false);
  const [contas, setContas] = useState<ContaRazao[]>([]);
  const [carregando, setCarregando] = useState(false);

  const gerar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await gerarRazao(dataInicio, dataFim, codconta.trim() || undefined, semMovimento);
      setContas(r.contas);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setCarregando(false);
    }
  }, [dataInicio, dataFim, codconta, semMovimento, mensagem]);
  useEffect(() => { void gerar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-form-gap max-w-5xl">
      <PageHeader title="Livro Razão" description="Movimentos do Diário por conta e período: saldo anterior, lançamentos (débito/crédito) e saldo corrente." />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-44"><DateField label="Data &inicial" value={dataInicio} onChange={setDataInicio} /></div>
        <div className="w-44"><DateField label="Data &final" value={dataFim} onChange={setDataFim} /></div>
        <div className="w-40"><Field label="&Conta (cód.)" value={codconta} onChange={(e) => setCodconta(e.target.value)} placeholder="todas" /></div>
        <CheckboxField label="Incluir sem &movimento" value={semMovimento ? 'S' : 'N'} onChange={(v) => setSemMovimento(v === 'S')} />
        <Button label="&Gerar" variant="soft" onClick={() => void gerar()} />
      </div>
      {carregando ? (
        <small className="text-fg-muted">Gerando o Razão…</small>
      ) : contas.length === 0 ? (
        <small className="text-fg-muted">Sem lançamentos no filtro informado.</small>
      ) : (
        contas.map((c) => (
          <section key={c.codplanocontas} className="flex flex-col gap-gp-xs rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-baseline justify-between gap-gp-sm">
              <div className="font-semibold">
                {c.codiexpandido ? `${c.codiexpandido} — ` : ''}{c.descricao ?? c.codplanocontas}
              </div>
              <div className="text-xs text-fg-muted">
                Saldo anterior: <strong>{fmtBRL(c.saldoAnterior)}</strong> · Saldo final: <strong>{fmtBRL(c.saldoFinal)}</strong>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th className="py-1 pr-3 font-medium">Data</th>
                    <th className="py-1 pr-3 font-medium">Histórico</th>
                    <th className="py-1 pr-3 font-medium">Doc.</th>
                    <th className="py-1 pr-3 text-right font-medium">Débito</th>
                    <th className="py-1 pr-3 text-right font-medium">Crédito</th>
                    <th className="py-1 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border text-fg-muted">
                    <td className="py-1 pr-3">{c.saldoAnterior !== 0 ? '—' : ''}</td>
                    <td className="py-1 pr-3" colSpan={2}>Saldo anterior</td>
                    <td className="py-1 pr-3 text-right"></td>
                    <td className="py-1 pr-3 text-right"></td>
                    <td className="py-1 text-right">{fmtBRL(c.saldoAnterior)}</td>
                  </tr>
                  {c.movimentos.map((m, idx) => (
                    <tr key={`${m.coddiario}-${idx}`} className="border-t border-border">
                      <td className="py-1 pr-3 whitespace-nowrap">{m.datalan.split('-').reverse().join('/')}</td>
                      <td className="py-1 pr-3">{m.historico}</td>
                      <td className="py-1 pr-3">{m.documento ?? ''}</td>
                      <td className="py-1 pr-3 text-right">{m.debito ? fmtBRL(m.debito) : ''}</td>
                      <td className="py-1 pr-3 text-right">{m.credito ? fmtBRL(m.credito) : ''}</td>
                      <td className="py-1 text-right">{fmtBRL(m.saldo)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-medium">
                    <td className="py-1 pr-3" colSpan={3}>Totais do período</td>
                    <td className="py-1 pr-3 text-right">{fmtBRL(c.totalDebito)}</td>
                    <td className="py-1 pr-3 text-right">{fmtBRL(c.totalCredito)}</td>
                    <td className="py-1 text-right">{fmtBRL(c.saldoFinal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
