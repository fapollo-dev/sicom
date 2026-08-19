import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { NumberField } from '../../shared/ui/NumberField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { processarApuracao, obterApuracao, type Apuracao } from './apuracaoIcmsApi';

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const mesAtual = () => {
  const h = new Date();
  const ini = new Date(h.getFullYear(), h.getMonth(), 1);
  const fim = new Date(h.getFullYear(), h.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { ini: iso(ini), fim: iso(fim) };
};

/**
 * APURAÇÃO DE ICMS (FRMRELREGISTROS_ES) — o livro de Registro de Entradas e Saídas + a apuração do período, nos
 * três quadros do legado: o **E110** (com os ajustes manuais), o **resumo por CFOP** (entradas e saídas) e a
 * contagem do detalhe por espécie. Processar duas vezes o mesmo período exige confirmar o reprocesso, como no
 * legado ("Ja existe apuração nesse período, deseja reprocessar?"), e os cupons em **contingência** são avisados
 * porque não entram na apuração.
 */
export function ApuracaoIcmsPage() {
  const mensagem = useMensagem();
  const m = mesAtual();
  const [dataini, setDataini] = useState<string | undefined>(m.ini);
  const [datafin, setDatafin] = useState<string | undefined>(m.fim);
  const [outrosCreditos, setOutrosCreditos] = useState<number | undefined>();
  const [estornoDebitos, setEstornoDebitos] = useState<number | undefined>();
  const [outrosDebitos, setOutrosDebitos] = useState<number | undefined>();
  const [estornoCreditos, setEstornoCreditos] = useState<number | undefined>();
  const [deducoes, setDeducoes] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Apuracao | null>(null);

  const ajustes = () => ({
    outroscreditos: outrosCreditos, estornodebitos: estornoDebitos,
    outrosdebitos: outrosDebitos, estornocreditos: estornoCreditos, deducoes,
  });

  const processar = async (reprocessar = false) => {
    if (busy) return;
    if (!dataini || !datafin) { window.alert('Informe o período da apuração.'); return; }
    setBusy(true);
    try {
      const r = await processarApuracao({ dataini, datafin, reprocessar, ...ajustes() });
      setRes(r);
      if (r.aviso_contingencia) {
        // o aviso do legado, com o motivo: cupom em contingência não entra na apuração
        window.alert(`Existem ${r.aviso_contingencia} NFC-e em contingência no período — estas NÃO entram na apuração.`);
      }
      if (!reprocessar && r.reprocessada === false && r.cabecalho?.codapuracaoicms) {
        mensagem.sucesso(`Apuração ${r.cabecalho.codapuracaoicms} do período ${dia(dataini)} a ${dia(datafin)} carregada.`);
      }
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const reprocessar = async () => {
    if (!window.confirm('Já existe apuração nesse período. Deseja reprocessar? O detalhe e o resumo por CFOP serão refeitos.')) return;
    await processar(true);
  };

  const consultar = async () => {
    if (busy) return;
    if (!dataini || !datafin) { window.alert('Informe o período da apuração.'); return; }
    setBusy(true);
    try {
      setRes(await obterApuracao({ dataini, datafin, limite_detalhe: 200 }));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const c = res?.cabecalho ?? null;
  const totalCredito = c ? Number(c.saldoant) + Number(c.creditoentrada) + Number(c.outroscreditos) + Number(c.estornodebitos) : 0;
  const totalDebito = c ? Number(c.debitosaida) + Number(c.outrosdebitos) + Number(c.estornocreditos) : 0;
  const cfops = (tipo: string) => (res?.cfops ?? []).filter((l) => l.tipo === tipo);

  const linha = (rotulo: string, valor: unknown, forte = false) => (
    <div className={`flex justify-between gap-gp-md ${forte ? 'font-semibold' : ''}`}>
      <span className="text-fg-muted">{rotulo}</span>
      <span className="tabular-nums">{brl(valor)}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Apuração de ICMS — Registro de Entradas e Saídas" />

      <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-44"><DateField label="&De" value={dataini} onChange={setDataini} /></div>
          <div className="w-44"><DateField label="&Até" value={datafin} onChange={setDatafin} /></div>
          <Button label="&Apurar" variant="soft" disabled={busy} onClick={() => void processar(false)} />
          <Button label="&Reprocessar" variant="ghost" disabled={busy} onClick={() => void reprocessar()} />
          <Button label="&Consultar gravada" variant="ghost" disabled={busy} onClick={() => void consultar()} />
        </div>
        <div className="text-body-xs text-fg-muted">
          O saldo credor do mês anterior entra como saldo anterior (busca pelo mês fechado). Reprocessar um mês
          antigo não recalcula os seguintes.
        </div>
        <div className="flex flex-wrap items-end gap-gp-sm border-t border-border pt-pad-sm">
          <div className="text-body-sm font-semibold text-fg-muted">Ajustes do quadro</div>
          <div className="w-40"><NumberField label="Outros &créditos" value={outrosCreditos} decimais={2} min={0} onChange={setOutrosCreditos} /></div>
          <div className="w-40"><NumberField label="Estorno de dé&bitos" value={estornoDebitos} decimais={2} min={0} onChange={setEstornoDebitos} /></div>
          <div className="w-40"><NumberField label="Outros dé&bitos" value={outrosDebitos} decimais={2} min={0} onChange={setOutrosDebitos} /></div>
          <div className="w-40"><NumberField label="Estorno de cré&ditos" value={estornoCreditos} decimais={2} min={0} onChange={setEstornoCreditos} /></div>
          <div className="w-40"><NumberField label="De&duções" value={deducoes} decimais={2} min={0} onChange={setDeducoes} /></div>
        </div>
      </div>

      {c && (
        <div className="grid grid-cols-1 gap-gp-md md:grid-cols-2">
          {/* QUADRO 1 — o E110 */}
          <div className="flex flex-col gap-gp-xs rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="text-body-sm font-semibold text-fg-muted">
              Apuração {c.codapuracaoicms} — {dia(c.dataini)} a {dia(c.datafin)}
            </div>
            {linha('Saldo credor anterior', c.saldoant)}
            {linha('Crédito de entrada', c.creditoentrada)}
            <div className="pl-pad-md text-body-xs text-fg-muted">
              dos quais de Simples Nacional: <span className="tabular-nums">{brl(c.creditoentrada_sn)}</span>
            </div>
            {linha('Outros créditos', c.outroscreditos)}
            {linha('Estorno de débitos', c.estornodebitos)}
            {linha('Total de créditos', totalCredito, true)}
            <div className="my-pad-xs border-t border-border" />
            {linha('Débito de saída', c.debitosaida)}
            {linha('Outros débitos', c.outrosdebitos)}
            {linha('Estorno de créditos', c.estornocreditos)}
            {linha('Total de débitos', totalDebito, true)}
            <div className="my-pad-xs border-t border-border" />
            {linha('Saldo credor a transportar', c.saldocredorseguinte)}
            {linha('Saldo devedor', c.saldodevedor)}
            {linha('Deduções', c.deducoes)}
            <div className="flex justify-between gap-gp-md text-title-sm font-bold">
              <span>ICMS a recolher</span>
              <span className="tabular-nums">{brl(c.arecolher)}</span>
            </div>
          </div>

          {/* QUADRO 3 — a contagem do detalhe (por espécie) */}
          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="text-body-sm font-semibold text-fg-muted">Documentos do período</div>
            <div className="grid grid-cols-2 gap-gp-sm text-body-sm">
              <div><div className="text-fg-muted">Cupons (NFC-e)</div><div className="text-title-sm font-bold tabular-nums">{res?.contagem?.cupons ?? 0}</div></div>
              <div><div className="text-fg-muted">Notas de saída</div><div className="text-title-sm font-bold tabular-nums">{res?.contagem?.notas_saida ?? 0}</div></div>
              <div><div className="text-fg-muted">Notas de entrada</div><div className="text-title-sm font-bold tabular-nums">{res?.contagem?.notas_entrada ?? 0}</div></div>
              <div><div className="text-fg-muted">Linhas de detalhe</div><div className="text-title-sm font-bold tabular-nums">{res?.contagem?.linhas ?? 0}</div></div>
            </div>
            {!!res?.aviso_contingencia && (
              <div className="rounded-radius-sm border border-danger p-pad-sm text-body-sm text-danger">
                {res.aviso_contingencia} NFC-e em contingência no período — <strong>não entram</strong> na apuração.
              </div>
            )}
            <div className="text-body-xs text-fg-muted">
              Ficam fora da apuração: CFOP marcado como "não gera apuração", nota não processada ou cancelada, nota
              denegada, NFe sem chave ou inutilizada, item cancelado e cupom cancelado ou inutilizado.
            </div>
          </div>
        </div>
      )}

      {/* QUADRO 2 — o resumo por CFOP, entradas e saídas */}
      {c && (['E', 'S'] as const).map((tipo) => (
        <div key={tipo} className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">
            {tipo === 'E' ? 'Entradas por CFOP' : 'Saídas por CFOP'} — {cfops(tipo).length} CFOP(s)
          </div>
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">CFOP</th><th className="p-pad-xs text-right">Valor contábil</th>
                <th className="p-pad-xs text-right">Base de cálculo</th><th className="p-pad-xs text-right">Imposto</th>
                <th className="p-pad-xs text-right">Isentas / não trib.</th><th className="p-pad-xs text-right">Outras</th>
              </tr>
            </thead>
            <tbody>
              {cfops(tipo).map((l) => (
                <tr key={`${l.tipo}-${l.cfop}`} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums">{l.cfop}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.vrcontabil)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.basecalculo)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.imposto)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.isentas)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.outras)}</td>
                </tr>
              ))}
              {!cfops(tipo).length && <tr><td colSpan={6} className="p-pad-md text-fg-muted">Nenhum documento de {tipo === 'E' ? 'entrada' : 'saída'} no período.</td></tr>}
            </tbody>
            {!!cfops(tipo).length && (
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="p-pad-xs">Total</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(cfops(tipo).reduce((s, l) => s + Number(l.vrcontabil), 0))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(cfops(tipo).reduce((s, l) => s + Number(l.basecalculo), 0))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(cfops(tipo).reduce((s, l) => s + Number(l.imposto), 0))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(cfops(tipo).reduce((s, l) => s + Number(l.isentas), 0))}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(cfops(tipo).reduce((s, l) => s + Number(l.outras), 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ))}
    </div>
  );
}
