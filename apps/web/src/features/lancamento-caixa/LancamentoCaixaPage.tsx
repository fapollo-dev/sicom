import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { DateField } from '../../shared/ui/DateField';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { SelectField } from '../../shared/ui/SelectField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { useResourceOptions } from '../../shared/cadmaster/useResourceOptions';
import { useSituacoesDaOperacao } from '../../shared/situacao/situacaoDaOperacao';
import { atualizarLancamento, criarLancamento, excluirLancamento, listarLancamentos, type LancamentoCaixa } from './lancamentoCaixaApi';

/**
 * LANÇAMENTO DE CAIXA (`FRMMOVCAIXA`, F06) — o movimento manual da CAIXA gerencial. O valor é digitado sem sinal: o
 * centro de custo decide (despesa sai, receita entra). A despesa gera o título A Pagar já quitado e a movimentação na
 * conta bancária; com a integração automática, o lançamento contábil. Só o que foi digitado aqui pode ser editado.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const inicioMes = () => `${hoje().slice(0, 7)}-01`;
const dataBr = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '');

interface Form { codcx?: number; data: string; valor?: number; idsituacao_nf?: string; codplc?: string; codparceiro?: string; codconta?: string; obs: string }
const vazio = (): Form => ({ data: hoje(), obs: '' });

export function LancamentoCaixaPage() {
  const mensagem = useMensagem();
  const [dataIni, setDataIni] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hoje());
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState<LancamentoCaixa[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const situacoes = useSituacoesDaOperacao('F06', 'S');
  const { data: plcs = [] } = useResourceOptions('cadastro/plc', (c: any) => ({ value: String(c.codplc), label: `${c.desccodplc ?? c.codplc} - ${c.descricao}` }));
  const { data: parceiros = [] } = useResourceOptions('cadastro/parceiros', (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }));
  const { data: contas = [] } = useResourceOptions('cadastro/contas-bancarias', (c: any) => ({ value: String(c.codconta), label: `${c.nroconta ?? c.codconta} - ${c.titular ?? ''}` }));

  const executar = async (f: () => Promise<void>) => {
    setOcupado(true);
    try { await f(); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const pesquisar = () => executar(async () => { setLista(await listarLancamentos({ dataIni, dataFim, texto })); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void pesquisar(); }, []);

  // com uma situação de lançamento de caixa só, ela entra sozinha (InformaSituacaoDocumento)
  const novo = () => setForm({ ...vazio(), idsituacao_nf: situacoes.length === 1 ? situacoes[0].value : undefined });
  const editar = (l: LancamentoCaixa) => setForm({
    codcx: l.codcx, data: l.data, valor: Math.abs(Number(l.valor ?? 0)), idsituacao_nf: l.idsituacao_nf != null ? String(l.idsituacao_nf) : undefined,
    codplc: l.codplc != null ? String(l.codplc) : undefined, codparceiro: l.codparceiro != null ? String(l.codparceiro) : undefined,
    codconta: l.codconta != null ? String(l.codconta) : undefined, obs: l.obs ?? '',
  });

  const gravar = () => executar(async () => {
    if (!form) return;
    const corpo = {
      data: form.data, valor: Number(form.valor ?? 0), obs: form.obs || undefined,
      idsituacao_nf: form.idsituacao_nf ? Number(form.idsituacao_nf) : undefined,
      codplc: form.codplc ? Number(form.codplc) : (undefined as unknown as number),
      codparceiro: form.codparceiro ? Number(form.codparceiro) : (undefined as unknown as number),
      codconta: form.codconta ? Number(form.codconta) : (undefined as unknown as number),
    };
    if (form.codcx) await atualizarLancamento(form.codcx, corpo); else await criarLancamento(corpo);
    mensagem.sucesso('Alterações gravadas com sucesso!');
    setForm(null);
    setLista(await listarLancamentos({ dataIni, dataFim, texto }));
  });
  const excluir = () => executar(async () => {
    if (!form?.codcx || !window.confirm('Confirma a exclusão do registro?')) return;
    await excluirLancamento(form.codcx);
    mensagem.sucesso('Registro excluído com sucesso!');
    setForm(null);
    setLista(await listarLancamentos({ dataIni, dataFim, texto }));
  });

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Lançamento de caixa" />
      {!form && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-40"><DateField label="&De" value={dataIni} onChange={(v) => setDataIni(v ?? inicioMes())} /></div>
            <div className="w-40"><DateField label="&Até" value={dataFim} onChange={(v) => setDataFim(v ?? hoje())} /></div>
            <div className="w-64"><Field label="&Texto (observação ou parceiro)" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
            <Button label="&Pesquisar" variant="soft" onClick={() => void pesquisar()} disabled={ocupado} />
            <Button label="&Novo lançamento" onClick={novo} disabled={ocupado} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="px-2 py-1">Código</th><th className="px-2 py-1">Data</th><th className="px-2 py-1 text-right">Valor</th>
                  <th className="px-2 py-1">Centro de custo</th><th className="px-2 py-1">Parceiro</th><th className="px-2 py-1">Conta</th>
                  <th className="px-2 py-1">Observação</th><th className="px-2 py-1">Lote</th><th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.codcx} className="border-t border-border">
                    <td className="px-2 py-1 tabular-nums">{l.codcx}</td>
                    <td className="px-2 py-1 tabular-nums">{dataBr(l.data)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${Number(l.valor) < 0 ? 'text-fg-danger' : 'text-fg-success'}`}>{moeda(l.valor)}</td>
                    <td className="px-2 py-1">{l.desccodplc ?? l.codplc} {l.plc ?? ''}</td>
                    <td className="px-2 py-1">{l.razao ?? ''}</td>
                    <td className="px-2 py-1">{l.nroconta ?? ''} {l.titular ?? ''}</td>
                    <td className="px-2 py-1">{l.obs ?? ''}</td>
                    <td className="px-2 py-1 tabular-nums">{l.idlote ?? ''}</td>
                    <td className="px-2 py-1 text-right"><Button label="Abrir" variant="ghost" onClick={() => editar(l)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {form && (
        <section className="flex flex-col gap-form-gap rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <strong>{form.codcx ? `Lançamento ${form.codcx}` : 'Novo lançamento'}</strong>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-3">
            <DateField label="&Movimento" value={form.data} onChange={(v) => setForm({ ...form, data: v ?? hoje() })} />
            <NumberField label="&Valor" value={form.valor} onChange={(v) => setForm({ ...form, valor: v })} decimais={2} min={0} />
            <SelectField label="&Situação do documento" options={situacoes} value={form.idsituacao_nf} onChange={(v) => setForm({ ...form, idsituacao_nf: v || undefined })} placeholder="Selecione…" />
            <SelectField label="&Centro de custo" options={plcs} value={form.codplc} onChange={(v) => setForm({ ...form, codplc: v || undefined })} placeholder="Selecione o centro de custo…" />
            <SelectField label="&Parceiro" options={parceiros} value={form.codparceiro} onChange={(v) => setForm({ ...form, codparceiro: v || undefined })} placeholder="Selecione o parceiro…" />
            <SelectField label="Conta &bancária" options={contas} value={form.codconta} onChange={(v) => setForm({ ...form, codconta: v || undefined })} placeholder="Selecione a conta…" />
          </div>
          <TextArea label="&Observações" value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value.toUpperCase().slice(0, 300) })} />
          <small className="text-fg-muted">O centro de custo decide o sinal: despesa sai do caixa (e gera o título a pagar já quitado), receita entra.</small>
          <div className="flex flex-wrap gap-gp-sm">
            <Button label="&Gravar" onClick={() => void gravar()} disabled={ocupado} />
            {form.codcx && <Button label="E&xcluir" variant="outline" onClick={() => void excluir()} disabled={ocupado} />}
            <Button label="Ca&ncelar" variant="soft" onClick={() => setForm(null)} disabled={ocupado} />
          </div>
        </section>
      )}
    </div>
  );
}
