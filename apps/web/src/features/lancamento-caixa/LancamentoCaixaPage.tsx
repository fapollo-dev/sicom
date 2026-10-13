import { useMemo } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { lancamentoCaixaSchema, type LancamentoCaixaDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { DateField } from '../../shared/ui/DateField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { SelectField } from '../../shared/ui/SelectField';
import { TextArea } from '../../shared/ui/TextArea';
import { LookupField } from '../../shared/ui/LookupField';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { useSituacoesDaOperacao, useSituacaoUnica } from '../../shared/situacao/situacaoDaOperacao';
import { hojeNaLoja } from '../../shared/tempo';

/**
 * LANÇAMENTO DE CAIXA (`FRMMOVCAIXA`, F06) — o form-base `TfrmCadMaster` do legado (`SetaDataset(edtData, cdsMovCaixa, 'CODCX', 'CAIXA')`):
 * código + Enter, a Pesquisa sobre a GET_CAIXA com o obrigatório CADASTRADO_MANUALMENTE = 'S', a navegação e as teclas do pilar. O valor é
 * digitado sem sinal: o centro de custo decide (despesa sai, receita entra). A despesa gera o título A Pagar já quitado e a movimentação
 * na conta bancária; com a integração automática, o lançamento contábil. Só o que foi digitado aqui pode ser editado. O menu do legado
 * (PopupMenu1) tem o "Relatório" — a Caixa (D.R.E.).
 */
export function LancamentoCaixaPage() {
  const navigate = useNavigate();
  const situacoes = useSituacoesDaOperacao('F06', 'S');
  const { data: contas = [] } = useResourceOptions('cadastro/contas-bancarias', (c: any) => ({ value: String(c.codconta), label: `${c.nroconta ?? c.codconta} - ${c.titular ?? ''}` }));
  const defaultValues = useMemo<Partial<LancamentoCaixaDto>>(() => ({ data: hojeNaLoja(), obs: '' }), []);

  return (
    <CadMaster<LancamentoCaixaDto>
      titulo="Movimentação de caixa"
      resourcePath="cobranca/lancamento-caixa"
      pk="codcx"
      viewPk="codigo"
      log={{ form: 'FRMMOVCAIXA', chave: 'CODCX' }}
      schema={lancamentoCaixaSchema}
      defaultValues={defaultValues}
      largura="5xl"
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'emissao', label: 'Emissão', tipo: 'date', largura: 120 },
        { campo: 'valor', label: 'Valor', tipo: 'text', largura: 120 },
        { campo: 'parceiro', label: 'Parceiro', tipo: 'text' },
        { campo: 'centro_de_custo', label: 'Centro de custo', tipo: 'text' },
        { campo: 'obs', label: 'Observação', tipo: 'text' },
      ]}
      outros={[{ label: '&Relatório', onClick: () => navigate('/relatorios/caixa-dre') }]}
      campos={({ form, editavel }) => <CamposCaixa form={form} editavel={editavel} situacoes={situacoes} contas={contas} />}
    />
  );
}

function CamposCaixa({ form, editavel, situacoes, contas }: { form: UseFormReturn<LancamentoCaixaDto>; editavel: boolean; situacoes: Opcao[]; contas: Opcao[] }) {
  const g = form.getValues() as Record<string, unknown>;
  // com uma situação de lançamento de caixa só, ela entra sozinha (InformaSituacaoDocumento)
  useSituacaoUnica(form, situacoes, g.codcx == null);
  const err = form.formState.errors as Record<string, { message?: string } | undefined>;
  const idsituacao = form.watch('idsituacao_nf');
  return (
    <div className="flex flex-col gap-form-gap">
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-4">
        <Controller control={form.control} name="data" render={({ field }) => (
          <DateField label="&Movimento" value={(field.value as string) || undefined} onChange={(v) => field.onChange(v ?? '')} error={err.data?.message} />
        )} />
        <Controller control={form.control} name="valor" render={({ field }) => (
          <CurrencyField label="&Valor" value={field.value as number | undefined} onChange={field.onChange} />
        )} />
        {/* o Lote (edtIDLOTE): o do lançamento, gerado ao gravar */}
        <div className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold">Lote</span>
          <span className="tabular-nums text-fg-muted">{g.idlote != null ? String(g.idlote) : '—'}</span>
        </div>
        <Controller control={form.control} name="idsituacao_nf" render={({ field }) => (
          <SelectField label="&Situação do documento" options={situacoes} value={field.value != null ? String(field.value) : undefined}
            onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Selecione…" />
        )} />
      </div>
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        {/* uMovCaixa.pas:712-716 — GET_PLC; o filtro do legado (comprimento da máscara, CODIGO IN da situação) não é igualdade: fica no servidor */}
        <Controller control={form.control} name="codplc" render={({ field }) => (
          <LookupField label="&Centro de custo" recurso="lookup/plc" statusTela={{ pai: 'frmMovCaixa', retorno: 'edtCodPLC' }} campoDigitado="desccodplc"
            parametros={{ lancavel: 'S', idsituacao_nf: idsituacao }} campoCodigo="codplc" descricao={(l) => `${l.desccodplc ?? l.codplc} - ${l.descricao ?? ''}`}
            value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} error={err.codplc?.message} disabled={!editavel} />
        )} />
        {/* uMovCaixa.pas:740-747 — GET_PARCEIROS, ATIVADO='S' (o CODIGO IN dos parceiros da situação é cobrado no gravar) */}
        <Controller control={form.control} name="codparceiro" render={({ field }) => (
          <LookupField label="&Parceiro" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao" fixos={{ ativado: 'S' }} parametros={{ idsituacao_nf: idsituacao }}
            value={field.value as number | undefined} onChange={(cod) => field.onChange(cod ? Number(cod) : undefined)} error={err.codparceiro?.message} disabled={!editavel} />
        )} />
        <Controller control={form.control} name="codconta" render={({ field }) => (
          <SelectField label="Conta &bancária" options={contas} value={field.value != null ? String(field.value) : undefined}
            onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Selecione a conta…" error={err.codconta?.message} />
        )} />
      </div>
      {/* dbmObsKeyPress: a observação em maiúsculas */}
      <Controller control={form.control} name="obs" render={({ field }) => (
        <TextArea label="&Observações" value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value.toUpperCase().slice(0, 300))} />
      )} />
      <small className="text-fg-muted">O centro de custo decide o sinal: despesa sai do caixa (e gera o título a pagar já quitado), receita entra.</small>
    </div>
  );
}
