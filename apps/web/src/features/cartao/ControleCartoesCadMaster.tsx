import { useMemo } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { cartaoSchema, type CartaoDto } from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { DateField } from '../../shared/ui/DateField';
import { SelectField } from '../../shared/ui/SelectField';
import { TextArea } from '../../shared/ui/TextArea';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { hojeNaLoja } from '../../shared/tempo';

/**
 * CONTROLE DE CARTÕES (`FRMCADCARTAO`, `UcadCartao.pas` — "Lançamento de Cartões"): o form-base `TfrmCadMaster` sobre o CARTAO
 * (`SetaDataset(edtCodEmpresa, cdsCartao, 'CODVENDCARTAO', 'CARTAO')`): código + Enter, a Pesquisa da GET_CARTAO das lojas
 * (`CODIGO_EMPRESA in (GetMultiEmpresa)`), incluir/editar/excluir com as regras do Gravar e da conciliação, e o "Visualizar cupom".
 * A BAIXA é outra tela, como no legado (FRMBAIXACARTAO, `/financeiro/cartoes/baixa`).
 */
export function ControleCartoesCadMaster() {
  const navigate = useNavigate();
  // o btnBuscaOperadora: GET_OPERADORAS com ATIVO = 'S'
  const { data: opsBrutas = [] } = useResourceOptions<any, any>('cadastro/operadoras', (o: any) => (String(o.ativo ?? 'S') === 'N' ? null : { value: String(o.codoperadoras), label: `${o.codoperadoras} - ${o.operadora ?? ''}` }));
  const operadoras = (opsBrutas as Array<Opcao | null>).filter((x): x is Opcao => x != null);
  // o btnCodGrupo: GET_FORMAS_PGTO da loja com DESTINO TEF ou CARTAO (CRT)
  const { data: formasBrutas = [] } = useResourceOptions<any, any>('cadastro/formas-pgto', (f: any) => (['TEF', 'CRT'].includes(String(f.destino ?? '').toUpperCase()) ? { value: String(f.idpgto), label: `${f.idpgto} - ${f.modalidade ?? ''}` } : null));
  const formas = (formasBrutas as Array<Opcao | null>).filter((x): x is Opcao => x != null);
  const defaultValues = useMemo<Partial<CartaoDto>>(() => ({ dtvenda: hojeNaLoja(), obs: '' }), []);

  return (
    <CadMaster<CartaoDto>
      titulo="Lançamento de Cartões"
      resourcePath="cadastro/cartao"
      pk="codvendcartao"
      viewPk="codigo"
      log={{ form: 'FRMCADCARTAO', chave: 'CODVENDCARTAO' }}
      schema={cartaoSchema}
      defaultValues={defaultValues}
      largura="5xl"
      gerenciaEdicaoInterna
      colunasPesquisa={[
        { campo: 'codigo', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'data', label: 'Data', tipo: 'date', largura: 120 },
        { campo: 'operadora', label: 'Operadora', tipo: 'text' },
        { campo: 'valor', label: 'Valor', tipo: 'text', largura: 120 },
      ]}
      outros={[{
        // o BtnVisualizarCupom (:396-456): a consulta do cupom do cartão (o pedido do PDV na loja do cartão)
        label: '&Visualizar cupom', requerRegistro: true,
        onClick: ({ registro }) => {
          const nro = String(registro?.nropedido ?? '').trim();
          const emp = Number(registro?.idempresa ?? 0);
          navigate(nro ? `/vendas/historico?nropedido=${encodeURIComponent(nro)}${emp ? `&empresa=${emp}` : ''}` : '/vendas/historico');
        },
      }]}
      // "Documento ja conciliado na tesouraria, não é possivel excluí-lo!" + a senha administrativa (btnExcluirClick :293-300)
      paramsExclusao={async (r): Promise<Record<string, string> | null> => {
        if (String(r.consiliado ?? '') !== 'S') return {};
        const senha = window.prompt('Documento ja conciliado na tesouraria, não é possivel excluí-lo!\nInforme a senha administrativa:');
        return senha ? { senhaAdmin: senha } : null;
      }}
      campos={({ form, editavel }) => <CamposCartao form={form} editavel={editavel} operadoras={operadoras} formas={formas} />}
    />
  );
}

