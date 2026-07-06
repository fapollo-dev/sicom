import { useMemo, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { apagarSchema, AR_TIPODOC_OPCOES, type CriarApagarDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { Tabs, TabPanel, type TabDef } from '../../shared/ui/Tabs';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { useMensagem } from '../../shared/mensagem';
import { baixarApagar, estornarBaixaApagar } from './apagarApi';

const hojeISO = () => new Date().toISOString().slice(0, 10);
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * CONTAS A PAGAR (uCadAPagar) — gêmea de A Receber: cadastro/gestão do título + baixa/pagamento,
 * layout tabulado fiel ao legado, visual do design system. O parceiro é o FORNECEDOR (frn='S').
 */
export function ContasPagarCadMaster() {
  const { data: fornecedorOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'frn', operador: 'igual', valor: 'S' },
  );
  const { data: bancoOptions = [] } = useResourceOptions('cadastro/bancos', (b: any) => ({
    value: String(b.codigo ?? b.codbco),
    label: `${b.codigo ?? b.codbco} - ${b.nome ?? b.descricao ?? ''}`,
  }));
  const { data: plcOptions = [] } = useResourceOptions('cadastro/plc', (c: any) => ({
    value: String(c.codplc),
    label: `${c.desccodplc ?? c.codplc} - ${c.descricao}`,
  }));
  const { data: situacaoOptions = [] } = useResourceOptions('cadastro/situacoes-nf', (s: any) => ({
    value: String(s.idsituacao_nf),
    label: `${s.idsituacao_nf} - ${s.descricao}`,
  }));

  const defaultValues = useMemo<Partial<CriarApagarDto>>(
    () => ({ dtvenda: hojeISO(), dtvenc: hojeISO(), nrodup: 1, tipodoc: 'DUPLICATA' }),
    [],
  );

  return (
    <CadMaster<CriarApagarDto>
      titulo="Contas a Pagar"
      resourcePath="cadastro/apagar"
      pk="codapg"
      schema={apagarSchema}
      defaultValues={defaultValues}
      largura="5xl"
      gerenciaEdicaoInterna
      colunasPesquisa={[
        { campo: 'codapg', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'duplicata', label: 'Duplicata', tipo: 'text', largura: 140 },
        { campo: 'razao', label: 'Fornecedor', tipo: 'text' },
        { campo: 'dtvenc', label: 'Vencimento', tipo: 'date', largura: 130 },
        { campo: 'valor', label: 'Valor', tipo: 'text', largura: 120 },
        { campo: 'quitada', label: 'Paga', tipo: 'text', largura: 90 },
      ]}
      campos={({ form, editavel }) => (
        <ApForm form={form} editavel={editavel} opts={{ fornecedorOptions, bancoOptions, plcOptions, situacaoOptions }} />
      )}
    />
  );
}

type LookupOptions = {
  fornecedorOptions: Opcao[];
  bancoOptions: Opcao[];
  plcOptions: Opcao[];
  situacaoOptions: Opcao[];
};

function ApForm({ form, editavel, opts }: { form: UseFormReturn<CriarApagarDto>; editavel: boolean; opts: LookupOptions }) {
  const [aba, setAba] = useState('cadastro');
  const g = form.getValues() as Record<string, unknown>;
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  const contabilizado = g.contabilizado === 'S';
  const idnf = g.idnf;
  const travado = quitada || agrupado || contabilizado || idnf != null;
  const liberado = editavel && !travado;

  const tabs: TabDef[] = [
    { id: 'cadastro', label: 'Cadastro' },
    { id: 'historico', label: 'Histórico', disabled: true },
    { id: 'pendencias', label: 'Pendências', disabled: true },
  ];

  return (
    <div className="flex flex-col gap-form-gap">
      {travado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          Título{' '}
          {quitada ? 'pago' : agrupado ? 'agrupado' : contabilizado ? 'contabilizado' : 'gerado por nota fiscal'}
          {' '}— edição bloqueada{idnf != null ? ' (altere pela nota fiscal)' : ''}.
        </div>
      )}
      <EstadoBar form={form} />
      <BaixaSection form={form} />
      <div>
        <Tabs tabs={tabs} active={aba} onChange={setAba} />
        <TabPanel>
          {aba === 'cadastro' && <CadastroTab form={form} editavel={liberado} opts={opts} />}
          {(aba === 'historico' || aba === 'pendencias') && (
            <div className="flex min-h-24 flex-col items-center justify-center gap-gp-xs text-center text-fg-muted">
              <span className="text-body-sm font-semibold text-fg-default">{tabs.find((t) => t.id === aba)?.label}</span>
              <small>Aba do legado — conteúdo previsto para fase futura (dossiê §10).</small>
            </div>
          )}
        </TabPanel>
      </div>
    </div>
  );
}