function CamposCartao({ form, editavel, operadoras, formas }: { form: UseFormReturn<CartaoDto>; editavel: boolean; operadoras: Opcao[]; formas: Opcao[] }) {
  const g = form.getValues() as Record<string, unknown>;
  const carregado = g.codvendcartao != null;
  const baixado = carregado && String(g.liberado ?? 'N') === 'S';
  // o Editar do cartão conciliado não muda o valor nem a parcela (btnEditarClick :282-291)
  const conciliado = carregado && String(g.consiliado ?? '') === 'S';
  const liberado = editavel && !baixado;
  const err = form.formState.errors as Record<string, { message?: string } | undefined>;
  return (
    <div className="flex flex-col gap-form-gap">
      {baixado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">Este cartão não poderá ser alterado pois já foi baixado.</div>
      )}
      {editavel && conciliado && !baixado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">Documento ja consiliado na tesouraria, não é possivel alteração de valores!</div>
      )}
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold">Empresas</span>
          <span className="text-fg-muted">{g.idempresa != null ? `${g.idempresa} - ${g.razao_social ?? ''}` : '(a da sessão)'}</span>
        </div>
        <Field label="Nro &Cupom" maxLength={8} disabled={!liberado} {...form.register('nrocupom')} />
        <Field label="Nro &Pedido" maxLength={14} disabled={!liberado} {...form.register('nropedido')} />
        <Controller control={form.control} name="dtvenda" render={({ field }) => (
          <DateField label="&Data Venda" value={field.value ? String(field.value).slice(0, 10) : undefined} onChange={(v) => field.onChange(v ?? '')} disabled={!liberado} />
        )} />
        <Controller control={form.control} name="valor" render={({ field }) => (
          <CurrencyField label="&Valor" value={field.value as number | undefined} onChange={field.onChange} disabled={!liberado || conciliado} error={err.valor?.message} />
        )} />
        <Controller control={form.control} name="nroparcela" render={({ field }) => (
          <NumberField label="Nro. P&arcela" value={field.value as number | undefined} onChange={field.onChange} decimais={0} min={0} disabled={!liberado || conciliado} />
        )} />
        <Controller control={form.control} name="codoperadora" render={({ field }) => (
          <SelectField label="Código &Operadora" options={operadoras} value={field.value != null ? String(field.value) : undefined}
            onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Selecione…" error={err.codoperadora?.message} />
        )} />
        <Controller control={form.control} name="idpgto" render={({ field }) => (
          <SelectField label="&Forma de pagamento" options={formas} value={field.value != null ? String(field.value) : undefined}
            onChange={(v) => field.onChange(v ? Number(v) : undefined)} placeholder="Selecione…" />
        )} />
        <Field label="&NSU" maxLength={10} disabled={!liberado} {...form.register('nsu')} />
        <Field label="NSU &Host" maxLength={30} disabled={!liberado} {...form.register('nsuhost')} />
        <Field label="Au&torização" maxLength={30} disabled={!liberado} {...form.register('autorizacao')} />
        <Controller control={form.control} name="codrede" render={({ field }) => (
          <NumberField label="Código &Rede" value={field.value as number | undefined} onChange={field.onChange} decimais={0} min={0} disabled={!liberado} />
        )} />
        <div className="flex flex-col gap-1 text-body-sm">
          <span className="font-semibold">Operador</span>
          <span className="text-fg-muted">{g.nome_operador ? String(g.nome_operador) : '—'}</span>
        </div>
      </div>
      <Controller control={form.control} name="obs" render={({ field }) => (
        <TextArea label="Observaçõe&s" value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value.slice(0, 2000))} disabled={!liberado} />
      )} />
    </div>
  );
}