function EstadoBar({ form }: { form: UseFormReturn<CriarApagarDto> }) {
  const g = form.getValues() as Record<string, unknown>;
  const juro = Number(g.juro) || 0;
  const total = Number(g.total) || 0;
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  if (g.codapg == null) return null;
  return (
    <div className="flex flex-wrap items-center gap-gp-sm rounded-radius-md border border-border bg-bg-surface px-pad-md py-pad-sm text-body-sm">
      <span className="text-fg-muted">Situação:</span>
      <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs font-semibold text-fg-default">
        {quitada ? 'Pago' : agrupado ? 'Agrupado' : 'Em aberto'}
      </span>
      <span className="ml-auto text-fg-muted">Juros</span>
      <span className="tabular-nums text-fg-default">R$ {fmtBRL(juro)}</span>
      <span className="text-fg-muted">Total</span>
      <span className="tabular-nums font-semibold text-fg-default">R$ {fmtBRL(total)}</span>
    </div>
  );
}

/** BAIXA / pagamento: pagar quando aberto, estornar quando pago. Só em título gravado. */
function BaixaSection({ form }: { form: UseFormReturn<CriarApagarDto> }) {
  const mensagem = useMensagem();
  const g = form.getValues() as Record<string, unknown>;
  const codapg = g.codapg as number | undefined;
  const quitada = (form.watch('quitada' as any) ?? g.quitada) === 'S';
  const agrupado = (form.watch('agrupado' as any) ?? g.agrupado) === 'S';
  const [executando, setExecutando] = useState(false);
  const [dtpgto, setDtpgto] = useState<string | undefined>(hojeISO());
  const [juros, setJuros] = useState<number | undefined>(undefined);
  const [desconto, setDesconto] = useState<number | undefined>(undefined);
  const [recurso, setRecurso] = useState<string>(''); // '' = sem caixa · DINHEIRO = caixa · BANCO = pagto por banco
  const [codconta, setCodconta] = useState<number | undefined>(undefined);
  const { data: contasBancarias = [] } = useResourceOptions(
    'cadastro/contas-bancarias',
    (c: any) => ({ value: String(c.codconta), label: `${c.codconta} - ${c.titular ?? ''}${c.nroconta ? ' (' + c.nroconta + ')' : ''}` }),
  );
  if (codapg == null) return null;

  const pagar = async () => {
    if (executando) return;
    setExecutando(true);
    try {
      const r = await baixarApagar(codapg, {
        dtpgto, juros, desconto,
        recurso: recurso === 'DINHEIRO' || recurso === 'BANCO' ? (recurso as 'DINHEIRO' | 'BANCO') : undefined,
        codconta: recurso === 'BANCO' ? codconta : undefined,
      });
      form.setValue('quitada' as any, 'S');
      mensagem.sucesso(`Título pago: R$ ${fmtBRL(r.valorpg)} (juros R$ ${fmtBRL(r.juros)}).`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };
  const estornar = async () => {
    if (executando) return;
    if (!window.confirm('Estornar o pagamento deste título? O título volta a ficar em aberto.')) return;
    setExecutando(true);
    try {
      await estornarBaixaApagar(codapg);
      form.setValue('quitada' as any, 'N');
      mensagem.sucesso('Pagamento estornado: título reaberto.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  return (
    <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Baixa / Pagamento</legend>
      {agrupado ? (
        <small className="text-fg-muted">Título agrupado — o pagamento é feito pelo agrupamento (fase futura).</small>
      ) : quitada ? (
        <div className="flex flex-wrap items-center gap-gp-sm">
          <Button label="&Estornar pagamento" variant="soft" onClick={() => void estornar()} />
          <small className="text-fg-muted">Título pago. O estorno reabre o título.</small>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-44"><DateField label="Data do &pagamento" value={dtpgto} onChange={setDtpgto} /></div>
          <div className="w-36"><NumberField label="&Juros (R$)" value={juros} onChange={setJuros} decimais={2} min={0} /></div>
          <div className="w-36"><NumberField label="&Desconto (R$)" value={desconto} onChange={setDesconto} decimais={2} min={0} /></div>
          <div className="w-44">
            <SelectField
              label="&Recurso"
              options={[{ value: '', label: '— (outro)' }, { value: 'DINHEIRO', label: 'Dinheiro (caixa)' }, { value: 'BANCO', label: 'Banco (depósito)' }]}
              value={recurso}
              onChange={(v) => { setRecurso(v); if (v !== 'BANCO') setCodconta(undefined); }}
            />
          </div>
          {recurso === 'BANCO' && (
            <div className="w-56">
              <SelectField
                label="&Conta bancária"
                options={contasBancarias}
                value={codconta != null ? String(codconta) : undefined}
                onChange={(v) => setCodconta(v ? Number(v) : undefined)}
                placeholder="Selecione a conta…"
              />
            </div>
          )}
          <Button label="&Pagar título" variant="soft" onClick={() => void pagar()} />
          <small className="text-fg-muted">Dinheiro exige caixa aberto; Banco paga pela conta contábil do banco.</small>
        </div>
      )}
    </fieldset>
  );
}

function CadastroTab({ form, editavel, opts }: { form: UseFormReturn<CriarApagarDto>; editavel: boolean; opts: LookupOptions }) {
  const err = form.formState.errors;
  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <Controller
        control={form.control}
        name="codparceiro"
        render={({ field }) => (
          <SelectField
            label="&Fornecedor"
            options={opts.fornecedorOptions}
            value={field.value != null ? String(field.value) : undefined}
            onChange={(v) => field.onChange(v ? Number(v) : undefined)}
            placeholder="Selecione o fornecedor…"
            error={err.codparceiro?.message as string | undefined}
          />
        )}
      />
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-4">
        <Field label="&Duplicata" maxLength={20} {...form.register('duplicata')} />
        <Controller
          control={form.control}
          name="tipodoc"
          render={({ field }) => (
            <SelectField label="&Tipo de documento" options={AR_TIPODOC_OPCOES as unknown as Opcao[]} value={(field.value as string) ?? undefined} onChange={(v) => field.onChange(v || undefined)} placeholder="Selecione…" />
          )}
        />
        <Field label="Nº &pedido" maxLength={20} {...form.register('nroped')} />
        <Field label="Nº &cupom" maxLength={20} {...form.register('nrocupom')} />
      </div>
      <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-5">
        <Controller control={form.control} name="dtvenda" render={({ field }) => (
          <DateField label="Data de &compra" value={(field.value as string) || undefined} onChange={(v) => field.onChange(v ?? '')} error={err.dtvenda?.message as string | undefined} />
        )} />
        <Controller control={form.control} name="dtvenc" render={({ field }) => (
          <DateField label="&Vencimento" value={(field.value as string) || undefined} onChange={(v) => field.onChange(v ?? '')} error={err.dtvenc?.message as string | undefined} />
        )} />
        <Controller control={form.control} name="valor" render={({ field }) => (
          <CurrencyField label="&Valor" value={field.value as number | undefined} onChange={field.onChange} />
        )} />
        <Controller control={form.control} name="txjuros" render={({ field }) => (
          <NumberField label="&Juros (%)" value={field.value as number | undefined} onChange={field.onChange} decimais={2} min={0} />
        )} />
        <Controller control={form.control} name="nrodup" render={({ field }) => (
          <NumberField label="&Parcelas" value={field.value as number | undefined} onChange={field.onChange} decimais={0} min={1} />
        )} />
      </div>
      <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-3">
        <Controller control={form.control} name="codbco" render={({ field }) => (
          <SelectField label="&Banco" options={opts.bancoOptions} value={field.value != null ? String(field.value) : undefined} onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Opcional…" />
        )} />
        <Controller control={form.control} name="codplc" render={({ field }) => (
          <SelectField label="Centro de &custo" options={opts.plcOptions} value={field.value != null ? String(field.value) : undefined} onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Opcional…" />
        )} />
        <Controller control={form.control} name="idsituacao_nf" render={({ field }) => (
          <SelectField label="&Situação (natureza)" options={opts.situacaoOptions} value={field.value != null ? String(field.value) : undefined} onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Opcional…" />
        )} />
      </div>
      <div className="mt-form-gap">
        <TextArea label="&Observações" rows={2} {...form.register('obs')} />
      </div>
    </fieldset>
  );
}
